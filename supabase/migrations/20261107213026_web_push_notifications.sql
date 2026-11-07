begin;

create table notification_delivery_private.push_enrollments (
  recipient_id uuid primary key references public.profiles(id) on delete cascade,
  session_id uuid references auth.sessions(id) on delete set null,
  version integer not null default 1 check (version > 0),
  scope text check (scope ~ '^[a-f0-9]{64}$'),
  endpoint text unique check (length(endpoint) between 20 and 2048),
  p256dh text check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth_key text check (auth_key ~ '^[A-Za-z0-9_-]{22}$'),
  enrolled_at timestamptz,
  check ((session_id is null and num_nonnulls(scope, endpoint, p256dh, auth_key, enrolled_at) = 0)
    or (session_id is not null and num_nonnulls(scope, endpoint, p256dh, auth_key, enrolled_at) = 5))
);
alter table notification_delivery_private.push_enrollments enable row level security;
revoke all on notification_delivery_private.push_enrollments from public, anon, authenticated, service_role;

-- Auth sign-out clears the browser credentials. Keep the version to reject stale requests.
create function notification_delivery_private.clear_push_enrollment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.session_id is not null and new.session_id is null then
    new.version := old.version + 1;
    new.scope := null;
    new.endpoint := null;
    new.p256dh := null;
    new.auth_key := null;
    new.enrolled_at := null;
  end if;
  return new;
end;
$$;
revoke all on function notification_delivery_private.clear_push_enrollment() from public, anon, authenticated, service_role;
create trigger clear_push_enrollment before update of session_id on notification_delivery_private.push_enrollments
for each row execute function notification_delivery_private.clear_push_enrollment();

create function notification_delivery_private.revoke_push_preference()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.push_enabled and not new.push_enabled then
    update notification_delivery_private.push_enrollments set session_id = null
    where recipient_id = new.user_id and session_id is not null;
  end if;
  return new;
end;
$$;
revoke all on function notification_delivery_private.revoke_push_preference() from public, anon, authenticated, service_role;
create trigger revoke_push_preference after update of push_enabled on public.notification_preferences
for each row execute function notification_delivery_private.revoke_push_preference();

