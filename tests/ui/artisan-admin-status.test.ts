// Artisan applications (admin): distinct status labels from the server's application_status, one
// allowed decision per status, explicit reactivation, no approval of an incomplete dossier,
// truncation banner with a directory link, legacy / demo shape still rendered. SSR / pure only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Forms from "../../components/app/forms";

const f = loadModule("components/app/forms.tsx") as unknown as typeof Forms;
const row = (application_status: string | null | undefined, artisan_approved = false) => ({
  id: "a1",
  full_name: "Alex Martin",
  artisan_approved,
  created_at: "2026-10-30T09:00:00Z",
  ...(application_status === undefined ? {} : { application_status }),
});
const list = (rows: unknown[], truncated = false, limit: number | null = 100) =>
  renderToString(createElement(f.ArtisanApplicationsList as never, { rows, truncated, limit, busy: false, onDecide: async () => {} } as never)).replace(/<!-- -->/g, "");
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim());

test("statut : libellé distinct et décisions autorisées par statut (soumis ⇒ approuver ou demander des corrections, E35)", () => {
  const cases: [string | null, boolean, string, string | null][] = [
    // ADM-02 (22 nov. 2026): a submitted application can also be refused, with a mandatory reason.
    ["submitted", false, "Dossier soumis", "Approuver|Demander des corrections|Refuser la candidature"],
    ["approved", true, "Approuvé", "Suspendre"],
    ["suspended", false, "Suspendu", "Réactiver"],
    ["changes_requested", false, "Modifications demandées", null],
    ["draft", false, "Brouillon", null],
    ["weird_state", false, "Statut inconnu", null],
    [null, false, "Statut non disponible", null],
  ];
  for (const [status, approved, label, action] of cases) {
    const html = list([row(status, approved)]);
    assert.match(html, new RegExp(`${label} — `), String(status));
    assert.deepEqual(buttons(html), action ? action.split("|") : [], String(status));
  }
});

