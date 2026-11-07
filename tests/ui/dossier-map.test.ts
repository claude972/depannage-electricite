// CLI-05 client dossier map, reuse pass: ONE map concept (the tracking leaf's TrackingMap, OSM tiles,
// visible attribution) shown only with a fresh consented position and/or a confirmed destination
// from the server; no second map when the « Suivi de l’artisan » card already shows it (pointer
// instead, no duplicate read); declared address as text, never mapped; never an ETA here; the
// device-maps link only after an explicit consent click; client-space wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import { withApp, skip } from "./real-app-harness";
import type * as Model from "../../components/features/dossier-map/dossier-map-model";
import type * as Panel from "../../components/features/dossier-map/dossier-map-panel";

const m = loadModule("components/features/dossier-map/dossier-map-model.ts") as unknown as typeof Model;
const p = loadModule("components/features/dossier-map/dossier-map-panel.tsx") as unknown as typeof Panel;
const html = (el: unknown) => renderToString(el as never).replace(/<!-- -->/g, "");
const NOW = Date.parse("2026-11-07T10:00:00Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const ADDRESS = { address: "8 rue Victor Hugo", postal_code: "97200", city: "Fort-de-France" };
type Over = Partial<Model.MapView> & Record<string, unknown>;
function snap(t: Record<string, unknown> = {}, serverAgo = 5_000) {
  return {
    server_time: at(serverAgo),
    permissions: { can_share: false, can_confirm_destination: true },
    tracking: {
      intervention_id: "20000000-0000-4000-8000-000000000001", artisan_id: "30000000-0000-4000-8000-000000000001", travel_stage: "en_route",
      session_id: "40000000-0000-4000-8000-000000000001", control_version: 1, shared: true, consent_at: at(300_000), last_seq: 3, destination_version: 0,
      position_state: "fresh", position: { latitude: 14.6161, longitude: -61.0588, accuracy_m: 25, sampled_at: at(10_000), received_at: at(9_000) }, destination: null,
      ...t,
    },
  } as never;
}
const render = (snapshot: unknown, extra: Over = {}) =>
  html(createElement(p.DossierMapPanel as never, { address: ADDRESS, tracking: null, demoSnapshot: snapshot, now: () => NOW, ...extra } as never));
const EXTERNAL = /https?:\/\/|<iframe|<img|src=|srcset=|url\(/i;

const NO_POS = { shared: false, session_id: null, consent_at: null, position_state: "no_position", position: null, last_seq: 0 };
const DEST = { latitude: 14.6037, longitude: -61.0677, label: "Destination confirmée QA", source: "manual", confirmed_by: "50000000-0000-4000-8000-000000000001", confirmed_at: at(3_600_000) };

test("sans position récente ni destination confirmée : aucune carte, aucune URL externe ; adresse déclarée en texte", () => {
  for (const out of [render(snap(NO_POS)), render(null), html(createElement(p.DossierMapPanel as never, { address: ADDRESS, tracking: null } as never))]) {
    assert.doesNotMatch(out, EXTERNAL);
    assert.match(out, /data-dossier-map="none"/);
    assert.doesNotMatch(out, /data-map-reused/);
    assert.match(out, /Adresse déclarée dans votre demande, non vérifiée\./);
  }
  assert.match(render(snap(NO_POS)), /Pas de carte pour l’instant : ni position partagée récente ni destination confirmée par le serveur/);
  // A stale position alone never produces a map.
  const stale = render(snap({ position: { latitude: 14.6, longitude: -61, accuracy_m: 25, sampled_at: at(120_000), received_at: at(119_000) } }));
  assert.match(stale, /data-dossier-map="none"/);
});

test("position fraîche partagée et/ou destination confirmée : la carte du suivi (TrackingMap) est réutilisée, attribution OSM visible + mention des tuiles", () => {
  for (const s of [snap(), snap({ ...NO_POS, destination: DEST }), snap({ destination: DEST })]) {
    const out = render(s);
    assert.match(out, /data-dossier-map="map"/);
    assert.match(out, /data-map-reused="tracking-map"/);
    assert.match(out, /© OpenStreetMap contributors/, "the reused map renders its OSM attribution");
    assert.match(out, /data-map-tiles-notice=""[^>]*>Fond de carte chargé depuis OpenStreetMap \(tile\.openstreetmap\.org\) : ce service voit la zone affichée\. Votre adresse déclarée ne lui est pas transmise\./);
    assert.doesNotMatch(out, /<iframe/);
    assert.doesNotMatch(out, /8 rue Victor Hugo[^<]*<\/(?:text|title)/, "the declared address is never put on the map");
  }
  const src = readFileSync("components/features/dossier-map/dossier-map-panel.tsx", "utf8");
  assert.match(src, /import \{ TrackingMap \} from "\.\.\/tracking\/tracking-map";/, "reuse, no second map implementation");
  const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /tile\.|https?:\/\/|geocod/i, "no tile source or geocoder of its own");
});

test("position fraîche : « partagée par l’artisan à HH:MM », fraîcheur, aucune ETA dans ce panneau", () => {
  const out = render(snap());
  assert.match(out, /data-map-sharing="fresh"/);
  assert.match(out, /Position partagée par l’artisan à \d{2}:\d{2} \(précision ±25 m\)\./);
  assert.match(out, /Mis à jour à \d{2}:\d{2} \(il y a moins d’une minute\)\. Source : suivi de la plateforme\./);
  assert.match(out, /data-map-eta="none"[^>]*>Ce panneau ne calcule aucune durée de trajet ni heure d’arrivée/);
  assert.doesNotMatch(out, /arrivée estimée[^.]*\d{2}:\d{2}|\d+([,.]\d+)? ?km/i);
});

test("périmée / arrêtée / non partagée / en attente : états explicites, jamais « en direct »", () => {
  const stale = render(snap({ position: { latitude: 14.6, longitude: -61, accuracy_m: 25, sampled_at: at(120_000), received_at: at(119_000) } }));
  assert.match(stale, /data-map-sharing="stale"/);
  assert.doesNotMatch(stale, /data-map-position/);
  assert.match(render(snap({ shared: false, session_id: null, position_state: "stopped", position: null, last_seq: 3 })), /data-map-sharing="stopped"/);
  assert.match(render(snap(NO_POS)), /data-map-sharing="not_shared"/);
  assert.match(render(snap({ position_state: "no_position", position: null })), /data-map-sharing="no_position"/);
  for (const out of [stale, render(snap(NO_POS))]) assert.doesNotMatch(out, /en direct|temps réel/i);
});

test("carte déjà affichée par « Suivi de l’artisan » : pas de seconde carte ni de second suivi, un renvoi vers la carte", () => {
  let reads = 0;
  const out = html(createElement(p.DossierMapPanel as never, { address: ADDRESS, trackingCardShown: true, tracking: { load: async () => { reads++; return null; } }, demoSnapshot: snap() } as never));
  assert.match(out, /data-dossier-map="in-card"/);
  assert.match(out, /data-map-in-card=""[^>]*>La carte, la position partagée, la destination et l’heure d’arrivée estimée sont affichées dans la section « Suivi de l’artisan » de ce dossier\./);
  assert.match(out, /data-map-go-card=""/);
  assert.doesNotMatch(out, /data-map-reused|data-map-sharing|data-map-eta|OpenStreetMap/, "nothing duplicated from the card");
  assert.doesNotMatch(out, EXTERNAL);
  assert.equal(reads, 0, "no second tracking read");
});

test("lien vers l’application de cartes : uniquement après le clic de consentement (geo:, aucun domaine web)", () => {
  for (const out of [render(snap()), html(createElement(p.DossierMapPanel as never, { address: ADDRESS, trackingCardShown: true, tracking: null } as never))]) {
    assert.match(out, /data-map-external-ask=""[^>]*>Ouvrir dans mon application de cartes/);
    assert.doesNotMatch(out, /data-map-external-link|geo:/);
  }
  assert.equal(m.externalMapsHref(ADDRESS), "geo:0,0?q=8%20rue%20Victor%20Hugo%2C%2097200%20Fort-de-France");
});

test("câblage client-space : le panneau renvoie vers la carte du suivi, mêmes statuts que TrackingAnchor, aucune lecture en double", () => {
  const src = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(src, /trackingCardShown=\{\["accepted", "in_progress"\]\.includes\(i\.status\)\}\s*tracking=\{null\}/);
  assert.match(src, /\{\["accepted", "in_progress"\]\.includes\(i\.status\) && \(/, "the tracking card condition is the same");
  assert.doesNotMatch(src, /provider=\{null\}|Aucun fournisseur de cartographie n’a été choisi/);
});

test("app réelle (démo, dossier accepté) : une seule carte sur la page, seules requêtes tierces = tuiles OSM de la carte du suivi", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("client");
    const external: string[] = [];
    page.on("request", (rq: { url(): string }) => { if (!rq.url().startsWith("http://127.0.0.1")) external.push(rq.url()); });
    await page.evaluate(() => { location.hash = "#detail/demo-004"; });
    await page.locator("[data-dossier-map]").waitFor();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator("[data-dossier-map]").getAttribute("data-dossier-map"), "in-card");
    assert.equal(await page.locator("figure").count(), 1, "exactly one map on the page (the tracking card's)");
    assert.match(await page.locator("[aria-labelledby=tracking-card-title]").innerText(), /OpenStreetMap/);
    await page.locator("[data-map-external-ask]").click();
    assert.equal(await page.locator("[data-map-external-link]").count(), 0);
    await page.locator("[data-map-external-accept]").click();
    assert.match(String(await page.locator("[data-map-external-link]").getAttribute("href")), /^geo:0,0\?q=/);
    assert.ok(external.length > 0 && external.every((u) => new URL(u).host === "tile.openstreetmap.org"), `third-party requests: ${[...new Set(external.map((u) => new URL(u).host))].join(", ")}`);
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
  });
});
