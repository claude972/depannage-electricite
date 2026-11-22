// Public pages (PUB-02/04/08/09/10): no invented legal or commercial value (no SIREN/SIRET-like
// digits, email, phone, price list or service area) — the only identifiers and percentages allowed
// are the owner-validated ones of shared/commercial-facts.ts, each on its own page; explicit
// « à renseigner » states for what the owner has not validated, contact with
// real channels only (no form that pretends to send), privacy listing the real processing, the
// third parties the code really calls (incl. OpenStreetMap tiles, IGN) and the real user controls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import { forbiddenClaims, publicStrings, PENDING } from "../../components/role/public-lists";
import { NETWORK_COMMISSION_TEXT, OPERATOR_MANAGER, OPERATOR_REGISTRATION, PLATFORM_COMMISSION_PERCENT, PRICING_RULES, URGENCY_SURCHARGE_PERCENT, VALIDATED_OPERATOR as V } from "../../shared/commercial-facts";

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
const VIEWS = ["help", "pricing", "join", "about", "privacy", "legal"];
const URGENCY_RULE = PRICING_RULES.find((rule) => rule.label === "Majoration d’urgence")?.text ?? "";
const URGENCY_FOOTNOTE = `hors majoration d’urgence (+${URGENCY_SURCHARGE_PERCENT} %)`;
// Owner-validated strings (shared/commercial-facts.ts) that would otherwise trip the guards, listed
// per page: each exact string is removed from that page only before the guards run, so any other
// number, percentage or identifier — or a validated one on another page — still fails.
const VALIDATED_ON: Record<string, string[]> = {
  legal: [V.siret, V.siren], // SIRET first: it starts with the SIREN.
  pricing: [URGENCY_RULE, URGENCY_FOOTNOTE],
  join: [NETWORK_COMMISSION_TEXT],
};
const withoutValidated = (view: string, t: string) => (VALIDATED_ON[view] ?? []).reduce((out, s) => out.split(s).join(" "), t);
// Invented identifiers / contacts: SIREN (9) / SIRET (14) digit runs, emails, French phones, VAT ids, prices with « € » outside the indicative table.
const INVENTED = [/\b\d{3}\s?\d{3}\s?\d{3}(?:\s?\d{5})?\b/, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, /\b0[1-9](?:[ .-]?\d{2}){4}\b/, /\+33\s?\d/, /\bFR\s?\d{2}\s?\d{9}\b/, /\b\d{2,5}\s?(?:rue|avenue|boulevard|bd|chemin)\b/i];

test("aucune valeur légale ou commerciale inventée sur les pages publiques", () => {
  for (const view of VIEWS) {
    const t = withoutValidated(view, text(page(view)));
    for (const re of INVENTED) assert.doesNotMatch(t, re, `${view}: ${re}`);
    assert.deepEqual(forbiddenClaims(t), [], view);
  }
  for (const s of publicStrings()) assert.deepEqual(forbiddenClaims(s), [], s);
  // The exemption is exact and per page: another figure, or a validated one elsewhere, is still caught.
  const caught = (view: string, t: string) => INVENTED.some((re) => re.test(withoutValidated(view, t))) || forbiddenClaims(withoutValidated(view, t)).length > 0;
  assert.equal(caught("legal", `Numéro SIREN : ${V.siren}`), false);
  assert.equal(caught("legal", "Numéro SIREN : 123456789"), true, "another SIREN");
  assert.equal(caught("about", `Numéro SIREN : ${V.siren}`), true, "validated SIREN outside the legal page");
  assert.equal(caught("pricing", URGENCY_RULE), false);
  assert.equal(caught("pricing", URGENCY_RULE.replace(String(URGENCY_SURCHARGE_PERCENT), "30")), true, "another surcharge");
  assert.equal(caught("pricing", `Majoration de nuit : +${URGENCY_SURCHARGE_PERCENT} %`), true, "same percentage, other claim");
  assert.equal(caught("join", NETWORK_COMMISSION_TEXT), false);
  assert.equal(caught("join", NETWORK_COMMISSION_TEXT.replace(`${PLATFORM_COMMISSION_PERCENT} %`, "15 %")), true, "another commission");
  assert.equal(caught("pricing", NETWORK_COMMISSION_TEXT), true, "commission outside the join page");
});

test("valeurs validées par le propriétaire affichées sur les pages prévues (mentions, tarifs, réseau)", () => {
  const legal = text(page("legal"));
  assert.match(legal, new RegExp(`Raison sociale et forme juridique : ${V.legal_name}, ${V.legal_form} `));
  assert.ok(legal.includes(`Adresse du siège : ${V.hq_address} `));
  assert.ok(legal.includes(`Numéro SIREN et numéro de TVA : ${V.siren} `), "SIREN alone: no VAT number is validated");
  assert.ok(legal.includes(`Numéro SIRET de l’établissement : ${V.siret} `));
  assert.ok(legal.includes(`Immatriculation : ${OPERATOR_REGISTRATION} `));
  assert.ok(legal.includes(`Directeur ou directrice de la publication : ${V.publication_director} `));
  assert.ok(V.publication_director.startsWith(OPERATOR_MANAGER));
  assert.ok(legal.includes(`Responsable du traitement : ${V.privacy_controller} `));
  const pricing = text(page("pricing"));
  assert.match(page("pricing"), /data-pricing-rules=""/);
  for (const rule of PRICING_RULES) assert.ok(pricing.includes(`${rule.label} : ${rule.text}`), rule.label);
  assert.ok(pricing.includes(`Majoration d’urgence : +${URGENCY_SURCHARGE_PERCENT} % `));
  assert.ok(pricing.includes(`Zone desservie : ${V.service_area} `));
  assert.ok(pricing.includes(URGENCY_FOOTNOTE));
  const join = text(page("join"));
  assert.match(page("join"), /data-network-commission=""/);
  assert.ok(join.includes(NETWORK_COMMISSION_TEXT));
  assert.ok(join.includes(`Commission de la plateforme : ${PLATFORM_COMMISSION_PERCENT} % `));
  // Each validated figure stays on its own page.
  for (const view of VIEWS.filter((v) => v !== "legal")) assert.ok(!text(page(view)).includes(V.siren), `${view}: no SIREN`);
  for (const view of VIEWS.filter((v) => v !== "pricing" && v !== "join")) assert.doesNotMatch(text(page(view)), /\d\s*%/, `${view}: no percentage`);
});

