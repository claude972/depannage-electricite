// Enterprise « new » view (service page CTA): #new/<category> pre-selects the category only;
// #new/<site UUID> keeps pre-selecting the site. No authority, site or right is derived from it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATEGORIES } from "../../components/app/format";

const src = readFileSync("components/role/enterprise-space.tsx", "utf8");

test("enterprise #new/<category>: category only, never a site", () => {
  assert.match(src, /isRequestCategory\(param\) \? \(\s*<NewRequestView key=\{param\} c=\{c\} siteId="" initialCategory=\{param\} \/>/);
  assert.match(src, /<NewRequestView key=\{param\} c=\{c\} siteId=\{param\} \/>/, "site UUID path unchanged");
  assert.match(src, /initialCategory=\{initialCategory\}/, "RequestForm gets the validated category");
  assert.doesNotMatch(src, /initialCategory="panel"\s*\n?\s*sites=/, "no hard-coded panel left in NewRequestView");
});

test("category ids can never be mistaken for a site UUID (and vice versa)", () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const c of CATEGORIES) assert.doesNotMatch(c.id, uuid, c.id);
  assert.ok(!CATEGORIES.some((c) => c.id === "123e4567-e89b-42d3-a456-426614174000"));
  assert.deepEqual(CATEGORIES.map((c) => c.id).sort(), ["diagnostic", "lighting", "outage", "panel", "socket"].sort());
});
