-- WEB-TRACKING-BACKEND-006: one consented latest point, no journey history.
begin;
create table public.intervention_tracking (
 intervention_id uuid primary key references public.interventions(id) on delete cascade,
 artisan_id uuid references public.profiles(id), session_id uuid,
 control_version integer not null default 0 check(control_version between 0 and 2147483647),
 shared boolean not null default false, consent_at timestamptz, consent_policy text,
 last_seq integer not null default 0 check(last_seq between 0 and 2147483647),
 latitude double precision, longitude double precision, accuracy_m double precision,
 sampled_at timestamptz, received_at timestamptz,
 destination_latitude double precision, destination_longitude double precision, destination_label text,
 destination_source text, confirmed_by uuid references public.profiles(id), confirmed_at timestamptz,
 destination_version integer not null default 0 check(destination_version between 0 and 2147483647),
 check((latitude is null and longitude is null and accuracy_m is null and sampled_at is null and received_at is null)
  or (latitude is not null and longitude is not null and accuracy_m is not null and latitude between -90 and 90 and longitude between -180 and 180 and accuracy_m between 1 and 250 and sampled_at is not null and received_at is not null)),
 check((destination_latitude is null and destination_longitude is null and destination_label is null and destination_source is null and confirmed_by is null and confirmed_at is null)
  or (destination_latitude is not null and destination_longitude is not null and destination_label is not null and destination_source is not null and destination_latitude between -90 and 90 and destination_longitude between -180 and 180 and char_length(destination_label) between 1 and 200 and destination_source in ('manual','ign') and confirmed_by is not null and confirmed_at is not null)),
 check(not shared or (artisan_id is not null and session_id is not null and consent_at is not null and consent_policy='tracking-v1'))
);
create table public.tracking_provider_budget (
 id text primary key check(id='ign'), next_allowed_at timestamptz not null default '-infinity', backoff_until timestamptz not null default '-infinity'
);
insert into public.tracking_provider_budget(id) values('ign');
create table public.tracking_provider_leases (
 intervention_id uuid not null references public.interventions(id) on delete cascade,
 operation text not null check(operation in ('route','geocode')), cache_key text not null check(cache_key ~ '^[a-f0-9]{64}$'),
 lease_until timestamptz not null, next_allowed_at timestamptz not null,
 primary key(intervention_id,operation)
);
alter table public.intervention_tracking enable row level security;
alter table public.tracking_provider_budget enable row level security;
alter table public.tracking_provider_leases enable row level security;
revoke all on public.intervention_tracking,public.tracking_provider_budget,public.tracking_provider_leases from public,anon,authenticated;
grant select on public.intervention_tracking to authenticated;
grant all on public.intervention_tracking,public.tracking_provider_budget,public.tracking_provider_leases to service_role;

create function public.tracking_artisan_eligible(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.interventions i join public.profiles p on p.id=i.artisan_id join public.artisan_profiles a on a.user_id=p.id
 where i.id=p_id and i.status in ('accepted','in_progress') and p.role='artisan' and p.artisan_approved and a.application_status='approved');