test("états en attente explicites : exploitant (PUB-09), mentions (PUB-08), tarifs (PUB-02), confidentialité (PUB-10)", () => {
  const about = text(page("about"));
  // Validated by the owner (shared/commercial-facts.ts): identity, persons in charge, service area.
  assert.ok(about.includes(`Nom de l’exploitant et forme juridique : ${V.legal_name}, ${V.legal_form} `));
  assert.ok(about.includes(`Personnes responsables : ${V.publication_director} `));
  assert.ok(about.includes(`Zone d’intervention couverte : ${V.service_area} `));
  // Not validated: team and contact details stay pending.
  for (const f of ["Équipe", "Coordonnées de contact"]) assert.match(about, new RegExp(`${f} : ${PENDING}`));
  assert.match(about, /Équipe et coordonnées de contact à renseigner/);
  const legal = text(page("legal"));
  // Not validated: contact address, host (name, address, contact), rights holder; no VAT number either.
  for (const f of ["Adresse de contact", "Nom de l’hébergeur", "Adresse", "Coordonnées de contact", "Titulaire des droits sur le nom, le logo et les contenus", "Contact pour l’exercice des droits"]) assert.match(legal, new RegExp(`${f} : ${PENDING}`), f);
  assert.doesNotMatch(legal, /· TVA/, "no VAT number shown");
  assert.match(legal, /Mentions légales à compléter/);
  const pricing = text(page("pricing"));
  // The pricing rules are validated; nothing on that page is pending any more, and no travel fee is quoted.
  assert.ok(!pricing.includes(PENDING));
  assert.match(pricing, /Grille indicative par type de panne\. Le prix ferme est celui du devis précis que vous acceptez avant travaux\./);
  assert.match(pricing, /le déplacement est détaillé sur le devis/);
  const privacy = text(page("privacy"));
  assert.ok(privacy.includes(`Responsable du traitement : ${V.privacy_controller} `));
  assert.match(privacy, new RegExp(`Contact pour l’exercice des droits \\(accès, rectification, suppression\\) : ${PENDING}`));
});

test("contact (PUB-04) : canaux réels seulement, aucun faux formulaire d’envoi ; le rappel n’est décrit que par son formulaire vivant", () => {
  for (const view of ["help", "about"]) {
    const html = page(view);
    assert.match(html, /data-public-contact=""/, view);
    assert.match(html, /data-contact-channel="available"/);
    assert.match(text(html), /Assistance en ligne : Une fois connecté, écrivez à l’assistance depuis votre espace/);
    assert.doesNotMatch(text(html), /Demande de rappel :|aucune demande de rappel n’est enregistrée/, "no static callback state (the live form informs)");
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
  for (const label of ["Compte", "Demandes", "Lieu d’intervention", "Devis", "Messages", "Documents", "Paiements", "Application mobile", "Adresses enregistrées", "Préférences de notification", "Position pendant le déplacement", "Dans votre navigateur"]) assert.match(t, new RegExp(`${label} :`), label);
  // Retention proofs: unreadable at 60 s, then an ASYNCHRONOUS server purge — never claimed as a hard erase at 60 s.
  assert.match(t, /n’est plus lisible 60 secondes après sa mesure, puis elle est supprimée par une purge automatique du serveur, qui peut intervenir un peu plus tard/);
  assert.doesNotMatch(t, /effacée automatiquement 60 secondes/);
  assert.match(html, /data-privacy-third-parties=""/);
  for (const name of ["Supabase", "Stripe", "OpenStreetMap \\(fonds de carte\\)", "IGN Géoplateforme"]) assert.match(t, new RegExp(`${name} :`), name);
  assert.match(t, /tile\.openstreetmap\.org/);
  assert.match(t, /le point confirmé et le complément sont visibles dans le détail du dossier par le compte client et l’électricien qui lui est actuellement affecté/i);
  assert.match(t, /IGN Géoplateforme : le serveur transmet le texte de la recherche ou les coordonnées du point à situer/);
  assert.match(t, /Le dépôt d’une demande d’effacement ouvre un ticket/);
  assert.match(t, /Demande de rappel : si le formulaire est ouvert, le numéro saisi, le motif choisi et votre accord au rappel/);
  assert.match(t, /Resend : si les notifications par e-mail sont ouvertes/);
  assert.match(t, /OpenAI : si la préanalyse est ouverte et que vous la demandez/);
  assert.match(t, /déposer une demande d’effacement auprès de l’assistance/);
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
