import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  handleNativeDocumentUpload,
  mapDbCode,
  type DocumentRow,
  type GatewayDeps,
  type RpcResult,
} from "../supabase/functions/native-document-upload/handler.ts";

const URL_ = "https://project.functions.supabase.co/native-document-upload";
const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const JOB = "00000000-0000-4000-8000-00000000aaaa";
const NEW_ID = "11111111-1111-4111-8111-111111111111";
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const row: DocumentRow = {
  id: NEW_ID,
  name: "photo.jpg",
  mime_type: "image/jpeg",
  created_at: "2026-10-31T06:00:00Z",
};

type Calls = {
  authenticated: string[];
  selected: { token: string; id: string }[];
  rpc: { token: string; fn: string; args?: Record<string, unknown> }[];
  put: { path: string; mime: string; size: number }[];
  removed: string[];
  found: string[];
};
type Options = {
  user?: { id: string } | null;
  intervention?: { artisan_id: string | null } | null;
  rpc?: Record<string, RpcResult<unknown> | (() => RpcResult<unknown> | Promise<RpcResult<unknown>>)>;
  putError?: boolean | "throw";
  existing?: DocumentRow | null;
};
function fake(options: Options = {}): { deps: GatewayDeps; calls: Calls } {
  const calls: Calls = { authenticated: [], selected: [], rpc: [], put: [], removed: [], found: [] };
  const rpcTable: NonNullable<Options["rpc"]> = {
    owns_intervention: { data: true, error: null },
    is_admin: { data: false, error: null },
    check_upload_limit: { data: null, error: null },
    finalize_document_upload: { data: { ...row }, error: null },
    ...options.rpc,
  };
  const deps: GatewayDeps = {
    async authenticate(token) {
      calls.authenticated.push(token);
      return options.user === undefined ? { id: USER } : options.user;
    },
    async selectInterventionArtisan(token, id) {
      calls.selected.push({ token, id });
      return options.intervention === undefined ? { artisan_id: null } : options.intervention;
    },
    async rpc<T>(token: string, fn: string, args?: Record<string, unknown>) {
      calls.rpc.push({ token, fn, args });
      const entry = rpcTable[fn];
      if (!entry) throw new Error(`unexpected rpc ${fn}`);
      const result = typeof entry === "function" ? await entry() : entry;
      return result as RpcResult<T>;
    },
    async putObject(path, bytes, mime) {
      calls.put.push({ path, mime, size: bytes.length });
      if (options.putError === "throw") throw new Error("socket closed");
      return { error: options.putError ? { message: "storage down" } : null };
    },
    async removeObject(path) {
      calls.removed.push(path);
    },
    async findDocument(id) {
      calls.found.push(id);
      return options.existing ?? null;
    },
    randomUUID: () => NEW_ID,
  };
  return { deps, calls };
}
function upload(
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
  extra: { interventionId?: string; token?: string | null; name?: string; headers?: Record<string, string> } = {},
) {
  const form = new FormData();
  form.set("file", new File([bytes], extra.name ?? "photo.jpg", { type }));
  if (extra.interventionId !== undefined) form.set("intervention_id", extra.interventionId);
  const headers = new Headers(extra.headers);
  if (extra.token !== null) headers.set("authorization", `Bearer ${extra.token ?? "token-user"}`);
  return new Request(URL_, { method: "POST", body: form, headers });
}
async function body(response: Response) {
  return (await response.json()) as { error?: string; document?: DocumentRow };
}
function assertPrivate(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}

