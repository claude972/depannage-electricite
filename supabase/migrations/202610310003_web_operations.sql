-- Web/PWA operations: additive actor-scoped records, not regulatory certification.
-- Apply only to the dedicated project. RLS patterns: https://supabase.com/docs/guides/database/postgres/row-level-security
begin;

-- Organization dossiers are owned by the organization, not permanently by an ex-member.
create or replace function public.can_access_intervention(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.interventions i left join public.sites s on s.id=i.site_id
 where i.id=target and (public.is_admin() or i.artisan_id=auth.uid() or
 (i.site_id is null and i.client_id=auth.uid()) or public.is_org_member(s.organization_id)));
$$;
create or replace function public.owns_intervention(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.interventions i left join public.sites s on s.id=i.site_id
 where i.id=target and ((i.site_id is null and i.client_id=auth.uid()) or public.is_org_member(s.organization_id,true)));
$$;
drop policy documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated using(
 (intervention_id is null and owner_id=auth.uid()) or public.can_access_intervention(intervention_id) or public.is_admin());
drop policy documents_objects_read on storage.objects;
create policy documents_objects_read on storage.objects for select to authenticated using(
 bucket_id='intervention-documents' and exists(select 1 from public.documents d where d.path=storage.objects.name and
 ((d.intervention_id is null and d.owner_id=auth.uid()) or public.can_access_intervention(d.intervention_id) or public.is_admin())));

create table public.artisan_profiles (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 company_name text not null default '' check(char_length(company_name)<=160),
 siret text not null default '' check(siret='' or siret ~ '^[0-9]{14}$'),
 legal_status text not null default '' check(char_length(legal_status)<=80),
 employee_count integer not null default 0 check(employee_count between 0 and 100000),
 address text not null default '' check(char_length(address)<=500),
 postal_codes text[] not null default '{}' check(cardinality(postal_codes)<=100),
 categories text[] not null default '{}' check(cardinality(categories)<=5 and categories <@ array['outage','panel','socket','lighting','diagnostic']::text[]),
 available boolean not null default false,
 application_status text not null default 'draft' check(application_status in ('draft','submitted','changes_requested','approved','suspended')),
 submitted_at timestamptz, updated_at timestamptz not null default now()
);
create table public.artisan_credentials (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 document_id uuid not null unique references public.documents(id),
 kind text not null check(kind in ('registration','liability','qualification','other')),
 expires_on date, created_at timestamptz not null default now()
);
create table public.mission_declines (
 intervention_id uuid not null references public.interventions(id), artisan_id uuid not null references public.profiles(id),
 reason text not null default '' check(char_length(reason)<=1000), created_at timestamptz not null default now(),
 primary key(intervention_id,artisan_id)
);
create table public.intervention_appointments (
 intervention_id uuid primary key references public.interventions(id), starts_at timestamptz not null, ends_at timestamptz not null,
 note text not null default '' check(char_length(note)<=2000), updated_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default now(), check(ends_at>starts_at and ends_at<=starts_at+interval '24 hours')
);
create table public.intervention_reports (
 intervention_id uuid primary key references public.interventions(id), artisan_id uuid not null references public.profiles(id),
 summary text not null check(char_length(trim(summary)) between 10 and 8000),
 checks jsonb not null default '[]' check(jsonb_typeof(checks)='array' and jsonb_array_length(checks)<=50),
 signature_name text not null default '' check(char_length(signature_name)<=120),
 updated_at timestamptz not null default now()
);
alter table public.interventions add column travel_stage text not null default 'planned' check(travel_stage in ('planned','en_route','on_site'));

