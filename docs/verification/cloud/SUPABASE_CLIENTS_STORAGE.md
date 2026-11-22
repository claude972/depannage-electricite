# Supabase cloud verification

UTC 2026-10-31T02:54:18.989Z

Dedicated project: depannage-web-pwa (kcpyjzndybfdlnhvscbs). Expected schema: integration 1e2eaed, migrations001–009 already provisioned by pilot. Real hosted Auth, PostgREST and Storage endpoints; no local stubs. No schema/policy edits.

| Check | Result | Detail |
| --- | --- | --- |
| Hosted Auth password login a | PASS |  |
| Hosted Auth password login b | PASS |  |
| Auth trigger ignores requested admin role | PASS |  |
| Cross-client profile read filtered | PASS |  |
| Direct role escalation rejected | PASS |  |
| Role remains client | PASS |  |
| Intervention creation derives authenticated owner a | PASS |  |
| Intervention creation derives authenticated owner b | PASS |  |
| Own intervention readable | PASS |  |
| Cross-client intervention read filtered | PASS |  |
| Anonymous intervention table denied | PASS |  |
| Cross-client cancel rejected | PASS |  |
| Denied cancel preserves requested status | PASS |  |
| Direct status/payment spoof rejected | PASS |  |
| Storage bucket private and 4MiB cap | PASS |  |
| Own document metadata readable | PASS |  |
| Cross-client document metadata filtered | PASS |  |
| Owner may request short-lived Storage signed URL | PASS |  |
| Other client cannot sign private object | PASS |  |
| Anonymous cannot download private object | PASS |  |
| Public Storage endpoint cannot serve private object | PASS |  |
| Anonymous mutating RPC denied | PASS |  |

## Cleanup

- Remove QA objects: PASS
- Remove QA metadata: PASS
- Remove QA audit rows: PASS
- Remove QA intervention rows: PASS
- Remove actor QA audit rows: PASS
- Delete QA Auth user: PASS
- Remove actor QA audit rows: PASS
- Delete QA Auth user: PASS

## Limits

This is bounded client isolation/Auth/Storage smoke verification. No Stripe account/payment, real email delivery, browser UI, organization site scopes, artisan workflow, concurrency or mobile installation tested. Admin-created confirmed QA users exercise login; this does not prove public signup/confirmation mail. Signed URLs and access tokens were never printed or committed. Only explicitly tracked temporary QA users/jobs/documents were removed.

## Independent post-cleanup readback

- No remaining tracked profiles: PASS
- No remaining tracked interventions: PASS
- No remaining tracked documents: PASS
- No remaining tracked Storage objects: PASS
- QA Auth identity removed: PASS
- QA Auth identity removed: PASS
