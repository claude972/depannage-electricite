import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// ENT-03: the « Site » filter of the interventions search is a read filter over past dossiers. An
// archived site stays selectable there (its dossiers must remain findable) but is named as archived,
// like in the scope selector.
test("the interventions « Site » filter marks an archived site instead of listing it as active", () => {
  const src = readFileSync(new URL("../../components/role/enterprise-space.tsx", import.meta.url), "utf8");
  const start = src.indexOf("function InterventionFiltersCard(");
  assert.ok(start > 0);
  const card = src.slice(start, src.indexOf("\nfunction ", start + 10));
  const options = card.slice(card.indexOf("c.scope.sites.map("), card.indexOf("</select>"));
  assert.match(options, /\{s\.name\}\s*\{s\.archived_at \? " \(archivé\)" : ""\}/);
  assert.doesNotMatch(card, /c\.scope\.sites\.filter\(/, "an archived site is not removed from a read filter");
});
