begin;
create schema if not exists notification_delivery_private;
revoke all on schema notification_delivery_private from public,anon,authenticated;
grant usage on schema notification_delivery_private to service_role;
create table notification_delivery_private.control(singleton boolean primary key default true check(singleton), enabled boolean not null default false, generation integer not null default 1 check(generation between 1 and 2147483647));
insert into notification_delivery_private.control values(true,false,1);
create table notification_delivery_private.outbox(
 id uuid primary key default gen_random_uuid(),
 notification_id uuid not null references public.notifications(id) on delete cascade,
 activation_generation integer not null,
 channel text not null check(channel in('email','push')),
 status text not null default 'pending' check(status in('pending','leased','sending','uncertain','accepted','failed','cancelled')),
 may_have_been_accepted boolean not null default false,
 retry_stopped boolean not null default false,
 attempts integer not null default 0 check(attempts between 0 and 3),
 provider text check(char_length(provider) between 1 and 80),
 lease_token uuid, lease_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 provider_reference text check(char_length(provider_reference) between 1 and 200),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(notification_id,channel)
);
create index external_outbox_ready on notification_delivery_private.outbox(next_attempt_at,created_at,id) where status in('pending','leased','sending','uncertain');
create table notification_delivery_private.enqueue_failures(
 notification_id uuid primary key references public.notifications(id) on delete cascade,
 error_code text not null, created_at timestamptz not null default now()
);
alter table notification_delivery_private.control enable row level security;
alter table notification_delivery_private.outbox enable row level security;
alter table notification_delivery_private.enqueue_failures enable row level security;
revoke all on all tables in schema notification_delivery_private from public,anon,authenticated,service_role;
grant select on all tables in schema notification_delivery_private to service_role;
-- No activation endpoint, no cron, no provider configuration. Control remains false.
create function notification_delivery_private.control_generation()returns trigger language plpgsql set search_path=''as $$
begin
 new.generation=old.generation+case when new.enabled is distinct from old.enabled then 1 else 0 end;
 return new;
end;$$;
revoke all on function notification_delivery_private.control_generation()from public,anon,authenticated,service_role;
create trigger external_control_generation before update on notification_delivery_private.control for each row execute function notification_delivery_private.control_generation();


