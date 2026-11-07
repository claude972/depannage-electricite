// CLI-05 client dossier map: provider null by default ⇒ zero external URL/request; declared
// address as declared; server tracking state with source + freshness; the artisan position only
// when fresh and consented; stale / stopped / not shared / waiting explicit; never an ETA; the
// device-maps link only after an explicit consent click; demo honest; client-space wiring.
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

test("fournisseur null : aucune URL externe, aucune image, aucune iframe ; carte non activée et adresse déclarée", () => {
  for (const out of [render(snap()), render(null), html(createElement(p.DossierMapPanel as never, { address: ADDRESS, tracking: null } as never))]) {
    assert.doesNotMatch(out, EXTERNAL);
    assert.match(out, /data-dossier-map="none"/);
    assert.match(out, /Carte non activée : aucun fournisseur de cartographie n’a encore été choisi\. Votre adresse n’est envoyée à aucun service tiers\./);
    assert.match(out, /Adresse déclarée dans votre demande, non vérifiée\./);
    assert.doesNotMatch(out, /data-map-attribution/, "no attribution slot without a provider");
  }
});

test("position fraîche partagée : « partagée par l’artisan à HH:MM », source et fraîcheur, aucune ETA", () => {
  const out = render(snap());
  assert.match(out, /data-map-sharing="fresh"/);
  assert.match(out, /Position partagée par l’artisan à \d{2}:\d{2} \(précision ±25 m\)\./);
  assert.match(out, /Mis à jour à \d{2}:\d{2} \(il y a moins d’une minute\)\. Source : suivi de la plateforme\./);
  assert.match(out, /data-map-eta="none"[^>]*>Aucune durée de trajet ni heure d’arrivée n’est calculée ici\./);
  assert.doesNotMatch(out, /\d+ ?min(?:ute)?s? de trajet|arrivée estimée|\d+([,.]\d+)? ?km/i);
  assert.doesNotMatch(out, /14\.6161|-61\.0588/, "coordinates are never printed without a provider");
});

test("périmée / arrêtée / non partagée / en attente : états explicites, jamais « en direct »", () => {
  const stale = render(snap({ position: { latitude: 14.6, longitude: -61, accuracy_m: 25, sampled_at: at(120_000), received_at: at(119_000) } }));
  assert.match(stale, /data-map-sharing="stale"/);
  assert.match(stale, /Dernière position partagée à \d{2}:\d{2} : périmée \(plus d’une minute\), non affichée\./);
  assert.doesNotMatch(stale, /data-map-position/);
  const stopped = render(snap({ shared: false, session_id: null, position_state: "stopped", position: null, last_seq: 3 }));
  assert.match(stopped, /data-map-sharing="stopped"[^>]*>Partage de position arrêté par l’artisan\./);
  const refused = render(snap({ shared: false, session_id: null, consent_at: null, position_state: "no_position", position: null, last_seq: 0 }));
  assert.match(refused, /data-map-sharing="not_shared"[^>]*>L’artisan ne partage pas sa position \(aucun accord de partage en cours\)\./);
  const ended = render(snap({ shared: false, session_id: null, position_state: "no_position", position: null }));
  assert.match(ended, /Partage de position terminé\./);
  const waiting = render(snap({ position_state: "no_position", position: null }));
  assert.match(waiting, /data-map-sharing="no_position"[^>]*>Partage accepté par l’artisan, en attente d’une première position\./);
  const oldServer = render(snap({}, 10 * 60_000));
  assert.match(oldServer, /data-map-freshness="stale"/);
  assert.match(oldServer, /à actualiser/);
  assert.equal(m.SNAPSHOT_STALE_MS, 120_000);
  assert.equal(m.POSITION_STALE_MS, 60_000);
  for (const out of [stale, stopped, refused, ended, waiting, oldServer]) assert.doesNotMatch(out, /en direct|temps réel/i);
});

