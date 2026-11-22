import { fileURLToPath as localSourcePath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { StorageApiError } from "@supabase/storage-js";
import * as server from "../lib/supabase/server";

const nodeRequire = createRequire(import.meta.url);
const root = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..");
const USER = "10000000-0000-4000-8000-000000000001";
const JOB = "20000000-0000-4000-8000-000000000001";
const ID = "30000000-0000-4000-8000-000000000001";
const objectPath = `${USER}/${ID}`;
const row = { id: ID, owner_id: USER, intervention_id: JOB, path: objectPath, name: "photo.jpg", mime_type: "image/jpeg", created_at: "2026-11-01T00:00:00Z" };
type Result = { data: unknown; error: { code?: string; statusCode?: string } | null };
type Options = {
  anonymous?: boolean; readOnly?: boolean; revokeDuringUpload?: boolean; personal?: boolean;
  finalized?: Result | "throw"; lookup?: Result | "throw";
  upload?: "error" | "throw" | "collision" | "collision-sdk" | "collision-semantic"; cleanup?: "error" | "throw" | "malformed" | "empty" | "foreign" | "mixed";
};
function setup(options: Options = {}) {
  let revoked = false;
  const calls: { name: string; args?: unknown }[] = [];
  const db = {
    from: (table: string) => {
      assert.equal(table, "interventions");
      return { select: () => ({ eq: () => ({ single: async () => {
        calls.push({ name: "parent-read" });
        return { data: revoked ? null : { id: JOB, artisan_id: null }, error: null };
      } }) }) };
    },
    rpc: async (name: string, args?: unknown) => {
      calls.push({ name: `user-rpc:${name}`, args: args === undefined ? undefined : JSON.parse(JSON.stringify(args)) });
      if (name === "owns_intervention") return { data: !revoked && !options.readOnly, error: null };
      if (name === "is_admin") return { data: false, error: null };
      if (name === "check_upload_limit") return { data: null, error: null };
      assert.equal(name, "finalize_document_upload");
      if (options.finalized === "throw") throw new Error("private network detail");
      if (options.finalized) return options.finalized;
      if (revoked) return { data: null, error: { code: "42501" } };
      return { data: { ...row, intervention_id: options.personal ? null : JOB }, error: null };
    },
  };
  const admin = {
    storage: { from: (bucket: string) => {
      assert.equal(bucket, "intervention-documents");
      return {
        upload: async (p: string, bytes: Uint8Array, opts: unknown) => {
          calls.push({ name: "upload", args: { path: p, size: bytes.length, options: opts } });
          if (options.revokeDuringUpload) revoked = true;
          if (options.upload === "throw") throw new Error("private transport detail");
          if (options.upload === "collision-sdk") return { error: new StorageApiError("Object exists", 409, "ResourceAlreadyExists", "storage", "ResourceAlreadyExists") };
          if (options.upload === "collision-semantic") return { error: { statusCode: "Duplicate", code: "Duplicate" } };
          return { error: options.upload === "collision" ? { statusCode: "409" } : options.upload === "error" ? { message: "private storage error" } : null };
        },
        remove: async (paths: string[]) => {
          calls.push({ name: "remove", args: [...paths] });
          if (options.cleanup === "throw") throw new Error("private remove detail");
          return { data: options.cleanup === "malformed" ? null : options.cleanup === "empty" ? [] : options.cleanup === "foreign" ? [{ name: "another-user/another-file" }] : options.cleanup === "mixed" ? [{ name: objectPath }, { name: "another-user/another-file" }] : [{ name: objectPath }], error: options.cleanup === "error" ? { message: "private remove error" } : null };
        },
      };
    } },
    from: (table: string) => {
      assert.equal(table, "documents");
      return { select: () => ({ eq: (_key: string, id: string) => ({ maybeSingle: async () => {
        calls.push({ name: "readback", args: id });
        if (options.lookup === "throw") throw new Error("private lookup detail");
        return options.lookup ?? { data: null, error: null };
      } }) }) };
    },
  };
  const helpers = { ...server,
    authenticatedClient: async () => { if (options.anonymous) throw new server.ApiError(401, "Connectez-vous."); return { db, user: { id: USER } }; },
    adminClient: () => admin,
  };
  const cache = new Map<string, Record<string, unknown>>();
  function load(file: string): Record<string, unknown> {
    if (cache.has(file)) return cache.get(file)!;
    const module = { exports: {} as Record<string, unknown> };
    cache.set(file, module.exports);
    const code = transformSync(readFileSync(file, "utf8"), { loader: "ts", format: "cjs", target: "es2022" }).code;
    const localRequire = (name: string): unknown => {
      if (name === "@/lib/supabase/server") return helpers;
      if (name === "node:crypto") return { randomUUID: () => ID };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
        const resolved = [base, base + ".ts", path.join(base, "index.ts")].find(p => existsSync(p) && /\.ts$/.test(p));
        assert.ok(resolved, name);
        if (resolved === path.join(root, "lib/supabase/server.ts")) return helpers;
        return load(resolved);
      }
      return nodeRequire(name);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, File, Request, Response, Buffer, URL, Uint8Array, ArrayBuffer, console, SyntaxError, Error }, { filename: file });
    cache.set(file, module.exports);
    return module.exports;
  }
  const route = load(path.join(root, "app/api/documents/route.ts"));
  async function post(overrides: { bytes?: Uint8Array<ArrayBuffer>; type?: string; name?: string; origin?: string } = {}) {
    const form = new FormData();
    form.set("file", new File([overrides.bytes ?? new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], overrides.name ?? "photo.jpg", { type: overrides.type ?? "image/jpeg" }));
    if (!options.personal) form.set("intervention_id", JOB);
    return (route.POST as (request: Request) => Promise<Response>)(new Request("https://app.example.test/api/documents", { method: "POST", headers: { origin: overrides.origin ?? "https://app.example.test" }, body: form }));
  }
  return { post, calls };
}
async function payload(response: Response) {
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json();
  assert.ok(!JSON.stringify(body).includes("private "));
  return body;
}

