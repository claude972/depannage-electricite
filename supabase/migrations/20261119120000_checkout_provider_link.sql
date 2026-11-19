begin;

-- Automatic reconciliation of platform Checkout payments (destination charges).
-- A private, immutable link is written ONLY by the server from provider re-reads
-- (session -> PaymentIntent -> platform Charge -> Transfer + Application Fee), checked
-- against the local paid Checkout snapshot. Signed observations are then associated by
-- exact references, and the commission is booked once, from the frozen fee_cents.
-- Additive: no backfill. Existing observation results only change when a link is
-- recorded by the new server code (webhook, operator review or explicit operator relink).

create table public.stripe_checkout_links(
 payment_id uuid primary key references public.payments(id),
 checkout_id uuid not null unique references public.platform_checkouts(id),
 live boolean not null,
 session_id text not null unique check(session_id ~ '^cs_[A-Za-z0-9_]{1,240}$'),
 payment_intent_id text not null unique check(payment_intent_id ~ '^pi_[A-Za-z0-9_]{1,240}$'),
 charge_id text not null unique check(charge_id ~ '^ch_[A-Za-z0-9_]{1,240}$'),
 destination_account text not null check(destination_account ~ '^acct_[A-Za-z0-9]{1,200}$'),
 amount_cents integer not null check(amount_cents>0),
 fee_cents integer not null check(fee_cents>=0 and fee_cents<amount_cents),
 transfer_id text unique check(transfer_id is null or transfer_id ~ '^tr_[A-Za-z0-9_]{1,240}$'),
 transfer_amount_cents integer check(transfer_amount_cents is null or transfer_amount_cents>0),
 transfer_reversed boolean,
 transfer_amount_reversed integer check(transfer_amount_reversed is null or transfer_amount_reversed>=0),
 fee_id text unique check(fee_id is null or fee_id ~ '^fee_[A-Za-z0-9_]{1,240}$'),
 fee_amount_cents integer check(fee_amount_cents is null or fee_amount_cents>=0),
 connected_charge_id text check(connected_charge_id is null or connected_charge_id ~ '^(ch|py)_[A-Za-z0-9_]{1,240}$'),
 fee_amount_refunded integer check(fee_amount_refunded is null or fee_amount_refunded>=0),
 state text not null check(state in('awaiting_provider','linked','needs_review')),
 review_reason text check(review_reason is null or review_reason in('transfer_reversal','fee_refunded')),
 created_at timestamptz not null default clock_timestamp(),
 linked_at timestamptz,
 check((transfer_id is null)=(transfer_amount_cents is null) and (transfer_id is null)=(transfer_reversed is null) and (transfer_id is null)=(transfer_amount_reversed is null)),
 check((fee_id is null)=(fee_amount_cents is null) and (fee_id is null)=(connected_charge_id is null) and (fee_id is null)=(fee_amount_refunded is null)),
 check((state='awaiting_provider')=(linked_at is null)),
 -- A zero commission creates no Application Fee: such a link is complete with its Transfer alone.
 check(state='awaiting_provider' or (transfer_id is not null and (fee_id is not null or fee_cents=0))),
 check((state='needs_review')=(review_reason is not null))
);
alter table public.stripe_checkout_links enable row level security;
revoke all on public.stripe_checkout_links from public,anon,authenticated,service_role;

-- History of server-side re-associations (no actor: webhook or operator command is in platform_audit).
create table public.stripe_financial_rematches(
 id bigint generated always as identity primary key,
 event_id text not null references public.stripe_financial_observations(event_id),
 previous_result jsonb not null, result jsonb not null, version integer not null check(version>1),
 payment_id uuid not null references public.payments(id),
 created_at timestamptz not null default clock_timestamp()
);
create index stripe_financial_rematches_event on public.stripe_financial_rematches(event_id,id);
alter table public.stripe_financial_rematches enable row level security;
revoke all on public.stripe_financial_rematches from public,anon,authenticated,service_role;

