# Enterprise approvals reads (ENT-12)

Leaf for `GET /api/enterprise/approvals` (paginated, organization + optional site + status filter,
created_at DESC then UUID DESC) and `GET /api/enterprise/approvals/<id>` (row + site rule, `rule:null`
= no rule proven). Contract `docs/ENTERPRISE_APPROVALS_BACKEND.md` (codex/enterprise-approvals),
mirrored strictly. State bound at render to identity + organization + site (+ filter / id); late
replies dropped; 401/403/404 ⇒ cleared + inaccessible; 422 on a next page ⇒ page 1. Used only by
`ApprovalsView` / `ApprovalDetail` (live); demo makes zero calls. No decision right here: the
existing decision action and its gates are unchanged.
