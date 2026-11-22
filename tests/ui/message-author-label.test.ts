// ADM-07 prerequisite: an operator's reply in a dossier thread must never be shown as written by
// the other party. Reads the real messageAuthorLabel used by MessageCenter.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule } from "../documents/harness";

const forms = loadModule("components/app/forms.tsx") as Record<string, any>;
const label = forms.messageAuthorLabel as (a: string, d: unknown, role: string, me: string) => string;
const CLIENT = "c0000000-0000-4000-8000-000000000001";
const ARTISAN = "a0000000-0000-4000-8000-000000000001";
const ADMIN = "d0000000-0000-4000-8000-000000000001";
const COLLEAGUE = "e0000000-0000-4000-8000-000000000001";
const privateDossier = { client_id: CLIENT, artisan_id: ARTISAN, site_id: null };
const siteDossier = { client_id: CLIENT, artisan_id: ARTISAN, site_id: "f0000000-0000-4000-8000-000000000001" };

test("own messages and the two parties keep their labels", () => {
  assert.equal(label(CLIENT, privateDossier, "client", CLIENT), "Vous");
  assert.equal(label(ARTISAN, privateDossier, "client", CLIENT), "Artisan");
  assert.equal(label(CLIENT, privateDossier, "artisan", ARTISAN), "Client");
});

test("an operator reply on a private dossier is « Exploitant », never the other party", () => {
  assert.equal(label(ADMIN, privateDossier, "client", CLIENT), "Exploitant");
  assert.equal(label(ADMIN, privateDossier, "artisan", ARTISAN), "Exploitant");
});

test("on a site dossier or for a manager, an unknown author may be a colleague: no false attribution", () => {
  assert.equal(label(ADMIN, siteDossier, "artisan", ARTISAN), "Autre participant (équipe ou exploitant)");
  assert.equal(label(COLLEAGUE, siteDossier, "manager", CLIENT), "Autre participant (équipe ou exploitant)");
});

test("missing participant ids never produce a guessed party", () => {
  assert.equal(label(ADMIN, undefined, "client", CLIENT), "Participant");
  assert.equal(label(ADMIN, { artisan_id: ARTISAN }, "artisan", ARTISAN), "Participant");
  assert.equal(label(ADMIN, { client_id: CLIENT, artisan_id: null }, "artisan", ARTISAN), "Participant");
});

test("MessageCenter uses the helper for every bubble (old binary label removed)", () => {
  const src = readFileSync("components/app/forms.tsx", "utf8");
  assert.match(src, /\{messageAuthorLabel\(m\.author_id, target, role, profileId\)\}/);
  assert.doesNotMatch(src, /role === "artisan"\s*\?\s*"Client"\s*:\s*"Artisan"/);
});