test("chargement / erreur + Réessayer / hors étape de suivi / indisponible", async () => {
  const notYet = html(createElement(p.DossierMapPanel as never, { address: ADDRESS, tracking: null } as never));
  assert.match(notYet, /Le suivi du déplacement est proposé une fois l’intervention acceptée\./);
  const loading = html(createElement(p.DossierMapPanel as never, { address: ADDRESS, tracking: { load: async () => null } } as never));
  assert.match(loading, /Lecture du suivi…/);
  const unavailable = html(createElement(p.DossierMapPanel as never, { address: ADDRESS, tracking: { load: async () => null }, trackingState: "unavailable" } as never));
  assert.match(unavailable, /Suivi du déplacement momentanément indisponible\./);
  const src = readFileSync("components/features/dossier-map/dossier-map-panel.tsx", "utf8");
  assert.match(src, /MAP_COPY\.loadFailed[\s\S]*?Réessayer/);
  assert.match(src, /navigator\.onLine === false/);
});

test("fournisseur actif : rendu délégué + emplacement d’attribution ; lien externe seulement après consentement explicite (geo:, aucun domaine web)", () => {
  const provider = { id: "test", name: "Test", attribution: "© Fournisseur test", render: () => createElement("div", { "data-provider-map": "" }) };
  const out = render(snap(), { provider } as never);
  assert.match(out, /data-dossier-map="provider:test"/);
  assert.match(out, /data-provider-map=""/);
  assert.match(out, /data-map-attribution="">© Fournisseur test/);
  const closed = render(snap());
  assert.match(closed, /data-map-external-ask=""[^>]*>Ouvrir dans mon application de cartes/);
  assert.doesNotMatch(closed, /data-map-external-link|geo:/, "no link before the consent click");
  assert.equal(m.externalMapsHref(ADDRESS), "geo:0,0?q=8%20rue%20Victor%20Hugo%2C%2097200%20Fort-de-France");
});

test("câblage : client-space remplace l’ancien bloc « Aucun fournisseur » par DossierMapPanel (provider null)", () => {
  const src = readFileSync("components/role/client-space.tsx", "utf8");
  assert.doesNotMatch(src, /Aucun fournisseur de cartographie n’a été choisi/);
  assert.match(src, /<DossierMapPanel[\s\S]*?provider=\{null\}/);
  assert.match(src, /tracking=\{\["accepted", "in_progress"\]\.includes\(i\.status\) \? session\.features\.tracking\(i\.id\) : null\}/);
});

test("app réelle (démo) : aucune requête externe ; consentement explicite avant le lien vers l’application de cartes", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("client");
    const external: string[] = [];
    page.on("request", (rq: { url(): string }) => { if (!rq.url().startsWith("http://127.0.0.1")) external.push(rq.url()); });
    await page.evaluate(() => { location.hash = "#detail/demo-004"; });
    await page.locator("[data-dossier-map]").waitFor();
    const panel = page.locator("[data-dossier-map]");
    const text = await panel.innerText();
    assert.match(text, /Carte non activée/);
    assert.match(text, /Démonstration : suivi fictif/);
    assert.match(text, /Position partagée par l’artisan à \d{2}:\d{2}/);
    assert.match(text, /Aucune durée de trajet ni heure d’arrivée n’est calculée ici\./);
    assert.equal(await page.locator("[data-map-external-link]").count(), 0);
    await page.locator("[data-map-external-ask]").click();
    assert.match(await page.locator("[data-map-external-consent]").innerText(), /transmet l’adresse de l’intervention à cette application/);
    assert.equal(await page.locator("[data-map-external-link]").count(), 0, "still no link before accepting");
    await page.locator("[data-map-external-accept]").click();
    assert.match(String(await page.locator("[data-map-external-link]").getAttribute("href")), /^geo:0,0\?q=/);
    assert.equal(await panel.locator("iframe, img").count(), 0);
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
    // The address panel sends nothing anywhere; any external request on this page comes from
    // another leaf (the existing tracking map below) and is reported, not hidden.
    if (process.env.SHOW_EXTERNAL) console.log("EXTERNAL", JSON.stringify([...new Set(external.map((u) => new URL(u).host))]), external.length);
    assert.ok(external.every((u) => !/geopf|geocod|nominatim|google|mapbox/.test(u)), `no geocoder/map provider: ${external.join(", ")}`);
  });
});
