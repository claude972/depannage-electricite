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
import { forbiddenClaims } from "../../components/role/public-lists";
import type * as Home from "../../components/role/public-home";
import type { HomeAction, HomeHandlers } from "../../components/role/public-home";

// Loaded through the harness (CSS modules stubbed); `window` stays undefined (SSR conditions).
const themeProvider = () => loadModule("components/app/theme-provider.tsx");
const loadHome = () => {
  const tp = themeProvider();
  return { tp, home: loadModule("components/role/public-home.tsx", { "@/components/app/theme-provider": tp }) as unknown as typeof Home };
};
const { HOME_CARDS, HOME_SITUATIONS, HOME_SLIDES, actionKey, parseActionKey, runHomeAction, slideKeyDelta, stepSlide, tabKeyTarget } = loadHome().home;

type Calls = string[];
function recordingHandlers(calls: Calls): HomeHandlers {
  return {
    onNew: (...args: unknown[]) => calls.push(`new(${args.join(",")})`),
    onLogin: () => calls.push("login()"),
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

test("slides manuelles : bouclage dans les deux sens, flèches clavier seulement", () => {
  assert.equal(stepSlide(0, 2, 1), 1);
  assert.equal(stepSlide(1, 2, 1), 0);
  assert.equal(stepSlide(0, 2, -1), 1);
  assert.equal(stepSlide(0, 0, 1), 0);
  assert.equal(slideKeyDelta("ArrowLeft"), -1);
  assert.equal(slideKeyDelta("ArrowRight"), 1);
  for (const key of ["Enter", " ", "ArrowUp", "Tab"]) assert.equal(slideKeyDelta(key), null);
  assert.equal(HOME_SLIDES.length, 2);
  // Aucune lecture automatique : pas de minuterie dans le composant.
  const source = readFileSync(path.join(ROOT, "components/role/public-home.tsx"), "utf8");
  assert.doesNotMatch(source, /setInterval|setTimeout|requestAnimationFrame/);
});

test("onglets : ←/→ bouclent, Home/End, autres touches ignorées", () => {
  assert.equal(tabKeyTarget("ArrowRight", 4, 5), 0);
  assert.equal(tabKeyTarget("ArrowLeft", 0, 5), 4);
  assert.equal(tabKeyTarget("Home", 3, 5), 0);
  assert.equal(tabKeyTarget("End", 1, 5), 4);
  assert.equal(tabKeyTarget("Enter", 1, 5), null);
  assert.equal(tabKeyTarget("ArrowRight", 0, 0), null);
});

test("actions : clé ↔ action aller-retour, clés inconnues refusées, callbacks exacts", () => {
  const actions: HomeAction[] = [{ type: "new" }, ...CATEGORIES.map((c) => ({ type: "new" as const, category: c.id })), { type: "login" }, { type: "view", view: "join" }, { type: "view", view: "help" }, { type: "demo" }, { type: "demo", role: "manager" }];
  for (const a of actions) assert.equal(JSON.stringify(parseActionKey(actionKey(a))), JSON.stringify(a)); // objets d’un autre realm (vm)
  for (const bad of ["", "new:heating", "view:admin", "view:new", "demo:admin", "login:x", "new:socket:x", "pay"]) assert.equal(parseActionKey(bad), null, bad);
  const calls: Calls = [];
  const h = recordingHandlers(calls);
  runHomeAction({ type: "new" }, h);
  runHomeAction({ type: "new", category: "socket" }, h);
  runHomeAction({ type: "login" }, h);
  runHomeAction({ type: "view", view: "join" }, h);
  runHomeAction({ type: "demo" }, h);
  runHomeAction({ type: "demo", role: "manager" }, h);
  assert.deepEqual(calls, ["new()", "new(socket)", "login()", "navigate(join)", "demo()", "demo(manager)"]);
});

test("contenu : cartes et onglets = catégories métier réelles, sans prix ni promesse", () => {
  const ids = CATEGORIES.map((c) => c.id);
  for (const card of HOME_CARDS) assert.ok(ids.includes(card.category), card.title);
  assert.deepEqual(new Set(HOME_CARDS.map((c) => c.category)), new Set(ids)); // chaque catégorie a une carte
  assert.deepEqual(Object.keys(HOME_SITUATIONS).sort(), [...ids].sort());
});

test("SSR sans window : structure, 5 onglets métier, slides, thème, aucune ancre de hash", () => {
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
  const html = renderHome({ handlers: recordingHandlers([]) });
  assert.match(html, /class="ui-v2 /);
  assert.match(html, /data-theme-toggle="pending"/); // thème inconnu avant montage : pas d’état faux
  assert.match(html, /<main id="main"/);
  assert.match(html, /aria-label="Navigation principale"/);
  assert.match(html, /<h1[^>]*>Une panne électrique/);
  // Onglets : exactement les 5 CATEGORIES, dans l’ordre, un seul sélectionné et tabulable.
  const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]+)<\/button>/g)];
  assert.deepEqual(tabs.map((m) => m[1]), CATEGORIES.map((c) => c.label));
  assert.equal(tabs.filter((m) => /aria-selected="true"/.test(m[0])).length, 1);
  assert.equal(tabs.filter((m) => /tabindex="0"/.test(m[0])).length, 1);
  const panels = [...html.matchAll(/<div[^>]*role="tabpanel"[^>]*>/g)];
  assert.equal(panels.length, 5);
  assert.equal(panels.filter((m) => /hidden=""/.test(m[0])).length, 4);
  // Slides : 2 diapositives, la seconde masquée ; commandes ≥ 44 px côté CSS.
  const slides = [...html.matchAll(/<div[^>]*aria-roledescription="diapositive"[^>]*>/g)];
  assert.equal(slides.length, 2);
  assert.match(slides[1][0], /hidden=""/);
  assert.match(html, /aria-roledescription="carrousel"/);
  assert.equal(attr(html, "aria-current").filter((v) => v === "true").length, 1);
  // Routage par hash : aucun href="#…" (les sections s’atteignent par boutons) ; les seuls liens
  // sont les 8 cartes d’intervention vers leur page de prestation (FASTSPLIT-PUBLIC-SERVICE-PAGES-001).
  const links = [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(JSON.stringify(links), JSON.stringify(HOME_CARDS.map((c) => `/prestations/${c.slug}`)));
  assert.ok(attr(html, "href").every((h) => h.startsWith("/home/") || h.startsWith("/prestations/")), "préchargements d’images et pages de prestation");
  assert.deepEqual(attr(html, "data-home-anchor").sort(), ["accueil-conseils", "accueil-interventions", "accueil-services"]);
  for (const id of attr(html, "data-home-anchor")) assert.match(html, new RegExp(`id="${id}"`));
  // Copie : aucun prix (hors fourchette indicative des cartes, vérifiée dans public-service.test.ts),
  // avis, délai ou promesse interdite.
  const copy = text(html.replace(/<span class="ivcPrice">[\s\S]*?<\/span>/g, ""));
  assert.doesNotMatch(copy, /€|\bavis\b|note moyenne|\d+\s*min\b|certifi|qualifi/i);
  assert.deepEqual(forbiddenClaims(copy), []);
  assert.doesNotMatch(copy, /publicité|sponsoris/i);
  assert.match(copy, /Conseils et formation/);
  assert.match(copy, /Nous rejoindre/);
});

