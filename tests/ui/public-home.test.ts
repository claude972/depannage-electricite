// UI-PUBLIC-HOME-001 — public home: pure helpers, rendered control → real callback mapping,
// SSR (no window), PublicSite wiring through the real PublicSession callbacks, and the draft
// journey home → new (category pre-filled) → draft → auth.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ROOT, loadModule } from "../documents/harness";
import { CATEGORIES } from "../../components/app/format";
import { SERVICES } from "../../components/role/public-service-catalog";
import { forbiddenClaims } from "../../components/role/public-lists";
import type * as Home from "../../components/role/public-home";
import type { HomeAction, HomeHandlers } from "../../components/role/public-home";

// Loaded through the harness (CSS modules stubbed); `window` stays undefined (SSR conditions).
const themeProvider = () => loadModule("components/app/theme-provider.tsx");
const loadHome = () => {
  const tp = themeProvider();
  return { tp, home: loadModule("components/role/public-home.tsx", { "@/components/app/theme-provider": tp }) as unknown as typeof Home };
};
const { actionKey, parseActionKey, runHomeAction, tabKeyTarget } = loadHome().home;

type Calls = string[];
function recordingHandlers(calls: Calls): HomeHandlers {
  return {
    onNew: (...args: unknown[]) => calls.push(`new(${args.join(",")})`),
    onLogin: () => calls.push("login()"),
    onAddress: () => calls.push("address()"),
    onNavigate: (view) => calls.push(`navigate(${view})`),
    onDemo: (...args: unknown[]) => calls.push(`demo(${args.join(",")})`),
  };
}
function renderHome(props: Record<string, unknown>) {
  const { tp, home } = loadHome();
  const tree = createElement(tp.ThemeProvider as never, null, createElement(home.PublicHome as never, props as never));
  return renderToString(tree).replaceAll("<!-- -->", "");
}
const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("onglets : ←/→ bouclent, Home/End, autres touches ignorées", () => {
  assert.equal(tabKeyTarget("ArrowRight", 2, 3), 0);
  assert.equal(tabKeyTarget("ArrowLeft", 0, 3), 2);
  assert.equal(tabKeyTarget("Home", 2, 3), 0);
  assert.equal(tabKeyTarget("End", 1, 3), 2);
  assert.equal(tabKeyTarget("Enter", 1, 3), null);
  assert.equal(tabKeyTarget("ArrowRight", 0, 0), null);
});

test("actions : clé ↔ action aller-retour, clés inconnues refusées, callbacks exacts", () => {
  const actions: HomeAction[] = [{ type: "new" }, ...CATEGORIES.map((c) => ({ type: "new" as const, category: c.id })), { type: "login" }, { type: "address" }, { type: "view", view: "join" }, { type: "view", view: "help" }, { type: "demo" }, { type: "demo", role: "manager" }];
  for (const a of actions) assert.equal(JSON.stringify(parseActionKey(actionKey(a))), JSON.stringify(a)); // objets d’un autre realm (vm)
  for (const bad of ["", "new:heating", "view:admin", "view:new", "demo:admin", "login:x", "new:socket:x", "pay"]) assert.equal(parseActionKey(bad), null, bad);
  const calls: Calls = [];
  const h = recordingHandlers(calls);
  runHomeAction({ type: "new" }, h);
  runHomeAction({ type: "new", category: "socket" }, h);
  runHomeAction({ type: "login" }, h);
  runHomeAction({ type: "address" }, h);
  runHomeAction({ type: "view", view: "join" }, h);
  runHomeAction({ type: "demo" }, h);
  runHomeAction({ type: "demo", role: "manager" }, h);
  assert.deepEqual(calls, ["new()", "new(socket)", "login()", "address()", "navigate(join)", "demo()", "demo(manager)"]);
});

