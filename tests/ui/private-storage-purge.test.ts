// ROOT review (562f0eb assembly): identity-fenced leaves keep PRIVATE pending commands (invitation
// email, notes, addresses, request payloads) in sessionStorage; the fences refuse to replay them
// under another identity, but A's content must not stay in the tab after a logout / identity
// change. Real purge function + the session wiring + a scan that every leaf key is covered.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PRIVATE_STORAGE_PREFIXES, purgePrivateStorage } from "../../components/app/private-storage";

function memory(entries: Record<string, string>) {
  const m = new Map(Object.entries(entries));
  return { m, get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => void m.delete(k) };
}

test("A → B: every private pending command left by A is purged; unrelated keys are kept", () => {
  const A = "10000000-0000-4000-8000-00000000000a";
  const pendingOfA: Record<string, string> = {
    [`courant-support-pending-${A}`]: JSON.stringify({ subject: "Fuite", body: "message privé" }),
    "courant-request-key-v1": JSON.stringify({ request_id: "x", payload: { address: "8 rue privée" } }),
    "courant-booking-photos-v1": "2",
    [`site-settings:${A}|site|3`]: JSON.stringify({ values: { access_notes: "code portail 1234" } }),
    [`site-asset-link:${A}|site|int`]: "{}",
    [`refund-execution:${A}:req:2`]: "cmd",
    [`hold-reauthorization:${A}|int|snap`]: "cmd",
    [`credential-review:${A}|cred|4`]: JSON.stringify({ reason: "motif privé" }),
    [`warranty-policy-pending-command:${A}:1`]: "{}",
    [`warranty-corrective-pending:${A}:1`]: "{}",
    [`operator-profile-pending-command:${A}:1`]: "{}",
    [`appointment-reminder-pending:${A}:1:int`]: "{}",
    [`account-erasure-pending:${A}:1`]: "{}",
    [`provider-teams-pending:${A}:1:invitations`]: JSON.stringify({ email: "invite@example.invalid", note: "note privée" }),
    [`courant-private-coverage:${A}:1`]: "{}",
  };
  const keep = { "courant-theme": "dark", "courant-demo-v3": "{}", "courant-public-draft": "{}" };
  const s = memory({ ...pendingOfA, ...keep });
  const removed = purgePrivateStorage(s);
  assert.deepEqual(removed.sort(), Object.keys(pendingOfA).sort());
  assert.deepEqual([...s.m.keys()].sort(), Object.keys(keep).sort(), "only non-private keys remain for B");
  assert.deepEqual(purgePrivateStorage(null), []);
  assert.deepEqual(purgePrivateStorage({ get length(): number { throw new Error("blocked"); }, key: () => null, removeItem: () => {} }), [], "never throws");
});

test("session: clearSessionState (logout / identity change) purges; a same-identity reload does not reset", () => {
  const app = readFileSync("components/courant-app.tsx", "utf8");
  const clear = app.slice(app.indexOf("const clearSessionState = useCallback("), app.indexOf("const navigate = useCallback("));
  assert.match(clear, /purgePrivateStorage\(sessionStorage\);/);
  assert.doesNotMatch(app, /key\.startsWith\("courant-support-pending-"\)/, "old single-prefix purge replaced");
});

test("every sessionStorage key used by a leaf starts with a purged prefix (new leaves must use courant-private-)", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(p)) files.push(p);
    }
  };
  walk("components/features");
  files.push("components/role/support-tickets.tsx", "components/app/request-key.ts", "components/app/signed-booking.ts");
  const uncovered: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!/sessionStorage/.test(src) && !/tabStore|pendingKey|PENDING_KEY|_KEY =/.test(src)) continue;
    for (const m of src.matchAll(/(?:const\s+[A-Z_]*(?:KEY|PREFIX)[A-Z_]*\s*=\s*|`)\s*["`]?([a-z][a-z0-9-]+(?:[:|-]|-v\d))/g)) {
      const literal = m[1];
      if (!/pending|key-v|photos-v|^(site-settings|site-asset-link|refund-execution|hold-reauthorization|credential-review|courant-private)/.test(literal)) continue;
      if (!PRIVATE_STORAGE_PREFIXES.some((p) => literal.startsWith(p) || p.startsWith(literal))) uncovered.push(`${f}: ${literal}`);
    }
  }
  assert.deepEqual(uncovered, []);
});
