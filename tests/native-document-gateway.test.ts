import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  UNCERTAIN_MESSAGE,
  handleNativeDocumentUpload,
  isDefiniteRollback,
  mapDbCode,
  validateFinalizedRow,
  type DocumentRow,
  type FinalizedRow,
  type GatewayDeps,
  type RpcResult,
} from "../supabase/functions/native-document-upload/handler.ts";

const URL_ = "https://project.functions.supabase.co/native-document-upload";
const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const JOB = "00000000-0000-4000-8000-00000000aaaa";
const NEW_ID = "11111111-1111-4111-8111-111111111111";
const CREATED = "2026-10-31T06:00:00Z";
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// What the database returns for a personal JPEG named photo.jpg uploaded by USER.
const personalRow: FinalizedRow = {
  id: NEW_ID,
  path: `${USER}/${NEW_ID}`,
  owner_id: USER,
  name: "photo.jpg",
  mime_type: "image/jpeg",
  intervention_id: null,
  created_at: CREATED,
};
const publicRow: DocumentRow = { id: NEW_ID, name: "photo.jpg", mime_type: "image/jpeg", created_at: CREATED };
type Args = Record<string, unknown> | undefined;
// Echo the finalize arguments back as the committed row, like the SQL function does.
function rowFor(args: Args): FinalizedRow {
  const a = args ?? {};
  return {
    id: String(a.p_id),
    path: String(a.p_path),
    owner_id: USER,
    name: String(a.p_name),
    mime_type: String(a.p_mime),
    intervention_id: (a.p_intervention_id as string | null) ?? null,
    created_at: CREATED,
  };
}

