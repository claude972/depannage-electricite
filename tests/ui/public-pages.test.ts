// Public pages (PUB-02/04/08/09/10): no invented legal or commercial value (no SIREN/SIRET-like
// digits, email, phone, price list or service area), explicit « à renseigner » states, contact with
// real channels only (no form that pretends to send), privacy listing the real processing, the
// third parties the code really calls (incl. OpenStreetMap tiles, IGN) and the real user controls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import { forbiddenClaims, publicStrings, PENDING } from "../../components/role/public-lists";

function fakeSession(view: string) {
  const calls: string[] = [];
  const data: Record<string, unknown> = { view, error: "", notice: "", categoryId: "outage", pendingDraft: null, busy: false, authMode: "login" };
  const session = new Proxy(data, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : (...a: unknown[]) => calls.push(`${String(k)}(${a.join(",")})`)) });
  return { session, calls };
}
const site = loadModule("components/role/public-site.tsx", {
  "./public-home": { PublicHome: () => null },
  "./public-chrome": { PublicChrome: (props: { children: unknown }) => props.children },
  "../app/forms": { RequestForm: () => null, AuthForm: () => null },
}) as { PublicSite: unknown };
const page = (view: string) => renderToString(createElement(site.PublicSite as never, { session: fakeSession(view).session } as never)).replace(/<!-- -->/g, "");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const VIEWS = ["help", "pricing", "about", "privacy", "legal"];
// Invented identifiers / contacts: SIREN (9) / SIRET (14) digit runs, emails, French phones, VAT ids, prices with « € » outside the indicative table.
const INVENTED = [/\b\d{3}\s?\d{3}\s?\d{3}(?:\s?\d{5})?\b/, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, /\b0[1-9](?:[ .-]?\d{2}){4}\b/, /\+33\s?\d/, /\bFR\s?\d{2}\s?\d{9}\b/, /\b\d{2,5}\s?(?:rue|avenue|boulevard|bd|chemin)\b/i];

test("aucune valeur légale ou commerciale inventée sur les pages publiques", () => {
  for (const view of VIEWS) {
    const t = text(page(view));
    for (const re of INVENTED) assert.doesNotMatch(t, re, `${view}: ${re}`);
    assert.deepEqual(forbiddenClaims(t), [], view);
  }
  for (const s of publicStrings()) assert.deepEqual(forbiddenClaims(s), [], s);
});

test("états en attente explicites : exploitant (PUB-09), mentions (PUB-08), tarifs (PUB-02), confidentialité (PUB-10)", () => {
  const about = text(page("about"));
  for (const f of ["Nom de l’exploitant et forme juridique", "Personnes responsables", "Équipe", "Zone d’intervention couverte", "Coordonnées de contact"]) assert.match(about, new RegExp(`${f} : ${PENDING}`));
  const legal = text(page("legal"));
  for (const f of ["Raison sociale et forme juridique", "Numéro SIREN et numéro de TVA", "Directeur ou directrice de la publication", "Nom de l’hébergeur"]) assert.match(legal, new RegExp(`${f} : ${PENDING}`));
  const pricing = text(page("pricing"));
  for (const f of ["Barème officiel", "Frais de déplacement", "Majorations \\(soir, week-end, urgence\\)", "Zone desservie"]) assert.match(pricing, new RegExp(`${f} : ${PENDING}`));
  assert.match(pricing, /Fourchettes indicatives de préparation du service, pas un barème contractuel\./);
  const privacy = text(page("privacy"));
  assert.match(privacy, new RegExp(`Responsable du traitement : ${PENDING}`));
  assert.match(privacy, new RegExp(`Contact pour l’exercice des droits \\(accès, rectification, suppression\\) : ${PENDING}`));
});

test("contact (PUB-04) : canaux réels seulement, aucun faux formulaire d’envoi ; rappel « en cours d’ouverture »", () => {
  for (const view of ["help", "about"]) {
    const html = page(view);
    assert.match(html, /data-public-contact=""/, view);
    assert.match(html, /data-contact-channel="available"/);
    assert.match(text(html), /Assistance en ligne : Une fois connecté, écrivez à l’assistance depuis votre espace/);
    assert.match(text(html), /Demande de rappel : En cours d’ouverture — Canal en cours d’ouverture : aucune demande de rappel n’est enregistrée depuis ce site\./);
    assert.match(text(html), new RegExp(`Adresse e-mail de contact : ${PENDING}`));
    assert.match(text(html), new RegExp(`Téléphone : ${PENDING}`));
    const contact = html.slice(html.indexOf("data-public-contact"));
    assert.doesNotMatch(contact.slice(0, contact.indexOf("</section>")), /<form|<input|<textarea|type="submit"|Envoyer/, `${view}: no fake send form`);
  }
  // The only action is the real login (then the in-space assistance).
  const { session, calls } = fakeSession("help");
  const src = readFileSync("components/role/public-site.tsx", "utf8");
  assert.match(src, /<HelpView onNew=\{\(\) => newRequest\(\)\} onLogin=\{login\} \/>/);
  assert.match(src, /data-contact-login=""/);
  void session; void calls;
});

test("confidentialité (PUB-10) : traitements réels, tiers réellement appelés (dont OpenStreetMap et IGN), contrôles réels", () => {
  const html = page("privacy");
  const t = text(html);
  for (const label of ["Compte", "Demandes", "Devis", "Messages", "Documents", "Paiements", "Téléphone vérifié", "Adresses enregistrées", "Préférences de notification", "Position pendant le déplacement", "Dans votre navigateur"]) assert.match(t, new RegExp(`${label} :`), label);
  // Retention proofs: unreadable at 60 s, then an ASYNCHRONOUS server purge — never claimed as a hard erase at 60 s.
  assert.match(t, /n’est plus lisible 60 secondes après sa mesure, puis elle est supprimée par une purge automatique du serveur, qui peut intervenir un peu plus tard/);
  assert.doesNotMatch(t, /effacée automatiquement 60 secondes/);
  assert.match(html, /data-privacy-third-parties=""/);
  for (const name of ["Supabase", "Stripe", "OpenStreetMap \\(fonds de carte\\)", "IGN Géoplateforme"]) assert.match(t, new RegExp(`${name} :`), name);
  assert.match(t, /tile\.openstreetmap\.org/);
  assert.match(t, /aucun traceur publicitaire ni outil de mesure d’audience/);
  assert.match(html, /data-privacy-controls=""/);
  for (const c of ["préférences de notification", "adresses enregistrées", "arrêter le partage de position"]) assert.match(t, new RegExp(c));
  // The listed third parties match what the code really calls.
  const model = readFileSync("components/features/tracking/model.ts", "utf8");
  assert.match(model, /https:\/\/tile\.openstreetmap\.org\//, "OSM tiles really loaded by the tracking map");
  const provider = readFileSync("lib/features/tracking/provider.ts", "utf8");
  assert.match(provider, /data\.geopf\.fr/, "IGN really called by the server");
  const retention = readFileSync("supabase/migrations/202610310020_tracking_retention.sql", "utf8");
  assert.match(retention, /interval '60 seconds'/, "position retention stated as implemented");
});
