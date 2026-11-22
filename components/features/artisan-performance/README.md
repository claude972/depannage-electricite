# Artisan performance (ART-10)

The live figures for the artisan Overview card, the Profile block and the Performance page are read
from the server only, through `session.loadArtisanPerformance()` (GET /api/artisan/performance, RPC
`artisan_performance`). The session code is used as it is.

- `model.ts`
  - `parseArtisanPerformance` strictly mirrors `ArtisanPerformanceReport` and the RPC payload:
    - safe non-negative integers;
    - contiguous periods;
    - rating and growth consistency;
    - `punctuality_rate: null`;
    - `currency: "eur"`.
  - It returns a fresh copy, or `null` when the payload breaks the contract.
- `use-artisan-performance.ts`
  - Demo makes no read: the screens keep their existing local computation, unchanged.
  - Live makes one read per identity (`uid|generation`) and per « Réessayer ».
  - The frame is bound to the identity key and the retry nonce at render time, so an old frame never shows.
  - A late reply is dropped, whether it carries another sequence number or arrives under another identity.
  - States:
    - `loading`;
    - `ready`;
    - `empty` (nothing on either month and no review);
    - `unavailable`: the session returned `null`. The session reduces 401, 403, 404, 5xx and network failures to `null` and records the cause in `capabilities.performance`, so this state cannot tell them apart and always offers a retry;
    - `error`: the read was rejected or the payload is off-contract.
- `artisan-performance-views.tsx`
  - Live renderings, built with the artisan space CSS classes (imported read-only).
  - No cache value appears, and no wording speaks of loaded dossiers.
  - Periods are the server's report bounds, computed by the session from the browser calendar month (`monthPeriods`), with start included and end excluded. The client never recomputes them.
