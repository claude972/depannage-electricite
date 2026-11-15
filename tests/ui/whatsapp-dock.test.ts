// WhatsApp stays available in the client space and on public pages, docked to the right of the
// floating menu below 1024 px: while scrolling, it never covers a page control nor the menu.
import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip } from "./real-app-harness";

const MEASURE = `(() => {
  const fab = document.querySelector("[data-whatsapp-dock]");
  if (!fab) return { missing: true };
  const f = fab.getBoundingClientRect();
  const nav = [...document.querySelectorAll("nav")].find((n) => getComputedStyle(n).position === "fixed" && n.getBoundingClientRect().bottom > innerHeight - 120);
  const n = nav ? nav.getBoundingClientRect() : null;
  // Controls hidden under the bottom band (menu + WhatsApp row): content scrolls beneath it,
  // so only the end of the page must leave every control above the band.
  const bandTop = n ? Math.min(n.top, f.top) : f.top;
  const atEnd = Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1;
  const covered = atEnd ? [...document.querySelectorAll("main a, main button, main input, main select, main textarea")]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > bandTop + 0.5 && r.top < innerHeight; })
    .map((el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40)) : [];
  return { f: { l: f.left, r: f.right, t: f.top, b: f.bottom }, n: n && { l: n.left, r: n.right, t: n.top, b: n.bottom }, vw: innerWidth, vh: innerHeight, covered, sw: document.documentElement.scrollWidth };
})()`;

async function sweep(page: any, where: string) {
  const height = await page.evaluate("document.documentElement.scrollHeight");
  for (let y = 0; y <= height + 180; y += 180) {
    await page.evaluate((v: number) => window.scrollTo(0, v), y);
    await page.waitForTimeout(40);
    const m = await page.evaluate(MEASURE);
    assert.ok(!m.missing, `${where}: WhatsApp present`);
    assert.deepEqual(m.covered, [], `${where} @${y}px (end of page): hidden under the bottom band: ${m.covered.join(", ")}`);
    assert.ok(m.f.t >= m.n.t - 0.5 && m.f.b <= m.n.b + 0.5, `${where}: WhatsApp stays inside the menu band (never above it)`);
    assert.ok(m.f.r <= m.vw && m.f.l >= 0 && m.f.b <= m.vh, `${where}: WhatsApp inside the viewport`);
    assert.ok(m.n, `${where}: floating menu present`);
    assert.ok(m.f.l >= m.n.r - 0.5, `${where}: WhatsApp beside (not over) the menu`);
    assert.ok(Math.abs((m.f.t + m.f.b) / 2 - (m.n.t + m.n.b) / 2) < 2, `${where}: same row as the menu`);
    assert.equal(m.sw, m.vw, `${where}: no horizontal overflow`);
  }
}

test("WhatsApp docked beside the floating menu (client detail + public page), 320/390/768 px", { skip }, async () => {
  await withApp(async (open) => {
    for (const width of [320, 390, 768]) {
      const { page, errors } = await open("client", width);
      await page.evaluate(() => { location.hash = "#detail/demo-001"; });
      await page.waitForTimeout(700);
      await sweep(page, `client detail ${width}`);
      await page.evaluate(() => { location.hash = "#quote/quote-demo-1"; });
      await page.waitForTimeout(700);
      await sweep(page, `client quote ${width}`);
      assert.deepEqual(errors, []);
    }
    for (const width of [320, 390]) {
      const { page } = await open("client", width);
      await page.getByRole("button", { name: "Ouvrir le menu" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Quitter la démonstration" }).click();
      await page.evaluate(() => { location.hash = "#help"; });
      await page.waitForTimeout(800);
      await sweep(page, `public help ${width}`);
    }
  });
});