-- Frozen references: provider objects may only be completed once (null -> value), never changed.
-- The provider columns keep the INITIAL proof. state/review_reason are the CURRENT prudent state:
-- the only transition after completion is linked -> needs_review (later reversal/refund), never back.
create function public.stripe_checkout_link_guard()returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Checkout link is immutable' using errcode='P0001'; end if;
 if (new.payment_id,new.checkout_id,new.live,new.session_id,new.payment_intent_id,new.charge_id,new.destination_account,new.amount_cents,new.fee_cents,new.created_at)
    is distinct from (old.payment_id,old.checkout_id,old.live,old.session_id,old.payment_intent_id,old.charge_id,old.destination_account,old.amount_cents,old.fee_cents,old.created_at)
  or (old.transfer_id is not null and (new.transfer_id,new.transfer_amount_cents,new.transfer_reversed,new.transfer_amount_reversed) is distinct from (old.transfer_id,old.transfer_amount_cents,old.transfer_reversed,old.transfer_amount_reversed))
  or (old.fee_id is not null and (new.fee_id,new.fee_amount_cents,new.connected_charge_id,new.fee_amount_refunded) is distinct from (old.fee_id,old.fee_amount_cents,old.connected_charge_id,old.fee_amount_refunded))
  or (old.state<>'awaiting_provider' and (new.state,new.review_reason,new.linked_at) is distinct from (old.state,old.review_reason,old.linked_at)
      and not (old.state='linked' and new.state='needs_review' and new.review_reason is not null and new.linked_at is not distinct from old.linked_at))
 then raise exception 'Checkout link is immutable' using errcode='P0001'; end if;
 return new;
end;$$;
create trigger stripe_checkout_links_immutable before update or delete on public.stripe_checkout_links for each row execute function public.stripe_checkout_link_guard();
create trigger stripe_checkout_links_no_truncate before truncate on public.stripe_checkout_links for each statement execute function public.platform_deny_mutation();
create trigger stripe_financial_rematches_immutable before update or delete on public.stripe_financial_rematches for each row execute function public.platform_deny_mutation();

-- Association. The guest settlement path is unchanged and evaluated first.
-- The payment_id key is only present when a Checkout link proves the association, so
-- results of events unrelated to a link keep their previous shape.
create or replace function public.match_stripe_financial_observation(p_event jsonb)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare l public.guest_settlements;k public.stripe_checkout_links;c public.platform_checkouts;o jsonb=p_event->'object';reason text;outcome_state text='needs_review';pay uuid;job uuid;quote uuid;answer jsonb;
begin
 if p_event->>'family'='transfer'then
  if p_event->>'source_account'is not null then reason='unexpected_source_account';
  else
   select *into l from public.guest_settlements where transfer_id=o->>'id';
   if found then
    if l.charge_id is distinct from o->>'source_charge'or l.account_id is distinct from o->>'destination'or l.transfer_cents is distinct from(o->>'amount')::bigint or o->>'currency'<>'eur'or l.captured_at is null then reason='transfer_proof_mismatch';l=null;
    elsif(o->>'amount_reversed')::bigint>0 or(o->>'reversed')::boolean then reason='transfer_reversal';
    else reason='linked_transfer_observation';outcome_state='matched';end if;
   else
    select *into k from public.stripe_checkout_links where transfer_id=o->>'id'and state<>'awaiting_provider';
    if not found then reason='unlinked_transfer';
    elsif k.charge_id is distinct from o->>'source_charge'or k.destination_account is distinct from o->>'destination'or k.transfer_amount_cents is distinct from(o->>'amount')::bigint or o->>'currency'<>'eur'or k.live is distinct from(p_event->>'livemode')::boolean then reason='transfer_proof_mismatch';
    else
     pay=k.payment_id;
     -- A reversal (seen now or frozen at link time) never shows as an unreserved final state.
     if(o->>'amount_reversed')::bigint>0 or(o->>'reversed')::boolean or k.review_reason='transfer_reversal'then reason='transfer_reversal';
     elsif k.state<>'linked'then reason='checkout_link_review';
     else reason='linked_checkout_transfer';outcome_state='matched';end if;
    end if;
   end if;
  end if;
 elsif p_event->>'family'='payout'then reason='aggregate_payout_unallocated';
 elsif p_event->>'family'='fee'then
  select *into k from public.stripe_checkout_links where fee_id=o->>'id'and state<>'awaiting_provider';
  if not found then reason='fee_reference_not_bound';
  elsif p_event->>'source_account'is not null or k.fee_amount_cents is distinct from(o->>'amount')::bigint or o->>'currency'<>'eur'or k.connected_charge_id is distinct from o->>'source_charge'or k.live is distinct from(p_event->>'livemode')::boolean then reason='fee_proof_mismatch';
  else
   pay=k.payment_id;
   if p_event->>'type'<>'application_fee.created'or k.review_reason='fee_refunded'then reason='fee_refund_review';
   elsif k.state<>'linked'then reason='checkout_link_review';
   else reason='linked_checkout_fee';outcome_state='matched';end if;
  end if;
 else reason='dispute_reference_not_bound';end if;
 if pay is not null then select *into c from public.platform_checkouts where id=k.checkout_id;job=c.intervention_id;quote=c.quote_id;
 else job=l.intervention_id;quote=l.quote_id;end if;
 answer=jsonb_build_object('state',outcome_state,'reason',reason,'settlement_id',l.id,'intervention_id',job,'quote_id',quote);
 if pay is not null then answer=answer||jsonb_build_object('payment_id',pay);end if;
 return answer;
