// Enterprise dossier chronology: real buildTimeline + SSR of the real component; wiring by source.
// One dossier per real status ⇒ exact step states; dates only when stored; honest « non applicable »
// without an approval rule; read-only (no action at all); tokens-only CSS.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/enterprise-timeline/timeline-model";

const m = loadModule("components/features/enterprise-timeline/timeline-model.ts") as unknown as typeof Model;
const view = loadModule("components/features/enterprise-timeline/enterprise-timeline.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const CREATED = "2026-11-01T09:00:00.000Z";
const base = (status: string, over: Record<string, unknown> = {}): Model.TimelineInput => ({ intervention: { status, created_at: CREATED, completed_at: null, paid_at: null }, approval: null, ruleApplies: false, appointment: null, report: null, payment: null, ...over });
const states = (input: Model.TimelineInput) => m.buildTimeline(input).map((s) => s.state);
const step = (input: Model.TimelineInput, key: Model.StepKey) => m.buildTimeline(input).find((s) => s.key === key)!;
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

test("un dossier par statut ⇒ états exacts (demande → approbation → planification → travaux → réception → règlement)", () => {
  const cases: [string, Model.TimelineInput, Model.StepState[]][] = [
    ["requested", base("requested"), ["current", "not_applicable", "upcoming", "upcoming", "upcoming", "upcoming"]],
    ["requested + règle", base("requested", { ruleApplies: true }), ["current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]],
    ["approbation en attente", base("quoted", { ruleApplies: true, approval: { status: "pending", created_at: CREATED } }), ["done", "current", "upcoming", "upcoming", "upcoming", "upcoming"]],
    ["approbation refusée", base("quoted", { ruleApplies: true, approval: { status: "rejected", decided_at: "2026-11-02T10:00:00.000Z" } }), ["done", "current", "upcoming", "upcoming", "upcoming", "upcoming"]],
    ["approuvé puis accepté", base("accepted", { ruleApplies: true, approval: { status: "approved", decided_at: "2026-11-02T10:00:00.000Z" } }), ["done", "done", "current", "upcoming", "upcoming", "upcoming"]],
    ["assigned + rendez-vous", base("assigned", { appointment: { starts_at: "2026-11-04T08:00:00.000Z" } }), ["current", "not_applicable", "upcoming", "upcoming", "upcoming", "upcoming"]],
    ["accepted + rendez-vous", base("accepted", { appointment: { starts_at: "2026-11-04T08:00:00.000Z" } }), ["done", "not_applicable", "current", "upcoming", "upcoming", "upcoming"]],
    ["in_progress", base("in_progress", { appointment: { starts_at: "2026-11-04T08:00:00.000Z" } }), ["done", "not_applicable", "done", "current", "upcoming", "upcoming"]],
    ["completed", base("completed", { appointment: { starts_at: "2026-11-04T08:00:00.000Z" }, report: { updated_at: "2026-11-04T11:00:00.000Z" }, intervention: { status: "completed", created_at: CREATED, completed_at: "2026-11-04T11:30:00.000Z" } }), ["done", "not_applicable", "done", "done", "done", "current"]],
    ["paid", base("paid", { appointment: { starts_at: "2026-11-04T08:00:00.000Z" }, intervention: { status: "paid", created_at: CREATED, completed_at: "2026-11-04T11:30:00.000Z", paid_at: "2026-11-05T09:00:00.000Z" } }), ["done", "not_applicable", "done", "done", "done", "done"]],
    ["cancelled", base("cancelled", { ruleApplies: true, approval: { status: "pending" } }), ["done", "not_applicable", "not_applicable", "not_applicable", "not_applicable", "not_applicable"]],
  ];
  for (const [name, input, expected] of cases) {
    same(states(input), expected, name);
    const current = m.buildTimeline(input).filter((s) => s.state === "current").length;
    assert.ok(current <= 1, `${name}: at most one current step`);
  }
  same(m.buildTimeline(base("paid")).map((s) => s.key), ["request", "approval", "planning", "works", "reception", "payment"]);
  assert.match(step(base("accepted"), "approval").detail, /Aucune règle d’approbation sur ce site : non applicable/);
  assert.match(step(base("accepted", { ruleApplies: true }), "approval").detail, /Aucune approbation demandée pour ce devis/);
  for (const [status, detail] of [["pending", /en attente de confirmation : non réglé/], ["failed", /Paiement échoué/]] as const)
    assert.match(step(base("completed", { payment: { status } }), "payment").detail, detail);
  assert.equal(step(base("completed", { payment: { status: "pending", paid_at: "2026-11-05T09:00:00.000Z" } }), "payment").state, "current", "only the dossier status says paid");
});

test("dates : seulement les dates enregistrées, jamais inventées", () => {
  const none = m.buildTimeline(base("paid"));
  same(none.map((s) => s.date), [CREATED, null, null, null, null, null], "paid without stored dates shows no date");
  const accepted = base("accepted", { ruleApplies: true, approval: { status: "approved", decided_at: null }, appointment: null });
  same(m.buildTimeline(accepted).map((s) => s.date), [CREATED, null, null, null, null, null]);
  same(step(base("accepted"), "planning").detail, "Créneau à convenir avec l’artisan.");
  same(step(base("accepted", { appointment: undefined }), "planning").detail, "Rendez-vous non chargé.");
  const full = m.buildTimeline(base("paid", { approval: { status: "approved", decided_at: "2026-11-02T10:00:00.000Z" }, appointment: { starts_at: "2026-11-04T08:00:00.000Z" }, report: { updated_at: "2026-11-04T11:00:00.000Z" }, intervention: { status: "paid", created_at: CREATED, completed_at: "2026-11-04T11:30:00.000Z", paid_at: "2026-11-05T09:00:00.000Z" } }));
  same(full.map((s) => s.date), [CREATED, "2026-11-02T10:00:00.000Z", "2026-11-04T08:00:00.000Z", "2026-11-04T11:00:00.000Z", "2026-11-04T11:30:00.000Z", "2026-11-05T09:00:00.000Z"]);
  assert.equal(step(base("in_progress", { report: { updated_at: "not a date" } }), "works").date, null);
  const html = renderToString(createElement(view.EnterpriseTimeline, { steps: m.buildTimeline(base("paid")) }));
  assert.equal((html.match(/data-step-date=""/g) ?? []).length, 1, "only the stored creation date is rendered");
});

test("rendu SSR : chronologie lisible, étape courante annoncée, aucune action (lecture seule)", () => {
  const html = renderToString(createElement(view.EnterpriseTimeline, { steps: m.buildTimeline(base("quoted", { ruleApplies: true, approval: { status: "pending" } })) }));
  const t = text(html);
  assert.match(html, /data-enterprise-timeline=""/);
  assert.match(t, /Chronologie du dossier Demande Terminé .* Approbation En cours Approbation du devis en attente de décision\. Planification À venir/);
  assert.match(html, /data-step="approval" data-state="current" aria-current="step"/);
  assert.doesNotMatch(html, /<button|<a |<input|<select|onClick/);
  const cancelled = text(renderToString(createElement(view.EnterpriseTimeline, { steps: m.buildTimeline(base("cancelled")), cancelled: true })));
  assert.match(cancelled, /Dossier annulé\. Aucune étape supplémentaire/);
  assert.match(cancelled, /Règlement Non applicable Dossier annulé : étape non réalisée\./);
});

test("câblage : dérivé des données de la vue (aucun chargement), ancien suivi remplacé, jetons uniquement", () => {
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(src, /<EnterpriseTimeline steps=\{timeline\} cancelled=\{intervention\.status === "cancelled"\} \/>/);
  assert.match(src, /appointment: opsLoading \|\| !ops \? undefined : ops\.appointment,/);
  assert.match(src, /ruleApplies: c\.scope\.rules\.some\(\(r\) => r\.site_id === intervention\.site_id && r\.enabled\),/);
  assert.doesNotMatch(src, /const TIMELINE|reachedIndex/);
  const leaf = readFileSync("components/features/enterprise-timeline/enterprise-timeline.tsx", "utf8") + readFileSync("components/features/enterprise-timeline/timeline-model.ts", "utf8");
  assert.doesNotMatch(leaf, /fetch\(|useEffect|session\./, "props only, no loading");
  const css = readFileSync("components/features/enterprise-timeline/enterprise-timeline.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb|hsl/i);
  assert.match(css, /@media \(max-width: 390px\)/);
});
