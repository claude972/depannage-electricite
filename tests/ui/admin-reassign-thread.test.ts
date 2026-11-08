// ADM-03 picker model + ADM-07 wiring (source checks).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { appendPage, artisanLabel, normalizeQuery, pickerInitial } from "../../components/features/admin-reassign/artisan-picker-model";
import type { DirectoryArtisan, DirectoryPage } from "../../components/app/types";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const a = (n: number, over: Partial<DirectoryArtisan> = {}): DirectoryArtisan => ({ id: `a${n}`, full_name: `Artisan ${n}`, phone: "0696", artisan_approved: true, created_at: "2026-01-01T00:00:00Z", company_name: null, application_status: "approved", ...over });
const page = (items: DirectoryArtisan[], next: string | null, total = 150): DirectoryPage<"artisans"> => ({ kind: "artisans", items, page: { limit: 25, has_more: next !== null, next_cursor: next, total }, filters: { q: null, approved: true, role: null, owner_id: null } });

test("query normalisation mirrors the route", () => {
  assert.deepEqual(normalizeQuery("  "), { q: null, invalid: false });
  assert.deepEqual(normalizeQuery("  Zéph   yrin "), { q: "Zéph yrin", invalid: false });
  assert.equal(normalizeQuery("a").invalid, true);
  assert.equal(normalizeQuery("x%y").invalid, true);
  assert.equal(normalizeQuery("x".repeat(81)).invalid, true);
});

test("pages: eligible only, minimal projection, dedup by id, cursor and total", () => {
  let s = appendPage(pickerInitial("k"), page([a(1), a(2, { application_status: "submitted" }), a(3, { company_name: "Élec" })], "c1"));
  assert.deepEqual(s.items, [{ id: "a1", full_name: "Artisan 1", company_name: null }, { id: "a3", full_name: "Artisan 3", company_name: "Élec" }]);
  assert.equal(s.next, "c1");
  s = appendPage(s, page([a(3), a(4), a(5, { artisan_approved: false })], null));
  assert.deepEqual(s.items.map((i) => i.id), ["a1", "a3", "a4"]);
  assert.equal(s.next, null);
  assert.equal(s.total, 150);
  assert.equal(artisanLabel(s.items[1]), "Artisan 3 — Élec");
});

test("wiring: live picker + live thread; reassign command and composer unchanged; demo unchanged", () => {
  const src = readFileSync(path.join(ROOT, "components/role/admin-space.tsx"), "utf8");
  assert.match(src, /session\.operate\(intervention\.id, \{ action: "reassign", artisan_id: target \|\| null, reason: reason\.trim\(\) \}\)/);
  assert.match(src, /\{live \? \(\s*<ArtisanPicker[\s\S]*load=\{session\.loadAdminDirectory\}/);
  assert.match(src, /const thread = useAdminThread\(session\.mutationContext, id, sentReplies, !demo\);/);
  assert.match(src, /const messages = demo\s*\? mergeThread\(session\.data\.messages, sentReplies, id\)/);
  assert.match(src, /<AdminReplyComposer\s+key=\{`\$\{id\}:\$\{session\.mutationContext\.userId\(\) \?\? "anon"\}:\$\{session\.mutationContext\.generation\(\)\}`\}\s+intervention=\{intervention\}\s+demo=\{demo\}\s+context=\{session\.mutationContext\}/);
  const leaf = ["admin-reassign/artisan-picker.tsx", "admin-reassign/artisan-picker-model.ts", "admin-thread/use-admin-thread.ts"].map((f) => readFileSync(path.join(ROOT, "components/features", f), "utf8")).join("\n");
  assert.ok(!/overview\.|session\.data|sessionStorage|localStorage/.test(leaf), "no cache source in the leaves");
});