alter table public.artisan_profiles enable row level security;
alter table public.artisan_credentials enable row level security;
alter table public.mission_declines enable row level security;
alter table public.intervention_appointments enable row level security;
alter table public.intervention_reports enable row level security;
revoke all on public.artisan_profiles,public.artisan_credentials,public.mission_declines,public.intervention_appointments,public.intervention_reports from public,anon,authenticated;
grant select on public.artisan_profiles,public.artisan_credentials,public.mission_declines,public.intervention_appointments,public.intervention_reports to authenticated;
grant all on public.artisan_profiles,public.artisan_credentials,public.mission_declines,public.intervention_appointments,public.intervention_reports to service_role;
create policy artisan_profiles_read on public.artisan_profiles for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy artisan_credentials_read on public.artisan_credentials for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy mission_declines_read on public.mission_declines for select to authenticated using(artisan_id=auth.uid() or public.is_admin());
create policy appointments_read on public.intervention_appointments for select to authenticated using(public.can_access_intervention(intervention_id));
create policy reports_read on public.intervention_reports for select to authenticated using(public.can_access_intervention(intervention_id));

create function public.save_artisan_profile(p_company_name text,p_siret text,p_legal_status text,p_employee_count integer,p_address text,p_postal_codes text[],p_categories text[])
returns public.artisan_profiles language plpgsql security definer set search_path='' as $$
declare result public.artisan_profiles;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='artisan') then raise insufficient_privilege; end if;
 if p_postal_codes is null or exists(select 1 from unnest(p_postal_codes) c where c is null or c !~ '^[0-9]{5}$') then raise invalid_parameter_value; end if;
 perform public.consume_action('artisan_profile',20);
 insert into public.artisan_profiles(user_id,company_name,siret,legal_status,employee_count,address,postal_codes,categories)
 values(auth.uid(),trim(p_company_name),p_siret,trim(p_legal_status),p_employee_count,trim(p_address),p_postal_codes,p_categories)
 on conflict(user_id) do update set company_name=excluded.company_name,siret=excluded.siret,legal_status=excluded.legal_status,
 employee_count=excluded.employee_count,address=excluded.address,postal_codes=excluded.postal_codes,categories=excluded.categories,
 -- Changing the dossier invalidates its approval, not the user's historical evidence.
 application_status='draft',available=false,submitted_at=null,updated_at=now() returning * into result;
 update public.profiles set artisan_approved=false where id=auth.uid();
 insert into public.audit_log(actor_id,action) values(auth.uid(),'artisan_profile_saved');
 return result;
end; $$;
create function public.submit_artisan_application() returns public.artisan_profiles language plpgsql security definer set search_path='' as $$
declare result public.artisan_profiles;
begin
 select * into result from public.artisan_profiles where user_id=auth.uid() for update;
 if not found then raise no_data_found; end if;
 if result.application_status not in ('draft','changes_requested') or char_length(trim(result.company_name))<1 or char_length(result.siret)<>14 or char_length(trim(result.address))<5 or cardinality(result.postal_codes)<1 or cardinality(result.categories)<1 then raise invalid_parameter_value; end if;
 perform public.consume_action('artisan_profile',20);
 update public.artisan_profiles set application_status='submitted',submitted_at=now(),updated_at=now() where user_id=auth.uid() returning * into result;
 insert into public.audit_log(actor_id,action) values(auth.uid(),'artisan_application_submitted');
 return result;
end; $$;
create function public.set_artisan_availability(p_available boolean) returns public.artisan_profiles language plpgsql security definer set search_path='' as $$
declare result public.artisan_profiles;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='artisan') or p_available is null then raise insufficient_privilege; end if;
 perform public.consume_action('artisan_profile',20);
 update public.artisan_profiles set available=p_available,updated_at=now() where user_id=auth.uid() returning * into result;
 if not found then raise no_data_found; end if;
 return result;
end; $$;
create function public.link_artisan_credential(p_document_id uuid,p_kind text,p_expires_on date) returns public.artisan_credentials language plpgsql security definer set search_path='' as $$
declare result public.artisan_credentials;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='artisan') or not exists(select 1 from public.documents where id=p_document_id and owner_id=auth.uid() and intervention_id is null) then raise insufficient_privilege; end if;
 perform public.consume_action('artisan_profile',20);
 insert into public.artisan_credentials(user_id,document_id,kind,expires_on) values(auth.uid(),p_document_id,p_kind,p_expires_on)
 on conflict(document_id) do update set kind=excluded.kind,expires_on=excluded.expires_on returning * into result;
 return result;
