-- ADV-DOCUMENTS-001: explicit quote validity, versioned amendments bound to an accepted quote,
-- immutable document snapshots and their event history. Depends only on 001-013.
-- Additive: no column, policy, helper or grant from 001-013 is changed. The only behavioural
-- addition on public.quotes is a guard refusing acceptance of a quote whose EXPLICIT validity
-- has passed; a quote without validity never expires implicitly.
-- Calendar dates (validity) are evaluated on the UTC date, inclusive of valid_until.
begin;

create table public.quote_terms (
 quote_id uuid primary key references public.quotes(id),
 valid_until date,
 set_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default now()
);
create table public.quote_amendments (
 id uuid primary key default gen_random_uuid(),
 intervention_id uuid not null references public.interventions(id),
 base_quote_id uuid not null references public.quotes(id),
 artisan_id uuid not null references public.profiles(id),
 version integer not null check(version between 1 and 10000),
 reason text not null check(char_length(trim(reason)) between 1 and 2000),
 lines jsonb not null check(jsonb_typeof(lines)='array' and jsonb_array_length(lines) between 1 and 30),
 subtotal_cents integer not null check(subtotal_cents>0),
 tax_rate numeric not null check(tax_rate in (0,5.5,10,20)),
 tax_cents integer not null check(tax_cents>=0),
 total_cents integer not null check(total_cents between 1 and 10000000),
 valid_until date,
 status text not null default 'proposed' check(status in ('proposed','accepted','rejected','withdrawn')),
 decision_note text not null default '' check(char_length(decision_note)<=2000),
 decided_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 decided_at timestamptz,
 unique(base_quote_id,version)
);
create unique index quote_amendments_one_proposed on public.quote_amendments(base_quote_id) where status='proposed';
create index quote_amendments_intervention on public.quote_amendments(intervention_id,created_at desc);
create table public.quote_documents (
 id uuid primary key default gen_random_uuid(),
 intervention_id uuid not null references public.interventions(id),
 quote_id uuid not null references public.quotes(id),
 amendment_id uuid references public.quote_amendments(id),
 kind text not null check(kind in ('quote','amendment')),
 revision integer not null check(revision between 1 and 10000),
 reference text not null check(char_length(reference) between 1 and 40),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 snapshot_sha256 text not null check(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 generated_by uuid not null references public.profiles(id),
 generated_at timestamptz not null default now(),
 check((kind='quote' and amendment_id is null) or (kind='amendment' and amendment_id is not null))
);
create unique index quote_documents_revision on public.quote_documents(quote_id,coalesce(amendment_id,'00000000-0000-0000-0000-000000000000'::uuid),revision);
create index quote_documents_intervention on public.quote_documents(intervention_id,generated_at desc);
create table public.quote_document_events (
 id bigint generated always as identity primary key,
 intervention_id uuid not null references public.interventions(id),
 quote_id uuid not null references public.quotes(id),
 amendment_id uuid references public.quote_amendments(id),
 document_id uuid references public.quote_documents(id),
 actor_id uuid not null references public.profiles(id),
 action text not null check(action in ('terms_set','document_generated','document_downloaded','amendment_proposed','amendment_accepted','amendment_rejected','amendment_withdrawn')),
 details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
 created_at timestamptz not null default now()
);
create index quote_document_events_intervention on public.quote_document_events(intervention_id,id desc);

alter table public.quote_terms enable row level security;
alter table public.quote_amendments enable row level security;
alter table public.quote_documents enable row level security;
alter table public.quote_document_events enable row level security;
revoke all on public.quote_terms,public.quote_amendments,public.quote_documents,public.quote_document_events from public,anon,authenticated;
grant select on public.quote_terms,public.quote_amendments,public.quote_documents,public.quote_document_events to authenticated;
grant all on public.quote_terms,public.quote_amendments,public.quote_documents,public.quote_document_events to service_role;
grant usage,select on sequence public.quote_document_events_id_seq to service_role;
-- Read access follows the dossier (009 helpers): ex-members, out-of-scope viewers and third parties are refused there.
create policy quote_terms_read on public.quote_terms for select to authenticated using(exists(select 1 from public.quotes q where q.id=quote_id and public.can_access_intervention(q.intervention_id)));
create policy quote_amendments_read on public.quote_amendments for select to authenticated using(public.can_access_intervention(intervention_id));
create policy quote_documents_read on public.quote_documents for select to authenticated using(public.can_access_intervention(intervention_id));
create policy quote_document_events_read on public.quote_document_events for select to authenticated using(public.can_access_intervention(intervention_id));

-- 'unspecified' is an explicit state: an unset validity is never treated as expired.
create function public.quote_validity_state(p_valid_until date) returns text language sql stable set search_path='' as $$
 select case when p_valid_until is null then 'unspecified' when p_valid_until<(now() at time zone 'UTC')::date then 'expired' else 'valid' end;
$$;
create function public.quote_document_reference(p_quote_id uuid,p_version integer default null) returns text language sql immutable set search_path='' as $$
 select case when p_version is null then '' else 'AV-'||p_version::text||'-' end||'DEV-'||upper(left(replace(p_quote_id::text,'-',''),6));
$$;
-- Issuer data comes only from the artisan's dossier and account. Nothing is defaulted or invented.
create function public.quote_document_issuer(p_artisan_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.artisan_profiles; p public.profiles; missing text[]:='{}'; optional text[]:='{}';
begin
 select * into p from public.profiles where id=p_artisan_id;
 select * into a from public.artisan_profiles where user_id=p_artisan_id;
 if a.user_id is null or char_length(trim(a.company_name))<1 then missing=missing||array['company_name']; end if;
 if a.user_id is null or a.siret !~ '^[0-9]{14}$' then missing=missing||array['siret']; end if;
 if a.user_id is null or char_length(trim(a.address))<5 then missing=missing||array['address']; end if;
 if p.id is null or char_length(trim(p.full_name))<1 then missing=missing||array['contact_name']; end if;
 if coalesce(trim(a.legal_status),'')='' then optional=optional||array['legal_status']; end if;
 if coalesce(trim(p.phone),'')='' then optional=optional||array['phone']; end if;
 -- Not modelled in the schema at all: stated as unset, never filled with a placeholder.
 optional=optional||array['vat_number','insurance'];
 return jsonb_build_object('company_name',coalesce(trim(a.company_name),''),'legal_status',coalesce(trim(a.legal_status),''),'siret',coalesce(a.siret,''),
  'address',coalesce(trim(a.address),''),'contact_name',coalesce(trim(p.full_name),''),'phone',coalesce(trim(p.phone),''),
  'missing',to_jsonb(missing),'missing_optional',to_jsonb(optional));
end; $$;
create function public.quote_document_json(d public.quote_documents) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',d.id,'kind',d.kind,'reference',d.reference,'revision',d.revision,'quote_id',d.quote_id,'amendment_id',d.amendment_id,
  'generated_at',d.generated_at,'generated_by',d.generated_by,'snapshot_sha256',d.snapshot_sha256);
$$;
create function public.quote_amendment_json(a public.quote_amendments) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',a.id,'intervention_id',a.intervention_id,'base_quote_id',a.base_quote_id,'artisan_id',a.artisan_id,'version',a.version,
  'reference',public.quote_document_reference(a.base_quote_id,a.version),'status',a.status,'reason',a.reason,'lines',a.lines,
  'subtotal_cents',a.subtotal_cents,'tax_rate',a.tax_rate,'tax_cents',a.tax_cents,'total_cents',a.total_cents,
  'terms',jsonb_build_object('valid_until',a.valid_until,'validity',public.quote_validity_state(a.valid_until)),
  'decision_note',a.decision_note,'decided_by',a.decided_by,'created_at',a.created_at,'decided_at',a.decided_at);
