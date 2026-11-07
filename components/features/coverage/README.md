# Postal coverage (PUB-03)

Two leaves on the ROOT d2831c8 contract (strict copy in `contract.ts`; the commit edits MISSIONS.md, a
migration and a shared SQL test, so it is not cherry-picked):
- `PostalCoverageCheck` — public check under « Tarifs »: 5-digit validation, one GET on submit, the
  code is never stored; informative wording only (no promise of artisan or delay, never blocks).
- `CoverageEditor` — admin settings: empty list (never prefilled), add/remove/dedupe, explicit
  publish/withdraw confirmation; command fenced in sessionStorage under the private prefix
  `courant-private-coverage:` (+ `<uid>:<generation>`), purged centrally on logout / identity change.
