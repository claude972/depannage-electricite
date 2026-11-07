-- ENT-09: recorded energy periods. Sources are declared by an authorized site
-- manager; these records are not automatic meter measurements or certifications.
begin;
create table public.site_energy_periods (
 id uuid primary key,
 site_id uuid not null references public.sites(id) on delete cascade,
 meter_label text not null check(char_length(btrim(meter_label)) between 1 and 160),
 period_start date not null, period_end date not null check(period_end>=period_start),
 consumption_wh bigint not null check(consumption_wh between 0 and 9000000000000),
 cost_cents bigint check(cost_cents between 0 and 1000000000),
 source_kind text not null check(source_kind in ('invoice','meter','manual')),
 source_reference text not null check(char_length(btrim(source_reference)) between 1 and 240),
 note text not null default '' check(char_length(note)<=2000),
 version integer not null default 1 check(version>0),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(),
 archived_at timestamptz
);
create index site_energy_periods_site_period on public.site_energy_periods(site_id,period_start desc,id desc) where archived_at is null;
-- One active record per meter and period. Overlapping periods are rejected by
-- the serialized writer so totals never count the same meter period twice.
create unique index site_energy_periods_unique_active on public.site_energy_periods(site_id,lower(btrim(meter_label)),period_start,period_end) where archived_at is null;
alter table public.site_energy_periods enable row level security;
revoke all on public.site_energy_periods from public,anon,authenticated;
grant select on public.site_energy_periods to authenticated;
grant select,insert,update,delete on public.site_energy_periods to service_role;
create policy energy_periods_read on public.site_energy_periods for select to authenticated
 using(public.can_access_site(site_id));

create table public.site_energy_events (
 id bigint generated always as identity primary key,
 site_id uuid not null references public.sites(id) on delete cascade,
 record_id uuid not null references public.site_energy_periods(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),
 action text not null check(action in ('created','updated','archived')),
 version integer not null, created_at timestamptz not null default now()
);
create index site_energy_events_site on public.site_energy_events(site_id,id desc);
alter table public.site_energy_events enable row level security;
revoke all on public.site_energy_events from public,anon,authenticated;
grant select on public.site_energy_events to authenticated;
grant select,insert,update,delete on public.site_energy_events to service_role;
create policy energy_events_read on public.site_energy_events for select to authenticated using(public.can_access_site(site_id));

-- Narrow, authenticated command boundary: no direct REST writes. The definer
-- is necessary for atomic record+event persistence; every call checks the current
-- actor and site-write scope before reading or writing any period.
create function public.save_site_energy_period(p_site_id uuid,p_id uuid,p_expected_version integer,p_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); current_row public.site_energy_periods; result public.site_energy_periods;
 label text; first_day date; last_day date; wh bigint; cost bigint; src text; ref text; notes text;
