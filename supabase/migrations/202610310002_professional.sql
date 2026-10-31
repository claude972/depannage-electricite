-- Practical B2B tools: approvals, contracts and follow-up records. None certify legal compliance.
begin;
create table public.approval_rules (
 site_id uuid primary key references public.sites(id) on delete cascade,
 threshold_cents integer not null check(threshold_cents between 0 and 100000000),
 required_role text not null check(required_role in ('owner','manager')),
 enabled boolean not null default true, updated_at timestamptz not null default now()
);
create table public.approvals (
 id uuid primary key default gen_random_uuid(), quote_id uuid not null unique references public.quotes(id),
 site_id uuid not null references public.sites(id), status text not null default 'pending' check(status in ('pending','approved','rejected')),
 decided_by uuid references public.profiles(id), note text not null default '' check(char_length(note)<=2000),
 created_at timestamptz not null default now(), decided_at timestamptz
);
create table public.contracts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 title text not null check(char_length(trim(title)) between 1 and 160), reference text not null default '' check(char_length(reference)<=160),
 starts_on date not null, ends_on date check(ends_on>=starts_on), terms text not null default '' check(char_length(terms)<=8000),
 status text not null check(status in ('draft','active','archived')), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.compliance_records (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id),
 title text not null check(char_length(trim(title)) between 1 and 160),
 kind text not null check(kind in ('audit','maintenance','safety','equipment','contract')),
 due_on date not null, status text not null check(status in ('pending','scheduled','completed')),
 notes text not null default '' check(char_length(notes)<=4000), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.professional_audit (
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id),
 actor_id uuid not null references public.profiles(id), subject_id uuid not null, action text not null,
 created_at timestamptz not null default now()
);
create table public.app_settings (key text primary key, value jsonb not null);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from public,anon,authenticated;
grant all on public.app_settings to service_role;
insert into public.app_settings(key,value) values('warranty_requests_enabled','false');
create function public.warranty_requests_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_settings where key='warranty_requests_enabled' and value='true'::jsonb);
$$;
revoke execute on function public.warranty_requests_enabled() from public,anon,authenticated;
grant execute on function public.warranty_requests_enabled() to authenticated;

