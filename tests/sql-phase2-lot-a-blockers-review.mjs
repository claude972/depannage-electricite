import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { actor, assignee, requester, asUser, dispatchSecret, freshDatabase, serviceKey, withNext } from "./phase2-lot-a-http-harness.mjs";

test("E01 — independent revision-zero assign and escalate return 200 and record one exact audit each", async () => {
  const db = await freshDatabase();
  try {
    for (const user of [actor, assignee, requester])
      await db.query("insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values($1, $2, now(), $3)", [
        user.id, user.email, { role: "client", full_name: "Compte de recette" },
      ]);
    const admin = { id: randomUUID() };
    await db.query("insert into auth.users(id) values($1)", [admin.id]);
    await db.query("update public.profiles set role = 'admin' where id = $1", [admin.id]);
    for (const user of [actor, assignee])
      for (const scope of ["support_read", "support_status"])
        await asUser(db, admin, "select public.platform_grant_scope($1,$2,$3) v", [user.id, scope, "Fixture triage"]);

    const commands = [];
    for (const action of [{ action: "assign", assigned_to: assignee.id }, { action: "set_escalated", escalated: true }]) {
      const created = await asUser(db, requester, "select public.create_support_ticket($1,$2,$3,null) v", [
        randomUUID(), "Triage de recette", "Signalement synthétique pour reproduction.",
      ]);
      commands.push({ ...action, ticket_id: created.ticket.id, expected_version: 0, command_id: randomUUID(), reason: "Motif de recette" });
    }

    await withNext(db, async (http, rejectedSql) => {
      const observed = [];
      for (const command of commands) {
        const response = await http("/api/support/triage", { method: "POST", body: JSON.stringify(command) });
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        observed.push({ status: response.status, body: await response.json() });
      }
      assert.deepEqual(observed.map(entry => entry.status), [200, 200], JSON.stringify({ rejectedSql, observed }));
      for (const [{ body }, command] of observed.map((entry, index) => [entry, commands[index]])) {
        assert.equal(body.triage.ticket_id, command.ticket_id);
        assert.equal(body.triage.version, 1);
        assert.equal(body.replayed, false);
        const audits = (await db.query(
          "select actor_id, action, target_kind, details from public.platform_audit where target_id=$1", [command.ticket_id],
        )).rows;
        assert.deepEqual(audits, [{ actor_id: actor.id, action: "support_triage_changed", target_kind: "support_ticket",
          details: { command_id: command.command_id, action: command.action, version: 1 } }]);
      }
    });
  } finally {
    await db.close();
  }
});

test("E28 — the first warranty policy is readable and can be saved through HTTP", async () => {
  const db = await freshDatabase();
  try {
    await db.query("insert into auth.users(id) values($1)", [actor.id]);
    await db.query("update public.profiles set role = 'admin' where id = $1", [actor.id]);
    const route = "/api/admin/warranty-policy";
    await withNext(db, async http => {
      const initial = await http(route);
      const saved = await http(route, { method: "POST", body: JSON.stringify({
        action: "save", command_id: randomUUID(), expected_version: 0, title: "Conditions test", body: "Texte de recette.",
      }) });
      assert.deepEqual([initial.status, saved.status], [200, 200]);
      const { version, draft, published, operator_enabled } = await initial.json();
      assert.deepEqual({ version, draft, published, operator_enabled }, {
        version: 0, draft: { title: "", body: "" }, published: null, operator_enabled: false,
      });
      assert.deepEqual(await saved.json(), { version: 1, action: "save", replayed: false });
      const persisted = await asUser(db, actor, "select public.read_warranty_policy_editor() v");
      assert.equal(persisted.version, 1);
      assert.equal(persisted.draft.title, "Conditions test");
    });
  } finally {
    await db.close();
  }
});

test("E74 — actual email and push POST routes accept both scheduler JSON and a bodyless request", async () => {
  const db = await freshDatabase();
  try {
    const vapid = createECDH("prime256v1");
    const vapidPublic = vapid.generateKeys().toString("base64url");
    const vapidPrivate = Buffer.from(vapid.getPrivateKey("hex").padStart(64, "0"), "hex").toString("base64url");
    const browser = createECDH("prime256v1").generateKeys().toString("base64url");
    const site = "https://dispatch.example.test";
    const scope = createHash("sha256").update(JSON.stringify([site, vapidPublic])).digest("hex");
    const session = randomUUID();
    await db.query("insert into auth.users(id, email, email_confirmed_at) values($1, $2, now())", [requester.id, requester.email]);
    await db.query("insert into auth.sessions(id, user_id) values($1, $2)", [session, requester.id]);
    await db.query("insert into public.notification_preferences(user_id, email_enabled, push_enabled) values($1, true, true)", [requester.id]);
    await db.exec("update notification_delivery_private.control set enabled = true");
    await db.query("select public.web_push_enrollment($1,$2,$3,'register',0,$4,$5,$6)", [
      requester.id, session, scope, "https://fcm.googleapis.com/fcm/send/fixture-endpoint", browser, randomBytes(16).toString("base64url"),
    ]);

    await withNext(db, async http => {
      const routes = ["/api/internal/notifications/email", "/api/internal/notifications/push"];
      const authorized = { authorization: "Bearer " + dispatchSecret };
      for (const route of routes) {
        assert.equal((await http(route, { method: "POST" })).status, 403);
        assert.equal((await http(route + "?extra=1", { method: "POST", headers: authorized })).status, 422);
        assert.equal((await http(route, { method: "POST", headers: authorized, body: '{"extra":1}' })).status, 422);
      }
      const attempts = [];
      for (const body of ["{}", undefined]) {
        const notice = (await db.query(
          "insert into public.notifications(recipient_id, kind, title, body, dedupe_key) values($1, 'message_received', 'Test', 'Fixture.', $2) returning id",
          [requester.id, randomUUID()],
        )).rows[0].id;
        const observed = [];
        for (const route of routes) {
          const response = await http(route, { method: "POST", headers: authorized, ...(body === undefined ? {} : { body }) });
          observed.push({ status: response.status, result: await response.json() });
        }
        const outbox = (await db.query(
          "select channel, status, attempts from notification_delivery_private.outbox where notification_id=$1 order by channel", [notice],
        )).rows;
        attempts.push({ observed, outbox });
      }
      assert.deepEqual(attempts.map(({ observed }) => observed.map(entry => entry.status)), [[200, 200], [200, 200]], JSON.stringify(attempts));
      for (const { observed, outbox } of attempts) {
        assert.deepEqual(observed.map(entry => entry.result.accepted), [1, 1]);
        assert.deepEqual(outbox, [{ channel: "email", status: "accepted", attempts: 1 }, { channel: "push", status: "accepted", attempts: 1 }]);
      }
    }, {
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      NOTIFICATION_DELIVERY_SECRET: dispatchSecret,
      NOTIFICATIONS_EMAIL_PROVIDER: "resend",
      NOTIFICATION_RESEND_API_KEY: "re_synthetic_00000000",
      NOTIFICATION_EMAIL_FROM: "fixture@example.test",
      NOTIFICATIONS_PUSH_PROVIDER: "webpush",
      NOTIFICATION_VAPID_PUBLIC_KEY: vapidPublic,
      NOTIFICATION_VAPID_PRIVATE_KEY: vapidPrivate,
      NOTIFICATION_VAPID_SUBJECT: "mailto:fixture@example.test",
      NEXT_PUBLIC_APP_URL: site,
    });
  } finally {
    await db.close();
  }
});