test("SSR : maquette Web et PWA, menu à droite, trois onglets et les huit fiches réelles", () => {
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
  const html = renderHome({ handlers: recordingHandlers([]) });
  assert.match(html, /class="ui-v2 /);
  assert.match(html, /data-ui-appearance="light"/);
  assert.doesNotMatch(html, /data-theme-toggle/);
  assert.match(html, /<main id="main"/);
  assert.match(html, /<h1[^>]*>.*Dépannage électrique.*Un problème<br\/>électrique/);
  assert.match(html, /aria-label="Navigation rapide"/);
  assert.match(html, /data-home-action="address"[^>]*>.*Choisir mon adresse/);
  assert.match(html, /data-home-action="new"[^>]*>Présenter mon besoin/);
  assert.match(html, /Candidature électricien.*href="\/suivi".*Nous contacter.*aria-label="Ouvrir le menu".*aria-label="Navigation principale"/);

  const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>[\s\S]*?<\/button>/g)];
  assert.deepEqual(tabs.map(([tab]) => text(tab).trim()), ["Dépannage", "Installation", "Diagnostic"]);
  assert.equal(tabs.filter(([tab]) => /aria-selected="true"/.test(tab)).length, 1);
  assert.equal(tabs.filter(([tab]) => /tabindex="0"/.test(tab)).length, 1);
  assert.match(html, /id="accueil-services"[^>]*role="tabpanel" aria-labelledby="mode-repair"/);
  assert.deepEqual(attr(html, "data-service-card"), SERVICES.map((service) => service.slug));
  assert.deepEqual(attr(html, "data-home-anchor").sort(), ["accueil-conseils", "accueil-interventions", "accueil-services"]);
  for (const id of attr(html, "data-home-anchor")) assert.match(html, new RegExp(`id="${id}"`));

  const copy = text(html.replace(/<span class="ivcPrice">[\s\S]*?<\/span>/g, ""));
  assert.doesNotMatch(copy, /€|\bavis\b|note moyenne|\d+\s*min\b|certifi|qualifi|publicité|sponsoris/i);
  assert.deepEqual(forbiddenClaims(copy), []);
  assert(copy.indexOf("Nos engagements") < copy.indexOf("Les interventions électriques les plus courantes"));
  for (const href of ["/#new/urgent", "/#new/scheduled", "/suivi", "/#help/contact", "/#help/garantie", "/#pricing/zones", "/conseils#prises", "/conseils#devis", "/conseils#rendez-vous"]) {
    assert(attr(html, "href").includes(href), href);
  }
});

test("SSR : chaque contrôle rendu appelle le bon callback réel", () => {
  const html = renderHome({ handlers: recordingHandlers([]) });
  const keys = attr(html, "data-home-action");
  const calls: Calls = [];
  const h = recordingHandlers(calls);
  for (const key of keys) {
    const action = parseActionKey(key);
    assert.ok(action, `clé rendue inconnue : ${key}`);
    runHomeAction(action, h);
  }
  assert.deepEqual([...new Set(calls)].sort(), ["new()", "login()", "address()", "navigate(join)", "navigate(pricing)", "navigate(about)", "navigate(privacy)", "navigate(legal)", "navigate(help)", "demo(manager)"].sort());
  assert.match(html, /data-home-action="view:join"[^>]*>Découvrir la candidature/);
});

test("SSR : vue inconnue → message de connexion conservé", () => {
  const html = renderHome({ gated: true, handlers: recordingHandlers([]) });
  assert.match(html, /role="status"[^>]*>.*Connectez-vous pour accéder à cet espace/s);
});

