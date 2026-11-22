import test from "node:test";
import assert from "node:assert/strict";
import { authorLabel, QUEUE_READ_ONLY, supportListView } from "../../components/role/support-lists";
import { operatorViewAllowed } from "../../components/app/features";
import type { SupportMessage } from "../../components/app/types";

const msg = (author_kind: SupportMessage["author_kind"], author_id = "u-other"): SupportMessage =>
  ({ id: "m1", ticket_id: "t1", author_id, author_kind, version: 1, body: "x", created_at: "2026-11-01T00:00:00Z" }) as SupportMessage;

test("author label: own messages are 'Vous'; requester queue never distinguishes admin from operator", () => {
  const me = { viewerId: "u-me", queue: "mine" as const };
  assert.equal(authorLabel(msg("user", "u-me"), me), "Vous");
  assert.equal(authorLabel(msg("operator", "u-me"), me), "Vous");
  assert.equal(authorLabel(msg("admin"), me), "Assistance");
  assert.equal(authorLabel(msg("operator"), me), "Assistance");
  assert.equal(authorLabel(null, me), "Assistance");
});

test("author label in the operator queue: requester / opérateur / assistance, own messages 'Vous'", () => {
  const op = { viewerId: "u-op", queue: "all" as const };
  assert.equal(authorLabel(msg("user"), op), "Demandeur");
  assert.equal(authorLabel(msg("operator"), op), "Opérateur");
  assert.equal(authorLabel(msg("admin"), op), "Assistance");
  assert.equal(authorLabel(msg("operator", "u-op"), op), "Vous");
});

test("queue list view and read-only wording", () => {
  assert.equal(supportListView("mine"), "support");
  assert.equal(supportListView("all"), "support-queue");
  assert.match(QUEUE_READ_ONLY, /Lecture seule/);
  assert.doesNotMatch(QUEUE_READ_ONLY, /rpc|route|\.ts|api\//i, "no internal names");
});

test("assistance queue opens only on the server capability `support` (never on role or write scopes)", () => {
  const caps = { support: false, support_reply: true, support_status: true, operators: false, audit: false, finance: false, reviews_moderation: false, refund_execution: false as const, invoice_rendering: false };
  const base = { super_admin: false, scopes: [], super_admin_count: 1, config: {} } as never;
  assert.equal(operatorViewAllowed(null, "support-queue"), false);
  assert.equal(operatorViewAllowed({ ...(base as object), capabilities: caps } as never, "support-queue"), false, "write scopes alone open nothing");
  assert.equal(operatorViewAllowed({ ...(base as object), capabilities: { ...caps, support: true } } as never, "support-queue"), true);
  // A super admin without the explicit capability flag is NOT auto-admitted here: the server sets support=true for admins itself.
  assert.equal(operatorViewAllowed({ ...(base as object), super_admin: true, capabilities: caps } as never, "support-queue"), false);
});
