-- Platform-only collection. Keep historical direct-payment declarations as
-- declarations, but make new declarations impossible through RPC or table writes.
-- No historical receipt/payment is rewritten as a bank-confirmed transaction.
begin;

create or replace function public.declare_onsite_receipt(p_intervention_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 raise exception 'Direct settlement is no longer accepted; payment must use the platform'
  using errcode='42501';
end;
$$;
revoke all on function public.declare_onsite_receipt(uuid) from public,anon,authenticated,service_role;

-- RLS bypass does not grant table privileges. The trigger also rejects INSERTs
-- by table owners or other privileged routines, so a later accidental grant does
-- not silently restore manual declarations. DELETE is left for scoped cleanup.
revoke insert,update on public.on_site_receipts from service_role;
create function public.reject_new_onsite_receipt() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception 'Direct settlement declarations are disabled' using errcode='42501';
end;
$$;
revoke all on function public.reject_new_onsite_receipt() from public,anon,authenticated,service_role;
create trigger onsite_receipt_no_new_declarations before insert on public.on_site_receipts
 for each row execute function public.reject_new_onsite_receipt();

-- Preserve the existing identity boundary and exact historical DTO. A deferred
-- booking (legacy internal method on_site) now means platform payment after work.
create or replace function public.onsite_receipt_context(p_job uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid(); profile public.profiles; j public.interventions;
 q public.quotes; receipt public.on_site_receipts; amount bigint;
begin
 if actor is null then raise insufficient_privilege; end if;
 select * into profile from public.profiles where id=actor;
 if profile.role is null or profile.role not in ('client','artisan') then raise insufficient_privilege; end if;
 select * into j from public.interventions where id=p_job and
  ((profile.role='client' and client_id=actor) or (profile.role='artisan' and artisan_id=actor));
 if not found or not exists(select 1 from public.phone_booking_requests where intervention_id=p_job
  and actor_id=j.client_id and method='on_site' and status='confirmed') then raise no_data_found; end if;
 if profile.role='client' then perform public.guest_booking_actor(); end if;
 select * into receipt from public.on_site_receipts where intervention_id=p_job;
 if found then return jsonb_build_object('method','on_site_declared','status','declared_received',
  'amount_cents',receipt.amount_cents,'currency','eur','can_declare',false,'available',false); end if;
 select * into q from public.quotes where intervention_id=p_job and status='accepted';
 select q.total_cents+coalesce(sum(a.total_cents),0) into amount
  from public.quote_amendments a where a.base_quote_id=q.id and a.status='accepted';
 -- This endpoint supplies an amount hint only. It never qualifies or initiates
 -- a bank payment. Invalid totals cannot become a zero or a paid amount.
 if amount is null or amount<=0 or amount>2147483647 or exists(select 1 from public.quote_amendments
  where base_quote_id=q.id and status='accepted' and
  (intervention_id<>j.id or artisan_id is distinct from j.artisan_id)) then amount=null; end if;
 return jsonb_build_object('method','on_site','status','due_on_site','amount_cents',amount,
  'currency','eur','can_declare',false,'available',false,'reason','platform_only');
end;
$$;
revoke all on function public.onsite_receipt_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.onsite_receipt_context(uuid) to authenticated;

-- No new paid/payment attempt may acquire the old declaration provenance, even
-- through a privileged direct INSERT. Existing rows remain readable and frozen.
create or replace function public.guard_payment_receipt_method() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.method is distinct from old.method then
  raise exception 'Payment provenance is immutable' using errcode='P0001'; end if;
 if new.method='on_site_declared' then
  if tg_op='INSERT' then raise insufficient_privilege; end if;
  if to_jsonb(new) is distinct from to_jsonb(old) then
   raise exception 'Historical direct-payment declarations are immutable' using errcode='P0001'; end if;
 elsif new.session_id like 'onsite:%' then raise invalid_parameter_value; end if;
 return new;
end;
$$;
revoke all on function public.guard_payment_receipt_method() from public,anon,authenticated,service_role;

create function public.guard_payment_attempt_receipt_method() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.method='on_site_declared' then
  if tg_op='INSERT' then raise insufficient_privilege; end if;
  if old.method is distinct from new.method or to_jsonb(new) is distinct from to_jsonb(old) then
   raise exception 'Historical direct-payment attempts are immutable' using errcode='P0001'; end if;
 elsif tg_op='UPDATE' and old.method='on_site_declared' then
  raise exception 'Payment provenance is immutable' using errcode='P0001';
 elsif new.session_id like 'onsite:%' then raise invalid_parameter_value; end if;
 return new;
end;
$$;
revoke all on function public.guard_payment_attempt_receipt_method() from public,anon,authenticated,service_role;
create trigger payment_attempt_receipt_method_guard before insert or update on public.payment_attempts
 for each row execute function public.guard_payment_attempt_receipt_method();

-- Do not open guard_phone_booking_checkout here. Deferred-booking Checkout must
-- separately prove accepted-amendment totals, ownership and settlement locking.
commit;
