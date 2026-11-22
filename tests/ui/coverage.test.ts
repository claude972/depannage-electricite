// Postal coverage (PUB-03), same contract as the server. Public check: 5 digits, exact
// query, honest informative wording (unknown = « zone non encore publiée »), no guarantee wording.
// Admin editor: never prefilled, parse/dedupe/limit, publish/withdraw commands fenced under
// `courant-private-coverage:<uid>:<gen>` (read-back or 0 POST), strict restore, no replay after an
// identity change, 401/403 clear, 409 honest + reload, 503/429 same command, replayed handled.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/coverage/model";
import type * as Check from "../../components/features/coverage/postal-coverage-check";
import type * as Editor from "../../components/features/coverage/coverage-editor";

const m = loadModule("components/features/coverage/model.ts") as unknown as typeof Model;
const ck = loadModule("components/features/coverage/postal-coverage-check.tsx") as unknown as typeof Check;
const ed = loadModule("components/features/coverage/coverage-editor.tsx") as unknown as typeof Editor;
const UID = "10000000-0000-4000-8000-0000000000ad";
const CID = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

test("interface et API partagent le contrat de couverture", () => {
  assert.match(readFileSync("components/features/coverage/model.ts", "utf8"), /from "\.\.\/\.\.\/\.\.\/lib\/features\/coverage\/contract"/);
});

test("vérification publique : 5 chiffres, URL exacte, libellés honnêtes, aucune promesse", () => {
  assert.equal(m.isPostalCode("97200"), true);
  for (const bad of ["9720", "972000", "97 20", "2A004", "", "97200 "]) assert.equal(m.isPostalCode(bad), false, bad);
  assert.equal(m.publicUrl("97200"), "/api/public/coverage?postal_code=97200");
  assert.equal(m.parsePublic({ status: "unknown", version: null })!.status, "unknown");
  assert.equal(m.parsePublic({ status: "covered", version: null }), null, "covered needs a version");
  assert.equal(m.parsePublic({ status: "covered", version: 2, extra: 1 }), null);
  const unknown = m.publicMessage("97200", { status: "unknown", version: null });
  assert.match(unknown, /^Zone non encore publiée/);
  assert.match(m.publicMessage("97200", { status: "covered", version: 2 }), /97200 figure dans la zone publiée/);
  assert.match(m.publicMessage("97200", { status: "not_covered", version: 2 }), /ne figure pas[\s\S]*Vous pouvez tout de même déposer une demande/);
  const all = [unknown, m.publicMessage("1", { status: "covered", version: 1 }), m.publicMessage("1", { status: "not_covered", version: 1 }), m.PUBLIC_COPY.informative, m.PUBLIC_COPY.intro].join(" ");
  assert.doesNotMatch(all, /garanti|assuré|sous \d|en moins de|disponible immédiatement|\d+\s*(min|h)\b/i, "no promise of an artisan or a delay");
  assert.match(m.PUBLIC_COPY.informative, /ne bloque jamais le dépôt d’une demande/);
  assert.match(m.PUBLIC_COPY.intro, /liste publiée/);
  assert.equal(m.publicError(422, null), m.PUBLIC_COPY.invalid);
  assert.match(m.publicError(503, 9), /réessayez dans 9 s/);
});

test("vérification publique : saisie sans mémorisation (autocomplete off, aucune écriture de stockage)", () => {
  const src = readFileSync("components/features/coverage/postal-coverage-check.tsx", "utf8");
  assert.doesNotMatch(src, /localStorage|sessionStorage|history\.|location\./);
  const html = renderToString(createElement(ck.PostalCoverageCheck as never));
  assert.match(html, /autoComplete="off"|autocomplete="off"/);
  assert.match(html, /inputMode="numeric"|inputmode="numeric"/);
});

