begin;

create table public.personal_payment_reminders (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  remind_at timestamptz not null,
  version integer not null default 1 check (version > 0),
  status text not null check (status in ('scheduled', 'cancelled', 'sent', 'invalidated', 'muted')),
  notification_id uuid references public.notifications(id) on delete set null,
  processed_at timestamptz,
  unique (recipient_id, quote_id),
  check ((status = 'scheduled') = (processed_at is null))
);
create index personal_payment_reminders_due on public.personal_payment_reminders (remind_at, id)
  where status = 'scheduled';
alter table public.personal_payment_reminders enable row level security;
revoke all on public.personal_payment_reminders from public, anon, authenticated, service_role;

-- Return a minimal decision; the provider account and exact amount are used only in the hash.
create function public.payment_reminder_source(p_quote uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.interventions;
  checkout jsonb;
  binding_version integer;
begin
  select i.* into job from public.interventions i join public.quotes q on q.intervention_id = i.id
    where q.id = p_quote;
  if not found or not public.platform_checkout_can_pay(job.id, p_actor) then
    return null;
  end if;

  if job.status <> 'completed'
    or exists (select 1 from public.sites where id = job.site_id and archived_at is not null)
    or exists (select 1 from public.payments where quote_id = p_quote and (status in ('pending', 'paid') or method <> 'stripe'))
    or exists (select 1 from public.platform_checkouts where quote_id = p_quote and status <> 'expired') then
    return jsonb_build_object('intervention_id', job.id, 'site_id', job.site_id, 'fingerprint', null);
  end if;
  begin
    checkout := public.platform_checkout_source(p_quote, p_actor);
  exception when no_data_found or raise_exception then
    return jsonb_build_object('intervention_id', job.id, 'site_id', job.site_id, 'fingerprint', null);
  end;

  select version into binding_version from public.intervention_payers
    where intervention_id = job.id and payer_id = p_actor;
  return jsonb_build_object(
    'intervention_id', job.id,
    'site_id', job.site_id,
    'fingerprint', encode(sha256(convert_to(
      (checkout || jsonb_build_object('site_id', job.site_id, 'payer_version', binding_version))::text, 'UTF8'
    )), 'hex')
  );
end;
$$;
revoke all on function public.payment_reminder_source(uuid, uuid) from public, anon, authenticated, service_role;

create function public.lock_payment_reminder_source(p_quote uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_id uuid;
begin
  select intervention_id into job_id from public.quotes where id = p_quote;
  if job_id is not null then
    perform public.lock_intervention_organization(job_id);
    perform 1 from public.interventions where id = job_id for update;
    perform 1 from public.quotes where id = p_quote and intervention_id = job_id for update;
    if not found then raise serialization_failure; end if;
  end if;
end;
$$;
revoke all on function public.lock_payment_reminder_source(uuid) from public, anon, authenticated, service_role;

create function public.payment_reminder_projection(r public.personal_payment_reminders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'quote_id', r.quote_id, 'version', r.version, 'remind_at', r.remind_at,
    'status', r.status, 'notification_id', r.notification_id, 'processed_at', r.processed_at
  );
$$;
revoke all on function public.payment_reminder_projection(public.personal_payment_reminders)
  from public, anon, authenticated, service_role;

create function public.read_payment_reminder(p_quote uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  source jsonb;
  reminder public.personal_payment_reminders;
begin
  if actor is null then raise insufficient_privilege; end if;
  source := public.payment_reminder_source(p_quote, actor);
  if source is null then raise no_data_found; end if;

  select * into reminder from public.personal_payment_reminders
    where recipient_id = actor and quote_id = p_quote;
  return jsonb_build_object(
    'quote_id', p_quote, 'can_schedule', source->>'fingerprint' is not null,
    'reminder', case when reminder.id is null then null else public.payment_reminder_projection(reminder) end
  );
end;
$$;
revoke all on function public.read_payment_reminder(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_payment_reminder(uuid) to authenticated;

create function public.write_payment_reminder(
  p_quote uuid, p_command uuid, p_action text, p_expected integer, p_remind_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  source jsonb;
  fingerprint jsonb;
  prior public.operational_reminder_commands;
  reminder public.personal_payment_reminders;
  result jsonb;
begin
  if actor is null then raise insufficient_privilege; end if;
  if p_quote is null or p_command is null or p_action is null or p_action not in ('schedule', 'cancel')
    or (p_expected is not null and p_expected not between 1 and 2147483645)
    or (p_action = 'schedule' and (p_remind_at is null or not isfinite(p_remind_at)))
    or (p_action = 'cancel' and (p_expected is null or p_remind_at is not null)) then
    raise invalid_parameter_value;
  end if;

  if public.payment_reminder_source(p_quote, actor) is null then raise no_data_found; end if;
  perform public.lock_payment_reminder_source(p_quote);
  source := public.payment_reminder_source(p_quote, actor);
  if source is null then raise no_data_found; end if;

  fingerprint := jsonb_build_object('action', p_action, 'expected', p_expected, 'remind_at', p_remind_at);
  select * into prior from public.operational_reminder_commands where command_id = p_command;
  if found then
    if prior.actor_id <> actor or prior.kind <> 'payment' or prior.record_id <> p_quote
      or prior.fingerprint is distinct from fingerprint then
      raise exception 'Reminder command conflict' using errcode = 'P0001';
    end if;
    return jsonb_build_object('reminder', prior.result, 'replayed', true);
  end if;

  select * into reminder from public.personal_payment_reminders
    where recipient_id = actor and quote_id = p_quote for update;
  if reminder.version is distinct from p_expected then
    raise exception 'Reminder revision conflict' using errcode = 'P0001';
  end if;

  perform public.consume_action('payment_reminder', 20);
  if p_action = 'schedule' then
    if source->>'fingerprint' is null then
      raise exception 'Payment cannot be reminded' using errcode = 'P0001';
    end if;
    if p_remind_at < clock_timestamp() + interval '5 minutes' or p_remind_at > clock_timestamp() + interval '90 days' then
      raise invalid_parameter_value;
    end if;

    insert into public.personal_payment_reminders(recipient_id, quote_id, source_fingerprint, remind_at, status)
      values (actor, p_quote, source->>'fingerprint', p_remind_at, 'scheduled')
    on conflict (recipient_id, quote_id) do update
      set source_fingerprint = excluded.source_fingerprint, remind_at = excluded.remind_at,
          status = 'scheduled', version = personal_payment_reminders.version + 1,
          notification_id = null, processed_at = null
    returning * into reminder;
  else
    if reminder.status <> 'scheduled' then
      raise exception 'Reminder already processed' using errcode = 'P0001';
    end if;
    update public.personal_payment_reminders
      set status = 'cancelled', version = version + 1, processed_at = clock_timestamp()
      where id = reminder.id returning * into reminder;
  end if;

  result := public.payment_reminder_projection(reminder);
  insert into public.operational_reminder_commands(command_id, actor_id, kind, record_id, fingerprint, result)
    values (p_command, actor, 'payment', p_quote, fingerprint, result);
  return jsonb_build_object('reminder', result, 'replayed', false);
end;
$$;
revoke all on function public.write_payment_reminder(uuid, uuid, text, integer, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.write_payment_reminder(uuid, uuid, text, integer, timestamptz) to authenticated;

create function public.emit_due_payment_reminders(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  reminder public.personal_payment_reminders;
  source jsonb;
  notification uuid;
  dedupe text;
  outcome text;
  processed integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('scheduler:personal-payment-reminders', 0)) then return 0; end if;

  for candidate in
    select id, quote_id from public.personal_payment_reminders
      where status = 'scheduled' and remind_at <= clock_timestamp()
      order by remind_at, id limit p_limit
  loop
    perform public.lock_payment_reminder_source(candidate.quote_id);
    select * into reminder from public.personal_payment_reminders
      where id = candidate.id and status = 'scheduled' and remind_at <= clock_timestamp()
      for update skip locked;
    if not found then continue; end if;

    source := public.payment_reminder_source(reminder.quote_id, reminder.recipient_id);
    notification := null;
    outcome := 'invalidated';
    if source->>'fingerprint' = reminder.source_fingerprint then
      perform pg_advisory_xact_lock(hashtext('notification_preferences'), hashtext(reminder.recipient_id::text));
      dedupe := 'personal-payment-reminder:' || reminder.id::text || ':' || reminder.version::text;
      perform public.notify(
        reminder.recipient_id, 'payment_reminder', 'Votre rappel de règlement',
        'Vous aviez demandé un rappel pour ce dossier. Ouvrez-le pour vérifier le règlement et les actions disponibles.',
        dedupe, (source->>'intervention_id')::uuid, null, (source->>'site_id')::uuid,
        null, jsonb_build_object('quote_id', reminder.quote_id)
      );
      select id into notification from public.notifications
        where recipient_id = reminder.recipient_id and dedupe_key = dedupe;
      outcome := case when notification is null then 'muted' else 'sent' end;
    end if;

    update public.personal_payment_reminders
      set status = outcome, version = version + 1, notification_id = notification, processed_at = clock_timestamp()
      where id = reminder.id;
    processed := processed + 1;
  end loop;
  return processed;
end;
$$;
revoke all on function public.emit_due_payment_reminders(integer) from public, anon, authenticated, service_role;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in('mission_assigned','mission_received','mission_reassigned','quote_received','quote_rejected','quote_accepted','work_started','work_completed','payment_confirmed','mission_cancelled','appointment_saved','message_received','account_approved','account_suspended','approval_requested','approval_decided','support_replied','support_status_changed','member_joined','membership_removed','appointment_reminder','credential_reminder','compliance_reminder','payment_reminder'));
create or replace function public.save_notification_preferences(p_muted_kinds text[],p_email boolean,p_sms boolean,p_push boolean,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare prefs public.notification_preferences; current_version integer; kinds text[];
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if p_muted_kinds is null or p_email is null or p_sms is null or p_push is null or p_expected_version is null or p_expected_version<0 or cardinality(p_muted_kinds)>30 then raise invalid_parameter_value; end if;
 select coalesce(array_agg(distinct k order by k),'{}') into kinds from unnest(p_muted_kinds) k;
 if exists(select 1 from unnest(kinds) k where k is null or k not in ('mission_assigned','mission_received','mission_reassigned','quote_received','quote_rejected','quote_accepted','work_started','work_completed','payment_confirmed','mission_cancelled','appointment_saved','message_received','account_approved','account_suspended','approval_requested','approval_decided','support_replied','support_status_changed','member_joined','membership_removed','appointment_reminder','credential_reminder','compliance_reminder','payment_reminder')) then raise invalid_parameter_value; end if;
 -- Serialize the caller's saves BEFORE the read: a first save has no row to lock, so two concurrent
 -- "expected_version 0" writers would otherwise both see "absent". This lock is the only lock of
 -- this function (no table row lock precedes it), so it cannot take part in a cycle.
 perform pg_advisory_xact_lock(hashtext('notification_preferences'),hashtext(auth.uid()::text));
 select * into prefs from public.notification_preferences where user_id=auth.uid() for update;
 current_version=coalesce(prefs.version,0);
 if current_version<>p_expected_version or current_version=2147483647 then raise exception 'Preferences revision changed' using errcode='P0001'; end if;
 perform public.consume_action('notifications',60);
 -- Compare-and-set on the version as a second barrier: the update applies only to the revision read.
 insert into public.notification_preferences(user_id,muted_kinds,email_enabled,sms_enabled,push_enabled,version)
 values(auth.uid(),kinds,p_email,p_sms,p_push,current_version+1)
 on conflict(user_id) do update set muted_kinds=excluded.muted_kinds,email_enabled=excluded.email_enabled,sms_enabled=excluded.sms_enabled,push_enabled=excluded.push_enabled,version=excluded.version,updated_at=now()
 where public.notification_preferences.version=p_expected_version
 returning * into prefs;
 if prefs.user_id is null then raise exception 'Preferences revision changed' using errcode='P0001'; end if;
 return jsonb_build_object('preferences',to_jsonb(prefs));
end; $$;


create or replace function notification_delivery_private.enqueue()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.kind = 'payment_reminder' then return new; end if;
 -- AFTER INSERT only: no historical scan, no enqueue on mark-read or preference changes.
 begin
  insert into notification_delivery_private.outbox(notification_id,channel,activation_generation)
   select new.id,c,ctl.generation from notification_delivery_private.control ctl cross join unnest(array['email','push'])c where ctl.enabled and notification_delivery_private.eligible(new.id,c)
   on conflict(notification_id,channel)do nothing;
 exception when others then
  -- The original in-app notification must commit even when this optional subsystem fails.
  begin
   insert into notification_delivery_private.enqueue_failures(notification_id,error_code)values(new.id,sqlstate)on conflict do nothing;
  exception when others then raise warning 'External notification enqueue failure could not be recorded';end;
 end;
 return new;
end;$$;
revoke all on function notification_delivery_private.enqueue()from public,anon,authenticated,service_role;

-- Provision an inactive job so a fresh deployment cannot emit before its environment is configured.
do $$
declare
  job_name constant text := 'depannage_personal_payment_reminders_v1';
  job_command constant text := 'select public.emit_due_payment_reminders(20);';
  job_record record;
begin
  if current_user <> 'postgres'
    or to_regclass('cron.job') is null
    or to_regprocedure('cron.schedule_in_database(text,text,text,text,text,boolean)') is null
    or has_schema_privilege('anon', 'cron', 'USAGE')
    or has_schema_privilege('authenticated', 'cron', 'USAGE') then
    raise exception 'Personal payment reminders require the private application scheduler';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('scheduler:personal-payment-reminders-install:' || current_database(), 0));
  if not exists (select 1 from cron.job where jobname = job_name and username = current_user) then
    perform cron.schedule_in_database(job_name, '* * * * *', job_command, current_database(), active := false);
  end if;
  select * into strict job_record from cron.job where jobname = job_name and username = current_user;
  if job_record.command is distinct from job_command or job_record.schedule is distinct from '* * * * *'
    or job_record.database is distinct from current_database() or job_record.active is distinct from false
    or job_record.nodename is distinct from 'localhost' or job_record.nodeport is distinct from inet_server_port() then
    raise exception 'Incompatible personal payment reminder scheduler target';
  end if;
end;
$$;

commit;
