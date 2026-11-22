# Admin reassign picker (ADM-03)

In live mode, the « Réaffectation » panel of the admin dossier picks the new artisan from GET `/api/admin/directory?kind=artisans&approved=true`, through the existing `session.loadAdminDirectory`. It does not use the 100-row overview. Demo mode keeps the previous `<select>`.

- **Search:** `q` follows the route's rule (2–80 characters; letters, digits, spaces, hyphens, apostrophes). An invalid query is never sent. A new search clears the current choice.
- **Paging:** « Afficher plus » follows the opaque `next_cursor`. Rows are deduplicated by id. Only accounts that are approved and whose artisan dossier is approved are offered.
- **Display:** the picker keeps only a minimal projection (id, name, company).
- **Render fence:** state is shown only under its identity (uid|generation), dossier and query. Late replies are dropped.
- **States:** loading, empty, and error with « Réessayer ».
- **Unchanged:** the reassign command, `{ action: "reassign", artisan_id, reason }`. Only the chosen id comes from the picker.
