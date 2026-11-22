# Independent real-browser login and administrator API provider review

Mission WEB-PWA-20261030. Reviewer: Codex verify_web_pwa. No repository application edits, no library installation for this follow-up, no production or Stripe operation.

## Exact target

- Integration fe4c9c984e997675a7421100c89c7ddbff195065.
- Unique Vercel Preview https://depannage-electricite-ia1k2f0d6-brafas-projects.vercel.app .
- Vercel deployment metadata independently confirmed READY, exact githubCommitSha and integration/web-pwa ref before testing. Older preview was not used for new API.
- Contains login correction2e3 and new admin interventions API d85, according to integration history/mission; read actual route at exact integration.
- Dedicated Supabase kcpyjzndybfdlnhvscbs only. Existing private0600 keys/access files read without emitting values. Existing Vercel authorization cookie bootstrapped once, then automation headers cleared in isolated browser.

## Fixtures and containment

Three uniquely named temporary confirmed QA accounts created using admin.createUser, without email: clients A/B and synthetic administrator. Only the synthetic admin's newly created profile was elevated via service role; no existing profile/role/settings changed.

120 explicit tracked intervention UUIDs inserted by service for client A only:117 rows bearing unique literal search/city marker, plus3 tracked decoys with a different marker. Some timestamps intentionally tied in groups of three, statuses requested/cancelled and categories outage/panel. No quote, payment, organization, email or storage object created. IDs persisted in0600 fixtures.json for recovery/cleanup; no passwords/tokens in that registry.

Administrator browser used actual password Auth through public form, but all automatic app API reads except /api/admin/interventions were blocked by test routing to avoid unfiltered workspace/overview retrieval. Only explicitly q-filtered fixture API/detail requests were permitted; every returned list row was asserted against tracked IDs. Thus no adminUI/global-list completion claim.

## Results

**19/19 actual browser/provider checks PASS;10/10 cleanup/readback controls PASS; zero page errors.**

### Normal client UI, not SDK-only proof

1. Client A logs in through normal public password form and enters live client interface. API session identity equals A, profile form contains exact A name, no demo banner. Workspace's old100-row window excludes oldest fixture as expected.
2. Client A cannot read administrator endpoint:403/private-no-store.
3. Actual visible logout control returns workspace401.
4. Client B logs in through same normal UI/browser after A logout; API identity/profile name equal B, zero interventions, no A name or unique fixture marker displayed.
5. Separate fresh unauthenticated browser receives401/private-no-store from admin endpoint.

This independently verifies UI-REV001's normal client sign-in/logout/switch-identity correction at this exact SHA. It does not close the separately tracked stale public draft issue or every possible delayed-response race.

### Administrator API against actual provider

6. Synthetic administrator gets valid browser Auth cookie; first q-filtered API request200 returns exact117-row total; automatic global reads remain blocked.
7. q pagination returns117 unique rows over three40-row pages (40/40/37), consistent total117, exact expected created_at DESC/id DESC order including timestamp ties, no repeated/foreign/decoy row.
8. q AND status=requested with cursor returns59 rows over three25-row pages, total59 on each, exact order and no decoy/unrequested row.
9. q whitespace normalization plus category=outage yields exact30 rows.
10. Oldest fixture, absent from old100-row client workspace window, is retrieved by administrator detail ID200 with expected description and zero quotes.
11. Uppercase UUID q normalized to exactly one expected fixture.
12. Unique absent q returns0 rows/total, null next cursor.
13. Malformed cursor returns422/private-no-store.
14. Reusing cursor with changed q filters returns422/private-no-store.
15. Unsupported limit101 returns422/private-no-store.
16. Wildcard/filter-expression injection attempt in q returns422/private-no-store.
17. Mixing detail id and list filters returns422/private-no-store.

The remaining two checks establish fixture prerequisites (3 isolated accounts, exactly120 inserted tracked jobs). Nineteen checks total are recorded individually in result.json; counts above separate five client checks and twelve admin-session/API checks from two prerequisites.

## Cleanup and readback

- Delete audit rows only for tracked intervention IDs or QA actor IDs.
- Delete only120 explicitly tracked intervention IDs.
- Delete each of3 temporary Auth users and independently verify each is absent.
- Read back tracked job IDs, all3 profiles and QA actor audit records: absent.
- Separate provider readback for audit entries by all120 intervention IDs:0.

Ten cleanup controls all pass. No pre-existing row or setting changed or deleted. The fixture registry contains only run marker/UUIDs, not credentials.

## Evidence

- fe4c9c984e99/auth-admin/result.json —19 successful checks,10 cleanup controls and zero page errors.
- fe4c9c984e99/auth-admin/fixtures.json — scoped IDs for cleanup audit,0600.
- client-a-live-profile.png and client-b-live-profile.png — screenshots after successful normal UI login, no password/hash/token content; B screenshot visually opened.
- Runner auth-admin-smoke.mjs and independent readback-admin-cleanup.mjs under task temp directory only.

## Remaining limits

- Administrator UI was not evaluated for integration of new pagination API: only actual authorized endpoint/provider behavior tested. No claim that all Super Admin menus/actions are complete.
- Stale public draft/UI-REV002 and VIS-001 remain separately assigned; this run does not exercise or close them.
- No normal browser signup with actual email receipt, artisan/organization live journey, Stripe checkout/webhook/payout, actual-device PWA installation or production release.
- Synthetic admin's expected blocked automatic fetches are test setup, not an application failure. This runner records page errors, not a blanket zero-console assertion for the intentionally blocked admin workspace.
- No secrets, tokens, passwords, raw credential-bearing URLs or HAR in outputs.