test("suspendu ⇒ « Réactiver » avec confirmation explicite, action reinstate distincte de l’approbation (E34)", () => {
  const v = f.artisanApplicationView({ artisan_approved: false, application_status: "suspended" });
  assert.equal(v.decision, "reactivate");
  const html = list([row("suspended")]);
  assert.deepEqual(buttons(html), ["Réactiver"]);
  assert.doesNotMatch(html, /Approuver/);
  const src = readFileSync("components/app/forms.tsx", "utf8");
  assert.match(src, /reactivate: \{\s*label: "Réactiver",[\s\S]*?confirmLabel: "Confirmer la réactivation",\s*action: "reinstate",/);
  assert.match(src, /approve: \{\s*label: "Approuver",[\s\S]*?action: "approve",/);
  // ADM-02 (22 nov. 2026): the same command now also carries the decision reason when one is given.
  assert.match(src, /api<\{ reason_recorded\?: boolean \}>\("\/api\/admin\/artisans", \{ user_id: p\.id, command_id, action, expected_version, \.\.\.\(reason \? \{ reason \} : \{\}\)/);
});

test("ADM-02 · décision négative : motif obligatoire, refus et réouverture distincts, candidature refusée affichée comme telle", () => {
  const src = readFileSync("components/app/forms.tsx", "utf8");
  for (const key of ["suspend", "reject", "reopen", "request_changes"]) assert.match(src, new RegExp(`${key}: \\{[^}]*reasonRequired: true`), key);
  assert.doesNotMatch(src, /(?:approve|reactivate): \{[^}]*reasonRequired: true/);
  assert.match(src, /reject: \{[^}]*action: "request_changes",[^}]*definitive: true/);
  const refused = renderToString(createElement(f.ArtisanApplicationsList as never, { rows: [{ ...row("changes_requested"), refused: true }], truncated: false, limit: null, busy: false, onDecide: async () => {} } as never));
  assert.match(refused, /<p>Candidature refusée(?:<!-- -->)? — /);
  assert.deepEqual(buttons(refused), ["Rouvrir la candidature"]);
  assert.equal(f.parseArtisanApplications({ artisans: [{ ...row("changes_requested"), refused: true }] }).rows[0].refused, true);
  assert.equal(f.parseArtisanApplications({ artisans: [row("changes_requested")] }).rows[0].refused, undefined);
});

test("brouillon / modifications demandées / statut absent ou inconnu ⇒ jamais d’approbation, texte honnête", () => {
  for (const status of ["draft", "changes_requested", null, "other"]) {
    const v = f.artisanApplicationView({ artisan_approved: false, application_status: status });
    assert.equal(v.decision, null, String(status));
    assert.ok(v.note, String(status));
    assert.doesNotMatch(list([row(status)]), /Approuver|Réactiver/);
  }
  assert.match(list([row("draft")]), /Dossier incomplet : en attente de l’artisan\./);
  assert.match(list([row("changes_requested")]), /Modifications demandées : en attente de l’artisan\./);
});

test("liste tronquée ⇒ bandeau « limité aux 100 premiers » + lien vers l’annuaire ; sinon aucun bandeau", () => {
  const parsed = f.parseArtisanApplications({ artisans: [row("approved", true)], limit: 100, truncated: true });
  assert.equal(parsed.truncated, true);
  const html = list(parsed.rows, parsed.truncated, parsed.limit);
  assert.match(html, /Affichage limité aux 100 premiers artisans\./);
  assert.match(html, /<a class="text-button" href="#admin-artisans">Ouvrir l’annuaire des artisans<\/a>/);
  assert.doesNotMatch(list(parsed.rows, false), /Affichage limité|annuaire/);
  assert.equal(f.parseArtisanApplications({ artisans: [], truncated: "yes" }).truncated, false);
});

test("forme héritée / démo (sans application_status) valide toujours rendue, jamais de statut inventé", () => {
  const legacy = f.parseArtisanApplications({ artisans: [row(undefined, true), { ...row(undefined, false), id: "a2", role: "artisan" }] });
  assert.equal(legacy.rows.length, 2);
  assert.equal(legacy.truncated, false);
  const html = list(legacy.rows);
  assert.equal((html.match(/Statut non disponible/g) || []).length, 2);
  assert.doesNotMatch(html, /Approuvé —|Dossier soumis|Suspendu —/);
  // Accès ouvert connu ⇒ seule la suspension est proposée ; accès fermé ⇒ aucune décision.
  assert.deepEqual(buttons(list([legacy.rows[0]])), ["Suspendre"]);
  assert.deepEqual(buttons(list([legacy.rows[1]])), []);
  assert.match(list([]), /Aucune candidature à vérifier/);
  const fresh = f.parseArtisanApplications({ artisans: [row("submitted"), { ...row("weird"), id: "a3" }], limit: 100, truncated: false });
  assert.deepEqual(fresh.rows.map((r) => r.application_status), ["submitted", "weird"]);
  assert.deepEqual(buttons(list([fresh.rows[1]])), [], "statut inconnu non actionnable");
});

test("réponse illisible ou UNE ligne invalide ⇒ erreur explicite (jamais une liste vide ou raccourcie)", () => {
  const bad: [string, unknown][] = [
    ["corps null", null],
    ["corps tableau", [row("approved", true)]],
    ["artisans absent", { limit: 100, truncated: false }],
    ["artisans objet", { artisans: { a: 1 } }],
    ["ligne null", { artisans: [row("approved", true), null] }],
    ["id nombre", { artisans: [row("approved", true), { ...row("submitted"), id: 7 }] }],
    ["nom absent", { artisans: [{ id: "a1", artisan_approved: false, created_at: "2026-10-30T09:00:00Z" }] }],
    ["artisan_approved texte", { artisans: [{ ...row("submitted"), artisan_approved: "true" }] }],
    ["created_at nombre", { artisans: [{ ...row("submitted"), created_at: 1 }] }],
    ["statut nombre", { artisans: [{ ...row("submitted"), application_status: 3 }] }],
  ];
  for (const [name, body] of bad) assert.throws(() => f.parseArtisanApplications(body), (e: Error) => e.message === f.ARTISAN_LIST_INVALID, name);
  assert.equal(f.ARTISAN_LIST_INVALID, "Liste des artisans illisible : réponse du service invalide. Réessayez.");
  // Le chargement passe par le catch existant : pas de liste ni d’action, message + « Réessayer ».
  const src = readFileSync("components/app/forms.tsx", "utf8");
  const load = src.slice(src.indexOf("export function ArtisanAdministration("), src.indexOf("async function decide("));
  assert.match(load, /\} catch \(e\) \{\s*setRows\(\[\]\);\s*setTruncated\(false\);\s*setError\(\(e as Error\)\.message\);/);
  const view = src.slice(src.indexOf("async function decide("), src.indexOf("export function ProfessionalOperations("));
  assert.match(view, /error && !rows\.length \? null : \(\s*<ArtisanApplicationsList/);
  assert.match(view, /data-artisan-applications-error=""[\s\S]*?Réessayer/);
});


test("fiche artisan : seule la cible est rendue et un dossier absent bloque son approbation", () => {
  const render = (artisanId: string, approvalBlockedReason?: string) => renderToString(createElement(f.ArtisanApplicationsList as never, { rows: [{ ...row("approved", true), id: "alex", full_name: "Alex Martin" }, { ...row("submitted", false), id: "sam", full_name: "Sam Laurent" }], artisanId, approvalBlockedReason, truncated: false, limit: 100, busy: false, onDecide: async () => {} } as never));
  const sam = render("sam");
  assert.match(sam, /Sam Laurent/);
  assert.doesNotMatch(sam, /Alex Martin|Suspendre/);
  assert.match(sam, />Approuver</);
  const blocked = render("sam", "Dossier non présenté");
  assert.match(blocked, /Dossier non présenté/);
  assert.doesNotMatch(blocked, />Approuver</);
  assert.match(blocked, /Demander des corrections/);
  assert.match(render("missing"), /Décision indisponible/);
  assert.doesNotMatch(render("missing"), /Alex Martin|Sam Laurent|>Approuver</);
});
