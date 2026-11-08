"use client";
// SYS-04 / M62 — explicit read confirmation controls (no polling, nothing in demo).
import { READ_COPY as COPY, type ReadStatus } from "./model";
import type { MessageReadState } from "./use-message-read-state";

/** « Marquer comme lus » for the received unread messages of the thread + « Actualiser » + errors. */
export function MessageReadControl({ state, demo = false }: { state: MessageReadState; demo?: boolean }) {
  if (demo) return null;
  return (
    <div className="message-read-control" data-message-read={state.loading ? "loading" : state.error ? "error" : "idle"} aria-busy={state.loading || state.marking || undefined} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {state.canMarkRead && (
        <button type="button" className="button outline" onClick={() => void state.markRead()} disabled={state.marking} data-message-read-mark="">
          {state.marking ? COPY.marking : COPY.markRead}
        </button>
      )}
      <button type="button" className="button outline" onClick={state.refresh} disabled={state.loading} data-message-read-refresh="">
        {state.loading ? COPY.loading : COPY.refresh}
      </button>
      {state.error && (
        <p className="field-error" role="alert" style={{ margin: 0 }}>
          {state.error === "mark" ? COPY.markFailed : COPY.failed}{" "}
          <button type="button" className="text-button" onClick={state.error === "mark" ? () => void state.markRead() : state.refresh}>
            {COPY.retry}
          </button>
        </p>
      )}
    </div>
  );
}

/** Label of ONE own message: « Lu » only on server proof, « Envoyé » when known unread; nothing when unknown. */
export function MessageReadBadge({ status, own }: { status: ReadStatus; own: boolean }) {
  if (!own || (status !== "read" && status !== "sent")) return null;
  return (
    <small className="message-read-badge" data-message-read-status={status}>
      {status === "read" ? COPY.read : COPY.sent}
    </small>
  );
}
