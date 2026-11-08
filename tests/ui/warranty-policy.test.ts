// PUB-06 / ADM-10 warranty conditions UI (contract lib/features/warranty-policy/contract.ts, backend
// 8539838). Real model + SSR of the real components; fake API / store only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/warranty-policy/model";

const m = loadModule("components/features/warranty-policy/model.ts") as unknown as typeof Model;
const pub = loadModule("components/features/warranty-policy/public-warranty-terms.tsx") as Record<string, any>;
const ed = loadModule("components/features/warranty-policy/warranty-policy-editor.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const USER = "10000000-0000-4000-8000-000000000001";
const NEW = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AT = "2026-11-07T10:00:00.000Z";
const PUB = { version: 2, title: "Conditions 2026", body: "Article 1\nTexte saisi par l’exploitant.", published_at: AT };
const editorBody = (over: Record<string, unknown> = {}) => ({ version: 3, draft: { title: "Brouillon", body: "Nouveau texte" }, published: PUB, operator_enabled: false, environment_enabled: true, enabled: false, ...over });
const res = (status: number, body: unknown = null) => ({ status, body });
function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
function harness({ loads = [] as Model.Result[], posts = [] as ((c: Model.PolicyCommand) => Model.Result | Promise<Model.Result>)[], store = memStore().store as Model.Store | null, ids = [NEW(1), NEW(2)], ctx = { uid: USER as string | null, gen: 0 } } = {}) {
  const calls: { kind: string; body?: Model.PolicyCommand; stored?: string | null }[] = [];
  let s: Model.EditorState = { ...m.EDITOR_INITIAL };
  const c = m.createEditorController({
    api: () => ({
      load: async () => (calls.push({ kind: "GET" }), loads.shift() ?? res(200, editorBody())),
      command: async (body) => (calls.push({ kind: "POST", body, stored: store?.get(m.pendingKey(ctx.uid, ctx.gen)) ?? null }), (posts.shift() ?? (() => res(503)))(body)),
    }),
    store: () => store, newId: () => ids.shift() ?? null, context: { generation: () => ctx.gen, userId: () => ctx.uid }, get: () => s, set: (n) => (s = n),
  });
  return { c, calls, ctx, get: () => s };
}
const receipt = (c: Model.PolicyCommand, replayed = false) => res(200, { version: c.expected_version + 1, action: c.action, replayed });

test("public : seul le texte PUBLIÉ, en texte brut (HTML inerte, retours à la ligne conservés) ; aucun ⇒ « non encore publiées »", () => {
  const hostile = { ...PUB, title: "<img src=x onerror=alert(1)>", body: "<script>alert(1)</script>\nLigne 2 <b>gras</b>" };
  same(m.parsePublicTerms({ published: hostile }), hostile);
  for (const bad of [{}, { published: { ...PUB, extra: 1 } }, { published: { ...PUB, body: "" } }, { published: PUB, draft: {} }]) assert.equal(m.parsePublicTerms(bad), undefined, JSON.stringify(bad));
  const html = renderToString(createElement(pub.PublicWarrantyTerms, { state: { phase: "ready", published: hostile } }));
  assert.doesNotMatch(html, /<script|<b>|<img/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;\nLigne 2 &lt;b&gt;gras&lt;\/b&gt;/, "text node with the line break intact");
  assert.match(text(html), /Version 2 publiée par l’exploitant le 7 novembre 2026\./);
  const none = text(renderToString(createElement(pub.PublicWarrantyTerms, { state: { phase: "ready", published: null } })));
  assert.match(none, /Conditions de garantie non encore publiées par l’exploitant\. Aucune garantie n’est promise tant qu’elles ne sont pas publiées\./);
  assert.match(text(renderToString(createElement(pub.PublicWarrantyTerms, { state: { phase: "error", published: null } }))), /momentanément indisponibles\. Aucune garantie n’est déduite/);
  assert.match(readFileSync("components/features/warranty-policy/warranty-policy.module.css", "utf8"), /\.plain \{[^}]*white-space: pre-wrap;/);
  assert.doesNotMatch(readFileSync("components/features/warranty-policy/public-warranty-terms.tsx", "utf8") + readFileSync("components/features/warranty-policy/warranty-policy-editor.tsx", "utf8"), /dangerouslySetInnerHTML|innerHTML/);
});

test("éditeur : commande écrite ET relue AVANT le POST ; stockage absent / en échec / non relu ⇒ 0 POST", async () => {
  const mem = memStore();
  const h = harness({ store: mem.store, posts: [receipt] });
  await h.c.load();
  assert.equal(await h.c.save("  Conditions 2027  ", " Texte\nsur deux lignes "), true);
  const post = h.calls.find((c) => c.kind === "POST")!;
  same(post.body, { command_id: NEW(1), expected_version: 3, action: "save", title: "Conditions 2027", body: "Texte\nsur deux lignes" });
  same(JSON.parse(post.stored!), { uid: USER, gen: 0, command: post.body }, "persisted before the POST");
  same([h.calls.map((c) => c.kind), mem.map.size, h.get().notice], [["GET", "POST", "GET"], 0, m.ACTION_NOTICE.save]);
  const broken: Model.Store[] = [
    { get: () => null, set: () => { throw new Error("quota"); }, remove: () => {} },
    { get: () => "autre chose", set: () => {}, remove: () => {} },
  ];
  for (const store of [...broken, null]) {
    const x = harness({ store });
    await x.c.load();
    assert.equal(await x.c.save("T", "B"), false);
    same([x.calls.map((c) => c.kind), x.get().error], [["GET"], m.EDITOR_COPY.storage]);
  }
  const anon = harness({ ctx: { uid: null, gen: 0 } });
  await anon.c.load();
  assert.equal(await anon.c.save("T", "B"), false);
  same(anon.calls.map((c) => c.kind), ["GET"]);
  const noId = harness({ ids: [] });
  await noId.c.load();
  assert.equal(await noId.c.publish(), false);
  same([noId.calls.map((c) => c.kind), noId.get().error], [["GET"], m.EDITOR_COPY.noUuid]);
});

test("réponse perdue / 503 ⇒ même commande sur action explicite ; restauration stricte, jamais d’envoi automatique ; changement d’identité ⇒ aucun rejeu", async () => {
  const mem = memStore();
  const a = harness({ store: mem.store, posts: [() => res(m.WP_TIMEOUT), () => res(503)] });
  await a.c.load();
  await a.c.publish();
  await a.c.retry();
  const bodies = a.calls.filter((c) => c.kind === "POST").map((c) => JSON.stringify(c.body));
  same([bodies.length, bodies[0] === bodies[1]], [2, true]);
  assert.equal(await a.c.withdraw(), false, "no new command while one is pending");
  // Reload in the same tab, same identity: offered, never sent by itself.
  const b = harness({ store: mem.store, posts: [receipt] });
  b.c.restorePending();
  await b.c.load();
  same([JSON.stringify(b.get().pending), b.calls.map((c) => c.kind)], [bodies[0], ["GET"]]);
  await b.c.retry();
  same([JSON.stringify(b.calls[1].body), mem.map.size], [bodies[0], 0]);
  // Another generation / malformed payload: removed, never offered.
  mem.map.set(m.pendingKey(USER, 0), JSON.stringify({ uid: USER, gen: 0, command: { action: "publish" } }));
  const bad = harness({ store: mem.store });
  bad.c.restorePending();
  same([bad.get().pending, mem.map.size], [null, 0]);
  mem.map.set(m.pendingKey(USER, 1), bodies[0]);
  const other = harness({ store: mem.store, ctx: { uid: USER, gen: 1 } });
  other.c.restorePending();
  same([other.get().pending, mem.map.has(m.pendingKey(USER, 1))], [null, false]);
  // Identity changes while a POST is in flight: reply ignored, retry refused.
  let release!: (r: Model.Result) => void;
  const g = harness({ posts: [() => new Promise((r) => (release = r))] });
  await g.c.load();
  const p = g.c.disable();
  g.ctx.gen = 1;
  release(res(503));
  assert.equal(await p, false);
  same([g.get().notice, g.get().pending], ["", null]);
  const r = harness({ posts: [() => res(503)] });
  await r.c.load(); await r.c.disable();
  r.ctx.uid = "10000000-0000-4000-8000-000000000002";
  assert.equal(await r.c.retry(), false);
  same([r.get().pending, r.calls.filter((c) => c.kind === "POST").length], [null, 1]);
});

test("401/403 ⇒ tout effacé ; 409 ⇒ relecture sans rejeu ; reçu non conforme ⇒ issue inconnue", async () => {
  for (const status of [401, 403]) {
    const mem = memStore();
    const h = harness({ store: mem.store, posts: [() => res(status)] });
    await h.c.load();
    await h.c.save("T", "B");
    same([h.get().phase, h.get().data, h.get().pending, mem.map.size], ["forbidden", null, null, 0], String(status));
    const g = harness({ loads: [res(status)] });
    await g.c.load();
    same([g.get().phase, g.get().data], ["forbidden", null]);
  }
  const mem = memStore();
  const c = harness({ store: mem.store, posts: [() => res(409)], loads: [res(200, editorBody()), res(200, editorBody({ version: 4 }))] });
  await c.c.load();
  await c.c.publish();
  same([c.get().error, c.get().pending, mem.map.size, c.calls.map((x) => x.kind), c.get().data!.version], [m.EDITOR_COPY.conflict, null, 0, ["GET", "POST", "GET"], 4]);
  assert.equal(await c.c.retry(), false);
  const odd = harness({ posts: [(cmd) => res(200, { version: cmd.expected_version + 2, action: cmd.action, replayed: false })] });
  await odd.c.load(); await odd.c.disable();
  same([odd.get().error, odd.get().pending?.action], [m.EDITOR_COPY.retry, "disable"]);
});

test("activation : uniquement par action explicite, sur la version publiée courante ; jamais au chargement ni à la publication", async () => {
  const h = harness({ posts: [receipt, receipt], loads: [res(200, editorBody()), res(200, editorBody({ version: 4, operator_enabled: false, published: { ...PUB, version: 4 } })), res(200, editorBody({ version: 5, operator_enabled: true, enabled: true, published: { ...PUB, version: 4 } }))] });
  await h.c.load();
  same(h.calls.map((c) => c.kind), ["GET"], "a read never mutates");
  await h.c.publish();
  same(h.calls.filter((c) => c.kind === "POST").map((c) => c.body!.action), ["publish"], "publishing never activates");
  await h.c.enable();
  same(h.calls.filter((c) => c.kind === "POST")[1].body, { command_id: NEW(2), expected_version: 4, action: "enable", published_version: 4 });
  for (const body of [editorBody({ published: null }), editorBody({ operator_enabled: true, enabled: true })]) {
    const x = harness({ loads: [res(200, body)] });
    await x.c.load();
    assert.equal(await x.c.enable(), false);
    same(x.calls.map((c) => c.kind), ["GET"]);
  }
  const empty = harness({ loads: [res(200, editorBody({ draft: { title: "", body: "" } }))] });
  await empty.c.load();
  assert.equal(await empty.c.publish(), false, "an empty draft is never published");
  for (const bad of [editorBody({ enabled: true }), editorBody({ operator_enabled: true, published: null }), { ...editorBody(), extra: 1 }]) assert.equal(m.parseEditor(bad), null, JSON.stringify(bad).slice(0, 80));
  const env = text(renderToString(createElement(ed.WarrantyPolicyEditor, { context: { generation: () => 0, userId: () => USER }, initial: { ...m.EDITOR_INITIAL, phase: "ready", data: m.parseEditor(editorBody({ operator_enabled: true, environment_enabled: false, enabled: false })) } })));
  assert.match(env, /Activation par l’opérateur Activée pour la version publiée Garde d’environnement du service Fermée Dépôt des demandes Fermé/);
  assert.match(env, /même activé par l’opérateur, le dépôt reste fermé/);
});

test("rendu éditeur, démo sans appel, câblage public, aucune formulation de garantie inventée", () => {
  const html = renderToString(createElement(ed.WarrantyPolicyEditor, { context: { generation: () => 0, userId: () => USER }, initial: { ...m.EDITOR_INITIAL, phase: "ready", data: m.parseEditor(editorBody()) } }));
  assert.match(html, /data-warranty-enable=""[^>]*>Activer le dépôt pour la version <!-- -->2<!-- -->…/);
  assert.match(text(html), /Version des conditions 3 Publication en ligne Version 2 « Conditions 2026 »/);
  assert.match(html, /data-warranty-published-body="">Article 1\nTexte saisi par l’exploitant\./);
  let called = 0;
  const demo = renderToString(createElement(ed.WarrantyPolicyEditor, { demo: true, context: { generation: () => 0, userId: () => USER }, api: { load: async () => (called++, res(200)), command: async () => (called++, res(200)) } }));
  assert.match(text(demo), /En démonstration, les conditions de garantie ne sont ni lues ni enregistrées, et rien n’est activé\./);
  same(called, 0);
  const site = readFileSync("components/role/public-site.tsx", "utf8");
  assert.match(site, /<div id="garantie" data-public-warranty="">\s*<PublicWarrantyTerms state=\{warrantyTerms\} \/>/);
  const lists = readFileSync("components/role/public-lists.ts", "utf8");
  assert.doesNotMatch(lists, /garantie d’un an|suivi de garantie/);
  const leaf = ["model.ts", "warranty-policy-editor.tsx", "public-warranty-terms.tsx"].map((f) => readFileSync(`components/features/warranty-policy/${f}`, "utf8")).join("\n");
  assert.doesNotMatch(leaf + lists, /\b(un|1|deux|2|dix|10) (an|ans|mois)\b|pièces et main|garantie décennale|couverture (totale|complète)|garanti à vie/i);
  const css = readFileSync("components/features/warranty-policy/warranty-policy.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb|hsl/i);
  assert.match(css, /\.button \{[^}]*min-height: 44px;/);
});

test("wiring: admin-warranty mounts the editor (identity-keyed) next to the panel; client FAQ promises no invented warranty", async () => {
  const { readFileSync } = await import("node:fs");
  const admin = readFileSync("components/role/admin-space.tsx", "utf8");
  assert.match(admin, /case "admin-warranty":\s+content = \(\s+<>\s+<WarrantyPolicyEditor key=\{`\$\{session\.mutationContext\.userId\(\) \?\? "-"\}\|\$\{session\.mutationContext\.generation\(\)\}`\} context=\{session\.mutationContext\} demo=\{demo\} \/>\s+<WarrantyPanel demo=\{demo\} role="admin" context=\{session\.mutationContext\} \/>/); // ADM-10: identity fence of the paged history
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  assert.doesNotMatch(client, /garantie d’un an/);
  assert.match(client, /conditions de garantie de la plateforme figurent dans l’aide publique/);
});
