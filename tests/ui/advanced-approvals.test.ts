// ENT-12 ordered B2B quote approvals (backend 05cc515; strict browser copy). Real model + SSR of the
// real panels + the enterprise timeline model; real-app enterprise wiring in demo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import { withApp, skip } from "./real-app-harness";
import type * as Model from "../../components/features/advanced-approvals/model";
import type * as TL from "../../components/features/enterprise-timeline/timeline-model";

const m = loadModule("components/features/advanced-approvals/model.ts") as unknown as typeof Model;
const ui = loadModule("components/features/advanced-approvals/approvals.tsx") as Record<string, any>;
const tl = loadModule("components/features/enterprise-timeline/timeline-model.ts") as unknown as typeof TL;
const priv = loadModule("components/app/private-storage.ts") as { PRIVATE_STORAGE_PREFIXES: readonly string[] };
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const U = (p: string, n: number) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = U("1", 1), SITE = U("5", 1), QUOTE = U("3", 1), NAMED = U("1", 7);
const AT = "2026-11-07T10:00:00.000Z";
const policy = { version: 2, enabled: true, threshold_cents: 50000, steps: [{ role: "manager" }, { user_id: NAMED }, { role: "owner" }] };
const wf = (over: Record<string, unknown> = {}) => ({ version: 4, policy_version: 2, state: "pending", current_step: 2, steps: policy.steps, snapshot_matches: true, ...over });
const status = (over: Record<string, unknown> = {}) => ({ quote_id: QUOTE, site_id: SITE, required: true, approved_current: false, policy, workflow: wf(), permissions: { can_submit: false, can_decide: false, can_respond: false }, events: [{ version: 1, actor_id: USER, action: "submit", note: "", created_at: AT }, { version: 2, actor_id: U("1", 2), action: "approve", note: "OK", created_at: AT }], next_after: null, ...over });
const res = (s: number, body: unknown = null) => ({ status: s, body });
const ctx = { generation: () => 0, userId: () => USER };

test("lecture stricte : portée, ordre des événements, pagination, étape courante ≤ nombre d’étapes ; reçus par action", () => {
  assert.ok(m.parseWorkflowStatus(status(), QUOTE, 0));
  for (const bad of [{ ...status(), extra: 1 }, status({ quote_id: U("3", 9) }), status({ events: [{ version: 2, actor_id: USER, action: "submit", note: "", created_at: AT }, { version: 1, actor_id: USER, action: "approve", note: "", created_at: AT }] }), status({ next_after: 2 }), status({ workflow: wf({ current_step: 4 }) }), status({ workflow: wf({ state: "accepted" }) }), status({ policy: { ...policy, steps: [{ role: "owner", user_id: NAMED }] } })])
    assert.equal(m.parseWorkflowStatus(bad, QUOTE, 0), null, JSON.stringify(bad).slice(0, 80));
  assert.equal(m.parseWorkflowStatus(status(), QUOTE, 1), null, "events must be after the cursor");
  assert.ok(m.parsePolicyStatus({ site_id: SITE, policy, can_manage: true }, SITE));
  assert.equal(m.parsePolicyStatus({ site_id: SITE, policy: { ...policy, threshold_cents: -1 }, can_manage: true }, SITE), null);
  const approve = m.buildAction("approve", "", U("c", 1), 4)!;
  for (const [st, ok] of [["pending", true], ["approved", true], ["rejected", false]] as const) same(!!m.parseWorkflowReceipt({ quote_id: QUOTE, version: 5, state: st, current_step: 3, replayed: false }, QUOTE, approve), ok, st);
  assert.equal(m.parseWorkflowReceipt({ quote_id: QUOTE, version: 6, state: "pending", current_step: 3, replayed: false }, QUOTE, approve), null, "exact version");
  same([m.buildAction("reject", "  ", U("c", 1), 4), m.buildAction("request_information", "", U("c", 1), 4), m.buildAction("respond", "", U("c", 1), 4)], [null, null, null], "note required");
  same(m.buildAction("submit", " Merci ", U("c", 1), null), { command_id: U("c", 1), expected_version: null, action: "submit", note: "Merci" });
  same(m.buildPolicy({ enabled: true, threshold: "500,00", steps: policy.steps as Model.Step[] }, U("c", 2), null)?.threshold_cents, 50000);
  same([m.buildPolicy({ enabled: true, threshold: "abc", steps: [{ role: "owner" }] }, U("c", 2), null), m.buildPolicy({ enabled: true, threshold: "1", steps: [] }, U("c", 2), null)], [null, null]);
  assert.ok(priv.PRIVATE_STORAGE_PREFIXES.some((p) => m.pendingKey(USER, 0, `quote:${QUOTE}`).startsWith(p)));
});