test("éditeur : saisie libre → codes valides, dédupliqués, triés, limite 250", () => {
  const out = m.parseCodes("97200, 97200 97233;abc 9720\n97100", ["97233"]);
  assert.equal(JSON.stringify(out), JSON.stringify({ added: ["97200", "97100"], invalid: ["abc", "9720"], duplicates: ["97200", "97233"], overflow: false }));
  const full = Array.from({ length: 249 }, (_, i) => String(10000 + i));
  const over = m.parseCodes("20000 20001", full);
  assert.deepEqual([...over.added], ["20000"]);
  assert.equal(over.overflow, true);
  assert.deepEqual([...m.sortedCodes(["97233", "97100"])], ["97100", "97233"]);
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
function editor(reply: (method: string, body: unknown, n: number) => Response | Promise<Response>, opts: { store?: Model.Store | null; ids?: string[]; ctx?: { uid: string | null; gen: number } } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const ctx = opts.ctx ?? { uid: UID, gen: 1 };
  const ids = opts.ids ?? [CID(1), CID(2), CID(3)];
  const mem = memStore();
  const store = opts.store === undefined ? mem.store : opts.store;
  let view: Model.EditorView = m.EDITOR_INITIAL;
  const c = m.createEditor({
    fetcher: () => (async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: String(init.method), url, body });
      return reply(String(init.method), body, calls.length);
    }) as unknown as typeof fetch,
    store: () => store,
    newId: () => ids.shift() ?? null,
    context: { generation: () => ctx.gen, userId: () => ctx.uid },
    get: () => view,
    set: (v) => (view = v),
  });
  return { c, calls, mem, ctx, view: () => view };
}
const STATE = { version: 3, postal_codes: ["97200"] };
const receipt = (version: number, codes: string[], replayed = false) => json({ version, postal_codes: codes, replayed });

test("publication : commande triée, stockée sous courant-private-coverage:<uid>:<gen> et relue avant le POST ; succès ⇒ relecture", async () => {
  assert.equal(m.PENDING_PREFIX, "courant-private-coverage:");
  assert.equal(m.pendingKey(UID, 4), `courant-private-coverage:${UID}:4`);
  let seen: string | undefined;
  const h = editor((method, body) => {
    if (method === "GET") return json(STATE);
    seen = h.mem.map.get(m.pendingKey(UID, 1));
    return receipt(4, (body as { postal_codes: string[] }).postal_codes);
  });
  await h.c.load();
  assert.equal(h.view().phase, "ready");
  assert.equal(await h.c.publish(["97233", "97100"]), true);
  const post = h.calls.find((x) => x.method === "POST")!;
  assert.equal(post.url, "/api/admin/coverage");
  assert.equal(JSON.stringify(post.body), JSON.stringify({ action: "publish", command_id: CID(1), expected_version: 3, postal_codes: ["97100", "97233"] }));
  assert.equal(JSON.parse(seen!).command.command_id, CID(1), "persisted before the POST");
  assert.equal(h.mem.map.size, 0, "cleared after success");
  assert.match(h.view().notice, /2 code\(s\) postal\(aux\), version 4/);
  assert.equal(h.calls[h.calls.length - 1].method, "GET", "reloaded");
  assert.equal(await h.c.publish([]), false, "empty list never sent");
});

test("retrait ; rejoué ⇒ message honnête ; reçu incohérent ⇒ même commande", async () => {
  const w = editor((method) => (method === "GET" ? json(STATE) : receipt(4, [], true)));
  await w.c.load();
  await w.c.withdraw();
  assert.equal(JSON.stringify(w.calls[1].body), JSON.stringify({ action: "withdraw", command_id: CID(1), expected_version: 3 }));
  assert.equal(w.view().notice, m.EDITOR_COPY.replayed);
  const bad = editor((method) => (method === "GET" ? json(STATE) : receipt(5, ["97200"])));
  await bad.c.load();
  await bad.c.publish(["97200"]);
  assert.equal(bad.view().pending!.command_id, CID(1));
  assert.equal(bad.view().error, m.EDITOR_COPY.retry);
});

