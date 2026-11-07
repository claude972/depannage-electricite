// Tracking leaf accessibility (phase 8 leftovers), real app in demo mode (Chromium, real CSS).
// Client dossier demo-004 shows the artisan tracking card with its map; the artisan detail must
// stay clean (no map there, no regression). Light and dark, 360 / 390 / 1280, zero /api, no errors.
// Each test failed before its fix commit.
import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip } from "./real-app-harness";

type Open = Parameters<Parameters<typeof withApp>[0]>[0];

async function themed(open: Open, route: string, width: number, theme: "light" | "dark") {
  const { page, errors, api } = await open(route, width);
  await page.evaluate((t: string) => localStorage.setItem("courant-ui-theme", t), theme);
  const origin = new URL(page.url()).origin;
  await page.goto("about:blank");
  await page.goto(`${origin}/#demo/${route}`);
  await page.waitForTimeout(1200);
  return { page, errors, api };
}

const WIDTHS = [360, 390, 1280];
const THEMES = ["light", "dark"] as const;

const ATTRIBUTION = `(() => {
  const a = document.querySelector('figcaption a[href="https://www.openstreetmap.org/copyright"]');
  if (!a) return null;
  const b = a.getBoundingClientRect();
  const cs = getComputedStyle(a);
  return { text: a.textContent.trim(), w: b.width, h: b.height, fontSize: parseFloat(cs.fontSize),
    visible: cs.visibility === "visible" && cs.display !== "none" && parseFloat(cs.opacity) > 0.9,
    clipped: a.scrollWidth > Math.ceil(b.width) + 1, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`;

test("F1 attribution « © OpenStreetMap contributors » : cible ≥ 44 px, texte visible et non réduit", { skip }, async () => {
  await withApp(async (open) => {
    for (const theme of THEMES)
      for (const width of WIDTHS) {
        const { page, errors, api } = await themed(open, "client-detail.demo-004", width, theme);
        const where = `${theme} ${width}px`;
        const a = await page.evaluate(ATTRIBUTION);
        assert.ok(a, `${where}: attribution link rendered`);
        assert.equal(a.text, "© OpenStreetMap contributors", where);
        assert.ok(a.h >= 44 && a.w >= 44, `${where}: attribution hit area ${a.w}×${a.h}`);
        assert.ok(a.fontSize >= 12, `${where}: attribution text not shrunk (${a.fontSize}px)`);
        assert.ok(a.visible && !a.clipped, `${where}: attribution visible and not clipped`);
        assert.ok(a.overflowX <= 0, `${where}: no horizontal overflow`);
        assert.deepEqual(errors, [], where);
        assert.deepEqual(api, [], where);
        await page.context().close();
      }
  });
});

// Walks the whole Tab sequence and keeps the stops inside the tracking card.
const STOP = `(() => {
  const e = document.activeElement;
  const card = e && e.closest('section') && document.querySelector('figure') && document.querySelector('figure').closest('section');
  if (!e || !card || !card.contains(e)) return null;
  const b = e.getBoundingClientRect();
  return { label: e.getAttribute("aria-label") || e.textContent.trim().slice(0, 40), top: Math.round(b.top + scrollY), left: Math.round(b.left), inMap: Boolean(e.closest("figure")) };
})()`;

test("F2 ordre de tabulation du suivi : l’ordre DOM suit l’ordre visuel (carte puis état et destination)", { skip }, async () => {
  await withApp(async (open) => {
    for (const theme of THEMES)
      for (const width of WIDTHS) {
        const { page, errors, api } = await themed(open, "client-detail.demo-004", width, theme);
        const where = `${theme} ${width}px`;
        await page.evaluate("document.activeElement && document.activeElement.blur()");
        const stops: { label: string; top: number; left: number; inMap: boolean }[] = [];
        for (let i = 0; i < 80; i++) {
          await page.keyboard.press("Tab");
          const s = await page.evaluate(STOP);
          if (s && !stops.some((x) => x.label === s.label && x.top === s.top)) stops.push(s);
          if (!s && stops.length) break;
        }
        const labels = stops.map((s) => s.label);
        const remove = labels.indexOf("Retirer la destination");
        const zoom = labels.indexOf("Zoomer");
        const credit = labels.indexOf("© OpenStreetMap contributors");
        assert.ok(remove >= 0 && zoom >= 0 && credit >= 0, `${where}: ${labels.join(" | ")}`);
        // The map (controls then attribution) is one block, reached before the details and the form.
        assert.deepEqual(labels.slice(zoom, credit + 1), ["Zoomer", "Dézoomer", "Recentrer la carte", "© OpenStreetMap contributors"], where);
        assert.ok(credit < remove, `${where}: focus must not jump back to the map after « Retirer la destination »: ${labels.join(" | ")}`);
        assert.equal(stops.findIndex((s) => s.inMap), zoom, `${where}: map stops are contiguous`);
        const map = stops.filter((s) => s.inMap);
        const rest = stops.filter((s) => !s.inMap);
        if (width < 1024) {
          // Single column: the map is drawn above the details, so the whole sequence goes down.
          for (let i = 1; i < stops.length; i++)
            if (stops[i].inMap === stops[i - 1].inMap)
              assert.ok(stops[i].top >= stops[i - 1].top - 2, `${where}: ${stops[i - 1].label} → ${stops[i].label} goes up`);
          assert.ok(Math.max(...map.map((s) => s.top)) < Math.min(...rest.map((s) => s.top)), `${where}: map above the details`);
        } else {
          // Two columns, unchanged: details on the left, map on the right (≈ 60 %).
          assert.ok(Math.min(...map.map((s) => s.left)) > Math.max(...rest.map((s) => s.left)), `${where}: map still on the right`);
        }
        assert.deepEqual(errors, [], where);
        assert.deepEqual(api, [], where);
        await page.context().close();
      }
  });
});

test("détail artisan demo-004 : aucune régression (pas d’erreur, aucun appel /api, pas de débordement)", { skip }, async () => {
  await withApp(async (open) => {
    for (const theme of THEMES)
      for (const width of WIDTHS) {
        const { page, errors, api } = await themed(open, "artisan-detail.demo-004", width, theme);
        const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
        assert.ok(overflow <= 0, `${theme} ${width}px: ${overflow}px overflow`);
        assert.deepEqual(errors, []);
        assert.deepEqual(api, []);
        await page.context().close();
      }
  });
});
