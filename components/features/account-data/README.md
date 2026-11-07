# Account data (SYS-09 / PUB-10)

Leaf for `GET/POST /api/profile/data` (ROOT e541656, contract copied strictly in `model.ts`; the
commit also edits MISSIONS.md, so it is not cherry-picked). « Télécharger mes données » reads every
section page by page (`after` cursor) into one JSON file, identity-guarded after every await, with
resume at the failed section / cursor. « Demander l’effacement » opens a support ticket after an
explicit confirmation — nothing is erased at this stage — with a request_id fenced in this tab's
sessionStorage (uid + generation) before the POST. Demo: honest note, zero calls.
