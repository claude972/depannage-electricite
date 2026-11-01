// UI-PUBLIC-REQUEST-001 — shared public chrome (P1), themed request view (P2) and account view
// (P3). Real components through the harness (CSS modules stubbed, no `window`).
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Chrome from "../../components/role/public-chrome";
import type { HomeHandlers } from "../../components/role/public-chrome";

const graph = () => {
  const tp = loadModule("components/app/theme-provider.tsx");
  const chrome = loadModule("components/role/public-chrome.tsx", { "@/components/app/theme-provider": tp }) as unknown as typeof Chrome;
  return { tp, chrome };
};
const noop: HomeHandlers = { onNew: () => {}, onLogin: () => {}, onNavigate: () => {}, onDemo: () => {} };
function renderChrome(props: Record<string, unknown>) {
  const { tp, chrome } = graph();
  return renderToString(createElement(tp.ThemeProvider as never, null, createElement(chrome.PublicChrome as never, { handlers: noop, onHome: () => {}, ...props } as never, createElement("p", null, "contenu")))).replaceAll("<!-- -->", "");
}

// ---- P1 : chrome partagé -------------------------------------------------------------------
test("chrome accueil : sections en boutons, marque courante, note de pied", () => {
  const html = renderChrome({ current: "home", sections: [{ id: "a", label: "Interventions" }], footerNote: "Crédits" });
  assert.match(html, /class="ui-v2 /);
  assert.match(html, /aria-label="Courant, accueil" aria-current="page"/);
  assert.match(html, /data-home-anchor="a"[^>]*>Interventions/);
  assert.doesNotMatch(html, />Accueil</);
  assert.match(html, /<main id="main"[^>]*><p>contenu<\/p><\/main>/);
  assert.match(html, />Crédits</);
  assert.doesNotMatch(html, /<a\s/);
});

test("chrome hors accueil : « Accueil » au lieu des sections, page courante marquée, sans note", () => {
  const html = renderChrome({ current: "new", sections: [{ id: "a", label: "Interventions" }] });
  assert.doesNotMatch(html, /data-home-anchor/); // pas de sections hors accueil
  assert.match(html, /data-chrome-home=""[^>]*>Accueil</);
  assert.doesNotMatch(html, /aria-label="Courant, accueil" aria-current/);
  assert.match(html, /aria-current="page"[^>]*data-home-action="new"[^>]*>Décrire ma panne/);
  assert.doesNotMatch(html, /Crédits photo/);
  const auth = renderChrome({ current: "auth" });
  assert.equal([...auth.matchAll(/aria-current="page"[^>]*data-home-action="login"/g)].length, 2); // menu + en-tête
  assert.doesNotMatch(auth, /aria-current="page"[^>]*data-home-action="new"/);
});

// ---- P2 : vue « new » ----------------------------------------------------------------------
type Calls = string[];
function fakeSession(over: Record<string, unknown> = {}) {
  const calls: Calls = [];
  const data: Record<string, unknown> = { view: "new", error: "", notice: "", categoryId: "socket", pendingDraft: null, busy: false, authMode: "login", ...over };
  const session = new Proxy(data, {
    get: (target, key) => (typeof key === "string" && key in target ? target[key] : (...args: unknown[]) => calls.push(`${String(key)}(${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(",")})`)),
  });
  return { session, calls };
}
/** Real PublicSite + real chrome + real forms, under the ThemeProvider of the same module graph. */
function renderSite(over: Record<string, unknown>) {
  const tp = loadModule("components/app/theme-provider.tsx");
  const site = loadModule("components/role/public-site.tsx", { "@/components/app/theme-provider": tp });
  const fake = fakeSession(over);
  const html = renderToString(createElement(tp.ThemeProvider as never, null, createElement(site.PublicSite as never, { session: fake.session } as never))).replaceAll("<!-- -->", "");
  return { html, calls: fake.calls };
}
/** PublicSite with spies on the shared forms and the chrome (props as actually passed). */
function spySite(over: Record<string, unknown>) {
  const captured: Record<string, any> = {};
  const site = loadModule("components/role/public-site.tsx", {
    "./public-chrome": { PublicChrome: (props: any) => ((captured.chrome = props), props.children) },
    "./public-home": { PublicHome: (props: unknown) => ((captured.home = props), null) },
    "../app/forms": {
      RequestForm: (props: unknown) => ((captured.form = props), null),
      AuthForm: (props: unknown) => ((captured.auth = props), null),
    },
  });
  const fake = fakeSession(over);
  const html = renderToString(createElement(site.PublicSite as never, { session: fake.session } as never));
  return { html, captured, calls: fake.calls };
}

test("new (SSR réel, étape 1) : chrome thémé + habillage opt-in autour du RequestForm partagé", () => {
  const { html, calls } = renderSite({ view: "new", categoryId: "socket" });
  assert.match(html, /class="ui-v2 /);
  assert.match(html, /data-chrome-home=""[^>]*>Accueil</);
  assert.match(html, /aria-current="page"[^>]*data-home-action="new"/);
  assert.match(html, /data-public-skin="request"/);
  // Garde : classes historiques réellement rendues à l’étape 1 (états 2/3 : vérifiés en navigateur).
  for (const cls of ["form-page", "back-link", "form-heading", "stepper", "panel request-form", "category-grid", "radio-dot", "field", "inline-note", "form-actions", "button primary"]) assert.match(html, new RegExp(`class="${cls}`), cls);
  // Pré-remplissage réel : la catégorie de la session est sélectionnée.
  assert.match(html, /class="selected"[^>]*>(?:(?!<\/button>).)*Prise ou interrupteur/s);
  assert.match(html, /<textarea[^>]*required=""[^>]*minLength="15"[^>]*maxLength="2000"/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /Les photos ne sont pas conservées avec le brouillon/);
  assert.doesNotMatch(html, /class="public-main/); // ancien shell absent
  assert.deepEqual(calls, []);
});

test("new : props du RequestForm strictement inchangées, retour = session.go(\"home\")", async () => {
  const draft = { category: "panel", description: "Disjoncteur qui saute", address: "1 rue A", postal_code: "97200", city: "FdF", urgency: "scheduled" };
  const { captured, calls } = spySite({ view: "new", categoryId: "panel", pendingDraft: draft, busy: true });
  const f = captured.form;
  assert.equal(f.initialCategory, "panel");
  assert.deepEqual(JSON.parse(JSON.stringify(f.initialValues)), draft);
  assert.equal(JSON.stringify(f.sites), "[]");
  assert.equal(f.mode, "public");
  assert.equal(f.busy, true);
  f.onBack();
  f.onDemo();
  await f.onSubmit(draft, []);
  assert.deepEqual(calls, ["go(home)", "startDemo(client,new)", `saveDraft(${JSON.stringify(draft)})`]);
  // Chrome : vue courante, accueil par la session (jamais window.scrollTo), callbacks réels.
  const c = captured.chrome;
  assert.equal(c.current, "new");
  assert.equal(c.sections, undefined);
  calls.length = 0;
  c.onHome();
  c.handlers.onNew("lighting");
  c.handlers.onLogin();
  c.handlers.onNavigate("join");
  assert.deepEqual(calls, ["go(home)", "setCategory(lighting)", "go(new)", "setAuthMode(login)", "go(auth)", "go(join)"]);
});

test("new : alertes de session rendues dans le thème, au-dessus du formulaire", () => {
  const { html } = renderSite({ view: "new", error: "Connexion impossible.", notice: "Brouillon conservé." });
  const alerts = html.indexOf("Connexion impossible.");
  assert.ok(alerts > html.indexOf('id="main"') && alerts < html.indexOf('data-public-skin="request"'));
  assert.match(html, /role="alert"[^>]*>(?:(?!<\/div>).)*Connexion impossible\./s);
  assert.match(html, /role="status"[^>]*>(?:(?!<\/div>).)*Brouillon conservé\./s);
});

test("habillage par périmètre : espaces client, artisan, entreprise et admin (FASTSPLIT-CLIENT-THEME-001 / FASTSPLIT-ARTISAN-ENTERPRISE-THEME-001 / FASTSPLIT-ADMIN-THEME-001) portent ThemeSurface ; forms jamais ; aucun chrome public dans les rôles", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["components/role/client-space.tsx", "components/role/artisan-space.tsx", "components/role/enterprise-space.tsx", "components/role/admin-space.tsx", "components/app/forms.tsx"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /public-chrome|public-forms/, file);
  }
  for (const file of ["components/app/forms.tsx"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /ThemeSurface|ui-v2/, file);
  }
  assert.match(readFileSync("components/role/client-space.tsx", "utf8"), /<ThemeSurface className=\{theme\.clientSkin\}>/);
  assert.match(readFileSync("components/role/artisan-space.tsx", "utf8"), /<ThemeSurface className=\{theme\.artisanSkin\}>/);
  assert.match(readFileSync("components/role/enterprise-space.tsx", "utf8"), /<ThemeSurface className=\{theme\.enterpriseSkin\}>/);
  assert.match(readFileSync("components/role/admin-space.tsx", "utf8"), /<ThemeSurface className=\{theme\.adminSkin\}>/);
  // Les thèmes de rôle ne dépendent pas du format des noms de classes générés par Next.
  for (const file of ["components/role/artisan-theme.module.css", "components/role/artisan.module.css", "components/role/enterprise-theme.module.css", "components/role/enterprise.module.css", "components/role/admin-theme.module.css", "components/role/admin.module.css"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\[class[$*^]?=/, file);
  }
  // Migrated leaf modules (quote documents, planning, notifications, support, platform operations)
  // theme themselves: no role skin may force them back to light islands, nor use a structural :has().
  for (const file of ["components/role/client-theme.module.css", "components/role/artisan-theme.module.css", "components/role/enterprise-theme.module.css", "components/role/admin-theme.module.css"]) {
    const css = readFileSync(file, "utf8");
    assert.doesNotMatch(css, /quote-documents-title|\[data-scope\]|data-theme-island|aria-labelledby\^="support-|Demandes d’assistance|:has\(/, file);
  }
  // Le RequestForm seul (tel que les rôles le rendent) ne porte aucune classe du thème.
  const forms = loadModule("components/app/forms.tsx");
  const html = renderToString(createElement(forms.RequestForm as never, { initialCategory: "panel", initialValues: null, sites: [], mode: "live", busy: false, onBack() {}, onSubmit: async () => {}, onDemo() {} } as never));
  assert.doesNotMatch(html, /ui-v2|requestSkin|data-public-skin/);
});

test("formulaire de demande : AddressField branché (combobox + 3 champs requis), aucune coordonnée dans le formulaire", async () => {
  const { readFileSync } = await import("node:fs");
  const forms = loadModule("components/app/forms.tsx");
  const html = renderToString(createElement(forms.RequestForm as never, { initialCategory: "panel", initialValues: { category: "panel", description: "Disjoncteur qui saute souvent", address: "2 rue Test", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", site_id: null }, sites: [], mode: "live", busy: false, onBack() {}, onSubmit: async () => {}, onDemo() {} } as never));
  if (/role="combobox"/.test(html)) {
    assert.match(html, /value="2 rue Test"/);
    assert.match(html, /value="97200"/);
    assert.match(html, /value="Fort-de-France"/);
  }
  const src = readFileSync("components/app/forms.tsx", "utf8");
  assert.match(src, /<AddressField/);
  assert.doesNotMatch(src, /\blat(itude)?\b|\blon(gitude)?\b|coords/, "no coordinates handled by the form");
});

// ---- P3 : vue « auth » ---------------------------------------------------------------------
test("auth (SSR réel) : login / signup / reset dans le chrome thémé, classes réellement rendues", () => {
  const guards: Record<string, string[]> = {
    login: ["auth-layout", "panel auth-form", "field", "forgot-link", "button primary full", "auth-switch", "form-note"],
    signup: ["auth-layout", "panel auth-form", "field", "button primary full", "auth-switch"],
    reset: ["auth-layout", "panel auth-form", "field", "button primary full", "auth-switch"],
  };
  const titles: Record<string, string> = { login: "Connexion", signup: "Créer un compte", reset: "Réinitialiser mon mot de passe" };
  for (const mode of ["login", "signup", "reset"]) {
    const { html, calls } = renderSite({ view: "auth", authMode: mode });
    assert.match(html, /class="ui-v2 /);
    assert.match(html, /data-public-skin="auth"/);
    assert.equal([...html.matchAll(/aria-current="page"[^>]*data-home-action="login"/g)].length, 2, mode);
    assert.match(html, new RegExp(`<h2>${titles[mode]}</h2>`));
    for (const cls of guards[mode]) assert.match(html, new RegExp(`class="${cls}`), `${mode}: ${cls}`);
    assert.equal(/type="password"/.test(html), mode !== "reset", mode);
    assert.equal(/<select/.test(html), mode === "signup", mode); // choix d’espace en inscription seulement
    assert.doesNotMatch(html, /class="public-main/);
    assert.deepEqual(calls, []);
  }
  const withDraft = renderSite({ view: "auth", authMode: "signup", pendingDraft: { category: "socket" } }).html;
  assert.match(withDraft, /Votre brouillon de demande sera repris après connexion/);
});

test("auth : props de l’AuthForm inchangées, chaque mode appelle son seul callback de session", async () => {
  const values = { email: "a@b.invalid", password: "motdepasse10", full_name: "A B", role: "client" };
  const expected: Record<string, string> = { login: "signIn(a@b.invalid,motdepasse10)", signup: `signUp(${JSON.stringify(values)})`, reset: "resetPassword(a@b.invalid)" };
  for (const mode of ["login", "signup", "reset"]) {
    const { captured, calls } = spySite({ view: "auth", authMode: mode, busy: true });
    const a = captured.auth;
    assert.equal(a.mode, mode);
    assert.equal(a.busy, true);
    await a.onSubmit(values);
    a.onMode("reset");
    a.onDemo();
    assert.deepEqual(calls, [expected[mode], "setAuthMode(reset)", "startDemo(client)"], mode);
    assert.equal(captured.chrome.current, "auth");
    calls.length = 0;
    captured.chrome.onHome();
    assert.deepEqual(calls, ["go(home)"]);
  }
});

test("parcours brouillon sans inscription automatique : home → new (catégorie) → saveDraft → auth", async () => {
  const draft = { category: "socket", description: "Prise sans courant depuis hier", address: "1 rue A", postal_code: "97200", city: "FdF", urgency: "scheduled" };
  const home = spySite({ view: "home" });
  home.captured.home.handlers.onNew("socket");
  assert.deepEqual(home.calls, ["setCategory(socket)", "go(new)"]);
  const form = spySite({ view: "new", categoryId: "socket" });
  assert.equal(form.captured.form.initialCategory, "socket");
  await form.captured.form.onSubmit(draft, []);
  assert.deepEqual(form.calls, [`saveDraft(${JSON.stringify(draft)})`]); // aucun signUp / signIn
  // saveDraft (session réelle) bascule en signup : la vue auth s’affiche sans rien soumettre.
  const auth = spySite({ view: "auth", authMode: "signup", pendingDraft: draft });
  assert.match(auth.html, /Votre brouillon de demande sera repris après connexion/);
  assert.equal(auth.captured.auth.mode, "signup");
  assert.deepEqual(auth.calls, []);
  // Retour au formulaire : valeurs restaurées depuis le brouillon.
  const back = spySite({ view: "new", categoryId: "socket", pendingDraft: draft });
  assert.equal(JSON.stringify(back.captured.form.initialValues), JSON.stringify(draft));
  assert.deepEqual(back.calls, []);
});

test("autres vues publiques : ancien shell inchangé, jamais le chrome thémé", () => {
  for (const view of ["help", "pricing", "join", "about", "privacy", "legal"]) {
    const { html } = renderSite({ view });
    assert.match(html, /class="public-main/, view);
    assert.doesNotMatch(html, /ui-v2|data-public-skin|data-chrome-home/, view);
  }
});
