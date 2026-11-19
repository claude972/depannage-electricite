// Artisan mission radius (contract from ROOT; backend in parallel, injected api). Strict parse;
// bounds refused locally (0, 201, decimals) and both-null clear; command fenced under
// courant-private-mission-radius:<uid>:<gen> (read-back or 0 POST, strict restore, identity change ⇒
// dropped, 401/403 clear, 409 honest + reload, 503 same command, 422 bounds message); a confirmed save
// reports every CONFIRMED preference through onConfirmed (host restarts offers on a version change);
// « Relire le réglage » after an uncertain reply never claims a cancellation; no geolocation, no client-side filtering; demo zero calls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/mission-radius/model";
import type * as Panel from "../../components/features/mission-radius/mission-radius-panel";

const m = loadModule("components/features/mission-radius/model.ts") as unknown as typeof Model;
const p = loadModule("components/features/mission-radius/mission-radius-panel.tsx") as unknown as typeof Panel;
const UID = "10000000-0000-4000-8000-0000000000ac";
const VIEW = (o: { version?: number; reference_code?: string | null; radius_km?: number | null } = {}) => ({
  preference: { version: o.version ?? 3, reference_code: o.reference_code === undefined ? null : o.reference_code, radius_km: o.radius_km === undefined ? null : o.radius_km },
  options: [{ code: "97209", name: "Fort-de-France" }, { code: "97213", name: "Le Lamentin" }],
  source: { url: "https://geo.api.gouv.fr/communes", retrieved_at: "2026-11-01" },
  basis: "commune_centres",
  unknown_postal_policy: "postal_only",
});

test("lecture stricte : préférence cohérente, commune listée, base et politique exactes", () => {
  assert.ok(m.parseView(VIEW()));
  assert.ok(m.parseView(VIEW({ reference_code: "97209", radius_km: 25 })));
  assert.equal(m.parseView(VIEW({ reference_code: "97209", radius_km: null })), null, "both or none");
  assert.equal(m.parseView(VIEW({ reference_code: "99999", radius_km: 10 })), null, "commune must be listed");
  assert.equal(m.parseView(VIEW({ reference_code: "97209", radius_km: 201 })), null);
  assert.equal(m.parseView({ ...VIEW(), basis: "gps" }), null);
  assert.equal(m.parseView({ ...VIEW(), unknown_postal_policy: "exclude" }), null);
  assert.equal(m.parseView({ ...VIEW(), extra: 1 }), null);
  assert.equal(m.parseView({ ...VIEW(), source: { url: "javascript:alert(1)", retrieved_at: "2026-11-01" } }), null);
  assert.equal(m.parseView({ ...VIEW(), options: [{ code: "1", name: "a" }, { code: "1", name: "b" }] }), null, "unique codes");
  assert.ok(m.parseView({ ...VIEW(), source: { url: "https://x.test/a", retrieved_at: "2026-11-01T10:00:00Z" } }));
});

