begin;

alter table public.platform_audit
  drop constraint if exists platform_audit_target_kind_check;
alter table public.platform_audit
  add constraint platform_audit_target_kind_check check (target_kind in (
    'operator', 'super_admin', 'setting', 'reconciliation', 'ledger', 'invoice',
    'refund_request', 'dispute', 'review', 'public_callback', 'support_ticket'
  ));

commit;
