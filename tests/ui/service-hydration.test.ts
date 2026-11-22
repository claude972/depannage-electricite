// Service page before hydration (ROOT lab repro on 820: a click on the server-rendered « Demander cette intervention »
// before JS was lost). The server HTML must render BOTH « Demander cette intervention » buttons disabled + aria-busy
// with a visible « Préparation du formulaire… » status; openBooking refuses until ready.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import * as draftModule from "../../components/app/booking-draft";
import { loadModule } from "../documents/harness";

const tp = loadModule("components/app/theme-provider.tsx");
const overrides = { "@/components/app/theme-provider": tp, "../app/booking-draft": draftModule };
const page = loadModule("components/role/public-service-page.tsx", overrides) as Record<string, any>;
const catalog = loadModule("components/role/public-service-catalog.ts") as Record<string, any>;
const service = catalog.SERVICES[0];

test("SSR (= before hydration): both « Demander cette intervention » are disabled, aria-busy, label kept, status shown", () => {
  const html = renderToString(createElement(tp.ThemeProvider as never, null, createElement(page.PublicServicePage, { service }))).replaceAll("<!-- -->", "");
  const buttons = [...html.matchAll(/<button[^>]*data-booking-open=""[^>]*>([^<]*)<\/button>/g)];
  assert.equal(buttons.length, 2, "main CTA + fixed bar");
  for (const [tag, label] of buttons) {
    assert.equal(label.trim(), "Demander cette intervention");
    assert.match(tag, /disabled=""/);
    assert.match(tag, /aria-busy="true"/);
  }
  assert.match(html, /role="status"[^>]*>Préparation du formulaire…/);
});

test("source: ready only after mount (effect), openBooking guarded, no arbitrary delay", () => {
  const src = readFileSync("components/role/public-service-page.tsx", "utf8");
  assert.match(src, /const \[ready, setReady\] = useState\(false\);/);
  assert.match(src, /useEffect\(\(\) => \{ setReady\(true\);/);
  assert.match(src, /const openBooking = \(\) => \{\s*if \(!ready\) return;/);
  assert.equal((src.match(/onClick=\{openBooking\} \{\.\.\.confirmProps\}/g) || []).length, 2);
  assert.doesNotMatch(src, /setTimeout|requestIdleCallback/);
});
