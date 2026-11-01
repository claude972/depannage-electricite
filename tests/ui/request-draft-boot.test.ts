// Boot read of the public request draft (OFFLINE-DRAFT-001): canonical helper, strict category,
// 30 min TTL, malformed entries ignored but never deleted, storage refusal never crashes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readBootDraft } from "../../components/app/request-draft-boot";
import { PUBLIC_DRAFT_KEY, savePublicDraft } from "../../lib/shared/request-draft";

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}
const NOW = 1_800_000_000_000;
const values = { category: "panel", description: "Le disjoncteur saute souvent.", address: "2 rue Test", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled" };

test("boot: a draft saved by the offline page (or the online form) is restored", () => {
  const s = memory();
  assert.equal(savePublicDraft(s, values, NOW - 60_000).ok, true);
  assert.deepEqual(readBootDraft(s, NOW), values);
});

test("boot: partial draft allowed (empty strings), site_id kept only when present", () => {
  const s = memory({ [PUBLIC_DRAFT_KEY]: JSON.stringify({ savedAt: NOW, values: { category: "outage" } }) });
  assert.deepEqual(readBootDraft(s, NOW), { category: "outage", description: "", address: "", postal_code: "", city: "", urgency: "scheduled" });
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const t = memory({ [PUBLIC_DRAFT_KEY]: JSON.stringify({ savedAt: NOW, values: { ...values, site_id: id } }) });
  assert.equal(readBootDraft(t, NOW)?.site_id, id);
});

test("boot: expired, future, unknown category, extra key, garbage ⇒ null and the entry is NOT deleted", () => {
  const cases = [
    JSON.stringify({ savedAt: NOW - 30 * 60_000, values }),
    JSON.stringify({ savedAt: NOW + 60_000, values }),
    JSON.stringify({ savedAt: NOW, values: { ...values, category: "plumbing" } }),
    JSON.stringify({ savedAt: NOW, values, extra: 1 }),
    JSON.stringify({ savedAt: NOW, values: { ...values, photos: [] } }),
    "{not json",
    "null",
  ];
  for (const raw of cases) {
    const s = memory({ [PUBLIC_DRAFT_KEY]: raw });
    assert.equal(readBootDraft(s, NOW), null, raw);
    assert.equal(s.map.get(PUBLIC_DRAFT_KEY), raw, "never auto-deleted before validation");
  }
});

test("boot: no storage or storage throwing ⇒ null, no crash", () => {
  assert.equal(readBootDraft(null, NOW), null);
  assert.equal(readBootDraft({ getItem() { throw new Error("SecurityError"); } }, NOW), null);
});

test("courant-app boots and saves through the canonical helper only (no ad-hoc JSON parse)", () => {
  const src = readFileSync("components/courant-app.tsx", "utf8");
  assert.match(src, /readBootDraft\(/);
  assert.match(src, /savePublicDraft\(/);
  assert.doesNotMatch(src, /JSON\.parse\(sessionStorage\.getItem\(DRAFT_KEY\)/);
  assert.doesNotMatch(src, /sessionStorage\.setItem\(DRAFT_KEY/);
});
