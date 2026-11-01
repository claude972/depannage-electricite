// FASTSPLIT-PUBLIC-SERVICE-PAGES-001 — service pages /prestations/<slug>: shared catalogue, real
// route (static params, metadata, notFound), home cards as priced links, honest photos, and the
// `#new/<category>` deep link of the public request form (a saved draft keeps priority).
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import { CATEGORIES as DOMAIN } from "../../lib/domain";
import { money } from "../../components/app/format";
import { forbiddenClaims } from "../../components/role/public-lists";
import type * as Catalog from "../../components/role/public-service-catalog";
import type * as Home from "../../components/role/public-home";

const NOT_FOUND = "NEXT_NOT_FOUND_TEST";
const graph = () => {
  const tp = loadModule("components/app/theme-provider.tsx");
  const overrides = { "@/components/app/theme-provider": tp, "next/navigation": { notFound: () => { throw new Error(NOT_FOUND); } } };
  return {
    tp,
    page: loadModule("app/prestations/[slug]/page.tsx", overrides) as Record<string, any>,
    servicePage: loadModule("components/role/public-service-page.tsx", overrides) as Record<string, any>,
    catalog: loadModule("components/role/public-service-catalog.ts") as unknown as typeof Catalog,
    home: loadModule("components/role/public-home.tsx", overrides) as unknown as typeof Home,
  };
};
const { tp, page, servicePage, catalog, home } = graph();
const range = (category: string) => {
  const c = DOMAIN.find((x) => x.id === category)!;
  return `${money(c.min)} – ${money(c.max)}`.replace(/\s+/g, " "); // same spacing as text()
};
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg); // vm realm objects
const render = (node: unknown) => renderToString(createElement(tp.ThemeProvider as never, null, node as never)).replaceAll("<!-- -->", "");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");

