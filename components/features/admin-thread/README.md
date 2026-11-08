# Admin dossier thread (ADM-07)

In live mode, the admin dossier thread reads the paginated GET `/api/messages?intervention_id=…&cursor=…`. Access goes through RLS `messages_read`, whose `can_access_intervention` check includes `is_admin`. The thread reuses the shared client and reducer in `components/app/message-history.ts` and leaves them unchanged. Demo mode keeps the workspace merge.

- **Fence:** the state key is identity (uid|generation) + dossier. A frame or reply belonging to another key is never shown.
- **Admin-only refusal rule:** a 401, 403 or 404, on the first page or a later one, hides every row. `admin-space` then also hides the composer until a new key reads successfully. The shared MessageCenter behaviour for other roles is unchanged.
- **Errors:** a 503 or invalid reply on page 1 shows « Réessayer ». On a later page, the verified rows stay and « Réessayer » resumes at the same cursor.
- **Sending:** `AdminReplyComposer` is unchanged (same command). Confirmed replies are merged with the server pages, deduplicated by id.