type Calls = {
  authenticated: string[];
  selected: { token: string; id: string }[];
  rpc: { token: string; fn: string; args?: Record<string, unknown> }[];
  put: { path: string; mime: string; size: number }[];
  removed: string[];
  found: string[];
  logged: { message: string; context: { id: string } }[];
};
type RpcEntry = RpcResult<unknown> | ((args: Args) => RpcResult<unknown> | Promise<RpcResult<unknown>>);
type Options = {
  user?: { id: string } | null;
  intervention?: { artisan_id: string | null } | null;
  rpc?: Record<string, RpcEntry>;
  putError?: boolean | "throw";
  existing?: unknown;
  findError?: boolean | "throw";
};
function fake(options: Options = {}): { deps: GatewayDeps; calls: Calls } {
  const calls: Calls = { authenticated: [], selected: [], rpc: [], put: [], removed: [], found: [], logged: [] };
  const rpcTable: Record<string, RpcEntry> = {
    owns_intervention: { data: true, error: null },
    is_admin: { data: false, error: null },
    check_upload_limit: { data: null, error: null },
    finalize_document_upload: (args) => ({ data: rowFor(args), error: null }),
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
      const result = typeof entry === "function" ? await entry(args) : entry;
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
      if (options.findError === "throw") throw new Error("readback failed");
      return {
        row: options.existing ?? null,
        error: options.findError ? { code: "PGRST000", message: "connection refused" } : null,
      };
    },
    randomUUID: () => NEW_ID,
    log(message, context) {
      calls.logged.push({ message, context });
    },
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
  return (await response.json()) as { error?: string; uncertain?: boolean; document?: DocumentRow };
}
function assertPrivate(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}
const ATTEMPT_PATH = `${USER}/${NEW_ID}`;

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
  assert.deepEqual((await body(response)).document, {
    id: NEW_ID,
    name: "x".repeat(160),
    mime_type: "image/png",
    created_at: CREATED,
  });
  assert.deepEqual(calls.put, [{ path: ATTEMPT_PATH, mime: "image/png", size: png.length }]);
  const order = calls.rpc.map((c) => c.fn);
  assert.ok(order.indexOf("check_upload_limit") < order.indexOf("finalize_document_upload"));
  const finalize = calls.rpc.find((c) => c.fn === "finalize_document_upload");
  assert.equal(finalize?.token, "token-user");
  assert.deepEqual(finalize?.args, {
    p_id: NEW_ID,
    p_path: ATTEMPT_PATH,
    p_name: "x".repeat(160),
    p_mime: "image/png",
    p_intervention_id: JOB,
  });
  assert.equal(calls.removed.length, 0);
  assert.equal(calls.found.length, 0);
  assert.equal(calls.logged.length, 0);
});
test("a personal document (no dossier) needs no intervention checks", async () => {
  const { deps, calls } = fake();
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 201);
  assert.deepEqual((await body(response)).document, publicRow);
  assert.equal(calls.selected.length, 0);
  const finalize = calls.rpc.find((c) => c.fn === "finalize_document_upload");
  assert.equal(finalize?.args?.p_intervention_id, null);
});
// GW-REV-002: a truthy but malformed or mismatched row never yields 201.
test("GW-REV-002: malformed or mismatched finalize rows are uncertain (503, object kept, logged without leaking)", async () => {
  const cases: { label: string; data: unknown }[] = [
    { label: "data null without error", data: null },
    { label: "empty object", data: {} },
    { label: "array", data: [] },
    { label: "array with the right row", data: [personalRow] },
    { label: "wrong id", data: { ...personalRow, id: "22222222-2222-4222-8222-222222222222" } },
    { label: "wrong path", data: { ...personalRow, path: `${OTHER}/${NEW_ID}` } },
    { label: "wrong owner", data: { ...personalRow, owner_id: OTHER } },
    { label: "wrong name", data: { ...personalRow, name: "other.jpg" } },
    { label: "wrong mime", data: { ...personalRow, mime_type: "image/png" } },
    { label: "wrong intervention", data: { ...personalRow, intervention_id: JOB } },
    { label: "missing created_at", data: { ...personalRow, created_at: undefined } },
    { label: "created_at not a string", data: { ...personalRow, created_at: 1 } },
    { label: "string", data: "ok" },
  ];
  for (const c of cases) {
    const { deps, calls } = fake({ rpc: { finalize_document_upload: { data: c.data, error: null } } });
    const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
    assert.equal(response.status, 503, c.label);
    const parsed = await body(response);
    assert.equal(parsed.error, UNCERTAIN_MESSAGE, c.label);
    assert.equal(parsed.uncertain, true, c.label);
    assert.equal(parsed.document, undefined, c.label);
    assert.equal(calls.removed.length, 0, `${c.label}: object must be kept`);
    assert.deepEqual(calls.found, [NEW_ID], `${c.label}: readback attempted`);
    if (c.data !== null) {
      assert.equal(calls.logged.length, 1, c.label);
      assert.deepEqual(calls.logged[0].context, { id: NEW_ID });
      assert.doesNotMatch(JSON.stringify(calls.logged), new RegExp(`${USER}|token-user|photo.jpg`), c.label);
    } else assert.equal(calls.logged.length, 0, c.label);
  }
});
test("GW-REV-002: validateFinalizedRow accepts exactly the expected row and drops extra fields", () => {
  const expected = { id: NEW_ID, path: ATTEMPT_PATH, ownerId: USER, name: "photo.jpg", mime: "image/jpeg", interventionId: null };
  assert.deepEqual(validateFinalizedRow({ ...personalRow, extra: "x" }, expected), personalRow);
  assert.deepEqual(validateFinalizedRow({ ...personalRow, intervention_id: undefined }, expected), personalRow);
  assert.equal(validateFinalizedRow(personalRow, { ...expected, interventionId: JOB }), null);
  assert.equal(validateFinalizedRow(null, expected), null);
  assert.equal(validateFinalizedRow([personalRow], expected), null);
  assert.equal(validateFinalizedRow({ ...personalRow, created_at: "" }, expected), null);
});
test("GW-REV-002: a readback row that does not match the attempt is uncertain too", async () => {
  const { deps, calls } = fake({
    rpc: {
      finalize_document_upload: () => {
        throw new Error("fetch failed");
      },
    },
    existing: { ...personalRow, path: `${OTHER}/${NEW_ID}` },
  });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 503);
  assert.equal((await body(response)).uncertain, true);
  assert.equal(calls.removed.length, 0);
  assert.equal(calls.logged.length, 1);
});
test("rights revoked between pre-check and finalization: 403, only this attempt's object removed", async () => {
  const { deps, calls } = fake({
    intervention: { artisan_id: null },
    rpc: { finalize_document_upload: { data: null, error: { code: "42501" } } },
  });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg", { interventionId: JOB }), deps);
  assert.equal(response.status, 403);
  assert.deepEqual(calls.removed, [ATTEMPT_PATH]);
  assert.deepEqual(calls.found, [NEW_ID]);
});
test("missing storage object at finalization is 404 with compensation", async () => {
  const { deps, calls } = fake({ rpc: { finalize_document_upload: { data: null, error: { code: "P0002" } } } });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 404);
  assert.deepEqual(calls.removed, [ATTEMPT_PATH]);
});
test("duplicate id or path at finalization is 409 with compensation", async () => {
  const { deps, calls } = fake({ rpc: { finalize_document_upload: { data: null, error: { code: "23505" } } } });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 409);
  assert.deepEqual(calls.removed, [ATTEMPT_PATH]);
});
test("a lost finalization response with committed metadata returns 201 and deletes nothing", async () => {
  const { deps, calls } = fake({
    rpc: {
      finalize_document_upload: () => {
        throw new Error("fetch failed");
      },
    },
    existing: personalRow,
  });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 201);
  assert.deepEqual((await body(response)).document, publicRow);
  assert.equal(calls.removed.length, 0);
});
test("a transport-level finalization failure is 503 uncertain and the object is kept, even when the readback shows no row", async () => {
  const { deps, calls } = fake({
    rpc: {
      finalize_document_upload: () => {
        throw new Error("fetch failed");
      },
    },
  });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 503);
  const parsed = await body(response);
  assert.equal(parsed.error, UNCERTAIN_MESSAGE);
  assert.equal(parsed.uncertain, true);
  // The transaction may still commit after the readback: a "no row" answer decides nothing.
  assert.equal(calls.removed.length, 0);
});
test("a definitive RPC error whose readback finds a committed row returns 201 and deletes nothing", async () => {
  const { deps, calls } = fake({
    rpc: { finalize_document_upload: { data: null, error: { code: "23505" } } },
    existing: personalRow,
  });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 201);
  assert.deepEqual((await body(response)).document, publicRow);
  assert.equal(calls.removed.length, 0);
});
test("compensation happens only for definitive database errors", async () => {
  for (const code of ["42501", "P0002", "23505", "22023", "53300"]) {
    const { deps, calls } = fake({ rpc: { finalize_document_upload: { data: null, error: { code } } } });
    const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
    assert.ok(response.status >= 400 && response.status !== 503, code);
    assert.deepEqual(calls.removed, [ATTEMPT_PATH], code);
  }
  for (const code of [undefined, "PGRST000", "PGRST504", "57014", "08006"]) {
    const { deps, calls } = fake({ rpc: { finalize_document_upload: { data: null, error: { code } } } });
    const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
    assert.equal(response.status, 503, String(code));
    assert.equal((await body(response)).uncertain, true, String(code));
    assert.equal(calls.removed.length, 0, String(code));
  }
});
test("finalization outcome unknown AND readback unavailable: object kept, explicit uncertain response", async () => {
  for (const findError of [true, "throw"] as const) {
    const { deps, calls } = fake({
      rpc: {
        finalize_document_upload: () => {
          throw new Error("fetch failed");
        },
      },
      findError,
    });
    const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg", { interventionId: JOB }), deps);
    assert.equal(response.status, 503);
    const parsed = await body(response);
    assert.equal(parsed.error, UNCERTAIN_MESSAGE);
    assert.equal(parsed.uncertain, true);
    assert.doesNotMatch(JSON.stringify(parsed), new RegExp(`${USER}/|${NEW_ID}|PGRST|connection refused`));
    assert.deepEqual(calls.found, [NEW_ID]);
    assert.equal(calls.removed.length, 0, "object must be kept when absence is not confirmed");
  }
});
test("an indeterminate finalization with a non-SQL error code is treated like a thrown one", async () => {
  const { deps, calls } = fake({
    rpc: { finalize_document_upload: { data: null, error: { code: "PGRST504", message: "upstream timeout" } } },
    findError: true,
  });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
  assert.equal(response.status, 503);
  assert.equal((await body(response)).uncertain, true);
  assert.equal(calls.removed.length, 0);
});
test("a definite SQL rollback (42501) is compensated even when the readback fails", async () => {
  const { deps, calls } = fake({
    rpc: { finalize_document_upload: { data: null, error: { code: "42501" } } },
    findError: true,
  });
  const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg", { interventionId: JOB }), deps);
  assert.equal(response.status, 403);
  assert.deepEqual(calls.removed, [ATTEMPT_PATH]);
});
test("definite rollback states are exactly the ones finalize_document_upload raises", () => {
  for (const code of ["42501", "P0001", "P0002", "53300", "22023", "22P02", "23505", "23502", "23514"])
    assert.equal(isDefiniteRollback(code), true, code);
  for (const code of [undefined, "network", "PGRST000", "PGRST504", "57014", "08006", "XX000"])
    assert.equal(isDefiniteRollback(code), false, String(code));
});
test("storage upload failure is 503, the attempt path is compensated and finalization is skipped", async () => {
  for (const putError of [true, "throw"] as const) {
    const { deps, calls } = fake({ putError });
    const response = await handleNativeDocumentUpload(upload(jpeg, "image/jpeg"), deps);
    assert.equal(response.status, 503);
    assert.deepEqual(calls.removed, [ATTEMPT_PATH]);
    assert.equal(calls.rpc.filter((c) => c.fn === "finalize_document_upload").length, 0);
  }
});
test("error bodies never expose storage paths, SQL codes or keys", async () => {
  const cases: Options[] = [
    { rpc: { finalize_document_upload: { data: null, error: { code: "42501", message: "permission denied for table documents" } } } },
    { rpc: { check_upload_limit: { data: null, error: { code: "53300", message: "Rate limit exceeded" } } } },
    { rpc: { finalize_document_upload: { data: { ...personalRow, id: OTHER }, error: null } } },
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
  // The metadata readback propagates its error and returns the full row for validation.
  const findDocument = /async findDocument\(id\) \{[\s\S]*?\n    \},/.exec(source)?.[0] ?? "";
  assert.match(findDocument, /const \{ data, error \} = await admin/);
  assert.match(findDocument, /select\("id,intervention_id,owner_id,name,path,mime_type,created_at"\)/);
  assert.match(findDocument, /return \{ row: [^;]*, error \};/);
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.doesNotMatch(config, /verify_jwt\s*=\s*false/);
});
