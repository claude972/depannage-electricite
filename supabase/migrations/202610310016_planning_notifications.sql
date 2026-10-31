-- ADV-PLANNING-NOTIFICATIONS-001: private artisan planning and persistent per-recipient notifications.
-- Additive only on top of 001-013: no policy, helper, table or grant of an earlier migration is altered.
-- Triggers are added here on existing tables; the functions they call live in this file.
-- Concurrency: every writer of an occupied slot takes pg_advisory_xact_lock(artisan) before the
-- overlap check, so two overlapping bookings for one artisan serialize without btree_gist.
-- Time zones: recurring rules are local (weekday + minutes + IANA zone); every instant is timestamptz.
begin;

-- ---------------------------------------------------------------------------------------------
-- Planning tables
-- ---------------------------------------------------------------------------------------------
create table public.artisan_availability_rules (
 id uuid primary key default gen_random_uuid(),
 artisan_id uuid not null references public.profiles(id) on delete cascade,
 weekday smallint not null check(weekday between 1 and 7),
 start_minute integer not null check(start_minute between 0 and 1439),
 end_minute integer not null check(end_minute between 1 and 1440),
 time_zone text not null default 'America/Martinique' check(char_length(time_zone) between 1 and 64),
 valid_from date not null default current_date,
 valid_until date,
 client_request_id uuid not null,
 version integer not null default 1 check(version between 1 and 2147483647),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(end_minute>start_minute), check(valid_until is null or valid_until>=valid_from),
 unique(artisan_id,client_request_id)
);
create index artisan_availability_rules_artisan on public.artisan_availability_rules(artisan_id,weekday,start_minute);
create table public.artisan_planning_entries (
 id uuid primary key default gen_random_uuid(),
 artisan_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in ('busy','unavailable','available')),
 starts_at timestamptz not null, ends_at timestamptz not null,
 title text not null default '' check(char_length(title)<=160),
 note text not null default '' check(char_length(note)<=2000),
 client_request_id uuid not null,
 version integer not null default 1 check(version between 1 and 2147483647),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(ends_at>starts_at and ends_at<=starts_at+interval '31 days'),
 unique(artisan_id,client_request_id)
);
create index artisan_planning_entries_window on public.artisan_planning_entries(artisan_id,starts_at,ends_at);

-- ---------------------------------------------------------------------------------------------
-- Notification tables
-- ---------------------------------------------------------------------------------------------
create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in ('mission_assigned','mission_received','mission_reassigned','quote_received','quote_rejected','quote_accepted','work_started','work_completed','payment_confirmed','mission_cancelled','appointment_saved','message_received','account_approved','account_suspended','approval_requested','approval_decided','support_replied','support_status_changed','member_joined','membership_removed')),
 title text not null check(char_length(title) between 1 and 160),
 body text not null check(char_length(body) between 1 and 600),
 intervention_id uuid references public.interventions(id) on delete cascade,
 organization_id uuid references public.organizations(id) on delete cascade,
 site_id uuid references public.sites(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null,
 payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
 dedupe_key text not null check(char_length(dedupe_key) between 1 and 200),
 read_at timestamptz, created_at timestamptz not null default now(),
 unique(recipient_id,dedupe_key)
);
create index notifications_recipient_page on public.notifications(recipient_id,created_at desc,id desc);
create index notifications_recipient_unread on public.notifications(recipient_id) where read_at is null;
create table public.notification_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 muted_kinds text[] not null default '{}' check(cardinality(muted_kinds)<=30),
 email_enabled boolean not null default false, sms_enabled boolean not null default false, push_enabled boolean not null default false,
 version integer not null default 1 check(version between 1 and 2147483647),
 updated_at timestamptz not null default now()
);

alter table public.artisan_availability_rules enable row level security;
alter table public.artisan_planning_entries enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
revoke all on public.artisan_availability_rules,public.artisan_planning_entries,public.notifications,public.notification_preferences from public,anon,authenticated;
grant select on public.artisan_availability_rules,public.artisan_planning_entries,public.notifications,public.notification_preferences to authenticated;
grant all on public.artisan_availability_rules,public.artisan_planning_entries,public.notifications,public.notification_preferences to service_role;

-- A notification stays readable only while its recipient still has access to the linked scope:
-- reassignment, member removal or a reduced site scope hides it at once.
create function public.notification_scope_visible(p_intervention uuid,p_site uuid,p_organization uuid) returns boolean language sql stable security definer set search_path='' as $$
 select (p_intervention is null or public.can_access_intervention(p_intervention))
  and (p_site is null or public.can_access_site(p_site))
  and (p_organization is null or public.is_org_member(p_organization));
