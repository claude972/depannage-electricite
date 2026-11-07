// Shared-leaf findings from the phase 8 passes, reproduced in the real app (demo, Chromium, real CSS)
// and on the real shared components. Each test failed before its fix commit.
import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip } from "./real-app-harness";

type Open = Parameters<Parameters<typeof withApp>[0]>[0];
async function themed(open: Open, route: string, width: number, theme: "light" | "dark") {
  const { page, errors, api } = await open(route, width);
  await page.evaluate((t: string) => localStorage.setItem("courant-ui-theme", t), theme);
  const origin = new URL(page.url()).origin;
  await page.goto("about:blank");
  api.length = 0;
  await page.goto(`${origin}/#demo/${route}`);
  await page.waitForTimeout(1200);
  return { page, errors, api };
}

test("1 · préférences de notification : cases jamais écrasées ni débordement, dans chaque espace (360/390, clair/sombre)", { skip }, async () => {
  await withApp(async (open) => {
    for (const route of ["artisan-notifications", "manager-notifications", "admin-notifications"])
      for (const theme of ["light", "dark"] as const)
        for (const width of [360, 390]) {
          const { page, errors, api } = await themed(open, route, width, theme);
          await page.evaluate(() => (Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Préférences") as HTMLButtonElement).click());
          await page.waitForTimeout(300);
          const r = await page.evaluate(() => ({
            boxes: Array.from(document.querySelectorAll("form fieldset input[type=checkbox]")).map((i) => Math.round(i.getBoundingClientRect().width)),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          }));
          assert.ok(r.boxes.length >= 3, `${route}: preferences rendered`);
          for (const w of r.boxes) assert.ok(w >= 20, `${route} ${theme} ${width}px: checkbox squeezed to ${w}px`);
          assert.ok(r.overflow <= 0, `${route} ${theme} ${width}px: ${r.overflow}px horizontal overflow`);
          assert.deepEqual([errors, api], [[], []]);
          await page.context().close();
        }
  });
});
