import test from "node:test";
import assert from "node:assert/strict";
import { ticketAuthorityKey } from "../../components/role/support-lists";

const caps = (support: boolean, support_reply: boolean, support_status: boolean) => ({ support, support_reply, support_status });

test("operator ticket view remounts when /me assistance rights change (revocation, grant, loss of reply)", () => {
  const before = ticketAuthorityKey("t1", "all", caps(true, true, false));
  assert.notEqual(ticketAuthorityKey("t1", "all", caps(true, false, false)), before, "reply revoked → remount, stale can_reply dropped");
  assert.notEqual(ticketAuthorityKey("t1", "all", caps(true, true, true)), before, "status granted → remount, fresh permissions");
  assert.notEqual(ticketAuthorityKey("t1", "all", caps(false, false, false)), before, "read lost → remount");
  assert.notEqual(ticketAuthorityKey("t1", "all", null), before, "no /me reply → remount as unverified");
  assert.equal(ticketAuthorityKey("t1", "all", caps(true, true, false)), before, "same rights → same mount (no needless reload)");
  assert.notEqual(ticketAuthorityKey("t2", "all", caps(true, true, false)), before, "other ticket → other mount");
});

test("requester queue keys on the ticket only (creator rights come with each ticket read)", () => {
  assert.equal(ticketAuthorityKey("t1", "mine", caps(true, true, true)), ticketAuthorityKey("t1", "mine", null));
});
