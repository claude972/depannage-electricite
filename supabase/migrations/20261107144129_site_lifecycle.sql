begin;

alter table public.sites
  add column settings_version integer not null default 1 check (settings_version > 0),
  add column access_notes text not null default '' check (char_length(access_notes) <= 2000),
  add column opening_hours jsonb not null default '[]' check (jsonb_typeof(opening_hours) = 'array'),
  add column archived_at timestamptz;

create table public.site_settings_commands (
  id uuid primary key,
  site_id uuid not null references public.sites(id),
  actor_id uuid not null references public.profiles(id),
  expected_version integer not null,
  action text not null check (action in ('save', 'archive')),
  inputs jsonb,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.site_settings_commands enable row level security;
revoke all on public.site_settings_commands from public, anon, authenticated, service_role;

create function public.reject_archived_site_intervention()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.site_id is not null and (tg_op = 'INSERT' or new.site_id is distinct from old.site_id) then
    perform 1 from public.sites where id = new.site_id and archived_at is null for share;
    if not found then
      raise exception 'An archived site cannot receive new interventions' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.reject_archived_site_intervention() from public, anon, authenticated, service_role;
create trigger reject_archived_site_intervention
  before insert or update of site_id on public.interventions
  for each row execute function public.reject_archived_site_intervention();

create function public.valid_site_hours(p_hours jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  slot jsonb;
  hours_pattern constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if jsonb_typeof(p_hours) is distinct from 'array' or jsonb_array_length(p_hours) > 28 then return false; end if;
  for slot in select value from jsonb_array_elements(p_hours) loop
    if jsonb_typeof(slot) is distinct from 'object' then return false; end if;
    if (slot - array['day','opens','closes']) <> '{}'::jsonb
      or jsonb_typeof(slot->'day') is distinct from 'number'
      or coalesce(slot->>'day', '') !~ '^[1-7]$'
      or jsonb_typeof(slot->'opens') is distinct from 'string'
      or jsonb_typeof(slot->'closes') is distinct from 'string'
      or coalesce(slot->>'opens', '') !~ hours_pattern
      or coalesce(slot->>'closes', '') !~ hours_pattern
      or slot->>'opens' >= slot->>'closes' then return false; end if;
  end loop;
  return not exists (
    select 1 from jsonb_array_elements(p_hours) with ordinality a(slot, pos)
    join jsonb_array_elements(p_hours) with ordinality b(slot, pos)
      on a.pos < b.pos and a.slot->>'day' = b.slot->>'day'
    where a.slot->>'opens' < b.slot->>'closes' and b.slot->>'opens' < a.slot->>'closes'
  );
end;
$$;
revoke all on function public.valid_site_hours(jsonb) from public, anon, authenticated, service_role;

create function public.write_site_settings(
  p_site_id uuid, p_command_id uuid, p_expected_version integer, p_action text, p_values jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  site public.sites;
  previous public.site_settings_commands;
  snapshot jsonb;
begin
  if actor is null then raise insufficient_privilege; end if;
  if p_site_id is null or p_command_id is null or p_expected_version is null
    or p_expected_version not between 1 and 2147483646 or p_action is null or p_action not in ('save','archive') then
    raise invalid_parameter_value;
  end if;
  if not public.can_access_site(p_site_id) then raise no_data_found; end if;
  perform public.lock_site_access(p_site_id);
  select * into site from public.sites where id = p_site_id for update;
  if not found or not public.can_access_site(p_site_id) then raise no_data_found; end if;
  if not public.can_manage_site(p_site_id) then raise insufficient_privilege; end if;

  select * into previous from public.site_settings_commands where id = p_command_id;
  if found then
    if previous.actor_id <> actor or previous.site_id <> p_site_id or previous.expected_version <> p_expected_version
      or previous.action <> p_action or previous.inputs is distinct from p_values then
      raise exception 'Site settings command conflict' using errcode = 'P0001';
    end if;
    return previous.result;
  end if;
  if site.settings_version <> p_expected_version or site.archived_at is not null then
    raise exception 'Site settings version conflict or archived site' using errcode = 'P0001';
  end if;

  if p_action = 'archive' then
    if p_values is not null then raise invalid_parameter_value; end if;
    if exists (
      select 1 from public.interventions where site_id = p_site_id and status not in ('completed','paid','cancelled')
    ) then
      raise exception 'Site still has open interventions' using errcode = 'P0001';
    end if;
    update public.sites set archived_at = clock_timestamp(), settings_version = settings_version + 1
      where id = p_site_id returning * into site;
  else
    if jsonb_typeof(p_values) is distinct from 'object' then raise invalid_parameter_value; end if;
    if (p_values - array['name','address','access_notes','opening_hours']) <> '{}'::jsonb
      or jsonb_typeof(p_values->'name') is distinct from 'string'
      or jsonb_typeof(p_values->'address') is distinct from 'string'
      or jsonb_typeof(p_values->'access_notes') is distinct from 'string'
      or char_length(btrim(p_values->>'name')) not between 1 and 160
      or char_length(btrim(p_values->>'address')) not between 5 and 500
      or char_length(btrim(p_values->>'access_notes')) > 2000
      or not public.valid_site_hours(p_values->'opening_hours') then raise invalid_parameter_value; end if;

    update public.sites set name = btrim(p_values->>'name'), address = btrim(p_values->>'address'),
      access_notes = btrim(p_values->>'access_notes'), opening_hours = p_values->'opening_hours',
      settings_version = settings_version + 1
      where id = p_site_id returning * into site;
  end if;

  perform public.consume_action('site_settings', 20);
  snapshot = to_jsonb(site);
  insert into public.site_settings_commands (id, site_id, actor_id, expected_version, action, inputs, result)
    values (p_command_id, p_site_id, actor, p_expected_version, p_action, p_values, snapshot);
  insert into public.audit_log(actor_id, action)
    values (actor, 'site_settings:' || p_action || ':' || p_site_id::text || ':' || site.settings_version::text);
  return snapshot;
end;
$$;
revoke all on function public.write_site_settings(uuid, uuid, integer, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.write_site_settings(uuid, uuid, integer, text, jsonb) to authenticated;

commit;
