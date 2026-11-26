-- FIN-06 — the manual reconciliation survives one conflicting settlement (registry R-FIN-15).
--
-- 20261122130000 leaves a payment whose settlement entry could not be written « to the manual
-- reconciliation ». But platform_reconcile inserted every missing settlement in one statement loop
-- without isolation: one unique violation (its Checkout session already bound to another
-- payment_settled entry, index platform_ledger_external_event) aborted the whole run, so no other
-- payment could be caught up and the operator only saw an error (isolated review, 25 November 2026).
--
-- Each missing settlement is now written in its own sub-transaction. A unique violation is counted
-- (settlement_conflicts), audited with the payment and its session, and the payment stays visible
-- under remaining_unsettled and missing_settlement. Any other error still aborts the run.
-- Rights, rate source, commission rules and the result's existing keys are unchanged.

create or replace function public.platform_reconcile(p_limit integer default 200) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare settled_added integer=0; conflicts integer=0; conflict_constraint text; commission_added integer=0; skipped_withheld integer=0; pay record; remaining integer; fee integer; rate public.platform_settings; bps integer;
begin
 if not public.has_platform_scope('finance_write') then raise insufficient_privilege; end if;
 if p_limit is null or p_limit not between 1 and 500 then raise invalid_parameter_value; end if;
 perform public.consume_action('platform_reconcile',10);
 -- The rate is never an argument: it is the audited persisted setting at the time of this run, or absent.
 rate=public.platform_commission_setting();
 bps=case when rate.key is null then null else (rate.value->>'bps')::integer end;
 for pay in select p.* from public.payments p where p.status='paid' and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='payment_settled') order by p.paid_at,p.id limit p_limit for update of p loop
  -- One payment whose session is already bound to another settlement must not abort the catch-up
  -- of every other payment: it stays unsettled (remaining_unsettled, missing_settlement) and is audited.
  begin
   insert into public.platform_ledger_entries(request_id,entry_kind,direction,amount_cents,currency,payment_id,external_event_id,basis,recorded_by)
   values(gen_random_uuid(),'payment_settled','credit',pay.total_cents,pay.currency,pay.id,pay.session_id,jsonb_build_object('source','payments','paid_at',pay.paid_at,'quote_id',pay.quote_id),auth.uid())
   on conflict (payment_id) where entry_kind='payment_settled' do nothing;
   if found then settled_added=settled_added+1; end if;
  exception when unique_violation then
   get stacked diagnostics conflict_constraint = constraint_name;
   conflicts=conflicts+1;
   perform public.platform_audit_write('settlement_entry_conflict','ledger',pay.id::text,jsonb_build_object('session_id',pay.session_id,'constraint',conflict_constraint));
  end;
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
 perform public.platform_audit_write('reconciliation_run','reconciliation','',jsonb_build_object('settled_added',settled_added,'commission_added',commission_added,'commission_skipped_withheld',skipped_withheld,'commission_bps',bps,'setting_version',rate.version,'remaining_unsettled',remaining,'settlement_conflicts',conflicts,'limit',p_limit));
 return jsonb_build_object('settled_added',settled_added,'commission_added',commission_added,'commission_bps',bps,'setting_version',rate.version,'remaining_unsettled',remaining,'settlement_conflicts',conflicts);
end; $$;
