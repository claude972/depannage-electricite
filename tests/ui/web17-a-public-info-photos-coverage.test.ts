// WEB17-A — PUB-08 / PUB-09 (real routes, PUBLISHED operator profile rendering), CLI-02 (web offer
// gallery, deletion contract), CLI-03 (no-artisan availability signal). Values are QA fixtures only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import { PENDING } from "../../components/role/public-lists";
import { VALIDATED_OPERATOR as V } from "../../shared/commercial-facts";
import * as coverage from "../../components/features/coverage/model";
import * as photos from "../../components/features/offer-photos/model";

type Chrome = { current: string; handlers: Record<string, (...a: unknown[]) => void>; onHome: () => void; children: unknown };
let chrome: Chrome | null = null;
const site = loadModule("components/role/public-site.tsx", {
  "./public-home": { PublicHome: () => null },
  "./public-chrome": {
    PublicChrome: (props: Chrome) => { chrome = props; return props.children; },
    serviceChromeHref: (a: { type: string; view?: string }) => (a.type === "view" ? `/#${a.view}` : a.type === "login" ? "/#auth" : a.type === "new" ? "/#new" : "/"),
    serviceChromeHandlers: (go: (href: string) => void) => ({ onNew: () => go("/#new"), onLogin: () => go("/#auth"), onAddress: () => go("/#new/address"), onNavigate: (v: string) => go(`/#${v}`), onDemo: () => go("/#demo/client") }),
  },
  "../app/forms": { RequestForm: () => null, AuthForm: () => null },
}) as { PublicSite: unknown; PublicInfoPage: unknown; INFO_ROUTES: Record<string, string>; infoRouteHref(view: string): string };
const html = (el: unknown) => renderToString(el as never).replace(/<!-- -->/g, "");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const session = (view: string) => new Proxy({ view, error: "", notice: "", categoryId: "outage", pendingDraft: null, busy: false, authMode: "login" } as Record<string, unknown>, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : () => {}) });
const spa = (view: string, operatorProfile: unknown) => html(createElement(site.PublicSite as never, { session: session(view), operatorProfile } as never));
const route = (view: string, operatorProfile: unknown) => html(createElement(site.PublicInfoPage as never, { view, operatorProfile } as never));

const MINIMUM = {
  legal_name: "Exploitant QA SAS", legal_form: "SAS", siren: "000000000", hq_address: "Adresse QA du siège", publication_director: "Directrice QA",
  public_email: "contact@exploitant-qa.invalid", privacy_email: "donnees@exploitant-qa.invalid", host_name: "Hébergeur QA", host_address: "Adresse QA hébergeur",
  host_contact: "support@hebergeur-qa.invalid", rights_holder: "Exploitant QA SAS",
};
const FULL = { ...MINIMUM, vat_number: "FR00000000000", public_phone: "+596000000000", service_area: "Zone QA", display_name: "Marque QA", about_text: "Présentation QA.", team_text: "Équipe QA : deux personnes fictives.\n\nSecond paragraphe QA.", privacy_controller: "Responsable QA", privacy_retention: "Durées QA fictives." };
const published = (profile: object) => ({ phase: "ready", published: { version: 4, profile, published_at: "2026-11-07T10:00:00+00:00" } });
const UNPUBLISHED = { phase: "ready", published: null };