test("web upload keeps nominal public projection and calls JWT finalization after upload, never service-role metadata insert", async () => {
  for (const personal of [false, true]) {
    const h = setup({ personal }); const r = await h.post(); assert.equal(r.status, 201);
    assert.deepEqual(await payload(r), { document: { id: ID, name: "photo.jpg", mime_type: "image/jpeg", created_at: row.created_at } });
    const uploadAt = h.calls.findIndex(c => c.name === "upload"), finalizeAt = h.calls.findIndex(c => c.name === "user-rpc:finalize_document_upload");
    assert.ok(uploadAt >= 0 && finalizeAt > uploadAt);
    assert.deepEqual(h.calls[finalizeAt].args, { p_id: ID, p_path: objectPath, p_name: "photo.jpg", p_mime: "image/jpeg", p_intervention_id: personal ? null : JOB });
    assert.equal(h.calls.some(c => c.name === "remove" || c.name === "readback"), false);
  }
});
test("revocation during Storage I/O is refused by atomic user finalizer and compensates only the attempted object", async () => {
  const h = setup({ revokeDuringUpload: true }); const r = await h.post(); assert.equal(r.status, 403); await payload(r);
  assert.deepEqual(h.calls.filter(c => c.name === "remove").map(c => c.args), [[objectPath]]);
  assert.equal(h.calls.filter(c => c.name === "user-rpc:finalize_document_upload").length, 1);
});
test("a committed finalization whose reply was lost is recovered only by exact metadata readback", async () => {
  const h = setup({ finalized: "throw", lookup: { data: row, error: null } }); const r = await h.post(); assert.equal(r.status, 201); await payload(r);
  assert.equal(h.calls.some(c => c.name === "remove"), false);
});
test("lost reply plus absent, failed or malformed readback stays uncertain502 and never deletes a potentially committed object", async () => {
  for (const lookup of [undefined, "throw", { data: null, error: { code: "network" } }, { data: {}, error: null }, { data: [], error: null },
    ...["id", "path", "owner_id", "intervention_id", "name", "mime_type"].map(key => ({ data: { ...row, [key]: "wrong" }, error: null })), { data: { ...row, created_at: "" }, error: null }] as const) {
    const h = setup({ finalized: "throw", lookup }); const r = await h.post(); assert.equal(r.status, 502);
    const body = await payload(r); assert.equal(body.uncertain, true); assert.equal(r.headers.get("Retry-After"), null);
    assert.equal(h.calls.some(c => c.name === "remove"), false);
  }
});
test("malformed finalization success is not201 unless the exact committed row can be read", async () => {
  const h = setup({ finalized: { data: {}, error: null } }); const r = await h.post(); assert.equal(r.status, 502); assert.equal((await payload(r)).uncertain, true);
  assert.equal(h.calls.some(c => c.name === "remove"), false);
});
test("known rollback does not treat failed readback as absence or compensate an unknown row", async () => {
  const h = setup({ revokeDuringUpload: true, lookup: { data: null, error: { code: "network" } } }); const r = await h.post(); assert.equal(r.status, 502); await payload(r); assert.equal(h.calls.some(c => c.name === "remove"), false);
});
test("failed compensation after a known rollback is explicitly incomplete503, never a success or raw exception", async () => {
  for (const cleanup of ["error", "throw", "malformed", "empty", "foreign", "mixed"] as const) {
    const h = setup({ revokeDuringUpload: true, cleanup }); const r = await h.post(); assert.equal(r.status, 503); assert.equal(r.headers.get("Retry-After"), "2"); assert.equal((await payload(r)).cleanup, "incomplete");
  }
});
test("uncertain Storage upload is compensated before any finalization; failed cleanup is not hidden", async () => {
  for (const upload of ["throw", "error"] as const) for (const cleanup of [undefined, "error"] as const) {
    const h = setup({ upload, cleanup }); const r = await h.post(); assert.equal(r.status, 503); const body = await payload(r);
    assert.equal(body.cleanup, cleanup ? "incomplete" : undefined);
    assert.equal(h.calls.some(c => c.name === "user-rpc:finalize_document_upload"), false);
    assert.deepEqual(h.calls.filter(c => c.name === "remove").map(c => c.args), [[objectPath]]);
  }
});
test("an upsert:false duplicate-path refusal never deletes a preexisting object", async () => {
  for (const upload of ["collision", "collision-sdk", "collision-semantic"] as const) {
    const h = setup({ upload }); const r = await h.post(); assert.equal(r.status, 409); await payload(r); assert.equal(h.calls.some(c => c.name === "remove"), false);
  }
});
test("authentication, origin, readonly access and MIME magic-byte guards remain before Storage", async () => {
  for (const [opts, input, status] of [
    [{ anonymous: true }, {}, 401], [{}, { origin: "https://foreign.example" }, 403], [{ readOnly: true }, {}, 403],
    [{}, { bytes: new Uint8Array([1,2,3]), type: "image/jpeg" }, 422],
    [{}, { bytes: new Uint8Array(4194305), type: "image/jpeg" }, 422],
  ] as const) {
    const h = setup(opts); const r = await h.post(input); assert.equal(r.status, status); await payload(r); assert.equal(h.calls.some(c => c.name === "upload"), false);
  }
});
