// Client space mobile header at 360 / 390 px, light and dark: no horizontal overflow, the brand
// shrinks and wraps instead of pushing the tools off-screen, every header control stays ≥ 44 px
// and fully inside the viewport (nothing hidden with overflow). Real app, demo client, Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withApp, skip } from "./real-app-harness";

const MEASURE = `(() => {
  const tools = document.querySelector('[class*="mobileHeaderTools"]');
  const header = tools.parentElement;
  const box = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width, height: b.height }; };
  const brand = header.firstElementChild;
  const text = brand.querySelector(".brand");
  return {
    sw: document.documentElement.scrollWidth, vw: window.innerWidth,
    overflowHidden: getComputedStyle(header).overflow + "/" + getComputedStyle(brand).overflow,
    brand: box(brand), brandText: text ? box(text) : null, tools: box(tools),
    controls: [...header.querySelectorAll("button")].map((b) => ({ label: b.getAttribute("aria-label") || b.textContent.trim(), ...box(b) })),
  };
})()`;

test("en-tête mobile client : 360 / 390 px, clair et sombre — aucun débordement, cibles ≥ 44 px", { skip }, async () => {
  await withApp(async (open) => {
    for (const width of [360, 390]) for (const theme of ["light", "dark"]) {
      const { page, errors } = await open("client", width);
      await page.evaluate((t: string) => document.documentElement.setAttribute("data-ui-theme", t), theme);
      await page.waitForTimeout(300);
      const m = await page.evaluate(MEASURE);
      const where = `${width}px ${theme}`;
      assert.equal(m.sw, m.vw, `${where}: no horizontal overflow`);
      assert.doesNotMatch(m.overflowHidden, /hidden|clip/, `${where}: nothing hidden with overflow`);
      assert.ok(m.brand.right <= m.tools.left + 0.5, `${where}: brand does not run under the tools`);
      if (m.brandText) assert.ok(m.brandText.right <= m.brand.right + 0.5, `${where}: brand text inside its button`);
      for (const c of m.controls) {
        assert.ok(c.height >= 44 && c.width >= 44, `${where}: ${c.label} is ${c.width}×${c.height}`);
        assert.ok(c.left >= 0 && c.right <= m.vw + 0.5, `${where}: ${c.label} fully visible`);
      }
      assert.deepEqual(errors, []);
    }
  });
});

test("le correctif est une mise en page souple (pas de masquage)", () => {
  const css = readFileSync("components/role/client.module.css", "utf8");
  const block = css.slice(css.indexOf(".mobileHeaderTools {"), css.indexOf(".bellButton {"));
  assert.match(block, /flex: 1 1 auto;[\s\S]*min-width: 0;/);
  assert.doesNotMatch(block, /overflow:\s*hidden|display:\s*none|text-overflow/);
});
