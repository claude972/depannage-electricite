import test from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_LABEL, realName, resolveDisplayName } from "../../components/app/display-name";
import { DEMO_NAMES } from "../../components/app/demo";

test("live: first name from the real profile only; placeholders and blanks never become a name", () => {
  assert.deepEqual(resolveDisplayName("live", "client", { role: "client", full_name: "  Léa   Marie Durand " }, DEMO_NAMES), { displayName: "Léa Marie Durand", firstName: "Léa" });
  for (const full_name of [null, "", "   ", "Mon compte", "mon compte", "Bienvenue"]) {
    assert.deepEqual(resolveDisplayName("live", "client", { role: "client", full_name }, DEMO_NAMES), { displayName: ACCOUNT_LABEL, firstName: null }, String(full_name));
  }
  assert.deepEqual(resolveDisplayName("live", "artisan", null, DEMO_NAMES), { displayName: ACCOUNT_LABEL, firstName: null });
});

test("live never shows a demo name; demo uses its own profile or cast", () => {
  const live = resolveDisplayName("live", "client", { role: "client", full_name: "" }, DEMO_NAMES);
  assert.ok(!Object.values(DEMO_NAMES).some((n) => live.displayName.includes(n)));
  assert.equal(resolveDisplayName("demo", "client", null, DEMO_NAMES).firstName, DEMO_NAMES.client.split(" ")[0]);
  assert.equal(resolveDisplayName("demo", "artisan", { role: "client", full_name: "Autre" }, DEMO_NAMES).displayName, DEMO_NAMES.artisan);
  assert.equal(realName("Mon compte"), null);
});
