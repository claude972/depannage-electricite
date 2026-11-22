-- ADV-B2B-OPERATIONS-001: equipment, maintenance plans, budgets per fiscal year, versioned
-- contract grids, configurable SLA tracking facts and declarative ERP (public establishment)
-- checklists. Additive only; depends on 001-013 (sites, memberships, site access helpers).
-- Nothing here certifies a regulation, invents a rate, a delay or a calendar: every value is
-- entered by the organisation; absence stays explicit (null) and is reported as not measurable.
begin;

-- ---------------------------------------------------------------- tables
create table public.site_equipment (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id),
 name text not null check(char_length(name) between 1 and 160),
 category text not null check(category in ('panel','lighting','emergency_lighting','fire_safety','hvac','generator','ups','other')),
 criticality text not null check(criticality in ('low','medium','high','critical')),
 location text not null default '' check(char_length(location)<=160),
 reference text not null default '' check(char_length(reference)<=160),
 installed_on date, status text not null check(status in ('in_service','degraded','out_of_service','retired')),
 notes text not null default '' check(char_length(notes)<=4000),
 version integer not null default 1 check(version>=1), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index site_equipment_site on public.site_equipment(site_id,updated_at desc);
create table public.site_maintenance_plans (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id),
 equipment_id uuid references public.site_equipment(id),
 title text not null check(char_length(title) between 1 and 160),
 frequency_kind text not null check(frequency_kind in ('none','days','weeks','months')),
 frequency_value integer check(frequency_value between 1 and 3650),
 next_due_on date, last_done_on date,
 status text not null check(status in ('active','paused','archived')),
 notes text not null default '' check(char_length(notes)<=4000),
 version integer not null default 1 check(version>=1), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((frequency_kind='none' and frequency_value is null) or (frequency_kind<>'none' and frequency_value is not null))
);
create index site_maintenance_plans_site on public.site_maintenance_plans(site_id,updated_at desc);
create table public.site_maintenance_visits (
 id uuid primary key default gen_random_uuid(), plan_id uuid not null references public.site_maintenance_plans(id),
 site_id uuid not null references public.sites(id), done_on date not null,
 intervention_id uuid references public.interventions(id),
 summary text not null default '' check(char_length(summary)<=4000),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create index site_maintenance_visits_plan on public.site_maintenance_visits(plan_id,done_on desc,id desc);
create table public.organization_fiscal_years (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 label text not null check(char_length(label) between 1 and 80),
 starts_on date not null, ends_on date not null check(ends_on>=starts_on),
 status text not null check(status in ('open','closed')),
 version integer not null default 1 check(version>=1), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index organization_fiscal_years_org on public.organization_fiscal_years(organization_id,starts_on desc);
create table public.site_budget_lines (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id),
 fiscal_year_id uuid not null references public.organization_fiscal_years(id),
 category text not null check(category in ('maintenance','repairs','compliance','equipment','other')),
 amount_cents integer not null check(amount_cents between 0 and 100000000),
 note text not null default '' check(char_length(note)<=1000),
 version integer not null default 1 check(version>=1), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(site_id,fiscal_year_id,category)
);
create table public.organization_contract_grids (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 lineage_id uuid not null, version_number integer not null check(version_number>=1),
 label text not null check(char_length(label) between 1 and 160),
 contract_id uuid references public.contracts(id), effective_from date,
 currency text not null default 'EUR' check(currency='EUR'),
 status text not null check(status in ('draft','published','superseded')), published_at timestamptz,
 lines jsonb not null default '[]'::jsonb check(jsonb_typeof(lines)='array' and jsonb_array_length(lines)<=100),
 version integer not null default 1 check(version>=1), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(lineage_id,version_number)
);
create index organization_contract_grids_org on public.organization_contract_grids(organization_id,lineage_id,version_number desc);
create table public.organization_sla_calendars (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(char_length(name) between 1 and 160),
 timezone text not null check(char_length(timezone) between 1 and 64),
 windows jsonb not null default '[]'::jsonb check(jsonb_typeof(windows)='array' and jsonb_array_length(windows)<=21),
 closed_dates jsonb not null default '[]'::jsonb check(jsonb_typeof(closed_dates)='array' and jsonb_array_length(closed_dates)<=366),
 version integer not null default 1 check(version>=1), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index organization_sla_calendars_org on public.organization_sla_calendars(organization_id,updated_at desc);
create table public.site_sla_policies (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id),
 name text not null check(char_length(name) between 1 and 160),
 calendar_id uuid references public.organization_sla_calendars(id),
 urgency text check(urgency in ('urgent','scheduled')),
 response_target_minutes integer check(response_target_minutes between 1 and 525600),
 resolution_target_minutes integer check(resolution_target_minutes between 1 and 525600),
 status text not null check(status in ('active','archived')),
 version integer not null default 1 check(version>=1), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index site_sla_policies_site on public.site_sla_policies(site_id,updated_at desc);
create table public.site_sla_cases (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id),
 policy_id uuid not null references public.site_sla_policies(id),
 intervention_id uuid references public.interventions(id),
 reference text not null default '' check(char_length(reference)<=160),
 opened_at timestamptz not null, responded_at timestamptz check(responded_at is null or responded_at>=opened_at),
 resolved_at timestamptz check(resolved_at is null or (resolved_at>=opened_at and (responded_at is null or resolved_at>=responded_at))),
 notes text not null default '' check(char_length(notes)<=4000),
 version integer not null default 1 check(version>=1), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index site_sla_cases_site on public.site_sla_cases(site_id,opened_at desc,id desc);
create table public.site_sla_pauses (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references public.site_sla_cases(id),
 site_id uuid not null references public.sites(id),
 started_at timestamptz not null, ended_at timestamptz check(ended_at is null or ended_at>=started_at),
 reason text not null default '' check(char_length(reason)<=400),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create unique index site_sla_pauses_open on public.site_sla_pauses(case_id) where ended_at is null;
create index site_sla_pauses_case on public.site_sla_pauses(case_id,started_at);
create table public.site_erp_checklists (
 id uuid primary key default gen_random_uuid(), site_id uuid not null references public.sites(id),
 title text not null check(char_length(title) between 1 and 160),
 -- Declarative by construction: a checklist filled by the organisation is never a certification.
 nature text not null default 'declarative' check(nature='declarative'),
 description text not null default '' check(char_length(description)<=4000),
 performed_on date, performed_by_label text not null default '' check(char_length(performed_by_label)<=160),
 status text not null check(status in ('draft','completed','archived')),
 items jsonb not null default '[]'::jsonb check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=200),
 version integer not null default 1 check(version>=1), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index site_erp_checklists_site on public.site_erp_checklists(site_id,updated_at desc);
create table public.site_operations_events (
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id),
 site_id uuid references public.sites(id), actor_id uuid not null references public.profiles(id),
 entity text not null check(entity in ('equipment','maintenance_plan','maintenance_visit','fiscal_year','budget_line','contract_grid','sla_calendar','sla_policy','sla_case','sla_pause','erp_checklist')),
 entity_id uuid not null, action text not null check(action in ('created','updated','published','recorded','paused','resumed')),
 version integer not null check(version>=1), snapshot jsonb not null, created_at timestamptz not null default now()
);
create index site_operations_events_site on public.site_operations_events(site_id,id desc);
create index site_operations_events_org on public.site_operations_events(organization_id,id desc);

-- ---------------------------------------------------------------- RLS: select only, writes via RPC
alter table public.site_equipment enable row level security;
alter table public.site_maintenance_plans enable row level security;
alter table public.site_maintenance_visits enable row level security;
alter table public.organization_fiscal_years enable row level security;
alter table public.site_budget_lines enable row level security;
alter table public.organization_contract_grids enable row level security;
alter table public.organization_sla_calendars enable row level security;
alter table public.site_sla_policies enable row level security;
alter table public.site_sla_cases enable row level security;
alter table public.site_sla_pauses enable row level security;
alter table public.site_erp_checklists enable row level security;
alter table public.site_operations_events enable row level security;
revoke all on public.site_equipment,public.site_maintenance_plans,public.site_maintenance_visits,public.organization_fiscal_years,public.site_budget_lines,public.organization_contract_grids,public.organization_sla_calendars,public.site_sla_policies,public.site_sla_cases,public.site_sla_pauses,public.site_erp_checklists,public.site_operations_events from public,anon,authenticated;
grant select on public.site_equipment,public.site_maintenance_plans,public.site_maintenance_visits,public.organization_fiscal_years,public.site_budget_lines,public.organization_contract_grids,public.organization_sla_calendars,public.site_sla_policies,public.site_sla_cases,public.site_sla_pauses,public.site_erp_checklists,public.site_operations_events to authenticated;
grant all on public.site_equipment,public.site_maintenance_plans,public.site_maintenance_visits,public.organization_fiscal_years,public.site_budget_lines,public.organization_contract_grids,public.organization_sla_calendars,public.site_sla_policies,public.site_sla_cases,public.site_sla_pauses,public.site_erp_checklists,public.site_operations_events to service_role;
grant usage,select on sequence public.site_operations_events_id_seq to service_role;
create policy site_equipment_read on public.site_equipment for select to authenticated using(public.can_access_site(site_id));
create policy site_maintenance_plans_read on public.site_maintenance_plans for select to authenticated using(public.can_access_site(site_id));
create policy site_maintenance_visits_read on public.site_maintenance_visits for select to authenticated using(public.can_access_site(site_id));
create policy site_budget_lines_read on public.site_budget_lines for select to authenticated using(public.can_access_site(site_id));
create policy site_sla_policies_read on public.site_sla_policies for select to authenticated using(public.can_access_site(site_id));
create policy site_sla_cases_read on public.site_sla_cases for select to authenticated using(public.can_access_site(site_id));
create policy site_sla_pauses_read on public.site_sla_pauses for select to authenticated using(public.can_access_site(site_id));
create policy site_erp_checklists_read on public.site_erp_checklists for select to authenticated using(public.can_access_site(site_id));
-- Organisation configuration needed to display a site (no site data inside): any member.
create policy organization_fiscal_years_read on public.organization_fiscal_years for select to authenticated using(public.is_org_member(organization_id) or public.is_admin());
create policy organization_sla_calendars_read on public.organization_sla_calendars for select to authenticated using(public.is_org_member(organization_id) or public.is_admin());
-- Contractual amounts follow the contracts policy (organisation-wide readers only).
create policy organization_contract_grids_read on public.organization_contract_grids for select to authenticated using(public.can_access_organization_wide(organization_id) or public.is_admin());
create policy site_operations_events_read on public.site_operations_events for select to authenticated using(case when site_id is null then public.can_access_organization_wide(organization_id) or public.is_admin() else public.can_access_site(site_id) end);

-- ---------------------------------------------------------------- private payload helpers
create function public.so_keys(p jsonb,p_keys text[]) returns void language plpgsql immutable set search_path='' as $$
begin
 if p is null or jsonb_typeof(p)<>'object' or (p-p_keys)<>'{}'::jsonb then raise invalid_parameter_value; end if;
end; $$;
create function public.so_text(p jsonb,k text,p_min integer,p_max integer) returns text language plpgsql immutable set search_path='' as $$
declare v text;
begin
 if p->k is null or jsonb_typeof(p->k)='null' then if p_min>0 then raise invalid_parameter_value; end if; return ''; end if;
 if jsonb_typeof(p->k)<>'string' then raise invalid_parameter_value; end if;
 v=trim(p->>k);
 if char_length(v)<p_min or char_length(v)>p_max then raise invalid_parameter_value; end if;
 return v;
end; $$;
create function public.so_int(p jsonb,k text,p_min integer,p_max integer,p_required boolean) returns integer language plpgsql immutable set search_path='' as $$
declare v numeric;
begin
 if p->k is null or jsonb_typeof(p->k)='null' then if p_required then raise invalid_parameter_value; end if; return null; end if;
 if jsonb_typeof(p->k)<>'number' then raise invalid_parameter_value; end if;
 v=(p->>k)::numeric;
 if v<>floor(v) or v<p_min or v>p_max then raise invalid_parameter_value; end if;
 return v::integer;
end; $$;
create function public.so_enum(p jsonb,k text,p_allowed text[],p_required boolean) returns text language plpgsql immutable set search_path='' as $$
begin
 if p->k is null or jsonb_typeof(p->k)='null' then if p_required then raise invalid_parameter_value; end if; return null; end if;
 if jsonb_typeof(p->k)<>'string' or not ((p->>k)=any(p_allowed)) then raise invalid_parameter_value; end if;
 return p->>k;
end; $$;
create function public.so_date(p jsonb,k text,p_required boolean) returns date language plpgsql immutable set search_path='' as $$
begin
 if p->k is null or jsonb_typeof(p->k)='null' then if p_required then raise invalid_parameter_value; end if; return null; end if;
 if jsonb_typeof(p->k)<>'string' or (p->>k)!~'^\d{4}-\d{2}-\d{2}$' then raise invalid_parameter_value; end if;
 return (p->>k)::date;
end; $$;
create function public.so_ts(p jsonb,k text,p_required boolean) returns timestamptz language plpgsql immutable set search_path='' as $$
begin
 if p->k is null or jsonb_typeof(p->k)='null' then if p_required then raise invalid_parameter_value; end if; return null; end if;
 if jsonb_typeof(p->k)<>'string' or (p->>k)!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise invalid_parameter_value; end if;
 return (p->>k)::timestamptz;
end; $$;
create function public.so_uuid(p jsonb,k text,p_required boolean) returns uuid language plpgsql immutable set search_path='' as $$
begin
 if p->k is null or jsonb_typeof(p->k)='null' then if p_required then raise invalid_parameter_value; end if; return null; end if;
 if jsonb_typeof(p->k)<>'string' or (p->>k)!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise invalid_parameter_value; end if;
 return (p->>k)::uuid;
end; $$;
-- Locks the organisation row first (shared order with 009/013), then re-checks organisation-wide write.
create function public.so_lock_organization(p_organization_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.organizations where id=p_organization_id for update;
 if not public.can_access_organization_wide(p_organization_id,true) then raise insufficient_privilege; end if;
end; $$;
create function public.so_site_organization(p_site_id uuid) returns uuid language sql stable security definer set search_path='' as $$
 select organization_id from public.sites where id=p_site_id;
$$;
create function public.so_version(p_current integer,p_expected integer) returns void language plpgsql immutable set search_path='' as $$
begin
 if p_expected is null or p_current<>p_expected then raise exception 'Version mismatch' using errcode='P0001'; end if;
end; $$;
create function public.so_log(p_organization_id uuid,p_site_id uuid,p_entity text,p_entity_id uuid,p_action text,p_version integer,p_snapshot jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.site_operations_events(organization_id,site_id,actor_id,entity,entity_id,action,version,snapshot) values(p_organization_id,p_site_id,auth.uid(),p_entity,p_entity_id,p_action,p_version,p_snapshot);
end; $$;

-- ---------------------------------------------------------------- equipment
create function public.save_site_equipment(p_site_id uuid,p_payload jsonb,p_id uuid default null,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; rec public.site_equipment;
begin
 perform public.lock_site_access(p_site_id); org=public.so_site_organization(p_site_id);
 perform public.so_keys(p_payload,array['name','category','criticality','location','reference','installed_on','status','notes']);
 perform public.consume_action('site_operations',60);
 if p_id is null then
  insert into public.site_equipment(site_id,name,category,criticality,location,reference,installed_on,status,notes,created_by)
  values(p_site_id,public.so_text(p_payload,'name',1,160),public.so_enum(p_payload,'category',array['panel','lighting','emergency_lighting','fire_safety','hvac','generator','ups','other'],true),
   public.so_enum(p_payload,'criticality',array['low','medium','high','critical'],true),public.so_text(p_payload,'location',0,160),public.so_text(p_payload,'reference',0,160),
   public.so_date(p_payload,'installed_on',false),public.so_enum(p_payload,'status',array['in_service','degraded','out_of_service','retired'],true),public.so_text(p_payload,'notes',0,4000),auth.uid())
  returning * into rec;
  perform public.so_log(org,p_site_id,'equipment',rec.id,'created',rec.version,to_jsonb(rec));
 else
  select * into rec from public.site_equipment where id=p_id and site_id=p_site_id for update;
  if not found then raise no_data_found; end if;
  perform public.so_version(rec.version,p_expected_version);
  update public.site_equipment set name=public.so_text(p_payload,'name',1,160),category=public.so_enum(p_payload,'category',array['panel','lighting','emergency_lighting','fire_safety','hvac','generator','ups','other'],true),
   criticality=public.so_enum(p_payload,'criticality',array['low','medium','high','critical'],true),location=public.so_text(p_payload,'location',0,160),reference=public.so_text(p_payload,'reference',0,160),
   installed_on=public.so_date(p_payload,'installed_on',false),status=public.so_enum(p_payload,'status',array['in_service','degraded','out_of_service','retired'],true),notes=public.so_text(p_payload,'notes',0,4000),
   version=version+1,updated_at=now() where id=p_id returning * into rec;
  perform public.so_log(org,p_site_id,'equipment',rec.id,'updated',rec.version,to_jsonb(rec));
 end if;
 return to_jsonb(rec);
end; $$;

-- ---------------------------------------------------------------- maintenance
create function public.save_maintenance_plan(p_site_id uuid,p_payload jsonb,p_id uuid default null,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; rec public.site_maintenance_plans; equipment uuid; kind text; freq_value integer;
begin
 perform public.lock_site_access(p_site_id); org=public.so_site_organization(p_site_id);
 perform public.so_keys(p_payload,array['equipment_id','title','frequency_kind','frequency_value','next_due_on','last_done_on','status','notes']);
 equipment=public.so_uuid(p_payload,'equipment_id',false);
 if equipment is not null and not exists(select 1 from public.site_equipment where id=equipment and site_id=p_site_id) then raise insufficient_privilege; end if;
 kind=public.so_enum(p_payload,'frequency_kind',array['none','days','weeks','months'],true);
 freq_value=public.so_int(p_payload,'frequency_value',1,3650,kind<>'none');
 if kind='none' and freq_value is not null then raise invalid_parameter_value; end if;
 perform public.consume_action('site_operations',60);
 if p_id is null then
  insert into public.site_maintenance_plans(site_id,equipment_id,title,frequency_kind,frequency_value,next_due_on,last_done_on,status,notes,created_by)
  values(p_site_id,equipment,public.so_text(p_payload,'title',1,160),kind,freq_value,public.so_date(p_payload,'next_due_on',false),public.so_date(p_payload,'last_done_on',false),
   public.so_enum(p_payload,'status',array['active','paused','archived'],true),public.so_text(p_payload,'notes',0,4000),auth.uid()) returning * into rec;
  perform public.so_log(org,p_site_id,'maintenance_plan',rec.id,'created',rec.version,to_jsonb(rec));
 else
  select * into rec from public.site_maintenance_plans where id=p_id and site_id=p_site_id for update;
  if not found then raise no_data_found; end if;
  perform public.so_version(rec.version,p_expected_version);
  update public.site_maintenance_plans set equipment_id=equipment,title=public.so_text(p_payload,'title',1,160),frequency_kind=kind,frequency_value=freq_value,
   next_due_on=public.so_date(p_payload,'next_due_on',false),last_done_on=public.so_date(p_payload,'last_done_on',false),
   status=public.so_enum(p_payload,'status',array['active','paused','archived'],true),notes=public.so_text(p_payload,'notes',0,4000),version=version+1,updated_at=now()
  where id=p_id returning * into rec;
  perform public.so_log(org,p_site_id,'maintenance_plan',rec.id,'updated',rec.version,to_jsonb(rec));
 end if;
 return to_jsonb(rec);
end; $$;
create function public.record_maintenance_visit(p_plan_id uuid,p_done_on date,p_summary text,p_intervention_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; plan public.site_maintenance_plans; visit public.site_maintenance_visits; due date;
begin
 select site_id into org from public.site_maintenance_plans where id=p_plan_id;
 -- Site lock before any check: unknown plan and foreign plan answer the same refusal.
 perform public.lock_site_access(org);
 select * into plan from public.site_maintenance_plans where id=p_plan_id for update;
 if not found then raise no_data_found; end if;
 org=public.so_site_organization(plan.site_id);
 if p_done_on is null or p_summary is null or char_length(p_summary)>4000 then raise invalid_parameter_value; end if;
 if p_intervention_id is not null and not exists(select 1 from public.interventions where id=p_intervention_id and site_id=plan.site_id) then raise insufficient_privilege; end if;
 perform public.consume_action('site_operations',60);
 insert into public.site_maintenance_visits(plan_id,site_id,done_on,intervention_id,summary,created_by) values(p_plan_id,plan.site_id,p_done_on,p_intervention_id,trim(p_summary),auth.uid()) returning * into visit;
 -- Next due date only from a configured frequency; otherwise it stays as entered (possibly null).
 due=case plan.frequency_kind when 'days' then p_done_on+plan.frequency_value when 'weeks' then p_done_on+plan.frequency_value*7 when 'months' then (p_done_on+(plan.frequency_value||' months')::interval)::date else plan.next_due_on end;
 update public.site_maintenance_plans set last_done_on=greatest(coalesce(last_done_on,p_done_on),p_done_on),next_due_on=due,version=version+1,updated_at=now() where id=p_plan_id returning * into plan;
 perform public.so_log(org,plan.site_id,'maintenance_visit',visit.id,'recorded',plan.version,jsonb_build_object('visit',to_jsonb(visit),'plan',to_jsonb(plan)));
 return jsonb_build_object('visit',to_jsonb(visit),'plan',to_jsonb(plan));
end; $$;

-- ---------------------------------------------------------------- fiscal years and budgets
create function public.save_fiscal_year(p_organization_id uuid,p_payload jsonb,p_id uuid default null,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare rec public.organization_fiscal_years; s date; e date;
begin
 perform public.so_lock_organization(p_organization_id);
 perform public.so_keys(p_payload,array['label','starts_on','ends_on','status']);
 s=public.so_date(p_payload,'starts_on',true); e=public.so_date(p_payload,'ends_on',true);
 if e<s or e-s>730 then raise invalid_parameter_value; end if;
 if exists(select 1 from public.organization_fiscal_years where organization_id=p_organization_id and (p_id is null or id<>p_id) and starts_on<=e and ends_on>=s) then raise exception 'Fiscal years overlap' using errcode='P0001'; end if;
 perform public.consume_action('site_operations',60);
 if p_id is null then
  insert into public.organization_fiscal_years(organization_id,label,starts_on,ends_on,status,created_by) values(p_organization_id,public.so_text(p_payload,'label',1,80),s,e,public.so_enum(p_payload,'status',array['open','closed'],true),auth.uid()) returning * into rec;
  perform public.so_log(p_organization_id,null,'fiscal_year',rec.id,'created',rec.version,to_jsonb(rec));
 else
  select * into rec from public.organization_fiscal_years where id=p_id and organization_id=p_organization_id for update;
  if not found then raise no_data_found; end if;
  perform public.so_version(rec.version,p_expected_version);
  update public.organization_fiscal_years set label=public.so_text(p_payload,'label',1,80),starts_on=s,ends_on=e,status=public.so_enum(p_payload,'status',array['open','closed'],true),version=version+1,updated_at=now() where id=p_id returning * into rec;
  perform public.so_log(p_organization_id,null,'fiscal_year',rec.id,'updated',rec.version,to_jsonb(rec));
 end if;
 return to_jsonb(rec);
end; $$;
create function public.save_budget_line(p_site_id uuid,p_fiscal_year_id uuid,p_category text,p_amount_cents integer,p_note text,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; rec public.site_budget_lines;
begin
 perform public.lock_site_access(p_site_id); org=public.so_site_organization(p_site_id);
 if not exists(select 1 from public.organization_fiscal_years where id=p_fiscal_year_id and organization_id=org) then raise insufficient_privilege; end if;
 if p_category is null or p_category not in ('maintenance','repairs','compliance','equipment','other') or p_amount_cents is null or p_amount_cents not between 0 and 100000000 or p_note is null or char_length(p_note)>1000 then raise invalid_parameter_value; end if;
 perform public.consume_action('site_operations',60);
 select * into rec from public.site_budget_lines where site_id=p_site_id and fiscal_year_id=p_fiscal_year_id and category=p_category for update;
 if found then
  perform public.so_version(rec.version,p_expected_version);
  update public.site_budget_lines set amount_cents=p_amount_cents,note=trim(p_note),version=version+1,updated_at=now() where id=rec.id returning * into rec;
  perform public.so_log(org,p_site_id,'budget_line',rec.id,'updated',rec.version,to_jsonb(rec));
 else
  if p_expected_version is not null then raise exception 'Version mismatch' using errcode='P0001'; end if;
  insert into public.site_budget_lines(site_id,fiscal_year_id,category,amount_cents,note,created_by) values(p_site_id,p_fiscal_year_id,p_category,p_amount_cents,trim(p_note),auth.uid()) returning * into rec;
  perform public.so_log(org,p_site_id,'budget_line',rec.id,'created',rec.version,to_jsonb(rec));
 end if;
 return to_jsonb(rec);
end; $$;

-- ---------------------------------------------------------------- versioned contract grids
create function public.so_grid_lines(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare x jsonb; result jsonb='[]'::jsonb;
begin
 if p is null or jsonb_typeof(p)<>'array' or jsonb_array_length(p)>100 then raise invalid_parameter_value; end if;
 for x in select * from jsonb_array_elements(p) loop
  perform public.so_keys(x,array['label','unit','amount_cents','note']);
  result=result||jsonb_build_object('label',public.so_text(x,'label',1,160),'unit',public.so_enum(x,'unit',array['hour','visit','flat','km','unit'],true),'amount_cents',public.so_int(x,'amount_cents',0,10000000,true),'note',public.so_text(x,'note',0,400));
 end loop;
 return result;
end; $$;
create function public.save_contract_grid(p_organization_id uuid,p_payload jsonb,p_id uuid default null,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare rec public.organization_contract_grids; source public.organization_contract_grids; contract uuid; lineage uuid; next_number integer=1; from_id uuid;
begin
 perform public.so_lock_organization(p_organization_id);
 perform public.so_keys(p_payload,array['label','contract_id','effective_from','lines','from_grid_id']);
 contract=public.so_uuid(p_payload,'contract_id',false);
 if contract is not null and not exists(select 1 from public.contracts where id=contract and organization_id=p_organization_id) then raise insufficient_privilege; end if;
 perform public.consume_action('site_operations',60);
 if p_id is null then
  from_id=public.so_uuid(p_payload,'from_grid_id',false); lineage=gen_random_uuid();
  if from_id is not null then
   select * into source from public.organization_contract_grids where id=from_id and organization_id=p_organization_id;
   if not found then raise no_data_found; end if;
   if source.status='draft' then raise exception 'Draft already open' using errcode='P0001'; end if;
   if exists(select 1 from public.organization_contract_grids where lineage_id=source.lineage_id and status='draft') then raise exception 'Draft already open' using errcode='P0001'; end if;
   lineage=source.lineage_id; select max(version_number)+1 into next_number from public.organization_contract_grids where lineage_id=lineage;
  end if;
  insert into public.organization_contract_grids(organization_id,lineage_id,version_number,label,contract_id,effective_from,status,lines,created_by)
  values(p_organization_id,lineage,next_number,public.so_text(p_payload,'label',1,160),contract,public.so_date(p_payload,'effective_from',false),'draft',public.so_grid_lines(coalesce(p_payload->'lines','[]'::jsonb)),auth.uid()) returning * into rec;
  perform public.so_log(p_organization_id,null,'contract_grid',rec.id,'created',rec.version,to_jsonb(rec));
 else
  if p_payload ? 'from_grid_id' then raise invalid_parameter_value; end if;
  select * into rec from public.organization_contract_grids where id=p_id and organization_id=p_organization_id for update;
  if not found then raise no_data_found; end if;
  if rec.status<>'draft' then raise exception 'Published grid is immutable' using errcode='P0001'; end if;
  perform public.so_version(rec.version,p_expected_version);
  update public.organization_contract_grids set label=public.so_text(p_payload,'label',1,160),contract_id=contract,effective_from=public.so_date(p_payload,'effective_from',false),lines=public.so_grid_lines(coalesce(p_payload->'lines','[]'::jsonb)),version=version+1,updated_at=now() where id=p_id returning * into rec;
  perform public.so_log(p_organization_id,null,'contract_grid',rec.id,'updated',rec.version,to_jsonb(rec));
 end if;
 return to_jsonb(rec);
end; $$;
create function public.publish_contract_grid(p_id uuid,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; rec public.organization_contract_grids;
begin
 select organization_id into org from public.organization_contract_grids where id=p_id;
 perform public.so_lock_organization(org);
 select * into rec from public.organization_contract_grids where id=p_id for update;
 if not found then raise no_data_found; end if;
 if rec.status<>'draft' then raise exception 'Published grid is immutable' using errcode='P0001'; end if;
 perform public.so_version(rec.version,p_expected_version);
 perform public.consume_action('site_operations',60);
 update public.organization_contract_grids set status='superseded',version=version+1,updated_at=now() where lineage_id=rec.lineage_id and status='published';
 update public.organization_contract_grids set status='published',published_at=now(),version=version+1,updated_at=now() where id=p_id returning * into rec;
 perform public.so_log(org,null,'contract_grid',rec.id,'published',rec.version,to_jsonb(rec));
 return to_jsonb(rec);
end; $$;

-- ---------------------------------------------------------------- SLA configuration and facts
create function public.so_calendar_windows(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare x jsonb; result jsonb='[]'::jsonb; s text; e text;
begin
 if p is null or jsonb_typeof(p)<>'array' or jsonb_array_length(p)>21 then raise invalid_parameter_value; end if;
 for x in select * from jsonb_array_elements(p) loop
  perform public.so_keys(x,array['weekday','start','end']);
  s=public.so_text(x,'start',5,5); e=public.so_text(x,'end',5,5);
  if s!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or e!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or e<=s then raise invalid_parameter_value; end if;
  result=result||jsonb_build_object('weekday',public.so_int(x,'weekday',1,7,true),'start',s,'end',e);
 end loop;
 return result;
end; $$;
create function public.so_closed_dates(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare x jsonb; result jsonb='[]'::jsonb;
begin
 if p is null or jsonb_typeof(p)<>'array' or jsonb_array_length(p)>366 then raise invalid_parameter_value; end if;
 for x in select * from jsonb_array_elements(p) loop
  if jsonb_typeof(x)<>'string' or (x#>>'{}')!~'^\d{4}-\d{2}-\d{2}$' then raise invalid_parameter_value; end if;
  result=result||to_jsonb(((x#>>'{}')::date)::text);
 end loop;
 return result;
end; $$;
create function public.save_sla_calendar(p_organization_id uuid,p_payload jsonb,p_id uuid default null,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare rec public.organization_sla_calendars;
begin
 perform public.so_lock_organization(p_organization_id);
 perform public.so_keys(p_payload,array['name','timezone','windows','closed_dates']);
 perform public.consume_action('site_operations',60);
 if p_id is null then
  insert into public.organization_sla_calendars(organization_id,name,timezone,windows,closed_dates,created_by)
  values(p_organization_id,public.so_text(p_payload,'name',1,160),public.so_text(p_payload,'timezone',1,64),public.so_calendar_windows(coalesce(p_payload->'windows','[]'::jsonb)),public.so_closed_dates(coalesce(p_payload->'closed_dates','[]'::jsonb)),auth.uid()) returning * into rec;
  perform public.so_log(p_organization_id,null,'sla_calendar',rec.id,'created',rec.version,to_jsonb(rec));
 else
  select * into rec from public.organization_sla_calendars where id=p_id and organization_id=p_organization_id for update;
  if not found then raise no_data_found; end if;
  perform public.so_version(rec.version,p_expected_version);
  update public.organization_sla_calendars set name=public.so_text(p_payload,'name',1,160),timezone=public.so_text(p_payload,'timezone',1,64),windows=public.so_calendar_windows(coalesce(p_payload->'windows','[]'::jsonb)),closed_dates=public.so_closed_dates(coalesce(p_payload->'closed_dates','[]'::jsonb)),version=version+1,updated_at=now() where id=p_id returning * into rec;
  perform public.so_log(p_organization_id,null,'sla_calendar',rec.id,'updated',rec.version,to_jsonb(rec));
 end if;
 return to_jsonb(rec);
end; $$;
create function public.save_sla_policy(p_site_id uuid,p_payload jsonb,p_id uuid default null,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; rec public.site_sla_policies; calendar uuid;
begin
 perform public.lock_site_access(p_site_id); org=public.so_site_organization(p_site_id);
 perform public.so_keys(p_payload,array['name','calendar_id','urgency','response_target_minutes','resolution_target_minutes','status']);
 calendar=public.so_uuid(p_payload,'calendar_id',false);
 if calendar is not null and not exists(select 1 from public.organization_sla_calendars where id=calendar and organization_id=org) then raise insufficient_privilege; end if;
 perform public.consume_action('site_operations',60);
 if p_id is null then
  insert into public.site_sla_policies(site_id,name,calendar_id,urgency,response_target_minutes,resolution_target_minutes,status,created_by)
  values(p_site_id,public.so_text(p_payload,'name',1,160),calendar,public.so_enum(p_payload,'urgency',array['urgent','scheduled'],false),public.so_int(p_payload,'response_target_minutes',1,525600,false),public.so_int(p_payload,'resolution_target_minutes',1,525600,false),public.so_enum(p_payload,'status',array['active','archived'],true),auth.uid()) returning * into rec;
  perform public.so_log(org,p_site_id,'sla_policy',rec.id,'created',rec.version,to_jsonb(rec));
 else
  select * into rec from public.site_sla_policies where id=p_id and site_id=p_site_id for update;
  if not found then raise no_data_found; end if;
  perform public.so_version(rec.version,p_expected_version);
  update public.site_sla_policies set name=public.so_text(p_payload,'name',1,160),calendar_id=calendar,urgency=public.so_enum(p_payload,'urgency',array['urgent','scheduled'],false),response_target_minutes=public.so_int(p_payload,'response_target_minutes',1,525600,false),resolution_target_minutes=public.so_int(p_payload,'resolution_target_minutes',1,525600,false),status=public.so_enum(p_payload,'status',array['active','archived'],true),version=version+1,updated_at=now() where id=p_id returning * into rec;
  perform public.so_log(org,p_site_id,'sla_policy',rec.id,'updated',rec.version,to_jsonb(rec));
 end if;
 return to_jsonb(rec);
end; $$;
create function public.save_sla_case(p_site_id uuid,p_payload jsonb,p_id uuid default null,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; rec public.site_sla_cases; pol uuid; job uuid; opened timestamptz; responded timestamptz; resolved timestamptz;
begin
 perform public.lock_site_access(p_site_id); org=public.so_site_organization(p_site_id);
 perform public.so_keys(p_payload,array['policy_id','intervention_id','reference','opened_at','responded_at','resolved_at','notes']);
 pol=public.so_uuid(p_payload,'policy_id',true);
 if not exists(select 1 from public.site_sla_policies where id=pol and site_id=p_site_id) then raise insufficient_privilege; end if;
 job=public.so_uuid(p_payload,'intervention_id',false);
 if job is not null and not exists(select 1 from public.interventions where id=job and site_id=p_site_id) then raise insufficient_privilege; end if;
 opened=public.so_ts(p_payload,'opened_at',true); responded=public.so_ts(p_payload,'responded_at',false); resolved=public.so_ts(p_payload,'resolved_at',false);
 if (responded is not null and responded<opened) or (resolved is not null and (resolved<opened or (responded is not null and resolved<responded))) then raise invalid_parameter_value; end if;
 perform public.consume_action('site_operations',60);
 if p_id is null then
  insert into public.site_sla_cases(site_id,policy_id,intervention_id,reference,opened_at,responded_at,resolved_at,notes,created_by)
  values(p_site_id,pol,job,public.so_text(p_payload,'reference',0,160),opened,responded,resolved,public.so_text(p_payload,'notes',0,4000),auth.uid()) returning * into rec;
  perform public.so_log(org,p_site_id,'sla_case',rec.id,'created',rec.version,to_jsonb(rec));
 else
  select * into rec from public.site_sla_cases where id=p_id and site_id=p_site_id for update;
  if not found then raise no_data_found; end if;
  perform public.so_version(rec.version,p_expected_version);
  if exists(select 1 from public.site_sla_pauses where case_id=p_id and started_at<opened) then raise invalid_parameter_value; end if;
  update public.site_sla_cases set policy_id=pol,intervention_id=job,reference=public.so_text(p_payload,'reference',0,160),opened_at=opened,responded_at=responded,resolved_at=resolved,notes=public.so_text(p_payload,'notes',0,4000),version=version+1,updated_at=now() where id=p_id returning * into rec;
  perform public.so_log(org,p_site_id,'sla_case',rec.id,'updated',rec.version,to_jsonb(rec));
 end if;
 return to_jsonb(rec);
end; $$;
create function public.pause_sla_case(p_case_id uuid,p_started_at timestamptz,p_reason text,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; site uuid; rec public.site_sla_cases; pause public.site_sla_pauses;
begin
 select site_id into site from public.site_sla_cases where id=p_case_id;
 perform public.lock_site_access(site); org=public.so_site_organization(site);
 select * into rec from public.site_sla_cases where id=p_case_id for update;
 if not found then raise no_data_found; end if;
 perform public.so_version(rec.version,p_expected_version);
 if p_started_at is null or p_started_at<rec.opened_at or p_reason is null or char_length(p_reason)>400 then raise invalid_parameter_value; end if;
 if rec.resolved_at is not null then raise exception 'Case already resolved' using errcode='P0001'; end if;
 if exists(select 1 from public.site_sla_pauses where case_id=p_case_id and ended_at is null) then raise exception 'Pause already open' using errcode='P0001'; end if;
 perform public.consume_action('site_operations',60);
 insert into public.site_sla_pauses(case_id,site_id,started_at,reason,created_by) values(p_case_id,site,p_started_at,trim(p_reason),auth.uid()) returning * into pause;
 update public.site_sla_cases set version=version+1,updated_at=now() where id=p_case_id returning * into rec;
 perform public.so_log(org,site,'sla_pause',pause.id,'paused',rec.version,jsonb_build_object('pause',to_jsonb(pause),'case',to_jsonb(rec)));
 return jsonb_build_object('pause',to_jsonb(pause),'case',to_jsonb(rec));
end; $$;
create function public.resume_sla_case(p_case_id uuid,p_ended_at timestamptz,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; site uuid; rec public.site_sla_cases; pause public.site_sla_pauses;
begin
 select site_id into site from public.site_sla_cases where id=p_case_id;
 perform public.lock_site_access(site); org=public.so_site_organization(site);
 select * into rec from public.site_sla_cases where id=p_case_id for update;
 if not found then raise no_data_found; end if;
 perform public.so_version(rec.version,p_expected_version);
 select * into pause from public.site_sla_pauses where case_id=p_case_id and ended_at is null for update;
 if not found then raise exception 'No open pause' using errcode='P0001'; end if;
 if p_ended_at is null or p_ended_at<pause.started_at then raise invalid_parameter_value; end if;
 perform public.consume_action('site_operations',60);
 update public.site_sla_pauses set ended_at=p_ended_at where id=pause.id returning * into pause;
 update public.site_sla_cases set version=version+1,updated_at=now() where id=p_case_id returning * into rec;
 perform public.so_log(org,site,'sla_pause',pause.id,'resumed',rec.version,jsonb_build_object('pause',to_jsonb(pause),'case',to_jsonb(rec)));
 return jsonb_build_object('pause',to_jsonb(pause),'case',to_jsonb(rec));
end; $$;

-- ---------------------------------------------------------------- ERP declarative checklists
create function public.so_checklist_items(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare x jsonb; result jsonb='[]'::jsonb; keys text[]='{}'; k text;
begin
 if p is null or jsonb_typeof(p)<>'array' or jsonb_array_length(p)>200 then raise invalid_parameter_value; end if;
 for x in select * from jsonb_array_elements(p) loop
  perform public.so_keys(x,array['key','label','state','note','reserve_resolved_on']);
  k=public.so_text(x,'key',1,40);
  if k!~'^[A-Za-z0-9_-]+$' or k=any(keys) then raise invalid_parameter_value; end if;
  keys=keys||k;
  result=result||jsonb_build_object('key',k,'label',public.so_text(x,'label',1,240),'state',public.so_enum(x,'state',array['not_checked','ok','reserve','not_applicable'],true),'note',public.so_text(x,'note',0,1000),'reserve_resolved_on',public.so_date(x,'reserve_resolved_on',false));
 end loop;
 return result;
end; $$;
create function public.save_erp_checklist(p_site_id uuid,p_payload jsonb,p_id uuid default null,p_expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; rec public.site_erp_checklists;
begin
 perform public.lock_site_access(p_site_id); org=public.so_site_organization(p_site_id);
 perform public.so_keys(p_payload,array['title','description','performed_on','performed_by_label','status','items']);
 perform public.consume_action('site_operations',60);
 if p_id is null then
  insert into public.site_erp_checklists(site_id,title,description,performed_on,performed_by_label,status,items,created_by)
  values(p_site_id,public.so_text(p_payload,'title',1,160),public.so_text(p_payload,'description',0,4000),public.so_date(p_payload,'performed_on',false),public.so_text(p_payload,'performed_by_label',0,160),public.so_enum(p_payload,'status',array['draft','completed','archived'],true),public.so_checklist_items(coalesce(p_payload->'items','[]'::jsonb)),auth.uid()) returning * into rec;
  perform public.so_log(org,p_site_id,'erp_checklist',rec.id,'created',rec.version,to_jsonb(rec));
 else
  select * into rec from public.site_erp_checklists where id=p_id and site_id=p_site_id for update;
  if not found then raise no_data_found; end if;
  perform public.so_version(rec.version,p_expected_version);
  update public.site_erp_checklists set title=public.so_text(p_payload,'title',1,160),description=public.so_text(p_payload,'description',0,4000),performed_on=public.so_date(p_payload,'performed_on',false),performed_by_label=public.so_text(p_payload,'performed_by_label',0,160),status=public.so_enum(p_payload,'status',array['draft','completed','archived'],true),items=public.so_checklist_items(coalesce(p_payload->'items','[]'::jsonb)),version=version+1,updated_at=now() where id=p_id returning * into rec;
  perform public.so_log(org,p_site_id,'erp_checklist',rec.id,'updated',rec.version,to_jsonb(rec));
 end if;
 return to_jsonb(rec);
end; $$;

-- ---------------------------------------------------------------- one consistent read under RLS
create function public.site_operations_snapshot(p_site_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare org uuid; site_row public.sites; grids_readable boolean;
begin
 if p_site_id is null or not public.can_access_site(p_site_id) then raise insufficient_privilege; end if;
 select * into site_row from public.sites where id=p_site_id;
 if not found then raise insufficient_privilege; end if;
 org=site_row.organization_id;
 grids_readable=public.can_access_organization_wide(org) or public.is_admin();
 return jsonb_build_object(
  'site',jsonb_build_object('id',site_row.id,'organization_id',org,'name',site_row.name,'type',site_row.type,'budget_cents',site_row.budget_cents),
  'equipment',(select coalesce(jsonb_agg(to_jsonb(e) order by e.updated_at desc,e.id desc),'[]'::jsonb) from (select * from public.site_equipment where site_id=p_site_id order by updated_at desc,id desc limit 300) e),
  'maintenance_plans',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('visits',(select coalesce(jsonb_agg(to_jsonb(v) order by v.done_on desc,v.id desc),'[]'::jsonb) from (select * from public.site_maintenance_visits where plan_id=m.id order by done_on desc,id desc limit 20) v),'visits_total',(select count(*) from public.site_maintenance_visits where plan_id=m.id)) order by m.updated_at desc,m.id desc),'[]'::jsonb) from (select * from public.site_maintenance_plans where site_id=p_site_id order by updated_at desc,id desc limit 300) m),
  'fiscal_years',(select coalesce(jsonb_agg(to_jsonb(f) order by f.starts_on desc),'[]'::jsonb) from (select * from public.organization_fiscal_years where organization_id=org order by starts_on desc limit 50) f),
  'budget_lines',(select coalesce(jsonb_agg(to_jsonb(b) order by b.fiscal_year_id,b.category),'[]'::jsonb) from (select * from public.site_budget_lines where site_id=p_site_id order by fiscal_year_id,category limit 300) b),
  'budget_consumption',(select coalesce(jsonb_agg(x order by x->>'fiscal_year_id'),'[]'::jsonb) from (
    select jsonb_build_object('fiscal_year_id',fy.id,'accepted_cents',coalesce(sum(q.total_cents),0),'paid_cents',coalesce(sum(q.total_cents) filter(where i.status='paid'),0),'interventions',count(distinct i.id)) x
    from public.organization_fiscal_years fy
    left join (public.interventions i join public.quotes q on q.intervention_id=i.id and q.status='accepted') on i.site_id=p_site_id and q.accepted_at is not null and (q.accepted_at at time zone 'UTC')::date between fy.starts_on and fy.ends_on
    where fy.organization_id=org group by fy.id) s),
  'contract_grids',case when grids_readable then (select coalesce(jsonb_agg(to_jsonb(g) order by g.lineage_id,g.version_number desc),'[]'::jsonb) from (select * from public.organization_contract_grids where organization_id=org order by updated_at desc limit 100) g) else null end,
  'sla_calendars',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name,c.id),'[]'::jsonb) from (select * from public.organization_sla_calendars where organization_id=org order by name,id limit 50) c),
  'sla_policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc,p.id desc),'[]'::jsonb) from (select * from public.site_sla_policies where site_id=p_site_id order by updated_at desc,id desc limit 100) p),
  -- Pauses feed the SLA computation: every pause of a case is returned (no limit) with its total,
  -- so the computation can refuse to measure if the two ever disagree.
  'sla_cases',(select coalesce(jsonb_agg(to_jsonb(k)||jsonb_build_object('pauses',(select coalesce(jsonb_agg(to_jsonb(z) order by z.started_at,z.id),'[]'::jsonb) from public.site_sla_pauses z where z.case_id=k.id),'pauses_total',(select count(*) from public.site_sla_pauses where case_id=k.id)) order by k.opened_at desc,k.id desc),'[]'::jsonb) from (select * from public.site_sla_cases where site_id=p_site_id order by opened_at desc,id desc limit 300) k),
  'erp_checklists',(select coalesce(jsonb_agg(to_jsonb(l) order by l.updated_at desc,l.id desc),'[]'::jsonb) from (select * from public.site_erp_checklists where site_id=p_site_id order by updated_at desc,id desc limit 100) l),
  'events',(select coalesce(jsonb_agg(to_jsonb(ev) order by ev.id desc),'[]'::jsonb) from (select id,site_id,actor_id,entity,entity_id,action,version,created_at from public.site_operations_events where (site_id=p_site_id or (site_id is null and organization_id=org)) order by id desc limit 100) ev),
  'limits',jsonb_build_object(
   'equipment_limited',(select count(*)>300 from public.site_equipment where site_id=p_site_id),
   'maintenance_plans_limited',(select count(*)>300 from public.site_maintenance_plans where site_id=p_site_id),
   'fiscal_years_limited',(select count(*)>50 from public.organization_fiscal_years where organization_id=org),
   'budget_lines_limited',(select count(*)>300 from public.site_budget_lines where site_id=p_site_id),
   'contract_grids_limited',grids_readable and (select count(*)>100 from public.organization_contract_grids where organization_id=org),
   'contract_grids_readable',grids_readable,
   'sla_calendars_limited',(select count(*)>50 from public.organization_sla_calendars where organization_id=org),
   'sla_policies_limited',(select count(*)>100 from public.site_sla_policies where site_id=p_site_id),
   'sla_cases_limited',(select count(*)>300 from public.site_sla_cases where site_id=p_site_id),
   'erp_checklists_limited',(select count(*)>100 from public.site_erp_checklists where site_id=p_site_id),
   'events_limited',(select count(*)>100 from public.site_operations_events where site_id=p_site_id or (site_id is null and organization_id=org)),
   'can_write_site',public.can_manage_site(p_site_id),
   'can_write_organization',public.can_access_organization_wide(org,true)));
end; $$;

-- ---------------------------------------------------------------- grants: helpers private, commands for authenticated
revoke execute on function public.so_keys(jsonb,text[]),public.so_text(jsonb,text,integer,integer),public.so_int(jsonb,text,integer,integer,boolean),public.so_enum(jsonb,text,text[],boolean),public.so_date(jsonb,text,boolean),public.so_ts(jsonb,text,boolean),public.so_uuid(jsonb,text,boolean),public.so_lock_organization(uuid),public.so_site_organization(uuid),public.so_version(integer,integer),public.so_log(uuid,uuid,text,uuid,text,integer,jsonb),public.so_grid_lines(jsonb),public.so_calendar_windows(jsonb),public.so_closed_dates(jsonb),public.so_checklist_items(jsonb) from public,anon,authenticated;
revoke execute on function public.save_site_equipment(uuid,jsonb,uuid,integer),public.save_maintenance_plan(uuid,jsonb,uuid,integer),public.record_maintenance_visit(uuid,date,text,uuid),public.save_fiscal_year(uuid,jsonb,uuid,integer),public.save_budget_line(uuid,uuid,text,integer,text,integer),public.save_contract_grid(uuid,jsonb,uuid,integer),public.publish_contract_grid(uuid,integer),public.save_sla_calendar(uuid,jsonb,uuid,integer),public.save_sla_policy(uuid,jsonb,uuid,integer),public.save_sla_case(uuid,jsonb,uuid,integer),public.pause_sla_case(uuid,timestamptz,text,integer),public.resume_sla_case(uuid,timestamptz,integer),public.save_erp_checklist(uuid,jsonb,uuid,integer),public.site_operations_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.save_site_equipment(uuid,jsonb,uuid,integer),public.save_maintenance_plan(uuid,jsonb,uuid,integer),public.record_maintenance_visit(uuid,date,text,uuid),public.save_fiscal_year(uuid,jsonb,uuid,integer),public.save_budget_line(uuid,uuid,text,integer,text,integer),public.save_contract_grid(uuid,jsonb,uuid,integer),public.publish_contract_grid(uuid,integer),public.save_sla_calendar(uuid,jsonb,uuid,integer),public.save_sla_policy(uuid,jsonb,uuid,integer),public.save_sla_case(uuid,jsonb,uuid,integer),public.pause_sla_case(uuid,timestamptz,text,integer),public.resume_sla_case(uuid,timestamptz,integer),public.save_erp_checklist(uuid,jsonb,uuid,integer),public.site_operations_snapshot(uuid) to authenticated;
commit;
