// PUB-04 public callback (mirror of 07d718f): strict parsers (available, receipt, closure, queue with
// the handler's page checks), the attempt rule (same UUID for the same content, new UUID after an
// edit), local phone check, wording (exact consent text, no promised delay, no SMS / automatic call),
// mounts (public Help view, support queue under the erasure requests, live only).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/public-callback/model";

const m = loadModule("components/features/public-callback/model.ts") as unknown as typeof Model;
const U = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const row = (n: number, version: 1 | 2 = 1) => ({ id: U(n), phone: "+596696000001", reason: "new_request", version, created_at: `2026-11-07T10:${String(59 - n).padStart(2, "0")}:00Z`, closed_at: version === 2 ? "2026-11-09T12:00:00Z" : null });
export const queue = (items: unknown[], total: number, number = 1, can_close = true) => ({ items, total, can_close, page: { number, limit: 25, pages: Math.max(1, Math.ceil(total / 25)) } });

test("parseurs stricts : disponibilité, reçu exact, classement exact", () => {
  assert.equal(m.parseAvailable({ available: true }), true);
  assert.equal(m.parseAvailable({ available: false }), false);
  assert.equal(m.parseAvailable({ available: "true" }), null);
  assert.equal(m.parseAvailable({ available: true, extra: 1 }), null);
  assert.equal(m.isReceipt({ received: true }), true);
  assert.equal(m.isReceipt({ received: true, phone: "+596" }), false);
  assert.equal(m.isReceipt({ received: false }), false);
  assert.equal(m.isClosure({ closed: true }), true);
  assert.equal(m.isClosure({ closed: true, version: 2 }), false);
});

test("file opérateur : page demandée, nombre de pages, nombre exact d’éléments, statut ⇔ version, plus récent d’abord", () => {
  assert.ok(m.parseQueue(queue([row(1), row(2)], 2), "open", 1));
  assert.ok(m.parseQueue(queue([row(1, 2)], 26, 2), "closed", 2));
  assert.equal(m.parseQueue(queue([row(1)], 2), "open", 1), null, "item count");
  assert.equal(m.parseQueue(queue([row(1, 2)], 1), "open", 1), null, "closed row in open");
  assert.equal(m.parseQueue({ ...queue([row(1)], 1), page: { number: 1, limit: 25, pages: 2 } }, "open", 1), null, "pages");
  assert.equal(m.parseQueue(queue([row(1)], 1, 2), "open", 1), null, "requested page");
  assert.equal(m.parseQueue(queue([{ ...row(1), phone: "0696000001" }], 1), "open", 1), null, "E.164 phone");
  assert.equal(m.parseQueue(queue([{ ...row(1), version: 2 }], 1), "closed", 1), null, "version 2 ⇔ closed_at");
  assert.equal(m.parseQueue({ ...queue([row(1)], 1), extra: 1 }, "open", 1), null);
  assert.equal(m.queueUrl("closed", 3), "/api/support/callbacks?status=closed&page=3");
});

test("tentative : même UUID pour le même contenu, nouveau UUID après une modification", () => {
  let n = 0;
  const id = () => U(900 + ++n);
  const a = m.attemptFor(null, " 0696 00 00 01 ", "new_request", id)!;
  assert.equal(a.request_id, U(901));
  assert.equal(a.phone, "0696 00 00 01");
  assert.equal(m.attemptFor(a, "0696 00 00 01", "new_request", id), a, "same content ⇒ same UUID");
  assert.equal(m.attemptFor(a, "0696 00 00 02", "new_request", id)!.request_id, U(902));
  assert.equal(m.attemptFor(a, "0696 00 00 01", "other", id)!.request_id, U(903));
  assert.equal(m.attemptFor(null, "x", "other", () => null), null);
  assert.equal(m.phoneLooksValid("+596 696 00 00 01"), true);
  assert.equal(m.phoneLooksValid("0696-00-00-01"), true);
  assert.equal(m.phoneLooksValid("12345"), false);
  assert.equal(m.phoneLooksValid("appelez-moi"), false);
});

test("libellés : consentement exact, aucun délai promis, aucun SMS ni appel automatique, « Classé » = action opérateur", () => {
  assert.equal(m.CONSENT_TEXT, "J’accepte d’être rappelé à ce numéro au sujet de cette demande.");
  assert.doesNotMatch(m.COPY.received, /dans (les|\d)|sous \d|rapidement|aujourd’hui|nous vous appelons/i);
  assert.match(m.COPY.received, /sans délai garanti/);
  assert.match(m.COPY.intro, /Aucun SMS ni appel automatique/);
  assert.match(m.COPY.opNote, /« Classé » signifie seulement qu’un opérateur a classé la demande : le résultat d’un éventuel appel n’est pas connu/);
});

test("montages : bloc public dans l’Aide ; file opérateur sous les demandes d’effacement (live) ; rien en stockage", () => {
  const pub = readFileSync("components/role/public-site.tsx", "utf8");
  assert.match(pub, /<PublicWarrantyTerms state=\{warrantyTerms\} \/>\s*<\/div>\s*<PublicCallbackForm \/>/);
  const anchor = readFileSync("components/role/platform-anchor.tsx", "utf8");
  assert.match(anchor, /<OperatorDataRequests context=\{session\.mutationContext\} \/>\}\s*\{session\.mode !== "demo" && <OperatorCallbacks context=\{session\.mutationContext\} \/>\}/);
  const leaf = ["model.ts", "public-callback-form.tsx", "operator-callbacks.tsx"].map((f) => readFileSync(`components/features/public-callback/${f}`, "utf8")).join("\n");
  assert.doesNotMatch(leaf, /localStorage|sessionStorage|history\.|location\.|console\./);
});
