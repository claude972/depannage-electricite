# Web push enrollment

Leaf for `GET/POST /api/notifications/push` (contract given by ROOT; route and service-worker statics
are ROOT's and not edited here). Mounted in the shared `PreferencesPanel`. One account, one browser:
activating a new browser replaces the previous one. Offered only after the push preference is saved
and the worker answers `PRIVATE_PUSH_READY` to `CHECK_PRIVATE_PUSH` in time; subscribe is called
synchronously in the click with the prepared registration and key bytes; re-read only after errors;
endpoint/keys never stored. Browser APIs are injected (`PushEnv`) for tests. Demo: note, zero calls.
