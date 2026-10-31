# Real hosted concurrency QA

UTC 2026-10-31T03:00:50.425Z
Dedicated Supabase project kcpyjzndybfdlnhvscbs; migrations001–009. Real authenticated PostgREST HTTP requests sent concurrently with Promise.all. Four temporary synthetic QA users. Approved artisan fixture fields set by service-role only for the two tracked QA identities; not an operator approval or legal qualification test. No schema changes, no email, no Stripe.

## Functional checks

19/19 passed.

| Check | Result | Detail |
| --- | --- | --- |
| artisan1 initially eligible | PASS |  |
| artisan2 initially eligible | PASS |  |
| Exactly one simultaneous claim succeeds | PASS |  |
| Exactly one simultaneous claim fails | PASS |  |
| Stored assignment has single winning artisan | PASS |  |
| Winner retains authorized private job | PASS |  |
| Loser cannot read private job | PASS |  |
| Loser cannot read document metadata | PASS |  |
| Loser cannot request private Storage URL | PASS |  |
| Loser cannot request participant contacts | PASS |  |
| Winner may retrieve assigned participant contacts | PASS |  |
| artisan1 no longer offered assigned mission | PASS |  |
| artisan2 no longer offered assigned mission | PASS |  |
| Exactly one concurrent invitation accept succeeds | PASS |  |
| Exactly one concurrent invitation accept fails | PASS |  |
| Single recipient membership stored | PASS |  |
| Single invitation acceptance event stored | PASS |  |
| Invitation consumed by correct recipient | PASS |  |
| Successful concurrent accept retains selected-site grant | PASS |  |

## Sanitized race responses

```json
[
  {
    "label": "Two artisan claim requests via Promise.all",
    "elapsed_ms": 261,
    "responses": [
      {
        "actor": "artisan1",
        "success": true,
        "error_code": null,
        "status": 200
      },
      {
        "actor": "artisan2",
        "success": false,
        "error_code": "42501",
        "status": 403
      }
    ]
  },
  {
    "label": "Same recipient invitation accepts via Promise.all",
    "elapsed_ms": 198,
    "responses": [
      {
        "success": true,
        "error_code": null,
        "status": 200
      },
      {
        "success": false,
        "error_code": "P0001",
        "status": 400
      }
    ]
  }
]
```

## Cleanup

- Remove QA Storage objects: PASS
- Remove QA documents: PASS
- Remove QA job audit: PASS
- Remove QA jobs: PASS
- Remove QA sites: PASS
- Remove tracked QA professional_audit: PASS
- Remove tracked QA organization_membership_events: PASS
- Remove tracked QA organization_invitations: PASS
- Remove QA organizations: PASS
- Remove QA actor audit: PASS
- Remove QA Auth user: PASS
- Remove QA actor audit: PASS
- Remove QA Auth user: PASS
- Remove QA actor audit: PASS
- Remove QA Auth user: PASS
- Remove QA actor audit: PASS
- Remove QA Auth user: PASS

## Cleanup readback

- No tracked profiles: PASS
- No tracked organizations: PASS
- No tracked sites: PASS
- No tracked interventions: PASS
- No tracked documents: PASS
- QA Auth identity absent: PASS
- QA Auth identity absent: PASS
- QA Auth identity absent: PASS
- QA Auth identity absent: PASS
- QA Storage prefix empty: PASS

## Limits
Concurrent client requests demonstrate bounded production-hosted locking behavior for these two scenarios. This is not a load/stress test or guarantee for every interleaving. No browser, payments, email delivery, native mobile or long-lived signed URL revocation tested. Only tracked temporary QA records removed; public project settings unchanged.
