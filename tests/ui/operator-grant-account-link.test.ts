// ROOT review of b6b89bd: a scope can be granted to any non-admin profile (client, manager or
// artisan), and OperatorGrant only optionally carries the profile role. The account link must
// follow that role exactly: client / manager ⇒ client record, artisan ⇒ artisan record, admin /
// absent / unknown ⇒ plain text (never guessed).
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Ops from "../../components/features/platform-operations/platform-operators-view";

const o = loadModule("components/features/platform-operations/platform-operators-view.tsx") as unknown as typeof Ops;
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const grant = (role?: unknown) => ({ id: "g1", user_id: "10000000-0000-4000-8000-000000000001", full_name: "Compte QA", scope: "finance_read", status: "active", note: "", granted_by: "x", granted_at: "2026-11-07T10:00:00+00:00", revoked_by: null, revoked_at: null, revoke_note: "", ...(role === undefined ? {} : { role }) });

test("cible du compte selon le rôle serveur, jamais devinée", () => {
  assert.deepEqual(json(o.grantAccountTarget(grant("client") as never)), { target: "client", id: grant().user_id });
  assert.deepEqual(json(o.grantAccountTarget(grant("manager") as never)), { target: "client", id: grant().user_id });
  assert.deepEqual(json(o.grantAccountTarget(grant("artisan") as never)), { target: "artisan", id: grant().user_id });
  for (const role of ["admin", undefined, null, "Client", "support", 3]) assert.equal(o.grantAccountTarget(grant(role) as never), null, String(role));
});

test("rendu : lien seulement pour client / gestionnaire / artisan ; texte sinon", () => {
  const render = (role?: unknown) => renderToString(createElement(o.GrantAccount as never, { grant: grant(role), onNavigate: () => {} } as never));
  assert.match(render("client"), /data-grant-open-account="10000000-0000-4000-8000-000000000001"[^>]*data-grant-target="client"/);
  assert.match(render("artisan"), /data-grant-target="artisan"/);
  for (const role of ["admin", undefined, "unknown"]) {
    const html = render(role);
    assert.doesNotMatch(html, /<button|data-grant-open-account/, String(role));
    assert.match(html, /Compte QA/);
  }
});
