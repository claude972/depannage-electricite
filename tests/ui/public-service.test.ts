// FASTSPLIT-PUBLIC-SERVICE-PAGES-001 — service pages /prestations/<slug>: shared catalogue, real
// route (static params, metadata, notFound), home cards as priced links, honest photos, and the
// `#new/<category>` deep link of the public request form (a saved draft keeps priority).
import test from "node:test";
import * as draftModule from "../../components/app/booking-draft";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, loadModule } from "../documents/harness";
import { CATEGORIES as DOMAIN } from "../../lib/domain";
import { money } from "../../components/app/format";
import { forbiddenClaims } from "../../components/role/public-lists";
import type * as Catalog from "../../components/role/public-service-catalog";

const NOT_FOUND = "NEXT_NOT_FOUND_TEST";
const graph = () => {
  const tp = loadModule("components/app/theme-provider.tsx");
  const overrides = {
    "@/components/app/theme-provider": tp,
    "next/navigation": {
      notFound: () => { throw new Error(NOT_FOUND); },
      useRouter: () => ({ push: () => assert.fail("SSR must not navigate") }),
    },
  };
  return {
    tp,
    page: loadModule("app/prestations/[slug]/page.tsx", overrides) as Record<string, any>,
    servicePage: loadModule("components/role/public-service-page.tsx", overrides) as Record<string, any>,
    catalog: loadModule("components/role/public-service-catalog.ts") as unknown as typeof Catalog,
    catalogue: loadModule("app/prestations/page.tsx", overrides) as Record<string, any>,
  };
};
const { tp, page, servicePage, catalog, catalogue } = graph();
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
    const copy = [s.title, s.alt, s.intro, ...s.covers, ...s.checks, ...s.extras, ...s.faq.flatMap((f) => [f.question, f.answer])].join(" ");
    assert.deepEqual(forbiddenClaims(copy), [], s.slug);
    assert.doesNotMatch(copy, /€|\d+\s*(?:euros?|min\b|h\b)|garanti|TTC|délai de/i, s.slug); // aucun prix, délai ni garantie inventés
    assert.ok(s.covers.length >= 3 && s.checks.length >= 3 && s.faq.length >= 2, s.slug);
    assert.match(s.photo.src, /^\/home\/[a-z0-9-]+\.jpg$/);
  }
  for (const c of DOMAIN) same(catalog.serviceEstimate(c.id), { min: c.min, max: c.max, label: c.label });
});

test("conseils : constats sans injonction risquée, réseau non affirmé, inclusions renvoyées au devis détaillé", () => {
  const all = catalog.SERVICES.flatMap((s) => [s.intro, ...s.covers, ...s.checks, ...s.extras, ...s.faq.flatMap((f) => [f.question, f.answer])]).join(" ");
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
    assert.equal(meta.title, `${s.title} — Dépannage électrique`);
    // PUB-02: no static amount in the metadata (the active version is read at runtime).
    assert.match(meta.description, /Estimation indicative affichée sur la page, confirmée par un devis\./);
    assert.doesNotMatch(meta.description, /\d+[\s\u202f\u00a0]?€/);
  }
  same(await page.generateMetadata({ params: Promise.resolve({ slug: "inconnu" }) }), {});
  for (const slug of ["inconnu", "", "PANNE-TABLEAU-ELECTRIQUE", "../admin"]) await assert.rejects(() => page.default({ params: Promise.resolve({ slug }) }), new RegExp(NOT_FOUND), slug);
});

