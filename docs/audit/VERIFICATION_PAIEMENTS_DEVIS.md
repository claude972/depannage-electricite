# Independent review — payments and exact quote consent

## Reviewed checkpoint

Exact pushed revision: `4ae3bd168bec9e2a704c2fcd7d8b8db379689369` on `codex/web-pwa-backend`. Reviewed diff from `0a014063a6f2ca4fa323d627554bdfb5ffcd9c11`. Source checkout was not edited. A `git archive` of this exact revision was exported to `/tmp/depannage-review-4ae3bd1`; tests below ran from that export, not mutable PWA/backend work in progress.

**Result: no new actionable blocking finding identified within this checkpoint's reviewed scope.** This permits integration review, not marking the entire plan or financial service complete. Mandatory Claude cross-review and actual connected preview validation remain open.

## Sources read

- AGENTS.md and DESIGN.md in full; owner authorization/task scope inherited.
- Migration `202610310004_payment_attempts.sql` in full: attempt table/RLS, triggers, failure RPC, replaced success RPC and grants.
- Migration `202610310005_quote_acceptance_version.sql` in full: exact-version wrapper, private renamed helper and public signature.
- `app/api/payments/checkout/route.ts`, `webhook/route.ts`, `status/route.ts`; `app/api/interventions/[id]/actions/route.ts`; `lib/payment-events.ts`; `tests/payment-events.test.ts`; affected SQL harness sections and contracts/verification report.
- Prior schema/commands in migration001, especially quote partial unique index line62 and action transaction lines199–245; migration002 approval trigger lines82–94; migration003 guarded wrapper and helper revocations.
- Official Stripe [event types](https://docs.stripe.com/api/events/types) and [Checkout Session object](https://docs.stripe.com/api/checkout/sessions/object), to confirm resource/type and state contract. No external credential/service mutation performed.

## Concrete review evidence

### Exact consent

- actions route lines39–42 requires quote_id for accept_quote and rejects using it for another action; lines55–60 passes the shown ID into SQL.
- migration005 lines8–18 locks intervention, checks decision rights and quoted state, then locks the provided active sent quote belonging to that same intervention before delegating.
- Initial `quotes_active_one` index ensures only one sent/accepted quote per intervention. Therefore the delegated existing selection cannot silently choose another sent version after this exact check; intervention locking also serializes send_quote/accept_quote.
- migration005 lines3–4 renames/revokes the old four-argument helper; lines21–22 grants only the new five-argument public function. Earlier base helper remains revoked. No public four-argument overload remains.
- Existing guard_quote_approval trigger still runs when status becomes accepted; wrapper does not disable or bypass approval.

### Payment state and privacy

- Webhook lines18–30 verifies raw body signature before classification or SQL mutation. Resource classifier limits to Checkout payment sessions; unrelated/subscription/setup events are ignored.
- Migration004 lines43–70: failure mutation is service-role only; validates event/session/quote/amount/currency, locks quote then payment and attempt, inserts dedup event transactionally, and does not downgrade paid or change a replacement attempt.
- Migration004 lines71–95: success checks exact current session and immutable quote amount/currency and completed job; distinct success events for an already-paid session are recorded without repeating audit/business mutation.
- Migration004 lines23–41 guards settled payment replacement and tracks attempt history; application accounts have SELECT under dossier RLS and no attempt mutation grant.
- Checkout retry retrieves Stripe terminal state before replacing a session; open is reused, complete/unconfirmed is blocked, only expired may be replaced. Conditional session/status update and idempotency key prevent silently overwriting a paid/current different session. No compensating expiration of a shared new session exists.
- Status route lines6–17 resolves quote under user RLS before returning scoped payment/attempt fields; session URL, card data and secrets are not part of this response; history cap/count is explicit.

## Verification run independently

1. `PGLITE_MODULE=/tmp/courant-pglite-review/node_modules/@electric-sql/pglite/dist/index.js node /tmp/depannage-review-4ae3bd1/tests/sql-review.mjs`: **22 PASS groups** on exact exported checkpoint. Covers missing/superseded/foreign quote IDs and helper bypass, B2B approvals, service-only failure, late/replayed failure, no paid downgrade, replaced attempt isolation and exact one settlement effect.
2. Existing tsx executable invoked against exported `tests/payment-events.test.ts`: **3 tests passed**, zero failure. Active checkout dependencies/build untouched.
3. Additional reviewer-only probes appended to the temporary export (not repository): authenticated AND anon denied legacy base/checked helpers, success and failure service RPCs; absence of public four-argument overload confirmed with to_regprocedure; authenticated execution granted on new five-argument signature; direct payment_attempts UPDATE rejected. **All passed.** An initial quoting syntax error in this temporary reviewer probe was corrected before the successful run; this was not an application failure.

## Open limits / requirements before full delivery

- No fresh full build run by this reviewer; implementation agent's reported fullcheck is separate evidence. No online account/Stripe transaction, true concurrent DB sessions, webhook network delivery or Supabase Storage service test was possible in this review.
- PGlite uses explicit Auth/Storage stubs; passing this harness is not live Supabase proof or a concurrency stress test.
- Claude must send the exact displayed quote_id, not pick a newer quote at click time; old frontend accept calls without ID will now correctly fail. Combined UI integration remains mandatory.
- Refund/dispute/payout accounting, legal/fiscal invoice rules, delegated B2B payer and unsettled asynchronous-payment assistance remain outside these checkpoints and must not be marked delivered.
- Genuine cross-provider Claude review remains outstanding. This report is independent Codex verification of a bounded checkpoint, not its substitute.

Confidence: high for source/grants/transaction paths and exact-SHA harness results; bounded for actual Stripe event behavior, real concurrency and cloud integration until corresponding tests run.
