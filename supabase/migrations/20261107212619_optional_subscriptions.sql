begin;
create schema if not exists subscription_private;
revoke all on schema subscription_private from public,anon,authenticated,service_role;
create table subscription_private.control(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into subscription_private.control values(true,false);
create table subscription_private.offers(id uuid primary key default gen_random_uuid(),version integer not null default 1 check(version>0),live boolean not null,role text not null check(role in('client','artisan')),label text not null check(char_length(label)between 1 and 160),active boolean not null,price_id text not null check(price_id~'^price_[A-Za-z0-9]{1,200}$'),amount_cents integer not null check(amount_cents>=0),currency text not null check(currency~'^[a-z]{3}$'),interval text not null check(interval in('day','week','month','year')),interval_count integer not null check(interval_count between 1 and 1000),tax_behavior text not null check(tax_behavior in('inclusive','exclusive','unspecified')));
create table subscription_private.offer_commands(actor uuid not null references public.profiles(id),command_id uuid not null,input jsonb not null,result jsonb not null,primary key(actor,command_id));
create table subscription_private.accounts(id uuid primary key default gen_random_uuid(),actor uuid not null references public.profiles(id)on delete cascade,live boolean not null,customer_id text check(customer_id~'^cus_[A-Za-z0-9]{1,200}$'),created_at timestamptz not null default clock_timestamp(),read_seq integer not null default 0,current_attempt uuid,unique(actor,live),unique(live,customer_id));
create table subscription_private.attempts(id uuid primary key default gen_random_uuid(),account_id uuid not null references subscription_private.accounts(id)on delete cascade,command_id uuid not null,offer jsonb not null,return_origin text not null,created_at timestamptz not null default clock_timestamp(),session_id text check(session_id~'^cs_[A-Za-z0-9_]{1,240}$'),subscription_id text check(subscription_id~'^sub_[A-Za-z0-9]{1,200}$'),status text not null default 'preparing'check(status in('preparing','open','expired','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),cancel_at_period_end boolean not null default false,period_start bigint,period_end bigint,observed_at timestamptz,unique(account_id,command_id),unique(subscription_id));
create table subscription_private.observations(attempt_id uuid not null references subscription_private.attempts(id)on delete cascade,sequence integer not null,status text not null,subscription_id text,cancel_at_period_end boolean not null,period_start bigint,period_end bigint,observed_at timestamptz not null default clock_timestamp(),primary key(attempt_id,sequence));
alter table subscription_private.observations enable row level security;
alter table subscription_private.accounts add foreign key(current_attempt)references subscription_private.attempts(id);
alter table subscription_private.control enable row level security;alter table subscription_private.offers enable row level security;alter table subscription_private.offer_commands enable row level security;alter table subscription_private.accounts enable row level security;alter table subscription_private.attempts enable row level security;
revoke all on all tables in schema subscription_private from public,anon,authenticated,service_role;
create function subscription_private.actor_role(p_actor uuid)returns text language sql stable security definer set search_path=''as $$
 select p.role from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor and p.role in('client','artisan')and u.email_confirmed_at is not null and nullif(btrim(u.email),'')is not null and not coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false);
$$;
create function subscription_private.can_subscribe(p_actor uuid)returns boolean language sql stable security definer set search_path=''as $$
 select subscription_private.actor_role(p_actor)='client'or(subscription_private.actor_role(p_actor)='artisan'and exists(select 1 from public.profiles p join public.artisan_profiles a on a.user_id=p.id where p.id=p_actor and p.artisan_approved and a.application_status='approved'));
$$;
create function subscription_private.operator(p_actor uuid)returns boolean language plpgsql security definer set search_path=''as $$
declare old_sub text=current_setting('request.jwt.claim.sub',true);old_claims text=current_setting('request.jwt.claims',true);ok boolean;
begin
 perform set_config('request.jwt.claim.sub',p_actor::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor)::text,true);ok=public.has_platform_scope('finance_write');
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);return ok;
exception when others then perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);raise;
end;$$;
create function public.subscription_guard(p_operator boolean default false)returns text language plpgsql security definer set search_path=''as $$
declare role_name text;
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if p_operator then if not public.has_platform_scope('finance_write')then raise insufficient_privilege;end if;return'operator';end if;
 role_name=subscription_private.actor_role(auth.uid());if role_name is null then raise insufficient_privilege;end if;return role_name;
