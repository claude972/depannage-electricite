// Shared P1 rules (phase 2 lot B) for a server refusal seen by a panel that already shows protected
// data. One classification, one decision; each panel only supplies its own re-read (adapter).
//
//   401             → "session": purge every protected value now, no new POST, ask to reconnect.
//   403 / 404       → "access":  re-read rights + resource BEFORE any new POST; a refused re-read
//                                purges (the panel's read path applies the purge).
//   409             → "conflict": re-read the current version, keep the user's input, show conflict.
//   400 / 422 / 429 → "invalid":  keep input, no re-read.
//   0 / timeout / 5xx → "transient": keep input, explicit retry of the same command only.
// Nothing here talks to the network or to React.

export type Refusal = "session" | "access" | "conflict" | "invalid" | "transient";

export function classifyRefusal(status: number): Refusal | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return "session";
  if (status === 403 || status === 404) return "access";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422 || status === 429) return "invalid";
  return "transient";
}

/** A refused read (any page) of protected rows: the rows already shown must be purged. */
export const readRefused = (status: number): boolean => {
  const k = classifyRefusal(status);
  return k === "session" || k === "access";
};

/** After a refused WRITE: does the panel have to re-read rights + resource before anything else? */
export const writeNeedsReread = (status: number): boolean => classifyRefusal(status) === "access";

/** After a refused WRITE: must the protected values be purged immediately (no re-read possible)? */
export const writePurgesNow = (status: number): boolean => classifyRefusal(status) === "session";

/**
 * Write-refusal decision for a panel controller: `purge` → apply the panel's own denied state now;
 * `reread` → call the panel's own re-read adapter (its refused read purges). Exactly one is true for
 * 401/403/404, neither otherwise.
 */
export function afterWriteRefusal(status: number): { purge: boolean; reread: boolean } {
  return { purge: writePurgesNow(status), reread: writeNeedsReread(status) };
}
