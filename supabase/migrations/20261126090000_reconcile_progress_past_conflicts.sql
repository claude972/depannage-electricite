-- R-FIN-16: bounded reconciliation must advance beyond older session conflicts.
-- Preserve the 1..500 batch limit, scope checks, locks, immutable ledger and conflict audit.
-- Known conflicts are retried after non-conflicting settlements. They are never hidden from
-- remaining_unsettled or the report; concurrent conflicts still use the existing exception path.
-- Within each group, the original paid_at/id order is preserved. No historical rows are changed.

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
 for pay in select p.* from public.payments p where p.status='paid' and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='payment_settled') order by
   -- Keep known session conflicts eligible, but behind catch-up work that can succeed.
   -- Otherwise p_limit old conflicts would occupy every future batch permanently.
   exists(select 1 from public.platform_ledger_entries occupied
     where occupied.entry_kind='payment_settled' and occupied.external_event_id=p.session_id),
   p.paid_at,p.id limit p_limit for update of p loop
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