create table public.warranty_cases (
 id uuid primary key default gen_random_uuid(), intervention_id uuid not null references public.interventions(id),
 client_id uuid not null references public.profiles(id), description text not null check(char_length(description) between 10 and 4000),
 status text not null default 'submitted' check(status in ('submitted','reviewing','resolved','declined')),
 resolution text not null default '' check(char_length(resolution)<=4000), created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index warranty_active on public.warranty_cases(intervention_id) where status in ('submitted','reviewing');
create index compliance_due on public.compliance_records(site_id,due_on);

alter table public.approval_rules enable row level security;
alter table public.approvals enable row level security;
alter table public.contracts enable row level security;
alter table public.compliance_records enable row level security;
alter table public.professional_audit enable row level security;
alter table public.warranty_cases enable row level security;
revoke all on public.approval_rules,public.approvals,public.contracts,public.compliance_records,public.professional_audit,public.warranty_cases from public,anon,authenticated;
grant select on public.approval_rules,public.approvals,public.contracts,public.compliance_records,public.professional_audit,public.warranty_cases to authenticated;
grant all on public.approval_rules,public.approvals,public.contracts,public.compliance_records,public.professional_audit,public.warranty_cases to service_role;
grant usage,select on sequence public.professional_audit_id_seq to service_role;
create policy rules_read on public.approval_rules for select to authenticated using(exists(select 1 from public.sites s where s.id=site_id and public.is_org_member(s.organization_id)) or public.is_admin());
create policy approvals_read on public.approvals for select to authenticated using(exists(select 1 from public.sites s where s.id=site_id and public.is_org_member(s.organization_id)) or public.is_admin());
create policy contracts_read on public.contracts for select to authenticated using(public.is_org_member(organization_id) or public.is_admin());
create policy compliance_read on public.compliance_records for select to authenticated using(exists(select 1 from public.sites s where s.id=site_id and public.is_org_member(s.organization_id)) or public.is_admin());
create policy professional_audit_read on public.professional_audit for select to authenticated using(public.is_org_member(organization_id) or public.is_admin());
create policy warranty_read on public.warranty_cases for select to authenticated using(public.can_access_intervention(intervention_id));

create function public.queue_quote_approval() returns trigger language plpgsql security definer set search_path='' as $$
declare site uuid;
begin
 select site_id into site from public.interventions where id=new.intervention_id;
 if exists(select 1 from public.approval_rules where site_id=site and enabled and new.total_cents>threshold_cents) then
  insert into public.approvals(quote_id,site_id) values(new.id,site);
 end if;
 return new;
end; $$;
create trigger quote_approval_queue after insert on public.quotes for each row execute function public.queue_quote_approval();
create function public.guard_quote_approval() returns trigger language plpgsql security definer set search_path='' as $$
declare site uuid;
begin
 if new.status='accepted' and old.status is distinct from 'accepted' then
  select site_id into site from public.interventions where id=new.intervention_id;
  if exists(select 1 from public.approval_rules where site_id=site and enabled and new.total_cents>threshold_cents)
   and not exists(select 1 from public.approvals where quote_id=new.id and status='approved') then
   raise exception 'Approval required' using errcode='P0001';
  end if;
 end if;
 return new;
end; $$;
create trigger quote_approval_guard before update on public.quotes for each row execute function public.guard_quote_approval();

create function public.set_approval_rule(p_site_id uuid,p_threshold_cents integer,p_required_role text,p_enabled boolean) returns public.approval_rules language plpgsql security definer set search_path='' as $$
declare org uuid; result public.approval_rules;
begin
 select organization_id into org from public.sites where id=p_site_id;
 -- Only an organization owner can choose its approval authority.
 if not exists(select 1 from public.organization_members where organization_id=org and user_id=auth.uid() and role='owner') then raise insufficient_privilege; end if;
 perform public.consume_action('professional',20);
 insert into public.approval_rules(site_id,threshold_cents,required_role,enabled) values(p_site_id,p_threshold_cents,p_required_role,p_enabled)
 on conflict(site_id) do update set threshold_cents=excluded.threshold_cents,required_role=excluded.required_role,enabled=excluded.enabled,updated_at=now() returning * into result;
 -- New rules apply to quotes still awaiting acceptance, never retroactively to accepted work.
 insert into public.approvals(quote_id,site_id)
 select q.id,p_site_id from public.quotes q join public.interventions i on i.id=q.intervention_id
 where i.site_id=p_site_id and q.status='sent' and p_enabled and q.total_cents>p_threshold_cents on conflict(quote_id) do nothing;
 update public.approvals a set status='pending',decided_by=null,decided_at=null,note='' from public.quotes q where q.id=a.quote_id and q.status='sent' and a.site_id=p_site_id and p_enabled and q.total_cents>p_threshold_cents;
 insert into public.professional_audit(organization_id,actor_id,subject_id,action) values(org,auth.uid(),p_site_id,'approval_rule_updated');
 return result;
end; $$;

create function public.decide_approval(p_approval_id uuid,p_decision text,p_note text) returns public.approvals language plpgsql security definer set search_path='' as $$
declare result public.approvals; org uuid; required text;
begin
 select * into result from public.approvals where id=p_approval_id for update;
 if not found then raise no_data_found; end if;
 select s.organization_id,r.required_role into org,required from public.sites s join public.approval_rules r on r.site_id=s.id where s.id=result.site_id;
 if not exists(select 1 from public.organization_members where organization_id=org and user_id=auth.uid() and (role='owner' or (role='manager' and required='manager'))) then raise insufficient_privilege; end if;
 if p_decision is null or p_decision not in ('approved','rejected') or p_note is null or char_length(p_note)>2000 then raise invalid_parameter_value; end if;
 if result.status<>'pending' or not exists(select 1 from public.quotes where id=result.quote_id and status='sent') then raise exception 'Decision already made or quote superseded' using errcode='P0001'; end if;
 perform public.consume_action('professional',20);
 update public.approvals set status=p_decision,note=p_note,decided_by=auth.uid(),decided_at=now() where id=p_approval_id returning * into result;
 insert into public.professional_audit(organization_id,actor_id,subject_id,action) values(org,auth.uid(),p_approval_id,'quote_'||p_decision);
 return result;
end; $$;

create function public.save_contract(p_organization_id uuid,p_title text,p_reference text,p_starts_on date,p_ends_on date,p_terms text,p_status text,p_id uuid default null)
returns public.contracts language plpgsql security definer set search_path='' as $$
declare result public.contracts;
begin
 if not public.is_org_member(p_organization_id,true) then raise insufficient_privilege; end if;
 perform public.consume_action('professional',20);
 if p_id is null then
  insert into public.contracts(organization_id,title,reference,starts_on,ends_on,terms,status,created_by) values(p_organization_id,trim(p_title),p_reference,p_starts_on,p_ends_on,p_terms,p_status,auth.uid()) returning * into result;
 else
  update public.contracts set title=trim(p_title),reference=p_reference,starts_on=p_starts_on,ends_on=p_ends_on,terms=p_terms,status=p_status,updated_at=now() where id=p_id and organization_id=p_organization_id returning * into result;
  if not found then raise no_data_found; end if;
 end if;
 insert into public.professional_audit(organization_id,actor_id,subject_id,action) values(p_organization_id,auth.uid(),result.id,'contract_saved');
 return result;
end; $$;

create function public.save_compliance(p_site_id uuid,p_title text,p_kind text,p_due_on date,p_status text,p_notes text,p_id uuid default null)
returns public.compliance_records language plpgsql security definer set search_path='' as $$
declare org uuid; result public.compliance_records;
begin
 select organization_id into org from public.sites where id=p_site_id;
 if not public.is_org_member(org,true) then raise insufficient_privilege; end if;
 perform public.consume_action('professional',20);
 if p_id is null then
  insert into public.compliance_records(site_id,title,kind,due_on,status,notes,created_by) values(p_site_id,trim(p_title),p_kind,p_due_on,p_status,p_notes,auth.uid()) returning * into result;
 else
  update public.compliance_records set title=trim(p_title),kind=p_kind,due_on=p_due_on,status=p_status,notes=p_notes,updated_at=now() where id=p_id and site_id=p_site_id returning * into result;
  if not found then raise no_data_found; end if;
 end if;
 insert into public.professional_audit(organization_id,actor_id,subject_id,action) values(org,auth.uid(),result.id,'site_record_saved');
 return result;
end; $$;

create function public.set_site_budget(p_site_id uuid,p_budget_cents integer) returns public.sites language plpgsql security definer set search_path='' as $$
declare org uuid; result public.sites;
begin
 select organization_id into org from public.sites where id=p_site_id;
 if not public.is_org_member(org,true) then raise insufficient_privilege; end if;
 perform public.consume_action('professional',20);
 update public.sites set budget_cents=p_budget_cents where id=p_site_id returning * into result;
 insert into public.professional_audit(organization_id,actor_id,subject_id,action) values(org,auth.uid(),p_site_id,'budget_updated');
 return result;
end; $$;

create function public.request_warranty(p_intervention_id uuid,p_description text) returns public.warranty_cases language plpgsql security definer set search_path='' as $$
declare result public.warranty_cases;
begin
 if not public.warranty_requests_enabled() then raise exception 'Commercial warranty terms not enabled' using errcode='P0001'; end if;
 if not exists(select 1 from public.interventions where id=p_intervention_id and client_id=auth.uid() and status='paid' and completed_at is not null and completed_at+interval '1 year'>=now()) then raise insufficient_privilege; end if;
 perform public.consume_action('warranty',5);
 insert into public.warranty_cases(intervention_id,client_id,description) values(p_intervention_id,auth.uid(),trim(p_description)) returning * into result;
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),p_intervention_id,'warranty_requested');
 return result;
