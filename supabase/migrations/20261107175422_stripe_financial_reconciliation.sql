begin;
create table public.stripe_financial_observations(event_id text collate "C" primary key check(event_id~'^evt_[A-Za-z0-9_]{1,240}$'),fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),event jsonb not null,result jsonb not null,version integer not null default 1 check(version>0),received_at timestamptz not null default clock_timestamp());
create table public.stripe_financial_review_commands(command_id uuid primary key,actor_id uuid not null references public.profiles(id),event_id text not null references public.stripe_financial_observations(event_id),expected_version integer not null,previous_result jsonb not null,note text not null check(char_length(btrim(note))between 1 and 2000),result jsonb not null,created_at timestamptz not null default clock_timestamp());
create index stripe_financial_review_history on public.stripe_financial_review_commands(event_id,created_at,command_id);
alter table public.stripe_financial_observations enable row level security;alter table public.stripe_financial_review_commands enable row level security;
revoke all on public.stripe_financial_observations,public.stripe_financial_review_commands from public,anon,authenticated,service_role;
-- Immutable proof already bound by the capture/transfer implementation; metadata is never consulted.
create function public.match_stripe_financial_observation(p_event jsonb)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare l public.guest_settlements;o jsonb=p_event->'object';reason text;state text='needs_review';
begin
 if p_event->>'family'='transfer'then
  if p_event->>'source_account'is not null then reason='unexpected_source_account';
  else
   select *into l from public.guest_settlements where transfer_id=o->>'id';
   if not found then reason='unlinked_transfer';
   elsif l.charge_id is distinct from o->>'source_charge'or l.account_id is distinct from o->>'destination'or l.transfer_cents is distinct from(o->>'amount')::bigint or o->>'currency'<>'eur'or l.captured_at is null then reason='transfer_proof_mismatch';l=null;
   elsif(o->>'amount_reversed')::bigint>0 or(o->>'reversed')::boolean then reason='transfer_reversal';
   else reason='linked_transfer_observation';state='matched';end if;
  end if;
 elsif p_event->>'family'='payout'then reason='aggregate_payout_unallocated';
 elsif p_event->>'family'='fee'then reason='fee_reference_not_bound';
 else reason='dispute_reference_not_bound';end if;
 return jsonb_build_object('state',state,'reason',reason,'settlement_id',l.id,'intervention_id',l.intervention_id,'quote_id',l.quote_id);
end;$$;
revoke all on function public.match_stripe_financial_observation(jsonb)from public,anon,authenticated,service_role;
create function public.ingest_stripe_financial_observation(p_event jsonb,p_fingerprint text)returns jsonb language plpgsql security definer set search_path=''as $$
declare r public.stripe_financial_observations;o jsonb;family text;kind text;amount bigint;
begin
 if p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'or jsonb_typeof(p_event)is distinct from'object'or not(p_event?&array['id','type','family','livemode','source_account','created','object'])or p_event-array['id','type','family','livemode','source_account','created','object']<>'{}'::jsonb then raise invalid_parameter_value;end if;
 o=p_event->'object';family=p_event->>'family';kind=p_event->>'type';
 if p_event->>'id'is null or p_event->>'id'!~'^evt_[A-Za-z0-9_]{1,240}$'or jsonb_typeof(p_event->'livemode')<>'boolean'or(p_event->>'source_account'is not null and p_event->>'source_account'!~'^acct_[A-Za-z0-9]{1,200}$')or p_event->>'created'is null or not isfinite((p_event->>'created')::timestamptz)then raise invalid_parameter_value;end if;
 if family is null or kind is null or not((family='transfer'and kind in('transfer.created','transfer.updated','transfer.reversed'))or(family='payout'and kind in('payout.created','payout.updated','payout.paid','payout.failed','payout.canceled','payout.reconciliation_completed'))or(family='fee'and kind in('application_fee.created','application_fee.refunded','application_fee.refund.updated'))or(family='dispute'and kind in('charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated')))then raise invalid_parameter_value;end if;
 if jsonb_typeof(o)is distinct from'object'or not(o?&array['id','amount','currency','source_charge','destination','amount_reversed','reversed','status'])or o-array['id','amount','currency','source_charge','destination','amount_reversed','reversed','status']<>'{}'::jsonb or o->>'id'is null or o->>'id'!~'^[a-z]+_[A-Za-z0-9_]{1,240}$'or jsonb_typeof(o->'amount')<>'number'or o->>'amount'!~'^[0-9]+$'or o->>'currency'is null or o->>'currency'!~'^[a-z]{3}$'then raise invalid_parameter_value;end if;
 amount=(o->>'amount')::bigint;if amount<0 or amount>9007199254740991 then raise invalid_parameter_value;end if;
 if(o->>'source_charge'is not null and o->>'source_charge'!~'^ch_[A-Za-z0-9_]{1,240}$')or(o->>'destination'is not null and o->>'destination'!~'^acct_[A-Za-z0-9]{1,200}$')or char_length(coalesce(o->>'status',''))>80 then raise invalid_parameter_value;end if;
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
revoke all on function public.ingest_stripe_financial_observation(jsonb,text)from public,anon,authenticated,service_role;
grant execute on function public.ingest_stripe_financial_observation(jsonb,text)to service_role;

