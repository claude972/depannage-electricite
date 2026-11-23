-- FIN-06 — settlement entry written when a payment is confirmed.
--
-- Until now the payment_settled ledger entry existed only after an operator clicked
-- « Rapprocher les règlements »: a confirmed payment stayed « à rapprocher » and the estimated
-- commission depended on that click (qualification of 22 November 2026).
--
-- A trigger now writes the entry in the same transaction as the transition to « paid », whatever
-- the path that confirms the payment. Same row shape as platform_reconcile, which stays the
-- catch-up for payments confirmed before this migration (none is back-filled here).
--
-- A ledger failure never blocks the confirmation of a payment: the entry is then left to the
-- manual reconciliation, the report counts it under missing_settlement and the failure is audited.
-- No commission is written here: the commission comes from the provider proof or, failing that,
-- from the audited estimate of the reconciliation.

create function public.platform_settle_confirmed_payment() returns trigger language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
begin
 if new.status is distinct from 'paid' then return new; end if;
 if tg_op='UPDATE' and old.status is not distinct from 'paid' then return new; end if;
 begin
  insert into public.platform_ledger_entries(request_id,entry_kind,direction,amount_cents,currency,payment_id,external_event_id,basis,recorded_by)
  values(gen_random_uuid(),'payment_settled','credit',new.total_cents,new.currency,new.id,new.session_id,
   jsonb_build_object('source','payment_confirmation','paid_at',new.paid_at,'quote_id',new.quote_id),null)
  on conflict (payment_id) where entry_kind='payment_settled' do nothing;
 exception when others then
  begin
   insert into public.platform_audit(actor_id,action,target_kind,target_id,details)
   values(null,'settlement_entry_failed','ledger',new.id::text,jsonb_build_object('sqlstate',sqlstate));
  exception when others then null;
  end;
 end;
 return new;
end; $$;
revoke execute on function public.platform_settle_confirmed_payment() from public,anon,authenticated,service_role;

create trigger payments_settlement_entry after insert or update of status on public.payments
 for each row execute function public.platform_settle_confirmed_payment();