test("chaîne ordonnée telle que dite par le serveur ; étapes suivantes verrouillées ; frise de l’entreprise cohérente ; acceptation bloquée", () => {
  const status3 = (o: Record<string, unknown>) => m.chain(m.parseWorkflowStatus(status({ workflow: wf(o) }), QUOTE, 0)!.workflow!).map((v) => v.status);
  same(status3({}), ["done", "current", "locked"]);
  same(status3({ state: "changes_requested" }), ["done", "changes_requested", "locked"]);
  same(status3({ state: "rejected", current_step: 1 }), ["rejected", "locked", "locked"]);
  same(status3({ state: "approved", current_step: 3 }), ["approved", "approved", "approved"]);
  const step = (s: Model.WorkflowStatus) => tl.buildTimeline({ intervention: { status: "quoted", created_at: AT }, approval: m.timelineApproval(s) ?? null, ruleApplies: true }).find((x) => x.key === "approval")!;
  same(step(m.parseWorkflowStatus(status(), QUOTE, 0)!).state, "current");
  same(step(m.parseWorkflowStatus(status({ workflow: wf({ state: "rejected" }) }), QUOTE, 0)!).detail, "Devis refusé par l’approbateur : il ne peut pas être accepté.");
  same(step(m.parseWorkflowStatus(status({ approved_current: true, workflow: wf({ state: "approved", current_step: 3 }) }), QUOTE, 0)!).state, "done");
  same(step(m.parseWorkflowStatus(status({ workflow: null }), QUOTE, 0)!).state, "current", "required but not submitted ⇒ pending");
  same(m.timelineApproval(m.parseWorkflowStatus(status({ required: false, workflow: null }), QUOTE, 0)), undefined, "not required ⇒ the simple source stays");
  same(m.timelineApproval(m.parseWorkflowStatus(status({ workflow: wf({ state: "approved", current_step: 3, snapshot_matches: false }) }), QUOTE, 0)), { status: "pending" }, "approval of a stale snapshot is not shown as approved");
  same([m.acceptanceBlocked(m.parseWorkflowStatus(status(), QUOTE, 0)), m.acceptanceBlocked(m.parseWorkflowStatus(status({ approved_current: true }), QUOTE, 0)), m.acceptanceBlocked(undefined)], [true, false, false]);
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
function writer({ posts = [] as ((c: Model.WorkflowCommand) => Model.Result | Promise<Model.Result>)[], store = memStore().store as Model.Store | null, c = { uid: USER as string | null, gen: 0 } } = {}) {
  const calls: { cmd: Model.WorkflowCommand; stored: string | null }[] = [];
  let s: Model.WriterState = { ...m.WRITER_INITIAL };
  let afters = 0, forbidden = 0;
  const scope = `quote:${QUOTE}`;
  const w = m.createWriter<Model.WorkflowCommand>({ scope, schema: m.schemas.workflowCommand as never, post: async (cmd) => (calls.push({ cmd, stored: store?.get(m.pendingKey(c.uid, c.gen, scope)) ?? null }), (posts.shift() ?? (() => res(503)))(cmd)), receipt: (b, cmd) => m.parseWorkflowReceipt(b, QUOTE, cmd), store: () => store, context: { generation: () => c.gen, userId: () => c.uid }, get: () => s, set: (n) => (s = n), after: async () => void afters++, onForbidden: () => void forbidden++, notice: (cmd) => m.ACTION_DONE[cmd.action] });
  return { w, calls, c, get: () => s, afters: () => afters, forbidden: () => forbidden };
}
const receipt = (cmd: Model.WorkflowCommand, state = "pending") => res(200, { quote_id: QUOTE, version: (cmd.expected_version ?? 0) + 1, state, current_step: 3, replayed: false });

test("décision : version EXACTE, écrite et relue AVANT le POST ; périmée (409) ⇒ refus + relecture sans rejeu ; hors ordre (403) ⇒ effacé ; 503 ⇒ même commande", async () => {
  const mem = memStore();
  const a = writer({ store: mem.store, posts: [(cmd) => receipt(cmd)] });
  const approve = m.buildAction("approve", "", U("c", 1), 4)!;
  assert.equal(await a.w.run(approve), true);
  same([a.calls[0].cmd.expected_version, JSON.parse(a.calls[0].stored!).command, mem.map.size, a.afters(), a.get().notice], [4, approve, 0, 1, m.ACTION_DONE.approve]);
  const stale = writer({ posts: [() => res(409)] });
  same([await stale.w.run(approve), stale.get().error, stale.afters(), stale.get().pending], [false, m.COPY.conflict, 1, null]);
  same(await stale.w.retry(), false);
  const order = memStore();
  const out = writer({ store: order.store, posts: [() => res(403)] });
  same([await out.w.run(approve), out.forbidden(), order.map.size], [false, 1, 0], "an out-of-order decision refused by the server clears everything");
  const keep = memStore();
  const r = writer({ store: keep.store, posts: [() => res(m.AP_TIMEOUT), () => res(503)] });
  await r.w.run(approve); await r.w.retry();
  same(r.calls.map((x) => JSON.stringify(x.cmd)), Array(2).fill(JSON.stringify(approve)));
  const back = writer({ store: keep.store, posts: [(cmd) => receipt(cmd)] });
  back.w.restore();
  same([JSON.stringify(back.get().pending), back.calls.length], [JSON.stringify(approve), 0], "restored, never sent by itself");
  for (const store of [null, { get: () => null, set: () => { throw new Error("q"); }, remove: () => {} }, { get: () => "x", set: () => {}, remove: () => {} }] as (Model.Store | null)[]) {
    const x = writer({ store });
    same([await x.w.run(approve), x.calls.length, x.get().error], [false, 0, m.COPY.storage]);
  }
  let release!: (v: Model.Result) => void;
  const g = writer({ posts: [() => new Promise((rr) => (release = rr))] });
  const p = g.w.run(approve);
  g.c.gen = 1;
  release(receipt(approve));
  same([await p, g.afters(), g.get().notice], [false, 0, ""]);
  const u = writer({ posts: [() => res(503)] });
  await u.w.run(approve);
  u.c.uid = U("1", 2);
  same([await u.w.retry(), u.get().pending, u.calls.length], [false, null, 1]);
});

test("rendus : lecture seule sans action ; approbateur courant (version exacte) ; complément ⇒ réponse ; politique éditable seulement avec can_manage ; démo sans appel", () => {
  const panel = (s: Record<string, unknown>) => renderToString(createElement(ui.QuoteApprovalPanel, { quoteId: QUOTE, context: ctx, initial: m.parseWorkflowStatus(status(s), QUOTE, 0) }));
  const ro = panel({});
  assert.match(text(ro), /Étape 1 · Gestionnaire du site Approuvée Étape 2 · Membre 10000000 En attente de décision Étape 3 · Propriétaire de l’organisation Verrouillée \(étape précédente non terminée\)/);
  assert.match(ro, /data-ap-readonly=""/);
  assert.doesNotMatch(ro, /data-ap-action/);
  const decider = panel({ permissions: { can_submit: false, can_decide: true, can_respond: false } });
  for (const a of ["approve", "reject", "request_information"]) assert.match(decider, new RegExp(`data-ap-action="${a}"`));
  assert.doesNotMatch(decider, /data-ap-action="respond"|data-ap-action="submit"/);
  const info = panel({ workflow: wf({ state: "changes_requested" }), permissions: { can_submit: false, can_decide: true, can_respond: true } });
  assert.match(info, /data-ap-action="respond"/);
  assert.doesNotMatch(info, /data-ap-action="approve"/, "a suspended step is not decided");
  assert.match(text(panel({ workflow: wf({ snapshot_matches: false }) })), /une nouvelle soumission est nécessaire/);
  assert.match(text(panel({ workflow: null })), /le devis n’a pas encore été soumis au circuit/);
  assert.match(text(panel({ approved_current: true, workflow: wf({ state: "approved", current_step: 3 }) })), /Ce n’est pas une acceptation/);
  const pol = (canManage: boolean) => renderToString(createElement(ui.SitePolicyPanel, { siteId: SITE, context: ctx, initial: m.parsePolicyStatus({ site_id: SITE, policy, can_manage: canManage }, SITE) }));
  assert.match(text(pol(false)), /Actif · au-delà de 500,00\s€ TTC · version 2/);
  assert.doesNotMatch(pol(false), /data-ap-policy-form/);
  assert.match(pol(true), /data-ap-policy-form=""/);
  let calls = 0;
  const api = { policy: async () => (calls++, res(200)), setPolicy: async () => (calls++, res(200)), workflow: async () => (calls++, res(200)), act: async () => (calls++, res(200)) };
  assert.match(renderToString(createElement(ui.QuoteApprovalPanel, { quoteId: QUOTE, context: ctx, demo: true, api })), /aucun circuit d’approbation n’est lu ni modifié/);
  renderToString(createElement(ui.SitePolicyPanel, { siteId: SITE, context: ctx, demo: true, api }));
  same(calls, 0);
});

test("câblage entreprise : chaîne du devis affiché, acceptation bloquée, frise, politique du site, emplacement des rappels ; app réelle démo sans appel /api", { skip }, async () => {
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(src, /<QuoteApprovalPanel\s+key=\{displayed\.id\}\s+quoteId=\{displayed\.id\}\s+context=\{session\.mutationContext\}\s+demo=\{demo\}\s+onStatus=\{setAdvanced\}/);
  assert.match(src, /const blocking = Boolean\(approval && approval\.status !== "approved"\) \|\| advancedBlocked;/);
  assert.match(src, /approval: advancedApproval \?\? timelineApproval,/);
  assert.match(src, /<SitePolicyPanel\s+siteId=\{site\.id\}/);
  // The reserved spot is now filled by the compliance reminder panel, above « Échéances & conformité » rows.
  assert.doesNotMatch(src, /MOUNT POINT \(reserved\)/);
  assert.match(src, /<ComplianceReminderPanel complianceId=\{r\.id\}/);
  await withApp(async (open) => {
    for (const route of ["manager-detail.demo-001", "manager-site.site-1"]) {
      const { page, errors, api } = await open(route, 390);
      const r = await page.evaluate(() => ({ demo: document.querySelectorAll('[data-ap-quote="demo"], [data-ap-policy="demo"]').length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      assert.ok(r.demo >= 1, `${route}: honest demo note`);
      same([r.overflow <= 0, api, errors], [true, [], []], route);
      await page.context().close();
    }
  });
});
