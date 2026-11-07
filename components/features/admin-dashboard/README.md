# Admin dashboard snapshot (ADM-01)

Strict mirror of `lib/features/admin-dashboard/handler.ts` (`model.ts`). `useAdminDashboard` reads
`GET /api/admin/dashboard` in live mode; the admin overview shows its three counts and its bounded
active / pending lists only for the current role + identity, « Non vérifié » otherwise, never
« aucune … » while unread or when the count exceeds the bounded array. `account_created_at` is
labelled as the account date. Finance totals are untouched. Demo: unchanged, zero calls.
