# Independent hosted Auth SSR and recovery browser check

Mission WEB-PWA-20261030; explicitly authorized by pilot. Integration SHA0017b48a7a12d918d5c3c759f8da94d1971df727; unique preview https://depannage-electricite-1ng8kugh5-brafas-projects.vercel.app ; dedicated project kcpyjzndybfdlnhvscbs only.

## Method and scope

Read app/auth/confirm/route.ts, reset-password/page.tsx, lib/supabase/client.ts and installed auth-js GenerateLinkParams types. Official generateLink and verifyOtp documentation consulted:
- https://supabase.com/docs/reference/javascript/auth-admin-generatelink
- https://supabase.com/docs/reference/javascript/auth-verifyotp

Supabase JS2.118.0 installed only in /tmp/depannage-web-pwa-qa. Private service/anon keys read from existing0600 task file without logging values. One tracked temporary client account generated per attempt using admin.generateLink(signup), with a new unique reserved-domain email and random password. No email transport invoked. Generated hashed tokens passed only to actual /auth/confirm routes in isolated browser; token/password/credential values redacted from all errors and never written to report/HAR. Existing Vercel cookie bootstrapped once, automation headers then cleared.

First diagnostic attempt had three harness errors, not application findings: final client URL intentionally removes ?auth= after handling, and Next route announcer adds another role=alert. Runner now observes actual /auth/confirm redirect response and scopes the expired-error alert. Its temporary account was deleted and Auth/profile absence verified before rerun. The second attempt uses another unique user and generates signup hash once.

## Results

**12/12 checks PASS;3/3 final cleanup checks PASS; zero page errors.**

1. Admin generates tracked signup hash; no email sent.
2. Actual SSR /auth/confirm consumes hash, sends browser cookies, and /api/workspace returns200 with exact temporary client identity and private/no-store.
3. Main application renders the real authenticated client without demo banner.
4. Separate fresh browser has no app session and workspace returns401.
5. Reused confirmation hash redirects to recoverable auth=expired; separate browser stays401.
6. Invalid hash redirects to auth=expired; no false success.
7. Admin generates recovery hash for same tracked user; no email sent.
8. Actual recovery /auth/confirm redirects to /auth/reset-password and authorized reset form appears.
9. Mismatched password confirmation remains rejected with visible error.
10. Browser form successfully changes tracked account password; success screenshot captured.
11. Previous password rejected; new password authenticates only tracked user through Auth SDK, then SDK session signed out.
12. Unauthenticated reset page displays expired-state guidance and hides password inputs.

Cleanup: delete temporary user ccc6c13c-9b80-4390-bf69-6bf4472156e3; confirm Auth user absent; confirm profiles cascade row absent. First harness-diagnostic user5bbbfaa7-7a50-439d-b6b4-70d134794100 was also deleted with same absence checks. No other account or service modified.

Evidence: 0017b48a7a12/auth-ssr/result.json ; recovery-success.png visually opened; harness-diagnostics.json preserves initial attempt including its successful cleanup. Script auth-ssr-smoke.mjs contains no embedded key/password/token values.

## Limits

- This verifies hosted Auth/SSR confirmation and recovery route behavior and browser password form. It does NOT verify real email delivery or clicking an actually received message; admin.generateLink does not send email.
- Known UI-REV001 explicit login controller bug remains outside this closure; successful SSR confirmation initialization is not proof the sign-in button flow is fixed.
- No artisan/enterprise/admin live-role journey, multi-organization permission test or Storage test in this report; separate cloudQA scope applies.
- No Stripe transaction, payout, production release or OS/mobile PWA install.
- App reset main has no id=main while global skip link targets it (pre-existing accessibility item); recovery functionality passes, but full keyboard/accessibility certification is not claimed.
- All application files remained read-only for this verifier.