test("SSR : chaque contrôle rendu appelle le bon callback réel", () => {
  const html = renderHome({ handlers: recordingHandlers([]) });
  const keys = attr(html, "data-home-action");
  assert.ok(keys.length > 20);
  const calls: Calls = [];
  const h = recordingHandlers(calls);
  for (const key of keys) {
    const action = parseActionKey(key);
    assert.ok(action, `clé rendue inconnue : ${key}`);
    runHomeAction(action, h);
  }
  const seen = new Set(calls);
  for (const expected of ["new()", ...CATEGORIES.map((c) => `new(${c.id})`), "login()", "navigate(join)", "navigate(help)", "navigate(pricing)", "navigate(about)", "navigate(privacy)", "navigate(legal)", "demo()", "demo(manager)"]) assert.ok(seen.has(expected), expected);
  for (const call of seen) assert.match(call, /^(new\((outage|panel|socket|lighting|diagnostic)?\)|login\(\)|navigate\((help|pricing|join|about|privacy|legal)\)|demo\((manager)?\))$/);
  // Chaque panneau d’onglet mène à sa propre catégorie.
  const panels = new Map([...html.matchAll(/<div role="tabpanel" id="[^"]*-panel-(\w+)"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual([...panels.keys()], CATEGORIES.map((c) => c.id));
  for (const c of CATEGORIES) {
    const panelKeys = attr(panels.get(c.id)!, "data-home-action");
    assert.equal(panelKeys.length, HOME_SITUATIONS[c.id].length + 1, c.id);
    assert.ok(panelKeys.every((k) => k === `new:${c.id}`), c.id);
  }
  // « Nous rejoindre » → vue réelle join ; « Conseils » → aide réelle uniquement.
  assert.match(html, /data-home-action="view:join"[^>]*>Nous rejoindre/);
  const advice = html.slice(html.indexOf('id="accueil-conseils"'), html.indexOf("Rejoignez notre réseau"));
  assert.ok(attr(advice, "data-home-action").every((k) => k === "view:help"));
});

test("SSR : vue inconnue → message de connexion conservé", () => {
  const html = renderHome({ gated: true, handlers: recordingHandlers([]) });
  assert.match(html, /role="status"[^>]*>.*Connectez-vous pour accéder à cet espace/s);
});

test("photos : uniquement les 5 retenues de 6bc0cab, présentes, créditées ; électroménager exclu", () => {
  const html = renderHome({ handlers: recordingHandlers([]) });
  const srcs = new Set(attr(html, "src"));
  const kept = ["hero-photo-1.jpg", "hero-photo-2.jpg", "section-real-panel.jpg", "section-socket.jpg", "section-outlet.jpg"];
  assert.deepEqual([...srcs].sort(), kept.map((f) => `/home/${f}`).sort());
  const credits = readFileSync(path.join(ROOT, "public/home/CREDITS.md"), "utf8");
  for (const f of kept) {
    assert.ok(existsSync(path.join(ROOT, "public/home", f)), f);
    assert.match(credits, new RegExp(f.replace(".", "\\.")));
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
  handlers.onNavigate("join");
  handlers.onNavigate("help");
  handlers.onDemo();
  handlers.onDemo("manager");
  assert.deepEqual(calls, ["go(new)", "setCategory(panel)", "go(new)", "setAuthMode(login)", "go(auth)", "go(join)", "go(help)", "startDemo(undefined)", "startDemo(manager)"]);
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
  assert.deepEqual(anchors.map((m) => m[1]), ["accueil-interventions", "accueil-services", "accueil-conseils"]);
  for (const [tag] of anchors) {
    assert.match(tag, /type="button"/);
    assert.doesNotMatch(tag, /href=|data-home-action=/);
  }
  assert.doesNotMatch(html, /<a\s[^>]*href="#/);
  assert.deepEqual(calls, []); // le rendu n’écrit rien dans la session
});
