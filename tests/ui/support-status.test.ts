import test from "node:test";
import assert from "node:assert/strict";
import { demoTicketPermissions, runStatusCommand, statusTargets, SUPPORT_TRANSITIONS } from "../../components/role/support-lists";
import type { SupportCommand, SupportCommandResult } from "../../components/app/types";

const ticket = (status: "open" | "in_progress" | "awaiting_user" | "resolved", version = 7) => ({ status, version });

test("no status control without the server permission; transitions from each state otherwise", () => {
  for (const s of ["open", "in_progress", "awaiting_user", "resolved"] as const) {
    assert.deepEqual(statusTargets(s, false), [], `${s} sans permission`);
    assert.deepEqual(statusTargets(s, true), SUPPORT_TRANSITIONS[s]);
  }
  assert.deepEqual(statusTargets("resolved", true), ["in_progress"], "un ticket résolu peut être rouvert");
});

test("status command: CAS on the exact version, success applies the server ticket/event", async () => {
  const sent: SupportCommand[] = [];
  const send = async (c: SupportCommand): Promise<SupportCommandResult> => {
    sent.push(c);
    return { ok: true, ticket: { status: "in_progress", version: 8 } as never, message: null, event: { id: "e9" } as never };
  };
  const out = await runStatusCommand(send, ticket("resolved"), true, "in_progress");
  assert.deepEqual(sent, [{ action: "set_status", expected_version: 7, status: "in_progress" }]);
  assert.equal(out.kind, "ok");
});

test("status command: 409 is a conflict, other refusals are shown as written, no local guessing", async () => {
  const conflict = await runStatusCommand(async () => ({ ok: false, conflict: true, message: "Version périmée" }), ticket("open"), true, "resolved");
  assert.deepEqual(conflict, { kind: "conflict", message: "Version périmée" });
  const refused = await runStatusCommand(async () => ({ ok: false, conflict: false, message: "Droits retirés" }), ticket("open"), true, "resolved");
  assert.deepEqual(refused, { kind: "refused", message: "Droits retirés" });
});

test("status command: a target not offered (or no permission) sends nothing", async () => {
  let calls = 0;
  const send = async (): Promise<SupportCommandResult> => {
    calls += 1;
    return { ok: false, conflict: false, message: "x" };
  };
  assert.equal((await runStatusCommand(send, ticket("open"), false, "resolved")).kind, "skipped");
  assert.equal((await runStatusCommand(send, ticket("in_progress"), true, "open")).kind, "skipped", "open n’est pas une cible depuis in_progress");
  assert.equal(calls, 0);
});

test("permissions follow the status (read+reply+status): open→resolved closes the reply, resolved→in_progress reopens it", () => {
  const all = { can_reply_all: true, can_set_status_all: true };
  assert.deepEqual(demoTicketPermissions(all, "op", { creator_id: "u1", status: "open" }), { can_reply: true, can_set_status: true });
  assert.deepEqual(demoTicketPermissions(all, "op", { creator_id: "u1", status: "resolved" }), { can_reply: false, can_set_status: true });
  assert.deepEqual(demoTicketPermissions(all, "op", { creator_id: "u1", status: "in_progress" }), { can_reply: true, can_set_status: true });
  // Creator without operator rights keeps the 011 rule: own ticket replyable even resolved, no status.
  const none = { can_reply_all: false, can_set_status_all: false };
  assert.deepEqual(demoTicketPermissions(none, "u1", { creator_id: "u1", status: "resolved" }), { can_reply: true, can_set_status: false });
  assert.deepEqual(demoTicketPermissions(none, "u2", { creator_id: "u1", status: "open" }), { can_reply: false, can_set_status: false });
});
