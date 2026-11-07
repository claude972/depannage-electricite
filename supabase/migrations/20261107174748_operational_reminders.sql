begin;
alter table public.artisan_credentials add column reminder_version integer not null default 1 check(reminder_version>0);
alter table public.compliance_records add column reminder_version integer not null default 1 check(reminder_version>0);
create function public.version_operational_reminder_source()returns trigger language plpgsql set search_path=''as $$begin
 if tg_op='INSERT'then new.reminder_version=1;else new.reminder_version=old.reminder_version+1;end if;return new;end;$$;
revoke all on function public.version_operational_reminder_source()from public,anon,authenticated,service_role;
create trigger version_operational_reminder_source before insert or update on public.artisan_credentials for each row execute function public.version_operational_reminder_source();
create trigger version_operational_reminder_source before insert or update on public.compliance_records for each row execute function public.version_operational_reminder_source();
create table public.operational_reminders(
 id uuid primary key default gen_random_uuid(),recipient_id uuid not null references public.profiles(id)on delete cascade,
 kind text not null check(kind in('credential','compliance')),record_id uuid not null,source jsonb not null,
 remind_at timestamptz not null,version integer not null default 1 check(version>0),
 status text not null check(status in('scheduled','cancelled','sent','invalidated','expired','muted')),
 notification_id uuid references public.notifications(id)on delete set null,processed_at timestamptz,updated_at timestamptz not null default clock_timestamp(),unique(recipient_id,kind,record_id));
