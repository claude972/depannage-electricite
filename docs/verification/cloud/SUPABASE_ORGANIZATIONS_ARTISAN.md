# Hosted professional permissions QA

Final result: 30/30 functional checks PASS. Initial cleanup FK failure corrected; 14 recovery/readback checks PASS, no tracked QA resources remain.

UTC 2026-10-31T02:55:34.503Z
Dedicated project kcpyjzndybfdlnhvscbs, schema migrations001–009 (provisioned from integration1e2eaed). Real Auth/PostgREST/Storage. All data explicitly temporary synthetic QA, no email sent, no Stripe, no schema/policy edits. A tracked QA operator alone was temporarily granted platform admin via service-role to exercise operator approval/suspension. Synthetic QA dossier is not proof of legal qualification.

| Check | Result | Detail |
| --- | --- | --- |
| Temporary operator role scoped to tracked QA identity | PASS |  |
| Selected invitation returns selected scope without bearer secret | PASS |  |
| Wrong verified email cannot accept invitation | PASS |  |
| Invitation acceptance applies selected grant atomically | PASS |  |
| Accepted invitation replay rejected | PASS |  |
| Selected member sees only granted site | PASS |  |
| Selected member sees only granted-site job | PASS |  |
| Selected member sees only granted-site document | PASS |  |
| Granted-site Storage signing succeeds | PASS |  |
| Excluded-site Storage signing denied | PASS |  |
| Selected manager can write granted site | PASS |  |
| Selected manager cannot write excluded site | PASS |  |
| Viewer downgrade denies retained write grant | PASS |  |
| Viewer downgrade preserves permitted site read | PASS |  |
| Viewer cannot grant itself site access | PASS |  |
| Removed member sees no former sites | PASS |  |
| Removed member sees no former jobs | PASS |  |
| Removed member sees no former document metadata | PASS |  |
| Removed member cannot request new signed URL | PASS |  |
| Removed member cannot read organization overview | PASS |  |
| Unapproved artisan cannot accept mission | PASS |  |
| Approved QA artisan receives eligible anonymized offer | PASS |  |
| Approved eligible artisan accepts mission | PASS |  |
| Repeated operator suspension remains suspended/unavailable | PASS |  |
| Suspended artisan cannot edit dossier to reactivate | PASS |  |
| Suspended artisan cannot resubmit application | PASS |  |
| Suspended artisan cannot restore availability | PASS |  |
| Suspended artisan cannot self-approve | PASS |  |
| Suspension denials preserve unapproved account | PASS |  |
| Suspended artisan receives no eligible offers | PASS |  |

## Cleanup

- Remove QA Storage objects: PASS
- Remove QA documents: PASS
- Remove QA job audit: PASS
- Remove QA jobs: PASS
- Remove QA sites: PASS
- Remove QA membership events: PASS
- Remove QA invitations: PASS
- Remove QA organizations: FAIL (23503)
- Remove QA actor audit: PASS
- Remove QA Auth user: FAIL (500)
- Remove QA actor audit: PASS
- Remove QA Auth user: FAIL (500)
- Remove QA actor audit: PASS
- Remove QA Auth user: PASS
- Remove QA actor audit: PASS
- Remove QA Auth user: PASS

## Limits
No browser UI, mail delivery, Stripe, real concurrency, legal dossier authenticity, complete business lifecycle, or mobile testing. Revocation checks concern subsequent requests; previously issued signed URLs retain their TTL, previously viewed bytes cannot be revoked. Only tracked resources removed.

## Cleanup correction and readback

Initial org deletion was blocked by the professional_audit row emitted by the allowed budget RPC. Deleted only professional_audit rows matching the tracked QA organization, then removed organization and retried remaining QA Auth identities. No schema change.

- Retry cleanup professional_audit: PASS
- Retry cleanup organizations: PASS
- Retry QA Auth user cleanup: PASS
- Retry QA Auth user cleanup: PASS
- No remaining tracked profiles: PASS
- No remaining tracked organizations: PASS
- No remaining tracked sites: PASS
- No remaining tracked interventions: PASS
- No remaining tracked documents: PASS
- QA Auth identity absent: PASS
- QA Auth identity absent: PASS
- QA Auth identity absent: PASS
- QA Auth identity absent: PASS
- QA Storage prefix empty: PASS
