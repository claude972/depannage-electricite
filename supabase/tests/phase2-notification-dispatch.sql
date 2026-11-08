-- Run as postgres in the disposable native test database with Vault and pg_net
-- installed and the pg_net worker pointed at a different, nonexistent database.
-- Every queued request and every fixture is rolled back.
\set ON_ERROR_STOP on
\set VERBOSITY verbose
begin;

do $$
declare
  recipient uuid := gen_random_uuid();
  queued integer;
  paths text[];
  fixture_secret text := repeat('Z', 256);
begin
  if current_user <> 'postgres' or inet_server_addr() <> '127.0.0.1'::inet
    or current_setting('pg_net.database_name', true) <> 'phase3_never_run_worker'
    or exists (select 1 from net.http_request_queue)
    or exists (select 1 from vault.decrypted_secrets where name like 'depannage_notification_dispatch_%')
    or exists (select 1 from notification_delivery_private.outbox) then
    raise exception 'Run only in the isolated empty native fixture';
  end if;

  revoke all on vault.decrypted_secrets, net.http_request_queue from public, anon, authenticated, authenticator, service_role;
  perform vault.create_secret('https://dispatch.example.test', 'depannage_notification_dispatch_origin');
  perform vault.create_secret(fixture_secret, 'depannage_notification_dispatch_secret');
  insert into auth.users (id, email, email_confirmed_at) values (recipient, 'recipient@example.test', now());
  insert into public.notification_preferences (user_id, email_enabled, push_enabled) values (recipient, true, true);
  update notification_delivery_private.control set enabled = true;
  insert into public.notifications (recipient_id, kind, title, body, dedupe_key)
    values (recipient, 'message_received', 'Test', 'Fixture de recette.', gen_random_uuid()::text),
           (recipient, 'message_received', 'Test', 'Deuxième ligne de recette.', gen_random_uuid()::text);
  if (select count(*) from notification_delivery_private.outbox) <> 4 then
    raise exception 'Expected two ready items per channel';
  end if;

  queued := notification_delivery_private.dispatch_due();
  select array_agg(url order by url) into paths from net.http_request_queue;
  if queued <> 2 or paths is distinct from array[
    'https://dispatch.example.test/api/internal/notifications/email',
    'https://dispatch.example.test/api/internal/notifications/push'
  ] or exists (
    select 1 from net.http_request_queue
    where headers->>'Authorization' is distinct from ('Bearer ' || fixture_secret)
      or convert_from(body, 'UTF8')::jsonb is distinct from '{}'::jsonb
  ) then
    raise exception 'Expected one authenticated JSON request per channel';
  end if;

end;
$$;

rollback;
