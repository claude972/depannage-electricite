// ADM-04 — full client record in the admin space: profile from GET /api/admin/directory?kind=clients&id=…
// (only the fields that route returns), dossiers from GET /api/admin/interventions?client_id=… paginated
// with the server cursor (bound to the client), reset on client change, stale replies ignored by sequence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Admin from "../../components/role/admin-space";
import type { AdminInterventionsPage, DirectoryClient } from "../../components/app/types";

const a = loadModule("components/role/admin-space.tsx") as unknown as typeof Admin;
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

const CLIENT = "20000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const ARTISAN = "30000000-0000-4000-8000-000000000001";
const job = (n: number, client = CLIENT) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`.replace(/^4/, client === CLIENT ? "4" : "5");

// Real-shaped replies: `item` of GET /api/admin/directory?kind=clients&id=… (columns id,full_name,phone,role,created_at)
// and the body of GET /api/admin/interventions?client_id=… (listFields + page + echoed filters).
const profile: DirectoryClient = { id: CLIENT, full_name: "Camille Durand", phone: "+33 6 12 34 56 78", role: "manager", created_at: "2026-10-01T09:00:00.123456+00:00" };
const row = (n: number, client = CLIENT) => ({
  id: job(n, client),
  client_id: client,
  artisan_id: n % 2 ? ARTISAN : null,
  site_id: null,
  category: "panel" as const,
  city: "Lyon",
  postal_code: "69003",
  urgency: n % 2 ? ("urgent" as const) : ("scheduled" as const),
  status: "requested" as const,
  created_at: `2026-11-0${n}T10:00:00+00:00`,
  updated_at: `2026-11-0${n}T10:00:00+00:00`,
});
const filtersEcho = (client: string) => ({ status: null, category: null, urgency: null, site_id: null, artisan_id: null, client_id: client, created_from: null, created_to: null, q: null });
const pageOf = (rows: ReturnType<typeof row>[], next: string | null, total: number, client = CLIENT): AdminInterventionsPage =>
  ({ interventions: rows, page: { limit: 25, has_more: next !== null, next_cursor: next, total }, filters: filtersEcho(client) }) as unknown as AdminInterventionsPage;

const noop = () => {};
const render = (state: Admin.ClientRecordState, caps: { dir?: string; lists?: string } = {}) =>
  renderToString(
    createElement(a.ClientRecord as never, {
      state,
      directoryState: caps.dir ?? "available",
      listsState: caps.lists ?? "available",
      artisanName: (id: string | null | undefined) => (id === ARTISAN ? "Alex Martin" : undefined),
      onOpenDossier: noop,
      onClose: noop,
      onRetryProfile: noop,
      onRetryDossiers: noop,
      onFirstPage: noop,
      onNext: noop,
      onPrevious: noop,
    } as never),
  ).replace(/<!-- -->/g, "");

test("fermée : rien n’est rendu ; ouverture = deux requêtes en chargement, premier page sans curseur", () => {
  assert.equal(render(a.CLIENT_RECORD_CLOSED), "");
  const s = a.clientRecordOpen(a.CLIENT_RECORD_CLOSED, CLIENT);
  assert.deepEqual(json(s), {
    clientId: CLIENT,
    seq: 2,
    profile: { seq: 1 },
    dossiers: { seq: 2, position: { cursor: null, offset: 0 }, previous: [] },
  });
  assert.deepEqual(json(a.clientDossiersQuery(s)), { client_id: CLIENT, limit: a.CLIENT_DOSSIERS_LIMIT, cursor: null });
  const html = render(s);
  assert.match(html, new RegExp(`data-client-record="${CLIENT}"`));
  assert.match(html, /Chargement de la fiche client…/);
  assert.match(html, /Chargement des dossiers du client…/);
});

test("profil rendu depuis une réponse réelle de l’annuaire, sans champ inventé", () => {
  let s = a.clientRecordOpen(a.CLIENT_RECORD_CLOSED, CLIENT);
  s = a.clientRecordProfileReply(s, s.profile.seq, profile);
  s = a.clientRecordDossiersReply(s, s.dossiers.seq, pageOf([row(2), row(1)], null, 2));
  assert.deepEqual(json(s.profile.item), json(profile));
  const html = render(s);
  assert.match(html, /<dt>Nom<\/dt><dd>Camille Durand<\/dd>/);
  assert.match(html, /<dt>Téléphone<\/dt><dd>\+33 6 12 34 56 78<\/dd>/);
  assert.match(html, /<dt>Type<\/dt><dd>Entreprise cliente<\/dd>/);
  assert.match(html, /<dt>Inscription<\/dt><dd>[^<]*2026[^<]*<\/dd>/);
  assert.match(html, new RegExp(`<dd class="mono">${CLIENT}</dd>`));
  assert.doesNotMatch(html, /<dt>(Adresse|E-mail|Email|Sites?)<\/dt>/, "no field the directory route does not return");
  // Dossiers table: each row opens the existing intervention detail.
  assert.match(html, /Dossiers de Camille Durand/);
  assert.equal((html.match(/>Ouvrir</g) || []).length, 2);
  assert.match(html, /Alex Martin/);
  assert.match(html, /2 dossiers/);
  assert.match(html, /fin de la liste/);
  // Empty phone is honest, not invented.
  const noPhone = a.clientRecordProfileReply(a.clientRecordOpen(a.CLIENT_RECORD_CLOSED, CLIENT), 1, { ...profile, phone: "" });
  assert.match(render(noPhone), /<dt>Téléphone<\/dt><dd><span class="muted">Non renseigné<\/span><\/dd>/);
  // A reply naming another identity is not this client's record.
  const foreign = a.clientRecordProfileReply(a.clientRecordOpen(a.CLIENT_RECORD_CLOSED, CLIENT), 1, { ...profile, id: OTHER });
  assert.equal(foreign.profile.item, null);
});

test("pagination des dossiers par curseur serveur, « Précédent » rejoue le curseur gardé", () => {
  let s = a.clientRecordOpen(a.CLIENT_RECORD_CLOSED, CLIENT);
  s = a.clientRecordDossiersReply(s, s.dossiers.seq, pageOf([row(3), row(2)], "CURSOR_P2", 3));
  assert.match(render(s), /lignes 1 à 2 affichées · d’autres dossiers suivent/);
  const p2 = a.clientRecordNext(s);
  assert.equal(p2.dossiers.page, undefined, "next page is loading");
  assert.deepEqual(json(a.clientDossiersQuery(p2)), { client_id: CLIENT, limit: 25, cursor: "CURSOR_P2" });
  assert.deepEqual(json(p2.dossiers.position), { cursor: "CURSOR_P2", offset: 2 });
  assert.deepEqual(json(p2.dossiers.previous), [{ cursor: null, offset: 0 }]);
  const loaded = a.clientRecordDossiersReply(p2, p2.dossiers.seq, pageOf([row(1)], null, 3));
  assert.match(render(loaded), /ligne 3 affichée · fin de la liste/);
  assert.equal(a.clientRecordNext(loaded), loaded, "no next page without a cursor");
  const back = a.clientRecordPrevious(loaded);
  assert.deepEqual(json(a.clientDossiersQuery(back)), { client_id: CLIENT, limit: 25, cursor: null });
  assert.deepEqual(json(back.dossiers.previous), []);
  assert.equal(a.clientRecordPrevious(a.clientRecordDossiersReply(back, back.dossiers.seq, s.dossiers.page!)).dossiers.seq, back.dossiers.seq, "no previous on page 1");
});

test("changement de client : curseur remis à zéro, réponses de l’ancien client ignorées", () => {
  let s = a.clientRecordOpen(a.CLIENT_RECORD_CLOSED, CLIENT);
  s = a.clientRecordProfileReply(s, s.profile.seq, profile);
  s = a.clientRecordDossiersReply(s, s.dossiers.seq, pageOf([row(3), row(2)], "CURSOR_P2", 3));
  const onP2 = a.clientRecordNext(s);
  const staleProfileSeq = onP2.profile.seq;
  const staleDossiersSeq = onP2.dossiers.seq;
  const other = a.clientRecordOpen(onP2, OTHER);
  assert.equal(other.clientId, OTHER);
  assert.deepEqual(json(other.dossiers.position), { cursor: null, offset: 0 });
  assert.deepEqual(json(other.dossiers.previous), []);
  assert.deepEqual(json(a.clientDossiersQuery(other)), { client_id: OTHER, limit: 25, cursor: null });
  assert.equal(other.profile.item, undefined);
  assert.equal(other.dossiers.page, undefined);
  // The page-2 reply and the profile of the previous client arrive late: ignored.
  assert.equal(a.clientRecordDossiersReply(other, staleDossiersSeq, pageOf([row(1)], null, 3)), other);
  assert.equal(a.clientRecordProfileReply(other, staleProfileSeq, profile), other);
  // A reply carrying rows of another client is never shown as this client's dossiers.
  const mixed = a.clientRecordDossiersReply(other, other.dossiers.seq, pageOf([row(1)], null, 1));
  assert.equal(mixed.dossiers.page, null);
  // Closing then reopening keeps sequences monotonic: a reply issued before closing stays stale.
  const reopened = a.clientRecordOpen(a.clientRecordClose(other), CLIENT);
  assert.ok(reopened.dossiers.seq > other.dossiers.seq);
  assert.equal(a.clientRecordDossiersReply(reopened, other.dossiers.seq, pageOf([row(1)], null, 1)), reopened);
  assert.equal(a.clientRecordDossiersReply(a.clientRecordClose(other), other.dossiers.seq, pageOf([row(1, OTHER)], null, 1, OTHER)).dossiers.page, undefined);
});

test("une nouvelle tentative rend la réponse précédente obsolète", () => {
  const s = a.clientRecordOpen(a.CLIENT_RECORD_CLOSED, CLIENT);
  const failed = a.clientRecordDossiersReply(s, s.dossiers.seq, null);
  const retry = a.clientRecordRetryDossiers(failed);
  assert.ok(retry.dossiers.seq > s.dossiers.seq);
  assert.equal(a.clientRecordDossiersReply(retry, s.dossiers.seq, pageOf([row(1)], null, 1)), retry);
  const ok = a.clientRecordDossiersReply(retry, retry.dossiers.seq, pageOf([row(1)], null, 1));
  assert.equal(ok.dossiers.page?.interventions.length, 1);
  const profileRetry = a.clientRecordRetryProfile(a.clientRecordProfileReply(s, s.profile.seq, null));
  assert.equal(profileRetry.profile.item, undefined);
  assert.equal(a.clientRecordProfileReply(profileRetry, s.profile.seq, profile), profileRetry);
});

test("erreurs (avec « Réessayer ») et états vides", () => {
  const s = a.clientRecordOpen(a.CLIENT_RECORD_CLOSED, CLIENT);
  const failed = a.clientRecordDossiersReply(a.clientRecordProfileReply(s, s.profile.seq, null), s.dossiers.seq, null);
  const html = render(failed);
  assert.match(html, /Fiche client indisponible/);
  assert.match(html, /Ce client est introuvable dans l’annuaire ou l’annuaire n’a pas répondu\./);
  assert.match(html, /Dossiers du client indisponibles/);
  assert.equal((html.match(/Réessayer/g) || []).length, 2);
  assert.doesNotMatch(html, /Chargement/);
  assert.doesNotMatch(html, /fin de la liste/, "no pager without a page");
  // Contract not deployed: the honest contract state is passed through.
  assert.match(render(failed, { dir: "not_deployed", lists: "not_deployed" }), /Dossiers du client indisponibles/);
  // Empty first page vs. emptied later page.
  const empty = a.clientRecordDossiersReply(s, s.dossiers.seq, pageOf([], null, 0));
  const emptyHtml = render(empty);
  assert.match(emptyHtml, /Aucun dossier pour ce client/);
  assert.match(emptyHtml, /0 dossiers/);
  let p = a.clientRecordDossiersReply(s, s.dossiers.seq, pageOf([row(3), row(2)], "CURSOR_P2", 3));
  p = a.clientRecordNext(p);
  p = a.clientRecordDossiersReply(p, p.dossiers.seq, pageOf([], null, 2));
  assert.match(render(p), /Cette page ne contient plus de dossier/);
  assert.match(render(p), /Revenir au début de la liste/);
  const first = a.clientRecordFirstPage(p);
  assert.deepEqual(json(a.clientDossiersQuery(first)), { client_id: CLIENT, limit: 25, cursor: null });
});

test("câblage : le hook interroge les vraies routes via la session et la vue Clients ouvre la fiche", () => {
  const src = readFileSync("components/role/admin-space.tsx", "utf8");
  const hook = src.slice(src.indexOf("function useClientRecord("), src.indexOf("export function ClientRecord("));
  assert.match(hook, /\.loadAdminDirectoryItem\("clients", clientId\)\s*\.then\(\(item\) => setState\(\(s\) => clientRecordProfileReply\(s, profileSeq, item\)\)\)/);
  assert.match(hook, /\.loadAdminInterventions\(clientDossiersQuery\(stateRef\.current\)\)\s*\.then\(\(page\) => setState\(\(s\) => clientRecordDossiersReply\(s, dossiersSeq, page\)\)\)/);
  const view = src.slice(src.indexOf("function ClientsView("), src.indexOf("function BoundedClientsView("));
  assert.match(view, /onClick=\{\(\) => openRecord\(c\)\}/);
  assert.match(view, /onOpenDossier=\{onOpenDossier\}/);
  assert.doesNotMatch(view, /Fiche client détaillée non disponible|blocker="ADM-04"/);
  assert.match(src, /artisanName=\{artisanName\}\s*onOpenDossier=\{openDossier\}/);
  // The session forwards client_id to the API (it was dropped before).
  const app = readFileSync("components/courant-app.tsx", "utf8");
  assert.match(app, /\["status", "category", "urgency", "site_id", "artisan_id", "client_id", "created_from", "created_to", "q"\] as const/);
  assert.match(app, /\(!params\.client_id \|\| i\.client_id === params\.client_id\)/);
});
