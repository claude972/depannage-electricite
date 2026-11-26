#!/usr/bin/env bash
# Read-only snapshot of payment ↔ ledger reconciliation on the recette database (R-FIN-05, R-FIN-15).
#
# Usage, before and after one Stripe TEST payment made by a person on the recette:
#   scripts/qa-ledger/ledger-snapshot.sh > before.json
#   (pay with a Stripe published test card on the recette, wait for the webhook)
#   scripts/qa-ledger/ledger-snapshot.sh > after.json
# Expected after: paid +1, settled_entries +1, missing_settlement 0, every other counter 0,
# WITHOUT anyone clicking « Rapprocher les règlements ».
#
# Only SELECT statements. Never point it at the production project.
set -euo pipefail
ref="${RECETTE_PROJECT_REF:-kcpyjzndybfdlnhvscbs}"
case "$ref" in kcpyjzndybfdlnhvscbs) ;; *) echo "Refused: recette project only." >&2; exit 2 ;; esac
supabase db query --linked --project-ref "$ref" "
select now() as at_,
 (select count(*) from public.payments where status='paid') as paid,
 (select count(*) from public.platform_ledger_entries where entry_kind='payment_settled') as settled_entries,
 (select count(*) from public.payments p where p.status='paid' and not exists(select 1 from public.platform_ledger_entries l where l.payment_id=p.id and l.entry_kind='payment_settled')) as missing_settlement,
 (select count(*) from (select session_id from public.payments where session_id is not null group by session_id having count(*)>1) d) as duplicate_sessions,
 (select count(*) from public.payment_attempts a join public.payments p on p.session_id=a.session_id where p.status='paid' and a.status<>'paid') as attempt_status_mismatch,
 (select count(*) from public.platform_ledger_entries l join public.payments p on p.id=l.payment_id where l.entry_kind='payment_settled' and (l.amount_cents<>p.total_cents or l.currency<>p.currency)) as amount_mismatch,
 (select count(*) from public.platform_ledger_entries where entry_kind='payment_settled' and basis->>'source'='payment_confirmation') as settled_at_confirmation,
 (select count(*) from public.platform_audit where action in ('settlement_entry_failed','settlement_entry_conflict')) as settlement_incidents,
 (select max(paid_at) from public.payments where status='paid') as last_paid_at;"
