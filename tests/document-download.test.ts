import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "./documents/harness";

const DOCUMENT = "10000000-0000-4000-8000-000000000001";
const base = "https://documents.example.test";
const objectPath = "owner/document";
// Deliberately fake public URL; no Auth or Storage credential is read or used.
const signedUrl = `${base}/storage/v1/object/sign/intervention-documents/${objectPath}?token=opaque-test-value`;
const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
after(() => { if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl; });
type Result = { data: unknown; error: { code?: string } | null };
function setup(options: { anonymous?: boolean; metadata?: Result | "throw"; signed?: unknown | "throw"; list?: Result } = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = base;
  const calls: { name: string; args?: unknown }[] = [];
  const db = {
    from: (table: string) => {
      calls.push({ name: "table", args: table });
      return { select: (fields: string) => {
        calls.push({ name: "select", args: fields });
        return {
          eq: (key: string, id: string) => ({ maybeSingle: async () => {
            calls.push({ name: "metadata", args: { key, id } });
            if (options.metadata === "throw") throw new Error("private database detail");
            return options.metadata ?? { data: { path: objectPath }, error: null };
          } }),
          order: () => ({ limit: async (limit: number) => {
            calls.push({ name: "list", args: limit });
            return options.list ?? { data: [{ id: DOCUMENT, name: "Photo" }], error: null };
          } }),
        };
      } };
    },
    storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string, seconds: number) => {
      calls.push({ name: "sign", args: { bucket, path, seconds } });
      if (options.signed === "throw") throw new Error("private storage detail");
      return options.signed === undefined ? { data: { signedUrl }, error: null } : options.signed;
    } }) },
  };
  const route = loadModule("app/api/documents/route.ts", { "@/lib/supabase/server": fakeServerHelpers({ db, authenticated: !options.anonymous }) });
  const get = (query = `?id=${DOCUMENT}`) => (route.GET as (r: Request) => Promise<Response>)(new Request(`https://app.example.test/api/documents${query}`));
  return { calls, get };
}
async function body(response: Response) {
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const value = await response.json();
  assert.ok(!JSON.stringify(value).includes("private database detail"));
  assert.ok(!JSON.stringify(value).includes("private storage detail"));
  return value;
}
async function unavailable(response: Response) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "2");
  const value = await body(response);
  assert.deepEqual(Object.keys(value), ["error"]);
}

test("document signing uses the authenticated metadata, exact bucket and60s; response exposes only the provider URL", async () => {
  const h = setup(); const response = await h.get();
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { url: signedUrl });
  assert.deepEqual(h.calls.find(c => c.name === "sign")?.args, { bucket: "intervention-documents", path: objectPath, seconds: 60 });
  assert.equal(h.calls.filter(c => c.name === "sign").length, 1);
});
test("hidden and absent document metadata return the same404 without any signing attempt", async () => {
  const hidden = setup({ metadata: { data: null, error: null } });
  const absent = setup({ metadata: { data: null, error: null } });
  const a = await hidden.get(), b = await absent.get();
  assert.equal(a.status, 404); assert.equal(b.status, 404);
  assert.deepEqual(await body(a), await body(b));
  assert.ok(![...hidden.calls, ...absent.calls].some(c => c.name === "sign"));
});
test("a true metadata error or malformed envelope is unavailable, never a fabricated404 or signing call", async () => {
  for (const metadata of ["throw", { data: null, error: { code: "42501" } },
    ...[undefined, {}, [], { path: null }, { path: "" }, { path: " ../private" }, { path: "owner/../file" }, { path: "owner\\file" }, { path: "owner/\u0000file" }].map(data => ({ data, error: null }))] as const) {
    const h = setup({ metadata }); await unavailable(await h.get());
    assert.equal(h.calls.some(c => c.name === "sign"), false);
  }
});
test("empty or malformed signed provider replies fail closed503 rather than200 with no usable URL", async () => {
  for (const signed of [null, {}, [], { data: null, error: null }, { data: {}, error: null }, { data: { signedUrl: "" }, error: null }, { data: { signedUrl: 1 }, error: null }, { data: { signedUrl: [] }, error: null }]) {
    const h = setup({ signed }); await unavailable(await h.get());
  }
});
test("signed links require HTTPS and the configured provider's exact object path, without rewriting the signed URL", async () => {
  for (const value of ["not a URL", "http://documents.example.test/storage/v1/object/sign/intervention-documents/owner/document", signedUrl.replace(base, "https://foreign.example"), signedUrl.replace("/owner/document", "/owner/other-document"), signedUrl.replace("intervention-documents", "other-bucket"), signedUrl.replace("https://", "https://name:secret@"), signedUrl + "#fragment", " " + signedUrl]) {
    const h = setup({ signed: { data: { signedUrl: value }, error: null } }); await unavailable(await h.get());
  }
});
test("an unavailable Storage call or explicit provider error returns a neutral retryable503", async () => {
  for (const signed of ["throw", { data: null, error: { code: "private storage detail" } }]) {
    const h = setup({ signed }); await unavailable(await h.get());
  }
});
test("a signed link needs exactly one nonempty opaque token parameter", async () => {
  const path = signedUrl.split("?", 1)[0];
  for (const query of ["", "?token=", "?download=file", "?token", "?token=one&token=two", "?token=one&%74oken=two", "?%74oken=one"]) {
    const h = setup({ signed: { data: { signedUrl: path + query }, error: null } });
    await unavailable(await h.get());
  }
});
test("missing public provider configuration never produces an invented signed link", async () => {
  const h = setup(); delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  await unavailable(await h.get()); assert.equal(h.calls.some(c => c.name === "sign"), false);
});
test("unauthenticated requests are401 and invalid document IDs422, with no data or signing requests", async () => {
  const anon = setup({ anonymous: true }); const a = await anon.get("?id=broken"); assert.equal(a.status, 401); await body(a); assert.equal(anon.calls.length, 0);
  const invalid = setup(); const b = await invalid.get("?id=broken"); assert.equal(b.status, 422); await body(b); assert.equal(invalid.calls.length, 0);
});
test("legacy document listing keeps its projection,100-row query and response, with private GET response headers", async () => {
  const h = setup(); const r = await h.get(""); assert.equal(r.status, 200);
  assert.deepEqual(await body(r), { documents: [{ id: DOCUMENT, name: "Photo" }] });
  assert.equal(h.calls.find(c => c.name === "list")?.args, 100);
  assert.equal(h.calls.find(c => c.name === "select")?.args, "id,intervention_id,name,mime_type,created_at");
  assert.equal(h.calls.some(c => c.name === "sign"), false);
});
