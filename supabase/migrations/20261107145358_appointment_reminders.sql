begin;
-- Monotonic version: timestamp equality within one transaction must not hide a changed slot.
alter table public.intervention_appointments add column reminder_version integer not null default 1 check(reminder_version>0);
create function public.version_appointment_reminder_slot()returns trigger language plpgsql set search_path=''as $$
begin
 if tg_op='INSERT'then new.reminder_version=1;else new.reminder_version=old.reminder_version+1;end if;
 return new;
end;$$;
revoke all on function public.version_appointment_reminder_slot()from public,anon,authenticated,service_role;
create trigger version_appointment_reminder_slot before insert or update on public.intervention_appointments for each row execute function public.version_appointment_reminder_slot();

create table public.appointment_reminders(
 id uuid primary key default gen_random_uuid(),recipient_id uuid not null references public.profiles(id)on delete cascade,
 intervention_id uuid not null references public.interventions(id)on delete cascade,
 appointment_version integer not null check(appointment_version>0),starts_at timestamptz not null,ends_at timestamptz not null,
 remind_at timestamptz not null,version integer not null default 1 check(version>0),
 status text not null check(status in('scheduled','cancelled','sent','invalidated','expired','muted')),
 notification_id uuid references public.notifications(id)on delete set null,processed_at timestamptz,
 updated_at timestamptz not null default clock_timestamp(),unique(recipient_id,intervention_id),
 check(remind_at<starts_at),check(ends_at>starts_at)
);
create index appointment_reminders_due on public.appointment_reminders(remind_at,id)where status='scheduled';
create table public.appointment_reminder_commands(
 command_id uuid primary key,actor_id uuid not null references public.profiles(id)on delete cascade,
 intervention_id uuid not null references public.interventions(id)on delete cascade,
 fingerprint jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.appointment_reminders enable row level security;
alter table public.appointment_reminder_commands enable row level security;
revoke all on public.appointment_reminders,public.appointment_reminder_commands from public,anon,authenticated,service_role;

-- Actor-parameter counterpart of current site read scope, limited to actual dossier participants.
-- Never set request.jwt.claim.sub in a worker to impersonate a recipient.
create function public.appointment_reminder_participant(p_actor uuid,p_intervention uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.interventions i join public.profiles p on p.id=p_actor where i.id=p_intervention and
 (i.artisan_id=p_actor or(i.client_id=p_actor and(i.site_id is null or exists(
 select 1 from public.sites s join public.organization_members m on m.organization_id=s.organization_id
 join public.organizations o on o.id=s.organization_id
 left join public.organization_member_site_scopes sc on sc.organization_id=m.organization_id and sc.user_id=m.user_id
 where s.id=i.site_id and m.user_id=p_actor and((o.owner_id=p_actor and m.role='owner')or coalesce(sc.scope,'all')='all' or exists(
 select 1 from public.organization_member_site_grants g where g.organization_id=m.organization_id and g.user_id=p_actor and g.site_id=s.id)))))));
$$;
revoke all on function public.appointment_reminder_participant(uuid,uuid)from public,anon,authenticated,service_role;
create function public.appointment_reminder_projection(r public.appointment_reminders)returns jsonb language sql stable set search_path=''as $$
 select jsonb_build_object('id',r.id,'intervention_id',r.intervention_id,'appointment_version',r.appointment_version,'starts_at',r.starts_at,'ends_at',r.ends_at,'remind_at',r.remind_at,'version',r.version,'status',r.status,'notification_id',r.notification_id,'processed_at',r.processed_at,'updated_at',r.updated_at);
$$;
revoke all on function public.appointment_reminder_projection(public.appointment_reminders)from public,anon,authenticated,service_role;
create function public.read_appointment_reminder(p_intervention_id uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare a public.intervention_appointments;r public.appointment_reminders;job_status text;eligibility text;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if not public.appointment_reminder_participant(auth.uid(),p_intervention_id)then raise no_data_found;end if;
 select status into job_status from public.interventions where id=p_intervention_id;
 select *into a from public.intervention_appointments where intervention_id=p_intervention_id;
 select *into r from public.appointment_reminders where intervention_id=p_intervention_id and recipient_id=auth.uid();
 eligibility=case when a.intervention_id is null then 'no_appointment'when job_status not in('assigned','quoted','accepted')then 'closed'when a.starts_at<=statement_timestamp()then 'elapsed'else 'available'end;
 return jsonb_build_object('intervention_id',p_intervention_id,'appointment',case when a.intervention_id is not null then jsonb_build_object('version',a.reminder_version,'starts_at',a.starts_at,'ends_at',a.ends_at)else null end,
 'record',case when r.id is not null then public.appointment_reminder_projection(r)else null end,'can_schedule',eligibility='available','eligibility',eligibility,
 'scheduled_for_current_slot',coalesce(r.status='scheduled'and eligibility='available'and r.appointment_version=a.reminder_version and r.starts_at=a.starts_at and r.ends_at=a.ends_at,false));
end;$$;
revoke all on function public.read_appointment_reminder(uuid)from public,anon,authenticated,service_role;
grant execute on function public.read_appointment_reminder(uuid)to authenticated;

create function public.write_appointment_reminder(p_intervention_id uuid,p_command_id uuid,p_action text,p_expected_version integer,p_appointment_version integer,p_remind_at timestamptz)returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid=auth.uid();a public.intervention_appointments;r public.appointment_reminders;c public.appointment_reminder_commands;fp jsonb;job_status text;result jsonb;
begin
 if actor is null then raise insufficient_privilege;end if;
 if not public.appointment_reminder_participant(actor,p_intervention_id)then raise no_data_found;end if;
 if p_command_id is null or p_action is null or p_action not in('schedule','cancel')or(p_expected_version is not null and p_expected_version not between 1 and 2147483646)
 or(p_action='schedule'and(p_appointment_version is null or p_appointment_version<1 or p_remind_at is null or not isfinite(p_remind_at)))
 or(p_action='cancel'and(p_expected_version is null or p_appointment_version is not null or p_remind_at is not null))then raise invalid_parameter_value;end if;
 fp=jsonb_build_object('action',p_action,'expected_version',p_expected_version,'appointment_version',p_appointment_version,'remind_at',p_remind_at);
 perform public.lock_intervention_organization(p_intervention_id);
 select status into job_status from public.interventions where id=p_intervention_id for share;
 if not public.appointment_reminder_participant(actor,p_intervention_id)then raise no_data_found;end if;
 select *into a from public.intervention_appointments where intervention_id=p_intervention_id for share;
 -- Serialize the first insert too; job FOR SHARE alone allows two first commands.
 perform pg_advisory_xact_lock(hashtextextended('appointment-reminder:'||actor::text||':'||p_intervention_id::text,0));
 select *into r from public.appointment_reminders where intervention_id=p_intervention_id and recipient_id=actor for update;
 select *into c from public.appointment_reminder_commands where command_id=p_command_id;
 if found then
  if c.actor_id<>actor or c.intervention_id<>p_intervention_id or c.fingerprint<>fp then raise exception 'Reminder command changed'using errcode='P0001';end if;
  return jsonb_build_object('record',c.result,'replayed',true);
 end if;
 if (r.id is null and p_expected_version is not null)or(r.id is not null and(r.version is distinct from p_expected_version))then raise exception 'Reminder version changed'using errcode='P0001';end if;
 if p_action='schedule'then
  if r.version>=2147483646 then raise exception 'Reminder version exhausted'using errcode='P0001';end if;
  if a.intervention_id is null or a.reminder_version<>p_appointment_version or job_status not in('assigned','quoted','accepted')then raise exception 'Appointment changed or closed'using errcode='P0001';end if;
  if p_remind_at<=clock_timestamp()or p_remind_at>=a.starts_at then raise invalid_parameter_value;end if;
  if r.id is null then
   insert into public.appointment_reminders(recipient_id,intervention_id,appointment_version,starts_at,ends_at,remind_at,status)values(actor,p_intervention_id,a.reminder_version,a.starts_at,a.ends_at,p_remind_at,'scheduled')returning *into r;
  else
   update public.appointment_reminders set appointment_version=a.reminder_version,starts_at=a.starts_at,ends_at=a.ends_at,remind_at=p_remind_at,status='scheduled',version=version+1,notification_id=null,processed_at=null,updated_at=clock_timestamp()where id=r.id returning *into r;
  end if;
 else
  if r.id is null or r.status<>'scheduled'then raise exception 'Reminder is not pending'using errcode='P0001';end if;
  update public.appointment_reminders set status='cancelled',version=version+1,processed_at=clock_timestamp(),updated_at=clock_timestamp()where id=r.id returning *into r;
 end if;
 perform public.consume_action('appointment_reminders',30);
 result=public.appointment_reminder_projection(r);
 insert into public.appointment_reminder_commands(command_id,actor_id,intervention_id,fingerprint,result)values(p_command_id,actor,p_intervention_id,fp,result);
 return jsonb_build_object('record',result,'replayed',false);
end;$$;
revoke all on function public.write_appointment_reminder(uuid,uuid,text,integer,integer,timestamptz)from public,anon,authenticated,service_role;
grant execute on function public.write_appointment_reminder(uuid,uuid,text,integer,integer,timestamptz)to authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in('mission_assigned','mission_received','mission_reassigned','quote_received','quote_rejected','quote_accepted','work_started','work_completed','payment_confirmed','mission_cancelled','appointment_saved','message_received','account_approved','account_suspended','approval_requested','approval_decided','support_replied','support_status_changed','member_joined','membership_removed','appointment_reminder'));
create or replace function public.save_notification_preferences(p_muted_kinds text[],p_email boolean,p_sms boolean,p_push boolean,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare prefs public.notification_preferences; current_version integer; kinds text[];
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if p_muted_kinds is null or p_email is null or p_sms is null or p_push is null or p_expected_version is null or p_expected_version<0 or cardinality(p_muted_kinds)>30 then raise invalid_parameter_value; end if;
 select coalesce(array_agg(distinct k order by k),'{}') into kinds from unnest(p_muted_kinds) k;
 if exists(select 1 from unnest(kinds) k where k is null or k not in ('mission_assigned','mission_received','mission_reassigned','quote_received','quote_rejected','quote_accepted','work_started','work_completed','payment_confirmed','mission_cancelled','appointment_saved','message_received','account_approved','account_suspended','approval_requested','approval_decided','support_replied','support_status_changed','member_joined','membership_removed','appointment_reminder')) then raise invalid_parameter_value; end if;
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

create function public.emit_due_appointment_reminders(p_limit integer default 100)returns jsonb language plpgsql security definer set search_path=''as $$
declare candidate record;r public.appointment_reminders;a public.intervention_appointments;job_status text;outcome text;notification uuid;dedupe text;n integer=0;sent integer=0;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value;end if;
 -- One worker at a time. Commands and appointments retain their ordinary organization/job lock order.
 if not pg_try_advisory_xact_lock(hashtextextended('appointment-reminders:worker',0))then return jsonb_build_object('processed',0,'sent',0,'busy',true);end if;
 for candidate in select id,intervention_id from public.appointment_reminders where status='scheduled'and remind_at<=clock_timestamp()order by remind_at,id limit p_limit loop
  perform public.lock_intervention_organization(candidate.intervention_id);
  select status into job_status from public.interventions where id=candidate.intervention_id for share;
  select *into a from public.intervention_appointments where intervention_id=candidate.intervention_id for share;
  select *into r from public.appointment_reminders where id=candidate.id and status='scheduled'and remind_at<=clock_timestamp()for update skip locked;
  if not found then continue;end if;
  outcome=null;notification=null;
  if not public.appointment_reminder_participant(r.recipient_id,r.intervention_id)or a.intervention_id is null or a.reminder_version<>r.appointment_version or a.starts_at<>r.starts_at or a.ends_at<>r.ends_at or job_status not in('assigned','quoted','accepted')then outcome='invalidated';
  elsif a.starts_at<=clock_timestamp()then outcome='expired';
  else
   -- Same preference lock as the existing writer: "muted" is a real outcome, never "sent".
   perform pg_advisory_xact_lock(hashtext('notification_preferences'),hashtext(r.recipient_id::text));
   if a.starts_at<=clock_timestamp()then outcome='expired';else
   dedupe='appointment-reminder:'||r.id::text||':'||r.version::text;
   perform public.notify(r.recipient_id,'appointment_reminder','Rappel de rendez-vous',
    'Le rendez-vous du dossier '||public.intervention_reference(r.intervention_id)||' commence le '||to_char(a.starts_at at time zone 'America/Martinique','DD/MM/YYYY à HH24:MI')||' (heure de Martinique).',
    dedupe,r.intervention_id,null,null,null,jsonb_build_object('starts_at',a.starts_at,'ends_at',a.ends_at,'appointment_version',a.reminder_version));
   select id into notification from public.notifications where recipient_id=r.recipient_id and dedupe_key=dedupe;
   outcome=case when notification is null then 'muted'else 'sent'end;
   end if;
  end if;
  update public.appointment_reminders set status=outcome,version=version+1,notification_id=notification,processed_at=clock_timestamp(),updated_at=clock_timestamp()where id=r.id;
  n=n+1;if outcome='sent'then sent=sent+1;end if;
 end loop;
 return jsonb_build_object('processed',n,'sent',sent,'busy',false);
end;$$;
revoke all on function public.emit_due_appointment_reminders(integer)from public,anon,authenticated,service_role;
grant execute on function public.emit_due_appointment_reminders(integer)to service_role;
commit;
