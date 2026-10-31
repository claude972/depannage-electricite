// Durable intents (contract §7, A5.1/A5.4): every write of the harness is announced on disk
// (mode 0600) BEFORE it is sent and settled after its outcome is known. An intent still open at
// cleanup time means the outcome is unknown: the run is INCOMPLETE (exit 3), never "clean".
import { writeFileSync, chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";

export class IntentLog {
  constructor(file, { now = () => new Date().toISOString(), persist = true } = {}) {
    this.file = file;
    this.now = now;
    this.persist = persist;
    this.entries = [];
    this.save();
  }
  save() {
    if (!this.persist) return;
    writeFileSync(this.file, JSON.stringify({ version: 1, intents: this.entries }, null, 2) + "\n", { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }
  /** Announces a write. `key` must not contain coordinates (validated by the caller's types). */
  begin(op, target, key = null) {
    const entry = { id: randomUUID(), op: String(op), target: String(target), key: key === null ? null : String(key), state: "open", opened_at: this.now(), settled_at: null, outcome: null };
    this.entries.push(entry);
    this.save();
    return entry.id;
  }
  settle(id, outcome = "done", extra = {}) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw new Error(`unknown intent ${id}`);
    if (entry.state !== "open") return entry;
    Object.assign(entry, { state: "settled", settled_at: this.now(), outcome: String(outcome) }, sanitizeExtra(extra));
    this.save();
    return entry;
  }
  /** Runs `fn` between begin() and settle(); a thrown error settles as "failed" only when the
   *  server definitively refused (HTTP 4xx/known code); anything else stays open (unknown). */
  async wrap(op, target, key, fn, { definitiveFailure = defaultDefinitive } = {}) {
    const id = this.begin(op, target, key);
    try {
      const value = await fn();
      this.settle(id, "done");
      return value;
    } catch (error) {
      if (definitiveFailure(error)) this.settle(id, "refused", { status: error?.status ?? null });
      throw error;
    }
  }
  open() {
    return this.entries.filter((e) => e.state === "open");
  }
}

const sanitizeExtra = (extra) => {
  const out = {};
  for (const [k, v] of Object.entries(extra || {})) if (["status", "id", "note"].includes(k)) out[k] = v === null || v === undefined ? null : String(v).slice(0, 200);
  return out;
};

/** A server answer that proves the write did not happen: HTTP 4xx (except 408/429 ambiguity is
 *  still a refusal for these idempotent-by-design commands). Timeouts and network errors are NOT. */
export function defaultDefinitive(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408;
}

/** Final verdict used by the runner: any open intent makes the cleanup incomplete. */
export function intentsVerdict(log) {
  const open = log.open();
  return { ok: open.length === 0, open: open.map((e) => ({ op: e.op, target: e.target, key: e.key, opened_at: e.opened_at })) };
}
