import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/public/services/route";
import { SERVICES, serviceBySlug } from "../components/role/public-service-catalog";
import { CATEGORIES } from "../lib/domain";

test("the mobile catalogue serves the same eight service fiches as the web", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /^public,/);
  assert.equal(response.headers.has("set-cookie"), false);
  const { items } = await response.json() as { items: typeof SERVICES };
  assert.equal(items.length, 8);
  assert.equal(new Set(items.map(item => item.slug)).size, items.length);
  for (const item of items) {
    assert.deepEqual(item, serviceBySlug(item.slug));
    assert.ok(CATEGORIES.some(category => category.id === item.category));
    assert.match(item.photo.src, /^\/home\/[^/]+\.jpg$/);
    assert.ok(item.photo.width > 0 && item.photo.height > 0);
    assert.equal("price" in item || "estimate" in item, false);
  }
});
