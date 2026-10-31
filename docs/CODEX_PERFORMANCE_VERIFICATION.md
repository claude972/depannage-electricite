# WEB-PWA-20261030 — artisan performance and appointment read model

Status: scoped implementation reviewed and approved by the pilot for commit; Claude integration/cross-review and connected preview remain pending. Branch `codex/web-pwa-backend`. No provider configuration, deployment or remote database changes performed by this scoped agent.

## Short implementation plan and scope

1. Publish an exact additive contract before implementation (done in `b1ba515`, `docs/WEB_PWA_PERFORMANCE_CONTRACT.md`).
2. Add an artisan-owned SQL aggregate independent of workspace windows, strict read API, and latest-appointment projection for loaded authorized dossiers.
3. Verify interval math, role isolation and >100-record totals under isolated PostgreSQL; route validation and explicit unavailable service handling; add the isolated CI step.
4. Pilot review/commit/push, Claude integration/cross-review and online validation remain required. All coding transfers to Claude at midnight per the owner's amendment.

## Delivered files and semantics

- `supabase/migrations/202610310007_artisan_read_models.sql`: `artisan_performance(timestamptz,timestamptz,timestamptz,timestamptz)` is executable only by authenticated accounts and requires the actual caller's profile role artisan. No target id exists. Every aggregate uses this actor id, including quote artisan and assigned intervention artisan; no customer identity/contact is returned. Empty search_path and explicit public/auth qualification preserve the existing security-definer pattern.
- Complete-scope paid service **TTC**, payment count and completed mission count for current/previous half-open intervals; all-time review average/count, growth null when previous sum is zero, and punctuality null. It never labels service TTC as artisan net, transfer or bank payout. Monetary/count JSON totals beyond safe integer range are rejected. The basis strings expose calculation meaning rather than fictitious metrics.
- `app/api/artisan/performance/route.ts`: GET only, four required ISO instant parameters with offsets, strict unknown/duplicate query rejection, contiguous positive intervals of at most32 elapsed days each. Client calendar boundaries are explicit instants; no global timezone is invented. The SQL repeats validation so direct RPC cannot bypass API checks. Private/no-store successful response.
- `app/api/workspace/route.ts`: additive `appointments`, `appointments_limit:200`, `appointments_limited`. Only intervention ids already loaded under this account are queried; unassigned anonymized offers do not gain notes, dates or addresses. Existing appointment RLS remains in force. This is a saved appointment, not confirmed scheduling, GPS/ETA or recurring availability.
- `tests/sql-performance-review.mjs`: independent pinned PGlite harness, loading all versioned migrations and explicit Auth/Storage stubs. It uses real application RLS and roles but is **not live Supabase**.
- `tests/artisan-performance.test.ts`: direct Route Handler input/error tests, with service variables isolated/restored for the explicit503 case; no actual credentials or network use.
- `.github/workflows/check.yml`: after the existing isolatedSQL job's harness, run the standalone performance harness using the same external pinned runtime. No app dependency was added.

## Checks actually run

- Standalone SQL harness: **6 PASS groups**, including migration execution, anonymous/non-artisan/target-other-artisan refusal,130+ current paid records to exceed workspace windows, period boundary exclusion, pending/failed payments excluded from paid sums, completed-but-unpaid missions counted separately, two-artisan isolation, all-time review average, empty data/null denominator, null/nonfinite/reversed/oversized/disconnected date rejection, unequal calendar-month lengths, and appointment RLS.
- `tsx --test tests/artisan-performance.test.ts`: **2 tests passed**, including nine invalid query shapes and three valid but unconfigured backend cases. Unknown user_id and duplicate parameters cannot select another artisan.
- `npm run typecheck`: passed after implementation and direct route tests.
- `node --check tests/sql-performance-review.mjs` and scoped `git diff --check`: passed.
- Combined `npm run check` executed by the organization implementation agent after these files were present: **30 tests + typecheck + build passed**; separate from this agent’s targeted executions above. The main SQL harness also passed26 groups. No concurrent `.next` build was started by this agent.

## Sources and compatibility

Read AGENTS.md, DESIGN.md, CLAUDE.md, current plan/blueprint/decisions, remote mission and correction files before claiming this scope; read actual schema/permissions, workspace, authenticatedClient, validation, payments/reviews/appointment tables and existing isolated harness/CI. This uses existing typed Next Route Handler, Zod, Supabase `.rpc`/query and PostgreSQL aggregate patterns; no new provider SDK or imagined API is introduced. The organization agent owns migration006 and main SQL harness, while this agent owns007 and its standalone test/contract. Its Auth email stubs are mirrored explicitly for migration compatibility.

## Still open

- The dedicated Supabase project remains blocked by organization billing; no actual Auth/RLS/Storage roundtrip, live API aggregate, Stripe or cloud concurrency is claimed.
- Claude must consume this endpoint for global dashboard figures; the old local loaded-window sums must not be renamed global metrics. UI timezone/period labels must match the sent boundaries.
- Workspace appointments cover only the currently loaded dossier window; no complete planning/history pagination is claimed.
- Punctuality, net payouts, financial accounting, regulatory qualifications and all-time SLA are not provided by these aggregates. This checkpoint alone does not complete ART-10 or the entire plan.
- Pilot source review and independent SQL review passed before commit approval. Claude mandatory cross-review, pushed checkpoint integration and Vercel Preview verification remain pending until recorded by the pilot.
