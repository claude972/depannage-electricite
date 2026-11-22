# Postal coverage (PUB-03)

Two leaves use the shared API contract in `lib/features/coverage/contract.ts`.
- `PostalCoverageCheck` — public check under « Tarifs »: 5-digit validation, one GET on submit and no browser persistence. The lookup describes the published area.
- `CoverageEditor` — admin settings: empty list (never prefilled), add/remove/dedupe, explicit
  publish/withdraw confirmation; command fenced in sessionStorage under the private prefix
  `courant-private-coverage:` (+ `<uid>:<generation>`), purged centrally on logout / identity change.