$$;
-- The snapshot is the document. Built in UTC so the same content always yields the same fingerprint.
create function public.quote_document_snapshot(p_quote_id uuid,p_amendment_id uuid) returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare q public.quotes; job public.interventions; am public.quote_amendments; s public.sites; o public.organizations; c public.profiles;
 issuer jsonb; terms jsonb; amendment jsonb; cumulative bigint;
begin
 select * into q from public.quotes where id=p_quote_id;
 if not found then raise no_data_found; end if;
 select * into job from public.interventions where id=q.intervention_id;
 issuer=public.quote_document_issuer(q.artisan_id);
 if jsonb_array_length(issuer->'missing')>0 then
  raise exception 'issuer_incomplete:%',(select string_agg(x,',') from jsonb_array_elements_text(issuer->'missing') x) using errcode='QD001';
 end if;
 select * into c from public.profiles where id=job.client_id;
 if job.site_id is not null then
  select * into s from public.sites where id=job.site_id;
  select * into o from public.organizations where id=s.organization_id;
 end if;
 select jsonb_build_object('valid_until',t.valid_until,'validity',public.quote_validity_state(t.valid_until)) into terms from public.quote_terms t where t.quote_id=q.id;
 if terms is null then terms=jsonb_build_object('valid_until',null,'validity','unspecified'); end if;
 if p_amendment_id is not null then
  select * into am from public.quote_amendments where id=p_amendment_id and base_quote_id=q.id;
  if not found then raise no_data_found; end if;
  select q.total_cents+coalesce(sum(a.total_cents),0) into cumulative from public.quote_amendments a where a.base_quote_id=q.id and a.status='accepted' and a.id<>am.id;
  amendment=public.quote_amendment_json(am)||jsonb_build_object('cumulative_total_cents',cumulative+am.total_cents);
 end if;
 return jsonb_build_object(
  'kind',case when am.id is null then 'quote' else 'amendment' end,
  'reference',public.quote_document_reference(q.id,am.version),
  'currency','EUR',
  'intervention',jsonb_build_object('id',job.id,'reference','INT-'||upper(left(replace(job.id::text,'-',''),6)),'category',job.category,'urgency',job.urgency,
   'address',job.address,'postal_code',job.postal_code,'city',job.city,'description',left(job.description,600)),
  'issuer',issuer-'missing',
  'recipient',jsonb_build_object('name',coalesce(trim(c.full_name),''),
   'organization',case when o.id is null then null else jsonb_build_object('name',o.name) end,
   'site',case when s.id is null then null else jsonb_build_object('name',s.name,'address',s.address) end),
  'quote',jsonb_build_object('id',q.id,'reference',public.quote_document_reference(q.id),'status',q.status,'created_at',q.created_at,'accepted_at',q.accepted_at,
   'lines',q.lines,'subtotal_cents',q.subtotal_cents,'tax_rate',q.tax_rate,'tax_cents',q.tax_cents,'total_cents',q.total_cents,'terms',terms),
  'amendment',amendment,
  'settlement','not_connected',
  'notices',jsonb_build_array('Ce document n’est pas une facture.','Montants en euros, TVA au taux indiqué, calculés par la plateforme à partir des lignes.'));
