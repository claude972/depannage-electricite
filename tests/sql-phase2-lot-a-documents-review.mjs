import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { actor, asUser, freshDatabase, serviceKey, withNext } from "./phase2-lot-a-http-harness.mjs";

test("E53 — retrying a committed site upload returns the exact document without another stored object", async () => {
  const db = await freshDatabase();
  try {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [
      actor.id, actor.email, { role: "manager", full_name: "Gestionnaire de recette" },
    ]);
    const site = await asUser(db, actor, "select to_jsonb(public.create_site('Site QA','office','12 rue du Test',0,null)) v");
    const objects = new Map();
    let loseNextStorageResponse = false;
    const prefix = "/storage/v1/object/intervention-documents/";
    async function handle(request, response, { user, isService, send }) {
      const url = new URL(request.url, "http://127.0.0.1");
      if (user && url.pathname === "/rest/v1/sites") {
        assert.equal(url.searchParams.get("id"), "eq." + site.id);
        const value = await asUser(db, actor, "select jsonb_build_array(jsonb_build_object('id',id,'archived_at',archived_at)) v from public.sites where id=$1", [site.id]);
        send(200, value);
        return true;
      }
      if (user && url.pathname === "/rest/v1/site_documents") {
        const id = url.searchParams.get("id")?.slice(3);
        const value = await asUser(db, actor, `select coalesce(jsonb_agg(doc), '[]'::jsonb) v from (
          select id,site_id,name,mime_type,kind,created_at,version,revision,replaces_id,replaced_at,archived_at
          from public.site_documents where site_id=$1 and id=$2
        ) doc`, [site.id, id]);
        send(200, value);
        return true;
      }
      if (isService && request.method === "POST" && url.pathname.startsWith(prefix)) {
        const path = url.pathname.slice(prefix.length);
        assert.match(path, new RegExp(`^sites/${site.id}/${actor.id}/[0-9a-f-]{36}$`));
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        if (objects.has(path)) { send(409, { statusCode: "409", error: "Duplicate", message: "Already stored" }); return true; }
        objects.set(path, Buffer.concat(chunks));
        await db.query("insert into storage.objects(bucket_id,name) values('intervention-documents',$1)", [path]);
        if (loseNextStorageResponse) {
          loseNextStorageResponse = false;
          send(503, { statusCode: "503", error: "Temporary", message: "Response interrupted" });
        } else send(200, { Key: "intervention-documents/" + path, Id: randomUUID() });
        return true;
      }
      const download = "/storage/v1/object/authenticated/intervention-documents/";
      if (isService && request.method === "GET" && (url.pathname.startsWith(download) || url.pathname.startsWith(prefix))) {
        const path = url.pathname.slice(url.pathname.startsWith(download) ? download.length : prefix.length);
        const bytes = objects.get(path);
        assert.ok(bytes, "Only an exact fixture upload can be read");
        response.writeHead(200, { "Content-Type": "application/pdf" });
        response.end(bytes);
        return true;
      }
      return false;
    }

    await withNext(db, async (http, rejectedSql) => {
      const id = randomUUID();
      const post = (commandId, suffix = "", replaces = null) => {
        const data = new FormData();
        data.set("file", new File(["%PDF-1.4\nFixture de recette\n" + suffix], "preuve.pdf", { type: "application/pdf" }));
        data.set("kind", "compliance");
        if (commandId) data.set("command_id", commandId);
        if (replaces) data.set("replaces_id", replaces);
        return http(`/api/sites/${site.id}/documents`, { method: "POST", body: data });
      };
      const keyed = await post(id);
      const first = keyed.ok ? keyed : await post();
      assert.equal(first.status, 201, JSON.stringify({ keyed: await keyed.clone().json(), fallback: await first.clone().json(), rejectedSql }));
      const initial = await first.json(); // response observed by the proxy, not used by the sender
      const second = await post(keyed.ok ? id : undefined);
      assert.equal(second.status, 201, JSON.stringify(await second.clone().json()));
      const count = (await db.query("select count(*)::int n from public.site_documents where site_id=$1", [site.id])).rows[0].n;
      assert.deepEqual([keyed.status, count, objects.size], [201, 1, 1]);
      assert.deepEqual(await second.json(), initial);
      assert.equal(initial.document.id, id);
      assert.equal((await post(id, "different bytes")).status, 409);
      assert.equal((await post()).status, 422);

      const interrupted = randomUUID();
      loseNextStorageResponse = true;
      assert.equal((await post(interrupted)).status, 502);
      assert.equal((await db.query("select count(*)::int n from public.site_documents where id=$1", [interrupted])).rows[0].n, 0);
      assert.equal(objects.size, 2);
      assert.equal((await post(interrupted, "different bytes")).status, 409);
      const resumed = await post(interrupted);
      assert.equal(resumed.status, 201, JSON.stringify(await resumed.clone().json()));
      assert.equal((await resumed.json()).document.id, interrupted);
      assert.equal(objects.size, 2);

      const replacement = randomUUID();
      const replaced = await post(replacement, "new version", id);
      assert.equal(replaced.status, 201, JSON.stringify(await replaced.clone().json()));
      const replacementReceipt = await replaced.json();
      assert.equal(replacementReceipt.document.version, 2);
      assert.equal(replacementReceipt.document.replaces_id, id);
      const retriedReplacement = await post(replacement, "new version", id);
      assert.equal(retriedReplacement.status, 201);
      assert.deepEqual(await retriedReplacement.json(), replacementReceipt);
      assert.deepEqual(await (await post(id)).json(), initial);
      assert.equal(objects.size, 3);
    }, { SUPABASE_SERVICE_ROLE_KEY: serviceKey }, { handle, compositeRpcs: new Set(["site_document_upload_command"]), rpcAllowlist: new Set([
      "can_manage_site", "check_upload_limit", "finalize_site_document_upload", "site_document_upload_command",
    ]) });
  } finally {
    await db.close();
  }
});
