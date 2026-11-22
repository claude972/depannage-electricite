// The /api/profile/data route (ROOT e541656) serves every authenticated user under its own session
// (no role check; personal rows only, organisation dossiers excluded), so « Mes données » is also
// mounted in the artisan and manager profiles. Real app, demo: honest note, zero /api, no page
// errors, no overflow — 360/390/1280, light and dark.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withApp, skip } from "./real-app-harness";

test("le contrat ne filtre pas par rôle (lecture et demande sous la session courante)", () => {
  const model = readFileSync("components/features/account-data/model.ts", "utf8");
  assert.match(model, /STRICT COPY of\s+\/\/ app\/api\/profile\/data\/route\.ts from ROOT e541656/);
  for (const f of ["components/role/artisan-space.tsx", "components/role/enterprise-space.tsx", "components/role/client-space.tsx"])
    assert.match(readFileSync(f, "utf8"), /<AccountDataPanel\s+key=\{`\$\{session\.mode\}:\$\{session\.mutationContext\.userId\(\) \?\? "anon"\}:\$\{session\.mutationContext\.generation\(\)\}`\}/, f);
});

test("app réelle : profils artisan et gestionnaire montent « Mes données » (démo honnête, aucun /api)", { skip }, async () => {
  await withApp(async (open) => {
    for (const route of ["artisan-profile", "manager-profile"])
      for (const theme of ["light", "dark"])
        for (const width of [360, 390, 1280]) {
          const { page, errors, api } = await open(route, width);
          await page.evaluate((t: string) => localStorage.setItem("courant-ui-theme", t), theme);
          const origin = new URL(page.url()).origin;
          await page.goto("about:blank");
          await page.goto(`${origin}/#demo/${route}`);
          await page.waitForTimeout(1200);
          const where = `${route} ${theme} ${width}px`;
          const panel = page.locator('[data-account-data="demo"]');
          assert.equal(await panel.count(), 1, where);
          assert.match(await panel.innerText(), /aucune demande d’effacement n’est envoyée/, where);
          const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
          assert.ok(overflow <= 0, `${where}: ${overflow}px overflow`);
          assert.deepEqual(api, [], where);
          assert.deepEqual(errors, [], where);
          await page.context().close();
        }
  });
});
