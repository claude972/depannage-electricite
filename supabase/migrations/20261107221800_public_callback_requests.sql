begin;

alter table public.platform_audit drop constraint platform_audit_target_kind_check;
alter table public.platform_audit add constraint platform_audit_target_kind_check
  check (target_kind in ('operator','super_admin','setting','reconciliation','ledger','invoice','refund_request','dispute','review','public_callback'));

create table public.public_callback_requests (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  reason text not null check (reason in ('new_request', 'existing_request', 'other')),
  consent_version integer not null default 1 check (consent_version = 1),
  version integer not null default 1 check (version in (1, 2)),
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  check ((version = 1 and closed_at is null) or (version = 2 and closed_at is not null and closed_at >= created_at))
);
create index public_callback_created on public.public_callback_requests (created_at desc, id desc);
create index public_callback_phone_created on public.public_callback_requests (phone, created_at desc);
alter table public.public_callback_requests enable row level security;
revoke all on public.public_callback_requests from public, anon, authenticated, service_role;

create function public.submit_public_callback(p_request_id uuid, p_phone text, p_reason text, p_consent boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  previous public.public_callback_requests;
  captured timestamptz;
begin
  if p_request_id is null or p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$'
    or p_reason is null or p_reason not in ('new_request', 'existing_request', 'other') or p_consent is distinct from true then
    raise invalid_parameter_value;
  end if;
  -- Technical limits apply across workers and precede every new insertion.
  perform pg_advisory_xact_lock(hashtextextended('courant.public_callback_intake', 0));
  select * into previous from public.public_callback_requests where request_id = p_request_id;
  if found then
    if (previous.phone, previous.reason) is distinct from (p_phone, p_reason) then
      raise exception 'Callback command changed' using errcode = 'P0001';
    end if;
    return true;
  end if;
  captured := clock_timestamp();
  if (select count(*) from public.public_callback_requests where created_at > captured - interval '1 minute') >= 30
    or (select count(*) from public.public_callback_requests where phone = p_phone and created_at > captured - interval '1 hour') >= 3 then
    raise exception 'Callback intake limited' using errcode = '53300';
  end if;
  insert into public.public_callback_requests(request_id, phone, reason, created_at)
    values (p_request_id, p_phone, p_reason, captured);
  return true;
end;
$$;
revoke all on function public.submit_public_callback(uuid, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.submit_public_callback(uuid, text, text, boolean) to service_role;

create function public.support_callback_queue(p_closed boolean, p_page integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_platform_scope('support_read') then raise insufficient_privilege; end if;
  if p_closed is null or p_page is null or p_page not between 1 and 1000000 then raise invalid_parameter_value; end if;
  return (
    with matching as not materialized (
      select id, phone, reason, version, created_at, closed_at from public.public_callback_requests
      where version = case when p_closed then 2 else 1 end
    ), batch as (
      select * from matching order by created_at desc, id desc limit 25 offset (p_page - 1) * 25
    )
    select jsonb_build_object('total', (select count(*) from matching),
      'items', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc, b.id desc) from batch b), '[]'::jsonb),
      'can_close', public.has_platform_scope('support_status'))
  );
end;
$$;
revoke all on function public.support_callback_queue(boolean, integer) from public, anon, authenticated, service_role;
grant execute on function public.support_callback_queue(boolean, integer) to authenticated;

create function public.close_support_callback(p_id uuid, p_expected_version integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  previous public.public_callback_requests;
begin
  -- Hold the current profile role before the grant locks, including implicit Super Admin authority.
  perform 1 from public.profiles where id = auth.uid() for share;
  if not found then raise insufficient_privilege; end if;
  if not public.lock_support_operator_permissions('set_status') then raise insufficient_privilege; end if;
  if p_id is null or p_expected_version is distinct from 1 then raise invalid_parameter_value; end if;
  select * into previous from public.public_callback_requests where id = p_id for update;
  if not found then raise no_data_found; end if;
  if not public.has_platform_scope('support_read') or not public.has_platform_scope('support_status') then
    raise insufficient_privilege;
  end if;
  if previous.version <> p_expected_version then
    raise exception 'Callback revision changed' using errcode = 'P0001';
  end if;
  perform public.consume_action('support_update', 30);
  update public.public_callback_requests set version = 2, closed_at = clock_timestamp() where id = p_id;
  perform public.platform_audit_write('callback_closed', 'public_callback', p_id::text, '{"version":2}'::jsonb);
  return true;
end;
$$;
revoke all on function public.close_support_callback(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.close_support_callback(uuid, integer) to authenticated;

commit;