create function public.stripe_financial_projection(r public.stripe_financial_observations)returns jsonb language sql stable set search_path=''as $$select jsonb_build_object('event',r.event,'result',r.result,'version',r.version,'received_at',r.received_at);$$;
revoke all on function public.stripe_financial_projection(public.stripe_financial_observations)from public,anon,authenticated,service_role;
create function public.stripe_financial_observations_page(p_after text default null,p_state text default null)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare rows jsonb;
begin
 if not public.has_platform_scope('finance_read')then raise insufficient_privilege;end if;
 if(p_after is not null and p_after!~'^evt_[A-Za-z0-9_]{1,240}$')or(p_state is not null and p_state not in('matched','needs_review'))then raise invalid_parameter_value;end if;
 select coalesce(jsonb_agg(public.stripe_financial_projection(r)order by r.event_id),'[]'::jsonb)into rows from(select *from public.stripe_financial_observations where(p_after is null or event_id>p_after)and(p_state is null or result->>'state'=p_state)order by event_id limit 51)r;
 return jsonb_build_object('records',case when jsonb_array_length(rows)>50 then rows-50 else rows end,'next_after',case when jsonb_array_length(rows)>50 then rows->49->'event'->>'id'else null end);
end;$$;
revoke all on function public.stripe_financial_observations_page(text,text)from public,anon,authenticated,service_role;
grant execute on function public.stripe_financial_observations_page(text,text)to authenticated;
create function public.stripe_financial_observation_detail(p_event_id text)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare r public.stripe_financial_observations;history jsonb;n integer;
begin
 if not public.has_platform_scope('finance_read')then raise insufficient_privilege;end if;
 select *into r from public.stripe_financial_observations where event_id=p_event_id;if not found then raise no_data_found;end if;
 select count(*)into n from public.stripe_financial_review_commands where event_id=r.event_id;
 select coalesce(jsonb_agg(to_jsonb(x)order by x.version desc),'[]'::jsonb)into history from(select actor_id,note,created_at,(result->>'version')::integer version,result->'result'outcome from public.stripe_financial_review_commands where event_id=r.event_id order by (result->>'version')::integer desc limit 50)x;
 return jsonb_build_object('record',public.stripe_financial_projection(r),'history',history,'history_limited',n>50);
end;$$;
revoke all on function public.stripe_financial_observation_detail(text)from public,anon,authenticated,service_role;
grant execute on function public.stripe_financial_observation_detail(text)to authenticated;
create function public.review_stripe_financial_observation(p_event_id text,p_command_id uuid,p_expected_version integer,p_note text)returns jsonb language plpgsql security definer set search_path=''as $$
declare r public.stripe_financial_observations;c public.stripe_financial_review_commands;actor uuid=auth.uid();outcome jsonb;answer jsonb;previous jsonb;
begin
 -- The same rights must still exist on replay. Lock existing grants against revocation.
 perform 1 from public.profiles where id=actor for share;perform 1 from public.platform_operator_grants where user_id=actor and scope in('finance_write','finance_read')and status='active'for share;
 if not public.has_platform_scope('finance_write')or not public.has_platform_scope('finance_read')then raise insufficient_privilege;end if;
 if p_command_id is null or p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_note is null or char_length(btrim(p_note))not between 1 and 2000 then raise invalid_parameter_value;end if;
 select *into r from public.stripe_financial_observations where event_id=p_event_id for update;if not found then raise no_data_found;end if;
 select *into c from public.stripe_financial_review_commands where command_id=p_command_id;
 if found then
  if c.actor_id<>actor or c.event_id<>p_event_id or c.expected_version<>p_expected_version or c.note<>btrim(p_note)then raise exception 'Review command changed'using errcode='P0001';end if;
  return c.result||jsonb_build_object('replayed',true);
 end if;
 if r.version<>p_expected_version then raise exception 'Observation revision changed'using errcode='P0001';end if;
 perform public.consume_action('stripe_financial_review',20);
 previous=r.result;outcome=public.match_stripe_financial_observation(r.event);
 update public.stripe_financial_observations set result=outcome,version=version+1 where event_id=r.event_id returning *into r;
 answer=jsonb_build_object('event_id',r.event_id,'version',r.version,'result',outcome,'replayed',false);
 insert into public.stripe_financial_review_commands(command_id,actor_id,event_id,expected_version,previous_result,note,result)values(p_command_id,actor,r.event_id,p_expected_version,previous,btrim(p_note),answer);
 perform public.platform_audit_write('stripe_observation_reviewed','reconciliation',p_command_id::text,jsonb_build_object('event_id',r.event_id,'version',r.version,'state',outcome->>'state','reason',outcome->>'reason'));
 return answer;
end;$$;
revoke all on function public.review_stripe_financial_observation(text,uuid,integer,text)from public,anon,authenticated,service_role;
grant execute on function public.review_stripe_financial_observation(text,uuid,integer,text)to authenticated;
commit;
