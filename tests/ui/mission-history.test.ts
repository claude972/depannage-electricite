// Artisan mission history (contract 6932c6f mirrored strictly): exact query params, strict parser
// (exact keys, filter echoed, segment statuses, has_more ⇔ next_cursor, ≤ 50, integer counts),
// controller: counts from the server, pagination + dedupe, stale replies dropped, identity change,
// 422 cursor ⇒ honest restart at page 1, 503 / 401 / 403 states; live labels never from the cache.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/mission-history/model";

const m = loadModule("components/features/mission-history/model.ts") as unknown as typeof Model;
const U = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = (n: number) => `2026-11-${String(10 - (n % 9)).padStart(2, "0")}T10:00:00.123456Z`;
export const item = (n: number, status = "in_progress", o: Record<string, unknown> = {}) => ({ id: U(n), category: "panel", address: "3 rue des Ateliers", city: "Fort-de-France", urgency: "scheduled", status, created_at: T(n), completed_at: status === "completed" || status === "paid" ? T(n) : null, paid_at: status === "paid" ? T(n) : null, ...o });
export const reply = (filter: "active" | "done", items: unknown[], next: string | null, counts = { active: 123, done: 112 }) => ({ items, counts, filter, order: "newest_first", captured_at: "2026-11-07T12:00:00.000Z", page: { limit: 50, has_more: next !== null, next_cursor: next } });

test("URL exacte : filter toujours, cursor seulement s’il existe (transmis tel quel)", () => {
  assert.equal(m.historyUrl("active", null), "/api/artisan/mission-history?filter=active");
  assert.equal(m.historyUrl("done", "eyJ2IjoxfQ"), "/api/artisan/mission-history?filter=done&cursor=eyJ2IjoxfQ");
});

test("lecture stricte : clés exactes, filtre renvoyé, statuts du segment, has_more ⇔ curseur, ≤ 50, compteurs entiers", () => {
  assert.ok(m.parseHistory(reply("active", [item(1), item(2, "quoted")], null), "active"));
  assert.ok(m.parseHistory(reply("done", [item(1, "completed"), item(2, "paid")], "cur"), "done"));
  assert.equal(m.parseHistory(reply("done", [item(1)], null), "active"), null, "filter echoed");
  assert.equal(m.parseHistory(reply("active", [item(1, "completed")], null), "active"), null, "done status in active");
  assert.equal(m.parseHistory(reply("done", [item(1, "accepted")], null), "done"), null);
  assert.equal(m.parseHistory({ ...reply("active", [], null), page: { limit: 50, has_more: true, next_cursor: null } }, "active"), null);
  assert.equal(m.parseHistory({ ...reply("active", [], null), page: { limit: 50, has_more: false, next_cursor: "x" } }, "active"), null);
  assert.equal(m.parseHistory(reply("active", Array.from({ length: 51 }, (_, i) => item(i + 1)), null), "active"), null, "≤ 50");
  assert.equal(m.parseHistory(reply("active", [item(1), item(1)], null), "active"), null, "unique ids");
  assert.equal(m.parseHistory(reply("active", [{ ...item(1), description: "x" }], null), "active"), null, "exact item keys");
  assert.equal(m.parseHistory({ ...reply("active", [], null), total: 3 }, "active"), null, "exact reply keys");
  for (const counts of [{ active: -1, done: 0 }, { active: 1.5, done: 0 }, { active: 1, done: 0, all: 1 }, { active: 1 }])
    assert.equal(m.parseHistory(reply("active", [], null, counts as never), "active"), null, JSON.stringify(counts));
  assert.equal(m.parseHistory({ ...reply("active", [], null), order: "oldest_first" }, "active"), null);
});

test("libellés live : compteurs serveur une fois lus, sinon aucun nombre (jamais le cache de 100)", () => {
  assert.equal(m.historyLabel("active", null), "En cours");
  assert.equal(m.historyLabel("done", null), "Terminées");
  assert.equal(m.historyLabel("active", { active: 123, done: 112 }), "En cours (123)");
  assert.equal(m.historyLabel("done", { active: 123, done: 112 }), "Terminées (112)");
  const src = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(src, /const options = demo \? baseOptions : baseOptions\.map\(\(\[k, label\]\) => \[k, k === "available" \? label : historyLabel\(k, liveCounts\)\] as const\);/);
  assert.match(src, /const liveCounts = historyCounts\?\.ident === ident \? historyCounts\.counts : null;/);
});

