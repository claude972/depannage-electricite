begin;

-- Keep the existing role/scope checks. The signed JWT's assurance level is
-- checked in each user RPC so PostgREST callers and Next.js use the same gate.
create function public.require_platform_mfa()
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise sqlstate 'PT403' using message = 'platform_mfa_required';
  end if;
end;
$$;
revoke all on function public.require_platform_mfa() from public, anon, authenticated, service_role;

create or replace function public.platform_grant_scope(p_user_id uuid,p_scope text,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare target public.profiles; row public.platform_operator_grants; note text;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 perform public.require_platform_mfa();
 note=coalesce(regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g'),'');
 if p_user_id is null or p_scope is null or p_scope not in ('finance_read','finance_write','reviews_moderate','audit_read','support_read','support_reply','support_status') or char_length(note)>500 then raise invalid_parameter_value; end if;
 perform public.consume_action('platform_operators',30);
 select * into target from public.profiles where id=p_user_id for no key update;
 if not found then raise no_data_found; end if;
 if target.role='admin' then raise exception 'Super admins hold every scope implicitly' using errcode='P0001'; end if;
 select * into row from public.platform_operator_grants where user_id=p_user_id and scope=p_scope and status='active';
 if found then return jsonb_build_object('grant',to_jsonb(row),'replayed',true); end if;
 insert into public.platform_operator_grants(user_id,scope,note,granted_by) values(p_user_id,p_scope,note,auth.uid()) returning * into row;
 perform public.platform_audit_write('operator_scope_granted','operator',p_user_id::text,jsonb_build_object('scope',p_scope,'grant_id',row.id,'note',note));
 return jsonb_build_object('grant',to_jsonb(row),'replayed',false);
end; $$;

create or replace function public.platform_revoke_scope(p_grant_id uuid,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare row public.platform_operator_grants; note text;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 perform public.require_platform_mfa();
 note=coalesce(regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g'),'');
 if p_grant_id is null or char_length(note)>500 then raise invalid_parameter_value; end if;
 perform public.consume_action('platform_operators',30);
 select * into row from public.platform_operator_grants where id=p_grant_id for update;
 if not found then raise no_data_found; end if;
 if row.status='revoked' then return jsonb_build_object('grant',to_jsonb(row),'replayed',true); end if;
 update public.platform_operator_grants set status='revoked',revoked_by=auth.uid(),revoked_at=now(),revoke_note=note where id=p_grant_id returning * into row;
 perform public.platform_audit_write('operator_scope_revoked','operator',row.user_id::text,jsonb_build_object('scope',row.scope,'grant_id',row.id,'note',note));
 return jsonb_build_object('grant',to_jsonb(row),'replayed',false);
end; $$;

create or replace function public.platform_set_super_admin(p_user_id uuid,p_enabled boolean,p_restore_role text default 'client',p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare target public.profiles; note text; revoked integer;
begin
 if not public.is_admin() then raise insufficient_privilege; end if;
 perform public.require_platform_mfa();
 note=coalesce(regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g'),'');
 if p_user_id is null or p_enabled is null or p_restore_role not in ('client','manager') or char_length(note)>500 then raise invalid_parameter_value; end if;
 if p_user_id=auth.uid() then raise exception 'A super admin cannot change their own status' using errcode='P0001'; end if;
 perform public.consume_action('platform_admin',10);
 -- Same lock as the trigger: concurrent decisions on the admin set are serialized before counting.
 perform pg_advisory_xact_lock(hashtext('profiles_super_admin'));
 select * into target from public.profiles where id=p_user_id for no key update;
 if not found then raise no_data_found; end if;
 if p_enabled then
  if target.role='admin' then return jsonb_build_object('profile_id',target.id,'role','admin','replayed',true); end if;
  if target.role='artisan' then raise exception 'Artisan accounts are governed by artisan approval' using errcode='P0001'; end if;
  update public.profiles set role='admin' where id=p_user_id;
  update public.platform_operator_grants set status='revoked',revoked_by=auth.uid(),revoked_at=now(),revoke_note='superseded by super admin status' where user_id=p_user_id and status='active';
  get diagnostics revoked=row_count;
  perform public.platform_audit_write('super_admin_granted','super_admin',p_user_id::text,jsonb_build_object('previous_role',target.role,'grants_revoked',revoked,'note',note));
  return jsonb_build_object('profile_id',target.id,'role','admin','replayed',false);
 end if;
 if target.role<>'admin' then return jsonb_build_object('profile_id',target.id,'role',target.role,'replayed',true); end if;
 if (select count(*) from public.profiles where role='admin')<=1 then raise exception 'The last super admin cannot be removed or demoted' using errcode='P0001'; end if;
 update public.profiles set role=p_restore_role where id=p_user_id;
 perform public.platform_audit_write('super_admin_revoked','super_admin',p_user_id::text,jsonb_build_object('restored_role',p_restore_role,'note',note));
 return jsonb_build_object('profile_id',target.id,'role',p_restore_role,'replayed',false);
end; $$;

create or replace function public.platform_request_refund(p_request_id uuid,p_payment_id uuid,p_amount_cents integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare pay public.payments; row public.platform_refund_requests; reason text; committed bigint; fingerprint text;
begin
 if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
 perform public.require_platform_mfa();
 reason=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
 if p_request_id is null or p_payment_id is null or p_amount_cents is null or p_amount_cents<1 or reason is null or char_length(reason) not between 10 and 2000 then raise invalid_parameter_value; end if;
 -- Lock order for every finance write: the payment row first, then the entity.
 select * into pay from public.payments where id=p_payment_id for update;
 if not found then raise no_data_found; end if;
 fingerprint=md5('refund|'||p_payment_id::text||'|'||p_amount_cents::text||'|'||pay.currency||'|'||reason);
 select * into row from public.platform_refund_requests where request_id=p_request_id;
 if found then
  if row.content_fingerprint<>fingerprint then raise exception 'Request key content conflict' using errcode='P0001'; end if;
  return jsonb_build_object('request',to_jsonb(row),'replayed',true);
 end if;
 if pay.status<>'paid' then raise exception 'Only a settled payment can be refunded' using errcode='P0001'; end if;
 perform public.consume_action('platform_refunds',20);
 select coalesce(sum(amount_cents),0) into committed from public.platform_refund_requests where payment_id=p_payment_id and status in ('requested','approved','settled');
 if committed+p_amount_cents>pay.total_cents then raise exception 'Refund requests exceed the settled amount' using errcode='P0001'; end if;
 insert into public.platform_refund_requests(request_id,payment_id,amount_cents,currency,reason,content_fingerprint,requested_by) values(p_request_id,p_payment_id,p_amount_cents,pay.currency,reason,fingerprint,auth.uid()) returning * into row;
 perform public.platform_audit_write('refund_requested','refund_request',row.id::text,jsonb_build_object('payment_id',p_payment_id,'amount_cents',p_amount_cents,'currency',pay.currency,'version',row.version));
 return jsonb_build_object('request',to_jsonb(row),'replayed',false);
end; $$;

create or replace function public.platform_decide_refund(p_id uuid,p_action text,p_expected_version integer,p_note text default'')returns jsonb language plpgsql security definer set search_path=''as $$
begin
 if not public.has_platform_scope('finance_write')then raise insufficient_privilege;end if;
 perform public.require_platform_mfa();
 perform 1 from public.payments p join public.platform_refund_requests r on r.payment_id=p.id where r.id=p_id for update of p;
 perform 1 from public.platform_refund_requests where id=p_id for update;
 if exists(select 1 from public.platform_refund_executions where request_id=p_id and state not in('failed','canceled'))then raise exception 'Refund emission cannot be canceled locally'using errcode='P0001';end if;
 return public.platform_decide_refund_before_execution(p_id,p_action,p_expected_version,p_note);
end;$$;

create or replace function public.begin_refund_execution(p_id uuid, p_command uuid, p_version integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r public.platform_refund_requests;
  p public.payments;
  e public.platform_refund_executions;
begin
  if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
 perform public.require_platform_mfa();
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

create or replace function public.authorize_refund_execution(p_id uuid)returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare e public.platform_refund_executions;r public.platform_refund_requests;
begin
 perform 1 from public.payments p join public.platform_refund_requests r on r.payment_id=p.id join public.platform_refund_executions e on e.request_id=r.id where e.id=p_id for update of p;
 select r.*into r from public.platform_refund_requests r join public.platform_refund_executions e on e.request_id=r.id where e.id=p_id for update of r;
 select *into e from public.platform_refund_executions where id=p_id for update;
 if not found or e.actor_id<>auth.uid()or not public.has_platform_scope('finance_write')then raise insufficient_privilege;end if;
 perform public.require_platform_mfa();
 if r.status<>'approved'or r.version<>e.request_version or e.policy is null or e.charge_id is null or e.state not in('preparing','unknown')or clock_timestamp()-e.created_at>=interval'23 hours'then raise exception 'Refund requires reconciliation'using errcode='P0001';end if;
 -- Mark uncertainty BEFORE crossing the network. No timeout can reopen the reservation.
 update public.platform_refund_executions set state='unknown',updated_at=clock_timestamp()where id=p_id;
end;$$;

commit;
