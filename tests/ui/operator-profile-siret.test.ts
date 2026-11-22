// SIRET facultatif du profil de l’exploitant : saisie admin (14 chiffres, prolonge le SIREN),
// lecture publique stricte, mention légale affichée uniquement une fois publiée, version affichée.
// Valeurs d’essai synthétiques ; rien n’est publié par ce test.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import { command } from "../../lib/features/public-operator-profile/contract";
import { RELEASE } from "../../shared/release";
import { VALIDATED_OPERATOR } from "../../shared/commercial-facts";
import type * as Model from "../../components/features/public-operator-profile/model";
import type * as Editor from "../../components/features/public-operator-profile/operator-profile-editor";

const m = loadModule("components/features/public-operator-profile/model.ts") as unknown as typeof Model;
const e = loadModule("components/features/public-operator-profile/operator-profile-editor.tsx") as unknown as typeof Editor;
const site = loadModule("components/role/public-site.tsx", {
  "./public-home": { PublicHome: () => null },
  "./public-chrome": { PublicChrome: (props: { children: unknown }) => props.children },
  "../app/forms": { RequestForm: () => null, AuthForm: () => null },
}) as { PublicSite: unknown };
const html = (el: unknown) => renderToString(el as never).replace(/<!-- -->/g, "");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const session = (view: string) => new Proxy({ view, error: "", notice: "", categoryId: "outage", pendingDraft: null, busy: false, authMode: "login" } as Record<string, unknown>, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : () => {}) });
const page = (view: string, operatorProfile: unknown) => html(createElement(site.PublicSite as never, { session: session(view), operatorProfile } as never));

const PROFILE = {
  legal_name: "Exploitant QA SAS", legal_form: "SAS", siren: "000000000", hq_address: "Adresse QA du siège", publication_director: "Directrice QA",
  public_email: "contact@exploitant-qa.invalid", privacy_email: "donnees@exploitant-qa.invalid", host_name: "Hébergeur QA", host_address: "Adresse QA hébergeur",
  host_contact: "support@hebergeur-qa.invalid", rights_holder: "Exploitant QA SAS",
};
const SIRET = "00000000000012";
const AT = "2026-11-07T10:00:00+00:00";
const published = (profile: Record<string, string>) => ({ phase: "ready", published: { version: 3, profile, published_at: AT } });

test("saisie admin : SIRET facultatif, 14 chiffres, qui prolonge le SIREN saisi", () => {
  assert.equal(m.FIELD_ORDER.indexOf("siret"), m.FIELD_ORDER.indexOf("siren") + 1, "champ placé sous le SIREN");
  assert.match(m.FIELD_LABELS.siret, /14 chiffres, facultatif/);
  assert.equal(m.missingMinimum(PROFILE).length, 0, "le SIRET n’est pas requis pour publier");

  // Le modèle est chargé dans un autre contexte : comparaison après passage par JSON.
  const form = (values: Parameters<typeof m.formToProfile>[0]) => JSON.parse(JSON.stringify(m.formToProfile(values)));
  assert.deepEqual(form({ siren: "000 000 001", siret: "000 000 001 00012" }), { profile: { siren: "000000001", siret: "00000000100012" } });
  assert.deepEqual(form({ siren: "000000001", siret: "   " }), { profile: { siren: "000000001" } }, "vide ⇒ champ omis");
  assert.deepEqual(form({ siren: "000000002", siret: "00000000100012" }), { errors: { siret: m.SIRET_MISMATCH } });
  assert.deepEqual(form({ siret: "00000000100012" }), { errors: { siret: m.SIRET_MISMATCH } }, "pas de SIRET sans SIREN");
  assert.deepEqual(form({ siren: "000000001", siret: "0000000010001" }), { errors: { siret: `${m.FIELD_LABELS.siret} : valeur invalide.` } });

  // Le serveur applique la même règle à la commande d’enregistrement.
  const save = (profile: Record<string, string>) => command.safeParse({ action: "save", command_id: "10000000-0000-4000-8000-000000000001", expected_version: 0, profile }).success;
  assert.equal(save({ siren: "000000001", siret: "00000000100012" }), true);
  assert.equal(save({ siren: "000000002", siret: "00000000100012" }), false);
  assert.equal(save({ siret: "00000000100012" }), false);
  assert.equal(save({ siren: "000000001", siret: "0000000010001" }), false);

  // L’éditeur affiche le champ, sans l’exiger pour publier.
  const view = { ...m.EDITOR_INITIAL, phase: "ready" as const, data: { version: 1, draft: { legal_name: "Exploitant QA SAS" }, published: null } };
  const out = text(html(createElement(e.OperatorProfileEditor as never, { demo: false, superAdmin: true, initial: view } as never)));
  assert.match(out, /SIRET de l’établissement \(14 chiffres, facultatif\)/);
  assert.doesNotMatch(out, /SIRET de l’établissement \(14 chiffres, facultatif\) — requis pour publier/);
  const missing = /Publication impossible[^.]*\./.exec(out)?.[0];
  assert.ok(missing, "liste des champs manquants affichée");
  assert.match(missing, /SIREN \(9 chiffres\)/);
  assert.doesNotMatch(missing, /SIRET/, "absent de la liste des champs manquants");
});

