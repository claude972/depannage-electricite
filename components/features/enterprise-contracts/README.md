# Enterprise framework contracts (ENT-13)

In live mode, the « Contrats cadres » tab of `ProfessionalOperations` reads the server contracts of the active organisation. The tab follows contract 201057a; `model.ts` mirrors `lib/features/enterprise-contracts/handler.ts` strictly.

- **List:** `GET /api/enterprise/contracts?organization_id=…[&cursor=…]` returns 50 rows per page, newest first.
  - « Afficher plus » follows the opaque cursor and drops ids already listed.
  - A 422 on a cursor restarts at page 1 with a notice.
- **Detail:** the terms come from `GET /api/enterprise/contracts/[id]?organization_id=…`, read only when the contract is opened.
  - The opened contract is a separate panel, keyed by identity + organisation + contract id, not a list row. After a write it stays open, shows loading, then the fresh detail from one exact point GET, even when the contract is no longer on page 1.
  - The panel is cleared on an identity or organisation change and when the list is refused.
- **Refusals:**
  - 401: the session has expired.
  - 403: the account is not an enterprise account.
  - 404: the user has no organisation-wide access (for example, access limited to certain sites), or the organisation is no longer accessible.

  An honest message is shown and everything is cleared.
- **503:** « Réessayer » stays disabled until `Retry-After` has passed.
- **Fence:** state is shown only under its identity (uid|generation), organisation and write epoch, plus the contract id for the detail. Late replies are dropped.
- **Writes:** these are the existing `save_contract` commands (create, archive, reactivate), with the same payload. Archive and reactivate are offered from the opened detail, because they need the terms.
  - After a successful write, `ProfessionalOperations` bumps the epoch. This invalidates every older read and re-reads page 1 and the open detail.
  - In live, a creation targets only `contracts.organizationId`. There is no fallback: without it, creation is disabled and the user is asked to choose an organisation.
- **Host prop:** `contracts?: { organizationId, context, fetcher? }`.
  - Without it, or without an organisation, nothing is read and the panel asks the user to choose an organisation.
  - Demo mode keeps the local listing and makes zero calls.