end; $$;

create or replace function public.approve_artisan(p_user_id uuid,p_approved boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 if p_approved is null then raise invalid_parameter_value; end if;
 if not exists(select 1 from public.profiles where id=p_user_id and role='artisan') then raise no_data_found; end if;
 if p_approved and not exists(select 1 from public.artisan_profiles where user_id=p_user_id and application_status in ('submitted','approved','suspended')) then raise exception 'Application must be submitted' using errcode='P0001'; end if;
 update public.profiles set artisan_approved=p_approved where id=p_user_id;
 update public.artisan_profiles set application_status=case when p_approved then 'approved' when application_status='approved' then 'suspended' else 'changes_requested' end,available=case when p_approved then available else false end,updated_at=now() where user_id=p_user_id;
 insert into public.audit_log(actor_id,action) values(auth.uid(),'artisan_approval:'||p_user_id::text||':'||p_approved::text);
end; $$;

create function public.mission_eligible(p_id uuid,p_artisan_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.interventions i join public.artisan_profiles a on a.user_id=p_artisan_id join public.profiles p on p.id=a.user_id
 where i.id=p_id and i.status='requested' and i.artisan_id is null and i.client_id<>p_artisan_id and p.role='artisan' and p.artisan_approved
 and a.application_status='approved' and a.available and i.postal_code=any(a.postal_codes) and i.category=any(a.categories)
 and not exists(select 1 from public.mission_declines d where d.intervention_id=i.id and d.artisan_id=p_artisan_id));
$$;
create or replace function public.available_missions() returns table(id uuid,category text,city text,postal_code text,urgency text,status text,estimate_min_cents integer,estimate_max_cents integer,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select i.id,i.category,i.city,left(i.postal_code,3)||'**',i.urgency,i.status,i.estimate_min_cents,i.estimate_max_cents,i.created_at
 from public.interventions i where public.mission_eligible(i.id,auth.uid()) order by i.created_at,i.id limit 100;
$$;
-- Preserve existing transaction/calculation code, exposing only the new guarded wrapper.
alter function public.intervention_action(uuid,text,jsonb,numeric) rename to intervention_action_base;
revoke execute on function public.intervention_action_base(uuid,text,jsonb,numeric) from public,anon,authenticated;
create function public.intervention_action(p_id uuid,p_action text,p_lines jsonb default null,p_tax_rate numeric default 20)
returns public.interventions language plpgsql security definer set search_path='' as $$
declare job public.interventions;
begin
 select * into job from public.interventions where id=p_id for update;
 if not found then raise no_data_found; end if;
 if p_action='accept_mission' and not public.mission_eligible(p_id,auth.uid()) then raise insufficient_privilege; end if;
 if p_action in ('send_quote','start','complete') and not exists(select 1 from public.profiles where id=auth.uid() and role='artisan' and artisan_approved) then raise insufficient_privilege; end if;
 return public.intervention_action_base(p_id,p_action,p_lines,p_tax_rate);
end; $$;

create function public.intervention_participants(p_id uuid) returns table(id uuid,full_name text,phone text,role text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_access_intervention(p_id) then raise insufficient_privilege; end if;
 -- Only actual participants; no organization directory or unassigned offers exposed.
 return query select p.id,p.full_name,p.phone,p.role from public.profiles p join public.interventions i on i.id=p_id
 where i.artisan_id is not null and (p.id=i.client_id or p.id=i.artisan_id);
end; $$;
create function public.decline_mission(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.interventions where id=p_id for update;
 if not public.mission_eligible(p_id,auth.uid()) then raise insufficient_privilege; end if;
 if p_reason is null or char_length(p_reason)>1000 then raise invalid_parameter_value; end if;
 perform public.consume_action('operations',30);
 insert into public.mission_declines(intervention_id,artisan_id,reason) values(p_id,auth.uid(),trim(p_reason));
 -- Do not put a private refusal reason into the client's shared audit timeline.
end; $$;
create function public.reject_intervention_quote(p_id uuid,p_quote_id uuid,p_reason text) returns public.interventions language plpgsql security definer set search_path='' as $$
declare job public.interventions;
begin
 select * into job from public.interventions where id=p_id for update;
 if not public.owns_intervention(p_id) then raise insufficient_privilege; end if;
 if job.status<>'quoted' or p_reason is null or char_length(trim(p_reason)) not between 1 and 2000 then raise invalid_parameter_value; end if;
 perform public.consume_action('operations',30);
 update public.quotes set status='rejected' where id=p_quote_id and intervention_id=p_id and status='sent';
 if not found then raise exception 'Quote superseded' using errcode='P0001'; end if;
 update public.interventions set status='assigned',updated_at=now() where id=p_id returning * into job;
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),p_id,'quote_rejected');
 insert into public.messages(intervention_id,author_id,body) values(p_id,auth.uid(),'Devis refusé : '||trim(p_reason));
 return job;
end; $$;
create function public.save_intervention_appointment(p_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_note text) returns public.intervention_appointments language plpgsql security definer set search_path='' as $$
declare job public.interventions; result public.intervention_appointments;
begin
 select * into job from public.interventions where id=p_id for update;
 if not coalesce((public.owns_intervention(p_id) or (job.artisan_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and artisan_approved))),false) then raise insufficient_privilege; end if;
 if job.status not in ('assigned','quoted','accepted') or p_starts_at<=now() or p_starts_at is null or p_ends_at is null or p_note is null then raise invalid_parameter_value; end if;
 perform public.consume_action('operations',30);
 insert into public.intervention_appointments(intervention_id,starts_at,ends_at,note,updated_by) values(p_id,p_starts_at,p_ends_at,p_note,auth.uid())
 on conflict(intervention_id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,note=excluded.note,updated_by=excluded.updated_by,updated_at=now() returning * into result;
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),p_id,'appointment_saved');
 return result;
