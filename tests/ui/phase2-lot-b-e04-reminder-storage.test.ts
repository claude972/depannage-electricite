// E04 (registre phase 2) — ENT-16 / SYS-04 : programmer ou annuler un rappel de règlement avec un
// sessionStorage opérationnel. Le relu et l’écrit étaient comparés par chaînes JSON (ordre des clés
// différent après le parseur) ⇒ « stockage indisponible », zéro POST. Attendu (P7) : égalité
// profonde ⇒ un POST pour programmer, un POST pour annuler.
// Vrai PaymentReminderControl monté (Chromium, vrai window.sessionStorage), fetch simulé.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PaymentReminderControl } from "./components/features/payment-reminders/payment-reminder-control";
${PRELUDE}
const Q = "e1000000-0000-4000-8000-000000000001";
let reminder = null;
window.posts = [];
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const fetcher = async (url, init) => {
  if (init && init.method === "POST") {
    const c = JSON.parse(init.body);
    window.posts.push(c);
    reminder = c.action === "schedule" ? { id: "f1000000-0000-4000-8000-000000000001", quote_id: Q, version: (reminder?.version ?? 0) + 1, remind_at: c.remind_at, status: "scheduled", notification_id: null, processed_at: null } : { ...reminder, version: reminder.version + 1, status: "cancelled", processed_at: new Date().toISOString() };
    return json({ reminder, replayed: false });
  }
  return json({ quote_id: Q, can_schedule: true, reminder });
};
const context = { generation: () => 1, userId: () => "c0000000-0000-4000-8000-000000000001" };
window.scenarios = {
  async e04() {
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(PaymentReminderControl, { quoteId: Q, context, fetcher })));
    await until(() => div.querySelector("[data-payment-reminder-open]"));
    div.querySelector("[data-payment-reminder-open]").click();
    await until(() => div.querySelector("input[type=datetime-local]"));
    const d = new Date(Date.now() + 2 * 86400000); const p = (n) => String(n).padStart(2, "0");
    setInput(div.querySelector("input[type=datetime-local]"), d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T10:00");
    await tick(30);
    div.querySelector("[data-payment-reminder-schedule]").click();
    await tick(400);
    const afterSchedule = { posts: window.posts.length, text: txt(div) };
    const c = div.querySelector("[data-payment-reminder-cancel]");
    if (c) { c.click(); await tick(50); const confirm = [...div.querySelectorAll("button")].find((b) => /Confirmer|Annuler le rappel/.test(b.textContent || "") && b !== c); confirm?.click(); await tick(400); }
    return { afterSchedule, posts: window.posts.map((x) => x.action), text: txt(div) };
  },
};
`;

test("E04 · stockage opérationnel ⇒ programmer puis annuler émettent chacun un POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e04");
    assert.equal(r.afterSchedule.posts, 1, `programmation envoyée (texte : ${r.afterSchedule.text.slice(0, 200)})`);
    assert.doesNotMatch(r.afterSchedule.text, /stockage de cet onglet est indisponible/);
    assert.deepEqual(r.posts, ["schedule", "cancel"]);
    assert.deepEqual(errors, []);
  });
});
