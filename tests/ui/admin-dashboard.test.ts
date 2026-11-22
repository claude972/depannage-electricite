// ADM-01 admin dashboard snapshot (mirror of lib/features/admin-dashboard/handler.ts): strict parser
// with the handler's consistency checks; shown only for the current role + identity; wiring rules
// (« Non vérifié » until read, never « aucune … » when the count exceeds the bounded array, account
// date label, demo unchanged); the « Devis & Factures » texts fixed with links to Finance plateforme
// and no financial button.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/admin-dashboard/model";

const m = loadModule("components/features/admin-dashboard/model.ts") as unknown as typeof Model;
const U = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number) => `2026-11-07T10:${String(59 - n).padStart(2, "0")}:00Z`;
export const activeRow = (n: number) => ({ id: U(n), artisan_id: null, category: "panel", city: "Fort-de-France", urgency: "scheduled", status: "requested", created_at: at(n) });
export const pendingRow = (n: number) => ({ id: U(100 + n), full_name: `Artisan ${n}`, company_name: "", application_status: "submitted", account_created_at: at(n) });
export const snap = (o: { interventions?: number; active?: number; pending?: number; a?: number; p?: number } = {}) => {
  const activeCount = o.active ?? 2;
  return {
    counts: { interventions: o.interventions ?? 140, active_interventions: activeCount, pending_applications: o.pending ?? 9 },
    active: Array.from({ length: o.a ?? Math.min(6, activeCount) }, (_, i) => activeRow(i + 1)),
    pending: Array.from({ length: o.p ?? 6 }, (_, i) => pendingRow(i + 1)),
    limit: 6,
    captured_at: "2026-11-07T12:00:00Z",
  };
};

test("lecture stricte : clés exactes, bornes, cohérence compteurs / tableaux, ordre stable", () => {
  assert.ok(m.parseSnapshot(snap()));
  assert.ok(m.parseSnapshot(snap({ active: 12, pending: 9 })));
  assert.ok(m.parseSnapshot(snap({ active: 0, pending: 0, p: 0 })));
  assert.equal(m.parseSnapshot(snap({ active: 12, a: 5 })), null, "active length = min(6, count)");
  assert.equal(m.parseSnapshot(snap({ pending: 2, p: 3 })), null, "pending ≤ count");
  assert.equal(m.parseSnapshot(snap({ interventions: 1, active: 2 })), null, "active ≤ interventions");
  assert.equal(m.parseSnapshot({ ...snap(), limit: 10 }), null);
  assert.equal(m.parseSnapshot({ ...snap(), extra: 1 }), null);
  const s = snap();
  assert.equal(m.parseSnapshot({ ...s, active: [...s.active].reverse() }), null, "newest first");
  assert.equal(m.parseSnapshot({ ...s, pending: [{ ...s.pending[0], phone: "x" }, ...s.pending.slice(1)] }), null, "minimal projection");
  assert.equal(m.parseSnapshot({ ...s, active: [{ ...s.active[0], status: "paid" }, s.active[1]] }), null, "closed statuses excluded");
  assert.equal(m.parseSnapshot({ ...s, pending: [{ ...s.pending[0], application_status: "approved" }, ...s.pending.slice(1)] }), null);
});

test("affiché seulement pour le rôle + l’identité courants, et seulement prêt", () => {
  const d = m.parseSnapshot(snap())!;
  assert.equal(m.shownSnapshot({ ident: "admin|u1|1", phase: "ready", data: d, error: "" }, "admin|u1|1"), d);
  assert.equal(m.shownSnapshot({ ident: "admin|u1|1", phase: "ready", data: d, error: "" }, "admin|u1|2"), null, "no old frame after an identity change");
  assert.equal(m.shownSnapshot({ ident: "admin|u1|1", phase: "ready", data: d, error: "" }, "client|u1|1"), null, "role bound");
  assert.equal(m.shownSnapshot({ ident: "admin|u1|1", phase: "error", data: null, error: "x" }, "admin|u1|1"), null);
});

test("câblage : « Non vérifié » avant lecture, jamais « aucune » si le compteur dépasse le tableau, date du compte, démo inchangée", () => {
  const src = readFileSync("components/role/admin-space.tsx", "utf8");
  assert.match(src, /const dashIdent = `\$\{session\.role\}\|\$\{session\.mutationContext\.userId\(\) \?\? "-"\}\|\$\{session\.mutationContext\.generation\(\)\}`;/);
  assert.match(src, /const dash = useAdminDashboard\(\{ live: !demo, ident: dashIdent \}\);/);
  assert.match(src, /const snap = demo \? null : shownSnapshot\(dash\.view, dashIdent\);/);
  assert.match(src, /snap\.pending\.length === 0 && snap\.counts\.pending_applications === 0 \? \(\s*<Empty icon="shield" title="Aucune candidature soumise">/);
  assert.match(src, /snap\.active\.length === 0 && snap\.counts\.active_interventions === 0 \? \(\s*<Empty icon="list" title="Aucune intervention en cours">/);
  assert.match(src, /label: DASH_COPY\.accountDate, render: \(a\) => date\(a\.account_created_at\)/);
  assert.equal(m.COPY.accountDate, "Compte créé le");
  assert.doesNotMatch(src.slice(src.indexOf("const renderDashboard"), src.indexOf("// Server-paginated directory")), /soumise le/i);
});

test("« Devis & Factures » : textes vrais + liens vers Finance plateforme (si autorisé), aucun bouton financier", () => {
  const src = readFileSync("components/role/admin-space.tsx", "utf8");
  assert.doesNotMatch(src, /Un remboursement se fait directement dans Stripe/);
  assert.doesNotMatch(src, /Aucun montant de commission n’est calculé ni affiché/);
  assert.match(src, /Remboursements, litiges et commissions : ces actions se traitent dans l’espace « Finance plateforme »/);
  assert.match(src, /\{platformViewAllowed\(session\.platformAccess, "platform-finance"\) \? \(\s*<p className="inline-note" data-admin-finance-links="">\s*<a className=\{styles\.inlineLink\} href="#platform-finance">Remboursements et litiges : espace Finance plateforme<\/a>/);
  assert.match(src, /<a className=\{styles\.inlineLink\} href="#platform-finance">Commissions : espace Finance plateforme<\/a>/);
  assert.match(src, /data-admin-finance-neutral="">L’accès à l’espace Finance plateforme dépend des habilitations accordées à votre compte\./);
  const block = src.slice(src.indexOf('data-admin-finance-moved'), src.indexOf('data-admin-finance-neutral'));
  assert.doesNotMatch(block, /<button/);
});