end; $$;
create function public.set_travel_stage(p_id uuid,p_stage text) returns public.interventions language plpgsql security definer set search_path='' as $$
declare result public.interventions;
begin
 perform 1 from public.interventions where id=p_id for update;
 if not exists(select 1 from public.interventions i join public.profiles p on p.id=i.artisan_id where i.id=p_id and i.artisan_id=auth.uid() and p.artisan_approved and i.status in ('accepted','in_progress')) then raise insufficient_privilege; end if;
 perform public.consume_action('operations',30);
 update public.interventions set travel_stage=p_stage,updated_at=now() where id=p_id returning * into result;
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),p_id,'travel_'||p_stage);
 return result;
end; $$;
create function public.save_intervention_report(p_id uuid,p_summary text,p_checks jsonb,p_signature_name text) returns public.intervention_reports language plpgsql security definer set search_path='' as $$
declare result public.intervention_reports;
begin
 perform 1 from public.interventions where id=p_id for update;
 if not exists(select 1 from public.interventions i join public.profiles p on p.id=i.artisan_id where i.id=p_id and i.artisan_id=auth.uid() and p.artisan_approved and i.status in ('in_progress','completed','paid')) then raise insufficient_privilege; end if;
 if jsonb_typeof(p_checks) is distinct from 'array' or jsonb_array_length(p_checks)>50 or exists(select 1 from jsonb_array_elements(p_checks) x where jsonb_typeof(x)<>'object' or jsonb_typeof(x->'label') is distinct from 'string' or jsonb_typeof(x->'result') is distinct from 'string' or (x - array['label','result']::text[])<>'{}'::jsonb or char_length(trim(coalesce(x->>'label',''))) not between 1 and 160 or coalesce(x->>'result','') not in ('pass','issue','not_applicable')) then raise invalid_parameter_value; end if;
 perform public.consume_action('operations',30);
 insert into public.intervention_reports(intervention_id,artisan_id,summary,checks,signature_name) values(p_id,auth.uid(),trim(p_summary),p_checks,trim(p_signature_name))
 on conflict(intervention_id) do update set summary=excluded.summary,checks=excluded.checks,signature_name=excluded.signature_name,updated_at=now() returning * into result;
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),p_id,'report_saved');
 return result;
