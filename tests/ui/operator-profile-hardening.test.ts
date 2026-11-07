// Operator profile editor hardening (ROOT review of 3850e97): tab storage must be readable back
// before any POST; a stored command is restored only through the strict command schema and only
// for the same uid + generation; replies after an identity change are ignored; 401/403 clears every
// sensitive copy. Contract comes from lib (no local copy).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/public-operator-profile/model";

const m = loadModule("components/features/public-operator-profile/model.ts") as unknown as typeof Model;
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const DATA = { version: 2, draft: { legal_name: "Exploitant QA SAS" }, published: null };
const ID1 = "10000000-0000-4000-8000-000000000001", ID2 = "10000000-0000-4000-8000-000000000002";

function memStore() {
  const mem = new Map<string, string>();
  return { mem, store: { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => void mem.set(k, v), remove: (k: string) => void mem.delete(k) } as Model.Store };
}
function harness(opts: { store?: Model.Store | null; replies?: Model.Result[]; ctx?: { uid: string | null; gen: number }; onCommand?: () => void } = {}) {
  const ctx = opts.ctx ?? { uid: "admin-1", gen: 1 };
  const { mem, store } = memStore();
  const s = opts.store === undefined ? store : opts.store;
  const posts: unknown[] = [];
  let state: Model.EditorView = { ...m.EDITOR_INITIAL };
  const ids = [ID1, ID2];
  const ctrl = m.createEditorController({
    api: () => ({
      load: async () => ({ status: 200, body: DATA }),
      command: async (body) => { posts.push(json(body)); opts.onCommand?.(); return (opts.replies ?? []).shift() ?? { status: 503, body: null }; },
    }),
    store: () => s,
    newId: () => ids.shift() ?? null,
    context: { userId: () => ctx.uid, generation: () => ctx.gen },
    get: () => state,
    set: (n) => { state = n; },
  });
  return { ctrl, posts, mem, ctx, get: () => state };
}

test("stockage d’onglet inaccessible, qui lève ou relu différent ⇒ aucun POST, message explicite", async () => {
  const throwing: Model.Store = { get: () => { throw new Error("denied"); }, set: () => { throw new Error("denied"); }, remove: () => {} };
  const lying: Model.Store = { get: () => "autre chose", set: () => {}, remove: () => {} };
  for (const store of [null, throwing, lying]) {
    const h = harness({ store });
    await h.ctrl.load();
    assert.equal(await h.ctrl.save({ legal_name: "X" }), false);
    assert.equal(h.posts.length, 0, "nothing sent");
    assert.equal(h.get().error, m.PROFILE_COPY.storage);
  }
});

test("clé liée à l’identité ; commande restaurée seulement si son schéma est valide et pour la même identité", async () => {
  const h = harness({ replies: [{ status: 0, body: null }] });
  await h.ctrl.load();
  await h.ctrl.save({ legal_name: "X" });
  const key = m.pendingKey("admin-1", 1);
  assert.ok(h.mem.has(key), "stored under uid + generation");
  // Malformed stored commands are ignored and removed.
  for (const raw of ["{", JSON.stringify({ uid: "admin-1", gen: 1, command: { action: "save", command_id: "x", expected_version: 2 } }), JSON.stringify({ action: "publish" })]) {
    const g = harness();
    g.mem.set(m.pendingKey("admin-1", 1), raw);
    g.ctrl.restorePending();
    assert.equal(g.get().pending, null, raw);
    assert.equal(g.mem.has(m.pendingKey("admin-1", 1)), false, `${raw} removed`);
  }
  // A valid command stored for another uid / generation is never restored.
  const valid = JSON.stringify({ uid: "admin-1", gen: 1, command: { action: "publish", command_id: ID1, expected_version: 2 } });
  for (const ctx of [{ uid: "admin-2", gen: 1 }, { uid: "admin-1", gen: 2 }]) {
    const g = harness({ ctx });
    g.mem.set(m.pendingKey("admin-1", 1), valid);
    g.mem.set(m.pendingKey(ctx.uid, ctx.gen), valid); // even copied under the new key, its identity differs
    g.ctrl.restorePending();
    assert.equal(g.get().pending, null, JSON.stringify(ctx));
  }
  const same = harness();
  same.mem.set(m.pendingKey("admin-1", 1), valid);
  same.ctrl.restorePending();
  assert.equal(same.get().pending?.command_id, ID1, "same identity: offered again (never auto-sent)");
  assert.equal(same.posts.length, 0);
});

test("changement d’identité ou de génération entre deux essais ⇒ aucune relance ; réponse après changement ignorée", async () => {
  const h = harness({ replies: [{ status: 0, body: null }] });
  await h.ctrl.load();
  await h.ctrl.save({ legal_name: "X" });
  assert.ok(h.get().pending);
  h.ctx.gen = 2;
  assert.equal(await h.ctrl.retry(), false);
  assert.equal(h.posts.length, 1, "never replayed under another generation");
  assert.equal(h.get().pending, null);
  // Reply arriving after an identity change is ignored (no state applied).
  const g = harness({ replies: [{ status: 200, body: { version: 3, action: "save" } }] });
  await g.ctrl.load();
  const ctx = g.ctx;
  const before = json(g.get());
  const p = g.ctrl.save({ legal_name: "Y" });
  ctx.uid = "admin-2";
  assert.equal(await p, false);
  assert.equal(g.get().notice, "");
  assert.deepEqual(json(g.get()).data, before.data);
});

test("identité modifiée pendant l’envoi (onCommand) ⇒ réponse ignorée", async () => {
  const box = { ctx: { uid: "admin-1" as string | null, gen: 1 } };
  const h = harness({ ctx: box.ctx, replies: [{ status: 200, body: { version: 3, action: "save" } }], onCommand: () => { box.ctx.gen = 9; } });
  await h.ctrl.load();
  assert.equal(await h.ctrl.save({ legal_name: "Z" }), false);
  assert.notEqual(h.get().notice, "Brouillon enregistré.");
});

test("401 / 403 ⇒ brouillon, publication, commande en attente effacés ; refus honnête", async () => {
  for (const status of [401, 403]) {
    const h = harness({ replies: [{ status, body: { error: "x" } }] });
    await h.ctrl.load();
    assert.ok(h.get().data);
    await h.ctrl.save({ legal_name: "X" });
    const s = h.get();
    assert.equal(s.phase, "forbidden");
    assert.equal(s.data, null);
    assert.equal(s.pending, null);
    assert.equal(h.mem.size, 0, "stored command removed");
  }
  const src = readFileSync("components/features/public-operator-profile/operator-profile-editor.tsx", "utf8");
  assert.match(src, /if \(view\.phase === "forbidden"\) setValues\(null\);/, "typed draft values cleared too");
});

test("contrat importé depuis lib, aucune copie locale", () => {
  assert.equal(existsSync("components/features/public-operator-profile/contract.ts"), false);
  for (const f of ["components/features/public-operator-profile/model.ts", "components/features/public-operator-profile/operator-profile-editor.tsx", "components/role/public-site.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /from "\.\/contract"/, f);
    assert.doesNotMatch(src, /z\.object\(\{\s*legal_name/, `${f}: no schema copy`);
  }
  assert.match(readFileSync("components/features/public-operator-profile/model.ts", "utf8"), /lib\/features\/public-operator-profile\/contract/);
});
