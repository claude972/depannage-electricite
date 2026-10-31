# Artisan read-model contract — implementation checkpoint in progress

Mission WEB-PWA-20261030, scoped Codex read models. This document defines the next additive contract before code. It is not yet active on preview or Supabase.

## GET /api/artisan/performance

Authentication required; **current artisan only**, role derived from server session. There is no user_id/target argument. Query keys are strict, each required ISO date-time with timezone:

- `current_start`, `current_end`
- `previous_start`, `previous_end`

Intervals are half-open `[start,end)`, positive and at most 32 elapsed days each; `previous_end` must equal `current_start`. The browser chooses calendar boundaries in its explicitly displayed timezone, then sends ISO instants. No product-wide timezone or a particular calendar month is invented. Unknown/duplicate query keys and invalid bounds return422; non-artisan/anonymous access is rejected.

Response:

```ts
{
  period: {current_start:string,current_end:string,previous_start:string,previous_end:string,boundary:"inclusive_start_exclusive_end"},
  current: {paid_service_cents:number,paid_count:number,completed_missions_count:number},
  previous: {paid_service_cents:number,paid_count:number,completed_missions_count:number},
  rating: {average:number|null,count:number,period:"all_time"},
  growth_percent:number|null,
  punctuality_rate:null,
  currency:"eur",
  scope:"all_current_artisan_records",
  limited:false,
  basis: {revenue:string,completed:string,rating:string,growth:string,punctuality:string}
}
```

`paid_service_cents` sums payments **status paid**, linked through quotes to interventions currently assigned to this artisan, filtered by **payment.paid_at**. It is paid service TTC, **not net artisan earnings, fees, transfers or bank payouts**. Completed missions count statuses completed/paid with completed_at within the interval. Ratings are all reviews on this artisan's interventions, not an invented period rating. Growth is `(current-previous)/previous*100`, rounded to one decimal; **null when previous amount is zero**. Punctuality is null because an agreed measured arrival/deadline definition is absent. Aggregates are calculated in SQL over the complete authorized scope, not the loaded workspace windows. Empty data returns zero counts/amounts and null rating/growth.

Private/no-store response. Monetary sums beyond safe JSON integer range are rejected explicitly instead of silently rounding.

## Additive GET /api/workspace appointments

Existing response remains compatible and adds:

- `appointments`: `{intervention_id,starts_at,ends_at,note,updated_by,updated_at}[]`, only for **interventions actually loaded by this authorized workspace** (not unassigned anonymized offers), under the existing appointment RLS.
- `appointments_limit: 200`
- `appointments_limited: boolean`

This is the latest saved appointment, not automatic confirmation, recurring availability, GPS/ETA or a punctuality metric. Empty/no authorized appointments returns `[]`. Times are actual stored dates, never inferred from dossier creation date. Backend services are still unavailable until the dedicated Supabase project can be provisioned.

## Planned verification

Standalone isolated PostgreSQL harness with explicit Auth/Storage stubs: role/anonymous isolation, second artisan isolation, interval edges, unequal calendar-month lengths, >100 paid records to defeat workspace-window truncation, unpaid/rejected/out-of-period exclusions, zero previous denominator, average rating and privacy. CI labels stubs clearly; this does not claim actual Supabase/Stripe integration.
