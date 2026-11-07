begin;

create table public.platform_public_profile_versions (
  version integer primary key check (version > 0),
  command_id uuid unique not null,
  actor_id uuid not null references public.profiles(id),
  action text not null check (action in ('save','publish','withdraw')),
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_public_profile_versions enable row level security;
revoke all on public.platform_public_profile_versions from public, anon, authenticated, service_role;

create function public.valid_public_operator_profile(p_profile jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  entry record;
  max_chars integer;
  value_text text;
begin
  if jsonb_typeof(p_profile) is distinct from 'object' then return false; end if;
  for entry in select key, value from jsonb_each(p_profile) loop
    max_chars := case entry.key
      when 'about_text' then 2000
      when 'hq_address' then 500
      when 'host_address' then 500
      when 'public_email' then 254
      when 'privacy_email' then 254
      when 'host_contact' then 254
      when 'public_phone' then 16
      when 'siren' then 9
      when 'vat_number' then 16
      when 'legal_name' then 160
      when 'legal_form' then 80
      when 'publication_director' then 160
      when 'display_name' then 120
      when 'host_name' then 160
      when 'rights_holder' then 160
      when 'service_area' then 500
      else 0
    end;
    if max_chars = 0 or jsonb_typeof(entry.value) <> 'string' then return false; end if;
    value_text := entry.value #>> '{}';
    if char_length(value_text) not between 1 and max_chars or btrim(value_text) <> value_text then return false; end if;
    if entry.key in ('public_email','privacy_email') and value_text !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then return false; end if;
    if entry.key = 'public_phone' and value_text !~ '^[+][1-9][0-9]{6,14}$' then return false; end if;
    if entry.key = 'siren' and value_text !~ '^[0-9]{9}$' then return false; end if;
    if entry.key = 'vat_number' and value_text !~ '^[A-Z]{2}[0-9A-Z]{2,14}$' then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.valid_public_operator_profile(jsonb) from public, anon, authenticated, service_role;

create function public.read_public_operator_profile()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when v.action = 'publish'
    then jsonb_build_object('version', v.version, 'profile', v.profile, 'published_at', v.created_at)
    else null end
  from public.platform_public_profile_versions v where v.action in ('publish','withdraw')
  order by v.version desc limit 1
$$;
revoke all on function public.read_public_operator_profile() from public, anon, authenticated, service_role;
grant execute on function public.read_public_operator_profile() to anon, authenticated;

create function public.read_operator_profile_editor()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  latest public.platform_public_profile_versions;
begin
  if not public.is_admin() then raise insufficient_privilege; end if;
  select * into latest from public.platform_public_profile_versions order by version desc limit 1;
  return jsonb_build_object(
    'version', coalesce(latest.version, 0),
    'draft', coalesce(latest.profile, '{}'::jsonb),
    'published', public.read_public_operator_profile()
  );
end;
$$;
revoke all on function public.read_operator_profile_editor() from public, anon, authenticated, service_role;
grant execute on function public.read_operator_profile_editor() to authenticated;

create function public.write_operator_profile(
  p_command_id uuid, p_expected_version integer, p_action text, p_profile jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  latest public.platform_public_profile_versions;
  written public.platform_public_profile_versions;
  profile_to_write jsonb;
begin
  if actor is null then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id = actor and role = 'admin' for share;
  if not found then raise insufficient_privilege; end if;
  if p_command_id is null or p_expected_version is null or p_expected_version not between 0 and 2147483646
    or p_action is null or p_action not in ('save','publish','withdraw')
    or (p_action <> 'save' and p_profile is not null) then raise invalid_parameter_value; end if;
  perform pg_advisory_xact_lock(hashtextextended('platform:public_operator_profile', 0));

  select * into written from public.platform_public_profile_versions where command_id = p_command_id;
  if found then
    if written.actor_id <> actor or written.version <> p_expected_version + 1 or written.action <> p_action
      or (p_action = 'save' and written.profile is distinct from p_profile) then
      raise exception 'Public profile command conflict' using errcode = 'P0001';
    end if;
  else
    select * into latest from public.platform_public_profile_versions order by version desc limit 1;
    if coalesce(latest.version, 0) <> p_expected_version then
      raise exception 'Public profile version conflict' using errcode = 'P0001';
    end if;

    if p_action = 'save' then
      if not public.valid_public_operator_profile(p_profile) then raise invalid_parameter_value; end if;
      profile_to_write := p_profile;
    else
      profile_to_write := latest.profile;
      if p_action = 'publish' and (profile_to_write is null or not profile_to_write ?& array[
        'legal_name','legal_form','siren','hq_address','publication_director','public_email',
        'privacy_email','host_name','host_address','host_contact','rights_holder'
      ]) then raise invalid_parameter_value; end if;
      if p_action = 'withdraw' and public.read_public_operator_profile() is null then
        raise exception 'No public profile is published' using errcode = 'P0001';
      end if;
    end if;

    perform public.consume_action('public_operator_profile', 20);
    insert into public.platform_public_profile_versions(version, command_id, actor_id, action, profile)
      values(p_expected_version + 1, p_command_id, actor, p_action, profile_to_write) returning * into written;
    insert into public.audit_log(actor_id, action)
      values(actor, 'public_operator_profile:' || p_action || ':' || written.version::text);
  end if;
  return jsonb_build_object('version', written.version, 'action', written.action);
end;
$$;
revoke all on function public.write_operator_profile(uuid, integer, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.write_operator_profile(uuid, integer, text, jsonb) to authenticated;

commit;
