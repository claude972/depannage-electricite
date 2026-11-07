begin;

create table public.platform_coverage_versions (
  version integer primary key check (version > 0),
  command_id uuid not null unique,
  actor_id uuid not null references public.profiles(id),
  postal_codes text[] not null check (cardinality(postal_codes) <= 250),
  created_at timestamptz not null default now()
);
alter table public.platform_coverage_versions enable row level security;
revoke all on public.platform_coverage_versions from public, anon, authenticated, service_role;

create function public.read_public_coverage(p_postal_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare latest public.platform_coverage_versions;
begin
  if p_postal_code is null or p_postal_code !~ '^[0-9]{5}$' then raise invalid_parameter_value; end if;
  select * into latest from public.platform_coverage_versions order by version desc limit 1;
  if not found or cardinality(latest.postal_codes) = 0 then
    return jsonb_build_object('status', 'unknown', 'version', null);
  end if;
  return jsonb_build_object(
    'status', case when p_postal_code = any(latest.postal_codes) then 'covered' else 'not_covered' end,
    'version', latest.version
  );
end;
$$;

create function public.read_coverage_editor()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare latest public.platform_coverage_versions;
begin
  if not public.is_admin() then raise insufficient_privilege; end if;
  select * into latest from public.platform_coverage_versions order by version desc limit 1;
  return jsonb_build_object('version', coalesce(latest.version, 0),
    'postal_codes', coalesce(latest.postal_codes, array[]::text[]));
end;
$$;

create function public.write_coverage(
  p_command_id uuid, p_expected_version integer, p_action text, p_postal_codes text[] default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  current_version integer;
  codes text[];
  recorded public.platform_coverage_versions;
begin
  perform 1 from public.profiles where id = actor and role = 'admin' for share;
  if not found then raise insufficient_privilege; end if;
  if p_command_id is null or p_expected_version is null or p_expected_version not between 0 and 2147483646
    or p_action is null or p_action not in ('publish', 'withdraw') then
    raise invalid_parameter_value;
  end if;
  if p_action = 'publish' then
    if p_postal_codes is null or array_ndims(p_postal_codes) is distinct from 1
      or cardinality(p_postal_codes) not between 1 and 250
      or exists (select 1 from unnest(p_postal_codes) code where code is null or code !~ '^[0-9]{5}$') then
      raise invalid_parameter_value;
    end if;
    select array_agg(distinct code order by code) into codes from unnest(p_postal_codes) code;
    if cardinality(codes) <> cardinality(p_postal_codes) then raise invalid_parameter_value; end if;
  else
    if p_postal_codes is not null then raise invalid_parameter_value; end if;
    codes := array[]::text[];
  end if;

  perform pg_advisory_xact_lock(hashtextextended('platform:postal_coverage', 0));
  select * into recorded from public.platform_coverage_versions where command_id = p_command_id;
  if found then
    if recorded.actor_id <> actor or recorded.version <> p_expected_version + 1
      or recorded.postal_codes is distinct from codes then
      raise unique_violation;
    end if;
    return jsonb_build_object('version', recorded.version, 'postal_codes', recorded.postal_codes, 'replayed', true);
  end if;

  select coalesce(max(version), 0) into current_version from public.platform_coverage_versions;
  if current_version <> p_expected_version then
    raise exception 'Coverage changed' using errcode = 'P0001';
  end if;
  perform public.consume_action('platform_postal_coverage', 10);
  insert into public.platform_coverage_versions(version, command_id, actor_id, postal_codes)
  values (current_version + 1, p_command_id, actor, codes)
  returning * into recorded;
  insert into public.audit_log(actor_id, action) values (actor, 'platform_postal_coverage:' || p_action);
  return jsonb_build_object('version', recorded.version, 'postal_codes', recorded.postal_codes, 'replayed', false);
end;
$$;

revoke all on function public.read_public_coverage(text), public.read_coverage_editor(),
  public.write_coverage(uuid, integer, text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.read_public_coverage(text) to anon, authenticated;
grant execute on function public.read_coverage_editor(),
  public.write_coverage(uuid, integer, text, text[]) to authenticated;
commit;
