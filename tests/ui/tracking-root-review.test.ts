// Revue ROOT 0778532 : P2-1 (interruption pendant start), P2-2 (régulation des itinéraires), P2-3 (cadrage adaptatif),
// et correctif 360 (marges des contrôles). Tests déterministes : promesses différées, géolocalisation et horloge factices.
import test from "node:test";
import assert from "node:assert/strict";
import {
  FIT_MIN_ZOOM,
  RouteGate,
  ShareController,
  failureOf,
  fitView,
  haloPoints,
  overlayInsets,
  routeContextKey,
  toScreenPoint,
  userMinZoom,
  type ShareStatus,
} from "../../components/features/tracking/model";
import type { TrackingCommand, TrackingSnapshot } from "../../lib/features/tracking/types";

const NOW = Date.parse("2026-10-31T20:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
function snap(over: Partial<TrackingSnapshot["tracking"]> = {}): TrackingSnapshot {
  return {
    server_time: iso(NOW),
    permissions: { can_share: true, can_confirm_destination: true },
    tracking: {
      intervention_id: "i1", artisan_id: "a1", travel_stage: "en_route", session_id: null, control_version: 3, shared: false,
      consent_at: null, last_seq: 0, destination_version: 2, position_state: "no_position", position: null,
      destination: { latitude: 14.59, longitude: -61.0, label: "D", source: "ign", confirmed_by: "c", confirmed_at: iso(NOW) },
      ...over,
    },
  };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
function rig() {
  const calls: TrackingCommand[] = [];
  const pending: { c: TrackingCommand; d: ReturnType<typeof deferred<TrackingSnapshot | null>> }[] = [];
  let watchCalls = 0;
  const watches = new Map<number, PositionCallback>();
  const statuses: ShareStatus[] = [];
  let now = NOW;
  const ctrl = new ShareController({
    geolocation: {
      watchPosition: (ok: PositionCallback) => {
        watchCalls++;
        watches.set(watchCalls, ok);
        return watchCalls;
      },
      clearWatch: (id: number) => void watches.delete(id),
    },
    now: () => now,
    uuid: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    command: (c) => {
      calls.push(c);
      const d = deferred<TrackingSnapshot | null>();
      pending.push({ c, d });
      return d.promise;
    },
    onSnapshot: () => undefined,
    onStatus: (s) => statuses.push(s),
    online: () => true,
  });
  return { ctrl, calls, pending, statuses, watches, get watchCalls() { return watchCalls; }, tick: (ms: number) => (now += ms), now: () => now };
}
const SID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// ---- P2-1 ------------------------------------------------------------------------------------------
test("P2-1 repro : start en attente → interruption → start résolu ⇒ aucun watch, un seul arrêt compensatoire de cette session", async () => {
  const r = rig();
  const started = r.ctrl.start(snap());
  assert.equal(r.calls[0].action, "start");
  r.ctrl.interrupt("Page masquée");
  r.pending[0].d.resolve(snap({ session_id: SID, shared: true, control_version: 4 }));
  await started;
  await flush();
  assert.equal(r.watchCalls, 0, "watchPosition jamais appelé");
  assert.equal(r.ctrl.watching, false);
  const stops = r.calls.filter((c) => c.action === "stop");
  assert.equal(stops.length, 1, "exactement un arrêt compensatoire");
  assert.deepEqual(stops[0], { action: "stop", expected_version: 4, payload: { session_id: SID } });
  assert.ok(!r.statuses.some((s) => s.kind === "sharing"));
});

test("P2-1 : start résolu à null (identité périmée) après interruption ⇒ aucun arrêt", async () => {
  const r = rig();
  const started = r.ctrl.start(snap());
  r.ctrl.interrupt("Déconnexion");
  r.pending[0].d.resolve(null);
  await started;
  await flush();
  assert.equal(r.calls.filter((c) => c.action === "stop").length, 0);
  assert.equal(r.watchCalls, 0);
});

test("P2-1 : démontage pendant start ⇒ même compensation ; interruptions répétées idempotentes", async () => {
  const r = rig();
  const started = r.ctrl.start(snap());
  r.ctrl.dispose();
  r.ctrl.interrupt("x");
  r.ctrl.interrupt("y");
  r.pending[0].d.resolve(snap({ session_id: SID, shared: true, control_version: 4 }));
  await started;
  await flush();
  assert.equal(r.watchCalls, 0);
  assert.equal(r.calls.filter((c) => c.action === "stop").length, 1);
  assert.equal(r.calls.length, 2, "start + un seul stop");
});

test("P2-1 : interruption pendant un point en attente ⇒ aucun point supplémentaire, arrêt tenté une seule fois", async () => {
  const r = rig();
  const started = r.ctrl.start(snap());
  r.pending[0].d.resolve(snap({ session_id: SID, shared: true }));
  await started;
  assert.equal(r.watchCalls, 1);
  const ok = r.watches.get(1)!;
  ok({ coords: { latitude: 14.6, longitude: -61.07, accuracy: 10 } as GeolocationCoordinates, timestamp: r.now() } as GeolocationPosition);
  await flush();
  assert.equal(r.calls.at(-1)?.action, "point");
  r.ctrl.interrupt("Page masquée");
  r.ctrl.interrupt("Page masquée");
  r.pending.find((p) => p.c.action === "point")!.d.resolve(snap({ session_id: SID, shared: true, last_seq: 1 }));
  await flush();
  r.tick(10_000);
  ok({ coords: { latitude: 14.61, longitude: -61.07, accuracy: 10 } as GeolocationCoordinates, timestamp: r.now() } as GeolocationPosition);
  await flush();
  assert.equal(r.calls.filter((c) => c.action === "point").length, 1, "aucun point après interruption");
  assert.equal(r.calls.filter((c) => c.action === "stop").length, 1, "un seul arrêt");
  assert.equal(r.ctrl.watching, false);
});

// ---- P2-2 ------------------------------------------------------------------------------------------
const KEY = routeContextKey(snap({ session_id: SID, shared: true, last_seq: 5, position_state: "fresh", position: { latitude: 1, longitude: 1, accuracy_m: 5, sampled_at: iso(NOW), received_at: iso(NOW) } }), "fresh");
function simulatePolls(gate: RouteGate, keyAt: (t: number) => string, durationMs: number, stepMs = 15_000) {
  let calls = 0;
  for (let t = NOW; t <= NOW + durationMs; t += stepMs) {
    if (gate.canRequest(t, keyAt(t))) {
      gate.onRequest(t);
      calls++;
    }
  }
  return calls;
}

test("P2-2 : sondage 15 s, état identique ⇒ une route par 30 s ; nouvel objet snapshot même clé ⇒ aucun appel en plus", () => {
  const gate = new RouteGate();
  assert.equal(simulatePolls(gate, () => KEY, 120_000), 5, "t=0,30,60,90,120 s");
  // Même contenu, objet recréé : même clé.
  const a = snap({ session_id: SID, shared: true, last_seq: 5, position_state: "fresh", position: { latitude: 1, longitude: 1, accuracy_m: 5, sampled_at: iso(NOW), received_at: iso(NOW) } });
  const b = structuredClone(a);
  assert.notEqual(a, b);
  assert.equal(routeContextKey(a, "fresh"), routeContextKey(b, "fresh"));
});

test("P2-2 : nouvel état avant 30 s ⇒ aucun appel avant 30 s", () => {
  const gate = new RouteGate();
  assert.equal(gate.canRequest(NOW, "k1"), true);
  gate.onRequest(NOW);
  assert.equal(gate.canRequest(NOW + 10_000, "k2"), false);
  assert.equal(gate.waitMs(NOW + 10_000, "k2"), 20_000);
  assert.equal(gate.canRequest(NOW + 30_000, "k2"), true);
});

test("P2-2 : Retry-After 45 s ⇒ aucun appel (auto ou manuel, même porte) avant 45 s", () => {
  const gate = new RouteGate();
  gate.onRequest(NOW);
  gate.onFailure(NOW, "k1", failureOf({ status: 503, message: "x", reason: "provider_quota", retry_after_s: 45 }));
  assert.equal(gate.canRequest(NOW + 30_000, "k1"), false);
  assert.equal(gate.canRequest(NOW + 44_999, "k2"), false);
  assert.equal(gate.waitMs(NOW + 30_000, "k1"), 15_000);
  assert.equal(gate.canRequest(NOW + 45_000, "k1"), true);
  const g429 = new RouteGate();
  g429.onFailure(NOW, "k", failureOf({ status: 429, message: "x", retry_after_s: 45 }));
  assert.equal(g429.canRequest(NOW + 40_000, "k"), false);
});

test("P2-2 : 409 ⇒ plus aucune route pour cet état, une seule pour le nouvel état ; pas de boucle", () => {
  const gate = new RouteGate();
  gate.onRequest(NOW);
  gate.onFailure(NOW, "k1", failureOf({ status: 409, message: "tracking_changed" }));
  let calls = 0;
  for (let t = NOW + 30_000; t <= NOW + 300_000; t += 15_000) if (gate.canRequest(t, "k1")) { gate.onRequest(t); calls++; }
  assert.equal(calls, 0, "même état bloqué indéfiniment");
  assert.equal(gate.canRequest(NOW + 30_000, "k2"), true);
  assert.equal(routeContextKey(null, "fresh"), "");
  assert.equal(new RouteGate().canRequest(NOW, ""), false, "sans clé (position non fraîche ou sans destination) : jamais");
});

// ---- P2-3 et correctif 360 -------------------------------------------------------------------------
const inside = (p: { x: number; y: number }, W: number, H: number, pad: { top: number; right: number; bottom: number; left: number }) =>
  p.x >= pad.left - 0.5 && p.x <= W - pad.right + 0.5 && p.y >= pad.top - 0.5 && p.y <= H - pad.bottom + 0.5;

test("P2-3 repro : 288×220, points QA [-61.07,14.60] et [-60.87,14.47] ⇒ tous dans le cadre utile", () => {
  const W = 288, H = 220;
  const ins = overlayInsets({ left: 0, top: 0, right: W, bottom: H }, [{ left: W - 52, top: 8, right: W - 8, bottom: 152 }]);
  const pts: [number, number][] = [[-61.07, 14.6], [-60.87, 14.47]];
  const v = fitView(pts, W, H, ins)!;
  assert.equal(v.fits, true);
  assert.ok(v.zoom < 11 && v.zoom >= FIT_MIN_ZOOM, `zoom ${v.zoom}`);
  for (const [lon, lat] of pts) assert.ok(inside(toScreenPoint(v, W, H, lon, lat), W, H, ins), `${lon},${lat}`);
  assert.equal(userMinZoom(v.zoom), v.zoom, "dézoom possible jusqu’au cadrage");
  assert.equal(userMinZoom(14), 11);
});

test("P2-3 : trajet Grand-Rivière ↔ Sainte-Anne avec tracé, mobile et 1280, marges 40 et mobile", () => {
  const route: [number, number][] = [[-61.18, 14.87], [-61.12, 14.78], [-61.06, 14.66], [-61.0, 14.6], [-60.94, 14.52], [-60.88, 14.43]];
  for (const [W, H, pad] of [[288, 220, 24], [288, 220, 40], [760, 475, 40]] as const) {
    const ins = overlayInsets({ left: 0, top: 0, right: W, bottom: H }, [{ left: W - 52, top: 8, right: W - 8, bottom: 152 }], pad);
    const v = fitView(route, W, H, ins)!;
    assert.equal(v.fits, true, `${W}×${H} pad ${pad} zoom ${v.zoom}`);
    for (const [lon, lat] of route) assert.ok(inside(toScreenPoint(v, W, H, lon, lat), W, H, ins));
  }
});

test("P2-3 : géométrie absurde ⇒ non contenue au plancher, signalée (fits=false) ; point unique ⇒ zoom 15", () => {
  const v = fitView([[-61.07, 14.6], [2.35, 48.85]], 288, 220, 40)!;
  assert.equal(v.zoom, FIT_MIN_ZOOM);
  assert.equal(v.fits, false);
  const one = fitView([[-61.0, 14.6]], 288, 220, 40)!;
  assert.equal(one.zoom, 15);
  assert.equal(one.fits, true);
});

test("360 : halo de précision et marqueur au bord droit hors des contrôles", () => {
  const W = 322, H = 201;
  const controls = { left: W - 52, top: 8, right: W - 8, bottom: 152 };
  const ins = overlayInsets({ left: 0, top: 0, right: W, bottom: H }, [controls]);
  const pts = [...haloPoints(-61.068, 14.6035, 120), [-61.0032, 14.5911] as [number, number]];
  const v = fitView(pts, W, H, ins)!;
  for (const [lon, lat] of pts) {
    const p = toScreenPoint(v, W, H, lon, lat);
    assert.ok(p.x + 9 < controls.left || p.y - 26 > controls.bottom, `(${Math.round(p.x)}, ${Math.round(p.y)})`);
  }
});