test("catalogue : 8 prestations, slugs uniques, catégories ⊂ CATEGORIES (toutes couvertes), copie honnête", () => {
  const { SERVICES } = catalog;
  assert.equal(SERVICES.length, 8);
  assert.equal(new Set(SERVICES.map((s) => s.slug)).size, 8);
  for (const s of SERVICES) assert.match(s.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const ids = DOMAIN.map((c) => c.id) as string[];
  for (const s of SERVICES) assert.ok(ids.includes(s.category), s.slug);
  assert.deepEqual(new Set(SERVICES.map((s) => s.category)), new Set(ids));
  for (const s of SERVICES) {
    const copy = [s.title, s.alt, s.intro, ...s.covers, ...s.checks, ...s.faq.flatMap((f) => [f.question, f.answer])].join(" ");
    assert.deepEqual(forbiddenClaims(copy), [], s.slug);
    assert.doesNotMatch(copy, /€|\d+\s*(?:euros?|min\b|h\b)|garanti|TTC|délai de/i, s.slug); // aucun prix, délai ni garantie inventés
    assert.ok(s.covers.length >= 3 && s.checks.length >= 3 && s.faq.length >= 2, s.slug);
    assert.match(s.photo.src, /^\/home\/[a-z0-9-]+\.jpg$/);
  }
  for (const c of DOMAIN) same(catalog.serviceEstimate(c.id), { min: c.min, max: c.max, label: c.label });
});

test("conseils : constats sans injonction risquée, réseau non affirmé, inclusions renvoyées au devis détaillé", () => {
  const all = catalog.SERVICES.flatMap((s) => [s.intro, ...s.covers, ...s.checks, ...s.faq.flatMap((f) => [f.question, f.answer])]).join(" ");
  assert.doesNotMatch(all, /forcément/i);
  assert.doesNotMatch(all, /rebranchez|tentez un réarmement|réarmez(?!\s+pas)/i);
  for (const s of catalog.SERVICES) for (const f of s.faq) {
    // Toute mention de réarmement dans un conseil exclut le cas du tableau qui chauffe ou sent le brûlé.
    if (/réarm/i.test(f.answer)) assert.match(f.answer, /ne forcez pas|ne le réarmez pas/i, s.slug);
    if (/réarm/i.test(f.answer)) assert.match(f.answer, /chauffe|brûlé|traces noires/i, s.slug);
    if (/inclus|compris/i.test(f.question)) {
      assert.match(f.answer, /devis détaillé/, s.slug);
      assert.doesNotMatch(f.answer, /^Non\b/, s.slug); // jamais d’exclusion contractuelle tirée d’une estimation
    }
  }
  const byslug = (slug: string) => catalog.SERVICES.find((s) => s.slug === slug)!.faq.map((f) => f.answer).join(" ");
  assert.match(byslug("panne-tableau-electrique"), /N’ouvrez pas le tableau/);
  assert.match(byslug("disjoncteur-qui-saute"), /Notez les appareils/);
  assert.match(byslug("disjoncteur-qui-saute"), /Ne démontez rien/);
  assert.match(byslug("prise-abimee-ou-qui-chauffe"), /Cessez d’utiliser la prise et ne la démontez pas/);
  assert.match(byslug("eclairage-qui-ne-sallume-plus"), /un seul point lumineux ou plusieurs/);
  const outage = byslug("coupure-de-courant-partielle");
  assert.match(outage, /réseau de distribution/);
  assert.match(outage, /installation commune de l’immeuble/);
  assert.match(outage, /gestionnaire de l’immeuble/);
});

test("photos : cartes prise = vraie prise, jamais la photo du luminaire ; le luminaire va à l’éclairage", () => {
  const { SERVICES, SERVICE_PHOTOS } = catalog;
  const fixture = SERVICE_PHOTOS.fixture.src;
  assert.equal(fixture, "/home/section-socket.jpg");
  for (const s of SERVICES.filter((x) => x.category === "socket")) {
    assert.notEqual(s.photo.src, fixture, s.slug);
    assert.equal(s.photo.src, "/home/section-outlet.jpg", s.slug);
  }
  assert.equal(SERVICES.find((s) => s.category === "lighting")!.photo.src, fixture);
});

test("route : 8 paramètres statiques, dynamicParams désactivé, métadonnées, slug inconnu ⇒ notFound", async () => {
  assert.equal(page.dynamicParams, false);
  same(page.generateStaticParams(), catalog.SERVICES.map((s) => ({ slug: s.slug })));
  for (const s of catalog.SERVICES) {
    const meta = await page.generateMetadata({ params: Promise.resolve({ slug: s.slug }) });
    assert.equal(meta.title, `${s.title} — Courant`);
    assert.ok(meta.description.replace(/\s+/g, " ").includes(range(s.category)));
  }
  same(await page.generateMetadata({ params: Promise.resolve({ slug: "inconnu" }) }), {});
  for (const slug of ["inconnu", "", "PANNE-TABLEAU-ELECTRIQUE", "../admin"]) await assert.rejects(() => page.default({ params: Promise.resolve({ slug }) }), new RegExp(NOT_FOUND), slug);
});

test("page : chacune des 8 prestations rend titre, photo, fourchette canonique et CTA vers #new/<catégorie>", async () => {
  for (const s of catalog.SERVICES) {
    const html = render(await page.default({ params: Promise.resolve({ slug: s.slug }) }));
    assert.match(html, /class="ui-v2 /, s.slug); // même chrome thémé que l’accueil
    assert.match(html, new RegExp(`<h1 id="service-title">${s.title.replace(/[’]/g, "’")}</h1>`), s.slug);
    assert.match(html, new RegExp(`<img src="${s.photo.src}" alt="${s.alt.replace(/[()]/g, "\\$&")}"`), s.slug);
    const price = html.slice(html.indexOf("data-service-price"), html.indexOf("data-service-cta"));
    assert.ok(text(price).includes(range(s.category)), s.slug);
    assert.match(text(price), /Estimation indicative/);
    const ctas = [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>Décrire ma panne/g)].map((m) => m[1]);
    assert.deepEqual(ctas, [`/#new/${s.category}`, `/#new/${s.category}`], s.slug);
    for (const h of ["Ce que couvre ce dépannage", "Vérifications possibles selon le diagnostic", "Comment ça se passe", "Questions fréquentes"]) assert.match(html, new RegExp(h), s.slug);
    assert.deepEqual(forbiddenClaims(text(html)), [], s.slug);
  }
});

test("chrome de la page : chaque action mène à la vraie vue de l’application (hash)", () => {
  const seen: string[] = [];
  const h = servicePage.serviceChromeHandlers((href: string) => seen.push(href));
  h.onNew(); h.onNew("panel"); h.onLogin(); h.onNavigate("help"); h.onNavigate("pricing"); h.onDemo(); h.onDemo("manager");
  same(seen, ["/#new", "/#new/panel", "/#auth", "/#help", "/#pricing", "/#demo/client", "/#demo/manager"]);
});

test("accueil : chaque carte est un lien vers sa prestation avec sa fourchette indicative", () => {
  const html = render(createElement(home.PublicHome as never, { handlers: { onNew() {}, onLogin() {}, onNavigate() {}, onDemo() {} } } as never));
  const cards = [...html.matchAll(/<a class="ivc" href="([^"]*)" data-service-card="([^"]*)">([\s\S]*?)<\/a>/g)];
  assert.equal(cards.length, 8);
  for (const [i, s] of catalog.SERVICES.entries()) {
    const [, href, slug, body] = cards[i];
    assert.equal(href, `/prestations/${s.slug}`);
    assert.equal(slug, s.slug);
    assert.ok(text(body).includes(`Estimation indicative : ${range(s.category)}`), s.slug);
    assert.match(body, new RegExp(`src="${s.photo.src}"`), s.slug);
  }
  for (const card of home.HOME_CARDS.filter((c) => c.category === "socket")) assert.notEqual(card.image, "/home/section-socket.jpg", card.slug);
});

// ---- #new/<catégorie> : pré-sélection du formulaire public ------------------------------------
function spyNew(over: Record<string, unknown>) {
  const captured: Record<string, any> = {};
  const site = loadModule("components/role/public-site.tsx", {
    "./public-chrome": { PublicChrome: (props: any) => props.children },
    "./public-home": { PublicHome: () => null },
    "../app/forms": { RequestForm: (props: unknown) => ((captured.form = props), null), AuthForm: () => null },
  });
  const data: Record<string, unknown> = { view: "new", param: "", error: "", notice: "", categoryId: "outage", pendingDraft: null, busy: false, authMode: "login", ...over };
  const session = new Proxy(data, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : () => {}) });
  renderToString(createElement(site.PublicSite as never, { session } as never));
  return captured.form as { initialCategory: string; initialValues: unknown };
}

test("#new/<catégorie> : catégorie connue pré-sélectionnée, inconnue ignorée, brouillon prioritaire", () => {
  for (const c of DOMAIN) assert.equal(spyNew({ param: c.id }).initialCategory, c.id);
  for (const param of ["", "zzz", "Panel", "panel/extra", "__proto__"]) assert.equal(spyNew({ param }).initialCategory, "outage", param);
  const draft = { category: "panel", description: "Brouillon conservé" };
  const withDraft = spyNew({ param: "lighting", pendingDraft: draft });
  assert.equal(withDraft.initialCategory, "outage");
  assert.deepEqual(withDraft.initialValues, draft);
});