end;$$;
revoke all on function public.match_stripe_financial_observation(jsonb)from public,anon,authenticated,service_role;

-- Same ingestion contract, plus a lock on the provider object shared with the link writer:
-- a link and an observation of the same Transfer/Fee are serialized, so neither misses the other.
create or replace function public.ingest_stripe_financial_observation(p_event jsonb,p_fingerprint text)returns jsonb language plpgsql security definer set search_path=''as $$
declare r public.stripe_financial_observations;o jsonb;family text;kind text;amount bigint;
begin
 if p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'or jsonb_typeof(p_event)is distinct from'object'or not(p_event?&array['id','type','family','livemode','source_account','created','object'])or p_event-array['id','type','family','livemode','source_account','created','object']<>'{}'::jsonb then raise invalid_parameter_value;end if;
 o=p_event->'object';family=p_event->>'family';kind=p_event->>'type';
 if p_event->>'id'is null or p_event->>'id'!~'^evt_[A-Za-z0-9_]{1,240}$'or jsonb_typeof(p_event->'livemode')<>'boolean'or(p_event->>'source_account'is not null and p_event->>'source_account'!~'^acct_[A-Za-z0-9]{1,200}$')or p_event->>'created'is null or not isfinite((p_event->>'created')::timestamptz)then raise invalid_parameter_value;end if;
 if family is null or kind is null or not((family='transfer'and kind in('transfer.created','transfer.updated','transfer.reversed'))or(family='payout'and kind in('payout.created','payout.updated','payout.paid','payout.failed','payout.canceled','payout.reconciliation_completed'))or(family='fee'and kind in('application_fee.created','application_fee.refunded','application_fee.refund.updated'))or(family='dispute'and kind in('charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated')))then raise invalid_parameter_value;end if;
 if jsonb_typeof(o)is distinct from'object'or not(o?&array['id','amount','currency','source_charge','destination','amount_reversed','reversed','status'])or o-array['id','amount','currency','source_charge','destination','amount_reversed','reversed','status']<>'{}'::jsonb or o->>'id'is null or o->>'id'!~'^[a-z]+_[A-Za-z0-9_]{1,240}$'or jsonb_typeof(o->'amount')<>'number'or o->>'amount'!~'^[0-9]+$'or o->>'currency'is null or o->>'currency'!~'^[a-z]{3}$'then raise invalid_parameter_value;end if;
 amount=(o->>'amount')::bigint;if amount<0 or amount>9007199254740991 then raise invalid_parameter_value;end if;
 if(o->>'source_charge'is not null and o->>'source_charge' !~ (case when family='fee' then '^(ch|py)_[A-Za-z0-9_]{1,240}$' else '^ch_[A-Za-z0-9_]{1,240}$' end))or(o->>'destination'is not null and o->>'destination'!~'^acct_[A-Za-z0-9]{1,200}$')or char_length(coalesce(o->>'status',''))>80 then raise invalid_parameter_value;end if;
 if family='transfer'and(o->>'id'!~'^tr_[A-Za-z0-9_]{1,240}$'or jsonb_typeof(o->'reversed')<>'boolean'or jsonb_typeof(o->'amount_reversed')<>'number'or o->>'amount_reversed'!~'^[0-9]+$'or(o->>'amount_reversed')::bigint>amount)then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('stripe-financial-event:'||(p_event->>'id'),0));
 perform pg_advisory_xact_lock(hashtextextended('stripe-provider-object:'||(o->>'id'),0));
 select *into r from public.stripe_financial_observations where event_id=p_event->>'id'for update;
 if found then
  if r.fingerprint<>p_fingerprint or r.event<>p_event then raise exception 'Authenticated event replay changed'using errcode='P0001';end if;
  return jsonb_build_object('event_id',r.event_id,'version',r.version,'replayed',true);
 end if;
 insert into public.stripe_financial_observations(event_id,fingerprint,event,result)values(p_event->>'id',p_fingerprint,p_event,public.match_stripe_financial_observation(p_event))returning *into r;
 return jsonb_build_object('event_id',r.event_id,'version',r.version,'replayed',false);