end;$$;
create function public.save_subscription_offer(p_actor uuid,p_command uuid,p_id uuid,p_version integer,p_live boolean,p_values jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare receipt subscription_private.offer_commands;r subscription_private.offers;payload jsonb;
begin
 perform 1 from public.profiles where id=p_actor for share;
 perform 1 from public.platform_operator_grants where user_id=p_actor and scope='finance_write' and status='active' for share;
 if not coalesce(subscription_private.operator(p_actor),false)then raise insufficient_privilege;end if;
 if p_command is null or p_version is null or p_version not between 0 and 2147483646 or p_live is null or p_values is null or jsonb_typeof(p_values)<>'object'or(p_values-array['role','label','active','price_id','amount_cents','currency','interval','interval_count','tax_behavior'])<>'{}'::jsonb then raise invalid_parameter_value;end if;
 payload=jsonb_build_object('id',p_id,'version',p_version,'live',p_live,'values',p_values);
 perform pg_advisory_xact_lock(hashtextextended('subscription-offers',0));
 select *into receipt from subscription_private.offer_commands where actor=p_actor and command_id=p_command;
 if found then if receipt.input<>payload then raise exception 'Offer command changed'using errcode='P0001';end if;return receipt.result;end if;
 if p_id is not null then select *into r from subscription_private.offers where id=p_id and live=p_live for update;if not found then raise insufficient_privilege;end if;end if;
 if coalesce(r.version,0)<>p_version then raise exception 'Offer version changed'using errcode='P0001';end if;
 if p_id is null and(select count(*)from subscription_private.offers where live=p_live)>=50 then raise exception 'Offer cap'using errcode='P0001';end if;
 insert into subscription_private.offers(id,version,live,role,label,active,price_id,amount_cents,currency,interval,interval_count,tax_behavior)
 values(coalesce(p_id,gen_random_uuid()),p_version+1,p_live,p_values->>'role',p_values->>'label',(p_values->>'active')::boolean,p_values->>'price_id',(p_values->>'amount_cents')::integer,p_values->>'currency',p_values->>'interval',(p_values->>'interval_count')::integer,p_values->>'tax_behavior')
 on conflict(id)do update set version=excluded.version,role=excluded.role,label=excluded.label,active=excluded.active,price_id=excluded.price_id,amount_cents=excluded.amount_cents,currency=excluded.currency,interval=excluded.interval,interval_count=excluded.interval_count,tax_behavior=excluded.tax_behavior returning *into r;
 insert into subscription_private.offer_commands values(p_actor,p_command,payload,to_jsonb(r));return to_jsonb(r);
end;$$;
create function public.subscription_context(p_actor uuid,p_live boolean,p_read boolean default false)returns jsonb language plpgsql security definer set search_path=''as $$
declare role_name text;a subscription_private.accounts;t subscription_private.attempts;enabled boolean;
begin
 role_name=subscription_private.actor_role(p_actor);if role_name is null then raise insufficient_privilege;end if;
 if p_live is null or p_read is null then raise invalid_parameter_value;end if;
 select c.enabled into enabled from subscription_private.control c;
 if p_read then update subscription_private.accounts set read_seq=read_seq+1 where actor=p_actor and live=p_live returning *into a;
 else select *into a from subscription_private.accounts where actor=p_actor and live=p_live;end if;
 if a.current_attempt is not null then select *into t from subscription_private.attempts where id=a.current_attempt;end if;
 return jsonb_build_object('enabled',enabled,'eligible',coalesce(subscription_private.can_subscribe(p_actor),false),'role',role_name,'offers',coalesce((select jsonb_agg(to_jsonb(o)order by o.id)from subscription_private.offers o where o.active and o.role=role_name and o.live=p_live),'[]'::jsonb),'account',case when a.id is null then null else to_jsonb(a)end,'attempt',case when t.id is null then null else to_jsonb(t)end);
end;$$;
create function public.begin_subscription_checkout(p_actor uuid,p_live boolean,p_command uuid,p_offer uuid,p_version integer,p_origin text)returns jsonb language plpgsql security definer set search_path=''as $$
declare role_name text;a subscription_private.accounts;t subscription_private.attempts;o subscription_private.offers;
begin
 role_name=subscription_private.actor_role(p_actor);if role_name is null or not coalesce(subscription_private.can_subscribe(p_actor),false)then raise insufficient_privilege;end if;
 if p_live is null or p_command is null or p_offer is null or p_version is null or p_origin is null or char_length(p_origin)>500 or p_origin!~'^(https://[^/@?#[:space:]]+|http://(localhost|127\.0\.0\.1)(:[0-9]+)?)$'then raise invalid_parameter_value;end if;
 if not exists(select 1 from subscription_private.control where enabled)then raise exception 'Subscriptions inactive'using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended('subscription:'||p_actor::text||':'||p_live::text,0));
 insert into subscription_private.accounts(actor,live)values(p_actor,p_live)on conflict(actor,live)do nothing;
 select *into a from subscription_private.accounts where actor=p_actor and live=p_live for update;
 select *into t from subscription_private.attempts where account_id=a.id and command_id=p_command;
 if found then
  if(t.offer->>'id')::uuid<>p_offer or(t.offer->>'version')::integer<>p_version or t.return_origin<>p_origin then raise exception 'Checkout command changed'using errcode='P0001';end if;
  if a.current_attempt<>t.id then raise exception 'Old subscription command'using errcode='P0001';end if;
 else
  if exists(select 1 from subscription_private.attempts where id=a.current_attempt and status not in('expired','canceled','incomplete_expired'))then raise exception 'Current subscription needs reconciliation'using errcode='P0001';end if;
  select *into o from subscription_private.offers where id=p_offer and live=p_live and role=role_name and active and version=p_version for share;
  if not found then raise exception 'Offer not current'using errcode='P0001';end if;
  insert into subscription_private.attempts(account_id,command_id,offer,return_origin)values(a.id,p_command,to_jsonb(o),p_origin)returning *into t;
  update subscription_private.accounts set current_attempt=t.id,read_seq=read_seq+1 where id=a.id;
 end if;
 return public.subscription_context(p_actor,p_live,false);