type Call = { url: string };
function ctrl(filter: "active" | "done", reply: (url: string, n: number) => Response | Promise<Response>, ctx = { uid: "u1" as string | null, gen: 1 }) {
  const calls: Call[] = [];
  const counts: unknown[] = [];
  let forbidden = 0;
  let s: Model.HistoryState = m.HISTORY_INITIAL;
  const c = m.createHistory({
    fetcher: () => (async (url: string) => { calls.push({ url }); return reply(url, calls.length); }) as unknown as typeof fetch,
    filter,
    context: { generation: () => ctx.gen, userId: () => ctx.uid },
    get: () => s,
    set: (n) => (s = n),
    onCounts: (x) => counts.push(x),
    onForbidden: () => forbidden++,
  });
  return { c, calls, counts, ctx, state: () => s, forbidden: () => forbidden };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("pagination : « Afficher plus » suit next_cursor, ajoute et dédoublonne ; compteurs du serveur remontés", async () => {
  const h = ctrl("active", (url) => (url.includes("cursor=") ? json(reply("active", [item(2), item(3)], null, { active: 124, done: 112 })) : json(reply("active", [item(1), item(2)], "CUR1"))));
  await h.c.load();
  assert.deepEqual(h.calls.map((x) => x.url), ["/api/artisan/mission-history?filter=active"]);
  assert.equal(JSON.stringify(h.counts[0]), JSON.stringify({ active: 123, done: 112 }));
  await h.c.more();
  assert.equal(h.calls[1].url, "/api/artisan/mission-history?filter=active&cursor=CUR1");
  assert.equal(JSON.stringify(h.state().items.map((i) => i.id)), JSON.stringify([U(1), U(2), U(3)]), "deduped by id");
  assert.equal(h.state().next, null);
  assert.equal(JSON.stringify(h.counts[1]), JSON.stringify({ active: 124, done: 112 }));
});

test("réponse périmée (rechargement ou changement d’identité) ⇒ ignorée", async () => {
  let release!: () => void;
  const h = ctrl("done", (_url, n) => (n === 1 ? new Promise<Response>((r) => (release = () => r(json(reply("done", [item(1, "paid")], null))))) : json(reply("done", [item(9, "completed")], null))));
  const first = h.c.load();
  await h.c.load(); // a newer read
  release();
  await first;
  assert.equal(JSON.stringify(h.state().items.map((i) => i.id)), JSON.stringify([U(9)]), "the older reply is dropped");
  let rel2!: () => void;
  const g = ctrl("active", () => new Promise<Response>((r) => (rel2 = () => r(json(reply("active", [item(1)], null))))));
  const p = g.c.load();
  g.ctx.gen = 2;
  rel2();
  await p;
  assert.equal(g.state().phase, "loading", "identity changed: reply never applied");
  assert.equal(g.counts.length, 0);
});

test("422 sur le curseur ⇒ message honnête + reprise page 1 ; 503 ⇒ erreur + réessayer ; 401/403 ⇒ vidé ; vide ⇒ état vide", async () => {
  const h = ctrl("active", (url) => (url.includes("cursor=") ? json({ error: "x" }, 422) : json(reply("active", [item(1)], "CUR"))));
  await h.c.load();
  await h.c.more();
  assert.deepEqual(h.calls.map((x) => x.url.includes("cursor=")), [false, true, false], "restart from page 1");
  assert.equal(h.state().notice, m.HISTORY_COPY.cursor);
  assert.equal(h.state().phase, "ready");
  const e = ctrl("done", () => json({ error: "x" }, 503));
  await e.c.load();
  assert.equal(e.state().phase, "error");
  assert.equal(e.state().error, m.HISTORY_COPY.loadFailed);
  for (const st of [401, 403]) {
    const f = ctrl("active", () => json({}, st));
    await f.c.load();
    assert.equal(f.state().phase, "forbidden");
    assert.equal(f.state().items.length, 0);
    assert.equal(f.forbidden(), 1, `${st}: the host is told to clear its counts`);
  }
  const empty = ctrl("done", () => json(reply("done", [], null, { active: 0, done: 0 })));
  await empty.c.load();
  assert.equal(empty.state().phase, "ready");
  assert.equal(empty.state().items.length, 0);
});

test("câblage : live ⇒ historique serveur + openIntervention ; démo ⇒ listes locales inchangées (aucun appel)", () => {
  const src = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(src, /\{segment === "active" && !demo && \(\s*<MissionHistoryPanel\s+key=\{`\$\{ident\}\|active`\}\s+filter="active"/);
  assert.match(src, /\{segment === "done" && !demo && \(\s*<MissionHistoryPanel\s+key=\{`\$\{ident\}\|done`\}\s+filter="done"/);
  assert.match(src, /onOpen=\{\(\) => session\.openIntervention\(i\.id\)\}/);
  assert.match(src, /\{segment === "active" && demo &&\s+\(m\.active\.length \?/);
  assert.match(src, /\{segment === "done" && demo &&\s+\(done\.length \?/);
});

test("« Actualiser » relit la page 1 et les compteurs ; 401/403 ⇒ compteurs du parent effacés ; sous-titre live sans « dossiers chargés » ; MissionRow typé par Pick", async () => {
  let n = 0;
  const h = ctrl("active", (url) => (url.includes("cursor=") ? json(reply("active", [item(3)], null)) : json(reply("active", [item(1), item(2)], "CUR", { active: 120 + ++n, done: 1 }))));
  await h.c.load();
  await h.c.more();
  await h.c.load(); // « Actualiser »
  assert.equal(h.calls[h.calls.length - 1].url, "/api/artisan/mission-history?filter=active", "page 1 again");
  assert.equal(h.state().items.length, 2, "page 1 only");
  assert.equal((h.counts[h.counts.length - 1] as { active: number }).active, 122, "fresh counts");
  const src = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(src, /onForbidden=\{\(\) => setHistoryCounts\(null\)\}/);
  assert.match(src, /subtitle=\{demo \? "Offres, dossiers en cours et terminés, sur les dossiers chargés\." : "Offres disponibles, dossiers en cours et terminés\."\}/);
  assert.match(src, /intervention: Pick<Intervention, "category" \| "address" \| "city" \| "status">;/);
  assert.doesNotMatch(src, /as unknown as Intervention/);
  assert.match(readFileSync("components/features/mission-history/mission-history-panel.tsx", "utf8"), /data-mission-history-refresh/);
});