end; $$;

-- Explicit validity, set by the quote's author while the quote is still awaiting a decision.
create function public.set_quote_terms(p_quote_id uuid,p_valid_until date) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes; job public.interventions; result public.quote_terms;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into q from public.quotes where id=p_quote_id;
 if not found then raise no_data_found; end if;
 if q.artisan_id is distinct from auth.uid() or not exists(select 1 from public.profiles where id=auth.uid() and role='artisan' and artisan_approved) then raise insufficient_privilege; end if;
 perform public.lock_intervention_organization(q.intervention_id);
 select * into job from public.interventions where id=q.intervention_id for update;
 if job.artisan_id is distinct from auth.uid() then raise insufficient_privilege; end if;
 select * into q from public.quotes where id=p_quote_id for update;
 if q.status<>'sent' then raise exception 'Quote terms are frozen once decided' using errcode='P0001'; end if;
 -- A validity in the past would retro-expire the quote: refused.
 if p_valid_until is not null and p_valid_until<(now() at time zone 'UTC')::date then raise invalid_parameter_value; end if;
 perform public.consume_action('quote_document',20);
 insert into public.quote_terms(quote_id,valid_until,set_by) values(q.id,p_valid_until,auth.uid())
 on conflict(quote_id) do update set valid_until=excluded.valid_until,set_by=excluded.set_by,updated_at=now() returning * into result;
 insert into public.quote_document_events(intervention_id,quote_id,actor_id,action,details) values(job.id,q.id,auth.uid(),'terms_set',jsonb_build_object('valid_until',p_valid_until));
 return jsonb_build_object('quote_id',result.quote_id,'valid_until',result.valid_until,'validity',public.quote_validity_state(result.valid_until),'updated_at',result.updated_at);
