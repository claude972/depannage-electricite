-- FIN-06 — manual reconciliation and a commission already withheld.
--
-- Defect (qualification of 22 November 2026): « Rapprocher les règlements » wrote a
-- commission_estimated entry for a payment whose commission was already withheld and confirmed by
-- the provider (commission_withheld). The ledger then carried two commission lines for one payment;
-- the report only hid the duplicate at display time, from a client-side read capped at 1 000 rows.
--
-- This migration:
--  1. platform_reconcile no longer estimates a commission for a payment that has a withheld one.
--     Return shape unchanged; the audit entry also carries commission_skipped_withheld.
--  2. platform_finance_report totals, in SQL and over the whole ledger, the estimates superseded
--     by a withheld commission (rows written before this fix: the ledger is immutable, none is deleted).
--
-- Additive and replay-safe: both functions are replaced in place, grants are restated, no row is
-- written, updated or deleted by the migration itself.

create or replace function public.platform_reconcile(p_limit integer default 200) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare settled_added integer=0; commission_added integer=0; skipped_withheld integer=0; pay record; remaining integer; fee integer; rate public.platform_settings; bps integer;
begin
 if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
 if p_limit is null or p_limit not between 1 and 500 then raise invalid_parameter_value; end if;
 perform public.consume_action('platform_reconcile',10);
 -- The rate is never an argument: it is the audited persisted setting at the time of this run, or absent.
 rate=public.platform_commission_setting();
 bps=case when rate.key is null then null else (rate.value->>'bps')::integer end;
 for pay in select p.* from public.payments p where p.status='paid' and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='payment_settled') order by p.paid_at,p.id limit p_limit for update of p loop
  insert into public.platform_ledger_entries(request_id,entry_kind,direction,amount_cents,currency,payment_id,external_event_id,basis,recorded_by)
  values(gen_random_uuid(),'payment_settled','credit',pay.total_cents,pay.currency,pay.id,pay.session_id,jsonb_build_object('source','payments','paid_at',pay.paid_at,'quote_id',pay.quote_id),auth.uid())
  on conflict (payment_id) where entry_kind='payment_settled' do nothing;
  if found then settled_added=settled_added+1; end if;
 end loop;
 if bps is not null then
  for pay in select p.* from public.payments p where p.status='paid' and exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='payment_settled')
     and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='commission_estimated')
   -- A commission confirmed by the provider is the commission of this payment: no estimate beside it.
   and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='commission_withheld') order by p.paid_at,p.id limit p_limit for update of p loop
   fee=round(pay.total_cents::numeric*bps/10000);
   if fee>0 then
    insert into public.platform_ledger_entries(request_id,entry_kind,direction,amount_cents,currency,payment_id,basis,recorded_by)
    values(gen_random_uuid(),'commission_estimated','debit',fee,pay.currency,pay.id,jsonb_build_object('rate_source','platform_setting','bps',bps,'setting_version',rate.version,'gross_cents',pay.total_cents),auth.uid())
    on conflict (payment_id) where entry_kind='commission_estimated' do nothing;
    if found then commission_added=commission_added+1; end if;
   end if;
  end loop;
 end if;
 select count(*) into remaining from public.payments p where p.status='paid' and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='payment_settled');
 select count(*) into skipped_withheld from public.payments p where p.status='paid'
  and exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='commission_withheld')
  and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='commission_estimated');
 perform public.platform_audit_write('reconciliation_run','reconciliation','',jsonb_build_object('settled_added',settled_added,'commission_added',commission_added,'commission_skipped_withheld',skipped_withheld,'commission_bps',bps,'setting_version',rate.version,'remaining_unsettled',remaining,'limit',p_limit));
 return jsonb_build_object('settled_added',settled_added,'commission_added',commission_added,'commission_bps',bps,'setting_version',rate.version,'remaining_unsettled',remaining);
end; $$;

create or replace function public.platform_finance_report() returns jsonb language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_variable
begin
 if not public.has_platform_scope('finance_read') then raise insufficient_privilege; end if;
 return jsonb_build_object(
  'payments',jsonb_build_object('paid_count',(select count(*) from public.payments where status='paid'),'paid_cents',(select coalesce(sum(total_cents),0) from public.payments where status='paid'),
   'pending_count',(select count(*) from public.payments where status='pending'),'failed_count',(select count(*) from public.payments where status='failed'),'failed_attempts',(select count(*) from public.payment_attempts where status='failed')),
  'ledger',jsonb_build_object('settled_count',(select count(*) from public.platform_ledger_entries where entry_kind='payment_settled'),'settled_cents',(select coalesce(sum(amount_cents),0) from public.platform_ledger_entries where entry_kind='payment_settled'),
   'missing_settlement',(select count(*) from public.payments p where p.status='paid' and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='payment_settled')),
   'amount_mismatches',(select count(*) from public.platform_ledger_entries l join public.payments p on p.id=l.payment_id where l.entry_kind='payment_settled' and (l.amount_cents<>p.total_cents or l.currency<>p.currency)),
   'commission_estimated_count',(select count(*) from public.platform_ledger_entries where entry_kind='commission_estimated'),'commission_estimated_cents',(select coalesce(sum(amount_cents),0) from public.platform_ledger_entries where entry_kind='commission_estimated'),
   'commission_withheld_count',(select count(*) from public.platform_ledger_entries where entry_kind='commission_withheld'),'commission_withheld_cents',(select coalesce(sum(amount_cents),0) from public.platform_ledger_entries where entry_kind='commission_withheld'),
   'refund_settled_count',(select count(*) from public.platform_ledger_entries where entry_kind='refund_settled'),'refund_settled_cents',(select coalesce(sum(amount_cents),0) from public.platform_ledger_entries where entry_kind='refund_settled')),
  'refund_requests',(select coalesce(jsonb_object_agg(status,jsonb_build_object('count',c,'cents',s)),'{}'::jsonb) from (select status,count(*) c,sum(amount_cents) s from public.platform_refund_requests group by status) x),
  'disputes',(select coalesce(jsonb_object_agg(status,c),'{}'::jsonb) from (select status,count(*) c from public.platform_disputes group by status) x),
  'invoices',jsonb_build_object('invoice_count',(select count(*) from public.platform_invoices where kind='invoice'),'credit_note_count',(select count(*) from public.platform_invoices where kind='credit_note')),
  'commission_setting',(select case when key is null then null else jsonb_build_object('bps',(value->>'bps')::integer,'version',version,'updated_at',updated_at) end from public.platform_commission_setting()),
  -- Estimates written before the provider confirmed the commission of the same payment. The ledger is
  -- immutable, so they stay; they are totalled apart and are not an outstanding « non prélevée » amount.
  'commission_estimated_superseded',(select jsonb_build_object('count',count(*),'cents',coalesce(sum(e.amount_cents),0)) from public.platform_ledger_entries e
    where e.entry_kind='commission_estimated' and exists(select 1 from public.platform_ledger_entries w where w.payment_id=e.payment_id and w.entry_kind='commission_withheld')),
  'currency','eur','generated_at',now());
end; $$;

revoke execute on function public.platform_reconcile(integer) from public,anon,authenticated;
grant execute on function public.platform_reconcile(integer) to authenticated;
revoke execute on function public.platform_finance_report() from public,anon,authenticated;
grant execute on function public.platform_finance_report() to authenticated;
