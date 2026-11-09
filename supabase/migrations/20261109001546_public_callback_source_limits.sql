begin;

alter table public.public_callback_requests
  add column if not exists source_key text check (source_key ~ '^[0-9a-f]{64}$');
create index if not exists public_callback_source_created
  on public.public_callback_requests (source_key, created_at desc);

create or replace function public.submit_public_callback(
  p_request_id uuid, p_phone text, p_reason text, p_consent boolean, p_source_key text
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  previous public.public_callback_requests;
  captured timestamptz;
  source_until timestamptz;
  phone_until timestamptz;
  blocked_until timestamptz;
  legacy_source constant text := repeat('0', 64);
begin
  if p_request_id is null or p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$'
    or p_reason is null or p_reason not in ('new_request', 'existing_request', 'other')
    or p_consent is distinct from true or p_source_key is null or p_source_key !~ '^[0-9a-f]{64}$' then
    raise invalid_parameter_value;
  end if;
  -- Keep replay and the two quotas atomic even when different sources target the same number.
  perform pg_advisory_xact_lock(hashtextextended('courant.public_callback_intake', 0));
  select * into previous from public.public_callback_requests where request_id = p_request_id;
  if found then
    if (previous.phone, previous.reason) is distinct from (p_phone, p_reason) then
      raise exception 'Callback command changed' using errcode = 'P0001';
    end if;
    return 0;
  end if;

  captured := clock_timestamp();
  select r.created_at + interval '1 minute' into source_until
    from public.public_callback_requests r
    where (r.source_key = p_source_key or (p_source_key = legacy_source and r.source_key is null))
      and r.created_at > captured - interval '1 minute'
    order by r.created_at desc limit 1 offset 29;
  select r.created_at + interval '1 hour' into phone_until
    from public.public_callback_requests r
    where r.phone = p_phone and r.created_at > captured - interval '1 hour'
    order by r.created_at desc limit 1 offset 2;
  blocked_until := greatest(source_until, phone_until);
  if blocked_until is not null then
    return greatest(1, ceil(extract(epoch from (blocked_until - captured))))::integer;
  end if;

  insert into public.public_callback_requests (request_id, phone, reason, created_at, source_key)
    values (p_request_id, p_phone, p_reason, captured, p_source_key);
  return 0;
end;
$$;
revoke all on function public.submit_public_callback(uuid, text, text, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.submit_public_callback(uuid, text, text, boolean, text) to service_role;

-- Preserve the pre-migration application contract for a database-first rollout.
create or replace function public.submit_public_callback(p_request_id uuid, p_phone text, p_reason text, p_consent boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if public.submit_public_callback(p_request_id, p_phone, p_reason, p_consent, repeat('0', 64)) <> 0 then
    raise exception 'Callback intake limited' using errcode = '53300';
  end if;
  return true;
end;
$$;

commit;
