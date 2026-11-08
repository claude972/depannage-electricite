begin;

-- PostgreSQL repetition bounds stop at 255; check the secret length separately.
create or replace function notification_delivery_private.dispatch_due()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  dispatch_origin text;
  dispatch_secret text;
  candidate_channel text;
  queued_count integer := 0;
  checked_role text;
  checked_relation regclass;
  checked_at timestamptz := clock_timestamp();
begin
  if current_user <> 'postgres' then
    raise insufficient_privilege;
  end if;

  if not exists (select 1 from notification_delivery_private.control where enabled)
    or not pg_try_advisory_xact_lock(hashtextextended('scheduler:external-notification-dispatch', 0)) then
    return 0;
  end if;

  if to_regclass('vault.decrypted_secrets') is null
    or to_regclass('net.http_request_queue') is null
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'Notification dispatch requires Vault and pg_net';
  end if;

  -- The authorization header remains in the pg_net request queue until dispatch.
  foreach checked_relation in array array['vault.decrypted_secrets'::regclass, 'net.http_request_queue'::regclass]
  loop
    foreach checked_role in array array['anon', 'authenticated', 'authenticator', 'service_role']
    loop
      if has_table_privilege(checked_role, checked_relation, 'SELECT,INSERT,UPDATE,DELETE')
        or has_any_column_privilege(checked_role, checked_relation, 'SELECT,INSERT,UPDATE') then
        raise exception 'Notification dispatch requires private Vault and pg_net request storage';
      end if;
    end loop;
  end loop;

  select decrypted_secret into strict dispatch_origin
  from vault.decrypted_secrets where name = 'depannage_notification_dispatch_origin';
  select decrypted_secret into strict dispatch_secret
  from vault.decrypted_secrets where name = 'depannage_notification_dispatch_secret';

  if dispatch_origin is null
    or char_length(dispatch_origin) > 261
    or dispatch_origin !~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    or dispatch_secret is null
    or char_length(dispatch_secret) not between 32 and 256
    or dispatch_secret !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invalid notification dispatch configuration';
  end if;

  for candidate_channel in
    select distinct item.channel
    from notification_delivery_private.outbox as item
    where not item.retry_stopped
      and (
        (item.channel = 'email' and (item.provider is null or item.provider = 'resend')
          and ((item.status in ('pending', 'uncertain') and item.attempts < 3 and item.next_attempt_at <= checked_at)
            or (item.status in ('leased', 'sending') and item.lease_until <= checked_at)))
        or (item.channel = 'push'
          and ((item.provider is null and item.status = 'pending' and item.attempts = 0)
            or (item.provider = 'webpush' and item.status = 'sending' and item.lease_until <= checked_at)))
      )
  loop
    perform net.http_post(
      url := dispatch_origin || '/api/internal/notifications/' || candidate_channel,
      headers := jsonb_build_object('Authorization', 'Bearer ' || dispatch_secret, 'Content-Type', 'application/json'),
      timeout_milliseconds := 60000
    );
    queued_count := queued_count + 1;
  end loop;

  return queued_count;
end;
$$;

commit;