test("stockage absent / relecture fausse / pas d’UUID ⇒ 0 POST", async () => {
  for (const store of [null, { get: () => null, set: () => {}, remove: () => {} }, { get: () => { throw new Error("x"); }, set: () => {}, remove: () => {} }]) {
    const h = editor((method) => (method === "GET" ? json(STATE) : receipt(4, ["97200"])), { store: store as Model.Store | null });
    await h.c.load();
    await h.c.publish(["97200"]);
    assert.equal(h.calls.filter((x) => x.method === "POST").length, 0);
    assert.equal(h.view().error, m.EDITOR_COPY.storage);
  }
  const noId = editor((method) => (method === "GET" ? json(STATE) : receipt(4, ["97200"])), { ids: [] });
  await noId.c.load();
  await noId.c.publish(["97200"]);
  assert.equal(noId.calls.filter((x) => x.method === "POST").length, 0);
  assert.equal(noId.view().error, m.EDITOR_COPY.noUuid);
});

test("503 + Retry-After / réponse perdue ⇒ même commande ; 401/403 ⇒ tout effacé ; 409 ⇒ honnête + relecture, pas de rejeu", async () => {
  const h = editor((method, body, n) => (method === "GET" ? json(STATE) : n === 2 ? json({}, 503, { "Retry-After": "7" }) : n === 3 ? Promise.reject(new TypeError("lost")) : receipt(4, (body as { postal_codes: string[] }).postal_codes)));
  await h.c.load();
  await h.c.publish(["97200", "97233"]);
  assert.equal(h.view().waitS, 7);
  assert.ok(h.mem.map.has(m.pendingKey(UID, 1)), "kept for the same command");
  await h.c.retry();
  await h.c.retry();
  const posts = h.calls.filter((x) => x.method === "POST").map((x) => JSON.stringify(x.body));
  assert.equal(posts.length, 3);
  assert.equal(new Set(posts).size, 1, "the same command every time");
  assert.equal(h.view().pending, null);
  for (const status of [401, 403]) {
    const f = editor((method) => (method === "GET" ? json(STATE) : json({}, status)));
    await f.c.load();
    await f.c.publish(["97200"]);
    assert.equal(f.view().phase, "forbidden");
    assert.equal(f.view().data, null, "published list dropped");
    assert.equal(f.mem.map.size, 0);
  }
  const forbiddenLoad = editor(() => json({}, 403));
  await forbiddenLoad.c.load();
  assert.equal(forbiddenLoad.view().phase, "forbidden");
  const k = editor((method) => (method === "GET" ? json({ version: 5, postal_codes: ["97100"] }) : json({}, 409)));
  k.calls.length = 0;
  await k.c.load();
  await k.c.publish(["97200"]);
  assert.equal(k.view().error, m.EDITOR_COPY.conflict);
  assert.equal(k.view().pending, null);
  assert.equal(k.mem.map.size, 0);
  assert.deepEqual(k.calls.map((x) => x.method), ["GET", "POST", "GET"], "409 ⇒ reload");
  assert.equal(await k.c.retry(), false, "nothing to replay");
});

test("changement d’identité pendant le POST ⇒ réponse ignorée ; restauration stricte ; jamais de rejeu sous une autre identité", async () => {
  const shared = memStore();
  const h = editor((method) => {
    if (method === "GET") return json(STATE);
    h.ctx.gen = 2;
    return json({}, 503);
  }, { store: shared.store });
  await h.c.load();
  await h.c.publish(["97200"]);
  assert.equal(h.view().pending, null, "reply dropped");
  assert.equal(await h.c.retry(), false);
  assert.equal(h.calls.filter((x) => x.method === "POST").length, 1);
  // Generation 2 in the same tab: the generation-1 command is never offered.
  const g2 = editor(() => json(STATE), { store: shared.store, ctx: { uid: UID, gen: 2 } });
  g2.c.restorePending();
  assert.equal(g2.view().pending, null);
  // Back on generation 1: strict restore of the very same command.
  const g1 = editor((method) => (method === "GET" ? json(STATE) : receipt(4, ["97200"])), { store: shared.store });
  g1.c.restorePending();
  assert.equal(g1.view().pending!.command_id, CID(1));
  assert.equal(g1.view().error, m.EDITOR_COPY.restored);
  // Tampered entry (uid inside ≠ key) ⇒ removed, not offered.
  const t = memStore();
  t.store.set(m.pendingKey(UID, 1), JSON.stringify({ uid: "someone-else", gen: 1, command: { action: "withdraw", command_id: CID(9), expected_version: 1 } }));
  const tampered = editor(() => json(STATE), { store: t.store });
  tampered.c.restorePending();
  assert.equal(tampered.view().pending, null);
  assert.equal(t.map.size, 0);
});

