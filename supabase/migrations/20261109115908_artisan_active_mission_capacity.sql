begin;

create schema if not exists artisan_capacity_private;
revoke all on schema artisan_capacity_private from public, anon, authenticated, service_role;

alter table public.artisan_profiles alter column capacity_limit set default 3;
create index if not exists interventions_artisan_active_capacity on public.interventions(artisan_id)
  where status in ('assigned','quoted','accepted','in_progress');

-- Null and legacy preference values resolve to three missions.
create or replace function artisan_capacity_private.has_slot(artisan uuid, preference integer)
returns boolean language sql stable set search_path = '' as $$
  select (select count(*) from (
    select 1 from public.interventions
    where artisan_id = artisan and status in ('assigned','quoted','accepted','in_progress')
    limit 4
  ) active) < case when preference = 4 then 4 else 3 end
$$;

create or replace function public.set_artisan_capacity_limit(p_limit integer, p_expected_version integer)
returns public.artisan_profiles language plpgsql security definer set search_path = '' as $$
declare
  current_profile public.artisan_profiles;
begin
  perform public.guard_artisan_self_edit();
  if (p_limit is not null and p_limit not in (3,4)) or p_expected_version is null or p_expected_version < 0 then
    raise invalid_parameter_value;
  end if;
  select * into current_profile from public.artisan_profiles where user_id = auth.uid();
  if not found then raise no_data_found; end if;
  if current_profile.capacity_version <> p_expected_version or current_profile.capacity_version = 2147483647 then
    raise exception 'Capacity revision changed' using errcode = 'P0001';
  end if;
  if current_profile.capacity_limit is not distinct from p_limit then return current_profile; end if;
  perform public.consume_action('artisan_capacity', 30);
  update public.artisan_profiles
    set capacity_limit = p_limit, capacity_version = capacity_version + 1
    where user_id = auth.uid()
    returning * into current_profile;
  return current_profile;
end;
$$;

create or replace function public.mission_eligible(p_id uuid, p_artisan_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.interventions i
    join public.artisan_profiles a on a.user_id = p_artisan_id
    join public.profiles p on p.id = a.user_id
    where i.id = p_id and i.status = 'requested' and i.artisan_id is null
      and i.client_id <> p_artisan_id and p.role = 'artisan' and p.artisan_approved
      and a.application_status = 'approved' and a.available
      and i.postal_code = any(a.postal_codes) and i.category = any(a.categories)
      and not exists (
        select 1 from public.mission_declines d
        where d.intervention_id = i.id and d.artisan_id = p_artisan_id
      )
      and (i.urgency <> 'urgent' or not exists (
        select 1 from public.artisan_planning_entries e
        where e.artisan_id = p_artisan_id and e.kind = 'unavailable'
          and e.starts_at <= statement_timestamp() and e.ends_at > statement_timestamp()
      ))
      and artisan_capacity_private.has_slot(a.user_id, a.capacity_limit)
      and mission_radius_private.within_radius(i.id, p_artisan_id)
  );
$$;

-- Acceptance and reassignment already lock the job, profile and artisan
-- dossier in that order. This guard also covers the administrative path and
-- keeps a concurrent capacity edit serialized with a new assignment.
create or replace function artisan_capacity_private.guard_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  preference integer;
begin
  if new.artisan_id is null or new.status not in ('assigned','quoted','accepted','in_progress')
    or (old.artisan_id is not distinct from new.artisan_id
      and old.status in ('assigned','quoted','accepted','in_progress'))
  then return new; end if;
  perform 1 from public.profiles where id = new.artisan_id for update;
  select capacity_limit into preference from public.artisan_profiles where user_id = new.artisan_id for update;
  if not artisan_capacity_private.has_slot(new.artisan_id, preference) then
    raise exception 'artisan_mission_capacity_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on all functions in schema artisan_capacity_private from public, anon, authenticated, service_role;
drop trigger if exists intervention_assignment_capacity on public.interventions;
create trigger intervention_assignment_capacity before update of artisan_id, status on public.interventions
for each row execute function artisan_capacity_private.guard_assignment();

commit;
