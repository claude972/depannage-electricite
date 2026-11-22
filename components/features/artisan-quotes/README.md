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
- **`detail.ts` and `artisan-quote-detail.tsx`**: « Ouvrir le devis » makes an exact point read of GET `/api/artisan/quotes/[id]` (contract 42708ad).
  - `parseQuoteDetail` is strict. It accepts the reply only when:
    - it carries exactly the requested id;
    - `artisan_id` is the current user;
    - the dossier id is coherent;
    - the VAT rate is representable;
    - the totals match `calculateQuote`.
  - The screen shows the lines, VAT, status and TTC as the server sends them. These are the quote's own totals: no amendments, no payment.
  - 404, 403 and 422 show « devis inaccessible », and no other quote is substituted. 401 shows a session-expired message. 503 and other failures show « Réessayer », disabled until `Retry-After` has elapsed.
  - The state is bound at render time to identity + quote id, and late replies are dropped.
  - The screen never falls back to the cache or to the 20-quote dossier detail.
- **`artisan-quotes.tsx`**: the list stays mounted, hidden, while a quote is open. « Retour à la liste » keeps its pages and filter, and returns focus to the row.
