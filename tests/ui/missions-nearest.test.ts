// « Plus proches d’abord » (ROOT 12f62f2): exact URLs; strict ranked page (rankedOfferSchema of
// lib/features/artisan-missions/schema.ts, order nearest_first, distance commune_centre_bands); a page
// of the other order is an error; bands ascending with unknown last; radius_version read from the
// ranked cursor — another version is never appended (restart) nor shown; 422 in nearest ⇒ honest
// refusal without any automatic switch; band labels from the SQL rule greatest(5, ceil(km/5)×5);
// the ?id point read is unchanged (chronological, no band).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/available-missions/available-missions-model";

const m = loadModule("components/features/available-missions/available-missions-model.ts") as unknown as typeof Model;
const ACTOR = "10000000-0000-4000-8000-0000000000ad";
const U = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = (n: number) => `2026-11-0${1 + (n % 5)}T10:00:00.000Z`;
export const offer = (n: number, band: number | null | undefined) => ({
  id: U(n), category: "panel", city: "Fort-de-France", postal_code: "972**", urgency: "scheduled", status: "requested",
  estimate_min_cents: 8000, estimate_max_cents: 15000, created_at: T(n), ...(band === undefined ? {} : { distance_band_km: band }),
});
export const cursor = (last: { id: string; created_at: string; distance_band_km?: number | null }, radiusVersion: number) =>
  Buffer.from(JSON.stringify({ actor_id: ACTOR, created_at: last.created_at, id: last.id, distance_band_km: last.distance_band_km ?? null, radius_version: radiusVersion })).toString("base64url");
export function rankedPage(items: ReturnType<typeof offer>[], more: { radiusVersion: number } | null) {
  return { items, eligible: true, captured_at: "2026-11-07T12:00:00.000Z", page: { limit: 50, has_more: Boolean(more), next_cursor: more ? cursor(items[items.length - 1], more.radiusVersion) : null }, projection: "anonymized", order: "nearest_first", distance: "commune_centre_bands" };
}
const chronoPage = (items: ReturnType<typeof offer>[]) => ({ items, eligible: true, captured_at: "2026-11-07T12:00:00.000Z", page: { limit: 50, has_more: false, next_cursor: null }, projection: "anonymized", order: "oldest_first", distance: "not_calculated" });
const fifty = (from: number, band: number) => Array.from({ length: 50 }, (_, i) => offer(from + i, band));

test("URLs : chronologique inchangé ; plus proches ⇒ order=nearest (+ curseur tel quel) ; lecture ponctuelle inchangée", async () => {
  assert.equal(m.listUrl(null), "/api/artisan/missions");
  assert.equal(m.listUrl("abc_-1"), "/api/artisan/missions?cursor=abc_-1");
  assert.equal(m.listUrl(null, "nearest_first"), "/api/artisan/missions?order=nearest");
  assert.equal(m.listUrl("abc_-1", "nearest_first"), "/api/artisan/missions?order=nearest&cursor=abc_-1");
  const urls: string[] = [];
  const api = m.createMissionsApi((async (u: string) => { urls.push(u); return new Response("{}", { status: 500 }); }) as unknown as typeof fetch);
  await api.point(U(1));
  assert.deepEqual(urls, [`/api/artisan/missions?id=${U(1)}`]);
});

test("page classée stricte : tranches valides, inconnues en dernier, jamais une page de l’autre ordre", () => {
  assert.ok(m.parseMissionsPage(rankedPage([offer(1, 5), offer(2, 10), offer(3, null)], null), "nearest_first"));
  for (const bad of [0, 3, 12, 205, 4.5]) assert.equal(m.parseMissionsPage(rankedPage([offer(1, bad)], null), "nearest_first"), null, String(bad));
  assert.equal(m.parseMissionsPage(rankedPage([offer(1, 10), offer(2, 5)], null), "nearest_first"), null, "ascending bands");
  assert.equal(m.parseMissionsPage(rankedPage([offer(1, null), offer(2, 5)], null), "nearest_first"), null, "unknown last");
  assert.equal(m.parseMissionsPage(rankedPage([offer(1, 5)], null), "oldest_first"), null, "ranked page in chronological");
  assert.equal(m.parseMissionsPage(chronoPage([offer(1, undefined)]), "nearest_first"), null, "chronological page in nearest");
  assert.equal(m.parseMissionsPage({ ...rankedPage([offer(1, 5)], null), distance: "not_calculated" }, "nearest_first"), null);
  assert.ok(m.parseMissionsPage(chronoPage([offer(1, undefined)])), "chronological unchanged");
  const p = m.parseMissionsPage(rankedPage(fifty(1, 15), { radiusVersion: 7 }), "nearest_first")!;
  assert.equal(p.radius_version, 7, "radius_version read from the ranked cursor");
  assert.equal(m.cursorRadiusVersion("not-json"), null);
  assert.equal(m.parseMissionsPage({ ...rankedPage(fifty(1, 15), { radiusVersion: 7 }), page: { limit: 50, has_more: true, next_cursor: "opaque" } }, "nearest_first"), null, "ranked cursor must carry its radius version");
});

