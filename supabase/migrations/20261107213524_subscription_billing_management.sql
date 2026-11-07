begin;
create table subscription_private.portal_commands(
 account_id uuid not null references subscription_private.accounts(id) on delete cascade,
 command_id uuid not null, attempt_id uuid not null references subscription_private.attempts(id),
 configuration text not null, return_url text not null, created_at timestamptz not null default clock_timestamp(),
 primary key(account_id,command_id)
);
create table subscription_private.billing_events(
 live boolean not null,event_id text not null,fingerprint text not null,kind text not null,object_id text not null,
 attempt_id uuid references subscription_private.attempts(id),token uuid,lease_until timestamptz,
 state text not null check(state in('pending','done','ignored')),created_at timestamptz not null default clock_timestamp(),
 primary key(live,event_id)
);
alter table subscription_private.portal_commands enable row level security;
alter table subscription_private.billing_events enable row level security;
revoke all on subscription_private.portal_commands,subscription_private.billing_events from public,anon,authenticated,service_role;
create function public.begin_subscription_portal(p_actor uuid,p_live boolean,p_command uuid,p_configuration text,p_return text)returns jsonb language plpgsql security definer set search_path=''as $$
declare a subscription_private.accounts;t subscription_private.attempts;r subscription_private.portal_commands;
begin
 if subscription_private.actor_role(p_actor)is null then raise insufficient_privilege;end if;
 if not(select enabled from subscription_private.control where singleton)then raise exception 'Billing disabled'using errcode='P0001';end if;
 if p_command is null or p_live is null or p_configuration is null or p_configuration!~'^bpc_[A-Za-z0-9]{1,200}$'or p_return is null or length(p_return)>2048 or p_return!~'^https?://'then raise invalid_parameter_value;end if;
 select *into a from subscription_private.accounts where actor=p_actor and live=p_live for update;
 select *into t from subscription_private.attempts where id=a.current_attempt;
 if not found or a.customer_id is null or t.subscription_id is null or t.status in('canceled','incomplete_expired','expired','preparing','open')then raise exception 'Nothing to manage'using errcode='P0001';end if;
 select *into r from subscription_private.portal_commands where account_id=a.id and command_id=p_command;
 if found then
  if r.attempt_id<>t.id or r.configuration<>p_configuration or r.return_url<>p_return then raise exception 'Portal command changed'using errcode='P0001';end if;
 else
  insert into subscription_private.portal_commands(account_id,command_id,attempt_id,configuration,return_url)values(a.id,p_command,t.id,p_configuration,p_return)returning *into r;
 end if;
 return to_jsonb(r);
end;$$;
create function public.claim_subscription_billing_event(p_live boolean,p_event text,p_fingerprint text,p_kind text,p_object text)returns jsonb language plpgsql security definer set search_path=''as $$
declare e subscription_private.billing_events;a subscription_private.accounts;t subscription_private.attempts;c jsonb;v_token uuid;
begin
 if not(select enabled from subscription_private.control where singleton)then raise exception 'Billing disabled'using errcode='P0001';end if;
 if p_live is null or p_event is null or p_event!~'^evt_[A-Za-z0-9]{1,200}$'or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'or p_kind is null or p_kind not in('checkout.session.completed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed')or p_object is null or p_object!~'^(sub|cs)_[A-Za-z0-9_]{1,240}$'then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('billing-event:'||p_live::text||':'||p_event,0));
 select *into e from subscription_private.billing_events where live=p_live and event_id=p_event for update;
 if found then
  if e.fingerprint<>p_fingerprint or e.kind<>p_kind or e.object_id<>p_object then raise exception 'Event changed'using errcode='P0001';end if;
  if e.state in('done','ignored')then return jsonb_build_object('done',true);end if;
  if e.lease_until>clock_timestamp()then raise exception 'Event processing'using errcode='P0001';end if;
 end if;
 select x.*into t from subscription_private.attempts x join subscription_private.accounts y on y.id=x.account_id
 where y.live=p_live and y.current_attempt=x.id and(case when p_kind='checkout.session.completed'then x.session_id=p_object else x.subscription_id=p_object end);
 if not found then
  insert into subscription_private.billing_events(live,event_id,fingerprint,kind,object_id,state)values(p_live,p_event,p_fingerprint,p_kind,p_object,'ignored')on conflict(live,event_id)do update set state='ignored',token=null,lease_until=null;
  return jsonb_build_object('done',true);
 end if;
 select *into a from subscription_private.accounts where id=t.account_id;
 c=public.subscription_context(a.actor,p_live,true);
 v_token=gen_random_uuid();
 insert into subscription_private.billing_events(live,event_id,fingerprint,kind,object_id,attempt_id,token,lease_until,state)
 values(p_live,p_event,p_fingerprint,p_kind,p_object,t.id,v_token,clock_timestamp()+interval '60 seconds','pending')
 on conflict(live,event_id)do update set attempt_id=t.id,token=v_token,lease_until=clock_timestamp()+interval '60 seconds',state='pending';
 return jsonb_build_object('done',false,'token',v_token,'context',c);
end;$$;
create function public.apply_subscription_billing_event(p_live boolean,p_event text,p_token uuid,p_actor uuid,p_attempt uuid,p_sequence integer,p_session text,p_subscription text,p_status text,p_cancel boolean,p_start bigint,p_end bigint)returns void language plpgsql security definer set search_path=''as $$
declare e subscription_private.billing_events;
begin
 select *into e from subscription_private.billing_events where live=p_live and event_id=p_event for update;
 if not found or e.state<>'pending'or e.token is distinct from p_token or e.attempt_id is distinct from p_attempt or e.lease_until<=clock_timestamp()then raise exception 'Stale event worker'using errcode='P0001';end if;
 -- Projection and receipt commit together. Payload state is never an argument from the signed event.
 perform public.observe_subscription(p_actor,p_live,p_attempt,p_sequence,p_session,p_subscription,p_status,p_cancel,p_start,p_end);
 update subscription_private.billing_events set state='done',token=null,lease_until=null where live=p_live and event_id=p_event;
end;$$;
revoke all on function public.begin_subscription_portal(uuid,boolean,uuid,text,text),public.claim_subscription_billing_event(boolean,text,text,text,text),public.apply_subscription_billing_event(boolean,text,uuid,uuid,uuid,integer,text,text,text,boolean,bigint,bigint)from public,anon,authenticated,service_role;
grant execute on function public.begin_subscription_portal(uuid,boolean,uuid,text,text),public.claim_subscription_billing_event(boolean,text,text,text,text),public.apply_subscription_billing_event(boolean,text,uuid,uuid,uuid,integer,text,text,text,boolean,bigint,bigint)to service_role;
commit;
