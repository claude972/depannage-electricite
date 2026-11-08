begin;

create function notification_delivery_private.dispatch_due()
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
    or dispatch_secret !~ '^[A-Za-z0-9_-]{32,256}$' then
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

revoke all on function notification_delivery_private.dispatch_due() from public, anon, authenticated, service_role;

do $$
declare
  job_name constant text := 'depannage_external_notification_dispatch_v1';
  job_command constant text := 'select notification_delivery_private.dispatch_due();';
  job_record record;
  job_count integer;
begin
  if current_user <> 'postgres'
    or to_regclass('cron.job') is null
    or to_regprocedure('cron.schedule_in_database(text,text,text,text,text,boolean)') is null then
    raise exception 'Notification dispatch requires the application pg_cron scheduler and postgres installer';
  end if;

  if has_schema_privilege('anon', 'cron', 'USAGE')
    or has_schema_privilege('authenticated', 'cron', 'USAGE') then
    raise insufficient_privilege;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('scheduler:external-notification-dispatch-install:' || current_database(), 0));
  select count(*) into job_count from cron.job where jobname = job_name and username = current_user;
  if job_count = 0 then
    perform cron.schedule_in_database(job_name, '* * * * *', job_command, current_database(), active := false);
  elsif job_count <> 1 then
    raise exception 'Notification dispatch scheduler collision';
  end if;

  select * into job_record from cron.job where jobname = job_name and username = current_user;
  if not found
    or job_record.command is distinct from job_command
    or job_record.schedule is distinct from '* * * * *'
    or job_record.database is distinct from current_database()
    or job_record.active is distinct from false
    or job_record.nodename is distinct from 'localhost'
    or job_record.nodeport is distinct from inet_server_port() then
    raise exception 'Incompatible notification dispatch scheduler target';
  end if;
end;
$$;

commit;