$$;
revoke execute on function public.tracking_artisan_eligible(uuid) from public,anon,authenticated;
create function public.tracking_row_visible(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.can_access_intervention(p_id) and exists(select 1 from public.intervention_tracking t join public.interventions i on i.id=t.intervention_id where t.intervention_id=p_id and
 (t.latitude is null or (t.shared and t.artisan_id=i.artisan_id and public.tracking_artisan_eligible(p_id) and i.travel_stage='en_route' and t.sampled_at>=now()-interval '60 seconds' and t.received_at>=now()-interval '60 seconds')));
$$;
revoke execute on function public.tracking_row_visible(uuid) from public,anon,authenticated;
grant execute on function public.tracking_row_visible(uuid) to authenticated;
create policy tracking_private_read on public.intervention_tracking for select to authenticated using(public.tracking_row_visible(intervention_id));

create function public.purge_expired_tracking_points() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 update public.intervention_tracking set latitude=null,longitude=null,accuracy_m=null,sampled_at=null,received_at=null
 where latitude is not null and (sampled_at<clock_timestamp()-interval '60 seconds' or received_at<clock_timestamp()-interval '60 seconds');
 get diagnostics n=row_count; return n;
end; $$;
revoke execute on function public.purge_expired_tracking_points() from public,anon,authenticated;
grant execute on function public.purge_expired_tracking_points() to service_role;

create function public.tracking_snapshot(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.interventions; t public.intervention_tracking; eligible boolean; fresh boolean;
begin
 if auth.uid() is null or not public.can_access_intervention(p_id) then raise insufficient_privilege; end if;
 select * into job from public.interventions where id=p_id;
 if not found then raise insufficient_privilege; end if;
 -- Conditional UPDATE rechecks the expiry predicate if it waited for a newer point writer.
 update public.intervention_tracking set latitude=null,longitude=null,accuracy_m=null,sampled_at=null,received_at=null
 where intervention_id=p_id and latitude is not null and (sampled_at<clock_timestamp()-interval '60 seconds' or received_at<clock_timestamp()-interval '60 seconds');
 select * into t from public.intervention_tracking where intervention_id=p_id;
 eligible=public.tracking_artisan_eligible(p_id);
 fresh=coalesce(t.shared and eligible and t.artisan_id=job.artisan_id and job.travel_stage='en_route' and t.latitude is not null and t.sampled_at>=clock_timestamp()-interval '60 seconds' and t.received_at>=clock_timestamp()-interval '60 seconds',false);
 return jsonb_build_object('server_time',clock_timestamp(),'permissions',jsonb_build_object(
  'can_share',coalesce(eligible and job.artisan_id=auth.uid(),false),
  'can_confirm_destination',job.status not in ('completed','paid','cancelled') and (public.owns_intervention(p_id) or public.is_admin())),
  'tracking',jsonb_build_object('intervention_id',job.id,'artisan_id',job.artisan_id,'travel_stage',job.travel_stage,
   'session_id',t.session_id,'control_version',coalesce(t.control_version,0),'shared',coalesce(t.shared,false),
   'consent_at',t.consent_at,'last_seq',coalesce(t.last_seq,0),'destination_version',coalesce(t.destination_version,0),
   'position_state',case when fresh then 'fresh' when not coalesce(t.shared,false) then 'stopped' when coalesce(t.last_seq,0)>0 then 'stale' else 'no_position' end,
   'position',case when fresh then jsonb_build_object('latitude',t.latitude,'longitude',t.longitude,'accuracy_m',t.accuracy_m,'sampled_at',t.sampled_at,'received_at',t.received_at) else null end,
   'destination',case when t.destination_latitude is not null then jsonb_build_object('latitude',t.destination_latitude,'longitude',t.destination_longitude,'label',t.destination_label,'source',t.destination_source,'confirmed_by',t.confirmed_by,'confirmed_at',t.confirmed_at) else null end));
end; $$;
revoke execute on function public.tracking_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.tracking_snapshot(uuid) to authenticated;

create function public.tracking_command(p_id uuid,p_action text,p_expected_version integer,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.interventions; t public.intervention_tracking; sid uuid; seq integer; lat double precision; lon double precision; accuracy double precision; sampled timestamptz; can_target boolean; clear_target boolean;
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 if p_action is null or p_action not in ('start','point','stop','arrived','destination') or p_expected_version is null or p_expected_version<0 or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise invalid_parameter_value; end if;
 perform public.lock_intervention_organization(p_id);
 select * into job from public.interventions where id=p_id for update;
 if not found or not public.can_access_intervention(p_id) then raise insufficient_privilege; end if;
 -- Same ordering as assignment/start-work: job -> profile -> artisan dossier, then tracking.
 if job.artisan_id is not null then
  perform 1 from public.profiles where id=job.artisan_id for update;
  perform 1 from public.artisan_profiles where user_id=job.artisan_id for update;
 end if;
 can_target=job.status not in ('completed','paid','cancelled') and (public.owns_intervention(p_id) or public.is_admin());
 if p_action='destination' then
  if not can_target then raise insufficient_privilege; end if;
 elsif job.artisan_id is distinct from auth.uid() or not public.tracking_artisan_eligible(p_id) then raise insufficient_privilege;
 end if;
 insert into public.intervention_tracking(intervention_id,artisan_id) values(p_id,job.artisan_id) on conflict do nothing;
 select * into t from public.intervention_tracking where intervention_id=p_id for update;
 if t.control_version<>p_expected_version or t.control_version=2147483647 then raise exception 'Tracking revision changed' using errcode='P0001'; end if;
 if p_action='destination' then
  clear_target=p_payload='{"clear":true}'::jsonb;
  if not clear_target then
   if p_payload-array['latitude','longitude','label','source','candidate_label']<>'{}'::jsonb or not(p_payload ?& array['latitude','longitude','label','source'])
    or jsonb_typeof(p_payload->'latitude')<>'number' or jsonb_typeof(p_payload->'longitude')<>'number' or jsonb_typeof(p_payload->'label')<>'string' or jsonb_typeof(p_payload->'source')<>'string'
    or p_payload->>'source' not in ('manual','ign') or char_length(trim(p_payload->>'label')) not between 1 and 200
    or (p_payload ? 'candidate_label' and (jsonb_typeof(p_payload->'candidate_label')<>'string' or char_length(p_payload->>'candidate_label')>200)) then raise invalid_parameter_value; end if;
   lat=(p_payload->>'latitude')::double precision; lon=(p_payload->>'longitude')::double precision;
   if not(lat between -90 and 90) or not(lon between -180 and 180) then raise invalid_parameter_value; end if;
  end if;
  if t.destination_version=2147483647 then raise exception 'Tracking destination revision exhausted' using errcode='P0001'; end if;
  perform public.consume_action('tracking_control',30);
  update public.intervention_tracking set destination_latitude=case when clear_target then null else lat end,destination_longitude=case when clear_target then null else lon end,
   destination_label=case when clear_target then null else trim(p_payload->>'label') end,destination_source=case when clear_target then null else p_payload->>'source' end,
   confirmed_by=case when clear_target then null else auth.uid() end,confirmed_at=case when clear_target then null else clock_timestamp() end,
   destination_version=destination_version+1,control_version=control_version+1,shared=false,session_id=null,consent_at=null,consent_policy=null,last_seq=0,
   latitude=null,longitude=null,accuracy_m=null,sampled_at=null,received_at=null where intervention_id=p_id;
 elsif p_action='start' then
  if p_payload-array['session_id','consent','consent_policy']<>'{}'::jsonb or jsonb_typeof(p_payload->'session_id') is distinct from 'string' or p_payload->>'session_id' !~ '^[0-9a-fA-F-]{36}$'
   or p_payload->'consent' is distinct from 'true'::jsonb or p_payload->>'consent_policy' is distinct from 'tracking-v1' then raise invalid_parameter_value; end if;
  sid=(p_payload->>'session_id')::uuid;
  if t.shared then
   if t.session_id=sid then return public.tracking_snapshot(p_id); end if;
   raise exception 'A tracking session is already active' using errcode='P0001';
  end if;
  perform public.consume_action('tracking_control',30);
  perform public.set_travel_stage(p_id,'en_route');
  update public.intervention_tracking set artisan_id=job.artisan_id,session_id=sid,shared=true,consent_at=clock_timestamp(),consent_policy='tracking-v1',control_version=control_version+1,last_seq=0,
   latitude=null,longitude=null,accuracy_m=null,sampled_at=null,received_at=null where intervention_id=p_id;
 else
  if jsonb_typeof(p_payload->'session_id') is distinct from 'string' or p_payload->>'session_id' !~ '^[0-9a-fA-F-]{36}$' then raise invalid_parameter_value; end if;
  sid=(p_payload->>'session_id')::uuid;
  if not t.shared or t.session_id is distinct from sid or t.artisan_id is distinct from auth.uid() then raise exception 'Tracking session changed' using errcode='P0001'; end if;
  if p_action='point' then
   if p_payload-array['session_id','seq','latitude','longitude','accuracy_m','sampled_at']<>'{}'::jsonb or not(p_payload ?& array['seq','latitude','longitude','accuracy_m','sampled_at'])
    or jsonb_typeof(p_payload->'seq')<>'number' or (p_payload->>'seq') !~ '^[1-9][0-9]{0,9}$'
    or jsonb_typeof(p_payload->'latitude')<>'number' or jsonb_typeof(p_payload->'longitude')<>'number' or jsonb_typeof(p_payload->'accuracy_m')<>'number'
    or jsonb_typeof(p_payload->'sampled_at')<>'string' or (p_payload->>'sampled_at') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise invalid_parameter_value; end if;
   seq=(p_payload->>'seq')::integer; lat=(p_payload->>'latitude')::double precision; lon=(p_payload->>'longitude')::double precision; accuracy=(p_payload->>'accuracy_m')::double precision; sampled=(p_payload->>'sampled_at')::timestamptz;
   if not(lat between -90 and 90) or not(lon between -180 and 180) or not(accuracy between 1 and 250) or sampled<clock_timestamp()-interval '60 seconds' or sampled>clock_timestamp()+interval '5 seconds' then raise invalid_parameter_value; end if;
   if seq=t.last_seq and t.latitude=lat and t.longitude=lon and t.accuracy_m=accuracy and t.sampled_at=sampled then return public.tracking_snapshot(p_id); end if;
   if seq<=t.last_seq or (t.sampled_at is not null and sampled<=t.sampled_at) then raise exception 'Tracking sample is obsolete' using errcode='P0001'; end if;
   if t.received_at>clock_timestamp()-interval '5 seconds' then raise exception 'Tracking sample rate exceeded' using errcode='53300'; end if;
   perform public.consume_action('tracking_point',30);
   update public.intervention_tracking set last_seq=seq,latitude=lat,longitude=lon,accuracy_m=accuracy,sampled_at=sampled,received_at=clock_timestamp() where intervention_id=p_id;
  else
   if p_payload-array['session_id']<>'{}'::jsonb then raise invalid_parameter_value; end if;
   perform public.consume_action('tracking_control',30);
   if p_action='arrived' then perform public.set_travel_stage(p_id,'on_site'); end if;
   -- Arrival's travel-stage trigger may already have invalidated the row; never overflow or revive it.
   update public.intervention_tracking set shared=false,session_id=null,consent_at=null,consent_policy=null,last_seq=0,control_version=least(control_version::bigint+1,2147483647)::integer,
    latitude=null,longitude=null,accuracy_m=null,sampled_at=null,received_at=null where intervention_id=p_id and shared;
  end if;
 end if;
 if p_action<>'point' then delete from public.tracking_provider_leases where intervention_id=p_id; end if;
 return public.tracking_snapshot(p_id);
end; $$;
revoke execute on function public.tracking_command(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.tracking_command(uuid,text,integer,jsonb) to authenticated;

create function public.tracking_intervention_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare target_changed boolean;
begin
 target_changed=(new.site_id,new.address,new.postal_code,new.city) is distinct from (old.site_id,old.address,old.postal_code,old.city);
 if target_changed or new.artisan_id is distinct from old.artisan_id or new.status not in ('accepted','in_progress') or new.travel_stage in ('planned','on_site') then
  update public.intervention_tracking set artisan_id=new.artisan_id,shared=false,session_id=null,consent_at=null,consent_policy=null,last_seq=0,control_version=least(control_version::bigint+1,2147483647)::integer,
   latitude=null,longitude=null,accuracy_m=null,sampled_at=null,received_at=null,
   destination_latitude=case when target_changed then null else destination_latitude end,destination_longitude=case when target_changed then null else destination_longitude end,
   destination_label=case when target_changed then null else destination_label end,destination_source=case when target_changed then null else destination_source end,
   confirmed_by=case when target_changed then null else confirmed_by end,confirmed_at=case when target_changed then null else confirmed_at end,
   destination_version=case when target_changed then least(destination_version::bigint+1,2147483647)::integer else destination_version end where intervention_id=new.id;
  delete from public.tracking_provider_leases where intervention_id=new.id;
 end if;
 return new;
end; $$;
revoke execute on function public.tracking_intervention_changed() from public,anon,authenticated;
create trigger tracking_intervention_invalidation after update of artisan_id,status,travel_stage,site_id,address,postal_code,city on public.interventions for each row execute function public.tracking_intervention_changed();
create function public.tracking_artisan_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 if tg_table_name='profiles' then
  if new.artisan_approved and new.role='artisan' then return new; end if; actor=new.id;
 else
  if new.application_status='approved' then return new; end if; actor=new.user_id;
 end if;
 -- No intervention lock: profile/dossier writers must not reverse the job->profile ordering.
 perform 1 from public.intervention_tracking where artisan_id=actor order by intervention_id for update;
 update public.intervention_tracking set shared=false,session_id=null,consent_at=null,consent_policy=null,last_seq=0,control_version=least(control_version::bigint+1,2147483647)::integer,
  latitude=null,longitude=null,accuracy_m=null,sampled_at=null,received_at=null where artisan_id=actor;
 delete from public.tracking_provider_leases l using public.intervention_tracking t where l.intervention_id=t.intervention_id and t.artisan_id=actor;
 return new;
end; $$;
revoke execute on function public.tracking_artisan_changed() from public,anon,authenticated;
create trigger tracking_profile_invalidation after update of artisan_approved,role on public.profiles for each row execute function public.tracking_artisan_changed();
create trigger tracking_dossier_invalidation after update of application_status on public.artisan_profiles for each row execute function public.tracking_artisan_changed();

-- Service-only shared pacing across all server instances; never an authority for business access.
create function public.claim_tracking_provider(p_intervention_id uuid,p_operation text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare budget public.tracking_provider_budget; lease public.tracking_provider_leases; current_time_ timestamptz; due timestamptz;
begin
 if p_intervention_id is null or p_operation is null or p_operation not in ('route','geocode') or p_key is null or p_key !~ '^[a-f0-9]{64}$' then raise invalid_parameter_value; end if;
 -- Acquire the FK parent before budget/lease rows; never wait for a job while holding its lease.
 perform 1 from public.interventions where id=p_intervention_id for key share;
 if not found then raise no_data_found; end if;
 select * into budget from public.tracking_provider_budget where id='ign' for update;
 if not found then raise exception 'Tracking budget unavailable' using errcode='P0001'; end if;
 select * into lease from public.tracking_provider_leases where intervention_id=p_intervention_id and operation=p_operation for update;
 current_time_=clock_timestamp(); due=greatest(budget.next_allowed_at,budget.backoff_until,coalesce(lease.next_allowed_at,'-infinity'::timestamptz),coalesce(lease.lease_until,'-infinity'::timestamptz));
 if due>current_time_ then return jsonb_build_object('allowed',false,'retry_after_s',greatest(1,ceil(extract(epoch from due-current_time_))::integer)); end if;
 update public.tracking_provider_budget set next_allowed_at=current_time_+interval '300 milliseconds' where id='ign';
 insert into public.tracking_provider_leases(intervention_id,operation,cache_key,lease_until,next_allowed_at)
 values(p_intervention_id,p_operation,p_key,current_time_+interval '8 seconds',current_time_+case when p_operation='route' then interval '30 seconds' else interval '1 second' end)
 on conflict(intervention_id,operation) do update set cache_key=excluded.cache_key,lease_until=excluded.lease_until,next_allowed_at=excluded.next_allowed_at;
 return jsonb_build_object('allowed',true,'retry_after_s',0);
end; $$;
create function public.tracking_provider_backoff(p_delay_seconds integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_delay_seconds is null or p_delay_seconds not between 1 and 60 then raise invalid_parameter_value; end if;
 update public.tracking_provider_budget set backoff_until=greatest(backoff_until,clock_timestamp()+make_interval(secs=>p_delay_seconds)) where id='ign';
end; $$;
revoke execute on function public.claim_tracking_provider(uuid,text,text),public.tracking_provider_backoff(integer) from public,anon,authenticated;
grant execute on function public.claim_tracking_provider(uuid,text,text),public.tracking_provider_backoff(integer) to service_role;
commit;
