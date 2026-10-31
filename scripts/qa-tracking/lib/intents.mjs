// Durable intents (contract §7, A5.1/A5.4, root review of 8aa5a78): every write of the harness is
// announced on disk (mode 0600) BEFORE it is emitted and settled after its outcome is KNOWN.
// Outcomes: done (2xx fully read), refused (definitive 4xx), reconciled (unknown at first, then
// proven by a readback), not-sent (stopped before emission). An intent still open at cleanup
// time means the outcome is unknown: the run is INCOMPLETE (exit 3), never "clean".
// Reconcilers (readback functions) live in memory only: a later --cleanup-manifest process has
// none, so every intent left open by a crash stays open there too (fail closed).
import { randomUUID } from "node:crypto";
import { atomicWriteJsonSync } from "./durable.mjs";

export class IntentLog {
  constructor(file, { now = () => new Date().toISOString(), persist = true } = {}) {
    this.file = file;
    this.now = now;
    this.persist = persist;
    this.entries = [];
    this.reconcilers = new Map();
    this.save();
  }
  save() {
    if (!this.persist) return;
    atomicWriteJsonSync(this.file, { version: 2, intents: this.entries });
  }
  /** Announces a write. `key`/`kind` must never contain coordinates. */
  begin(op, target, key = null, kind = null) {
    const entry = { id: randomUUID(), op: String(op), target: String(target), key: key === null ? null : String(key), kind: kind === null ? null : String(kind), state: "open", opened_at: this.now(), settled_at: null, outcome: null };
    this.entries.push(entry);
    this.save();
    return entry.id;
  }
  settle(id, outcome = "done", extra = {}) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw new Error(`unknown intent ${id}`);
    if (entry.state !== "open") return entry;
    Object.assign(entry, { state: "settled", settled_at: this.now(), outcome: String(outcome) }, sanitizeExtra(extra));
    this.reconcilers.delete(id);
    this.save();
    return entry;
  }
  /** Readback able to prove the state of an unknown outcome later (after the drain). */
  attach(id, reconciler) {
    if (typeof reconciler === "function" && this.entries.some((e) => e.id === id && e.state === "open")) this.reconcilers.set(id, reconciler);
  }
  /** Tries every attached readback; settles only what is PROVEN. Returns the remaining open list. */
  async reconcileOpen(log = () => {}) {
    for (const entry of this.open()) {
      const fn = this.reconcilers.get(entry.id);
      if (!fn) continue;
      try {
        const proof = await fn();
        if (proof?.proven) this.settle(entry.id, "reconciled", { note: proof.note || "state proven by readback" });
      } catch (error) {
        log(`reconcile ${entry.op} ${entry.target}: ${String(error?.message || error).slice(0, 160)}`);
      }
    }
    return this.open();
  }
  /**
   * Runs `fn` between begin() and settle(). A definitive refusal settles as "refused"; a stop
   * BEFORE any emission (`notSentBeforeStart`) settles as "not-sent"; anything else (timeout,
   * transport error, 5xx, stop in the middle of a multi-step write) stays OPEN with its readback.
   */
  async wrap(op, target, key, fn, { definitiveFailure = defaultDefinitive, reconcile = null, kind = null } = {}) {
    const id = this.begin(op, target, key, kind);
    try {
      const value = await fn();
      this.settle(id, "done");
      return value;
    } catch (error) {
      if (error?.notSentBeforeStart) this.settle(id, "not-sent");
      else if (definitiveFailure(error)) this.settle(id, "refused", { status: error?.status ?? null });
      else this.attach(id, reconcile);
      throw error;
    }
  }
  open() {
    return this.entries.filter((e) => e.state === "open");
  }
}

const sanitizeExtra = (extra) => {
  const out = {};
  for (const [k, v] of Object.entries(extra || {})) if (["status", "note"].includes(k)) out[k] = v === null || v === undefined ? null : String(v).slice(0, 200);
  return out;
};

/** Definitive server refusals only (the write did not happen). Timeouts, 5xx, 408 and transport errors are NOT. */
export const DEFINITIVE_REFUSALS = Object.freeze([400, 401, 403, 404, 409, 422, 429]);
export function defaultDefinitive(error) {
  return DEFINITIVE_REFUSALS.includes(Number(error?.status));
}

/** Final verdict used by the runner: any open intent makes the cleanup incomplete. */
export function intentsVerdict(log) {
  const open = log.open();
  return { ok: open.length === 0, open: open.map((e) => ({ op: e.op, target: e.target, key: e.key, kind: e.kind, opened_at: e.opened_at })) };
}