end;$$;
revoke all on function public.ingest_stripe_financial_observation(jsonb,text)from public,anon,authenticated,service_role;
grant execute on function public.ingest_stripe_financial_observation(jsonb,text)to service_role;

-- Local context for the server link step. p_checkout, p_payment or p_charge (exactly one).
create function public.stripe_checkout_link_context(p_checkout uuid default null,p_payment uuid default null,p_charge text default null)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare c public.platform_checkouts;pay public.payments;k public.stripe_checkout_links;
begin
 if num_nonnulls(p_checkout,p_payment,p_charge)<>1 or(p_charge is not null and p_charge!~'^ch_[A-Za-z0-9_]{1,240}$')then raise invalid_parameter_value;end if;
 if p_charge is not null then select *into k from public.stripe_checkout_links where charge_id=p_charge;if not found then return null;end if;p_checkout=k.checkout_id;end if;
 if p_payment is not null then
  select *into pay from public.payments where id=p_payment;if not found then return null;end if;
  select *into c from public.platform_checkouts where quote_id=pay.quote_id and session_id=pay.session_id;if not found then return null;end if;
 else
  select *into c from public.platform_checkouts where id=p_checkout;if not found then return null;end if;
  select *into pay from public.payments where quote_id=c.quote_id;
 end if;
 select *into k from public.stripe_checkout_links where checkout_id=c.id;
 return jsonb_build_object('checkout_id',c.id,'payment_id',pay.id,'quote_id',c.quote_id,'intervention_id',c.intervention_id,
  'session_id',c.session_id,'amount_cents',c.amount_cents,'fee_cents',c.fee_cents,'account_id',c.account_id,'currency',c.currency,
  'checkout_status',c.status,'payment_status',pay.status,'payment_session_id',pay.session_id,'payment_total_cents',pay.total_cents,'payment_method',pay.method,
  'link_state',k.state);