test("libellés de tranche (SQL : greatest(5, ceil(km/5)×5)) ; jamais de GPS ni de durée", () => {
  assert.equal(m.bandLabel(5), "jusqu’à 5 km");
  assert.equal(m.bandLabel(10), "5–10 km");
  assert.equal(m.bandLabel(200), "195–200 km");
  assert.equal(m.bandLabel(null), "distance inconnue");
  assert.match(m.NEAREST_COPY.basis, /approximation|approximatives entre centres de communes/);
  assert.match(m.NEAREST_COPY.basis, /ni GPS, ni durée de trajet/);
  const sql = readFileSync("supabase/migrations/20261107212317_rank_artisan_missions.sql", "utf8");
  assert.match(sql, /greatest\(5, ceil\(km \/ 5\)::integer \* 5\)/, "band rule the labels rely on");
});

function controller(order: Model.MissionsOrder, list: (cursor: string | null, order: Model.MissionsOrder | undefined, n: number) => Model.MissionsResult, radiusVersion: number | null = 7) {
  const calls: { cursor: string | null; order: Model.MissionsOrder | undefined }[] = [];
  let s: Model.MissionsState = m.MISSIONS_INITIAL;
  const c = m.createMissionsController({
    api: () => ({ list: async (cursor, o) => { calls.push({ cursor, order: o }); return list(cursor, o, calls.length); }, point: async () => ({ status: 404, body: null, retryAfter: null }) }),
    context: { generation: () => 1, userId: () => ACTOR },
    get: () => s,
    set: (n) => (s = n),
    order,
    radiusVersion,
  });
  return { c, calls, state: () => s };
}
const ok = (body: unknown): Model.MissionsResult => ({ status: 200, body, retryAfter: null });

test("422 en « plus proches » ⇒ refus honnête, aucune bascule automatique vers le chronologique", async () => {
  const h = controller("nearest_first", () => ({ status: 422, body: { error: "x" }, retryAfter: null }));
  await h.c.load();
  assert.equal(h.state().phase, "error");
  assert.equal(h.state().nearestRefused, true);
  assert.equal(h.state().error, m.NEAREST_COPY.refused);
  assert.deepEqual(h.calls, [{ cursor: null, order: "nearest_first" }], "no chronological call behind the user's back");
});

test("version de rayon : page 1 d’une autre version ⇒ jamais affichée ; page 2 d’une autre version ⇒ redémarrage, jamais de mélange", async () => {
  const stale = controller("nearest_first", () => ok(rankedPage(fifty(1, 10), { radiusVersion: 6 })), 7);
  await stale.c.load();
  assert.equal(stale.state().nearestRefused, true);
  assert.equal(stale.state().items.length, 0);
  const h = controller("nearest_first", (cursor, _o, n) => {
    if (cursor === null) return ok(rankedPage(fifty(n * 100, 10), { radiusVersion: n === 1 ? 7 : 8 }));
    return ok(rankedPage([offer(999, 15)], { radiusVersion: 8 }));
  });
  await h.c.load();
  assert.equal(h.state().radiusVersion, 7);
  await h.c.more();
  assert.equal(h.calls.length, 3, "page 1, page 2 (other version), restart at page 1");
  assert.equal(h.calls[2].cursor, null);
  assert.ok(!h.state().items.some((i) => i.id === U(999)), "the other-version page is never appended");
  const mixedOrder = controller("nearest_first", (cursor) => (cursor === null ? ok(rankedPage(fifty(1, 10), { radiusVersion: 7 })) : ok(chronoPage([offer(500, undefined)]))));
  await mixedOrder.c.load();
  await mixedOrder.c.more();
  assert.equal(mixedOrder.state().items.length, 50, "a chronological page is never appended to a ranked list");
  assert.ok(mixedOrder.state().moreError);
});

test("chronologique : appels et comportement inchangés", async () => {
  const h = controller("oldest_first", () => ok(chronoPage([offer(1, undefined)])), null);
  await h.c.load();
  assert.deepEqual(h.calls, [{ cursor: null, order: "oldest_first" }]);
  assert.equal(h.state().phase, "ready");
  assert.equal(h.state().nearestRefused, false);
});