end; $$;
-- Guard on the existing acceptance path: only an EXPLICIT, passed validity blocks acceptance.
create function public.guard_quote_validity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='accepted' and old.status is distinct from 'accepted'
  and exists(select 1 from public.quote_terms t where t.quote_id=new.id and t.valid_until is not null and t.valid_until<(now() at time zone 'UTC')::date) then
  raise exception 'Quote validity expired' using errcode='P0001';
 end if;
 return new;
end; $$;
create trigger quote_validity_guard before update on public.quotes for each row execute function public.guard_quote_validity();

-- An amendment is a new versioned object proposed on an accepted quote, with the same line rules
-- and server arithmetic as send_quote (001). It never edits the accepted quote.
create function public.propose_quote_amendment(p_base_quote_id uuid,p_lines jsonb,p_tax_rate numeric,p_reason text,p_valid_until date default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes; job public.interventions; account public.profiles; dossier public.artisan_profiles; result public.quote_amendments;
 subtotal bigint; tax bigint; item_count integer; valid_count integer; next_version integer;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into q from public.quotes where id=p_base_quote_id;
 if not found then raise no_data_found; end if;
 if q.artisan_id is distinct from auth.uid() then raise insufficient_privilege; end if;
 -- Lock order shared with 010/012: organisation -> dossier -> profile -> artisan dossier.
 perform public.lock_intervention_organization(q.intervention_id);
 select * into job from public.interventions where id=q.intervention_id for update;
 select * into account from public.profiles where id=auth.uid() for update;
 select * into dossier from public.artisan_profiles where user_id=auth.uid() for update;
 if job.artisan_id is distinct from auth.uid() or account.role is distinct from 'artisan' or not coalesce(account.artisan_approved,false) or dossier.application_status is distinct from 'approved' then raise insufficient_privilege; end if;
 select * into q from public.quotes where id=p_base_quote_id for share;
 if q.status<>'accepted' or job.status not in ('accepted','in_progress') then raise exception 'Amendments require an accepted quote and work not yet completed' using errcode='P0001'; end if;
 if exists(select 1 from public.quote_amendments where base_quote_id=q.id and status='proposed') then raise exception 'An amendment is already awaiting decision' using errcode='P0001'; end if;
 if p_reason is null or char_length(trim(p_reason)) not between 1 and 2000 then raise invalid_parameter_value; end if;
 if p_valid_until is not null and p_valid_until<(now() at time zone 'UTC')::date then raise invalid_parameter_value; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 30 or p_tax_rate is null or p_tax_rate not in (0,5.5,10,20) then raise invalid_parameter_value; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x where jsonb_typeof(x)<>'object' or x-array['label','quantity','unit_price_cents']<>'{}'::jsonb
  or jsonb_typeof(x->'label') is distinct from 'string' or jsonb_typeof(x->'quantity') is distinct from 'number' or jsonb_typeof(x->'unit_price_cents') is distinct from 'number') then raise invalid_parameter_value; end if;
 select count(*),count(*) filter(where char_length(trim(x.label)) between 1 and 160 and x.quantity between 1 and 1000 and x.quantity=trunc(x.quantity) and x.unit_price_cents between 0 and 10000000 and x.unit_price_cents=trunc(x.unit_price_cents)),sum(x.quantity*x.unit_price_cents)
 into item_count,valid_count,subtotal from jsonb_to_recordset(p_lines) as x(label text,quantity numeric,unit_price_cents numeric);
 if item_count<>valid_count or subtotal is null or subtotal<1 then raise invalid_parameter_value; end if;
 tax=round(subtotal*p_tax_rate/100);
 if subtotal+tax>10000000 then raise invalid_parameter_value; end if;
 perform public.consume_action('quote_amendment',20);
 select coalesce(max(version),0)+1 into next_version from public.quote_amendments where base_quote_id=q.id;
 insert into public.quote_amendments(intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents,valid_until)
 values(job.id,q.id,auth.uid(),next_version,trim(p_reason),p_lines,subtotal,p_tax_rate,tax,subtotal+tax,p_valid_until) returning * into result;
 insert into public.quote_document_events(intervention_id,quote_id,amendment_id,actor_id,action,details) values(job.id,q.id,result.id,auth.uid(),'amendment_proposed',jsonb_build_object('version',result.version,'total_cents',result.total_cents));
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),job.id,'amendment_proposed');
 return public.quote_amendment_json(result);
