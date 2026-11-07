// Shared AppointmentReminderPanel wired in the client and artisan dossiers (Rendez-vous card),
// keyed by dossier + identity; demo renders the honest note with ZERO /api call (real app, Chromium).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withApp, skip } from "./real-app-harness";

test("câblage source : client et artisan, clé dossier|uid|génération, démo transmise", () => {
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(client, /<AppointmentReminderPanel\s+key=\{`\$\{i\.id\}\|\$\{session\.mutationContext\.userId\(\) \?\? "-"\}\|\$\{session\.mutationContext\.generation\(\)\}`\}\s+interventionId=\{i\.id\}\s+role="client"\s+context=\{session\.mutationContext\}\s+demo=\{session\.mode === "demo"\}\s+\/>/);
  const artisan = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(artisan, /reminder=\{\s*<AppointmentReminderPanel\s+key=\{`\$\{i\.id\}\|\$\{session\.mutationContext\.userId\(\) \?\? "-"\}\|\$\{session\.mutationContext\.generation\(\)\}`\}\s+interventionId=\{i\.id\}\s+role="artisan"\s+context=\{session\.mutationContext\}\s+demo=\{session\.mode === "demo"\}\s+\/>/);
  assert.match(artisan, /<h2 id="dossier-appointment">Rendez-vous<\/h2>[\s\S]{0,900}\{reminder\}/);
});

test("app réelle (démo) : le panneau s’affiche dans les deux espaces, aucun appel /api", { skip }, async () => {
  await withApp(async (open) => {
    for (const route of ["client-detail.demo-001", "artisan-detail.demo-001"]) {
      const { page, errors, api } = await open(route, 390);
      const r = await page.evaluate(() => ({ panel: document.querySelector('[data-appointment-reminder="demo"]')?.textContent ?? null }));
      assert.ok(r.panel && /Rappel de rendez-vous/.test(r.panel), `${route}: reminder panel rendered`);
      assert.deepEqual(api, [], `${route}: no /api call in demo`);
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  });
});
