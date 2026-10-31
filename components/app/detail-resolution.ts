// Deep-link detail resolution (WEB-DEEPLINK-REFRESH-001, contract A1/A3). Pure, no React.
//
// A detail view whose id is absent from the cached workspace does not say « introuvable » at
// once: in live mode it asks for ONE fresh workspace read (causal barrier) for that id in the
// current context, and only a `loaded` outcome proves the absence. A failure never becomes
// « introuvable ». The per-id memory is bounded and keyed by context.

export type DetailAttempt = { state: "pending" } | { state: "loaded" } | { state: "failed"; status: number };
export type DetailDecision = "show" | "refresh" | "loading" | "not_found" | "error";

export function decideDetail(input: { present: boolean; live: boolean; attempt: DetailAttempt | undefined }): DetailDecision {
  if (input.present) return "show";
  if (!input.live) return "not_found"; // demonstration: no network, the seeds are the truth
  if (!input.attempt) return "refresh";
  if (input.attempt.state === "pending") return "loading";
  if (input.attempt.state === "failed") return "error";
  return "not_found";
}

export const detailAttemptKey = (contextKey: string, view: string, id: string) => `${contextKey}|${view}|${id}`;

/** Bounded LRU memory of attempts: arbitrary ids can never grow it without limit. */
export class DetailAttemptMemory {
  private entries = new Map<string, DetailAttempt>();
  private context = "";
  constructor(private readonly limit = 32) {}
  /** Forgets every attempt of another context (identity, role, organisation or site changed). */
  useContext(contextKey: string) {
    if (contextKey === this.context) return;
    this.context = contextKey;
    this.entries.clear();
  }
  get(key: string): DetailAttempt | undefined {
    return this.entries.get(key);
  }
  set(key: string, attempt: DetailAttempt) {
    this.entries.delete(key); // re-insert ⇒ most recent
    this.entries.set(key, attempt);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }
  delete(key: string) {
    this.entries.delete(key);
  }
  get size() {
    return this.entries.size;
  }
}
