import test from "node:test";
import assert from "node:assert/strict";
import {
  ShareController,
  arrivalEstimate,
  destinationCommand,
  failureOf,
  fitView,
  needsExplicitRestart,
  routeFailureMessage,
  routeMatches,
  trackingDisplay,
  validateManualDestination,
  visibleTiles,
  project,
  unproject,
  type ShareStatus,
  DESTINATION_STOP_WARNING,
  destinationStopsSharing,
  isTrackingChanged,
  mayRequestRoute,
  routeKey,
  overlayInsets,
  toScreenPoint,
} from "../../components/features/tracking/model";
import type { TrackingCommand, TrackingRoute, TrackingSnapshot } from "../../lib/features/tracking/types";

const NOW = Date.parse("2026-10-31T20:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
function snap(over: Partial<TrackingSnapshot["tracking"]> = {}, perms = { can_share: true, can_confirm_destination: false }): TrackingSnapshot {
  return {
    server_time: iso(NOW),
    permissions: perms,
    tracking: {
      intervention_id: "i1", artisan_id: "a1", travel_stage: "en_route", session_id: "s1", control_version: 3, shared: true,
      consent_at: iso(NOW - 600_000), last_seq: 7, destination_version: 2, position_state: "fresh",
      position: { latitude: 14.6, longitude: -61.07, accuracy_m: 12, sampled_at: iso(NOW - 10_000), received_at: iso(NOW - 9_000) },
      destination: { latitude: 14.59, longitude: -61.0, label: "Aéroport", source: "ign", confirmed_by: "c1", confirmed_at: iso(NOW - 3_600_000) },
      ...over,
    },
  };
}
const route = (over: Partial<TrackingRoute> = {}): TrackingRoute => ({
  state: "available", source: "IGN Géoplateforme / BD TOPO", resource: "bdtopo-valhalla", resource_version: "2026-10-29",
  distance_m: 10890.44, duration_s: 783.475, calculated_at: iso(NOW - 5_000), position_sampled_at: iso(NOW - 10_000),
  session_id: "s1", control_version: 3, point_seq: 7, destination_version: 2,
  geometry: { type: "LineString", coordinates: [[-61.07, 14.6], [-61.0, 14.59]] }, snapped_start: [-61.07, 14.6], snapped_end: [-61.0032, 14.5911],
  traffic: "not_available", attribution: "IGN – Licence Ouverte 2.0", ...over,
});

// ---- Affichage : effacement strict ----------------------------------------------------------------
test("position fraîche affichée avec âge ; périmée/arrêtée/absente : coordonnées effacées, heure et raison seules", () => {
  const fresh = trackingDisplay(snap(), NOW)!;
  assert.equal(fresh.kind, "fresh");
  assert.equal(fresh.position?.ageS, 10);
  for (const state of ["stale", "stopped"] as const) {
    const d = trackingDisplay(snap({ position_state: state }), NOW)!;
    assert.equal(d.kind, state);
    assert.equal(d.position, null, `${state} sans coordonnées`);
    assert.equal(d.knownTime, iso(NOW - 10_000));
  }
  const none = trackingDisplay(snap({ position_state: "no_position", position: null, shared: false }), NOW)!;
  assert.equal(none.position, null);
  assert.equal(none.knownTime, null);
  assert.equal(none.reason, "Aucune position partagée");
  // « fresh » côté serveur mais dépassée localement : effacée.
  const late = trackingDisplay(snap(), NOW + 70_000)!;
  assert.equal(late.kind, "stale");
  assert.equal(late.position, null);
  assert.equal(trackingDisplay(null, NOW), null);
});

test("route affichée seulement avec une position fraîche du même état serveur", () => {
  const s = snap();
  const d = trackingDisplay(s, NOW);
  assert.equal(routeMatches(route(), s, d), true);
  assert.equal(routeMatches(route({ point_seq: 6 }), s, d), false);
  assert.equal(routeMatches(route({ destination_version: 1 }), s, d), false);
  assert.equal(routeMatches(route({ session_id: "s0" }), s, d), false);
  const stale = snap({ position_state: "stale" });
  assert.equal(routeMatches(route(), stale, trackingDisplay(stale, NOW)), false);
  assert.equal(routeMatches(null, s, d), false);
});

test("arrivée = calculated_at + duration_s, rien d’autre ; 503 → message sans chiffre d’ETA", () => {
  const a = arrivalEstimate(route())!;
  assert.equal(a.arrivalAt, iso(NOW - 5_000 + 783_475));
  assert.equal(a.durationMin, 13);
  assert.equal(a.distanceKm, 10.9);
  assert.equal(arrivalEstimate(route({ duration_s: 0 })), null);
  for (const reason of ["position_unavailable", "destination_required", "provider_timeout", "provider_unavailable", "route_unavailable", "invalid_provider_response", "server_configuration"]) {
    const m = routeFailureMessage(failureOf({ status: 503, message: "x", reason }));
    assert.ok(m.length > 10 && !/min\b|\d+ ?min|arrivée vers/i.test(m), `${reason}: ${m}`);
  }
  assert.match(routeFailureMessage(failureOf({ status: 503, message: "x", reason: "provider_quota", retry_after_s: 42 })), /42 s/);
});

// ---- Destination ---------------------------------------------------------------------------------
test("destination manuelle validée avant envoi ; commandes destination exactes", () => {
  assert.equal(validateManualDestination({ latitude: "95", longitude: "-61", label: "x" }).ok, false);
  const bad = validateManualDestination({ latitude: "", longitude: "abc", label: "" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ["label", "latitude", "longitude"]);
  const ok = validateManualDestination({ latitude: "14,6035", longitude: "-61.068", label: "  Place de la Savane " });
  assert.deepEqual(ok, { ok: true, value: { latitude: 14.6035, longitude: -61.068, label: "Place de la Savane" } });
  const s = snap();
  assert.deepEqual(destinationCommand(s, { kind: "clear" }), { action: "destination", expected_version: 3, payload: { clear: true } });
  assert.deepEqual(destinationCommand(s, { kind: "manual", latitude: 14.6, longitude: -61.06, label: "Portail" }).payload, { latitude: 14.6, longitude: -61.06, label: "Portail", source: "manual" });
  const c = destinationCommand(s, { kind: "candidate", candidate: { latitude: 14.6, longitude: -61.07, label: "Place de la Savane", score: 0.82, type: "locality" } });
  assert.equal((c.payload as { source: string }).source, "ign");
});

// ---- Carte -----------------------------------------------------------------------------------------
test("projection Web Mercator réversible ; tuiles visibles seulement, nombre borné", () => {
  const p = project(-61.068, 14.6035, 15);
  const back = unproject(p.x, p.y, 15);
  assert.ok(Math.abs(back.lon + 61.068) < 1e-9 && Math.abs(back.lat - 14.6035) < 1e-9);
  const view = fitView([[-61.068, 14.6035], [-61.0032, 14.5911]], 1000, 625)!;
  assert.ok(view.zoom >= 11 && view.zoom <= 17);
  const tiles = visibleTiles(view.center, view.zoom, 1000, 625);
  assert.ok(tiles.length > 0 && tiles.length <= 20, `tuiles ${tiles.length}`);
  assert.ok(tiles.every((t) => t.url.startsWith("https://tile.openstreetmap.org/")));
  const small = visibleTiles(project(-61.068, 14.6035, 16), 16, 328, 205);
  assert.ok(small.length <= 6);
});

// ---- Partage artisan : géolocalisation et horloge injectées ----------------------------------------
type Watch = { ok: (p: GeolocationPosition) => void; err: (e: GeolocationPositionError) => void };
function harness(opts: { command?: (c: TrackingCommand) => Promise<TrackingSnapshot | null>; online?: boolean } = {}) {
  let now = NOW;
  const watches = new Map<number, Watch>();
  const cleared: number[] = [];
  let nextId = 1;
  const calls: TrackingCommand[] = [];
  const statuses: ShareStatus[] = [];
  const geolocation = {
    watchPosition: (ok: PositionCallback, err?: PositionErrorCallback | null) => {
      const id = nextId++;
      watches.set(id, { ok, err: err ?? (() => undefined) });
      return id;
    },
    clearWatch: (id: number) => {
      cleared.push(id);
      watches.delete(id);
    },
  };
  const ctrl = new ShareController({
    geolocation,
    now: () => now,
    uuid: () => "11111111-1111-4111-8111-111111111111",
    command: async (c) => {
      calls.push(c);
      return opts.command ? opts.command(c) : snap({ session_id: "11111111-1111-4111-8111-111111111111", last_seq: c.action === "point" ? c.payload.seq : 0 });
    },
    onSnapshot: () => undefined,
    onStatus: (s) => statuses.push(s),
    online: () => opts.online ?? true,
  });
  const pos = (lat: number, accuracy = 10, ageMs = 0) =>
    ({ coords: { latitude: lat, longitude: -61.07, accuracy } as GeolocationCoordinates, timestamp: now - ageMs } as GeolocationPosition);
  const fire = async (p: GeolocationPosition) => {
    for (const w of [...watches.values()]) w.ok(p);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { ctrl, watches, cleared, calls, statuses, pos, fire, tick: (ms: number) => (now += ms), geolocation };
}

test("aucun watchPosition avant consentement et démarrage serveur réussi", async () => {
  const h = harness();
  h.ctrl.askConsent();
  assert.equal(h.watches.size, 0);
  await h.ctrl.start(snap({ shared: false, session_id: null }));
  assert.equal(h.calls[0].action, "start");
  assert.deepEqual(h.calls[0].payload, { session_id: "11111111-1111-4111-8111-111111111111", consent: true, consent_policy: "tracking-v1" });
  assert.equal(h.watches.size, 1);
});

test("start refusé ou chaîne périmée : aucun watch, aucun succès", async () => {
  const refused = harness({ command: async () => Promise.reject(Object.assign(new Error("Mission non attribuée."), { status: 403 })) });
  await refused.ctrl.start(snap());
  assert.equal(refused.watches.size, 0);
  assert.equal(refused.statuses.at(-1)?.kind, "error");
  const stale = harness({ command: async () => null });
  await stale.ctrl.start(snap());
  assert.equal(stale.watches.size, 0);
  assert.ok(!stale.statuses.some((s) => s.kind === "sharing"));
  const noRight = harness();
  await noRight.ctrl.start(snap({}, { can_share: false, can_confirm_destination: false }));
  assert.equal(noRight.calls.length, 0);
});

test("points : au plus 1 / 5 s, seq croissant ; imprécis, anciens ou hors ligne non envoyés", async () => {
  const h = harness();
  await h.ctrl.start(snap());
  await h.fire(h.pos(14.6));
  await h.fire(h.pos(14.601));
  assert.deepEqual(h.calls.filter((c) => c.action === "point").length, 1);
  h.tick(5000);
  await h.fire(h.pos(14.602));
  const points = h.calls.filter((c) => c.action === "point") as Extract<TrackingCommand, { action: "point" }>[];
  assert.deepEqual(points.map((p) => p.payload.seq), [1, 2]);
  h.tick(5000);
  await h.fire(h.pos(14.603, 300));
  h.tick(5000);
  await h.fire(h.pos(14.604, 10, 61_000));
  assert.equal(h.calls.filter((c) => c.action === "point").length, 2);
  const off = harness({ online: false });
  await off.ctrl.start(snap());
  await off.fire(off.pos(14.6));
  assert.equal(off.calls.filter((c) => c.action === "point").length, 0);
});

test("clearWatch et génération : arrêt, arrivée, masquage, démontage ; rappels anciens ignorés", async () => {
  for (const exit of ["stop", "arrived", "interrupt", "dispose"] as const) {
    const h = harness();
    await h.ctrl.start(snap());
    const [id] = [...h.watches.keys()];
    const listener = h.watches.get(id)!;
    if (exit === "stop" || exit === "arrived") await h.ctrl.finish(exit);
    else if (exit === "interrupt") h.ctrl.interrupt("Page masquée");
    else h.ctrl.dispose();
    assert.deepEqual(h.cleared, [id], exit);
    assert.equal(h.ctrl.watching, false);
    const before = h.calls.length;
    h.tick(10_000);
    listener.ok(h.pos(14.7));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.calls.filter((c) => c.action === "point").length, h.calls.slice(0, before).filter((c) => c.action === "point").length, `${exit}: rappel ancien ignoré`);
    if (exit === "interrupt" || exit === "dispose") assert.equal(h.calls.at(-1)?.action, "stop", `${exit}: arrêt serveur tenté`);
  }
});

test("arrêt au mieux : échec serveur silencieux, aucune confirmation ; état « interrompu » sans reprise", async () => {
  const h = harness({ command: async (c) => (c.action === "stop" ? Promise.reject(Object.assign(new Error("réseau"), { status: 0 })) : snap()) });
  await h.ctrl.start(snap());
  h.ctrl.interrupt("Page masquée : partage interrompu.");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.statuses.at(-1)?.kind, "interrupted");
  assert.equal(h.watches.size, 0);
  assert.equal(needsExplicitRestart(snap({ shared: true }), false), true);
  assert.equal(needsExplicitRestart(snap({ shared: true }), true), false);
});

test("permission refusée : watch coupé, message de réglage ; 409 sur un point : arrêt local", async () => {
  const h = harness();
  await h.ctrl.start(snap());
  for (const w of h.watches.values()) w.err({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
  assert.equal(h.watches.size, 0);
  assert.match((h.statuses.at(-1) as { message: string }).message, /réglages/);
  const conflict = harness({ command: async (c) => (c.action === "point" ? Promise.reject(Object.assign(new Error("Session remplacée."), { status: 409 })) : snap()) });
  await conflict.ctrl.start(snap());
  await conflict.fire(conflict.pos(14.6));
  assert.equal(conflict.watches.size, 0);
  assert.equal(conflict.statuses.at(-1)?.kind, "error");
});

test("reprise après rechargement : stop de l’ancienne session, puis consentement, puis start avec une nouvelle session", async () => {
  const h = harness();
  const live = snap({ shared: true, session_id: "old-session", control_version: 5 });
  assert.equal(h.calls.length, 0, "rien n’est envoyé avant le clic");
  await h.ctrl.closeStaleSession(live, async () => live);
  assert.deepEqual(h.calls.map((c) => c.action), ["stop"]);
  assert.deepEqual(h.calls[0], { action: "stop", expected_version: 5, payload: { session_id: "old-session" } });
  assert.equal(h.statuses.at(-1)?.kind, "consent");
  assert.equal(h.watches.size, 0);
  await h.ctrl.start(snap({ shared: false, session_id: null, control_version: 6 }));
  assert.deepEqual(h.calls.map((c) => c.action), ["stop", "start"]);
  assert.notEqual((h.calls[1].payload as { session_id: string }).session_id, "old-session");
  assert.equal(h.watches.size, 1);
});

test("reprise : stop refusé (409) → relecture du snapshot, aucun start, aucune nouvelle tentative", async () => {
  let reloads = 0;
  const h = harness({ command: async (c) => (c.action === "stop" ? Promise.reject(Object.assign(new Error("Version dépassée."), { status: 409 })) : snap()) });
  await h.ctrl.closeStaleSession(snap({ shared: true, session_id: "old" }), async () => {
    reloads++;
    return snap({ shared: false, session_id: null, position_state: "stopped" });
  });
  assert.equal(reloads, 1);
  assert.deepEqual(h.calls.map((c) => c.action), ["stop"]);
  assert.equal(h.statuses.at(-1)?.kind, "error");
  // Sans session active ou sans droit : rien n’est envoyé.
  const idle = harness();
  await idle.ctrl.closeStaleSession(snap({ shared: false }), async () => null);
  await idle.ctrl.closeStaleSession(snap({ shared: true }, { can_share: false, can_confirm_destination: false }), async () => null);
  assert.equal(idle.calls.length, 0);
});

test("P3-3 : confirmer/retirer une destination arrête le partage — dit avant ; côté artisan, nouveau consentement + start", async () => {
  assert.equal(destinationStopsSharing(snap({ shared: true })), true);
  assert.equal(destinationStopsSharing(snap({ shared: false })), false);
  assert.match(DESTINATION_STOP_WARNING, /arrêté/);
  // Serveur : la session a été arrêtée par la destination → le prochain point reçoit 409.
  let stopped = false;
  const h = harness({
    command: async (c) => {
      if (c.action === "point" && stopped) throw Object.assign(new Error("Session arrêtée."), { status: 409 });
      return snap({ session_id: "11111111-1111-4111-8111-111111111111", last_seq: c.action === "point" ? c.payload.seq : 0 });
    },
  });
  await h.ctrl.start(snap());
  stopped = true;
  await h.fire(h.pos(14.6));
  assert.equal(h.watches.size, 0);
  const err = h.statuses.at(-1) as Extract<ShareStatus, { kind: "error" }>;
  assert.equal(err.kind, "error");
  assert.equal(err.retryable, true);
  h.ctrl.askConsent();
  assert.equal(h.statuses.at(-1)?.kind, "consent");
  await h.ctrl.start(snap({ shared: false, session_id: null }));
  assert.equal(h.calls.filter((c) => c.action === "start").length, 2);
  assert.equal(h.watches.size, 1);
});

test("P3-4 : route 409 → relecture ; nouvelle demande au plus une fois par nouvel état, jamais pour le même", () => {
  const s1 = snap({ last_seq: 7 });
  assert.equal(isTrackingChanged(failureOf({ status: 409, message: "x", reason: "tracking_changed" })), true);
  assert.equal(isTrackingChanged(failureOf({ status: 503, message: "x", reason: "route_unavailable" })), false);
  const blocked = routeKey(s1);
  assert.equal(mayRequestRoute(s1, blocked), false, "même état : aucune nouvelle demande");
  assert.equal(mayRequestRoute(snap({ last_seq: 8 }), blocked), true, "nouvel état : une demande");
  assert.equal(mayRequestRoute(snap({ destination_version: 3 }), blocked), true);
  assert.equal(mayRequestRoute(null, null), false);
  // Pendant ce temps, l’ancienne route n’est jamais affichée.
  assert.equal(routeMatches(route({ point_seq: 7 }), snap({ last_seq: 8 }), trackingDisplay(snap({ last_seq: 8 }), NOW)), false);
});

test("cadrage avec marges : un marqueur au bord droit reste hors de la zone des contrôles à 360 et 1280", () => {
  for (const [W, H] of [[322, 201], [651, 407]] as const) {
    const frame = { left: 0, top: 0, right: W, bottom: H };
    // Boîte des contrôles telle que mesurée (colonne 44 px, 3 boutons + écarts, à 8 px du bord haut/droit).
    const controls = { left: W - 8 - 44, top: 8, right: W - 8, bottom: 8 + 44 * 3 + 6 * 2 };
    const ins = overlayInsets(frame, [controls]);
    assert.ok(ins.right >= 52 + 16, `marge droite ${ins.right}`);
    // Position à l’ouest, destination tout à l’est (bord droit du contenu).
    const pts: [number, number][] = [[-61.068, 14.6035], [-61.0032, 14.5911]];
    const view = fitView(pts, W, H, ins)!;
    for (const [lon, lat] of pts) {
      const p = toScreenPoint(view, W, H, lon, lat);
      const pinTop = p.y - 26;
      const insideControls = p.x + 9 >= controls.left && p.x - 9 <= controls.right && p.y >= controls.top && pinTop <= controls.bottom;
      assert.equal(insideControls, false, `${W}px : marqueur (${Math.round(p.x)}, ${Math.round(p.y)}) sous les contrôles`);
      assert.ok(p.x <= W - ins.right + 0.5 && p.x >= ins.left - 0.5, "dans la zone utile");
    }
    assert.ok(view.zoom >= 11 && view.zoom <= 17);
  }
  // Point unique : zoom de quartier (15 au plus), centré dans la zone utile.
  const one = fitView([[-61.0032, 14.5911]], 322, 201, overlayInsets({ left: 0, top: 0, right: 322, bottom: 201 }, [{ left: 270, top: 8, right: 314, bottom: 152 }]))!;
  assert.equal(one.zoom, 15);
  assert.ok(toScreenPoint(one, 322, 201, -61.0032, 14.5911).x < 270);
});
