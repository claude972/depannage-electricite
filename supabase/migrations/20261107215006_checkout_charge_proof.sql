begin;
create schema charge_proof_private;
revoke all on schema charge_proof_private from public,anon,authenticated,service_role;
create table charge_proof_private.control(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into charge_proof_private.control values(true,false);
create table charge_proof_private.commands(
 actor_id uuid not null references public.profiles(id),command_id uuid not null,payment_id uuid not null references public.payments(id),
 live boolean not null,source jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,command_id)
);
create table charge_proof_private.proofs(
 payment_id uuid primary key references public.payments(id),live boolean not null,source jsonb not null,
 payment_intent_id text not null check(payment_intent_id~'^pi_[A-Za-z0-9_]{1,240}$'),charge_id text not null check(charge_id~'^ch_[A-Za-z0-9_]{1,240}$'),
 charge_created bigint not null check(charge_created>=0),session_created bigint not null check(session_created>=0),intent_created bigint not null check(intent_created>=0),
 verified_at timestamptz not null default clock_timestamp(),verified_by uuid not null references public.profiles(id),
 unique(live,charge_id),unique(live,payment_intent_id)
);
alter table charge_proof_private.control enable row level security;alter table charge_proof_private.commands enable row level security;alter table charge_proof_private.proofs enable row level security;
revoke all on all tables in schema charge_proof_private from public,anon,authenticated,service_role;
create function charge_proof_private.authorized(p_actor uuid,p_write boolean)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.profiles p where p.id=p_actor and(p.role='admin'or(
 exists(select 1 from public.platform_operator_grants g where g.user_id=p_actor and g.status='active'and g.scope='finance_read')and(not p_write or exists(select 1 from public.platform_operator_grants g where g.user_id=p_actor and g.status='active'and g.scope='finance_write')))));