test("PUB-08/09 · routes réelles : mêmes vues que les vues en ancre, navigation vers les routes réelles", () => {
  assert.deepEqual({ ...site.INFO_ROUTES }, { about: "/a-propos", privacy: "/confidentialite", legal: "/mentions-legales" });
  for (const view of ["legal", "about", "privacy"]) {
    for (const state of [UNPUBLISHED, published(FULL), published(MINIMUM)]) {
      const fromRoute = route(view, state);
      assert.match(fromRoute, new RegExp(`data-public-info-route="${view}"`));
      // Same content as the hash view (only the wrapper attribute differs).
      assert.equal(text(fromRoute), text(spa(view, state)), `${view}: same text as /#${view}`);
    }
    assert.equal(chrome?.current, view);
  }
  assert.equal(site.infoRouteHref("legal"), "/mentions-legales");
  assert.equal(site.infoRouteHref("about"), "/a-propos");
  assert.equal(site.infoRouteHref("privacy"), "/confidentialite");
  assert.equal(site.infoRouteHref("pricing"), "/#pricing");
  assert.equal(site.infoRouteHref("help"), "/#help");
  const pages: [string, string, string][] = [["legal", "legal", "Mentions légales"], ["mentions-legales", "legal", "Mentions légales"], ["about", "about", "À propos"], ["a-propos", "about", "À propos"], ["privacy", "privacy", "Confidentialité"], ["confidentialite", "privacy", "Confidentialité"]];
  for (const [dir, view, title] of pages) {
    const src = readFileSync(`app/${dir}/page.tsx`, "utf8");
    assert.match(src, new RegExp(`<PublicInfoPage view="${view}" />`), dir);
    assert.match(src, new RegExp(`title: "${title} — Dépannage électrique"`), dir);
  }
});

test("PUB-08 · profil publié complet : aucune rubrique « à renseigner », TVA et contacts publiés", () => {
  const legal = text(route("legal", published(FULL)));
  assert.ok(!legal.includes(PENDING), "no pending row");
  assert.doesNotMatch(legal, /à renseigner|Mentions légales à compléter/i);
  for (const part of ["Raison sociale et forme juridique : Exploitant QA SAS, SAS", "Numéro SIREN et numéro de TVA : 000000000 · TVA FR00000000000 ", "Adresse de contact : contact@exploitant-qa.invalid", "Nom de l’hébergeur : Hébergeur QA", "Adresse : Adresse QA hébergeur", "Coordonnées de contact : support@hebergeur-qa.invalid", "Titulaire des droits sur le nom, le logo et les contenus : Exploitant QA SAS", "Responsable du traitement : Responsable QA", "Contact pour l’exercice des droits : donnees@exploitant-qa.invalid", "(version 4)"]) assert.ok(legal.includes(part), part);
  // The owner-validated facts never mix with a published profile.
  for (const fact of [V.legal_name + ",", V.siren, V.hq_address, V.publication_director]) assert.ok(!legal.includes(fact), fact);
});

test("PUB-08 · profil publié au minimum : rubriques facultatives absentes traitées sans « à renseigner »", () => {
  const legal = text(route("legal", published(MINIMUM)));
  assert.ok(!legal.includes(PENDING));
  assert.ok(legal.includes("Numéro SIREN et numéro de TVA : 000000000 (aucun numéro de TVA publié par l’exploitant)"));
  assert.ok(legal.includes("Responsable du traitement : Exploitant QA SAS, SAS "), "the publisher stands as controller when the optional field is absent");
  assert.doesNotMatch(legal, /SIRET|Immatriculation/);
  const privacy = text(route("privacy", published(MINIMUM)));
  assert.ok(privacy.includes("Responsable du traitement : Exploitant QA SAS, SAS "));
  assert.ok(privacy.includes("Durées de conservation hors position partagée Non précisées dans les informations publiées par l’exploitant."));
  assert.ok(!privacy.includes(PENDING));
  assert.ok(text(route("privacy", published(FULL))).includes("Durées de conservation hors position partagée Durées QA fictives."));
  // Unpublished: the pending wording is unchanged.
  const pending = text(route("privacy", UNPUBLISHED));
  assert.ok(pending.includes(`Durées de conservation hors position partagée ${PENDING}`));
  assert.ok(text(route("legal", UNPUBLISHED)).includes(`Numéro SIREN et numéro de TVA : ${V.siren} Numéro SIRET`), "no « TVA non publiée » note while nothing is published");
});