end; $$;
create function public.reassign_intervention(p_id uuid,p_artisan_id uuid,p_reason text) returns public.interventions language plpgsql security definer set search_path='' as $$
declare job public.interventions;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 select * into job from public.interventions where id=p_id for update;
 if not found then raise no_data_found; end if;
 if job.status not in ('requested','assigned','quoted') or p_reason is null or char_length(trim(p_reason)) not between 1 and 2000 then raise invalid_parameter_value; end if;
 if p_artisan_id is not null and not exists(select 1 from public.profiles p join public.artisan_profiles a on a.user_id=p.id where p.id=p_artisan_id and p.id<>job.client_id and p.role='artisan' and p.artisan_approved and a.application_status='approved' and a.available and job.postal_code=any(a.postal_codes) and job.category=any(a.categories) and not exists(select 1 from public.mission_declines d where d.intervention_id=job.id and d.artisan_id=p_artisan_id)) then raise insufficient_privilege; end if;
 update public.quotes set status='rejected' where intervention_id=p_id and status='sent';
 update public.interventions set artisan_id=p_artisan_id,status=case when p_artisan_id is null then 'requested' else 'assigned' end,travel_stage='planned',updated_at=now() where id=p_id returning * into job;
 delete from public.intervention_appointments where intervention_id=p_id;
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),p_id,'admin_reassigned');
 -- Operator reason is shared with participants and immutable in the message history.
 insert into public.messages(intervention_id,author_id,body) values(p_id,auth.uid(),'Réaffectation : '||trim(p_reason));
 return job;
end; $$;

create function public.admin_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 select jsonb_build_object(
 'counts',jsonb_build_object('interventions',(select count(*) from public.interventions),'active_interventions',(select count(*) from public.interventions where status not in ('paid','cancelled')),'artisans',(select count(*) from public.profiles where role='artisan'),'pending_applications',(select count(*) from public.artisan_profiles where application_status='submitted'),'clients',(select count(*) from public.profiles where role in ('client','manager')),'organizations',(select count(*) from public.organizations)),
 'financial',jsonb_build_object('paid_service_cents',(select coalesce(sum(total_cents),0) from public.payments where status='paid'),'currency','eur','platform_revenue_cents',null,'note','Montant des prestations payées, pas revenu net plateforme.'),
 'artisans',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select p.id,p.full_name,p.phone,p.artisan_approved,a.company_name,a.application_status from public.profiles p left join public.artisan_profiles a on a.user_id=p.id where p.role='artisan' order by p.created_at desc,p.id limit 100) x),
 'clients',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select id,full_name,phone,role,created_at from public.profiles where role in ('client','manager') order by created_at desc,id limit 100) x),
 'organizations',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select * from public.organizations order by created_at desc,id limit 100) x),
 'interventions',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select * from public.interventions order by created_at desc,id limit 100) x),
 'audit',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select * from public.audit_log order by id desc limit 100) x),
 'capabilities',jsonb_build_object('dispatch_before_quote_acceptance',true,'refunds',false,'invoices',false,'support_tickets',false,'list_limit',100)) into result;
 return result;
end; $$;

