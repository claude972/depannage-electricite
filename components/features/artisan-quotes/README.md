# Artisan quotes (ART-07)

In live mode, the « Devis » screen is fed only by GET `/api/artisan/quotes` (contract 76151e2, `docs/ARTISAN_QUOTES_BACKEND.md`). It never falls back to the 100-row bootstrap cache. Demo mode keeps the existing local groups and makes zero calls.

- **`model.ts`**
  - `parseQuotes` strictly mirrors the route's reply. It rejects a reply when:
    - keys are missing or unexpected;
    - a status does not match the selected filter;
    - two items share an id;
    - `has_more` and `next_cursor` disagree.
  - `createQuotes` runs one controller per (identity, filter):
    - « Afficher plus » follows the opaque `next_cursor` and drops items whose id is already listed;
    - a 422 on a cursor restarts at page 1 with a notice;
    - 401 or 403 clears the list and shows an honest message;
    - 503 and other failures show « Réessayer », disabled until `Retry-After` has elapsed.

    A reply is dropped unless it matches the current identity (uid|generation), the filter and the latest sequence.
- **`artisan-quotes-panel.tsx`**
  - The status filter (Tous / Envoyés / Acceptés / Refusés) restarts at page 1 when it changes.
  - At render time, the panel only shows state that belongs to the current identity and filter.
  - Each row has « Voir le dossier », which opens the current dossier through `session.openIntervention(intervention_id)`. That dossier view does not claim to show this exact quote.
  - Each row can also receive an extra action through `rowAction`, used for the exact point read of the quote.