end;$$;
create function public.bind_subscription_provider(p_actor uuid,p_live boolean,p_attempt uuid,p_kind text,p_value text)returns void language plpgsql security definer set search_path=''as $$
declare a subscription_private.accounts;t subscription_private.attempts;
begin
 if subscription_private.actor_role(p_actor)is null then raise insufficient_privilege;end if;
 select *into a from subscription_private.accounts where actor=p_actor and live=p_live for update;
 select *into t from subscription_private.attempts where id=p_attempt and account_id=a.id;
 if not found or a.current_attempt<>t.id then raise insufficient_privilege;end if;
 if p_kind='customer'and p_value~'^cus_[A-Za-z0-9]{1,200}$'then
  if a.customer_id is not null and a.customer_id<>p_value then raise exception 'Customer conflict'using errcode='P0001';end if;
  if a.customer_id is null and a.created_at<=clock_timestamp()-interval '23 hours'then raise exception 'Customer uncertain'using errcode='P0001';end if;
  update subscription_private.accounts set customer_id=p_value where id=a.id;
 elsif p_kind='session'and p_value~'^cs_[A-Za-z0-9_]{1,240}$'then
  if a.customer_id is null then raise insufficient_privilege;end if;
  if t.session_id is not null and t.session_id<>p_value then raise exception 'Session conflict'using errcode='P0001';end if;
  update subscription_private.attempts set session_id=p_value,status=case when status='preparing'then'open'else status end where id=t.id;
 else raise invalid_parameter_value;end if;
end;$$;
create function public.observe_subscription(p_actor uuid,p_live boolean,p_attempt uuid,p_sequence integer,p_session text,p_subscription text,p_status text,p_cancel boolean,p_start bigint,p_end bigint)returns void language plpgsql security definer set search_path=''as $$
declare a subscription_private.accounts;t subscription_private.attempts;
begin
 if subscription_private.actor_role(p_actor)is null then raise insufficient_privilege;end if;
 select *into a from subscription_private.accounts where actor=p_actor and live=p_live for update;
 select *into t from subscription_private.attempts where id=p_attempt and account_id=a.id for update;
 if not found or a.current_attempt<>t.id or a.read_seq is distinct from p_sequence or t.session_id is distinct from p_session then raise exception 'Stale subscription read'using errcode='P0001';end if;
 if p_status is null or p_status not in('open','expired','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')or p_cancel is null then raise invalid_parameter_value;end if;
 if p_status in('open','expired')then
  if p_subscription is not null or t.subscription_id is not null or p_start is not null or p_end is not null or p_cancel then raise invalid_parameter_value;end if;
 else
  if p_subscription is null or p_subscription!~'^sub_[A-Za-z0-9]{1,200}$'or p_start is null or p_end is null or p_start<0 or p_end<p_start then raise invalid_parameter_value;end if;
  if t.subscription_id is not null and t.subscription_id<>p_subscription then raise exception 'Subscription conflict'using errcode='P0001';end if;
 end if;
 if(t.status in('canceled','incomplete_expired','expired')and p_status<>t.status)or(p_end is not null and t.period_end is not null and p_end<t.period_end)then raise exception 'Stale provider transition'using errcode='P0001';end if;
 insert into subscription_private.observations(attempt_id,sequence,status,subscription_id,cancel_at_period_end,period_start,period_end)values(t.id,p_sequence,p_status,p_subscription,p_cancel,p_start,p_end);
 update subscription_private.attempts set subscription_id=p_subscription,status=p_status,cancel_at_period_end=p_cancel,period_start=p_start,period_end=p_end,observed_at=clock_timestamp()where id=t.id;
 -- Consume the observation token: replay cannot overwrite a newer observation.
 update subscription_private.accounts set read_seq=read_seq+1 where id=a.id;
end;$$;
revoke all on all functions in schema subscription_private from public,anon,authenticated,service_role;
revoke all on function public.subscription_guard(boolean),public.save_subscription_offer(uuid,uuid,uuid,integer,boolean,jsonb),public.subscription_context(uuid,boolean,boolean),public.begin_subscription_checkout(uuid,boolean,uuid,uuid,integer,text),public.bind_subscription_provider(uuid,boolean,uuid,text,text),public.observe_subscription(uuid,boolean,uuid,integer,text,text,text,boolean,bigint,bigint)from public,anon,authenticated,service_role;
grant execute on function public.subscription_guard(boolean)to authenticated;
grant execute on function public.save_subscription_offer(uuid,uuid,uuid,integer,boolean,jsonb),public.subscription_context(uuid,boolean,boolean),public.begin_subscription_checkout(uuid,boolean,uuid,uuid,integer,text),public.bind_subscription_provider(uuid,boolean,uuid,text,text),public.observe_subscription(uuid,boolean,uuid,integer,text,text,text,boolean,bigint,bigint)to service_role;
commit;