end;$$;
revoke all on function public.stripe_checkout_link_context(uuid,uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.stripe_checkout_link_context(uuid,uuid,text)to service_role;

create function public.stripe_checkout_links_awaiting()returns integer language sql stable security definer set search_path=''as $$
 select count(*)::integer from public.stripe_checkout_links where state='awaiting_provider';
$$;
revoke all on function public.stripe_checkout_links_awaiting()from public,anon,authenticated,service_role;
grant execute on function public.stripe_checkout_links_awaiting()to service_role;

-- Atomic link + association + single commission booking. Called by the server only, with
-- references re-read from Stripe. Lock order: see below (aligned with Checkout confirmation).
-- Every provider reference is a typed, non-null JSON string/number/boolean compared with IS DISTINCT FROM:
-- JSON null, a missing key or a wrong type is refused (22023) before any comparison.
create function public.stripe_checkout_ref_text(p jsonb,p_key text,p_pattern text)returns text language plpgsql immutable set search_path=''as $$
begin
 if jsonb_typeof(p->p_key)is distinct from'string'or(p->>p_key)!~p_pattern then raise invalid_parameter_value;end if;
 return p->>p_key;
end;$$;
create function public.stripe_checkout_ref_int(p jsonb,p_key text)returns bigint language plpgsql immutable set search_path=''as $$
begin
 if jsonb_typeof(p->p_key)is distinct from'number'or(p->>p_key)!~'^[0-9]{1,15}$'then raise invalid_parameter_value;end if;
 return(p->>p_key)::bigint;
end;$$;
create function public.stripe_checkout_ref_bool(p jsonb,p_key text)returns boolean language plpgsql immutable set search_path=''as $$
begin
 if jsonb_typeof(p->p_key)is distinct from'boolean'then raise invalid_parameter_value;end if;
 return(p->>p_key)::boolean;
end;$$;
revoke all on function public.stripe_checkout_ref_text(jsonb,text,text),public.stripe_checkout_ref_int(jsonb,text),public.stripe_checkout_ref_bool(jsonb,text)from public,anon,authenticated,service_role;

create function public.record_stripe_checkout_link(p_checkout uuid,p_live boolean,p_refs jsonb,p_actor uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$
#variable_conflict use_variable
declare c public.platform_checkouts;pay public.payments;k public.stripe_checkout_links;t jsonb;f jsonb;
 r_session text;r_intent text;r_charge text;r_dest text;r_amount bigint;r_fee bigint;
 t_id text;t_amount bigint;t_dest text;t_source text;t_reversed boolean;t_amount_reversed bigint;t_live boolean;
 f_id text;f_amount bigint;f_account text;f_connected text;f_origin text;f_refunded bigint;f_live boolean;
 current_reason text;reason text;commission text='none';existing public.platform_ledger_entries;ob public.stripe_financial_observations;fresh jsonb;prior jsonb;rematched text[]='{}';inserted boolean=false;
begin
 if p_checkout is null or p_live is null or jsonb_typeof(p_refs)is distinct from'object'
  or not(p_refs?&array['session_id','payment_intent_id','charge_id','destination','amount_cents','fee_cents','currency','transfer','fee'])
  or p_refs-array['session_id','payment_intent_id','charge_id','destination','amount_cents','fee_cents','currency','transfer','fee']<>'{}'::jsonb
  or jsonb_typeof(p_refs->'transfer')not in('null','object')or jsonb_typeof(p_refs->'fee')not in('null','object')then raise invalid_parameter_value;end if;
 r_session=public.stripe_checkout_ref_text(p_refs,'session_id','^cs_[A-Za-z0-9_]{1,240}$');
 r_intent=public.stripe_checkout_ref_text(p_refs,'payment_intent_id','^pi_[A-Za-z0-9_]{1,240}$');
 r_charge=public.stripe_checkout_ref_text(p_refs,'charge_id','^ch_[A-Za-z0-9_]{1,240}$');
 r_dest=public.stripe_checkout_ref_text(p_refs,'destination','^acct_[A-Za-z0-9]{1,200}$');
 r_amount=public.stripe_checkout_ref_int(p_refs,'amount_cents');r_fee=public.stripe_checkout_ref_int(p_refs,'fee_cents');
 perform public.stripe_checkout_ref_text(p_refs,'currency','^eur$');
 if jsonb_typeof(p_refs->'transfer')='object'then
  t=p_refs->'transfer';
  if not(t?&array['id','amount','currency','destination','source_charge','reversed','amount_reversed','livemode'])or t-array['id','amount','currency','destination','source_charge','reversed','amount_reversed','livemode']<>'{}'::jsonb then raise invalid_parameter_value;end if;
  t_id=public.stripe_checkout_ref_text(t,'id','^tr_[A-Za-z0-9_]{1,240}$');t_amount=public.stripe_checkout_ref_int(t,'amount');
  t_dest=public.stripe_checkout_ref_text(t,'destination','^acct_[A-Za-z0-9]{1,200}$');t_source=public.stripe_checkout_ref_text(t,'source_charge','^ch_[A-Za-z0-9_]{1,240}$');
  t_reversed=public.stripe_checkout_ref_bool(t,'reversed');t_amount_reversed=public.stripe_checkout_ref_int(t,'amount_reversed');t_live=public.stripe_checkout_ref_bool(t,'livemode');
  perform public.stripe_checkout_ref_text(t,'currency','^eur$');
 end if;
 if jsonb_typeof(p_refs->'fee')='object'then
  f=p_refs->'fee';
  if not(f?&array['id','amount','currency','account','connected_charge','originating_charge','amount_refunded','livemode'])or f-array['id','amount','currency','account','connected_charge','originating_charge','amount_refunded','livemode']<>'{}'::jsonb then raise invalid_parameter_value;end if;
  f_id=public.stripe_checkout_ref_text(f,'id','^fee_[A-Za-z0-9_]{1,240}$');f_amount=public.stripe_checkout_ref_int(f,'amount');
  f_account=public.stripe_checkout_ref_text(f,'account','^acct_[A-Za-z0-9]{1,200}$');f_connected=public.stripe_checkout_ref_text(f,'connected_charge','^(ch|py)_[A-Za-z0-9_]{1,240}$');
  f_origin=public.stripe_checkout_ref_text(f,'originating_charge','^ch_[A-Za-z0-9_]{1,240}$');f_refunded=public.stripe_checkout_ref_int(f,'amount_refunded');f_live=public.stripe_checkout_ref_bool(f,'livemode');
  perform public.stripe_checkout_ref_text(f,'currency','^eur$');
 end if;

 -- Operator relink/review: the actor's finance read+write rights are locked and re-checked in this
 -- transaction (a revocation between the HTTP check and this write is refused). Webhook: p_actor null.
 if p_actor is not null then
  perform 1 from public.profiles where id=p_actor for share;
  perform 1 from public.platform_operator_grants where user_id=p_actor and status='active'and scope in('finance_read','finance_write')order by scope,id for share;
  if not charge_proof_private.authorized(p_actor,true)then raise insufficient_privilege;end if;
 end if;
 -- Same business lock order as confirm_stripe_payment / prepare_platform_checkout:
 -- organization, intervention, quote, Checkout, payment; then provider objects, link, observations.
 select *into c from public.platform_checkouts where id=p_checkout;if not found then raise no_data_found;end if;
 perform public.lock_intervention_organization(c.intervention_id);
 perform 1 from public.interventions where id=c.intervention_id for update;
 perform 1 from public.quotes where id=c.quote_id for update;
 select *into c from public.platform_checkouts where id=p_checkout for update;
 select *into pay from public.payments where quote_id=c.quote_id for update;
 if not found or pay.id is null or c.status is distinct from'paid'or pay.status is distinct from'paid'or pay.method is distinct from'stripe'or c.session_id is null or pay.session_id is distinct from c.session_id
  or pay.total_cents is distinct from c.amount_cents or c.fee_cents is null or c.currency is distinct from'eur'or pay.currency is distinct from'eur'then raise exception 'Checkout payment not confirmed'using errcode='P0001';end if;
 -- Every provider reference must equal the frozen local snapshot (no amount, email or metadata alone).
 if r_session is distinct from c.session_id or r_amount is distinct from c.amount_cents::bigint or r_fee is distinct from c.fee_cents::bigint or r_dest is distinct from c.account_id
  or(t is not null and(t_live is distinct from p_live or t_amount is distinct from c.amount_cents::bigint or t_dest is distinct from c.account_id or t_source is distinct from r_charge or t_amount_reversed>t_amount))
  or(f is not null and(f_live is distinct from p_live or f_amount is distinct from c.fee_cents::bigint or f_account is distinct from c.account_id or f_origin is distinct from r_charge or f_refunded>f_amount))
  or(f is not null and c.fee_cents=0)
 then raise exception 'Checkout provider references mismatch'using errcode='P0001';end if;

 -- Provider objects are serialized with ingestion (same lock keys), in a fixed order.
 perform pg_advisory_xact_lock(hashtextextended('stripe-provider-object:'||x,0))from unnest(array_remove(array[t_id,f_id],null))x order by x;

 select *into k from public.stripe_checkout_links where payment_id=pay.id for update;
 if found then
  -- A recorded link is compared, never silently overwritten (no ON CONFLICT DO NOTHING).
  if k.checkout_id is distinct from c.id or k.live is distinct from p_live or k.session_id is distinct from r_session or k.payment_intent_id is distinct from r_intent or k.charge_id is distinct from r_charge
   or k.destination_account is distinct from r_dest or k.amount_cents::bigint is distinct from r_amount or k.fee_cents::bigint is distinct from r_fee
   or(k.transfer_id is not null and t is not null and(k.transfer_id is distinct from t_id or k.transfer_amount_cents::bigint is distinct from t_amount))
   or(k.fee_id is not null and f is not null and(k.fee_id is distinct from f_id or k.fee_amount_cents::bigint is distinct from f_amount or k.connected_charge_id is distinct from f_connected))
  then raise exception 'Checkout link conflict'using errcode='P0001';end if;
 else
  begin
   insert into public.stripe_checkout_links(payment_id,checkout_id,live,session_id,payment_intent_id,charge_id,destination_account,amount_cents,fee_cents,state)
   values(pay.id,c.id,p_live,r_session,r_intent,r_charge,r_dest,r_amount::integer,r_fee::integer,'awaiting_provider')returning *into k;
  exception when unique_violation then raise exception 'Checkout link conflict'using errcode='P0001';
  end;
  inserted=true;
 end if;
 if k.state='awaiting_provider'then
  begin
   if k.transfer_id is null and t is not null then
    update public.stripe_checkout_links set transfer_id=t_id,transfer_amount_cents=t_amount::integer,transfer_reversed=t_reversed,transfer_amount_reversed=t_amount_reversed::integer where payment_id=pay.id returning *into k;
   end if;
   if k.fee_id is null and f is not null then
    update public.stripe_checkout_links set fee_id=f_id,fee_amount_cents=f_amount::integer,connected_charge_id=f_connected,fee_amount_refunded=f_refunded::integer where payment_id=pay.id returning *into k;
   end if;
  exception when unique_violation then raise exception 'Checkout link conflict'using errcode='P0001';
  end;
  if k.transfer_id is not null and(k.fee_id is not null or k.fee_cents=0)then
   -- Combine the first frozen proofs with the provider state read NOW: an object frozen earlier
   -- (e.g. Transfer while the Fee was absent) may have been reversed/refunded since.
   reason=case when k.transfer_reversed or k.transfer_amount_reversed>0 or(t is not null and(t_reversed or t_amount_reversed>0))then 'transfer_reversal'
               when k.fee_amount_refunded>0 or(f is not null and f_refunded>0)then 'fee_refunded' end;
   update public.stripe_checkout_links set state=case when reason is null then 'linked' else 'needs_review' end,review_reason=reason,linked_at=clock_timestamp()where payment_id=pay.id returning *into k;
  end if;
 elsif k.state='linked'then
  -- Current provider state read now: a later reversal/refund turns the CURRENT state to review.
  -- The initial proof columns stay unchanged and no commission is (re)booked.
  current_reason=case when t is not null and(t_reversed or t_amount_reversed>0)then 'transfer_reversal' when f is not null and f_refunded>0 then 'fee_refunded' end;
  if current_reason is not null then
   update public.stripe_checkout_links set state='needs_review',review_reason=current_reason where payment_id=pay.id returning *into k;
  end if;
 end if;

 -- Single commission per payment, keyed by the Fee; a different existing entry is a refusal.
 select *into existing from public.platform_ledger_entries where payment_id=pay.id and entry_kind='commission_withheld';
 if found then
  if existing.amount_cents is distinct from k.fee_cents or existing.external_event_id is distinct from k.fee_id or existing.currency is distinct from'eur'then raise exception 'Commission already recorded differently'using errcode='P0001';end if;
  commission='existing';
 elsif k.state='linked'and k.fee_cents>0 then
  begin
   insert into public.platform_ledger_entries(request_id,entry_kind,direction,amount_cents,currency,payment_id,external_event_id,basis,recorded_by)
   values(gen_random_uuid(),'commission_withheld','debit',k.fee_cents,'eur',pay.id,k.fee_id,jsonb_build_object('source','checkout_provider_link','live',k.live,'session_id',k.session_id,
    'payment_intent_id',k.payment_intent_id,'charge_id',k.charge_id,'connected_charge_id',k.connected_charge_id,'transfer_id',k.transfer_id,'fee_id',k.fee_id),p_actor);
  exception when unique_violation then raise exception 'Commission already recorded differently'using errcode='P0001';
  end;
  commission='recorded';
  insert into public.platform_audit(actor_id,action,target_kind,target_id,details)values(p_actor,'commission_withheld','ledger',pay.id::text,jsonb_build_object('fee_id',k.fee_id,'amount_cents',k.fee_cents,'source','checkout_provider_link'));
 end if;

 -- Re-associate observations of these exact provider objects (event order) and keep their history.
 for ob in select * from public.stripe_financial_observations where(event->>'family'='transfer'and event->'object'->>'id'=k.transfer_id)or(event->>'family'='fee'and event->'object'->>'id'=k.fee_id)order by event_id for update loop
  fresh=public.match_stripe_financial_observation(ob.event);
  if fresh is distinct from ob.result then
   prior=ob.result;
   update public.stripe_financial_observations set result=fresh,version=version+1 where event_id=ob.event_id returning *into ob;
   insert into public.stripe_financial_rematches(event_id,previous_result,result,version,payment_id)values(ob.event_id,prior,fresh,ob.version,pay.id);
   rematched=rematched||ob.event_id;
  end if;
 end loop;
 if inserted or commission='recorded'or cardinality(rematched)>0 or current_reason is not null then
  insert into public.platform_audit(actor_id,action,target_kind,target_id,details)values(p_actor,'checkout_provider_linked','reconciliation',pay.id::text,jsonb_build_object('state',k.state,'review_reason',k.review_reason,'commission',commission,'rematched',to_jsonb(rematched)));
 end if;
 return jsonb_build_object('payment_id',pay.id,'state',k.state,'review_reason',k.review_reason,'commission',commission,'rematched',to_jsonb(rematched));
end;$$;
-- Detail: automatic (server) re-associations are shown next to operator reviews. The key is only
-- present when such history exists, so earlier strict clients keep reading unchanged details.
create or replace function public.stripe_financial_observation_detail(p_event_id text)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare r public.stripe_financial_observations;history jsonb;automatic jsonb;n integer;m integer;answer jsonb;
begin
 if not public.has_platform_scope('finance_read')then raise insufficient_privilege;end if;
 select *into r from public.stripe_financial_observations where event_id=p_event_id;if not found then raise no_data_found;end if;
 select count(*)into n from public.stripe_financial_review_commands where event_id=r.event_id;
 select coalesce(jsonb_agg(to_jsonb(x)order by x.version desc),'[]'::jsonb)into history from(select actor_id,note,created_at,(result->>'version')::integer version,result->'result'outcome from public.stripe_financial_review_commands where event_id=r.event_id order by (result->>'version')::integer desc limit 50)x;
 answer=jsonb_build_object('record',public.stripe_financial_projection(r),'history',history,'history_limited',n>50);
 select count(*)into m from public.stripe_financial_rematches where event_id=r.event_id;
 if m>0 then
  select jsonb_agg(to_jsonb(x)order by x.version desc)into automatic from(select created_at,version,previous_result previous,result outcome from public.stripe_financial_rematches where event_id=r.event_id order by version desc limit 50)x;
  answer=answer||jsonb_build_object('automatic_history',automatic,'automatic_history_limited',m>50);
 end if;
 return answer;
end;$$;
revoke all on function public.stripe_financial_observation_detail(text)from public,anon,authenticated,service_role;
grant execute on function public.stripe_financial_observation_detail(text)to authenticated;

revoke all on function public.record_stripe_checkout_link(uuid,boolean,jsonb,uuid)from public,anon,authenticated,service_role;
grant execute on function public.record_stripe_checkout_link(uuid,boolean,jsonb,uuid)to service_role;

commit;
