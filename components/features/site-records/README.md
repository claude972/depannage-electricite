# Site sheet records (SYS-07 / ENT-04 / ENT-10)

Leaf for `GET /api/sites/<id>/records?kind=open|past|upcoming|completed|audits[&cursor]` (contract
`docs/SITE_RECORDS_BACKEND.md`, codex/site-records). Strict parser (exact keys, `limit: 50`,
`has_more ⇔ next_cursor`, this site only, each kind's own filter, unique ids); controller per identity
bound to site + kind (kind switch ⇒ page 1, no mixing), « Afficher plus » with dedupe, late replies
dropped, 401/403/404 honest. Used only by the live `SiteSheet` (interventions open/past, due dates
upcoming/completed, audits); demo makes zero calls. Rights for actions stay with `canWriteSite`.