begin
 if actor is null or not public.can_manage_site(p_site_id) then raise insufficient_privilege;end if;
 if p_id is null or p_values is null or jsonb_typeof(p_values)<>'object'
 or (select count(*) from jsonb_object_keys(p_values))<>8
 or not(p_values ?& array['meter_label','period_start','period_end','consumption_wh','cost_cents','source_kind','source_reference','note'])
 then raise invalid_parameter_value;end if;
 if jsonb_typeof(p_values->'meter_label')<>'string' or jsonb_typeof(p_values->'period_start')<>'string'
 or jsonb_typeof(p_values->'period_end')<>'string' or jsonb_typeof(p_values->'consumption_wh')<>'number'
 or jsonb_typeof(p_values->'source_kind')<>'string' or jsonb_typeof(p_values->'source_reference')<>'string'
 or jsonb_typeof(p_values->'note')<>'string' or jsonb_typeof(p_values->'cost_cents') not in ('number','null')
 or (p_values->>'consumption_wh')!~'^[0-9]+$'
 or (p_values->>'cost_cents' is not null and (p_values->>'cost_cents')!~'^[0-9]+$')
 or (p_values->>'period_start')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or (p_values->>'period_end')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 then raise invalid_parameter_value;end if;
 label=btrim(p_values->>'meter_label');first_day=(p_values->>'period_start')::date;last_day=(p_values->>'period_end')::date;
 wh=(p_values->>'consumption_wh')::bigint;cost=(p_values->>'cost_cents')::bigint;
 src=p_values->>'source_kind';ref=btrim(p_values->>'source_reference');notes=btrim(p_values->>'note');
 if char_length(label) not between 1 and 160 or last_day<first_day or wh not between 0 and 9000000000000
 or (cost is not null and cost not between 0 and 1000000000) or src not in ('invoice','meter','manual')
 or char_length(ref) not between 1 and 240 or char_length(notes)>2000 or p_expected_version is not null and p_expected_version<1
 then raise invalid_parameter_value;end if;
 -- All writes to a site serialize here, including overlapping-period checks.
 perform public.lock_site_access(p_site_id);
 perform 1 from public.sites where id=p_site_id for update;
 -- Membership may have been revoked while waiting for that lock.
 if not public.can_manage_site(p_site_id) then raise insufficient_privilege;end if;
 select * into current_row from public.site_energy_periods where id=p_id and site_id=p_site_id for update;
 if found then
  if current_row.archived_at is not null then raise exception 'Archived energy period' using errcode='P0001';end if;
  if current_row.meter_label=label and current_row.period_start=first_day and current_row.period_end=last_day
   and current_row.consumption_wh=wh and current_row.cost_cents is not distinct from cost
   and current_row.source_kind=src and current_row.source_reference=ref and current_row.note=notes
   and (p_expected_version is null and current_row.version=1 or p_expected_version is not null and current_row.version in(p_expected_version,p_expected_version+1))
  then return to_jsonb(current_row);end if;
  if p_expected_version is null or current_row.version<>p_expected_version or current_row.version=2147483647
  then raise exception 'Energy period changed' using errcode='P0001';end if;
 elsif p_expected_version is not null then raise no_data_found;
 end if;
 if exists(select 1 from public.site_energy_periods where site_id=p_site_id and id<>p_id and archived_at is null
  and lower(btrim(meter_label))=lower(label) and period_start<=last_day and period_end>=first_day)
 then raise exception 'Overlapping meter period' using errcode='P0001';end if;
 if current_row.id is null then
  insert into public.site_energy_periods(id,site_id,meter_label,period_start,period_end,consumption_wh,cost_cents,source_kind,source_reference,note,created_by,updated_by)
  values(p_id,p_site_id,label,first_day,last_day,wh,cost,src,ref,notes,actor,actor) returning * into result;
 else
  update public.site_energy_periods set meter_label=label,period_start=first_day,period_end=last_day,consumption_wh=wh,cost_cents=cost,
   source_kind=src,source_reference=ref,note=notes,version=version+1,updated_by=actor,updated_at=clock_timestamp()
  where id=p_id and site_id=p_site_id returning * into result;
 end if;
 insert into public.site_energy_events(site_id,record_id,actor_id,action,version)
 values(p_site_id,p_id,actor,case when current_row.id is null then 'created' else 'updated' end,result.version);
 return to_jsonb(result);
end;$$;
revoke all on function public.save_site_energy_period(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_site_energy_period(uuid,uuid,integer,jsonb) to authenticated;

create function public.archive_site_energy_period(p_site_id uuid,p_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); r public.site_energy_periods;
begin
 if actor is null or not public.can_manage_site(p_site_id) then raise insufficient_privilege;end if;
 if p_id is null or p_expected_version is null or p_expected_version<1 or p_expected_version>=2147483647 then raise invalid_parameter_value;end if;
 perform public.lock_site_access(p_site_id);
 perform 1 from public.sites where id=p_site_id for update;
 if not public.can_manage_site(p_site_id) then raise insufficient_privilege;end if;
 select * into r from public.site_energy_periods where id=p_id and site_id=p_site_id for update;
 if not found then raise no_data_found;end if;
 if r.archived_at is not null and r.version=p_expected_version+1 then return to_jsonb(r);end if;
 if r.archived_at is not null or r.version<>p_expected_version then raise exception 'Energy period changed' using errcode='P0001';end if;
 update public.site_energy_periods set archived_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=actor,version=version+1 where id=p_id returning * into r;
 insert into public.site_energy_events(site_id,record_id,actor_id,action,version)values(p_site_id,p_id,actor,'archived',r.version);
 return to_jsonb(r);
end;$$;
revoke all on function public.archive_site_energy_period(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.archive_site_energy_period(uuid,uuid,integer) to authenticated;
commit;