test("page : composition de référence (héros 2 colonnes, panneau 3 pictos, « Demander cette intervention », 3 FAQ, bandes, liens associés)", async () => {
  for (const s of catalog.SERVICES) {
    const html = render(await page.default({ params: Promise.resolve({ slug: s.slug }) }));
    const t = text(html);
    assert.match(html, /class="ui-v2 /, s.slug); // même chrome thémé que l’accueil
    assert.match(html, /<a class="backLink" href="\/prestations"><span aria-hidden="true">←<\/span> Catalogue<\/a>/, s.slug);
    // Héros : photo + titre + fourchette + « Demander cette intervention », dans une seule grille.
    const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf("</section>", html.indexOf('<section class="hero"')));
    assert.match(hero, new RegExp(`<img src="${s.photo.src}" alt="${s.alt.replace(/[()]/g, "\\$&")}"`), s.slug);
    assert.match(hero, new RegExp(`<h1 id="service-title" class="heroTitle">${s.title}</h1>`), s.slug);
    const price = hero.slice(hero.indexOf("data-service-price"), hero.indexOf("pictoPanel"));
    // PUB-02: the range comes from GET /api/public/indicative-prices at runtime; the server HTML only
    // carries the honest fallback (never a static number).
    assert.ok(text(price).includes("lecture en cours"), s.slug);
    assert.doesNotMatch(text(price), /\d+\s?€/, s.slug);
    assert.match(text(price), /Estimation indicative/);
    assert.doesNotMatch(t, /TTC/);
    assert.match(hero, /data-booking-open="">Demander cette intervention<\/button>/, s.slug);
    // Panneau teinté : exactement 3 pictogrammes sous « Précisés dans le devis ».
    const pictos = hero.slice(hero.indexOf("data-service-pictos"), hero.indexOf("</ul>", hero.indexOf("data-service-pictos")));
    same([...pictos.matchAll(/<\/svg><\/span>([^<]+)<\/li>/g)].map((m) => m[1].trim()), ["Déplacement", "Main-d’œuvre", "Matériel"], s.slug);
    assert.match(hero, />Précisés dans le devis</);
    // 3 FAQ fines sous le CTA (details/summary natifs).
    const faq = hero.slice(hero.indexOf("data-service-faq"));
    assert.equal([...faq.matchAll(/<details class="faqRow"><summary>/g)].length, 3, s.slug);
    // Bandes gauche/droite.
    for (const h of ["Ce qu’il faut savoir", "Ce qui est inclus", "Ce qui n’est pas inclus", "Déroulement"]) assert.match(html, new RegExp(`<h2 id="[^"]+">${h}</h2>`), `${s.slug} ${h}`);
    assert.match(t, /Selon le diagnostic, ces éléments peuvent faire l’objet d’un chiffrage distinct, précisé dans le devis détaillé/);
    // Prestations associées : liens réels avec fourchette, jamais la page courante.
    const related = [...html.matchAll(/<a class="relatedCard" href="([^"]*)" data-related="([^"]*)">([\s\S]*?)<\/a>/g)];
    assert.equal(related.length, 3, s.slug);
    for (const [, href, slug, body] of related) {
      assert.notEqual(slug, s.slug);
      assert.equal(href, `/prestations/${slug}`);
      const other = catalog.SERVICES.find((x) => x.slug === slug)!;
      assert.ok(text(body).includes("Estimation indicative : lecture en cours"), slug);
    }
    // Ouverture de l’assistant : héros + barre, les deux « Demander cette intervention » ; jamais le formulaire générique.
    const opens = [...html.matchAll(/<button [^>]*data-booking-open=""[^>]*>([^<]*)/g)].map((m) => m[1].trim());
    same(opens, ["Demander cette intervention", "Demander cette intervention"], s.slug);
    assert.doesNotMatch(html, /href="\/#new/, s.slug);
    assert.deepEqual(forbiddenClaims(t), [], s.slug);
    assert.doesNotMatch(t, /forcément|toujours inclus|rebranchez|tentez un réarmement/i, s.slug);
  }
});

test("héros : ordre mobile titre → photo → prix → pictos → demande → FAQ ; photo à gauche sur bureau", () => {
  const css = readFileSync(path.join(ROOT, "components/role/public-service.module.css"), "utf8");
  const areas = (block: string) => [...block.matchAll(/"([a-z ]+)"/g)].map((m) => m[1].trim());
  const desktop = css.match(/\.hero \{[^}]*grid-template-areas:([^;]+);/)![1];
  same(areas(desktop), ["media heading", "media price", "media panel", "media cta", "media faq"]);
  assert.match(css, /\.hero \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*column-gap: 56px;/);
  const chromeCss = readFileSync(path.join(ROOT, "components/role/public-chrome.module.css"), "utf8");
  assert.match(chromeCss, /--public-width: 1160px;/);
  assert.match(chromeCss, /--public-gutter: clamp\(15px, 4vw, 28px\);/);
  for (const cls of ["wrap", "bandInner"]) {
    const rule = css.match(new RegExp("\\." + cls + " \\{([^}]*)\\}"))![1];
    assert.match(rule, /max-width: var\(--public-width\);/);
    assert.match(rule, /padding-inline: var\(--public-gutter\);/);
  }
  const mobile = css.slice(css.indexOf("@media (max-width: 860px)")).match(/\.hero \{[^}]*grid-template-areas:([^;]+);/)![1];
  same(areas(mobile), ["heading", "media", "price", "panel", "cta", "faq"]);
  for (const [cls, area] of [["heroMedia", "media"], ["heroHeading", "heading"], ["price", "price"], ["pictoPanel", "panel"], ["ctaRow", "cta"], ["topFaq", "faq"]])
    assert.match(css, new RegExp(`\\.${cls} \\{[^}]*grid-area: ${area};`), cls);
});

test("chrome de la page : chaque action mène à la vraie vue de l’application (hash)", () => {
  const seen: string[] = [];
  const h = servicePage.serviceChromeHandlers((href: string) => seen.push(href));
  h.onNew(); h.onNew("panel"); h.onAddress?.(); h.onLogin(); h.onNavigate("help"); h.onNavigate("pricing"); h.onDemo(); h.onDemo("manager");
  same(seen, ["/#new", "/#new/panel", "/#new/address", "/#auth", "/#help", "/#pricing", "/#demo/client", "/#demo/manager"]);
});

test("catalogue : les huit cartes mènent à leur prestation avec sa fourchette indicative", () => {
  const html = render(catalogue.default());
  assert.match(html, /Quel problème rencontrez-vous \?/);
  const cards = [...html.matchAll(/<a class="ivc" href="([^"]*)" data-service-card="([^"]*)">([\s\S]*?)<\/a>/g)];
  assert.equal(cards.length, 8);
  for (const [i, s] of catalog.SERVICES.entries()) {
    const [, href, slug, body] = cards[i];
    assert.equal(href, `/prestations/${s.slug}`);
    assert.equal(slug, s.slug);
    assert.ok(text(body).includes("Estimation indicative : lecture en cours"), s.slug);
    assert.match(body, new RegExp(`data-indicative-range="${s.category}"`), s.slug);
    assert.match(body, new RegExp(`src="${s.photo.src}"`), s.slug);
  }
  for (const service of catalog.SERVICES.filter((s) => s.category === "socket")) assert.notEqual(service.photo.src, "/home/section-socket.jpg", service.slug);
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
  return captured.form as { initialCategory: string; initialValues: unknown; addressFirst: boolean };
}

test("#new/<catégorie> : catégorie connue pré-sélectionnée, inconnue ignorée, brouillon prioritaire", () => {
  for (const c of DOMAIN) assert.equal(spyNew({ param: c.id }).initialCategory, c.id);
  assert.equal(spyNew({ param: "address" }).addressFirst, true);
  assert.equal(spyNew({ param: "socket" }).addressFirst, false);
  for (const param of ["", "zzz", "Panel", "panel/extra", "__proto__"]) assert.equal(spyNew({ param }).initialCategory, "outage", param);
  const draft = { category: "panel", description: "Brouillon conservé" };
  const withDraft = spyNew({ param: "lighting", pendingDraft: draft });
  assert.equal(withDraft.initialCategory, "outage");
  assert.deepEqual(withDraft.initialValues, draft);
});