test("OPTIONS preflight is answered without credentials; other verbs are refused", async () => {
  const { deps, calls } = fake();
  const preflight = await handleNativeDocumentUpload(new Request(URL_, { method: "OPTIONS" }), deps);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
  const get = await handleNativeDocumentUpload(new Request(URL_, { method: "GET" }), deps);
  assert.equal(get.status, 405);
  assert.equal(calls.authenticated.length, 0);
});
test("missing or refused bearer token is 401 before any database or storage call", async () => {
  const anonymous = fake();
  const noToken = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg", { token: null }), anonymous.deps);
  assert.equal(noToken.status, 401);
  assertPrivate(noToken);
  const refused = fake({ user: null });
  const bad = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg", { token: "expired" }), refused.deps);
  assert.equal(bad.status, 401);
  assert.deepEqual(refused.calls.authenticated, ["expired"]);
  for (const c of [anonymous.calls, refused.calls]) {
    assert.equal(c.rpc.length, 0);
    assert.equal(c.put.length, 0);
    assert.equal(c.selected.length, 0);
  }
});
test("oversized Content-Length is refused before the body is read", async () => {
  const { deps, calls } = fake();
  const request = upload(jpeg, "image/jpeg", { headers: { "content-length": "4400001" } });
  const response = await handleNativeDocumentUpload(request, deps);
  assert.equal(response.status, 413);
  assert.equal(request.bodyUsed, false);
  assert.equal(calls.rpc.length, 0);
});
test("missing file, empty file and invalid dossier id are 422", async () => {
  const { deps, calls } = fake();
  const noFile = new FormData();
  noFile.set("intervention_id", JOB);
  const missing = await handleNativeDocumentUpload(
    new Request(URL_, { method: "POST", body: noFile, headers: { authorization: "Bearer t" } }),
    deps,
  );
  assert.equal(missing.status, 422);
  const empty = await handleNativeDocumentUpload(upload(new Uint8Array(), "image/jpeg"), deps);
  assert.equal(empty.status, 422);
  const badId = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg", { interventionId: "nope" }), deps);
  assert.equal(badId.status, 422);
  assert.equal((await body(badId)).error, "Dossier invalide.");
  assert.equal(calls.selected.length, 0);
  assert.equal(calls.rpc.length, 0);
  assert.equal(calls.put.length, 0);
});
test("a dossier that is not visible under RLS is 403 without revealing existence", async () => {
  const { deps, calls } = fake({ intervention: null });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg", { interventionId: JOB }), deps);
  assert.equal(response.status, 403);
  assert.equal((await body(response)).error, "Vous n’avez pas accès à ce dossier.");
  assert.deepEqual(calls.selected, [{ token: "token-user", id: JOB }]);
  assert.equal(calls.rpc.length, 0);
  assert.equal(calls.put.length, 0);
});
test("read-only access (viewer, unassigned artisan) is 403 before quota and upload", async () => {
  const { deps, calls } = fake({
    intervention: { artisan_id: OTHER },
    rpc: { owns_intervention: { data: false, error: null }, is_admin: { data: false, error: null } },
  });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg", { interventionId: JOB }), deps);
  assert.equal(response.status, 403);
  assert.equal((await body(response)).error, "Votre accès à ce dossier est en lecture seule.");
  assert.deepEqual(calls.rpc.map((c) => c.fn).sort(), ["is_admin", "owns_intervention"]);
  assert.equal(calls.put.length, 0);
});
test("the assigned artisan and an administrator may attach to the dossier", async () => {
  const artisan = fake({
    intervention: { artisan_id: USER },
    rpc: { owns_intervention: { data: false, error: null } },
  });
  const a = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg", { interventionId: JOB }), artisan.deps);
  assert.equal(a.status, 201);
  const admin = fake({
    intervention: { artisan_id: OTHER },
    rpc: { owns_intervention: { data: false, error: null }, is_admin: { data: true, error: null } },
  });
  const b = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg", { interventionId: JOB }), admin.deps);
  assert.equal(b.status, 201);
});
test("upload quota (53300) is 429 and nothing is written", async () => {
  const { deps, calls } = fake({ rpc: { check_upload_limit: { data: null, error: { code: "53300" } } } });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 429);
  assert.equal(calls.put.length, 0);
  assert.equal(calls.removed.length, 0);
});
test("content whose magic bytes do not match the declared type is 415 and never stored", async () => {
  const { deps, calls } = fake();
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/png"), deps);
  assert.equal(response.status, 415);
  const gif = await handleNativeDocumentUpload(
    upload(new TextEncoder().encode("GIF89a"), "image/gif", { name: "anim.gif" }),
    deps,
  );
  assert.equal(gif.status, 415);
  assert.equal(calls.put.length, 0);
  assert.equal(calls.rpc.filter((c) => c.fn === "finalize_document_upload").length, 0);
});
test("a file above 4 MiB is 413 even when the quota and rights are fine", async () => {
  const { deps, calls } = fake();
  const big = new Uint8Array(4194305);
  big.set(jpeg);
  const response = await handleNativeDocumentUpload(upload(big, "image/jpeg"), deps);
  assert.equal(response.status, 413);
  assert.equal(calls.put.length, 0);
});
test("success: quota, upload under the owner path, then finalization with the user token", async () => {
  const { deps, calls } = fake();
  const response = await handleNativeDocumentUpload(
    upload(png, "image/png", { interventionId: JOB, name: "x".repeat(300) }),
    deps,
  );
  assert.equal(response.status, 201);
  assertPrivate(response);
  assert.deepEqual((await body(response)).document, row);
  assert.deepEqual(calls.put, [{ path: `${USER}/${NEW_ID}`, mime: "image/png", size: png.length }]);
  const order = calls.rpc.map((c) => c.fn);
  assert.ok(order.indexOf("check_upload_limit") < order.indexOf("finalize_document_upload"));
  const finalize = calls.rpc.find((c) => c.fn === "finalize_document_upload");
  assert.equal(finalize?.token, "token-user");
  assert.deepEqual(finalize?.args, {
    p_id: NEW_ID,
    p_path: `${USER}/${NEW_ID}`,
    p_name: "x".repeat(160),
    p_mime: "image/png",
    p_intervention_id: JOB,
  });
  assert.equal(calls.removed.length, 0);
  assert.equal(calls.found.length, 0);
});
test("a personal document (no dossier) needs no intervention checks", async () => {
  const { deps, calls } = fake();
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 201);
  assert.equal(calls.selected.length, 0);
  const finalize = calls.rpc.find((c) => c.fn === "finalize_document_upload");
  assert.equal(finalize?.args?.p_intervention_id, null);
});
test("rights revoked between pre-check and finalization: 403, only this attempt's object removed", async () => {
  const { deps, calls } = fake({
    intervention: { artisan_id: null },
    rpc: { finalize_document_upload: { data: null, error: { code: "42501" } } },
  });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg", { interventionId: JOB }), deps);
  assert.equal(response.status, 403);
  assert.deepEqual(calls.removed, [`${USER}/${NEW_ID}`]);
  assert.deepEqual(calls.found, [NEW_ID]);
});
test("missing storage object at finalization is 404 with compensation", async () => {
  const { deps, calls } = fake({ rpc: { finalize_document_upload: { data: null, error: { code: "P0002" } } } });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 404);
  assert.deepEqual(calls.removed, [`${USER}/${NEW_ID}`]);
});
test("duplicate id or path at finalization is 409 with compensation", async () => {
  const { deps, calls } = fake({ rpc: { finalize_document_upload: { data: null, error: { code: "23505" } } } });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 409);
  assert.deepEqual(calls.removed, [`${USER}/${NEW_ID}`]);
});
test("a lost finalization response with committed metadata returns 201 and deletes nothing", async () => {
  const { deps, calls } = fake({
    rpc: {
      finalize_document_upload: () => {
        throw new Error("fetch failed");
      },
    },
    existing: row,
  });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 201);
  assert.deepEqual((await body(response)).document, row);
  assert.equal(calls.removed.length, 0);
});
test("a thrown finalization without metadata is 503 and compensated", async () => {
  const { deps, calls } = fake({
    rpc: {
      finalize_document_upload: () => {
        throw new Error("fetch failed");
      },
    },
  });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 503);
  assert.deepEqual(calls.removed, [`${USER}/${NEW_ID}`]);
});
test("storage upload failure is 503, the attempt path is compensated and finalization is skipped", async () => {
  for (const putError of [true, "throw"] as const) {
    const { deps, calls } = fake({ putError });
    const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
    assert.equal(response.status, 503);
    assert.deepEqual(calls.removed, [`${USER}/${NEW_ID}`]);
    assert.equal(calls.rpc.filter((c) => c.fn === "finalize_document_upload").length, 0);
  }
});
test("error bodies never expose storage paths, SQL codes or keys", async () => {
  const cases: Options[] = [
    { rpc: { finalize_document_upload: { data: null, error: { code: "42501", message: "permission denied for table documents" } } } },
    { rpc: { check_upload_limit: { data: null, error: { code: "53300", message: "Rate limit exceeded" } } } },
    { putError: true },
    { user: null },
  ];
  for (const options of cases) {
    const { deps } = fake(options);
    const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
    const text = JSON.stringify(await body(response));
    assert.doesNotMatch(text, new RegExp(`${USER}/|${NEW_ID}|42501|53300|permission denied|service_role`));
    assertPrivate(response);
  }
});
test("database codes map like the Web route", () => {
  assert.equal(mapDbCode("53300").status, 429);
  assert.equal(mapDbCode("42501").status, 403);
  assert.equal(mapDbCode("PGRST301").status, 403);
  assert.equal(mapDbCode("P0002").status, 404);
  assert.equal(mapDbCode("23505").status, 409);
  assert.equal(mapDbCode("P0001").status, 409);
  assert.equal(mapDbCode("22023").status, 422);
  assert.equal(mapDbCode(undefined).status, 503);
});
test("the Deno entry point keeps the server key in the environment only", async () => {
  const source = await readFile(
    new URL("../supabase/functions/native-document-upload/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(source, /auth\.getUser\(token\)/);
  assert.doesNotMatch(source, /JSON\.stringify\([^)]*serverKey/);
  assert.doesNotMatch(source, /Response\.json\([^)]*serverKey/);
  // Finalization runs under the user's token, never the server key.
  assert.match(source, /userClient\(token\)\.rpc\(fn, args\)/);
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.doesNotMatch(config, /verify_jwt\s*=\s*false/);
});