test("lecture publique : SIRET cohérent accepté, SIRET d’un autre SIREN refusé", async () => {
  const reply = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  const ok = await m.loadPublished(reply({ published: published({ ...PROFILE, siret: SIRET }).published }));
  assert.equal(ok.phase, "ready");
  assert.equal(ok.published?.profile.siret, SIRET);
  assert.equal(m.publishedValue(ok, "siret"), SIRET);
  const mismatch = await m.loadPublished(reply({ published: published({ ...PROFILE, siret: "00000000100012" }).published }));
  assert.deepEqual(JSON.parse(JSON.stringify(mismatch)), { phase: "error", published: null });
});

test("mentions légales : la ligne SIRET n’existe qu’une fois publiée, jamais « à renseigner »", () => {
  const withSiret = text(page("legal", published({ ...PROFILE, siret: SIRET })));
  assert.match(withSiret, new RegExp(`Numéro SIRET de l’établissement : ${SIRET}`));
  assert.ok(withSiret.indexOf("Numéro SIRET de l’établissement") > withSiret.indexOf("Numéro SIREN et numéro de TVA : 000000000"), "sous la ligne SIREN");
  assert.ok(withSiret.indexOf("Numéro SIRET de l’établissement") < withSiret.indexOf("Directeur ou directrice de la publication"), "dans le bloc Éditeur");
  // Rien de publié : le SIRET validé par le propriétaire (shared/commercial-facts.ts) accompagne son SIREN, jamais « à renseigner ».
  for (const state of [{ phase: "ready", published: null }, { phase: "error", published: null }, { phase: "loading", published: null }]) {
    const legal = text(page("legal", state));
    assert.ok(legal.includes(`Numéro SIREN et numéro de TVA : ${VALIDATED_OPERATOR.siren} Numéro SIRET de l’établissement : ${VALIDATED_OPERATOR.siret} `), `${state.phase} : SIRET validé sous son SIREN`);
    assert.doesNotMatch(legal, /SIRET de l’établissement : À renseigner/, `${state.phase} : aucune ligne SIRET en attente`);
  }
  assert.ok(VALIDATED_OPERATOR.siret.startsWith(VALIDATED_OPERATOR.siren), "le SIRET validé prolonge le SIREN validé");
  // Un profil publié sans SIRET n’affiche pas le SIRET d’une autre entité (il doit prolonger le SIREN publié).
  assert.doesNotMatch(text(page("legal", published(PROFILE))), /SIRET/, "publié sans SIRET : aucune ligne");
});

test("mentions légales : la version affichée vient de la source commune", () => {
  const version = RELEASE.version.replace(/\./g, "\\.");
  for (const state of [published(PROFILE), { phase: "ready", published: null }]) {
    assert.match(page("legal", state), new RegExp(`data-app-version=""[^>]*>Version ${version}<`));
  }
});