test("bornes : 0, 201, décimales, vide refusés localement ; 1 et 200 acceptés ; effacer = les deux null", () => {
  const v = m.parseView(VIEW({ reference_code: "97209", radius_km: 25 }))!;
  for (const bad of ["0", "201", "12.5", "", "-3", "1e2", " "]) assert.equal((m.formToCommand("97209", bad, v) as { error: string }).error, m.COPY.bounds, bad);
  assert.equal((m.formToCommand("", "10", v) as { error: string }).error, m.COPY.pickCommune);
  assert.equal((m.formToCommand("99999", "10", v) as { error: string }).error, m.COPY.pickCommune);
  assert.equal(JSON.stringify(m.formToCommand("97213", "1", v)), JSON.stringify({ command: { expected_version: 3, reference_code: "97213", radius_km: 1 } }));
  assert.equal(JSON.stringify(m.formToCommand("97213", "200", v)), JSON.stringify({ command: { expected_version: 3, reference_code: "97213", radius_km: 200 } }));
  assert.equal(JSON.stringify(m.clearCommand(v)), JSON.stringify({ expected_version: 3, reference_code: null, radius_km: null }));
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
type Reply = Model.Result | Promise<Model.Result>;
function ctrl(load: () => Reply, save: (body: Model.RadiusCommand, n: number) => Reply, o: { store?: Model.Store | null; ctx?: { uid: string | null; gen: number } } = {}) {
  const calls: { kind: string; body?: unknown }[] = [];
  const ctx = o.ctx ?? { uid: UID, gen: 1 };
  const mem = memStore();
  const store = o.store === undefined ? mem.store : o.store;
  let view: Model.View = m.VIEW_INITIAL;
  const confirmed: Model.ConfirmedRadius[] = [];
  const c = m.createRadiusController({
    api: () => ({
      load: async () => { calls.push({ kind: "GET" }); return load(); },
      save: async (body) => { calls.push({ kind: "POST", body }); return save(body, calls.length); },
    }),
    store: () => store,
    context: { generation: () => ctx.gen, userId: () => ctx.uid },
    get: () => view,
    set: (v) => (view = v),
    onConfirmed: (p) => confirmed.push(p),
  });
  return { c, calls, mem, ctx, view: () => view, versions: () => confirmed.map((x) => `${x.version}${x.active ? "+" : "-"}`) };
}
const ok = (body: unknown): Model.Result => ({ status: 200, body, retryAfterS: null });
const status = (s: number, retryAfterS: number | null = null): Model.Result => ({ status: s, body: { error: "x" }, retryAfterS });
const echo = (b: Model.RadiusCommand) => ok(VIEW({ version: b.expected_version + 1, reference_code: b.reference_code, radius_km: b.radius_km }));

test("enregistrer : commande stockée et relue avant le POST, réponse = même vue, préférences confirmées remontées ; refus local ⇒ 0 POST", async () => {
  assert.equal(m.PENDING_PREFIX, "courant-private-mission-radius:");
  assert.equal(m.pendingKey(UID, 1), `courant-private-mission-radius:${UID}:1`);
  let stored: string | undefined;
  const h = ctrl(() => ok(VIEW()), (b) => { stored = h.mem.map.get(m.pendingKey(UID, 1)); return echo(b); });
  await h.c.load();
  assert.equal(await h.c.save("97209", "0"), false);
  assert.equal(await h.c.save("97209", "201"), false);
  assert.equal(h.calls.filter((x) => x.kind === "POST").length, 0, "bounds refused locally");
  assert.equal(h.view().error, m.COPY.bounds);
  assert.equal(await h.c.clear(), false, "nothing to clear");
  assert.equal(await h.c.save("97209", "25"), true);
  assert.equal(JSON.stringify(h.calls[1].body), JSON.stringify({ expected_version: 3, reference_code: "97209", radius_km: 25 }));
  assert.equal(JSON.parse(stored!).command.radius_km, 25);
  assert.equal(h.mem.map.size, 0);
  assert.deepEqual(h.versions(), ["3-", "4+"], "GET then the confirmed save");
  assert.equal(h.view().data!.preference.radius_km, 25);
  assert.equal(await h.c.clear(), true);
  assert.equal(JSON.stringify(h.calls[2].body), JSON.stringify({ expected_version: 4, reference_code: null, radius_km: null }));
  assert.equal(h.view().notice, m.COPY.cleared);
  assert.deepEqual(h.versions(), ["3-", "4+", "5-"]);
  // A reply that does not carry what was sent is not a confirmation.
  const bad = ctrl(() => ok(VIEW()), () => ok(VIEW({ version: 4, reference_code: "97213", radius_km: 25 })));
  await bad.c.load();
  await bad.c.save("97209", "25");
  assert.deepEqual(bad.versions(), ["3-"], "an unconfirmed reply is never reported");
  assert.equal(bad.view().error, m.COPY.retry);
});

test("stockage absent / relecture fausse ⇒ 0 POST", async () => {
  for (const store of [null, { get: () => null, set: () => {}, remove: () => {} } as Model.Store]) {
    const h = ctrl(() => ok(VIEW()), (b) => echo(b), { store });
    await h.c.load();
    await h.c.save("97209", "25");
    assert.equal(h.calls.filter((x) => x.kind === "POST").length, 0);
    assert.equal(h.view().error, m.COPY.storage);
  }
});

test("503 / perdu ⇒ même commande ; 401/403 ⇒ effacé ; 409 ⇒ honnête + relecture sans rejeu ; 422 ⇒ message de bornes", async () => {
  const h = ctrl(() => ok(VIEW()), (b, n) => (n === 2 ? status(503, 2) : n === 3 ? status(0) : echo(b)));
  await h.c.load();
  await h.c.save("97209", "25");
  assert.equal(h.view().waitS, 2);
  assert.ok(h.mem.map.has(m.pendingKey(UID, 1)));
  await h.c.retry();
  await h.c.retry();
  const posts = h.calls.filter((x) => x.kind === "POST").map((x) => JSON.stringify(x.body));
  assert.equal(posts.length, 3);
  assert.equal(new Set(posts).size, 1);
  assert.deepEqual(h.versions(), ["3-", "4+"]);
  for (const s of [401, 403]) {
    const f = ctrl(() => ok(VIEW()), () => status(s));
    await f.c.load();
    await f.c.save("97209", "25");
    assert.equal(f.view().phase, "forbidden");
    assert.equal(f.view().data, null);
    assert.equal(f.mem.map.size, 0);
  }
  const k = ctrl(() => ok(VIEW()), () => status(409));
  await k.c.load();
  await k.c.save("97209", "25");
  assert.equal(k.view().error, m.COPY.conflict);
  assert.deepEqual(k.calls.map((x) => x.kind), ["GET", "POST", "GET"]);
  assert.equal(await k.c.retry(), false);
  assert.deepEqual(k.versions(), ["3-", "3-"], "409 ⇒ re-read reported (same version: nothing to restart)");
  const u = ctrl(() => ok(VIEW()), () => status(422));
  await u.c.load();
  await u.c.save("97209", "25");
  assert.equal(u.view().error, m.COPY.serverBounds);
  assert.match(m.COPY.serverBounds, /1 à 200 km/);
});

test("changement d’identité pendant le POST ⇒ ignoré ; restauration stricte", async () => {
  const shared = memStore();
  const h = ctrl(() => ok(VIEW()), () => { h.ctx.gen = 2; return status(503); }, { store: shared.store });
  await h.c.load();
  await h.c.save("97209", "25");
  assert.equal(h.view().pending, null);
  assert.equal(await h.c.retry(), false);
  const g2 = ctrl(() => ok(VIEW()), (b) => echo(b), { store: shared.store, ctx: { uid: UID, gen: 2 } });
  g2.c.restorePending();
  assert.equal(g2.view().pending, null);
  const g1 = ctrl(() => ok(VIEW()), (b) => echo(b), { store: shared.store });
  g1.c.restorePending();
  assert.equal(g1.view().pending!.radius_km, 25);
  await g1.c.retry();
  assert.deepEqual(g1.versions(), ["4+"]);
  const t = memStore();
  t.store.set(m.pendingKey(UID, 1), JSON.stringify({ uid: "other", gen: 1, command: { expected_version: 1, reference_code: null, radius_km: null } }));
  const tampered = ctrl(() => ok(VIEW()), (b) => echo(b), { store: t.store });
  tampered.c.restorePending();
  assert.equal(tampered.view().pending, null);
  assert.equal(t.map.size, 0);
});

test("aucune géolocalisation, aucun filtrage côté client ; libellés d’approximation ; démo sans appel ; montage", () => {
  const leaf = ["model.ts", "mission-radius-panel.tsx", "contract.ts"].map((f) => readFileSync(`components/features/mission-radius/${f}`, "utf8")).join("\n");
  assert.doesNotMatch(leaf, /navigator\.geolocation|getCurrentPosition|watchPosition/);
  assert.doesNotMatch(leaf, /available-missions|\.filter\(\s*\(?\w+\)?\s*=>\s*\w+\.(distance|postal)/, "no client-side filtering of offers");
  assert.match(m.COPY.basis, /^Rayon indicatif entre centres de communes[\s\S]*approximation entre centres de communes[\s\S]*Votre position n’est jamais utilisée/);
  assert.match(m.COPY.unknownPostal, /^Les offres dont le code postal ne permet pas d’identifier une commune unique restent soumises à vos zones postales/);
  const demo = renderToString(createElement(p.MissionRadiusPanel as never, { demo: true, context: { generation: () => 1, userId: () => null }, onConfirmed: () => {} } as never));
  assert.match(demo, /aucun appel n’est fait/);
  assert.doesNotMatch(demo, /<button|<select|<input/);
  const artisan = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(artisan, /<MissionRadiusPanel\s+demo=\{demo\}\s+context=\{session\.mutationContext\}\s+recheck=\{radiusCheck\}\s+onAttention=\{revealRadiusError\}\s+onConfirmed=/);
  assert.match(artisan, /\|\$\{confirmed\?\.rev \?\? 0\}\|\$\{shownOrder\}`\}/);
  const missions = readFileSync("components/features/available-missions/available-missions-panel.tsx", "utf8");
  const missionsModel = readFileSync("components/features/available-missions/available-missions-model.ts", "utf8");
  for (const src of [missions, missionsModel]) assert.doesNotMatch(src, /\.filter\([^)]*(distance_band_km|radius_km)|radius_km/, "the server applies the radius: no client-side filtering");
});

test("409 ⇒ relecture : nouvelle version confirmée remontée (offres relancées) ; réponse incertaine ⇒ « Relire le réglage », sans annonce d’annulation", async () => {
  let server = VIEW();
  const k = ctrl(() => ok(server), () => { server = VIEW({ version: 7, reference_code: "97213", radius_km: 40 }); return status(409); });
  await k.c.load();
  await k.c.save("97209", "25");
  assert.deepEqual(k.versions(), ["3-", "7+"], "the re-read after 409 reports the new version");
  assert.equal(k.view().data!.preference.version, 7);
  let srv = VIEW();
  const u = ctrl(() => ok(srv), () => { srv = VIEW({ version: 4, reference_code: "97209", radius_km: 25 }); return status(503); });
  await u.c.load();
  await u.c.save("97209", "25");
  assert.ok(u.view().pending);
  assert.ok(u.mem.map.has(m.pendingKey(UID, 1)));
  assert.equal(await u.c.reread(), true);
  assert.deepEqual(u.versions(), ["3-", "4+"], "the confirmed read is reported (version changed ⇒ offers refresh)");
  assert.equal(u.view().pending, null);
  assert.equal(u.mem.map.size, 0);
  assert.equal(u.view().notice, m.COPY.reread);
  assert.doesNotMatch(m.COPY.reread, /annul/i, "never claims a cancellation");
  assert.match(m.COPY.reread, /a pu être pris en compte ou non/);
  // A failed re-read keeps the pending command (nothing proven).
  const f = ctrl(() => ok(VIEW()), () => status(503));
  await f.c.load();
  await f.c.save("97209", "25");
  const g = ctrl(() => status(503), () => status(503), { store: f.mem.store });
  g.c.restorePending();
  assert.equal(await g.c.reread(), false);
  assert.ok(g.view().pending);
  assert.ok(f.mem.map.has(m.pendingKey(UID, 1)));
  assert.doesNotMatch(readFileSync("components/features/mission-radius/mission-radius-panel.tsx", "utf8"), /Abandonner/);
});