-- Evaluate EXACT existing notification visibility as its recipient, then restore caller claims.
-- Private helper: never an impersonation endpoint for API roles.
create function notification_delivery_private.eligible(p_notification uuid,p_channel text) returns boolean language plpgsql security definer set search_path='' as $$
declare n public.notifications; ok boolean; old_sub text=current_setting('request.jwt.claim.sub',true); old_claims text=current_setting('request.jwt.claims',true);
begin
 select * into n from public.notifications where id=p_notification;
 if not found or p_channel not in('email','push') then return false;end if;
 if not exists(select 1 from public.notification_preferences p where p.user_id=n.recipient_id and not(n.kind=any(p.muted_kinds)) and case p_channel when 'email' then p.email_enabled else p.push_enabled end)then return false;end if;
 perform set_config('request.jwt.claim.sub',n.recipient_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',n.recipient_id,'role','authenticated')::text,true);
 ok=public.notification_scope_visible(n.intervention_id,n.site_id,n.organization_id,n.support_ticket_id);
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 return coalesce(ok,false);
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 raise;
end;$$;
revoke all on function notification_delivery_private.eligible(uuid,text) from public,anon,authenticated,service_role;

create function notification_delivery_private.enqueue()returns trigger language plpgsql security definer set search_path=''as $$
begin
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
create trigger notification_external_enqueue after insert on public.notifications for each row execute function notification_delivery_private.enqueue();

create function public.claim_external_notification(p_channel text,p_provider text,p_idempotent boolean)returns jsonb language plpgsql security definer set search_path=''as $$
declare r notification_delivery_private.outbox;
begin
 if p_channel is null or p_channel not in('email','push')or p_provider is null or p_provider!~'^[a-zA-Z0-9_.-]{1,80}$'or p_idempotent is distinct from true then raise invalid_parameter_value;end if;
 if not exists(select 1 from notification_delivery_private.control where enabled)then return null;end if;
 -- One bounded candidate; expired sending is never silently classified as not sent.
 select *into r from notification_delivery_private.outbox where not retry_stopped and channel=p_channel and (provider is null or provider=p_provider)
 and ((status in('pending','uncertain')and attempts<3 and next_attempt_at<=clock_timestamp())or(status in('leased','sending')and lease_until<=clock_timestamp()))
 order by next_attempt_at,created_at,id for update skip locked limit 1;
 if not found then return null;end if;
 if r.status='sending' and r.attempts>=3 then
  update notification_delivery_private.outbox set status='uncertain',may_have_been_accepted=true,retry_stopped=true,lease_token=null,lease_until=null,updated_at=clock_timestamp()where id=r.id;return jsonb_build_object('skipped',true);
 end if;
 if not exists(select 1 from notification_delivery_private.control where enabled and generation=r.activation_generation)or not notification_delivery_private.eligible(r.notification_id,r.channel)then
  update notification_delivery_private.outbox set status=case when r.status in('sending','uncertain')or r.may_have_been_accepted then 'uncertain'else 'cancelled'end,may_have_been_accepted=r.status in('sending','uncertain')or r.may_have_been_accepted,retry_stopped=true,lease_token=null,lease_until=null,updated_at=clock_timestamp()where id=r.id;
  return jsonb_build_object('skipped',true);
 end if;
 update notification_delivery_private.outbox set status='leased',may_have_been_accepted=r.status in('sending','uncertain')or r.may_have_been_accepted,provider=p_provider,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()where id=r.id returning *into r;
 return jsonb_build_object('id',r.id,'lease_token',r.lease_token);
end;$$;

create function public.begin_external_notification(p_id uuid,p_lease uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r notification_delivery_private.outbox;recipient uuid;
begin
 select *into r from notification_delivery_private.outbox where id=p_id for update;
 if not found or r.status<>'leased'or r.lease_token is distinct from p_lease or r.lease_until<=clock_timestamp()then return null;end if;
 if not exists(select 1 from notification_delivery_private.control where enabled)then return null;end if;
 if not exists(select 1 from notification_delivery_private.control where enabled and generation=r.activation_generation)or not notification_delivery_private.eligible(r.notification_id,r.channel)then
  update notification_delivery_private.outbox set status=case when may_have_been_accepted then 'uncertain'else 'cancelled'end,retry_stopped=true,lease_token=null,lease_until=null,updated_at=clock_timestamp()where id=r.id;return null;
 end if;
 if r.attempts>=3 then return null;end if;
 select recipient_id into recipient from public.notifications where id=r.notification_id;
 update notification_delivery_private.outbox set status='sending',attempts=attempts+1,updated_at=clock_timestamp()where id=r.id;
 -- Only opaque account identity and a constant public message reach the adapter. No dossier link,
 -- notification title/body, amount, name, address, kind or payload is copied externally.
 return jsonb_build_object('id',r.id,'recipient_id',recipient,'channel',r.channel,'provider',r.provider,'idempotency_key','notification:'||r.id::text);
end;$$;

create function public.finish_external_notification(p_id uuid,p_lease uuid,p_outcome text,p_reference text default null)returns boolean language plpgsql security definer set search_path=''as $$
declare r notification_delivery_private.outbox;
begin
 if p_outcome is null or p_outcome not in('accepted','retryable','failed','uncertain')or(p_outcome='accepted'and(p_reference is null or char_length(p_reference)not between 1 and 200))or(p_outcome<>'accepted'and p_reference is not null)then raise invalid_parameter_value;end if;
 select *into r from notification_delivery_private.outbox where id=p_id for update;
 if not found or r.status<>'sending'or r.lease_token is distinct from p_lease or r.lease_until<=clock_timestamp()then return false;end if;
 update notification_delivery_private.outbox set status=case when p_outcome='retryable'then case when attempts<3 then'pending'else case when may_have_been_accepted then'uncertain'else'failed'end end when p_outcome='failed'and may_have_been_accepted then'uncertain'else p_outcome end,
 retry_stopped=p_outcome='failed' or attempts>=3,
 may_have_been_accepted=may_have_been_accepted or p_outcome in('accepted','uncertain'),provider_reference=p_reference,lease_token=null,lease_until=null,next_attempt_at=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()where id=p_id;
 return true;
end;$$;
revoke all on function public.claim_external_notification(text,text,boolean),public.begin_external_notification(uuid,uuid),public.finish_external_notification(uuid,uuid,text,text)from public,anon,authenticated,service_role;
grant execute on function public.claim_external_notification(text,text,boolean),public.begin_external_notification(uuid,uuid),public.finish_external_notification(uuid,uuid,text,text)to service_role;
commit;
