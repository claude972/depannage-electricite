import test from "node:test";
import assert from "node:assert/strict";
import { INVITE_TOKEN, canAccess, membershipRole, monthPeriods, parseHash } from "../../components/app/session";

test("invitation links route to a public view and keep only well-formed codes", () => {
  const code = "a".repeat(64);
  const parsed = parseHash(`#join-organization/${code}`);
  assert.equal(parsed.view, "join-organization");
  assert.equal(parsed.param, code);
  assert.equal(canAccess("join-organization", null, "public"), true);
  assert.equal(INVITE_TOKEN.test(code), true);
  assert.equal(INVITE_TOKEN.test("A".repeat(64)), false, "uppercase hex is not accepted by the server");
  assert.equal(INVITE_TOKEN.test("a".repeat(63)), false);
  // Over-long or non-identifier parameters are dropped before they reach a lookup.
  assert.equal(parseHash(`#join-organization/${"a".repeat(121)}`).param, "");
});
test("authority in an organisation comes from membership, never from the global manager role", () => {
  const members = [
    { organization_id: "o1", user_id: "u1", role: "owner" },
    { organization_id: "o1", user_id: "u2", role: "viewer" },
    { organization_id: "o2", user_id: "u2", role: "manager" },
  ];
  assert.equal(membershipRole(members, "o1", "u1"), "owner");
  assert.equal(membershipRole(members, "o1", "u2"), "viewer");
  assert.equal(membershipRole(members, "o2", "u1"), null);
  assert.equal(membershipRole(members, "o1", "u3"), null);
});
test("performance periods are contiguous calendar months with exclusive end", () => {
  const p = monthPeriods(new Date(2026, 2, 15, 12));
  assert.equal(p.previous_end, p.current_start);
  assert.equal(new Date(p.current_start).getDate(), 1);
  assert.equal(new Date(p.current_end).getMonth(), 3);
  assert.equal(new Date(p.previous_start).getMonth(), 1);
  const days = (Date.parse(p.current_end) - Date.parse(p.current_start)) / 86400000;
  assert.ok(days >= 28 && days <= 31);
});
test("the sole organisation is the membership context without an explicit selection; several require a choice", async () => {
  const { enterpriseContext } = await import("../../components/app/session");
  const members = [{ organization_id: "o1", user_id: "u1", role: "owner" }];
  const sole = enterpriseContext([{ id: "o1" }], [], [], "", "").organizationId;
  assert.equal(membershipRole(members, sole, "u1"), "owner");
  const several = enterpriseContext([{ id: "o1" }, { id: "o2" }], [], [], "", "").organizationId;
  assert.equal(membershipRole(members, several, "u1"), null, "no authority until the user chooses");
});