end; $$;
create function public.withdraw_quote_amendment(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare am public.quote_amendments; job public.interventions;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into am from public.quote_amendments where id=p_id;
 if not found then raise no_data_found; end if;
 if am.artisan_id is distinct from auth.uid() then raise insufficient_privilege; end if;
 perform public.lock_intervention_organization(am.intervention_id);
 select * into job from public.interventions where id=am.intervention_id for share;
 select * into am from public.quote_amendments where id=p_id for update;
 if am.status<>'proposed' then raise exception 'Amendment already decided' using errcode='P0001'; end if;
 perform public.consume_action('quote_amendment',20);
 update public.quote_amendments set status='withdrawn',decided_by=auth.uid(),decided_at=now() where id=p_id returning * into am;
 insert into public.quote_document_events(intervention_id,quote_id,amendment_id,actor_id,action) values(am.intervention_id,am.base_quote_id,am.id,auth.uid(),'amendment_withdrawn');
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),am.intervention_id,'amendment_withdrawn');
 return public.quote_amendment_json(am);
end; $$;
-- The decider accepts or rejects the exact amendment id displayed; no browser amount is trusted.
create function public.decide_quote_amendment(p_id uuid,p_decision text,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare am public.quote_amendments; job public.interventions; threshold integer; cumulative bigint;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into am from public.quote_amendments where id=p_id;
 if not found then raise no_data_found; end if;
 perform public.lock_intervention_organization(am.intervention_id);
 select * into job from public.interventions where id=am.intervention_id for update;
 if not public.owns_intervention(job.id) then raise insufficient_privilege; end if;
 if p_decision is null or p_decision not in ('accepted','rejected') or p_note is null or char_length(p_note)>2000 then raise invalid_parameter_value; end if;
 select * into am from public.quote_amendments where id=p_id for update;
 if am.status<>'proposed' then raise exception 'Amendment already decided' using errcode='P0001'; end if;
 if job.status not in ('accepted','in_progress') then raise exception 'Work stage no longer accepts amendments' using errcode='P0001'; end if;
 if p_decision='accepted' then
  if am.valid_until is not null and am.valid_until<(now() at time zone 'UTC')::date then raise exception 'Amendment validity expired' using errcode='P0001'; end if;
  -- Site approval rules (002) cover quotes only. An amendment that would carry the committed
  -- amount over the threshold is refused explicitly rather than bypassing the approval workflow.
  if job.site_id is not null then
   select r.threshold_cents into threshold from public.approval_rules r where r.site_id=job.site_id and r.enabled;
   if threshold is not null then
    select q.total_cents+coalesce((select sum(a.total_cents) from public.quote_amendments a where a.base_quote_id=q.id and a.status='accepted'),0) into cumulative from public.quotes q where q.id=am.base_quote_id;
    if cumulative+am.total_cents>threshold then raise exception 'Site approval workflow required for this amendment' using errcode='P0001'; end if;
   end if;
  end if;
 end if;
 perform public.consume_action('quote_amendment',20);
 update public.quote_amendments set status=p_decision,decision_note=p_note,decided_by=auth.uid(),decided_at=now() where id=p_id returning * into am;
 insert into public.quote_document_events(intervention_id,quote_id,amendment_id,actor_id,action,details) values(am.intervention_id,am.base_quote_id,am.id,auth.uid(),'amendment_'||p_decision,jsonb_build_object('total_cents',am.total_cents));
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),am.intervention_id,'amendment_'||p_decision);
 return public.quote_amendment_json(am);