test("photos : illustrations locales créditées et texte alternatif pour chaque image", () => {
  const html = renderHome({ handlers: recordingHandlers([]) });
  const srcs = new Set(attr(html, "src"));
  for (const logo of ["/brand/domdepannage-noir.png", "/brand/domdepannage-bleu.png"]) {
    assert.ok(srcs.delete(logo), logo);
    assert.ok(existsSync(path.join(ROOT, "public", logo)), logo);
  }
  const kept = [...new Set(SERVICES.map((service) => service.photo.src))];
  assert.deepEqual([...srcs].sort(), kept.sort());
  const credits = readFileSync(path.join(ROOT, "public/home/CREDITS.md"), "utf8");
  for (const f of kept) {
    assert.ok(existsSync(path.join(ROOT, "public", f)), f);
    assert.match(credits, new RegExp(path.basename(f).replace(".", "\\.")));
  }
  for (const id of ["17842832", "27928762", "27928760", "7647233", "5691599"]) assert.match(credits, new RegExp(id));
  assert.doesNotMatch(html, /section-panel\.jpg|section-tech\.jpg|34054464|34054474/);
  for (const m of html.matchAll(/<img [^>]*>/g)) assert.match(m[0], /alt="/); // décoratives : alt=""
});

// ---- PublicSite : câblage réel via la PublicSession existante -----------------------------------
function fakeSession(over: Record<string, unknown> = {}) {
  const calls: Calls = [];
  const data: Record<string, unknown> = { view: "home", error: "", notice: "", categoryId: "outage", pendingDraft: null, busy: false, authMode: "login", ...over };
  const session = new Proxy(data, {
    get: (target, key) => (typeof key === "string" && key in target ? target[key] : (...args: unknown[]) => calls.push(`${String(key)}(${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(",")})`)),
  });
  return { session, calls };
}
function loadSite(captured: Record<string, unknown>) {
  return loadModule("components/role/public-site.tsx", {
    "./public-home": { PublicHome: (props: unknown) => ((captured.home = props), null) },
    // Every public view renders in PublicChrome (UI-PUBLIC-REQUEST-001): pass-through, theme-free.
    "./public-chrome": { PublicChrome: (props: { children: unknown }) => props.children },
    "../app/forms": {
      RequestForm: (props: unknown) => ((captured.form = props), null),
      AuthForm: (props: unknown) => ((captured.auth = props), null),
    },
  });
}

test("PublicSite : la vue home rend PublicHome avec les callbacks réels de la session", () => {
  const captured: Record<string, unknown> = {};
  const { session, calls } = fakeSession();
  const site = loadSite(captured);
  const html = renderToString(createElement(site.PublicSite as never, { session } as never));
  assert.doesNotMatch(html, /Comment ça marche<\/button>/); // ancien en-tête non rendu sur l’accueil
  const { handlers, gated } = captured.home as { handlers: HomeHandlers; gated: boolean };
  assert.equal(gated, false);
  handlers.onNew();
  handlers.onNew("panel");
  handlers.onLogin();
  handlers.onAddress?.();
  handlers.onNavigate("join");
  handlers.onNavigate("help");
  handlers.onDemo();
  handlers.onDemo("manager");
  assert.deepEqual(calls, ["go(new)", "setCategory(panel)", "go(new)", "setAuthMode(login)", "go(auth)", "go(new,address)", "go(join)", "go(help)", "startDemo(undefined)", "startDemo(manager)"]);
});

test("PublicSite : vue inconnue → accueil avec message de connexion ; autres vues rendues dans le chrome partagé", () => {
  const captured: Record<string, unknown> = {};
  const site = loadSite(captured);
  renderToString(createElement(site.PublicSite as never, { session: fakeSession({ view: "admin" }).session } as never));
  assert.equal((captured.home as { gated: boolean }).gated, true);
  delete captured.home;
  const help = renderToString(createElement(site.PublicSite as never, { session: fakeSession({ view: "help" }).session } as never));
  assert.equal(captured.home, undefined);
  // The header/nav now comes from PublicChrome (mocked pass-through here): no old shell header.
  assert.doesNotMatch(help, /aria-label="Navigation principale"/);
  assert.match(help, /Questions fréquentes/);
});

test("parcours brouillon : home → décrire (catégorie pré-remplie) → brouillon → auth, sans mutation", async () => {
  const captured: Record<string, unknown> = {};
  const site = loadSite(captured);
  const home = fakeSession();
  renderToString(createElement(site.PublicSite as never, { session: home.session } as never));
  (captured.home as { handlers: HomeHandlers }).handlers.onNew("socket");
  assert.deepEqual(home.calls, ["setCategory(socket)", "go(new)"]);
  // Vue « new » : le formulaire reçoit la catégorie choisie et n’enregistre qu’un brouillon local.
  const form = fakeSession({ view: "new", categoryId: "socket" });
  renderToString(createElement(site.PublicSite as never, { session: form.session } as never));
  const props = captured.form as { initialCategory: string; mode: string; onSubmit: (v: unknown) => Promise<void> };
  assert.equal(props.initialCategory, "socket");
  assert.equal(props.mode, "public");
  await props.onSubmit({ category: "socket", description: "Prise sans courant" });
  assert.deepEqual(form.calls, ['saveDraft({"category":"socket","description":"Prise sans courant"})']);
  // Vue « auth » avec brouillon : reprise annoncée, aucune autre commande.
  const auth = fakeSession({ view: "auth", pendingDraft: { category: "socket" } });
  const html = renderToString(createElement(site.PublicSite as never, { session: auth.session } as never));
  assert.match(html, /Votre brouillon de demande sera repris après connexion/);
  assert.deepEqual(auth.calls, []);
});

test("Les raccourcis urgence, planning et installation préremplissent le formulaire réel sans écraser un brouillon", () => {
  const captured: Record<string, unknown> = {};
  const site = loadSite(captured);
  const formFor = (params: Record<string, unknown>) => {
    const { session, calls } = fakeSession({ view: "new", ...params });
    renderToString(createElement(site.PublicSite as never, { session } as never));
    assert.deepEqual(calls, []);
    return captured.form as { initialUrgency?: string; initialDescription?: string; initialCategory: string; initialValues?: object; addressFirst: boolean };
  };
  assert.equal(formFor({ param: "urgent" }).initialUrgency, "urgent");
  const scheduled = formFor({ param: "scheduled" });
  assert.equal(scheduled.initialUrgency, "scheduled");
  assert.equal(scheduled.addressFirst, true);
  const installation = formFor({ param: "installation-prise" });
  assert.equal(installation.initialCategory, "socket");
  assert.equal(installation.initialDescription, "Ajouter une prise");
  const draft = { category: "lighting", description: "Brouillon", urgency: "scheduled" };
  const existing = formFor({ param: "urgent", pendingDraft: draft });
  assert.equal(existing.initialUrgency, undefined);
  assert.equal(existing.initialValues, draft);
});

// ---- Navigation interne : jamais de hash ni de session (routeur par hash de l’app) ---------------
test("sections : défilement + focus du titre, sans toucher location/history ; mouvement réduit respecté", () => {
  const { scrollToSection } = loadHome().home;
  for (const reduce of [false, true]) {
    const log: string[] = [];
    const heading = { focus: (o: unknown) => log.push(`focus ${JSON.stringify(o)}`) };
    const doc = { getElementById: (id: string) => (id === "accueil-services" ? { scrollIntoView: (o: unknown) => log.push(`scroll ${JSON.stringify(o)}`), querySelector: (sel: string) => (sel === "h2" ? heading : null) } : null) };
    const win = new Proxy({ matchMedia: (q: string) => ({ matches: reduce && q.includes("reduce") }) } as Record<string, unknown>, {
      get: (t, k) => {
        if (k === "location" || k === "history") throw new Error(`accès interdit : ${String(k)}`);
        return t[k as string];
      },
    });
    scrollToSection("accueil-services", doc as never, win as never);
    assert.deepEqual(log, [`scroll {"behavior":"${reduce ? "auto" : "smooth"}","block":"start"}`, 'focus {"preventScroll":true}']);
    scrollToSection("inconnue", doc as never, win as never); // section absente : rien
    assert.equal(log.length, 2);
  }
});

test("PublicSite réel : liens de section = boutons sans href ni action de session", () => {
  const { session, calls } = fakeSession();
  // ThemeSurface lit le contexte : rendu sous le ThemeProvider du même graphe de modules.
  const siteTp = loadModule("components/app/theme-provider.tsx");
  const siteWithTp = loadModule("components/role/public-site.tsx", { "@/components/app/theme-provider": siteTp });
  const html = renderToString(createElement(siteTp.ThemeProvider as never, null, createElement(siteWithTp.PublicSite as never, { session } as never)));
  const anchors = [...html.matchAll(/<button[^>]*data-home-anchor="([^"]+)"[^>]*>/g)];
  assert.deepEqual(anchors.map((m) => m[1]), ["accueil-services", "accueil-interventions", "accueil-conseils"]);
  for (const [tag] of anchors) {
    assert.match(tag, /type="button"/);
    assert.doesNotMatch(tag, /href=|data-home-action=/);
  }
  assert.doesNotMatch(html, /<a\s[^>]*href="#/);
  assert.deepEqual(calls, []); // le rendu n’écrit rien dans la session
});
