# Message read confirmations (SYS-04 / M62)

This module follows the contract of `POST /api/messages/read-state` (cbd0d2b). It is mounted in `MessageCenter` (`components/app/forms.tsx`). There, the hook is always called, and it stays inactive in demo, without a mutation context, without a selected and authorised thread, or when that thread is « indisponible ». A 404 from the route is silent: no label and no control.

```tsx
const read = useMessageReadState({ context: session.mutationContext, interventionId, messages, demo });
// messages: { id, intervention_id, author_id }[] (structural type)
<MessageReadControl state={read} demo={demo} />
<MessageReadBadge status={read.statusOf(m.id)} own={m.author_id === profileId} />
```

The hook returns `{ statusOf(id), canMarkRead, markRead(), refresh(), error, loading, marking }`.

- **Requests:** reads go in batches of 100 when the thread opens, when the account, thread or messages change, and on window focus. `refresh()` triggers a manual re-read. There is no polling.
- **Fence:** reads are bound to the account (uid + generation) and the thread. A change aborts the reads in flight, and late replies are dropped.
- **Errors:** an error or a missing reply confirms nothing.
- **Marking as read:** `markRead()` sends `mark_read` in batches of 100, only for received messages known to be unread. A message becomes read only when the server's rows say so.
- **Status of a message:**
  - own message: « Lu » only when the server returns `read: true`, and « Envoyé » when it is known as unread;
  - received message: read or unread, for the current account only;
  - unknown, such as old history: no label.
- **Demo:** never makes a call.
