# Data erasure requests (SYS-07)

Strict mirror of Astra c0df158 / 0ebab8f (`contract.ts`; the lib file imports server code, so it is
mirrored, not imported). Client: `MyErasureRequests` inside « Mes données » (`erasureRequests` opt-in,
client space only). Operator: `OperatorDataRequests` under the support queue (list, detail + history,
decision only when `can_decide` and not terminal; command fenced under
`courant-private-data-requests:<uid>:<gen>:<id>`). Nothing is erased: execution is always « non commencé ».
