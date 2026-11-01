// Bounded cache of point-read dossiers (FASTSPLIT-DETAIL-CONSUMER-001). Independent of the
// workspace list (a workspace refresh never erases it), keyed by the FULL refresh context
// (identity generation + role + organisation + site) and the id. At most `limit` entries,
// true LRU (a read promotes), each entry valid `ttlMs`. A context change clears everything, so a
// dossier read under one identity, organisation or site is never shown under another.
import type { DetailRead } from "../../lib/features/workspace/detail-read";

type Entry = { detail: DetailRead; at: number };

export class DetailCache {
  private entries = new Map<string, Entry>();
  private context = "";
  constructor(
    private readonly limit = 20,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}
  useContext(contextKey: string) {
    if (contextKey === this.context) return;
    this.context = contextKey;
    this.entries.clear();
  }
  get currentContext() {
    return this.context;
  }
  get(id: string): DetailRead | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (this.now() - entry.at > this.ttlMs) {
      this.entries.delete(id);
      return undefined;
    }
    this.entries.delete(id); // promote
    this.entries.set(id, entry);
    return entry.detail;
  }
  set(id: string, detail: DetailRead) {
    this.entries.delete(id);
    this.entries.set(id, { detail, at: this.now() });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as string);
  }
  delete(id: string) {
    this.entries.delete(id);
  }
  get size() {
    return this.entries.size;
  }
}
