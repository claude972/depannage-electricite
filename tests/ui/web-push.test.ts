// Web push enrollment (contract given by ROOT; route/worker statics are ROOT's): strict view parse,
// key decoding + same-key comparison, subscription body, worker readiness handshake with timeout,
// mount in the shared PreferencesPanel with the session mutation context; demo zero calls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/web-push/model";
import type * as Panel from "../../components/features/web-push/web-push-panel";

const m = loadModule("components/features/web-push/model.ts") as unknown as typeof Model;
const p = loadModule("components/features/web-push/web-push-panel.tsx") as unknown as typeof Panel;
const bytes = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : (i * 7) % 256));
const KEY = Buffer.from(bytes).toString("base64url");

test("vue stricte : disponibilité, clé publique, inscription (version, opted_in, navigateur)", () => {
  assert.ok(m.parsePushView({ available: true, public_key: KEY, enrollment: null }));
  assert.ok(m.parsePushView({ available: true, public_key: KEY, enrollment: { version: 2, opted_in: true, browser: "other" } }));
  assert.ok(m.parsePushView({ available: false, public_key: null, enrollment: null }));
  assert.equal(m.parsePushView({ available: true, public_key: null, enrollment: null }), null, "available needs a key");
  assert.equal(m.parsePushView({ available: true, public_key: KEY, enrollment: { version: 2, opted_in: true, browser: "mine" } }), null);
  assert.equal(m.parsePushView({ available: true, public_key: KEY, enrollment: null, endpoint: "x" }), null, "strict");
});

test("clé VAPID → octets (point P-256 non compressé) ; même clé / autre clé ; corps d’abonnement", () => {
  const b = m.keyBytes(KEY)!;
  assert.equal(b.length, 65);
  assert.deepEqual([...b], [...bytes]);
  assert.equal(m.keyBytes("abc"), null);
  assert.equal(m.keyBytes(Buffer.from(new Uint8Array(65)).toString("base64url")), null, "must start with 0x04");
  const sub = (k: Uint8Array) => ({ options: { applicationServerKey: k.buffer.slice(0) as ArrayBuffer }, toJSON: () => ({ endpoint: "https://push.example.test/abc", expirationTime: null, keys: { p256dh: "Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", auth: "aaaaaaaaaaaaaaaaaaaaaa" } }), unsubscribe: async () => true });
  assert.equal(m.sameKey(sub(bytes), b), true);
  const other = bytes.slice(); other[10] ^= 1;
  assert.equal(m.sameKey(sub(other), b), false);
  assert.equal(m.sameKey(null, b), false);
  assert.equal(JSON.stringify(m.subscriptionBody(sub(bytes))), JSON.stringify({ endpoint: "https://push.example.test/abc", keys: { p256dh: "Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", auth: "aaaaaaaaaaaaaaaaaaaaaa" } }));
  assert.equal(m.subscriptionBody({ toJSON: () => ({ endpoint: "nope" }), unsubscribe: async () => true }), null);
  assert.equal(m.subscriptionBody({ toJSON: () => ({ endpoint: "https://push.example.test/abc", keys: { p256dh: "short", auth: "aaaaaaaaaaaaaaaaaaaaaa" } }), unsubscribe: async () => true }), null, "route lengths (87 / 22)");
});

test("poignée de main : pas d’enregistrement ou pas de worker actif ⇒ non prêt (le vrai canal est testé dans Chromium)", async () => {
  assert.equal(await m.checkReady(null, 50), false);
  assert.equal(await m.checkReady({ active: null, pushManager: {} } as never, 50), false);
});

test("libellés : un seul navigateur (remplacement dit), aucune promesse ; démo sans appel ; montage partagé", () => {
  assert.match(m.COPY.intro, /Un seul navigateur[\s\S]*remplace le précédent/);
  assert.match(m.COPY.other, /autre navigateur[\s\S]*remplacera/);
  const demo = renderToString(createElement(p.WebPushPanel as never, { demo: true, pushSaved: true, context: { generation: () => 1, userId: () => null } } as never));
  assert.match(demo, /aucun appel n’est fait/);
  assert.doesNotMatch(demo, /<button/);
  const center = readFileSync("components/features/notifications/notification-center.tsx", "utf8");
  assert.match(center, /<WebPushPanel demo=\{Boolean\(demo\)\} pushSaved=\{view\.preferences\.push_enabled\} context=\{context \?\? /, "saved preference, never the local checkbox");
  assert.match(center, /<PreferencesPanel client=\{client\} demo=\{demo\?\.preferences\} writable=\{writable\} context=\{context\}/);
  assert.match(readFileSync("components/role/notifications-anchor.tsx", "utf8"), /context=\{session\.mutationContext\}/);
  assert.match(readFileSync("components/role/client-space.tsx", "utf8"), /writable=\{!demo\}\s+context=\{session\.mutationContext\}/);
  const leaf = readFileSync("components/features/web-push/web-push-panel.tsx", "utf8") + readFileSync("components/features/web-push/model.ts", "utf8");
  assert.doesNotMatch(leaf, /localStorage|sessionStorage|console\./, "endpoint/keys never stored or logged");
});

test("étiquette du canal push : « Disponible » seulement si le serveur le dit, « Actif sur ce navigateur » seulement pour ce navigateur inscrit", () => {
  const v = (available: boolean, enrollment: unknown) => ({ available, public_key: available ? KEY : null, enrollment }) as never;
  assert.equal(m.pushTag(v(true, { version: 1, opted_in: false, browser: "none" }), "ready"), "available");
  assert.equal(m.pushTag(v(true, { version: 2, opted_in: true, browser: "current" }), "ready"), "current");
  assert.equal(m.pushTag(v(true, { version: 2, opted_in: true, browser: "other" }), "ready"), "available", "never active for another browser");
  assert.equal(m.pushTag(v(false, { version: 2, opted_in: true, browser: "current" }), "unavailable"), null);
  assert.equal(m.pushTag(v(true, null), "unsupported"), null);
  assert.equal(m.pushTag(null, "checking"), null);
  assert.equal(m.TAG_LABEL.current, "Actif sur ce navigateur");
  assert.equal(m.TAG_LABEL.available, "Disponible");
  const center = readFileSync("components/features/notifications/notification-center.tsx", "utf8");
  assert.match(center, /channel === "push" && pushTagState \? \(\s*<Tag tone="green">\{TAG_LABEL\[pushTagState\]\}<\/Tag>/);
  assert.match(center, /<ChannelTag available=\{view\.channels\[channel\] === "available"\} optIn=\{view\.preferences\[`\$\{channel\}_enabled`\]\} \/>/, "e-mail / SMS tags: server availability + saved opt-in");
});
