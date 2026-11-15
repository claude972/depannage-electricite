// Energy CSV export (ROOT b404b4f contract, copied — not cherry-picked): the query is exactly the
// displayed consolidation's plus `format=csv`; private GET (same-origin credentials, no-store); a file
// only for 200 text/csv with a body; server filename sanitized; honest error per status (401/403/404/
// 422/503 + Retry-After); off-contract reply ⇒ nothing saved; demo ⇒ note, no button.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/energy-consolidation/model";
import type * as Panel from "../../components/features/energy-consolidation/energy-consolidation-panel";

const m = loadModule("components/features/energy-consolidation/model.ts") as unknown as typeof Model;
const p = loadModule("components/features/energy-consolidation/energy-consolidation-panel.tsx") as unknown as typeof Panel;
const html = (el: unknown) => renderToString(el as never).replace(/<!-- -->/g, "");
const ORG = "10000000-0000-4000-8000-000000000001";
const S1 = "20000000-0000-4000-8000-000000000001", S2 = "20000000-0000-4000-8000-000000000002";
const SEL = { organization_id: ORG, site_ids: [S2, S1], from: "2026-02-01", to: "2026-02-28", previous_from: null, previous_to: null };
const CMP = { ...SEL, previous_from: "2026-01-01", previous_to: "2026-01-31" };

type Call = { url: string; init: RequestInit };
function fake(reply: () => Response) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return reply();
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}
const csv = (headers: Record<string, string> = {}, body = "﻿Niveau;Organisation\r\nsite;x") =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="rapport-energie.csv"', "Cache-Control": "private, no-store", ...headers } });

test("requête CSV = exactement les filtres affichés + format=csv (sites dans l’ordre, comparaison seulement si demandée)", () => {
  assert.equal(m.energyCsvUrl(SEL as never), `${m.energyUrl(SEL as never)}&format=csv`);
  assert.equal(m.energyCsvUrl(SEL as never), `/api/organizations/${ORG}/energy?site_ids=${S2}%2C${S1}&from=2026-02-01&to=2026-02-28&format=csv`);
  assert.equal(m.energyCsvUrl(CMP as never), `/api/organizations/${ORG}/energy?site_ids=${S2}%2C${S1}&from=2026-02-01&to=2026-02-28&previous_from=2026-01-01&previous_to=2026-01-31&format=csv`);
});

test("téléchargement privé : GET same-origin, credentials, no-store ; fichier avec le nom du serveur", async () => {
  const { calls, fetcher } = fake(() => csv());
  const out = await m.fetchCsv(fetcher, CMP as never);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, m.energyCsvUrl(CMP as never));
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(out.kind, "file");
  if (out.kind === "file") {
    assert.equal(out.filename, "rapport-energie.csv");
    assert.ok(out.blob.size > 0);
  }
});

test("nom de fichier issu de Content-Disposition, assaini (pas de chemin, pas de caractères de contrôle, .csv obligatoire)", () => {
  assert.equal(m.exportFilename('attachment; filename="rapport-energie.csv"'), "rapport-energie.csv");
  assert.equal(m.exportFilename("attachment; filename=rapport-2026.csv"), "rapport-2026.csv");
  assert.equal(m.exportFilename("attachment; filename*=UTF-8''rapport%20%C3%A9nergie.csv"), "rapport-nergie.csv");
  assert.equal(m.exportFilename('attachment; filename="../../etc/passwd"'), "rapport-energie.csv");
  assert.equal(m.exportFilename('attachment; filename="..\\\\evil.csv"'), "evil.csv");
  assert.equal(m.exportFilename('attachment; filename="rapport.csv.exe"'), "rapport-energie.csv");
  assert.equal(m.exportFilename('attachment; filename=".hidden.csv"'), "hidden.csv");
  assert.equal(m.exportFilename('attachment; filename="a\u0000b\r\n.csv"'), "a-b-.csv");
  assert.equal(m.exportFilename(null), "rapport-energie.csv");
  assert.equal(m.exportFilename("attachment"), "rapport-energie.csv");
});

test("réponse hors contrat (mauvais type, corps vide) ⇒ aucun fichier", async () => {
  for (const reply of [
    () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
    () => new Response("a;b", { status: 200, headers: { "Content-Type": "text/html" } }),
    () => new Response("a;b", { status: 200 }),
    () => csv({}, ""),
  ]) {
    const out = await m.fetchCsv(fake(reply).fetcher, SEL as never);
    assert.equal(out.kind, "off-contract");
  }
});

test("erreurs par statut : 401/403/404/422/503 (+ Retry-After), réseau ; messages honnêtes", async () => {
  for (const status of [401, 403, 404, 422]) {
    const out = await m.fetchCsv(fake(() => Response.json({ error: "x" }, { status })).fetcher, SEL as never);
    assert.equal(JSON.stringify(out), JSON.stringify({ kind: "error", status, retryAfterS: null }));
  }
  const busy = await m.fetchCsv(fake(() => Response.json({ error: "x" }, { status: 503, headers: { "Retry-After": "30" } })).fetcher, SEL as never);
  assert.equal(JSON.stringify(busy), JSON.stringify({ kind: "error", status: 503, retryAfterS: 30 }));
  const vague = await m.fetchCsv(fake(() => Response.json({}, { status: 503, headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" } })).fetcher, SEL as never);
  assert.equal(JSON.stringify(vague), JSON.stringify({ kind: "error", status: 503, retryAfterS: null }));
  const net = await m.fetchCsv((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch, SEL as never);
  assert.equal(JSON.stringify(net), JSON.stringify({ kind: "error", status: 0, retryAfterS: null }));
  const slow = await m.fetchCsv((() => new Promise(() => {})) as unknown as typeof fetch, SEL as never, 20);
  assert.equal(JSON.stringify(slow), JSON.stringify({ kind: "error", status: m.ENERGY_TIMEOUT, retryAfterS: null }));

  assert.match(m.exportError(401, null), /Session expirée/);
  assert.match(m.exportError(403, null), /droits actuels/);
  assert.match(m.exportError(404, null), /introuvable dans votre périmètre/);
  assert.match(m.exportError(422, null), /1 à 50 sites, 366 jours au plus par période, 500 compteurs/);
  assert.match(m.exportError(503, 30), /réessayez dans 30 s/);
  assert.match(m.exportError(503, null), /réessayez plus tard/);
  for (const s of [401, 403, 404, 422, 503, 0, m.ENERGY_TIMEOUT]) assert.match(m.exportError(s, null), /aucun fichier|Réessayez/i);
});

test("panneau : bouton désactivé tant qu’aucune consolidation valide n’est affichée ; démo ⇒ note, aucun bouton", () => {
  const ctx = { generation: () => 1, userId: () => "manager-1" };
  const sites = [{ id: S1, name: "Résidence QA" }];
  const idle = html(createElement(p.EnergyConsolidationPanel as never, { organizationId: ORG, sites, demo: false, context: ctx } as never));
  assert.match(idle, /<button type="button"[^>]*disabled=""[^>]*>Exporter en CSV<\/button>/);
  assert.match(idle, /disponible une fois une sélection valide consolidée/);
  const demo = html(createElement(p.EnergyConsolidationPanel as never, { organizationId: ORG, sites, demo: true, context: ctx } as never));
  assert.doesNotMatch(demo, /<button/);
  assert.match(demo, /n’est pas exportée en démonstration/);
});