end; $$;

-- Controlled generation: a new revision only when the server snapshot differs from the latest one.
create function public.generate_quote_document(p_quote_id uuid,p_amendment_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes; job public.interventions; am public.quote_amendments; latest public.quote_documents; result public.quote_documents; snap jsonb; digest text;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into q from public.quotes where id=p_quote_id;
 if not found then raise no_data_found; end if;
 perform public.lock_intervention_organization(q.intervention_id);
 select * into job from public.interventions where id=q.intervention_id for share;
 if not coalesce(q.artisan_id=auth.uid() or public.owns_intervention(job.id) or public.is_admin(),false) then raise insufficient_privilege; end if;
 -- Serializes generation per quote and keeps acceptance ordered against the snapshot.
 select * into q from public.quotes where id=p_quote_id for update;
 if p_amendment_id is not null then
  select * into am from public.quote_amendments where id=p_amendment_id and base_quote_id=q.id for share;
  if not found then raise no_data_found; end if;
 end if;
 perform public.consume_action('quote_document',20);
 snap=public.quote_document_snapshot(p_quote_id,p_amendment_id);
 digest=encode(sha256(convert_to(snap::text,'UTF8')),'hex');
 select * into latest from public.quote_documents where quote_id=q.id and amendment_id is not distinct from p_amendment_id order by revision desc limit 1;
 if latest.id is not null and latest.snapshot_sha256=digest then return jsonb_build_object('document',public.quote_document_json(latest),'created',false); end if;
 insert into public.quote_documents(intervention_id,quote_id,amendment_id,kind,revision,reference,snapshot,snapshot_sha256,generated_by)
 values(job.id,q.id,p_amendment_id,case when p_amendment_id is null then 'quote' else 'amendment' end,coalesce(latest.revision,0)+1,snap->>'reference',snap,digest,auth.uid()) returning * into result;
 insert into public.quote_document_events(intervention_id,quote_id,amendment_id,document_id,actor_id,action,details)
 values(job.id,q.id,p_amendment_id,result.id,auth.uid(),'document_generated',jsonb_build_object('revision',result.revision,'reference',result.reference,'snapshot_sha256',digest));
 return jsonb_build_object('document',public.quote_document_json(result),'created',true);
end; $$;
-- The private download route authorises and reads through this single call, then renders the snapshot.
create function public.record_quote_document_download(p_document_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.quote_documents;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 select * into d from public.quote_documents where id=p_document_id;
 if not found or not public.can_access_intervention(d.intervention_id) then raise no_data_found; end if;
 perform public.consume_action('quote_document_download',60);
 insert into public.quote_document_events(intervention_id,quote_id,amendment_id,document_id,actor_id,action) values(d.intervention_id,d.quote_id,d.amendment_id,d.id,auth.uid(),'document_downloaded');
 return jsonb_build_object('document',public.quote_document_json(d),'snapshot',d.snapshot);
end; $$;

-- One consistent read: quotes of a dossier with validity, documents, amendments, server-computed
-- permissions and the event history. The UI never derives a right from a role or a menu.
create function public.quote_documents_overview(p_intervention_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare job public.interventions; me public.profiles; is_artisan boolean; can_manage boolean; admin boolean; approved boolean; issuer jsonb;
begin
 if auth.uid() is null or not public.can_access_intervention(p_intervention_id) then raise insufficient_privilege; end if;
 select * into job from public.interventions where id=p_intervention_id;
 if not found then raise no_data_found; end if;
 select * into me from public.profiles where id=auth.uid();
 admin=public.is_admin(); can_manage=public.owns_intervention(p_intervention_id);
 is_artisan=job.artisan_id is not null and job.artisan_id=auth.uid();
 approved=me.role='artisan' and coalesce(me.artisan_approved,false) and exists(select 1 from public.artisan_profiles a where a.user_id=auth.uid() and a.application_status='approved');
 if job.artisan_id is null then issuer=jsonb_build_object('ready',false,'missing','[]'::jsonb);
 else
  issuer=public.quote_document_issuer(job.artisan_id);
  issuer=jsonb_build_object('ready',jsonb_array_length(issuer->'missing')=0,'missing',case when is_artisan or admin then issuer->'missing' else '[]'::jsonb end);
 end if;
 return jsonb_build_object(
  'intervention',jsonb_build_object('id',job.id,'status',job.status,'artisan_id',job.artisan_id,'site_id',job.site_id),
  'viewer',jsonb_build_object('role',me.role,'is_artisan',is_artisan,'can_manage',can_manage,'is_admin',admin),
  'issuer',issuer,
  'quotes',(select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'reference',public.quote_document_reference(q.id),'status',q.status,'created_at',q.created_at,'accepted_at',q.accepted_at,'lines',q.lines,
    'subtotal_cents',q.subtotal_cents,'tax_rate',q.tax_rate,'tax_cents',q.tax_cents,'total_cents',q.total_cents,
    'terms',(select jsonb_build_object('valid_until',t.valid_until,'validity',public.quote_validity_state(t.valid_until),'updated_at',t.updated_at) from public.quote_terms t where t.quote_id=q.id),
    'permissions',jsonb_build_object(
     'can_set_terms',is_artisan and approved and q.artisan_id=auth.uid() and q.status='sent',
     'can_generate',q.artisan_id=auth.uid() or can_manage or admin,
     'can_propose',is_artisan and approved and q.artisan_id=auth.uid() and q.status='accepted' and job.status in ('accepted','in_progress')
      and not exists(select 1 from public.quote_amendments a where a.base_quote_id=q.id and a.status='proposed')),
    'documents',(select coalesce(jsonb_agg(public.quote_document_json(d) order by d.revision desc),'[]'::jsonb) from public.quote_documents d where d.quote_id=q.id and d.amendment_id is null),
    'amendments',(select coalesce(jsonb_agg(public.quote_amendment_json(a)||jsonb_build_object(
      'permissions',jsonb_build_object(
       'can_decide',can_manage and a.status='proposed' and job.status in ('accepted','in_progress'),
       'can_withdraw',is_artisan and a.artisan_id=auth.uid() and a.status='proposed',
       'can_generate',q.artisan_id=auth.uid() or can_manage or admin),
      'documents',(select coalesce(jsonb_agg(public.quote_document_json(d) order by d.revision desc),'[]'::jsonb) from public.quote_documents d where d.amendment_id=a.id)
     ) order by a.version desc),'[]'::jsonb) from public.quote_amendments a where a.base_quote_id=q.id)
   ) order by q.created_at desc,q.id),'[]'::jsonb) from public.quotes q where q.intervention_id=p_intervention_id),
  'history',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]'::jsonb) from (select * from public.quote_document_events where intervention_id=p_intervention_id order by id desc limit 200) e),
  'settlement','not_connected');
end; $$;

revoke execute on function public.quote_validity_state(date),public.quote_document_reference(uuid,integer),public.quote_document_issuer(uuid),public.quote_document_json(public.quote_documents),public.quote_amendment_json(public.quote_amendments),public.quote_document_snapshot(uuid,uuid),public.guard_quote_validity(),
 public.set_quote_terms(uuid,date),public.propose_quote_amendment(uuid,jsonb,numeric,text,date),public.withdraw_quote_amendment(uuid),public.decide_quote_amendment(uuid,text,text),public.generate_quote_document(uuid,uuid),public.record_quote_document_download(uuid),public.quote_documents_overview(uuid) from public,anon,authenticated;
grant execute on function public.set_quote_terms(uuid,date),public.propose_quote_amendment(uuid,jsonb,numeric,text,date),public.withdraw_quote_amendment(uuid),public.decide_quote_amendment(uuid,text,text),public.generate_quote_document(uuid,uuid),public.record_quote_document_download(uuid),public.quote_documents_overview(uuid) to authenticated;
commit;