test("PUB-09 · profil publié : équipe et contact affichés, aucune ligne « à renseigner », aucun chiffre inventé", () => {
  const full = route("about", published(FULL));
  const t = text(full);
  assert.ok(!t.includes(PENDING));
  assert.doesNotMatch(t, /Équipe :|à renseigner/i, "no pending team row");
  assert.match(full, /data-published-text="team_text"/);
  for (const part of ["Marque QA", "Présentation QA.", "L’équipe", "Équipe QA : deux personnes fictives.", "Second paragraphe QA.", "Nom de l’exploitant et forme juridique : Exploitant QA SAS, SAS", "Personnes responsables : Directrice QA", "Zone d’intervention couverte : Zone QA", "Coordonnées de contact : contact@exploitant-qa.invalid · +596000000000"]) assert.ok(t.includes(part), part);
  assert.match(full, /href="mailto:contact@exploitant-qa\.invalid"/);
  assert.match(full, /href="tel:\+596000000000"/);
  // Published without the optional team text and phone: no team block, no pending row, phone said unpublished.
  const min = route("about", published(MINIMUM));
  const m = text(min);
  assert.ok(!m.includes(PENDING));
  assert.doesNotMatch(min, /data-published-text="team_text"|href="tel:/);
  assert.doesNotMatch(m, /Équipe :/);
  assert.ok(m.includes("Coordonnées de contact : contact@exploitant-qa.invalid "));
  assert.ok(m.includes("Téléphone : Aucun numéro de téléphone n’est publié par l’exploitant."));
  assert.match(min, /data-contact-channel="unpublished"/);
  // No figure other than the fixture values (phone / version / date) is rendered on the page.
  assert.deepEqual(t.replaceAll("+596000000000", "").replace(/7 novembre 2026 \(version 4\)/g, "").match(/\d{2,}/g) ?? [], []);
  // Unpublished: both rows stay pending (owner data), nothing invented.
  const none = text(route("about", UNPUBLISHED));
  for (const f of ["Équipe", "Coordonnées de contact"]) assert.ok(none.includes(`${f} : ${PENDING}`), f);
});

test("CLI-03 · signal « aucun artisan disponible » : seulement sur une réponse vérifiée, 75001 reste « hors zone »", async () => {
  const calls: string[] = [];
  const fetcher = (cov: unknown, avail: unknown, availStatus = 200) => (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return url.startsWith(coverage.AVAILABILITY_PATH) ? new Response(JSON.stringify(avail), { status: availStatus }) : new Response(JSON.stringify(cov), { status: 200 });
  }) as unknown as typeof fetch;
  const covered = { status: "covered", version: 1 };
  assert.equal(await coverage.readCoverageSignal(fetcher(covered, { availability: "none" }), "97217"), "no_artisan");
  assert.deepEqual(calls, ["/api/public/coverage?postal_code=97217", "/api/public/coverage/availability?postal_code=97217"]);
  assert.equal(await coverage.readCoverageSignal(fetcher(covered, { availability: "available" }), "97240"), null);
  assert.equal(await coverage.readCoverageSignal(fetcher({ status: "unknown", version: null }, { availability: "none" }), "97217"), "no_artisan");
  calls.length = 0;
  assert.equal(await coverage.readCoverageSignal(fetcher({ status: "not_covered", version: 1 }, { availability: "none" }), "75001"), "not_covered");
  assert.equal(calls.length, 1, "outside the published zone: the availability is not even asked");
  // Failure, out-of-contract body (a count or an identity would be refused), invalid code: silent.
  assert.equal(await coverage.readCoverageSignal(fetcher(covered, { error: "x" }, 503), "97217"), null);
  assert.equal(await coverage.readCoverageSignal(fetcher(covered, { availability: "none", count: 0 }), "97217"), null);
  assert.equal(await coverage.readCoverageSignal(fetcher(covered, { availability: 0 }), "97217"), null);
  calls.length = 0;
  assert.equal(await coverage.readCoverageSignal(fetcher(covered, { availability: "none" }), "9721"), null);
  assert.equal(calls.length, 0);
  assert.match(coverage.noArtisanNotice("97217"), /^Aucun artisan disponible dans votre zone pour le moment \(code postal 97217\)\..*aucun délai n’est garanti\.$/);
  // Server route: yes/no only, same rule as the offer eligibility, service credential on the server.
  const src = readFileSync("app/api/public/coverage/availability/route.ts", "utf8");
  assert.match(src, /adminClient\(\)/);
  for (const rule of [`.eq("application_status", "approved")`, `.eq("available", true)`, `.contains("postal_codes", [postal.data])`, `.eq("role", "artisan")`, `.eq("artisan_approved", true)`]) assert.ok(src.includes(rule), rule);
  assert.match(src, /Response\.json\(\{ availability: available \? "available" : "none" \}/);
  assert.doesNotMatch(src, /count:|company_name|full_name/);
});

test("CLI-02 · galerie web de l’offre et suppression : contrat strict", () => {
  const id = "11111111-1111-4111-8111-111111111111", photo = "22222222-2222-4222-8222-222222222222";
  assert.equal(photos.offerPhotoSrc(id, photo), `/api/interventions/${id}/offer-photos?photo=${photo}`);
  assert.equal(photos.deletePhotoPath(photo), `/api/documents?id=${photo}`);
  assert.equal(photos.confirmsDeletion({ deleted: true, id: photo }, photo.toUpperCase()), true);
  assert.equal(photos.confirmsDeletion({ deleted: true, id }, photo), false, "another document");
  assert.equal(photos.confirmsDeletion({ deleted: true }, photo), false);
  assert.equal(photos.confirmsDeletion({ deleted: true, id: photo, cleanup: "incomplete" }, photo), false);
  assert.match(photos.deletePhotoError(409), /ne peut plus être supprimée/);
  assert.match(photos.deletePhotoError(404), /ne peut pas être supprimée par ce compte/);
  const gallery = loadModule("components/features/offer-photos/offer-photo-gallery.tsx") as { OfferPhotoGallery: unknown };
  const context = { generation: () => 1, userId: () => "u" };
  const shown = html(createElement(gallery.OfferPhotoGallery as never, { interventionId: id, context, initial: [photo] } as never));
  assert.match(shown, /data-offer-gallery="ready"/);
  assert.match(shown, /Photos choisies par le client/);
  assert.ok(shown.includes(`src="/api/interventions/${id}/offer-photos?photo=${photo}"`));
  assert.match(shown, /alt="Photo partagée par le client 1"/);
  const empty = html(createElement(gallery.OfferPhotoGallery as never, { interventionId: id, context, initial: [] } as never));
  assert.match(empty, /Aucune photo partagée pour cette offre\./);
  assert.doesNotMatch(empty, /<img/);
  assert.match(html(createElement(gallery.OfferPhotoGallery as never, { interventionId: id, context } as never)), /data-offer-gallery="loading"/);
  // Mounted in both artisan offer views; deletion route keeps every check on the server.
  const artisan = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.equal(artisan.split("<OfferPhotoGallery ").length - 1, 2);
  const api = readFileSync("app/api/documents/route.ts", "utf8");
  const del = api.slice(api.indexOf("export async function DELETE"));
  for (const rule of ["assertOrigin(request)", `db.rpc("delete_request_photo", { p_document_id: id })`, `atomic.error?.code === "P0001"`, `.storage.from("intervention-documents").remove([path])`]) assert.ok(del.includes(rule), rule);
  // R-SRV-25: the legacy two-step path is kept only behind PGRST202 and keeps its checks.
  const legacy = api.slice(api.indexOf("async function legacyDeleteRequestPhoto"), api.indexOf("export async function DELETE"));
  for (const rule of ["doc.owner_id !== userId", `db.rpc("set_mission_offer_photo"`, `job.data.status !== "requested" || job.data.artisan_id`, `.delete().eq("id", id).eq("owner_id", userId)`]) assert.ok(legacy.includes(rule), rule);
  assert.ok(del.includes(`atomic.error?.code === "PGRST202"`));
});
