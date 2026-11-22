-- Durable approved-request refunds. No bank call or financial policy default.
begin;
create table public.platform_refund_executions(
 id uuid primary key,request_id uuid not null unique references public.platform_refund_requests(id),actor_id uuid not null references public.profiles(id),
 request_version integer not null,policy jsonb,charge_id text,payment_intent_id text,provider_refund_id text unique,
 state text not null default 'preparing' check(state in('preparing','submitted','pending','requires_action','failed','canceled','succeeded','unknown','needs_review')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check(policy is null or jsonb_typeof(policy)='object'),check(charge_id is null or charge_id~'^ch_[A-Za-z0-9_]{1,240}$'),check(payment_intent_id is null or payment_intent_id~'^pi_[A-Za-z0-9_]{1,240}$'),check(provider_refund_id is null or provider_refund_id~'^re_[A-Za-z0-9_]{1,240}$')
);
alter table public.platform_refund_executions enable row level security;
revoke all on public.platform_refund_executions from public,anon,authenticated,service_role;
grant select on public.platform_refund_executions to service_role;
create function public.refund_execution_actor(p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=p_actor and(p.role='admin' or exists(select 1 from public.platform_operator_grants g where g.user_id=p.id and g.scope='finance_write'and g.status='active')));
$$;
revoke all on function public.refund_execution_actor(uuid) from public,anon,authenticated,service_role;
create function public.begin_refund_execution(p_id uuid,p_command uuid,p_version integer) returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare r public.platform_refund_requests;p public.payments;e public.platform_refund_executions;
begin
 if not public.has_platform_scope('finance_write')then raise insufficient_privilege;end if;
 if p_command is null or p_version is null or p_version<1 then raise invalid_parameter_value;end if;
 select pay.* into p from public.payments pay join public.platform_refund_requests q on q.payment_id=pay.id where q.id=p_id for update of pay;
 select *into r from public.platform_refund_requests where id=p_id for update;if not found then raise no_data_found;end if;
 select *into e from public.platform_refund_executions where request_id=p_id;
 if found then
  if e.id<>p_command or e.actor_id<>auth.uid()or e.request_version<>p_version then raise exception 'Execution command conflict'using errcode='P0001';end if;return e.id;
 end if;
 if r.status<>'approved'or r.version<>p_version or p.status<>'paid'or p.method<>'stripe'or p.paid_at is null then raise exception 'Refund not approved or not confirmed'using errcode='P0001';end if;
 if exists(select 1 from public.platform_refund_executions where id=p_command)then raise exception 'Execution command conflict'using errcode='P0001';end if;
 if exists(select 1 from public.platform_refund_executions x join public.platform_refund_requests z on z.id=x.request_id where z.payment_id=p.id and x.state='needs_review')then raise exception 'Payment needs reconciliation'using errcode='P0001';end if;
 perform public.consume_action('platform_refunds',20);
 insert into public.platform_refund_executions(id,request_id,actor_id,request_version)values(p_command,p_id,auth.uid(),p_version);
 perform public.platform_audit_write('refund_execution_prepared','refund_request',r.id::text,jsonb_build_object('execution_id',p_command,'version',p_version));return p_command;
end;$$;
revoke all on function public.begin_refund_execution(uuid,uuid,integer)from public,anon,authenticated,service_role;grant execute on function public.begin_refund_execution(uuid,uuid,integer)to authenticated;
create function public.refund_execution_private(p_id uuid,p_actor uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare e public.platform_refund_executions;r public.platform_refund_requests;p public.payments;l public.platform_checkouts;
begin
 if p_actor is not null and not public.refund_execution_actor(p_actor)then raise insufficient_privilege;end if;
 select *into e from public.platform_refund_executions where id=p_id;if not found or(p_actor is not null and e.actor_id<>p_actor)then raise no_data_found;end if;
 select *into r from public.platform_refund_requests where id=e.request_id;select *into p from public.payments where id=r.payment_id;
 select *into l from public.platform_checkouts where session_id=p.session_id and quote_id=p.quote_id and status='paid';
 return jsonb_build_object('execution',to_jsonb(e),'request',jsonb_build_object('id',r.id,'status',r.status,'version',r.version,'payment_id',r.payment_id,'amount_cents',r.amount_cents,'currency',r.currency),
 'payment',jsonb_build_object('id',p.id,'quote_id',p.quote_id,'session_id',p.session_id,'total_cents',p.total_cents,'currency',p.currency,'status',p.status,'paid_at',p.paid_at),'checkout',case when l.id is null then null else jsonb_build_object('id',l.id,'account_id',l.account_id,'fee_cents',l.fee_cents,'amount_cents',l.amount_cents)end);
end;$$;
revoke all on function public.refund_execution_private(uuid,uuid)from public,anon,authenticated,service_role;grant execute on function public.refund_execution_private(uuid,uuid)to service_role;
create function public.qualify_refund_execution(p_id uuid,p_actor uuid,p_policy jsonb,p_charge text,p_intent text)returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare e public.platform_refund_executions;r public.platform_refund_requests;
begin
 perform 1 from public.payments p join public.platform_refund_requests r on r.payment_id=p.id join public.platform_refund_executions e on e.request_id=r.id where e.id=p_id for update of p;
 select r.*into r from public.platform_refund_requests r join public.platform_refund_executions e on e.request_id=r.id where e.id=p_id for update of r;
 select *into e from public.platform_refund_executions where id=p_id for update;
 if not found or e.actor_id<>p_actor or not public.refund_execution_actor(p_actor)then raise insufficient_privilege;end if;
 if r.status<>'approved'or r.version<>e.request_version or e.state not in('preparing','unknown')then raise exception 'Execution not open'using errcode='P0001';end if;
 if p_charge is null or p_charge!~'^ch_[A-Za-z0-9_]{1,240}$'or p_intent is null or p_intent!~'^pi_[A-Za-z0-9_]{1,240}$'or p_policy is null or p_policy-array['version','reverse_transfer','refund_application_fee','livemode']<>'{}'::jsonb or
 jsonb_typeof(p_policy->'version')is distinct from'string'or char_length(p_policy->>'version')not between 1 and 80 or jsonb_typeof(p_policy->'reverse_transfer')is distinct from'boolean'or jsonb_typeof(p_policy->'refund_application_fee')is distinct from'boolean'or jsonb_typeof(p_policy->'livemode')is distinct from'boolean'or((p_policy->>'refund_application_fee')::boolean and not(p_policy->>'reverse_transfer')::boolean)then raise invalid_parameter_value;end if;
 if e.policy is not null and(e.policy<>p_policy or e.charge_id<>p_charge or e.payment_intent_id<>p_intent)then raise exception 'Frozen refund binding conflict'using errcode='P0001';end if;
 if e.policy is null then insert into public.platform_audit(actor_id,action,target_kind,target_id,details)values(p_actor,'refund_execution_qualified','refund_request',r.id::text,jsonb_build_object('execution_id',p_id,'policy_version',p_policy->>'version','reverse_transfer',p_policy->'reverse_transfer','refund_application_fee',p_policy->'refund_application_fee','livemode',p_policy->'livemode'));end if;
 update public.platform_refund_executions set policy=p_policy,charge_id=p_charge,payment_intent_id=p_intent,updated_at=clock_timestamp()where id=p_id;
end;$$;
revoke all on function public.qualify_refund_execution(uuid,uuid,jsonb,text,text)from public,anon,authenticated,service_role;grant execute on function public.qualify_refund_execution(uuid,uuid,jsonb,text,text)to service_role;
create function public.authorize_refund_execution(p_id uuid)returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare e public.platform_refund_executions;r public.platform_refund_requests;
begin
 perform 1 from public.payments p join public.platform_refund_requests r on r.payment_id=p.id join public.platform_refund_executions e on e.request_id=r.id where e.id=p_id for update of p;
 select r.*into r from public.platform_refund_requests r join public.platform_refund_executions e on e.request_id=r.id where e.id=p_id for update of r;
 select *into e from public.platform_refund_executions where id=p_id for update;
 if not found or e.actor_id<>auth.uid()or not public.has_platform_scope('finance_write')then raise insufficient_privilege;end if;
 if r.status<>'approved'or r.version<>e.request_version or e.policy is null or e.charge_id is null or e.state not in('preparing','unknown')or clock_timestamp()-e.created_at>=interval'23 hours'then raise exception 'Refund requires reconciliation'using errcode='P0001';end if;
 -- Mark uncertainty BEFORE crossing the network. No timeout can reopen the reservation.
 update public.platform_refund_executions set state='unknown',updated_at=clock_timestamp()where id=p_id;
end;$$;
revoke all on function public.authorize_refund_execution(uuid)from public,anon,authenticated,service_role;grant execute on function public.authorize_refund_execution(uuid)to authenticated;
create function public.bind_refund_execution(p_id uuid,p_actor uuid,p_refund text,p_state text)returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare e public.platform_refund_executions;
begin
 perform 1 from public.payments p join public.platform_refund_requests r on r.payment_id=p.id join public.platform_refund_executions e on e.request_id=r.id where e.id=p_id for update of p;
 perform 1 from public.platform_refund_requests r join public.platform_refund_executions e on e.request_id=r.id where e.id=p_id for update of r;
 select *into e from public.platform_refund_executions where id=p_id for update;
 if not found or e.actor_id<>p_actor or not public.refund_execution_actor(p_actor)then raise insufficient_privilege;end if;
 if p_state not in('submitted','needs_review')or(p_state='submitted'and p_refund is null)or(p_refund is not null and p_refund!~'^re_[A-Za-z0-9_]{1,240}$')or(e.provider_refund_id is not null and e.provider_refund_id is distinct from p_refund)then raise invalid_parameter_value;end if;
 if e.state in('succeeded','failed','canceled')and p_state<>'needs_review'then return;end if;
 update public.platform_refund_executions set provider_refund_id=coalesce(provider_refund_id,p_refund),state=p_state,updated_at=clock_timestamp()where id=p_id;
end;$$;
revoke all on function public.bind_refund_execution(uuid,uuid,text,text)from public,anon,authenticated,service_role;grant execute on function public.bind_refund_execution(uuid,uuid,text,text)to service_role;
create table public.platform_refund_execution_events(event_id text primary key,execution_id uuid not null references public.platform_refund_executions(id),refund_id text not null,state text not null);
alter table public.platform_refund_execution_events enable row level security;
revoke all on public.platform_refund_execution_events from public,anon,authenticated,service_role;
-- Existing approval/cancel command retains its original guards and audit; add only emission freeze.
alter function public.platform_decide_refund(uuid,text,integer,text)rename to platform_decide_refund_before_execution;
revoke all on function public.platform_decide_refund_before_execution(uuid,text,integer,text)from public,anon,authenticated,service_role;
create function public.platform_decide_refund(p_id uuid,p_action text,p_expected_version integer,p_note text default'')returns jsonb language plpgsql security definer set search_path=''as $$
begin
 if not public.has_platform_scope('finance_write')then raise insufficient_privilege;end if;
 perform 1 from public.payments p join public.platform_refund_requests r on r.payment_id=p.id where r.id=p_id for update of p;
 perform 1 from public.platform_refund_requests where id=p_id for update;
 if exists(select 1 from public.platform_refund_executions where request_id=p_id and state not in('failed','canceled'))then raise exception 'Refund emission cannot be canceled locally'using errcode='P0001';end if;
 return public.platform_decide_refund_before_execution(p_id,p_action,p_expected_version,p_note);
end;$$;
revoke all on function public.platform_decide_refund(uuid,text,integer,text)from public,anon,authenticated,service_role;grant execute on function public.platform_decide_refund(uuid,text,integer,text)to authenticated;
-- Keep historical settlement writer private. New service wrapper requires durable emitted binding.
alter function public.platform_settle_refund(uuid,text,text,text,text,text,integer,text)rename to platform_settle_refund_before_execution;
revoke all on function public.platform_settle_refund_before_execution(uuid,text,text,text,text,text,integer,text)from public,anon,authenticated,service_role;
do $$declare original text;patched text;begin
 original=pg_get_functiondef('public.platform_settle_refund_before_execution(uuid,text,text,text,text,text,integer,text)'::regprocedure);
 patched=replace(original,'''charge.refunded'',''refund.updated''','''refund.created'',''refund.updated'',''refund.failed''');
 if patched=original then raise exception 'Expected refund event validator missing';end if;execute patched;
end;$$;
create function public.platform_settle_refund(p_id uuid,p_event_id text,p_event_type text,p_session_id text,p_provider_reference text,p_provider_status text,p_amount_cents integer,p_currency text)returns boolean language plpgsql security definer set search_path=''as $$
begin
 if not exists(select 1 from public.platform_refund_executions where request_id=p_id and provider_refund_id=p_provider_reference and policy is not null and charge_id is not null and state in('submitted','unknown','pending','requires_action'))then raise exception 'Refund has no qualified execution'using errcode='P0001';end if;
 return public.platform_settle_refund_before_execution(p_id,p_event_id,p_event_type,p_session_id,p_provider_reference,p_provider_status,p_amount_cents,p_currency);
end;$$;
revoke all on function public.platform_settle_refund(uuid,text,text,text,text,text,integer,text)from public,anon,authenticated,service_role;grant execute on function public.platform_settle_refund(uuid,text,text,text,text,text,integer,text)to service_role;
create function public.apply_refund_execution_event(p_id uuid,p_event text,p_type text,p_refund text,p_charge text,p_intent text,p_amount integer,p_currency text,p_state text,p_live boolean)returns jsonb language plpgsql security definer set search_path=''as $$
#variable_conflict use_column
declare e public.platform_refund_executions;r public.platform_refund_requests;p public.payments;
begin
 if p_event is null or p_event!~'^evt_[A-Za-z0-9_]{1,240}$'or p_type not in('refund.created','refund.updated','refund.failed')or p_state not in('pending','requires_action','succeeded','failed','canceled')then raise invalid_parameter_value;end if;
 select pay.*into p from public.payments pay join public.platform_refund_requests q on q.payment_id=pay.id join public.platform_refund_executions x on x.request_id=q.id where x.id=p_id for update of pay;
 select q.*into r from public.platform_refund_requests q join public.platform_refund_executions x on x.request_id=q.id where x.id=p_id for update of q;
 select *into e from public.platform_refund_executions where id=p_id for update;
 if not found or e.policy is null or e.charge_id is distinct from p_charge or e.payment_intent_id is distinct from p_intent or
 p_refund is null or p_refund!~'^re_[A-Za-z0-9_]{1,240}$'or(e.provider_refund_id is not null and e.provider_refund_id<>p_refund)or r.amount_cents is distinct from p_amount or r.currency is distinct from p_currency or(e.policy->>'livemode')::boolean is distinct from p_live or p.status<>'paid'or p.method<>'stripe'or p.paid_at is null then raise exception 'Refund event mismatch'using errcode='P0001';end if;
 if exists(select 1 from public.stripe_events where id=p_event)then
 if not exists(select 1 from public.platform_refund_execution_events x where x.event_id=p_event and x.execution_id=p_id and x.refund_id=p_refund)then raise exception 'Event identity conflict'using errcode='P0001';end if;
 return jsonb_build_object('state',e.state,'replayed',true);end if;
 if e.state='needs_review'then return jsonb_build_object('state','needs_review');end if;
 insert into public.platform_refund_execution_events(event_id,execution_id,refund_id,state)values(p_event,p_id,p_refund,p_state);
 if(e.state='succeeded'and p_state<>'succeeded')or(e.state in('failed','canceled')and e.state<>p_state)then
  update public.platform_refund_executions set state='needs_review',updated_at=clock_timestamp()where id=p_id;
  insert into public.stripe_events(id,event_type)values(p_event,p_type);
  insert into public.platform_audit(actor_id,action,target_kind,target_id,details)values(null,'refund_terminal_conflict','refund_request',r.id::text,jsonb_build_object('execution_id',e.id,'event_id',p_event));
  return jsonb_build_object('state','needs_review');
 end if;
 update public.platform_refund_executions set provider_refund_id=p_refund where id=p_id;
 if p_state='succeeded'and e.state<>'succeeded'then
  perform public.platform_settle_refund(r.id,p_event,p_type,p.session_id,p_refund,'succeeded',p_amount,p_currency);
 else insert into public.stripe_events(id,event_type)values(p_event,p_type);end if;
 update public.platform_refund_executions set state=p_state,updated_at=clock_timestamp()where id=p_id;
 return jsonb_build_object('state',p_state,'replayed',false);
end;$$;
revoke all on function public.apply_refund_execution_event(uuid,text,text,text,text,text,integer,text,text,boolean)from public,anon,authenticated,service_role;grant execute on function public.apply_refund_execution_event(uuid,text,text,text,text,text,integer,text,text,boolean)to service_role;
-- Reading operational state does not contact Stripe or expose provider IDs.
create function public.refund_execution_capability()returns boolean language sql stable security definer set search_path=''as $$select public.has_platform_scope('finance_write');$$;
revoke all on function public.refund_execution_capability()from public,anon,authenticated,service_role;grant execute on function public.refund_execution_capability()to authenticated;
create function public.read_refund_execution(p_request uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
#variable_conflict use_column
declare r public.platform_refund_requests;e public.platform_refund_executions;p public.payments;reason text;
begin
 if not public.has_platform_scope('finance_read')then raise insufficient_privilege;end if;
 select *into r from public.platform_refund_requests where id=p_request;if not found then raise no_data_found;end if;
 select *into e from public.platform_refund_executions where request_id=p_request;
 select *into p from public.payments where id=r.payment_id;
 reason=case when not public.has_platform_scope('finance_write')then 'read_only'when r.status<>'approved'then 'approval_required'when e.actor_id is not null and e.actor_id<>auth.uid()then 'operator_mismatch'when e.request_version is not null and e.request_version<>r.version then 'revision_changed'when e.state='needs_review'then 'reconciliation_required'when e.state in('failed','canceled','succeeded')then 'terminal_execution'
 when p.status<>'paid'or p.method<>'stripe'or p.paid_at is null then 'payment_unconfirmed'
 when not exists(select 1 from public.platform_checkouts l where l.session_id=p.session_id and l.quote_id=p.quote_id and l.status='paid'and l.amount_cents=p.total_cents and l.account_id~'^acct_[A-Za-z0-9]{1,200}$'and l.fee_cents is not null)then 'legacy_binding_missing'
 else 'provider_verification_required'end;
 return jsonb_build_object('request_status',r.status,'execution_status',e.state,'execution_id',e.id,'eligible',reason='provider_verification_required','reason',reason);
end;$$;
revoke all on function public.read_refund_execution(uuid)from public,anon,authenticated,service_role;grant execute on function public.read_refund_execution(uuid)to authenticated;
-- A qualified contradiction must not keep publishing a trustworthy financial net.
do $$declare result text;begin
 select pg_get_function_result('public.professional_report(uuid,uuid)'::regprocedure)into result;
 alter function public.professional_report(uuid,uuid)rename to professional_report_before_refund_execution;
 revoke all on function public.professional_report_before_refund_execution(uuid,uuid)from public,anon,authenticated,service_role;
 execute 'create function public.professional_report(p_site_id uuid default null,p_organization_id uuid default null)returns '||result||' language plpgsql stable security definer set search_path=''''as $f$begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 if exists(select 1 from public.platform_refund_executions e join public.platform_refund_requests r on r.id=e.request_id join public.payments p on p.id=r.payment_id join public.quotes q on q.id=p.quote_id join public.interventions i on i.id=q.intervention_id join public.sites s on s.id=i.site_id where e.state=''needs_review''and public.can_access_site(s.id)and(p_site_id is null or s.id=p_site_id)and(p_organization_id is null or s.organization_id=p_organization_id))then raise exception ''Financial reconciliation required''using errcode=''P0003'';end if;
 return query select *from public.professional_report_before_refund_execution(p_site_id,p_organization_id);end;$f$';
 revoke all on function public.professional_report(uuid,uuid)from public,anon,authenticated,service_role;
 grant execute on function public.professional_report(uuid,uuid)to authenticated;
end;$$;
commit;