create index operational_reminders_due on public.operational_reminders(remind_at,id)where status='scheduled';
create index operational_reminders_source on public.operational_reminders(kind,record_id)where status='scheduled';
create table public.operational_reminder_commands(command_id uuid primary key,actor_id uuid not null references public.profiles(id)on delete cascade,kind text not null,record_id uuid not null,fingerprint jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.operational_reminders enable row level security;alter table public.operational_reminder_commands enable row level security;
revoke all on public.operational_reminders,public.operational_reminder_commands from public,anon,authenticated,service_role;
create function public.invalidate_operational_reminder_source()returns trigger language plpgsql security definer set search_path=''as $$begin
 update public.operational_reminders set status='invalidated',version=version+1,processed_at=clock_timestamp(),updated_at=clock_timestamp()
 where kind=case when tg_table_name='artisan_credentials'then'credential'else'compliance'end and record_id=old.id and status='scheduled';return null;end;$$;
revoke all on function public.invalidate_operational_reminder_source()from public,anon,authenticated,service_role;
create trigger invalidate_operational_reminder_source after update or delete on public.artisan_credentials for each row execute function public.invalidate_operational_reminder_source();
create trigger invalidate_operational_reminder_source after update or delete on public.compliance_records for each row execute function public.invalidate_operational_reminder_source();

create function public.operational_reminder_source(p_actor uuid,p_kind text,p_id uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare c public.artisan_credentials;r public.compliance_records;s public.sites;member_role text;
begin
 if p_kind='credential'then
  select *into c from public.artisan_credentials where id=p_id and user_id=p_actor;
  if not found or not exists(select 1 from public.profiles where id=p_actor and role='artisan')or not exists(select 1 from public.documents where id=c.document_id and owner_id=p_actor and intervention_id is null)then return null;end if;
  return jsonb_build_object('version',c.reminder_version,'due_on',c.expires_on,'site_id',null,'actor_role','artisan','eligible',c.expires_on is not null);
 elsif p_kind='compliance'then
  select *into r from public.compliance_records where id=p_id;select *into s from public.sites where id=r.site_id;
  select m.role into member_role from public.organization_members m join public.organizations o on o.id=m.organization_id left join public.organization_member_site_scopes sc on sc.organization_id=m.organization_id and sc.user_id=m.user_id
   where m.organization_id=s.organization_id and m.user_id=p_actor and((o.owner_id=p_actor and m.role='owner')or coalesce(sc.scope,'all')='all'or exists(select 1 from public.organization_member_site_grants g where g.organization_id=m.organization_id and g.user_id=p_actor and g.site_id=s.id));
  if member_role is null then return null;end if;
  return jsonb_build_object('version',r.reminder_version,'due_on',r.due_on,'site_id',s.id,'actor_role',member_role,'eligible',r.status in('pending','scheduled')and s.archived_at is null);
 end if;
 return null;
end;$$;
revoke all on function public.operational_reminder_source(uuid,text,uuid)from public,anon,authenticated,service_role;
-- Follow the same organization/source/reminder lock order in commands and worker.
create function public.lock_operational_reminder_source(p_actor uuid,p_kind text,p_id uuid)returns void language plpgsql security definer set search_path=''as $$
declare site uuid;
begin
 if p_kind='credential'then
  perform 1 from public.profiles where id=p_actor for share;
  perform 1 from public.artisan_credentials where id=p_id for share;
  perform 1 from public.documents d join public.artisan_credentials c on c.document_id=d.id where c.id=p_id for share of d;
 elsif p_kind='compliance'then
  select site_id into site from public.compliance_records where id=p_id;
  perform 1 from public.organizations o join public.sites s on s.organization_id=o.id where s.id=site for update of o;
  perform 1 from public.sites where id=site for share;
  perform 1 from public.compliance_records where id=p_id for share;
 else raise invalid_parameter_value;end if;
end;$$;
revoke all on function public.lock_operational_reminder_source(uuid,text,uuid)from public,anon,authenticated,service_role;
create function public.operational_reminder_projection(r public.operational_reminders)returns jsonb language sql stable set search_path=''as $$
 select jsonb_build_object('id',r.id,'kind',r.kind,'record_id',r.record_id,'source_version',(r.source->>'version')::integer,'due_on',r.source->>'due_on','remind_at',r.remind_at,'version',r.version,'status',r.status,'notification_id',r.notification_id,'processed_at',r.processed_at,'updated_at',r.updated_at);
$$;
revoke all on function public.operational_reminder_projection(public.operational_reminders)from public,anon,authenticated,service_role;
create function public.read_operational_reminder(p_kind text,p_record_id uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare s jsonb;r public.operational_reminders;eligibility text;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 s=public.operational_reminder_source(auth.uid(),p_kind,p_record_id);if s is null then raise no_data_found;end if;
 select *into r from public.operational_reminders where recipient_id=auth.uid()and kind=p_kind and record_id=p_record_id;
 eligibility=case when s->>'due_on'is null then'no_date'when not(s->>'eligible')::boolean then'closed'when(s->>'due_on')::date<=(statement_timestamp()at time zone'America/Martinique')::date then'elapsed'else'available'end;
 return jsonb_build_object('kind',p_kind,'record_id',p_record_id,'source',jsonb_build_object('version',(s->>'version')::integer,'due_on',s->>'due_on'),'record',case when r.id is null then null else public.operational_reminder_projection(r)end,'eligibility',eligibility,'can_schedule',eligibility='available','scheduled_for_current_source',coalesce(r.status='scheduled'and r.source=s and eligibility='available',false));
end;$$;
revoke all on function public.read_operational_reminder(text,uuid)from public,anon,authenticated,service_role;
grant execute on function public.read_operational_reminder(text,uuid)to authenticated;
create function public.write_operational_reminder(p_kind text,p_record_id uuid,p_command_id uuid,p_action text,p_expected_version integer,p_source_version integer,p_due_on date,p_remind_at timestamptz)returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid=auth.uid();s jsonb;r public.operational_reminders;c public.operational_reminder_commands;fp jsonb;result jsonb;
begin
 if actor is null then raise insufficient_privilege;end if;
 if p_command_id is null or p_record_id is null or p_kind is null or p_kind not in('credential','compliance')or p_action is null or p_action not in('schedule','cancel')or(p_expected_version is not null and p_expected_version not between 1 and 2147483646)
 or(p_action='schedule'and(p_source_version is null or p_source_version<1 or p_due_on is null or not isfinite(p_due_on)or p_remind_at is null or not isfinite(p_remind_at)))
 or(p_action='cancel'and(p_expected_version is null or p_source_version is not null or p_due_on is not null or p_remind_at is not null))then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('operational-reminders:actor:'||actor::text,0));
 perform public.lock_operational_reminder_source(actor,p_kind,p_record_id);
 s=public.operational_reminder_source(actor,p_kind,p_record_id);if s is null then raise no_data_found;end if;
 perform pg_advisory_xact_lock(hashtextextended('operational-reminder:'||actor::text||':'||p_kind||':'||p_record_id::text,0));
 select *into r from public.operational_reminders where recipient_id=actor and kind=p_kind and record_id=p_record_id for update;
 fp=jsonb_build_object('action',p_action,'expected_version',p_expected_version,'source_version',p_source_version,'due_on',p_due_on,'remind_at',p_remind_at);
 select *into c from public.operational_reminder_commands where command_id=p_command_id;
 if found then
  if c.actor_id<>actor or c.kind<>p_kind or c.record_id<>p_record_id or c.fingerprint<>fp then raise exception 'Reminder command changed'using errcode='P0001';end if;
  return jsonb_build_object('record',c.result,'replayed',true);
 end if;
 if r.version is distinct from p_expected_version then raise exception 'Reminder version changed'using errcode='P0001';end if;
 if p_action='schedule'then
  if not(s->>'eligible')::boolean or(s->>'version')::integer<>p_source_version or(s->>'due_on')::date is distinct from p_due_on then raise exception 'Deadline source changed or closed'using errcode='P0001';end if;
  if p_remind_at<=clock_timestamp()or(p_remind_at at time zone'America/Martinique')::date>=p_due_on then raise invalid_parameter_value;end if;
  if(select count(*)from public.operational_reminders where recipient_id=actor and status='scheduled')>=200 and coalesce(r.status,'')<>'scheduled'then raise exception 'Reminder limit reached'using errcode='P0001';end if;
  insert into public.operational_reminders(recipient_id,kind,record_id,source,remind_at,status)values(actor,p_kind,p_record_id,s,p_remind_at,'scheduled')on conflict(recipient_id,kind,record_id)do update set source=excluded.source,remind_at=excluded.remind_at,status='scheduled',version=operational_reminders.version+1,notification_id=null,processed_at=null,updated_at=clock_timestamp()returning *into r;
 else
  if r.id is null or r.status<>'scheduled'then raise exception 'Reminder is not scheduled'using errcode='P0001';end if;
  update public.operational_reminders set status='cancelled',version=version+1,processed_at=clock_timestamp(),updated_at=clock_timestamp()where id=r.id returning *into r;
 end if;
 perform public.consume_action('operational_reminders',30);result=public.operational_reminder_projection(r);
 insert into public.operational_reminder_commands(command_id,actor_id,kind,record_id,fingerprint,result)values(p_command_id,actor,p_kind,p_record_id,fp,result);
 return jsonb_build_object('record',result,'replayed',false);
end;$$;
revoke all on function public.write_operational_reminder(text,uuid,uuid,text,integer,integer,date,timestamptz)from public,anon,authenticated,service_role;
grant execute on function public.write_operational_reminder(text,uuid,uuid,text,integer,integer,date,timestamptz)to authenticated;

create function public.emit_due_operational_reminders(p_limit integer default 100)returns jsonb language plpgsql security definer set search_path=''as $$
declare candidate record;r public.operational_reminders;s jsonb;outcome text;notification uuid;dedupe text;n integer=0;sent integer=0;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('operational-reminders:worker',0))then return jsonb_build_object('processed',0,'sent',0,'busy',true);end if;
 for candidate in select id,recipient_id,kind,record_id from public.operational_reminders where status='scheduled'and remind_at<=clock_timestamp()order by remind_at,id limit p_limit loop
  perform public.lock_operational_reminder_source(candidate.recipient_id,candidate.kind,candidate.record_id);
  select *into r from public.operational_reminders where id=candidate.id and status='scheduled'and remind_at<=clock_timestamp()for update skip locked;if not found then continue;end if;
  s=public.operational_reminder_source(r.recipient_id,r.kind,r.record_id);outcome=null;notification=null;
  if s is null or s is distinct from r.source or not(s->>'eligible')::boolean then outcome='invalidated';
  elsif(s->>'due_on')::date<=(clock_timestamp()at time zone'America/Martinique')::date then outcome='expired';
  else
   perform pg_advisory_xact_lock(hashtext('notification_preferences'),hashtext(r.recipient_id::text));
   if(s->>'due_on')::date<=(clock_timestamp()at time zone'America/Martinique')::date then outcome='expired';else
    dedupe='operational-reminder:'||r.id::text||':'||r.version::text;
    perform public.notify(r.recipient_id,case when r.kind='credential'then'credential_reminder'else'compliance_reminder'end,'Rappel d’échéance',
     case when r.kind='credential'then'Une échéance enregistrée dans vos justificatifs approche. Consultez votre dossier professionnel.'else'Une échéance de conformité enregistrée approche. Consultez le dossier du site.'end,
     dedupe,null,null,(s->>'site_id')::uuid,null,jsonb_build_object('record_id',r.record_id,'source_kind',r.kind,'due_on',s->>'due_on'));
    select id into notification from public.notifications where recipient_id=r.recipient_id and dedupe_key=dedupe;
    outcome=case when notification is null then'muted'else'sent'end;
   end if;
  end if;
  update public.operational_reminders set status=outcome,version=version+1,notification_id=notification,processed_at=clock_timestamp(),updated_at=clock_timestamp()where id=r.id;
  n=n+1;if outcome='sent'then sent=sent+1;end if;
 end loop;
 return jsonb_build_object('processed',n,'sent',sent,'busy',false);
end;$$;
revoke all on function public.emit_due_operational_reminders(integer)from public,anon,authenticated,service_role;
grant execute on function public.emit_due_operational_reminders(integer)to service_role;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in('mission_assigned','mission_received','mission_reassigned','quote_received','quote_rejected','quote_accepted','work_started','work_completed','payment_confirmed','mission_cancelled','appointment_saved','message_received','account_approved','account_suspended','approval_requested','approval_decided','support_replied','support_status_changed','member_joined','membership_removed','appointment_reminder','credential_reminder','compliance_reminder'));
create or replace function public.save_notification_preferences(p_muted_kinds text[],p_email boolean,p_sms boolean,p_push boolean,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare prefs public.notification_preferences; current_version integer; kinds text[];
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if p_muted_kinds is null or p_email is null or p_sms is null or p_push is null or p_expected_version is null or p_expected_version<0 or cardinality(p_muted_kinds)>30 then raise invalid_parameter_value; end if;
 select coalesce(array_agg(distinct k order by k),'{}') into kinds from unnest(p_muted_kinds) k;
 if exists(select 1 from unnest(kinds) k where k is null or k not in ('mission_assigned','mission_received','mission_reassigned','quote_received','quote_rejected','quote_accepted','work_started','work_completed','payment_confirmed','mission_cancelled','appointment_saved','message_received','account_approved','account_suspended','approval_requested','approval_decided','support_replied','support_status_changed','member_joined','membership_removed','appointment_reminder','credential_reminder','compliance_reminder')) then raise invalid_parameter_value; end if;
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


-- A removed/restored scope must not silently resurrect an old personal reminder.
create function public.invalidate_operational_reminder_access()returns trigger language plpgsql security definer set search_path=''as $$
declare person uuid;org uuid;
begin
 if tg_table_name='profiles'then
  if new.role is not distinct from old.role then return null;end if;
  update public.operational_reminders set status='invalidated',version=version+1,processed_at=clock_timestamp(),updated_at=clock_timestamp()where recipient_id=old.id and kind='credential'and status='scheduled';
 elsif tg_table_name='sites'then
  if new.archived_at is null or new.archived_at is not distinct from old.archived_at then return null;end if;
  update public.operational_reminders r set status='invalidated',version=r.version+1,processed_at=clock_timestamp(),updated_at=clock_timestamp()where r.kind='compliance'and r.status='scheduled'and exists(select 1 from public.compliance_records c where c.id=r.record_id and c.site_id=new.id);
 else
  if tg_op='DELETE'then person=old.user_id;org=old.organization_id;else person=new.user_id;org=new.organization_id;end if;
  update public.operational_reminders r set status='invalidated',version=r.version+1,processed_at=clock_timestamp(),updated_at=clock_timestamp()where r.kind='compliance'and r.status='scheduled'and r.recipient_id=person and exists(select 1 from public.compliance_records c join public.sites s on s.id=c.site_id where c.id=r.record_id and s.organization_id=org);
 end if;
 return null;
end;$$;
revoke all on function public.invalidate_operational_reminder_access()from public,anon,authenticated,service_role;
create trigger operational_reminder_role_changed after update of role on public.profiles for each row execute function public.invalidate_operational_reminder_access();
create trigger operational_reminder_site_archived after update of archived_at on public.sites for each row execute function public.invalidate_operational_reminder_access();
create trigger operational_reminder_member_changed after update or delete on public.organization_members for each row execute function public.invalidate_operational_reminder_access();
create trigger operational_reminder_scope_changed after insert or update or delete on public.organization_member_site_scopes for each row execute function public.invalidate_operational_reminder_access();
create trigger operational_reminder_grant_changed after insert or update or delete on public.organization_member_site_grants for each row execute function public.invalidate_operational_reminder_access();

commit;
