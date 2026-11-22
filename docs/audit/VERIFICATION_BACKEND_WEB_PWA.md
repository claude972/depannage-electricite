# Independent Codex review — backend checkpoint 1

Mission WEB-PWA-20261030. Reviewed exact pushed revision **0a014063a6f2ca4fa323d627554bdfb5ffcd9c11**, branch `codex/web-pwa-backend`. Reviewer: Codex PWA agent, reviewing backend changes only, excluding own PWA commit cf52bcd. No repository edits or fixes made during this review.

## Outcome

**No new actionable blocking finding in this checkpoint’s reviewed scope.** This is bounded local code/SQL verification, not Claude cross-verification or production readiness. Known missing capabilities and commercial/infrastructure blockers in CODEX_BACKEND_VERIFICATION.md remain open.

## Scope and evidence

- Migration 003 read fully, including prior initial/professional functions it wraps: `can_access_intervention`/`owns_intervention` (003:6–14) remove independent creator access for site-based dossiers; document metadata and Storage policies (15–20) follow current dossier access.
- Artisan state and approval functions (003:76–131), eligibility and command wrapper (133–156), participant projection/refusal (158–174), exact quote rejection/appointment/travel/report/dispatch (175–244), admin overview, operation-history trigger and EXECUTE revokes/grants (246–280), review/warranty replacements (281–300) reviewed for SQL authorization, null/constraint boundaries and retained actor checks.
- Legacy mutation function is renamed and not callable by public/anon/authenticated; guarded wrapper preserves base row lock, actor, amount and transition checks. mission_eligible helper is not publicly executable. RLS/EXECUTE protections are enforced in SQL, not only API menus.
- New artisan/operations/admin route schemas, authenticatedClient/assertOrigin, workspace additive fields and published contracts read. No new contract promised for missing membership/invoices/refunds. Prior Checkout creator-only rule remains explicitly documented rather than silently broadened.
- Appointment/report updates preserve prior versions in an append-only table; report checks validate individual JSON object shape and allowed values. Reassignment before quote acceptance rejects pending quotes and removes old artisan’s dossier access. Admin counts/financial sums operate on full SQL scope; returned lists explicitly bounded to 100.
- CI adds separate pinned PGlite job labelled Auth/Storage stubs; it does not claim live Supabase validation. Push trigger remains main and pull_request; branch-only pushes will need a PR/preview pipeline for online checks.

## Checks actually executed

1. Exported migrations and SQL harness from exact SHA with `git show` to `/tmp/depannage-review-0a01406`, avoiding mutation of the implementation checkout.
2. `PGLITE_MODULE=/tmp/depannage-web-pwa-sql/node_modules/@electric-sql/pglite/dist/index.js node /tmp/depannage-review-0a01406/tests/sql-review.mjs`: all **19 PASS groups** completed at reviewed SHA.
3. Added temporary review probes only in that exported copy, reran successfully: authenticated client cannot call mission_eligible helper or mutate/submit artisan state; former assigned artisan cannot send a new quote; null report signature rejected at SQL boundary; old artisan cannot read a dossier-linked document despite being its uploader/owner; after reassignment new artisan can read it. Same old/new authorization tested against storage.objects under explicit local stub permissions. All passed.

## Remaining limits / next review

- No real Supabase Auth/Storage request, signed URL revocation test, true two-session race, browser, Stripe or Vercel integration executed. Previously issued signed links have their existing short expiry; SQL RLS tests do not prove revocation of an already issued bearer URL.
- No broader feature completion inferred: original accept_quote action still lacks a browser-supplied quote-version identity, delegated payers/teams/site-role APIs, finance lifecycle, immutable commercial documents, regulatory qualification, and advanced calendar/SLA are not delivered here. These are known future-plan scope, not claimed successes.
- Approval/availability/suspension policy is a stated initial technical policy; commercial treatment of suspended work remains unresolved. Missing mandatory credential rules are not automatically satisfied by submitted status or a declaration.
- Parent must publish this review evidence in shared CORRECTIONS.md. Mandatory Claude review at exact SHA and combined online preview remain required before done.
