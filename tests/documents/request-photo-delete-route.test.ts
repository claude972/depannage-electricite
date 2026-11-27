import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "./harness";

// R-SRV-16: DELETE /api/documents relies on the atomic SQL command `delete_request_photo`; the
// route only maps its outcome and removes the private file from the path the command returns.
const PHOTO = "10000000-0000-4000-8000-0000000000a1";
const PATH = "10000000-0000-4000-8000-000000000009/" + PHOTO;
type Rpc = { data: unknown; error: { code?: string } | null };

function setup(options: { rpc?: Rpc; storage?: { data: unknown; error: unknown } | "throw"; legacyDoc?: unknown } = {}) {
  const calls: { name: string; args?: unknown }[] = [];
  const db = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name: "rpc:" + name, args });
      return options.rpc ?? { data: { deleted: true, id: PHOTO, path: PATH }, error: null };
    },
  };
  const admin = {
    from: (table: string) => {
      calls.push({ name: "admin:" + table });
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: options.legacyDoc ?? null, error: null }) }) }) };
    },
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => {
      calls.push({ name: "remove", args: { bucket, paths } });
      if (options.storage === "throw") throw new Error("private storage detail");
      return options.storage ?? { data: [{ name: paths[0] }], error: null };
    } }) },
  };
  const route = loadModule("app/api/documents/route.ts", {
    "@/lib/supabase/server": { ...fakeServerHelpers({ db }), adminClient: () => admin },
  });
  const del = (query = `?id=${PHOTO}`, headers: Record<string, string> = {}) =>
    (route.DELETE as (r: Request) => Promise<Response>)(new Request(`https://app.example.test/api/documents${query}`, { method: "DELETE", headers }));
  return { calls, del };
}

test("R-SRV-16: the deletion is one SQL command; the file is removed from the path it returns", async () => {
  const h = setup();
  const response = await h.del();
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(await response.json()), JSON.stringify({ deleted: true, id: PHOTO }));
  assert.deepEqual(h.calls.map((c) => c.name), ["rpc:delete_request_photo", "remove"]);
  assert.equal(JSON.stringify(h.calls[0].args), JSON.stringify({ p_document_id: PHOTO }));
  assert.equal(JSON.stringify(h.calls[1].args), JSON.stringify({ bucket: "intervention-documents", paths: [PATH] }));
});

test("R-SRV-16: closed offer, foreign or unknown photo, reference and rate limit keep the file", async () => {
  for (const [code, status, message] of [["P0001", 409, /plus en recherche d’artisan/], ["42501", 404, /introuvable/], ["23503", 409, /utilisée dans un message/], ["53300", 429, /Trop de suppressions/], ["XX000", 503, /momentanément indisponible/]] as const) {
    const h = setup({ rpc: { data: null, error: { code } } });
    const response = await h.del();
    assert.equal(response.status, status, code);
    assert.match((await response.json()).error, message);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.ok(!h.calls.some((c) => c.name === "remove" || c.name.startsWith("admin:")), `${code}: no file removal, no service-role read`);
  }
});

test("R-SRV-16: an unexpected command answer never removes a file", async () => {
  for (const data of [null, { deleted: true, id: PHOTO }, { deleted: true, id: "10000000-0000-4000-8000-0000000000ff", path: PATH }, { deleted: false, id: PHOTO, path: PATH }]) {
    const h = setup({ rpc: { data, error: null } });
    assert.equal((await h.del()).status, 503);
    assert.ok(!h.calls.some((c) => c.name === "remove"));
  }
});

test("R-SRV-16: a file that could not be removed is reported, the row deletion stands", async () => {
  const h = setup({ storage: "throw" });
  const response = await h.del();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.cleanup, "incomplete");
  assert.ok(!JSON.stringify(body).includes("private storage detail"));
  assert.equal(h.calls.filter((c) => c.name === "remove").length, 2, "one retry");
});

test("R-SRV-16: invalid input and foreign origin are refused before any command", async () => {
  for (const [query, headers, status] of [["?id=nope", {}, 422], [`?id=${PHOTO}&x=1`, {}, 422], [`?id=${PHOTO}`, { origin: "https://evil.example.test" }, 403]] as const) {
    const h = setup();
    assert.equal((await h.del(query, headers)).status, status);
    assert.equal(h.calls.length, 0);
  }
});

test("R-SRV-25: only a database without the command (PGRST202) falls back to the checked legacy path", async () => {
  const h = setup({ rpc: { data: null, error: { code: "PGRST202" } }, legacyDoc: null });
  assert.equal((await h.del()).status, 404);
  assert.deepEqual(h.calls.map((c) => c.name), ["rpc:delete_request_photo", "admin:documents"]);
});