test("démo : note honnête, aucun bouton ; éditeur réel : liste vide au départ (jamais préremplie)", () => {
  const demo = renderToString(createElement(ed.CoverageEditor as never, { demo: true, context: { generation: () => 1, userId: () => null } } as never));
  assert.match(demo, /En démonstration, la zone desservie n’est ni lue ni publiée/);
  assert.doesNotMatch(demo, /<button|<input/);
  const src = readFileSync("components/features/coverage/coverage-editor.tsx", "utf8");
  assert.match(src, /const \[codes, setCodes\] = useState<string\[\]>\(\[\]\);/, "the draft list starts empty");
});

test("montages minimaux : « Tarifs » public et Paramètres admin", () => {
  const pub = readFileSync("components/role/public-site.tsx", "utf8");
  assert.match(pub, /import \{ PostalCoverageCheck \} from "\.\.\/features\/coverage\/postal-coverage-check";/);
  assert.equal(pub.match(/<PostalCoverageCheck \/>/g)?.length, 1);
  const admin = readFileSync("components/role/admin-space.tsx", "utf8");
  assert.match(admin, /<CoverageEditor key=\{`coverage\|\$\{session\.mutationContext\.userId\(\) \?\? "-"\}\|\$\{session\.mutationContext\.generation\(\)\}`\} demo=\{demo\} context=\{session\.mutationContext\} \/>/);
});

test("CLI-03 : avis « hors zone publiée » seulement sur une réponse not_covered vérifiée ; jamais bloquant, jamais sur un échec", async () => {
  const calls: string[] = [];
  const reply = (body: unknown, status = 200) => (async (url: RequestInfo | URL) => { calls.push(String(url)); return json(body, status); }) as typeof fetch;
  assert.equal(await m.readNotCovered(reply({ status: "not_covered", version: 2 }), "97217"), true);
  assert.deepEqual(calls, ["/api/public/coverage?postal_code=97217"]);
  assert.equal(await m.readNotCovered(reply({ status: "covered", version: 2 }), "97200"), false);
  assert.equal(await m.readNotCovered(reply({ status: "unknown", version: null }), "97200"), false);
  assert.equal(await m.readNotCovered(reply({ error: "panne" }, 503), "97200"), false);
  assert.equal(await m.readNotCovered(reply({ status: "not_covered" }), "97200"), false, "réponse hors contrat ignorée");
  const before = calls.length;
  assert.equal(await m.readNotCovered(reply({ status: "not_covered", version: 2 }), "9721"), false);
  assert.equal(calls.length, before, "code invalide : aucun appel");
  const text = m.notCoveredNotice("97217");
  assert.match(text, /97217 ne figure pas dans la zone publiée/);
  assert.match(text, /reste enregistrée/);
  assert.doesNotMatch(text, /refus|impossible|bloqu/i);
  // ART-02: artisan wording of the same fact — informative, the declared code is kept.
  const artisan = m.artisanNotCoveredNotice("75001");
  assert.match(artisan, /75001 ne figure pas dans la zone publiée/);
  assert.match(artisan, /Vous pouvez le conserver/);
  assert.doesNotMatch(artisan, /refus|impossible|bloqu/i);
});