$$;
revoke execute on function public.notification_scope_visible(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.notification_scope_visible(uuid,uuid,uuid) to authenticated;
create policy rules_private_read on public.artisan_availability_rules for select to authenticated using(artisan_id=auth.uid());
create policy entries_private_read on public.artisan_planning_entries for select to authenticated using(artisan_id=auth.uid());
create policy notifications_private_read on public.notifications for select to authenticated using(recipient_id=auth.uid() and public.notification_scope_visible(intervention_id,site_id,organization_id));
create policy preferences_private_read on public.notification_preferences for select to authenticated using(user_id=auth.uid());

-- ---------------------------------------------------------------------------------------------
-- Availability computation (private helpers)
-- ---------------------------------------------------------------------------------------------
create function public.intervention_reference(p_id uuid) returns text language sql immutable set search_path='' as $$
 select 'INT-'||upper(left(replace(p_id::text,'-',''),6));
$$;
revoke execute on function public.intervention_reference(uuid) from public,anon,authenticated;

-- Declared availability on [p_from,p_to): weekly rules expanded day by day in their own zone,
-- plus one-off 'available' entries, minus 'unavailable' entries.
create function public.artisan_available_multirange(p_artisan uuid,p_from timestamptz,p_to timestamptz) returns tstzmultirange language sql stable security definer set search_path='' as $$
 with days as (
  select d::date as day from generate_series(((p_from at time zone 'UTC')::date-1)::timestamp,((p_to at time zone 'UTC')::date+1)::timestamp,interval '1 day') d
 ), declared as (
  select tstzrange((days.day+make_interval(mins=>r.start_minute)) at time zone r.time_zone,(days.day+make_interval(mins=>r.end_minute)) at time zone r.time_zone,'[)') as slot
  from public.artisan_availability_rules r cross join days
  where r.artisan_id=p_artisan and extract(isodow from days.day)=r.weekday and days.day>=r.valid_from and (r.valid_until is null or days.day<=r.valid_until)
  union all
  select tstzrange(e.starts_at,e.ends_at,'[)') from public.artisan_planning_entries e
  where e.artisan_id=p_artisan and e.kind='available' and e.ends_at>p_from and e.starts_at<p_to
 ), removed as (
  select tstzrange(e.starts_at,e.ends_at,'[)') as slot from public.artisan_planning_entries e
  where e.artisan_id=p_artisan and e.kind='unavailable' and e.ends_at>p_from and e.starts_at<p_to
 )
 select ((coalesce((select range_agg(slot) from declared where not isempty(slot)),'{}'::tstzmultirange)
  - coalesce((select range_agg(slot) from removed),'{}'::tstzmultirange))
  * tstzmultirange(tstzrange(p_from,p_to,'[)')));
$$;
-- Occupied time: 'busy' entries and appointments of live dossiers (one dossier may be excluded
-- so that re-scheduling it does not collide with its own current slot).
create function public.artisan_busy_multirange(p_artisan uuid,p_from timestamptz,p_to timestamptz,p_exclude_intervention uuid default null) returns tstzmultirange language sql stable security definer set search_path='' as $$
 select coalesce(range_agg(slot),'{}'::tstzmultirange) from (
  select tstzrange(e.starts_at,e.ends_at,'[)') as slot from public.artisan_planning_entries e
  where e.artisan_id=p_artisan and e.kind='busy' and e.ends_at>p_from and e.starts_at<p_to
  union all
  select tstzrange(a.starts_at,a.ends_at,'[)') from public.intervention_appointments a join public.interventions i on i.id=a.intervention_id
  where i.artisan_id=p_artisan and i.status in ('assigned','quoted','accepted','in_progress') and a.intervention_id is distinct from p_exclude_intervention
  and a.ends_at>p_from and a.starts_at<p_to
 ) x;
$$;
-- Serialized double-booking check. The advisory lock is per artisan and released at commit/rollback.
create function public.assert_artisan_slot_free(p_artisan uuid,p_starts timestamptz,p_ends timestamptz,p_exclude_entry uuid default null,p_exclude_intervention uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtext('artisan_planning'),hashtext(p_artisan::text));
 if exists(select 1 from public.artisan_planning_entries e where e.artisan_id=p_artisan and e.kind='busy' and e.id is distinct from p_exclude_entry
   and tstzrange(e.starts_at,e.ends_at,'[)') && tstzrange(p_starts,p_ends,'[)'))
  or exists(select 1 from public.intervention_appointments a join public.interventions i on i.id=a.intervention_id
   where i.artisan_id=p_artisan and i.status in ('assigned','quoted','accepted','in_progress') and a.intervention_id is distinct from p_exclude_intervention
   and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(p_starts,p_ends,'[)')) then
  raise exception 'Créneau déjà occupé' using errcode='P0001';
 end if;
end; $$;
revoke execute on function public.artisan_available_multirange(uuid,timestamptz,timestamptz),public.artisan_busy_multirange(uuid,timestamptz,timestamptz,uuid),public.assert_artisan_slot_free(uuid,timestamptz,timestamptz,uuid,uuid) from public,anon,authenticated;

-- Existing appointment writer (003/009) is not edited: the guard runs before every row write made
-- under a user identity. Service-role/superuser maintenance writes (auth.uid() null) already bypass
-- RLS by design and are not re-validated here.
create function public.guard_appointment_double_booking() returns trigger language plpgsql security definer set search_path='' as $$
declare artisan uuid;
begin
 if auth.uid() is null then return new; end if;
 select artisan_id into artisan from public.interventions where id=new.intervention_id;
 if artisan is not null then perform public.assert_artisan_slot_free(artisan,new.starts_at,new.ends_at,null,new.intervention_id); end if;
 return new;
end; $$;
revoke execute on function public.guard_appointment_double_booking() from public,anon,authenticated;
create trigger appointment_double_booking_guard before insert or update on public.intervention_appointments for each row execute function public.guard_appointment_double_booking();

-- ---------------------------------------------------------------------------------------------
-- Planning commands (artisan only; suspension and role guard reused from 008)
-- ---------------------------------------------------------------------------------------------
create function public.render_availability_rule(r public.artisan_availability_rules) returns jsonb language sql immutable set search_path='' as $$
 select to_jsonb(r)-'client_request_id';
$$;
create function public.render_planning_entry(e public.artisan_planning_entries) returns jsonb language sql immutable set search_path='' as $$
 select to_jsonb(e)-'client_request_id';
$$;
revoke execute on function public.render_availability_rule(public.artisan_availability_rules),public.render_planning_entry(public.artisan_planning_entries) from public,anon,authenticated;

create function public.save_availability_rule(p_request_id uuid,p_id uuid,p_weekday integer,p_start_minute integer,p_end_minute integer,p_time_zone text,p_valid_from date,p_valid_until date,p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.artisan_availability_rules; result public.artisan_availability_rules; zone text; since date; same boolean;
begin
 perform public.guard_artisan_self_edit();
 zone=coalesce(nullif(trim(p_time_zone),''),'America/Martinique');
 if p_request_id is null or p_weekday is null or p_weekday not between 1 and 7 or p_start_minute is null or p_start_minute not between 0 and 1439
  or p_end_minute is null or p_end_minute not between 1 and 1440 or p_end_minute<=p_start_minute or char_length(zone)>64
  or (p_valid_until is not null and p_valid_from is not null and p_valid_until<p_valid_from) then raise invalid_parameter_value; end if;
 begin perform now() at time zone zone; exception when others then raise invalid_parameter_value; end;
 if p_id is null then
  since=coalesce(p_valid_from,current_date);
  if p_valid_until is not null and p_valid_until<since then raise invalid_parameter_value; end if;
  select * into existing from public.artisan_availability_rules where artisan_id=auth.uid() and client_request_id=p_request_id;
  if found then
   same=existing.weekday=p_weekday and existing.start_minute=p_start_minute and existing.end_minute=p_end_minute and existing.time_zone=zone
    and existing.valid_from=coalesce(p_valid_from,existing.valid_from) and existing.valid_until is not distinct from p_valid_until;
   if not same then raise exception 'Request key content conflict' using errcode='P0001'; end if;
   return jsonb_build_object('rule',public.render_availability_rule(existing),'replayed',true);
  end if;
  if p_expected_version is not null then raise invalid_parameter_value; end if;
  if (select count(*) from public.artisan_availability_rules where artisan_id=auth.uid())>=50 then raise exception 'Rule limit reached' using errcode='P0001'; end if;
  perform public.consume_action('planning',30);
  insert into public.artisan_availability_rules(artisan_id,weekday,start_minute,end_minute,time_zone,valid_from,valid_until,client_request_id)
  values(auth.uid(),p_weekday,p_start_minute,p_end_minute,zone,since,p_valid_until,p_request_id) returning * into result;
  return jsonb_build_object('rule',public.render_availability_rule(result),'replayed',false);
 end if;
 select * into existing from public.artisan_availability_rules where id=p_id and artisan_id=auth.uid() for update;
 if not found then raise no_data_found; end if;
 since=coalesce(p_valid_from,existing.valid_from);
 if p_valid_until is not null and p_valid_until<since then raise invalid_parameter_value; end if;
 if existing.client_request_id=p_request_id then
  same=existing.weekday=p_weekday and existing.start_minute=p_start_minute and existing.end_minute=p_end_minute and existing.time_zone=zone and existing.valid_from=since and existing.valid_until is not distinct from p_valid_until;
  if not same then raise exception 'Request key content conflict' using errcode='P0001'; end if;
  return jsonb_build_object('rule',public.render_availability_rule(existing),'replayed',true);
 end if;
 if p_expected_version is null or p_expected_version<1 then raise invalid_parameter_value; end if;
 if existing.version<>p_expected_version or existing.version=2147483647 then raise exception 'Rule revision changed' using errcode='P0001'; end if;
 perform public.consume_action('planning',30);
 update public.artisan_availability_rules set weekday=p_weekday,start_minute=p_start_minute,end_minute=p_end_minute,time_zone=zone,valid_from=since,valid_until=p_valid_until,
  client_request_id=p_request_id,version=version+1,updated_at=now() where id=p_id returning * into result;
 return jsonb_build_object('rule',public.render_availability_rule(result),'replayed',false);
end; $$;

create function public.delete_availability_rule(p_id uuid,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.artisan_availability_rules;
begin
 perform public.guard_artisan_self_edit();
 if p_id is null or p_expected_version is null or p_expected_version<1 then raise invalid_parameter_value; end if;
 select * into existing from public.artisan_availability_rules where id=p_id and artisan_id=auth.uid() for update;
 if not found then raise no_data_found; end if;
 if existing.version<>p_expected_version then raise exception 'Rule revision changed' using errcode='P0001'; end if;
 perform public.consume_action('planning',30);
 delete from public.artisan_availability_rules where id=p_id;
 return jsonb_build_object('deleted',true,'id',p_id);
end; $$;

create function public.save_planning_entry(p_request_id uuid,p_id uuid,p_kind text,p_starts_at timestamptz,p_ends_at timestamptz,p_title text,p_note text,p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.artisan_planning_entries; result public.artisan_planning_entries; title text; note text; same boolean;
begin
 perform public.guard_artisan_self_edit();
 title=coalesce(regexp_replace(p_title,'^[[:space:]]+|[[:space:]]+$','','g'),''); note=coalesce(regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g'),'');
 if p_request_id is null or p_kind is null or p_kind not in ('busy','unavailable','available') or p_starts_at is null or p_ends_at is null
  or not isfinite(p_starts_at) or not isfinite(p_ends_at) or p_ends_at<=p_starts_at or p_ends_at>p_starts_at+interval '31 days'
  or char_length(title)>160 or char_length(note)>2000 then raise invalid_parameter_value; end if;
 if p_id is null then
  select * into existing from public.artisan_planning_entries where artisan_id=auth.uid() and client_request_id=p_request_id;
  if found then
   same=existing.kind=p_kind and existing.starts_at=p_starts_at and existing.ends_at=p_ends_at and existing.title=title and existing.note=note;
   if not same then raise exception 'Request key content conflict' using errcode='P0001'; end if;
   return jsonb_build_object('entry',public.render_planning_entry(existing),'replayed',true);
  end if;
  if p_expected_version is not null then raise invalid_parameter_value; end if;
  if (select count(*) from public.artisan_planning_entries where artisan_id=auth.uid())>=500 then raise exception 'Entry limit reached' using errcode='P0001'; end if;
  perform public.consume_action('planning',30);
  if p_kind='busy' then perform public.assert_artisan_slot_free(auth.uid(),p_starts_at,p_ends_at,null,null); end if;
  insert into public.artisan_planning_entries(artisan_id,kind,starts_at,ends_at,title,note,client_request_id)
  values(auth.uid(),p_kind,p_starts_at,p_ends_at,title,note,p_request_id) returning * into result;
  return jsonb_build_object('entry',public.render_planning_entry(result),'replayed',false);
 end if;
 select * into existing from public.artisan_planning_entries where id=p_id and artisan_id=auth.uid() for update;
 if not found then raise no_data_found; end if;
 if existing.client_request_id=p_request_id then
  same=existing.kind=p_kind and existing.starts_at=p_starts_at and existing.ends_at=p_ends_at and existing.title=title and existing.note=note;
  if not same then raise exception 'Request key content conflict' using errcode='P0001'; end if;
  return jsonb_build_object('entry',public.render_planning_entry(existing),'replayed',true);
 end if;
 if p_expected_version is null or p_expected_version<1 then raise invalid_parameter_value; end if;
 if existing.version<>p_expected_version or existing.version=2147483647 then raise exception 'Entry revision changed' using errcode='P0001'; end if;
 perform public.consume_action('planning',30);
 if p_kind='busy' then perform public.assert_artisan_slot_free(auth.uid(),p_starts_at,p_ends_at,p_id,null); end if;
 update public.artisan_planning_entries set kind=p_kind,starts_at=p_starts_at,ends_at=p_ends_at,title=title,note=note,
  client_request_id=p_request_id,version=version+1,updated_at=now() where id=p_id returning * into result;
 return jsonb_build_object('entry',public.render_planning_entry(result),'replayed',false);
end; $$;

create function public.delete_planning_entry(p_id uuid,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.artisan_planning_entries;
begin
 perform public.guard_artisan_self_edit();
 if p_id is null or p_expected_version is null or p_expected_version<1 then raise invalid_parameter_value; end if;
 select * into existing from public.artisan_planning_entries where id=p_id and artisan_id=auth.uid() for update;
 if not found then raise no_data_found; end if;
 if existing.version<>p_expected_version then raise exception 'Entry revision changed' using errcode='P0001'; end if;
 perform public.consume_action('planning',30);
 delete from public.artisan_planning_entries where id=p_id;
 return jsonb_build_object('deleted',true,'id',p_id);
end; $$;

-- Own planning read model. A suspended artisan may still read; editing is refused by the guard.
create function public.artisan_planning(p_from timestamptz,p_to timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid=auth.uid(); account public.profiles; dossier public.artisan_profiles; avail tstzmultirange; free tstzmultirange; suspended boolean;
begin
 if actor is null then raise insufficient_privilege; end if;
 select * into account from public.profiles where id=actor;
 if not found or account.role<>'artisan' then raise insufficient_privilege; end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to-p_from>interval '62 days' then raise invalid_parameter_value; end if;
 select * into dossier from public.artisan_profiles where user_id=actor;
 suspended=coalesce(dossier.application_status='suspended',false);
 avail=public.artisan_available_multirange(actor,p_from,p_to);
 free=avail-public.artisan_busy_multirange(actor,p_from,p_to,null);
 return jsonb_build_object(
  'range',jsonb_build_object('from',p_from,'to',p_to,'time_zone','America/Martinique'),
  'rules',(select coalesce(jsonb_agg(public.render_availability_rule(r) order by r.weekday,r.start_minute,r.id),'[]'::jsonb) from (select * from public.artisan_availability_rules where artisan_id=actor order by weekday,start_minute,id limit 50) r),
  'entries',(select coalesce(jsonb_agg(public.render_planning_entry(e) order by e.starts_at,e.id),'[]'::jsonb) from (select * from public.artisan_planning_entries where artisan_id=actor and ends_at>p_from and starts_at<p_to order by starts_at,id limit 200) e),
  'appointments',(select coalesce(jsonb_agg(jsonb_build_object('intervention_id',x.intervention_id,'reference',public.intervention_reference(x.intervention_id),'status',x.status,'category',x.category,'city',x.city,
    'starts_at',x.starts_at,'ends_at',x.ends_at,'note',x.note,'updated_at',x.updated_at,'outside_availability',not (avail @> tstzrange(x.starts_at,x.ends_at,'[)'))) order by x.starts_at,x.intervention_id),'[]'::jsonb)
   from (select a.intervention_id,i.status,i.category,i.city,a.starts_at,a.ends_at,a.note,a.updated_at from public.intervention_appointments a join public.interventions i on i.id=a.intervention_id
    where i.artisan_id=actor and i.status<>'cancelled' and a.ends_at>p_from and a.starts_at<p_to order by a.starts_at,a.intervention_id limit 200) x),
  'free',(select coalesce(jsonb_agg(jsonb_build_object('starts_at',lower(r),'ends_at',upper(r)) order by lower(r)),'[]'::jsonb) from unnest(free) r),
  'limits',jsonb_build_object('rules',50,'entries',200,'appointments',200,
   'entries_limited',(select count(*)>200 from public.artisan_planning_entries where artisan_id=actor and ends_at>p_from and starts_at<p_to),
   'appointments_limited',(select count(*)>200 from public.intervention_appointments a join public.interventions i on i.id=a.intervention_id where i.artisan_id=actor and i.status<>'cancelled' and a.ends_at>p_from and a.starts_at<p_to)),
  'permissions',jsonb_build_object('can_edit',not suspended,'reason',case when suspended then 'Votre compte est suspendu : le planning reste consultable mais ne peut pas être modifié.' end));
end; $$;

-- Free intervals of the assigned artisan for one dossier the caller can read. Intervals only:
-- no title, note, reason or other dossier is ever exposed.
create function public.intervention_free_slots(p_intervention_id uuid,p_from timestamptz,p_to timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.interventions; free tstzmultirange; declared boolean;
begin
 if auth.uid() is null or p_intervention_id is null then raise insufficient_privilege; end if;
 if not public.can_access_intervention(p_intervention_id) then raise insufficient_privilege; end if;
 select * into job from public.interventions where id=p_intervention_id;
 if not found then raise insufficient_privilege; end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to-p_from>interval '31 days' then raise invalid_parameter_value; end if;
 if job.artisan_id is null or job.status not in ('assigned','quoted','accepted') then raise exception 'No assigned artisan to schedule' using errcode='P0001'; end if;
 perform public.consume_action('planning_slots',60);
 free=public.artisan_available_multirange(job.artisan_id,p_from,p_to)-public.artisan_busy_multirange(job.artisan_id,p_from,p_to,p_intervention_id);
 declared=exists(select 1 from public.artisan_availability_rules where artisan_id=job.artisan_id) or exists(select 1 from public.artisan_planning_entries where artisan_id=job.artisan_id and kind='available');
 return jsonb_build_object('intervention_id',p_intervention_id,'from',p_from,'to',p_to,'availability_declared',declared,
  'slots',(select coalesce(jsonb_agg(jsonb_build_object('starts_at',lower(r),'ends_at',upper(r)) order by lower(r)),'[]'::jsonb) from unnest(free) r),'computed_at',now());
end; $$;

-- ---------------------------------------------------------------------------------------------
-- Notification generation (private) and commands
-- ---------------------------------------------------------------------------------------------
create function public.notify(p_recipient uuid,p_kind text,p_title text,p_body text,p_dedupe text,p_intervention uuid default null,p_organization uuid default null,p_site uuid default null,p_actor uuid default null,p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_recipient is null or p_recipient=p_actor then return; end if;
 if not exists(select 1 from public.profiles where id=p_recipient) then return; end if;
 if exists(select 1 from public.notification_preferences where user_id=p_recipient and p_kind=any(muted_kinds)) then return; end if;
 insert into public.notifications(recipient_id,kind,title,body,intervention_id,organization_id,site_id,actor_id,payload,dedupe_key)
 values(p_recipient,p_kind,left(p_title,160),left(p_body,600),p_intervention,p_organization,p_site,p_actor,coalesce(p_payload,'{}'::jsonb),left(p_dedupe,200))
 on conflict(recipient_id,dedupe_key) do nothing;
end; $$;
revoke execute on function public.notify(uuid,text,text,text,text,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;

create function public.notify_intervention_transition() returns trigger language plpgsql security definer set search_path='' as $$
declare ref text; actor uuid=auth.uid(); quote_id uuid; payload jsonb;
begin
 ref=public.intervention_reference(new.id); payload=jsonb_build_object('reference',ref,'status',new.status);
 if new.artisan_id is distinct from old.artisan_id then
  if old.artisan_id is not null then
   perform public.notify(old.artisan_id,'mission_reassigned','Mission retirée','La mission '||ref||' ne vous est plus attribuée.',
    'intervention:'||new.id||':reassigned:'||old.artisan_id||':'||coalesce(new.artisan_id::text,'none'),null,null,null,actor,payload);
  end if;
  if new.artisan_id is not null then
   perform public.notify(new.artisan_id,'mission_received','Mission attribuée','La mission '||ref||' vous a été attribuée.',
    'intervention:'||new.id||':received:'||new.artisan_id,new.id,null,null,actor,payload);
   perform public.notify(new.client_id,'mission_assigned','Électricien attribué','Un électricien a été attribué à votre demande '||ref||'.',
    'intervention:'||new.id||':assigned:'||new.artisan_id,new.id,null,null,actor,payload);
  end if;
 end if;
 if new.status is distinct from old.status then
  if new.status='quoted' then
   select id into quote_id from public.quotes where intervention_id=new.id and status='sent' order by created_at desc,id desc limit 1;
   perform public.notify(new.client_id,'quote_received','Devis reçu','Un devis est disponible pour votre demande '||ref||'.',
    'intervention:'||new.id||':quoted:'||coalesce(quote_id::text,new.updated_at::text),new.id,null,null,actor,payload||jsonb_build_object('quote_id',quote_id));
  elsif new.status='assigned' and old.status='quoted' and new.artisan_id=old.artisan_id then
   perform public.notify(new.artisan_id,'quote_rejected','Devis refusé','Le devis du dossier '||ref||' a été refusé. Vous pouvez en proposer un nouveau.',
    'intervention:'||new.id||':quote_rejected:'||new.updated_at,new.id,null,null,actor,payload);
  elsif new.status='accepted' then
   perform public.notify(new.artisan_id,'quote_accepted','Devis accepté','Le devis du dossier '||ref||' a été accepté.','intervention:'||new.id||':accepted',new.id,null,null,actor,payload);
  elsif new.status='in_progress' then
   perform public.notify(new.client_id,'work_started','Intervention commencée','L’intervention '||ref||' a commencé.','intervention:'||new.id||':started',new.id,null,null,actor,payload);
  elsif new.status='completed' then
   perform public.notify(new.client_id,'work_completed','Intervention terminée','L’intervention '||ref||' est terminée. Le règlement peut être effectué.','intervention:'||new.id||':completed',new.id,null,null,actor,payload);
  elsif new.status='paid' then
   perform public.notify(new.artisan_id,'payment_confirmed','Règlement confirmé','Le règlement de l’intervention '||ref||' est confirmé.','intervention:'||new.id||':paid:'||new.artisan_id,new.id,null,null,actor,payload);
   perform public.notify(new.client_id,'payment_confirmed','Règlement confirmé','Votre règlement pour l’intervention '||ref||' est confirmé.','intervention:'||new.id||':paid:'||new.client_id,new.id,null,null,actor,payload);
  elsif new.status='cancelled' and new.artisan_id is not null then
   perform public.notify(new.artisan_id,'mission_cancelled','Mission annulée','La demande '||ref||' a été annulée.','intervention:'||new.id||':cancelled',new.id,null,null,actor,payload);
  end if;
 end if;
 return new;
end; $$;
create trigger intervention_notifications after update on public.interventions for each row execute function public.notify_intervention_transition();

create function public.notify_appointment_saved() returns trigger language plpgsql security definer set search_path='' as $$
declare job public.interventions; recipient uuid;
begin
 select * into job from public.interventions where id=new.intervention_id;
 if job.artisan_id is null then return new; end if;
 recipient=case when new.updated_by=job.artisan_id then job.client_id else job.artisan_id end;
 perform public.notify(recipient,'appointment_saved','Rendez-vous enregistré',
  'Un créneau a été enregistré pour le dossier '||public.intervention_reference(job.id)||' : le '||to_char(new.starts_at at time zone 'America/Martinique','DD/MM/YYYY')||' de '||to_char(new.starts_at at time zone 'America/Martinique','HH24:MI')||' à '||to_char(new.ends_at at time zone 'America/Martinique','HH24:MI')||' (heure de Martinique).',
  'appointment:'||new.intervention_id||':'||new.updated_at,new.intervention_id,null,null,new.updated_by,
  jsonb_build_object('reference',public.intervention_reference(job.id),'starts_at',new.starts_at,'ends_at',new.ends_at));
 return new;
end; $$;
create trigger appointment_notifications after insert or update on public.intervention_appointments for each row execute function public.notify_appointment_saved();

create function public.notify_message_received() returns trigger language plpgsql security definer set search_path='' as $$
declare job public.interventions; ref text;
begin
 select * into job from public.interventions where id=new.intervention_id;
 if job.artisan_id is null then return new; end if;
 ref=public.intervention_reference(job.id);
 perform public.notify(job.client_id,'message_received','Nouveau message','Un nouveau message concerne le dossier '||ref||'.','message:'||new.id||':'||job.client_id,job.id,null,null,new.author_id,jsonb_build_object('reference',ref,'message_id',new.id));
 perform public.notify(job.artisan_id,'message_received','Nouveau message','Un nouveau message concerne le dossier '||ref||'.','message:'||new.id||':'||job.artisan_id,job.id,null,null,new.author_id,jsonb_build_object('reference',ref,'message_id',new.id));
 return new;
end; $$;
create trigger message_notifications after insert on public.messages for each row execute function public.notify_message_received();

-- Only an operator decision notifies; the self-reset of 003 (dossier edited) is silent.
create function public.notify_artisan_approval() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.artisan_approved is distinct from old.artisan_approved and auth.uid() is distinct from new.id and public.is_admin() then
  if new.artisan_approved then
   perform public.notify(new.id,'account_approved','Compte approuvé','Votre dossier professionnel est approuvé : vous pouvez recevoir des missions.','profile:'||new.id||':approved:'||now(),null,null,null,auth.uid(),'{}'::jsonb);
  else
   perform public.notify(new.id,'account_suspended','Compte suspendu','Votre compte professionnel est suspendu. Contactez l’assistance pour en connaître les conditions de reprise.','profile:'||new.id||':suspended:'||now(),null,null,null,auth.uid(),'{}'::jsonb);
  end if;
 end if;
 return new;
end; $$;
create trigger artisan_approval_notifications after update of artisan_approved on public.profiles for each row execute function public.notify_artisan_approval();

create function public.notify_approval_requested() returns trigger language plpgsql security definer set search_path='' as $$
declare owner uuid; site_name text; job uuid; ref text;
begin
 select o.owner_id,s.name into owner,site_name from public.sites s join public.organizations o on o.id=s.organization_id where s.id=new.site_id;
 select intervention_id into job from public.quotes where id=new.quote_id;
 ref=public.intervention_reference(job);
 perform public.notify(owner,'approval_requested','Approbation requise','Un devis du dossier '||ref||' dépasse le seuil d’approbation du site '||site_name||'.','approval:'||new.id||':requested',job,null,new.site_id,auth.uid(),jsonb_build_object('reference',ref,'approval_id',new.id,'quote_id',new.quote_id));
 return new;
end; $$;
create trigger approval_request_notifications after insert on public.approvals for each row execute function public.notify_approval_requested();
create function public.notify_approval_decided() returns trigger language plpgsql security definer set search_path='' as $$
declare job public.interventions; ref text;
begin
 if new.status is distinct from old.status and new.status in ('approved','rejected') then
  select i.* into job from public.quotes q join public.interventions i on i.id=q.intervention_id where q.id=new.quote_id;
  ref=public.intervention_reference(job.id);
  perform public.notify(job.client_id,'approval_decided',case when new.status='approved' then 'Devis approuvé en interne' else 'Devis refusé en interne' end,
   'La demande d’approbation du devis du dossier '||ref||' a été '||case when new.status='approved' then 'approuvée' else 'refusée' end||'.',
   'approval:'||new.id||':'||new.status,job.id,null,new.site_id,new.decided_by,jsonb_build_object('reference',ref,'approval_id',new.id,'decision',new.status));
 end if;
 return new;
end; $$;
create trigger approval_decision_notifications after update on public.approvals for each row execute function public.notify_approval_decided();

create function public.notify_support_reply() returns trigger language plpgsql security definer set search_path='' as $$
declare ticket public.support_tickets;
begin
 if new.author_kind<>'admin' then return new; end if;
 select * into ticket from public.support_tickets where id=new.ticket_id;
 perform public.notify(ticket.creator_id,'support_replied','Réponse de l’assistance','L’assistance a répondu à votre demande « '||left(ticket.subject,80)||' ».','support:'||new.id,null,null,null,new.author_id,jsonb_build_object('ticket_id',ticket.id));
 return new;
end; $$;
create trigger support_reply_notifications after insert on public.support_messages for each row execute function public.notify_support_reply();
create function public.notify_support_status() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status and public.is_admin() then
  perform public.notify(new.creator_id,'support_status_changed','Demande d’assistance mise à jour','Votre demande « '||left(new.subject,80)||' » est maintenant : '||
   case new.status when 'open' then 'ouverte' when 'in_progress' then 'en cours de traitement' when 'awaiting_user' then 'en attente de votre réponse' else 'résolue' end||'.',
   'support:'||new.id||':'||new.status||':'||new.version,null,null,null,auth.uid(),jsonb_build_object('ticket_id',new.id,'status',new.status));
 end if;
 return new;
end; $$;
create trigger support_status_notifications after update on public.support_tickets for each row execute function public.notify_support_status();

create function public.notify_membership_change() returns trigger language plpgsql security definer set search_path='' as $$
declare org public.organizations;
begin
 if tg_op='INSERT' then
  select * into org from public.organizations where id=new.organization_id;
  if org.owner_id is distinct from new.user_id then
   perform public.notify(org.owner_id,'member_joined','Nouveau membre','Un membre a rejoint l’organisation '||org.name||'.','org:'||new.organization_id||':joined:'||new.user_id,null,new.organization_id,null,auth.uid(),jsonb_build_object('user_id',new.user_id,'role',new.role));
  end if;
  return new;
 end if;
 select * into org from public.organizations where id=old.organization_id;
 perform public.notify(old.user_id,'membership_removed','Accès retiré','Votre accès à l’organisation '||coalesce(org.name,'')||' a été retiré.','org:'||old.organization_id||':removed:'||old.user_id||':'||now(),null,null,null,auth.uid(),jsonb_build_object('organization_name',org.name));
 return old;
end; $$;
create trigger membership_notifications after insert or delete on public.organization_members for each row execute function public.notify_membership_change();
revoke execute on function public.notify_intervention_transition(),public.notify_appointment_saved(),public.notify_message_received(),public.notify_artisan_approval(),public.notify_approval_requested(),public.notify_approval_decided(),public.notify_support_reply(),public.notify_support_status(),public.notify_membership_change() from public,anon,authenticated;

create function public.notification_summary() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('unread_count',count(*) filter(where read_at is null),'latest_created_at',max(created_at))
 from public.notifications where recipient_id=auth.uid() and auth.uid() is not null and public.notification_scope_visible(intervention_id,site_id,organization_id);
$$;
create function public.mark_notifications(p_action text,p_ids uuid[] default null,p_before timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare updated integer; cutoff timestamptz;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if p_action is null or p_action not in ('read','unread','read_all') then raise invalid_parameter_value; end if;
 if p_action in ('read','unread') and (p_ids is null or cardinality(p_ids) not between 1 and 100 or p_before is not null or exists(select 1 from unnest(p_ids) x where x is null)) then raise invalid_parameter_value; end if;
 if p_action='read_all' and p_ids is not null then raise invalid_parameter_value; end if;
 cutoff=coalesce(p_before,now());
 if not isfinite(cutoff) then raise invalid_parameter_value; end if;
 perform public.consume_action('notifications',60);
 update public.notifications set read_at=case when p_action='unread' then null else coalesce(read_at,now()) end
 where recipient_id=auth.uid() and public.notification_scope_visible(intervention_id,site_id,organization_id)
  and ((p_action='read_all' and read_at is null and created_at<=cutoff)
   or (p_action='read' and read_at is null and id=any(p_ids))
   or (p_action='unread' and read_at is not null and id=any(p_ids)));
 get diagnostics updated=row_count;
 return jsonb_build_object('updated',updated,'unread_count',(select count(*) from public.notifications where recipient_id=auth.uid() and read_at is null and public.notification_scope_visible(intervention_id,site_id,organization_id)));
end; $$;
create function public.save_notification_preferences(p_muted_kinds text[],p_email boolean,p_sms boolean,p_push boolean,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare prefs public.notification_preferences; current_version integer; kinds text[];
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if p_muted_kinds is null or p_email is null or p_sms is null or p_push is null or p_expected_version is null or p_expected_version<0 or cardinality(p_muted_kinds)>30 then raise invalid_parameter_value; end if;
 select coalesce(array_agg(distinct k order by k),'{}') into kinds from unnest(p_muted_kinds) k;
 if exists(select 1 from unnest(kinds) k where k is null or k not in ('mission_assigned','mission_received','mission_reassigned','quote_received','quote_rejected','quote_accepted','work_started','work_completed','payment_confirmed','mission_cancelled','appointment_saved','message_received','account_approved','account_suspended','approval_requested','approval_decided','support_replied','support_status_changed','member_joined','membership_removed')) then raise invalid_parameter_value; end if;
 select * into prefs from public.notification_preferences where user_id=auth.uid() for update;
 current_version=coalesce(prefs.version,0);
 if current_version<>p_expected_version or current_version=2147483647 then raise exception 'Preferences revision changed' using errcode='P0001'; end if;
 perform public.consume_action('notifications',60);
 insert into public.notification_preferences(user_id,muted_kinds,email_enabled,sms_enabled,push_enabled,version)
 values(auth.uid(),kinds,p_email,p_sms,p_push,current_version+1)
 on conflict(user_id) do update set muted_kinds=excluded.muted_kinds,email_enabled=excluded.email_enabled,sms_enabled=excluded.sms_enabled,push_enabled=excluded.push_enabled,version=excluded.version,updated_at=now()
 returning * into prefs;
 return jsonb_build_object('preferences',to_jsonb(prefs));
end; $$;

revoke execute on function public.save_availability_rule(uuid,uuid,integer,integer,integer,text,date,date,integer),public.delete_availability_rule(uuid,integer),public.save_planning_entry(uuid,uuid,text,timestamptz,timestamptz,text,text,integer),public.delete_planning_entry(uuid,integer),public.artisan_planning(timestamptz,timestamptz),public.intervention_free_slots(uuid,timestamptz,timestamptz),public.notification_summary(),public.mark_notifications(text,uuid[],timestamptz),public.save_notification_preferences(text[],boolean,boolean,boolean,integer) from public,anon,authenticated;
grant execute on function public.save_availability_rule(uuid,uuid,integer,integer,integer,text,date,date,integer),public.delete_availability_rule(uuid,integer),public.save_planning_entry(uuid,uuid,text,timestamptz,timestamptz,text,text,integer),public.delete_planning_entry(uuid,integer),public.artisan_planning(timestamptz,timestamptz),public.intervention_free_slots(uuid,timestamptz,timestamptz),public.notification_summary(),public.mark_notifications(text,uuid[],timestamptz),public.save_notification_preferences(text[],boolean,boolean,boolean,integer) to authenticated;
commit;
