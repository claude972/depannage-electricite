begin;

-- A destination charge can expose the connected payment reference in a fee event.
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
 select *into r from public.stripe_financial_observations where event_id=p_event->>'id'for update;
 if found then
  if r.fingerprint<>p_fingerprint or r.event<>p_event then raise exception 'Authenticated event replay changed'using errcode='P0001';end if;
  return jsonb_build_object('event_id',r.event_id,'version',r.version,'replayed',true);
 end if;
 insert into public.stripe_financial_observations(event_id,fingerprint,event,result)values(p_event->>'id',p_fingerprint,p_event,public.match_stripe_financial_observation(p_event))returning *into r;
 return jsonb_build_object('event_id',r.event_id,'version',r.version,'replayed',false);
end;$$;

create or replace function charge_proof_private.fee_source(p_payment uuid,p_event text)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare p charge_proof_private.proofs;o public.stripe_financial_observations;e jsonb;
begin
 select *into p from charge_proof_private.proofs where payment_id=p_payment;if not found then raise exception 'Charge proof required'using errcode='P0001';end if;
 select *into o from public.stripe_financial_observations where event_id=p_event;if not found then raise no_data_found;end if;e=o.event;
 if e->>'family'<>'fee'or e->>'type'not in('application_fee.created','application_fee.refunded')or e->>'source_account'is not null or(e->>'livemode')::boolean is distinct from p.live or e->'object'->>'id'!~'^fee_[A-Za-z0-9_]{1,240}$'or e->'object'->>'source_charge'is null or e->'object'->>'source_charge'!~'^(ch|py)_[A-Za-z0-9_]{1,240}$'or e->'object'->>'currency'<>'eur'or(e->'object'->>'amount')::bigint is distinct from(p.source->>'fee_cents')::bigint then raise exception 'Fee observation not qualified'using errcode='P0001';end if;
 return jsonb_build_object('payment_id',p_payment,'event_id',p_event,'live',p.live,'fee_id',e->'object'->>'id','charge_id',p.charge_id,'connected_charge_id',e->'object'->>'source_charge','destination_account',p.source->>'destination_account','amount_cents',(p.source->>'fee_cents')::integer,'currency','eur','observation_fingerprint',o.fingerprint,'observation_created',e->>'created');
end;$$;

commit;
