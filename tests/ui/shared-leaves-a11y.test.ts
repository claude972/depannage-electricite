// Shared-leaf findings from the phase 8 passes, reproduced in the real app (demo, Chromium, real CSS)
// and on the real shared components. Each test failed before its fix commit.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "../documents/harness";
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
const headings = (page: { evaluate: (f: () => unknown) => Promise<unknown> }) =>
  page.evaluate(() => Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter((h) => (h as HTMLElement).offsetParent !== null || h.classList.contains("sr-only")).map((h) => Number(h.tagName[1]))) as Promise<number[]>;
const jumps = (hs: number[]) => hs.flatMap((h, i) => (i > 0 && h > hs[i - 1] + 1 ? [`h${hs[i - 1]}→h${h}`] : []));

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

test("2 · titres : un seul h1 (celui de la coque) puis sans saut, sur l’assistance et les notifications", { skip }, async () => {
  await withApp(async (open) => {
    for (const route of ["client-support", "artisan-support", "manager-support", "admin-support-queue", "client-notifications", "artisan-notifications", "manager-notifications", "admin-notifications"])
      for (const width of [390, 1280]) {
        const { page, errors, api } = await themed(open, route, width, "light");
        const hs = await headings(page);
        assert.equal(hs.filter((h) => h === 1).length, 1, `${route} ${width}px: one h1 (${hs.join(",")})`);
        assert.deepEqual(jumps(hs), [], `${route} ${width}px: heading order ${hs.join(",")}`);
        assert.deepEqual([errors, api], [[], []]);
        await page.context().close();
      }
  });
});

test("3 · état vide partagé : niveau de titre choisi par l’appelant (h1 quand c’est le contenu principal), h3 par défaut inchangé", () => {
  const ui = loadModule("components/app/ui.tsx") as { Empty: (p: Record<string, unknown>) => unknown; PageTitle: (p: Record<string, unknown>) => unknown };
  const html = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(ui.Empty as never, { icon: "search", title: "Dossier introuvable", ...p } as never));
  assert.match(html({}), /<h3>Dossier introuvable<\/h3>/);
  assert.match(html({ level: 1 }), /<h1>Dossier introuvable<\/h1>/);
  assert.match(html({ level: 2 }), /<h2>Dossier introuvable<\/h2>/);
  const title = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(ui.PageTitle as never, { title: "Assistance", ...p } as never));
  assert.match(title({}), /<h1>Assistance<\/h1>/);
  assert.match(title({ level: 2 }), /<h2>Assistance<\/h2>/);
});