create function public.web_push_enrollment(
  p_actor uuid, p_session uuid, p_scope text, p_action text default 'read',
  p_expected integer default null, p_endpoint text default null, p_p256dh text default null, p_auth_key text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d notification_delivery_private.push_enrollments;
  allowed boolean;
  enabled boolean;
begin
  if not exists (select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = p_session and s.user_id = p_actor and not coalesce(u.is_anonymous, false)
      and (s.not_after is null or s.not_after > clock_timestamp())) then raise insufficient_privilege; end if;
  if p_action is null or p_action not in ('read', 'register', 'remove') or p_scope is null or p_scope !~ '^[a-f0-9]{64}$'
    or (p_action <> 'read' and (p_expected is null or p_expected < 0)) then raise invalid_parameter_value; end if;

  if p_action <> 'read' then
    -- Serialize browser changes and lock the consent row before checking opt-in.
    perform 1 from public.profiles where id = p_actor for update;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.notification_preferences where user_id = p_actor for share;
  end if;
  select coalesce((select push_enabled from public.notification_preferences where user_id = p_actor), false) into allowed;
  select coalesce((select c.enabled from notification_delivery_private.control c), false) into enabled;
  select * into d from notification_delivery_private.push_enrollments where recipient_id = p_actor;

  if p_action = 'register' then
    if not enabled or not allowed then raise insufficient_privilege; end if;
    if num_nonnulls(p_endpoint, p_p256dh, p_auth_key) <> 3 then raise invalid_parameter_value; end if;
    if d.session_id is distinct from p_session or d.scope is distinct from p_scope or d.endpoint is distinct from p_endpoint
      or d.p256dh is distinct from p_p256dh or d.auth_key is distinct from p_auth_key then
      if p_expected <> coalesce(d.version, 0) then raise exception 'Push browser changed' using errcode = 'P0001'; end if;
      insert into notification_delivery_private.push_enrollments(recipient_id, session_id, scope, endpoint, p256dh, auth_key, enrolled_at)
      values(p_actor, p_session, p_scope, p_endpoint, p_p256dh, p_auth_key, clock_timestamp())
      on conflict (recipient_id) do update set session_id = excluded.session_id, scope = excluded.scope,
        endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth_key = excluded.auth_key,
        enrolled_at = excluded.enrolled_at, version = push_enrollments.version + 1
      returning * into d;
    end if;
  elsif p_action = 'remove' and d.session_id is not null then
    if d.session_id <> p_session or d.scope <> p_scope or p_expected <> d.version then
      raise exception 'Push browser changed' using errcode = 'P0001';
    end if;
    update notification_delivery_private.push_enrollments set session_id = null where recipient_id = p_actor returning * into d;
  end if;
  return jsonb_build_object('version', coalesce(d.version, 0), 'opted_in', allowed, 'dispatch_enabled', enabled,
    'browser', case when d.session_id is null then 'none' when d.session_id = p_session and d.scope = p_scope then 'current' else 'other' end);
end;
$$;
revoke all on function public.web_push_enrollment(uuid, uuid, text, text, integer, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.web_push_enrollment(uuid, uuid, text, text, integer, text, text, text) to service_role;

-- Web Push does not provide durable provider idempotency. Mark the single allowed
-- attempt before returning the endpoint, and never use the shared retrying claim.
create function public.claim_web_push(p_scope text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item notification_delivery_private.outbox;
  target notification_delivery_private.push_enrollments;
begin
  if p_scope is null or p_scope !~ '^[a-f0-9]{64}$' then raise invalid_parameter_value; end if;
  if not exists (select 1 from notification_delivery_private.control where enabled) then return null; end if;
  select * into item from notification_delivery_private.outbox
  where channel = 'push' and ((provider is null and status = 'pending' and attempts = 0
    and (created_at <= clock_timestamp() - interval '5 minutes' or exists (
      select 1 from public.notifications n join notification_delivery_private.push_enrollments d on d.recipient_id = n.recipient_id
      where n.id = outbox.notification_id and d.scope = p_scope
    )))
    or (provider = 'webpush' and status = 'sending' and lease_until <= clock_timestamp()))
  order by created_at, id limit 1 for update skip locked;
  if not found then return null; end if;
  if item.status = 'sending' then
    update notification_delivery_private.outbox set status = 'uncertain', may_have_been_accepted = true,
      lease_token = null, lease_until = null, updated_at = clock_timestamp() where id = item.id;
    return jsonb_build_object('skipped', true);
  end if;
  select d.* into target from public.notifications n
  join notification_delivery_private.push_enrollments d on d.recipient_id = n.recipient_id
  join auth.sessions s on s.id = d.session_id and s.user_id = d.recipient_id
  where n.id = item.notification_id and n.read_at is null and d.scope = p_scope
    and (s.not_after is null or s.not_after > clock_timestamp())
    and d.enrolled_at <= item.created_at and item.created_at > clock_timestamp() - interval '5 minutes';
  if not found or not exists (select 1 from notification_delivery_private.control where enabled and generation = item.activation_generation)
    or not notification_delivery_private.eligible(item.notification_id, 'push') then
    update notification_delivery_private.outbox set status = 'cancelled', retry_stopped = true,
      updated_at = clock_timestamp() where id = item.id;
    return jsonb_build_object('skipped', true);
  end if;
  update notification_delivery_private.outbox set status = 'sending', provider = 'webpush', attempts = 1,
    retry_stopped = true, lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '60 seconds',
    updated_at = clock_timestamp() where id = item.id returning * into item;
  return jsonb_build_object('id', item.id, 'lease_token', item.lease_token, 'enrollment_version', target.version, 'endpoint', target.endpoint,
    'p256dh', target.p256dh, 'auth_key', target.auth_key);
end;
$$;
revoke all on function public.claim_web_push(text) from public, anon, authenticated, service_role;
grant execute on function public.claim_web_push(text) to service_role;

create function public.finish_web_push(p_id uuid, p_lease uuid, p_outcome text, p_enrollment_version integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare notification uuid;
begin
  if p_outcome is null or p_outcome not in ('accepted', 'failed', 'expired', 'uncertain')
    or p_enrollment_version is null or p_enrollment_version < 1 then raise invalid_parameter_value; end if;
  update notification_delivery_private.outbox set status = case when p_outcome = 'expired' then 'failed' else p_outcome end,
    may_have_been_accepted = p_outcome in ('accepted', 'uncertain'), lease_token = null, lease_until = null,
    updated_at = clock_timestamp()
  where id = p_id and provider = 'webpush' and channel = 'push' and status = 'sending' and retry_stopped
    and lease_token = p_lease and lease_until > clock_timestamp()
  returning notification_id into notification;
  if not found then return false; end if;
  if p_outcome = 'expired' then
    update notification_delivery_private.push_enrollments d set session_id = null from public.notifications n
    where n.id = notification and d.recipient_id = n.recipient_id and d.version = p_enrollment_version and d.session_id is not null;
  end if;
  return true;
end;
$$;
revoke all on function public.finish_web_push(uuid, uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.finish_web_push(uuid, uuid, text, integer) to service_role;

commit;