$$;
create function charge_proof_private.source(p_payment uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare p public.payments;c public.platform_checkouts;
begin
 select *into p from public.payments where id=p_payment;if not found then raise no_data_found;end if;
 select *into c from public.platform_checkouts where session_id=p.session_id and quote_id=p.quote_id;
 if not found or p.method<>'stripe'or p.status<>'paid'or p.paid_at is null or c.status<>'paid'or c.paid_at is null or c.amount_cents<>p.total_cents or c.currency<>p.currency or p.currency<>'eur'or c.fee_cents is null or c.account_id!~'^acct_[A-Za-z0-9]{1,200}$'then raise exception 'Paid frozen Checkout required'using errcode='P0001';end if;
 return jsonb_build_object('payment_id',p.id,'checkout_id',c.id,'quote_id',p.quote_id,'intervention_id',c.intervention_id,'session_id',p.session_id,'amount_cents',p.total_cents,'fee_cents',c.fee_cents,'destination_account',c.account_id,'currency',p.currency,'paid_at',p.paid_at);
end;$$;
create function public.begin_checkout_charge_proof(p_actor uuid,p_payment uuid,p_command uuid,p_live boolean)returns jsonb language plpgsql security definer set search_path=''as $$
declare c charge_proof_private.commands;s jsonb;
begin
 perform 1 from public.profiles where id=p_actor for share;perform 1 from public.platform_operator_grants where user_id=p_actor and status='active'and scope in('finance_read','finance_write')order by scope,id for share;
 if not charge_proof_private.authorized(p_actor,true)then raise insufficient_privilege;end if;
 if p_command is null or p_live is null then raise invalid_parameter_value;end if;
 if not(select enabled from charge_proof_private.control)then raise exception 'Proof qualification disabled'using errcode='P0001';end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout-proof-command:'||p_actor::text||':'||p_command::text,0));
 s=charge_proof_private.source(p_payment);
 select *into c from charge_proof_private.commands where actor_id=p_actor and command_id=p_command;
 if found then
  if c.payment_id<>p_payment or c.live<>p_live or c.source<>s then raise exception 'Proof command changed'using errcode='P0001';end if;
 else
  insert into charge_proof_private.commands(actor_id,command_id,payment_id,live,source)values(p_actor,p_command,p_payment,p_live,s)returning *into c;
 end if;
 return jsonb_build_object('source',c.source,'live',c.live);
end;$$;
create function public.store_checkout_charge_proof(p_actor uuid,p_payment uuid,p_command uuid,p_live boolean,p_source jsonb,p_provider jsonb)returns void language plpgsql security definer set search_path=''as $$
declare c charge_proof_private.commands;old charge_proof_private.proofs;s jsonb;intent text;charge text;charge_at bigint;session_at bigint;intent_at bigint;
begin
 perform 1 from public.profiles where id=p_actor for share;perform 1 from public.platform_operator_grants where user_id=p_actor and status='active'and scope in('finance_read','finance_write')order by scope,id for share;
 if not charge_proof_private.authorized(p_actor,true)then raise insufficient_privilege;end if;
 if not(select enabled from charge_proof_private.control)then raise exception 'Proof qualification disabled'using errcode='P0001';end if;
 select *into c from charge_proof_private.commands where actor_id=p_actor and command_id=p_command for update;
 if not found or c.payment_id is distinct from p_payment or c.live is distinct from p_live or c.source is distinct from p_source then raise exception 'Proof command mismatch'using errcode='P0001';end if;
 -- Lock the already-bound Checkout and payment, then compare the full frozen snapshot again.
 perform 1 from public.platform_checkouts where id=(c.source->>'checkout_id')::uuid for share;
 perform 1 from public.payments where id=p_payment for share;
 s=charge_proof_private.source(p_payment);if s<>p_source then raise exception 'Payment source changed'using errcode='P0001';end if;
 if jsonb_typeof(p_provider)is distinct from'object'or not(p_provider?&array['payment_intent_id','charge_id','charge_created','session_created','intent_created'])or p_provider-array['payment_intent_id','charge_id','charge_created','session_created','intent_created']<>'{}'::jsonb then raise invalid_parameter_value;end if;
 intent=p_provider->>'payment_intent_id';charge=p_provider->>'charge_id';
 if intent is null or intent!~'^pi_[A-Za-z0-9_]{1,240}$'or charge is null or charge!~'^ch_[A-Za-z0-9_]{1,240}$'or coalesce(p_provider->>'charge_created','')!~'^[0-9]+$'or coalesce(p_provider->>'session_created','')!~'^[0-9]+$'or coalesce(p_provider->>'intent_created','')!~'^[0-9]+$'then raise invalid_parameter_value;end if;
 charge_at=(p_provider->>'charge_created')::bigint;session_at=(p_provider->>'session_created')::bigint;intent_at=(p_provider->>'intent_created')::bigint;
 if charge_at>extract(epoch from clock_timestamp())+300 or session_at>charge_at or intent_at>charge_at then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout-charge-proof:'||p_payment::text,0));
 select *into old from charge_proof_private.proofs where payment_id=p_payment;
 if found then
  if old.live<>p_live or old.source<>s or old.payment_intent_id<>intent or old.charge_id<>charge or old.charge_created<>charge_at or old.session_created<>session_at or old.intent_created<>intent_at then raise exception 'Immutable charge proof conflict'using errcode='P0001';end if;
  return;
 end if;
 insert into charge_proof_private.proofs(payment_id,live,source,payment_intent_id,charge_id,charge_created,session_created,intent_created,verified_by)values(p_payment,p_live,s,intent,charge,charge_at,session_at,intent_at,p_actor);
end;$$;
create index stripe_dispute_charge_proof_lookup on public.stripe_financial_observations((event->'object'->>'source_charge'),event_id)where event->>'family'='dispute';
create function public.read_checkout_charge_proof(p_payment uuid,p_after text default null)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare p charge_proof_private.proofs;rows jsonb;
begin
 if not charge_proof_private.authorized(auth.uid(),false)then raise insufficient_privilege;end if;
 if p_after is not null and p_after!~'^evt_[A-Za-z0-9_]{1,240}$'then raise invalid_parameter_value;end if;
 select *into p from charge_proof_private.proofs where payment_id=p_payment;
 if not found then return jsonb_build_object('proof',null,'dispute_observations','[]'::jsonb,'next_after',null);end if;
 select coalesce(jsonb_agg(x.value order by x.event_id),'[]'::jsonb)into rows from(
 select o.event_id,jsonb_build_object('event_id',o.event_id,'observation_version',o.version,'dispute_id',o.event->'object'->>'id','observed_status',o.event->'object'->>'status','disputed_amount_cents',(o.event->'object'->>'amount')::bigint,'currency','eur','observed_at',o.event->>'created')value
 from public.stripe_financial_observations o
 where o.event->>'family'='dispute'and o.event->>'source_account'is null and(o.event->>'livemode')::boolean=p.live
 and o.event->'object'->>'source_charge'=p.charge_id and o.event->'object'->>'id'~'^du_[A-Za-z0-9_]{1,240}$'
 and o.event->'object'->>'currency'='eur'and(o.event->'object'->>'amount')::bigint between 1 and(p.source->>'amount_cents')::bigint
 and(p_after is null or o.event_id>p_after)order by o.event_id limit 51)x;
 return jsonb_build_object('proof',to_jsonb(p)-'verified_by','dispute_observations',case when jsonb_array_length(rows)>50 then rows-50 else rows end,'next_after',case when jsonb_array_length(rows)>50 then rows->49->>'event_id'else null end);
end;$$;
revoke all on all functions in schema charge_proof_private from public,anon,authenticated,service_role;
revoke all on function public.begin_checkout_charge_proof(uuid,uuid,uuid,boolean),public.store_checkout_charge_proof(uuid,uuid,uuid,boolean,jsonb,jsonb),public.read_checkout_charge_proof(uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.begin_checkout_charge_proof(uuid,uuid,uuid,boolean),public.store_checkout_charge_proof(uuid,uuid,uuid,boolean,jsonb,jsonb)to service_role;
grant execute on function public.read_checkout_charge_proof(uuid,text)to authenticated;
commit;
