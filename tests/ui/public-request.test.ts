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