end; $$;
create function public.resolve_warranty(p_case_id uuid,p_status text,p_resolution text) returns public.warranty_cases language plpgsql security definer set search_path='' as $$
declare result public.warranty_cases;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 if p_status is null or p_status not in ('reviewing','resolved','declined') then raise invalid_parameter_value; end if;
 update public.warranty_cases set status=p_status,resolution=p_resolution,updated_at=now() where id=p_case_id returning * into result;
 if not found then raise no_data_found; end if;
 insert into public.audit_log(actor_id,intervention_id,action) values(auth.uid(),result.intervention_id,'warranty_'||p_status);
 return result;
end; $$;

revoke execute on function public.queue_quote_approval(),public.guard_quote_approval(),public.set_approval_rule(uuid,integer,text,boolean),public.decide_approval(uuid,text,text),public.save_contract(uuid,text,text,date,date,text,text,uuid),public.save_compliance(uuid,text,text,date,text,text,uuid),public.set_site_budget(uuid,integer),public.request_warranty(uuid,text),public.resolve_warranty(uuid,text,text) from public,anon,authenticated;
grant execute on function public.set_approval_rule(uuid,integer,text,boolean),public.decide_approval(uuid,text,text),public.save_contract(uuid,text,text,date,date,text,text,uuid),public.save_compliance(uuid,text,text,date,text,text,uuid),public.set_site_budget(uuid,integer),public.request_warranty(uuid,text),public.resolve_warranty(uuid,text,text) to authenticated;
-- One SQL statement provides an internally consistent RLS-scoped report. No browser-side
-- aggregation of truncated PostgREST intervention pages is used for money totals.
create function public.professional_report(p_site_id uuid default null)
returns table(site_id uuid,name text,type text,budget_cents integer,paid_cents bigint,committed_cents bigint,interventions bigint)
language sql stable security invoker set search_path='' as $$
 select s.id,s.name,s.type,s.budget_cents,
  coalesce(sum(q.total_cents) filter(where i.status='paid'),0)::bigint,
  coalesce(sum(q.total_cents) filter(where i.status in ('accepted','in_progress','completed')),0)::bigint,
  count(distinct i.id)
 from public.sites s
 left join public.interventions i on i.site_id=s.id
 left join public.quotes q on q.intervention_id=i.id and q.status='accepted'
 where (p_site_id is null or s.id=p_site_id)
 group by s.id,s.name,s.type,s.budget_cents order by s.id;
$$;
revoke execute on function public.professional_report(uuid) from public,anon,authenticated;
grant execute on function public.professional_report(uuid) to authenticated;

-- Existing Supabase publication only. Test PostgreSQL stubs without one safely skip.
do $$
declare relation_name text;
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach relation_name in array array['interventions','quotes','messages'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=relation_name) then
    execute format('alter publication supabase_realtime add table public.%I',relation_name);
   end if;
  end loop;
 end if;
end; $$;
commit;