-- Keep snapshots of edited appointments/reports: current rows are conveniences, not erased evidence.
create table public.intervention_operation_events (
 id bigint generated always as identity primary key,
 intervention_id uuid not null references public.interventions(id),
 actor_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('appointment','report')),
 payload jsonb not null, created_at timestamptz not null default now()
);
alter table public.intervention_operation_events enable row level security;
revoke all on public.intervention_operation_events from public,anon,authenticated;
grant select on public.intervention_operation_events to authenticated;
grant all on public.intervention_operation_events to service_role;
grant usage,select on sequence public.intervention_operation_events_id_seq to service_role;
create policy operation_events_read on public.intervention_operation_events for select to authenticated using(public.can_access_intervention(intervention_id));
create function public.record_intervention_operation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.intervention_operation_events(intervention_id,actor_id,kind,payload)
 values(new.intervention_id,auth.uid(),case when tg_table_name='intervention_reports' then 'report' else 'appointment' end,to_jsonb(new));
 return new;
end; $$;
revoke execute on function public.record_intervention_operation() from public,anon,authenticated;
create trigger appointment_history after insert or update on public.intervention_appointments for each row execute function public.record_intervention_operation();
create trigger report_history after insert or update on public.intervention_reports for each row execute function public.record_intervention_operation();

revoke execute on function public.mission_eligible(uuid,uuid),public.save_artisan_profile(text,text,text,integer,text,text[],text[]),public.submit_artisan_application(),public.set_artisan_availability(boolean),public.link_artisan_credential(uuid,text,date),public.intervention_action(uuid,text,jsonb,numeric),public.intervention_participants(uuid),public.decline_mission(uuid,text),public.reject_intervention_quote(uuid,uuid,text),public.save_intervention_appointment(uuid,timestamptz,timestamptz,text),public.set_travel_stage(uuid,text),public.save_intervention_report(uuid,text,jsonb,text),public.reassign_intervention(uuid,uuid,text),public.admin_overview() from public,anon,authenticated;
grant execute on function public.save_artisan_profile(text,text,text,integer,text,text[],text[]),public.submit_artisan_application(),public.set_artisan_availability(boolean),public.link_artisan_credential(uuid,text,date),public.intervention_action(uuid,text,jsonb,numeric),public.intervention_participants(uuid),public.decline_mission(uuid,text),public.reject_intervention_quote(uuid,uuid,text),public.save_intervention_appointment(uuid,timestamptz,timestamptz,text),public.set_travel_stage(uuid,text),public.save_intervention_report(uuid,text,jsonb,text),public.reassign_intervention(uuid,uuid,text),public.admin_overview() to authenticated;
create or replace function public.submit_review(p_intervention_id uuid,p_rating integer,p_body text) returns public.reviews language plpgsql security definer set search_path='' as $$
declare result public.reviews;
begin
 if not public.can_access_intervention(p_intervention_id) or not exists(select 1 from public.interventions where id=p_intervention_id and client_id=auth.uid() and status='paid') then raise insufficient_privilege; end if;
 insert into public.reviews(intervention_id,author_id,rating,body) values(p_intervention_id,auth.uid(),p_rating,trim(p_body)) returning * into result;
 return result;
end; $$;


create or replace function public.request_warranty(p_intervention_id uuid,p_description text) returns public.warranty_cases language plpgsql security definer set search_path='' as $$
declare result public.warranty_cases;
begin
 if not public.warranty_requests_enabled() then raise exception 'Commercial warranty terms not enabled' using errcode='P0001'; end if;
 if not public.can_access_intervention(p_intervention_id) or not exists(select 1 from public.interventions where id=p_intervention_id and client_id=auth.uid() and status='paid' and completed_at is not null and completed_at+interval '1 year'>=now()) then raise insufficient_privilege; end if;
 perform public.consume_action('warranty',5);
 insert into public.warranty_cases(intervention_id,client_id,description) values(p_intervention_id,auth.uid(),trim(p_description)) returning * into result;
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),p_intervention_id,'warranty_requested');
 return result;
end; $$;

commit;
