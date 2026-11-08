# Recipient quotes (CLI-08 / ENT-12)

Leaf for `GET /api/quotes` (current client's quotes, paginated, status filter) and
`GET /api/quotes/<id>` (exact quote: client owner, or manager with `organization_id` [+ `site_id`]).
Contract `docs/RECIPIENT_QUOTES_BACKEND.md` (codex/recipient-quotes), mirrored strictly. `is_current`
is information only: action guards are unchanged and an old / superseded quote stays read-only.
State bound at render to identity (+ organization + site) + quote / filter; late replies dropped;
401/403/404 ⇒ cleared + inaccessible; 422 on a next page ⇒ page 1. Demo makes zero calls.
