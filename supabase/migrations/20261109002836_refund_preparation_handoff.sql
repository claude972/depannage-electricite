begin;

-- Preparing without a frozen Charge is still before the provider write boundary.
-- Keep the existing age guard and never transfer an uncertain or submitted execution.
create or replace function public.refund_preparation_abandoned(e public.platform_refund_executions)
returns boolean language sql stable security definer set search_path = '' as $$
  select e.state = 'preparing' and e.policy is null and e.charge_id is null
    and e.payment_intent_id is null and e.provider_refund_id is null
    and e.created_at > statement_timestamp() - interval '23 hours'
    and e.created_at <= statement_timestamp()
    and not public.refund_execution_actor(e.actor_id);
$$;
revoke all on function public.refund_preparation_abandoned(public.platform_refund_executions) from public, anon, authenticated, service_role;

create or replace function public.begin_refund_execution(p_id uuid, p_command uuid, p_version integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r public.platform_refund_requests;
  p public.payments;
  e public.platform_refund_executions;
begin
  if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
  if p_command is null or p_version is null or p_version < 1 then raise invalid_parameter_value; end if;
  select pay.* into p from public.payments pay
    join public.platform_refund_requests q on q.payment_id = pay.id where q.id = p_id for update of pay;
  select * into r from public.platform_refund_requests where id = p_id for update;
  if not found then raise no_data_found; end if;
  select * into e from public.platform_refund_executions where request_id = p_id for update;
  if found then
    if e.id <> p_command or e.request_version <> p_version then
      raise exception 'Execution command conflict' using errcode = 'P0001';
    end if;
    if e.actor_id <> auth.uid() then
      if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
      if not public.refund_preparation_abandoned(e) or r.status <> 'approved' or r.version <> p_version
        or p.status <> 'paid' or p.method <> 'stripe' or p.paid_at is null then
        raise exception 'Execution command conflict' using errcode = 'P0001';
      end if;
      update public.platform_refund_executions set actor_id = auth.uid(), updated_at = clock_timestamp() where id = e.id;
      perform public.platform_audit_write('refund_execution_reassigned', 'refund_request', r.id::text,
        jsonb_build_object('execution_id', e.id, 'previous_actor_id', e.actor_id, 'version', p_version));
    end if;
    return e.id;
  end if;
  if r.status <> 'approved' or r.version <> p_version or p.status <> 'paid' or p.method <> 'stripe' or p.paid_at is null then
    raise exception 'Refund not approved or not confirmed' using errcode = 'P0001';
  end if;
  if exists(select 1 from public.platform_refund_executions where id = p_command) then
    raise exception 'Execution command conflict' using errcode = 'P0001';
  end if;
  if exists(select 1 from public.platform_refund_executions x join public.platform_refund_requests z on z.id = x.request_id
    where z.payment_id = p.id and x.state = 'needs_review') then
    raise exception 'Payment needs reconciliation' using errcode = 'P0001';
  end if;
  perform public.consume_action('platform_refunds', 20);
  insert into public.platform_refund_executions(id, request_id, actor_id, request_version) values(p_command, p_id, auth.uid(), p_version);
  perform public.platform_audit_write('refund_execution_prepared', 'refund_request', r.id::text,
    jsonb_build_object('execution_id', p_command, 'version', p_version));
  return p_command;
end;
$$;

create or replace function public.read_refund_execution(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.platform_refund_requests;
  e public.platform_refund_executions;
  p public.payments;
  reason text;
begin
  if not public.has_platform_scope('finance_read') then raise insufficient_privilege; end if;
  select * into r from public.platform_refund_requests where id = p_request;
  if not found then raise no_data_found; end if;
  select * into e from public.platform_refund_executions where request_id = p_request;
  select * into p from public.payments where id = r.payment_id;
  reason := case
    when not public.has_platform_scope('finance_write') then 'read_only'
    when r.status <> 'approved' then 'approval_required'
    when e.actor_id is not null and e.actor_id <> auth.uid() and not public.refund_preparation_abandoned(e) then 'operator_mismatch'
    when e.request_version is not null and e.request_version <> r.version then 'revision_changed'
    when e.state = 'needs_review' then 'reconciliation_required'
    when e.state in ('failed', 'canceled', 'succeeded') then 'terminal_execution'
    when p.status <> 'paid' or p.method <> 'stripe' or p.paid_at is null then 'payment_unconfirmed'
    when not exists(select 1 from public.platform_checkouts l where l.session_id = p.session_id and l.quote_id = p.quote_id
      and l.status = 'paid' and l.amount_cents = p.total_cents and l.account_id ~ '^acct_[A-Za-z0-9]{1,200}$' and l.fee_cents is not null)
      then 'legacy_binding_missing'
    else 'provider_verification_required'
  end;
  return jsonb_build_object('request_status', r.status, 'execution_status', e.state,
    'execution_id', e.id, 'eligible', reason = 'provider_verification_required', 'reason', reason);
end;
$$;

commit;
