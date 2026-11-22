// Phase 8 quality pass (client + artisan spaces), real app in demo mode (Chromium, real CSS).
// One reproducible finding per test; each failed before its fix commit.
import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip } from "./real-app-harness";

async function themed(open: Parameters<Parameters<typeof withApp>[0]>[0], route: string, width: number, theme: "light" | "dark") {
  const { page, errors } = await open(route, width);
  await page.evaluate((t: string) => localStorage.setItem("courant-ui-theme", t), theme);
  const origin = new URL(page.url()).origin;
  await page.goto("about:blank");
  await page.goto(`${origin}/#demo/${route}`);
  await page.waitForTimeout(1200);
  return { page, errors };
}

test("F1 client « Mon profil » : aucun débordement horizontal à 360 / 390 px (clair et sombre)", { skip }, async () => {
  await withApp(async (open) => {
    for (const theme of ["light", "dark"] as const)
      for (const width of [360, 390]) {
        const { page, errors } = await themed(open, "client-profile", width, theme);
        const r = await page.evaluate(() => ({ h1: document.querySelector("h1")?.textContent, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
        assert.equal(r.h1, "Mon profil");
        assert.ok(r.overflow <= 0, `${theme} ${width}px: ${r.overflow}px of horizontal overflow`);
        assert.deepEqual(errors, []);
        await page.context().close();
      }
  });
});

test("F2 artisan « Aide » : chaque question de la FAQ est une cible d’au moins 44 px", { skip }, async () => {
  await withApp(async (open) => {
    for (const width of [360, 1280]) {
      const { page } = await themed(open, "artisan-help", width, "light");
      const heights: number[] = await page.evaluate(() => Array.from(document.querySelectorAll("main summary")).map((s) => Math.round(s.getBoundingClientRect().height)));
      assert.ok(heights.length >= 3, "FAQ rendered");
      for (const h of heights) assert.ok(h >= 44, `${width}px: summary ${h}px < 44px`);
      await page.context().close();
    }
  });
});
