# Public callback requests (PUB-04)

Strict mirror of 07d718f (`model.ts`). `PublicCallbackForm` — « Être rappelé » in the public Help view,
shown only when `GET /api/public/callback` says available; consent text shown before sending; the
request_id is reused only for exactly the same content; nothing stored (memory only); 429 countdown.
`OperatorCallbacks` — support queue (live mode only): open/closed tabs, numbered pages, « Classer »
only when `can_close` and version 1, re-read after every close attempt. No SMS, no automatic call.
