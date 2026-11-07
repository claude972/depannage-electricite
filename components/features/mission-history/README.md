# Artisan mission history (live)

Leaf for `GET /api/artisan/mission-history?filter=active|done[&cursor=…]` (contract 6932c6f, mirrored
strictly in `model.ts`). Used by the « En cours » / « Terminées » segments of the artisan Missions view
in live mode only (demo keeps its local lists, zero calls). Counts in the segment labels come from the
server's `counts`; nothing is counted from the 100-row cache. Rows open via `openIntervention`.
