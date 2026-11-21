import { fileURLToPath as localSourcePath } from "node:url";
// ART-12 provider teams MOUNTED in Chromium (real React root, <StrictMode>, real CSS, fake api
// fixtures per server role): rights matrix rendered from the server role, invitation acceptance,
// internal assignment only on the team's listed (already attributed) missions, technician follow-up
// without finance / documents, 44 px targets, no overflow at 360 px; plus the real-app demo wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { withApp, skip } from "./real-app-harness";

const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProviderTeamsPanel } from "./components/features/provider-teams/provider-teams-panel";
const w = window;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const U = (p, n) => p + "0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const TEAM = U("7", 1), OWNER = U("1", 1), COORD = U("1", 2), TECH = U("1", 5), JOB = U("2", 1), JOB2 = U("2", 2), INV = U("9", 1);
const AT = "2026-11-07T10:00:00.000Z";
const team = (role) => ({ id: TEAM, name: "Équipe Nord", owner_id: OWNER, version: 4, role, active: true });
const members = [{ id: OWNER, full_name: "Alex Martin", role: "owner", active: true, version: 1 }, { id: COORD, full_name: "Chris Coord", role: "coordinator", active: true, version: 1 }, { id: TECH, full_name: "Tom Tech", role: "technician", active: true, version: 1 }];
const missions = (role) => role === "technician"
  ? [{ id: JOB, category: "panel", status: "in_progress", city: "Fort-de-France", assignment: { version: 2, technician_id: TECH, state: "assigned", updated_at: AT } }]
  : [{ id: JOB, category: "panel", status: "in_progress", city: "Fort-de-France", assignment: { version: 2, technician_id: TECH, state: "assigned", updated_at: AT } }, { id: JOB2, category: "socket", status: "accepted", city: "Le Lamentin", assignment: null }];
const mission = { team_id: TEAM, intervention: { id: JOB, category: "panel", status: "in_progress", description: "Le tableau disjoncte à chaque orage.", address: "12 rue des Alizés", postal_code: "97200", city: "Fort-de-France" }, appointment: { starts_at: AT, ends_at: AT }, assignment: { version: 2, technician_id: TECH, state: "assigned", updated_at: AT, note: "" }, permissions: { can_assign: false, can_acknowledge: true, can_complete: false } };
const ok = (body) => Promise.resolve({ status: 200, body });
function setup(role, opts = {}) {
  const audience = opts.audience ?? "artisan";
  const calls = { get: [], post: [], stored: [] };
  const map = new Map();
  const store = () => ({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v), remove: (k) => map.delete(k) });
  let teamsCalls = 0;
  const api = {
    teams: () => (calls.get.push("teams"), teamsCalls++, ok({ records: role === "nobody" || (role === "invitee" && calls.post.length === 0) ? [] : [team(role === "invitee" ? "technician" : role)], next_after: null })),
    invitations: () => (calls.get.push("invitations"), ok({ records: role === "invitee" && calls.post.length === 0 ? [{ id: INV, team_id: TEAM, team_name: "Équipe Nord", role: "technician", expires_at: AT, team_active: true }] : [], next_after: null })),
    team: (id, section) => (calls.get.push("team:" + section), section === "invitations" && role !== "owner" ? Promise.resolve({ status: 403, body: null }) : ok({ team: team(role === "invitee" ? "technician" : role), section, records: section === "members" ? (role === "technician" || role === "invitee" ? [members[2]] : members) : section === "missions" ? missions(role === "invitee" ? "technician" : role) : [{ id: INV, email: "tom@example.test", role: "technician", status: "pending", expires_at: AT, expired: false }], next_after: null })),
    mission: () => (calls.get.push("mission"), ok(mission)),
    send: (cmd) => { calls.post.push(cmd); calls.stored.push([...map.values()][0] ?? null); const c = cmd.body; return ok({ team_id: cmd.kind === "team" ? cmd.teamId : c.team_id, action: c.action, team_version: c.action === "remove_member" ? 5 : 4, entity_id: c.invitation_id ?? c.user_id ?? c.intervention_id ?? TEAM, entity_version: c.action === "assign" ? 1 : null, state: c.action === "accept_invitation" ? "accepted" : c.action === "assign" ? "assigned" : c.action === "remove_member" ? "inactive" : "x", replayed: false }); },
  };
  const div = document.createElement("div"); document.body.appendChild(div);
  createRoot(div).render(h(StrictMode, null, h(ProviderTeamsPanel, { audience, context: { generation: () => 0, userId: () => OWNER }, api, store, newId: () => crypto.randomUUID(), now: () => Date.parse(AT) })));
  return { div, calls };
}
const has = (div, sel) => div.querySelectorAll(sel).length;
const click = async (div, sel) => { const b = div.querySelector(sel); if (b && !b.disabled) b.click(); await tick(150); return !!b; };
const tab = async (div, k) => click(div, '[data-pt-tab="' + k + '"]');
const metrics = (div) => ({ small: [...div.querySelectorAll("button, input, select, textarea")].filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 44 && e.type !== "checkbox").length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth });
w.scenarios = {
  async role(role) {
    const { div, calls } = setup(role);
    await tick(250);
    await click(div, "[data-pt-open]");
    await tick(250);
    const missionsTab = { assign: has(div, "[data-pt-assign]"), unassign: has(div, "[data-pt-unassign]"), techNote: has(div, "[data-pt-technician-note]") };
    await tab(div, "members");
    const membersTab = { setrole: has(div, "[data-pt-setrole]"), remove: has(div, "[data-pt-remove]"), rename: has(div, "[data-pt-rename]") };
    const invitationsTab = has(div, '[data-pt-tab="invitations"]');
    if (invitationsTab) await tab(div, "invitations");
    const inviteForm = has(div, "[data-pt-invite]"), revoke = has(div, "[data-pt-revoke]");
    await tab(div, "missions");
    await click(div, "[data-pt-mission-open]");
    await tick(200);
    const follow = div.querySelector("[data-pt-followup]");
    const m = metrics(div);
    return { missionsTab, membersTab, invitationsTab, inviteForm, revoke, follow: follow ? { ack: has(follow, "[data-pt-ack]"), done: has(follow, "[data-pt-done]"), text: follow.textContent } : null, posts: calls.post.length, gets: calls.get, ...m, text: div.textContent };
  },
  async member(kind) {
    // A CLIENT or MANAGER account (audience "member"): no creation, block only with server data.
    const { div, calls } = setup(kind === "empty" ? "nobody" : "invitee", { audience: "member" });
    await tick(300);
    const section = div.querySelector("[data-provider-teams]");
    const visible = !!section && !section.hidden && section.getBoundingClientRect().height > 0;
    const out = { visible, create: has(div, "[data-pt-create]"), buttons: [...div.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().height > 0).length };
    if (kind === "empty") return { ...out, posts: calls.post.length };
    await click(div, "[data-pt-accept]");
    await tick(300);
    const posts = calls.post.map((p) => ({ kind: p.kind, action: p.body.action }));
    const storedAtPost = calls.stored[0];
    await click(div, "[data-pt-open]");
    await tick(300);
    await click(div, "[data-pt-mission-open]");
    await tick(250);
    const follow = div.querySelector("[data-pt-followup]");
    return { ...out, posts, storedAtPost, commandId: calls.post[0]?.body.command_id, follow: follow ? { ack: has(follow, "[data-pt-ack]"), text: div.textContent } : null, assign: has(div, "[data-pt-assign]") };
  },
  async removeFlow() {
    const { div, calls } = setup("owner");
    await tick(250);
    await click(div, "[data-pt-open]");
    await tick(250);
    await tab(div, "members");
    await click(div, "[data-pt-remove]");
    const afterOpen = { posts: calls.post.length, dialog: has(div, "[data-pt-remove-confirm]") };
    await click(div, "[data-pt-remove-execute]");
    await tick(250);
    return { afterOpen, posts: calls.post.map((p) => p.body.action), dialog: has(div, "[data-pt-remove-confirm]") };
  },
  async invitee() {
    const { div, calls } = setup("invitee");
    await tick(250);
    const before = has(div, "[data-pt-accept]");
    await click(div, "[data-pt-accept]");
    await tick(300);
    return { before, posts: calls.post, storedAtPost: calls.stored[0], teams: has(div, "[data-pt-team]"), notice: div.querySelector("[data-pt-notice]")?.textContent ?? null };
  },
};
// ---- Pagination (members, missions, sent and received invitations), one cursor per section ----
const N = (p, n) => U(p, n);
function pageOf(list, after) {
  const start = after ? list.findIndex((x) => x.id === after) + 1 : 0;
  const records = list.slice(start, start + 50);
  return { records, next_after: start + 50 < list.length ? records[records.length - 1].id : null };
}
function setupBig(role = "owner") {
  const A = N("7", 1), B = N("7", 2);
  const ctx = { gen: 0 };
  const teamOf = (id) => ({ id, name: id === A ? "Équipe Nord" : "Équipe Sud", owner_id: OWNER, version: 4, role, active: true });
  const data = {
    [A + ":members"]: Array.from({ length: 60 }, (_, i) => ({ id: N("1", i + 1), full_name: i === 0 ? "Alex Martin" : "Tech " + (i + 1), role: i === 0 ? "owner" : "technician", active: true, version: 1 })),
    [A + ":missions"]: Array.from({ length: 55 }, (_, i) => ({ id: N("2", i + 1), category: "panel", status: "accepted", city: "Ville " + (i + 1), assignment: null })),
    [A + ":invitations"]: Array.from({ length: 55 }, (_, i) => ({ id: N("9", i + 1), email: "p" + (i + 1) + "@example.test", role: "technician", status: "pending", expires_at: AT, expired: false })),
    [B + ":members"]: Array.from({ length: 3 }, (_, i) => ({ id: N("3", i + 1), full_name: i === 0 ? "Alex Martin" : "Sud " + (i + 1), role: i === 0 ? "owner" : "technician", active: true, version: 1 })),
    [B + ":missions"]: [],
    [B + ":invitations"]: [],
    received: Array.from({ length: 55 }, (_, i) => ({ id: N("8", i + 1), team_id: A, team_name: "Équipe Nord", role: "technician", expires_at: AT, team_active: true })),
  };
  const calls = { get: [], post: [] };
  const hold = {}, fail = {}, waiting = {}, refuse = {}, post = { status: 200 };
  const reply = (key, body) => {
    calls.get.push(key);
    if (refuse[key]) return Promise.resolve({ status: refuse[key], body: null });
    if (fail[key] > 0) { fail[key]--; return Promise.resolve({ status: 503, body: null }); }
    if (hold[key]) return new Promise((r) => { waiting[key] = () => r({ status: 200, body }); });
    return ok(body);
  };
  const release = async (key) => { delete hold[key]; const go = waiting[key]; delete waiting[key]; if (go) go(); await tick(200); return !!go; };
  const map = new Map();
  const store = () => ({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v), remove: (k) => map.delete(k) });
  const api = {
    teams: (after) => reply("teams|" + (after ?? ""), pageOf([teamOf(A), teamOf(B)], after)),
    invitations: (after) => reply("received|" + (after ?? ""), pageOf(data.received, after)),
    team: (id, section, after) => reply((id === A ? "A" : "B") + ":" + section + "|" + (after ?? ""), { team: teamOf(id), section, ...pageOf(data[id + ":" + section], after) }),
    mission: () => ok(mission),
    send: (cmd) => { calls.post.push(cmd); if (post.status !== 200) return Promise.resolve({ status: post.status, body: null }); const c = cmd.body; return ok({ team_id: cmd.teamId ?? c.team_id, action: c.action, team_version: 4, entity_id: c.intervention_id ?? c.user_id ?? c.invitation_id ?? cmd.teamId, entity_version: c.action === "assign" ? 1 : null, state: c.action === "assign" ? "assigned" : "x", replayed: false }); },
  };
  const div = document.createElement("div"); document.body.appendChild(div);
  const root = createRoot(div);
  const context = { generation: () => ctx.gen, userId: () => OWNER };
  const render = () => root.render(h(StrictMode, null, h(ProviderTeamsPanel, { context, api, store, newId: () => crypto.randomUUID(), now: () => Date.parse(AT) })));
  render();
  const ids = (sel, attr) => [...div.querySelectorAll(sel)].map((e) => e.getAttribute(attr));
  const count = (key) => calls.get.filter((k) => k === key).length;
  const choose = async (job, tech) => { const s = div.querySelector('[data-pt-assign-select="' + job + '"]'); s.value = tech; s.dispatchEvent(new Event("change", { bubbles: true })); await tick(100); };
  const options = (job) => [...div.querySelectorAll('[data-pt-assign-select="' + job + '"] option')].map((o) => o.value).filter(Boolean);
  const value = (job) => div.querySelector('[data-pt-assign-select="' + job + '"]')?.value ?? null;
  return { A, B, div, calls, hold, fail, refuse, post, stored: () => map.size, release, ids, count, choose, options, value, ctx, render };
}
const M = (n) => U("1", n), J = (n) => U("2", n), S = (n) => U("9", n), R = (n) => U("8", n);
const uniq = (a) => new Set(a).size === a.length;
Object.assign(w.scenarios, {
  async pages() {
    const t = setupBig();
    await tick(300);
    const received = [t.ids("[data-pt-invitation]", "data-pt-invitation").length];
    await click(t.div, '[data-pt-more="received"]');
    received.push(t.ids("[data-pt-invitation]", "data-pt-invitation").length, has(t.div, '[data-pt-more="received"]'));
    await click(t.div, '[data-pt-open="' + t.A + '"]');
    await tick(300);
    const missions = [t.ids("[data-pt-mission]", "data-pt-mission").length];
    await click(t.div, '[data-pt-more="missions"]');
    const mids = t.ids("[data-pt-mission]", "data-pt-mission");
    missions.push(mids.length, uniq(mids), has(t.div, '[data-pt-more="missions"]'));
    await tab(t.div, "members");
    const members = [t.ids("[data-pt-member]", "data-pt-member").length];
    // Double click: one read for the page, no duplicated row.
    t.div.querySelector('[data-pt-more="members"]').click();
    t.div.querySelector('[data-pt-more="members"]').click();
    await tick(250);
    const memids = t.ids("[data-pt-member]", "data-pt-member");
    members.push(memids.length, uniq(memids), t.count("A:members|" + M(50)), has(t.div, '[data-pt-more="members"]'));
    await tab(t.div, "invitations");
    const sent = [t.ids("[data-pt-sent]", "data-pt-sent").length];
    await click(t.div, '[data-pt-more="invitations"]');
    const sids = t.ids("[data-pt-sent]", "data-pt-sent");
    sent.push(sids.length, uniq(sids), has(t.div, '[data-pt-more="invitations"]'));
    const cursors = t.calls.get.filter((k) => !k.endsWith("|"));
    return { received, missions, members, sent, cursors, posts: t.calls.post.length, ...metrics(t.div) };
  },
  async assignBeyond() {
    const t = setupBig();
    await tick(300);
    await click(t.div, '[data-pt-open="' + t.A + '"]');
    await tick(300);
    await t.choose(J(1), M(2));
    const before = { has51: t.options(J(1)).includes(M(51)), cta: t.div.querySelector('[data-pt-more="assign-members"]')?.textContent ?? null };
    await click(t.div, '[data-pt-more="missions"]');
    const keptAfterMissions = t.value(J(1));
    await click(t.div, '[data-pt-more="assign-members"]');
    const after = { has51: t.options(J(1)).includes(M(51)), has60: t.options(J(55)).includes(M(60)), kept: t.value(J(1)), cta: has(t.div, '[data-pt-more="assign-members"]'), reads: t.count("A:members|" + M(50)) };
    await t.choose(J(2), M(51));
    await click(t.div, '[data-pt-assign="' + J(2) + '"]');
    await tick(300);
    const post = t.calls.post.map((p) => ({ action: p.body.action, job: p.body.intervention_id, tech: p.body.technician_id }));
    return { before, keptAfterMissions, after, post };
  },
  async localError() {
    const t = setupBig();
    t.fail["received|"] = 99;
    await tick(300);
    const receivedError = has(t.div, '[data-pt-section-error="received"]'), teamsShown = has(t.div, "[data-pt-team]");
    await click(t.div, '[data-pt-open="' + t.A + '"]');
    await tick(300);
    await tab(t.div, "members");
    t.fail["A:members|" + M(50)] = 1;
    await click(t.div, '[data-pt-more="members"]');
    const during = { error: has(t.div, '[data-pt-page-error="members"]'), rows: has(t.div, "[data-pt-member]"), more: has(t.div, '[data-pt-more="members"]') };
    await tab(t.div, "missions");
    const missionsIntact = has(t.div, "[data-pt-mission]");
    await tab(t.div, "members");
    await click(t.div, '[data-pt-page-retry="members"]');
    const after = { error: has(t.div, '[data-pt-page-error="members"]'), rows: has(t.div, "[data-pt-member]"), reads: t.count("A:members|" + M(50)) };
    t.fail["received|"] = 0;
    await click(t.div, '[data-pt-section-retry="received"]');
    await tick(150);
    return { receivedError, teamsShown, during, missionsIntact, after, received: has(t.div, "[data-pt-invitation]"), members: has(t.div, "[data-pt-member]") };
  },
  async midMutation() {
    const t = setupBig();
    await tick(300);
    await click(t.div, '[data-pt-open="' + t.A + '"]');
    await tick(300);
    t.hold["A:missions|" + J(50)] = true;
    await click(t.div, '[data-pt-more="missions"]');
    const page1Before = t.count("A:missions|");
    await t.choose(J(1), M(2));
    await click(t.div, '[data-pt-assign="' + J(1) + '"]');
    await tick(300);
    const reread = t.count("A:missions|") - page1Before;
    const released = await t.release("A:missions|" + J(50));
    const rows = t.ids("[data-pt-mission]", "data-pt-mission");
    return { posts: t.calls.post.map((p) => p.body.action), reread, released, rows: rows.length, late: rows.includes(J(51)), more: has(t.div, '[data-pt-more="missions"]') };
  },
  async revoked(section) {
    // Page 1 visible, then the member is removed elsewhere: the continuation answers 404 (no_data_found).
    const t = setupBig();
    await tick(300);
    await click(t.div, '[data-pt-open="' + t.A + '"]');
    await tick(300);
    const before = { missions: has(t.div, "[data-pt-mission]"), assign: has(t.div, "[data-pt-assign]"), cta: has(t.div, '[data-pt-more="assign-members"]') };
    if (section === "received") {
      t.refuse["received|" + R(50)] = 404;
      await click(t.div, '[data-pt-more="received"]');
    } else {
      if (section !== "missions") await tab(t.div, section);
      t.refuse["A:" + section + "|" + (section === "members" ? M(50) : section === "missions" ? J(50) : S(50))] = 404;
      await click(t.div, '[data-pt-more="' + section + '"]');
    }
    await tick(200);
    const detail = t.div.querySelector("[data-pt-detail], [data-pt-team-forbidden]");
    const residue = ["[data-pt-member]", "[data-pt-mission]", "[data-pt-sent]", "[data-pt-assign]", "[data-pt-assign-select]", "[data-pt-unassign]", "[data-pt-setrole]", "[data-pt-remove]", "[data-pt-rename]", "[data-pt-invite]", "[data-pt-revoke]", "[data-pt-tab]", "[data-pt-more]:not([data-pt-more=teams]):not([data-pt-more=received])", "[data-pt-followup]"].reduce((n, sel) => n + has(t.div, sel), 0);
    return { before, lost: has(t.div, "[data-pt-team-forbidden]"), text: detail?.textContent ?? "", residue, received: has(t.div, "[data-pt-invitation]"), accept: has(t.div, "[data-pt-accept]"), receivedRefused: has(t.div, '[data-pt-section-forbidden="received"]') };
  },
  async writeRefused(mode) {
    // GET 200 with sections visible, then « Affecter » answers 404 (write_provider_team P0002).
    const t = setupBig(mode === "gone-coordinator" ? "coordinator" : "owner");
    await tick(300);
    await click(t.div, '[data-pt-open="' + t.A + '"]');
    await tick(300);
    const before = { missions: has(t.div, "[data-pt-mission]"), assign: has(t.div, "[data-pt-assign]") };
    t.post.status = 404;
    if (mode === "removed") t.refuse["A:members|"] = 404;
    else t.hold["A:members|"] = true;
    const reads = t.count("A:members|");
    await t.choose(J(1), M(2));
    await click(t.div, '[data-pt-assign="' + J(1) + '"]');
    await tick(250);
    const snap = () => {
      const detail = t.div.querySelector("[data-pt-detail], [data-pt-team-forbidden], [data-pt-team-checking]");
      const residue = ["[data-pt-member]", "[data-pt-mission]", "[data-pt-sent]", "[data-pt-assign]", "[data-pt-assign-select]", "[data-pt-unassign]", "[data-pt-setrole]", "[data-pt-remove]", "[data-pt-rename]", "[data-pt-invite]", "[data-pt-revoke]", "[data-pt-tab]", "[data-pt-more]:not([data-pt-more=teams]):not([data-pt-more=received])", "[data-pt-followup]", "[data-pt-retry]"].reduce((n, sel) => n + has(t.div, sel), 0);
      return { residue, lost: has(t.div, "[data-pt-team-forbidden]"), checking: t.div.querySelector("[data-pt-team-checking]")?.getAttribute("data-pt-team-checking") ?? null, text: detail?.textContent ?? "", notice: t.div.querySelector("[data-pt-notice]")?.textContent ?? null, gone: has(t.div, "[data-pt-target-gone]"), private: /Tech [0-9]|Ville [0-9]|example\.test/.test(detail?.textContent ?? ""), posts: t.calls.post.length, stored: t.stored(), received: has(t.div, "[data-pt-invitation]"), create: has(t.div, "[data-pt-create]") };
    };
    const closed = snap();
    const verifyReads = t.count("A:members|") - reads;
    if (mode === "removed") return { before, closed, verifyReads };
    t.post.status = 200;
    await t.release("A:members|");
    await tick(300);
    const proven = { ...snap(), missions: has(t.div, "[data-pt-mission]"), assign: has(t.div, "[data-pt-assign]") };
    await tick(300);
    return { before, closed, verifyReads, proven, postsLater: t.calls.post.length, sentReads: t.calls.get.filter((k) => k.startsWith("A:invitations")).length };
  },
  async midSwitch() {
    const t = setupBig();
    await tick(300);
    await click(t.div, '[data-pt-open="' + t.A + '"]');
    await tick(300);
    await tab(t.div, "members");
    t.hold["A:members|" + M(50)] = true;
    await click(t.div, '[data-pt-more="members"]');
    await click(t.div, '[data-pt-open="' + t.B + '"]');
    await tick(300);
    await tab(t.div, "members");
    const releasedTeam = await t.release("A:members|" + M(50));
    const team = { detail: t.div.querySelector("[data-pt-detail]")?.getAttribute("data-pt-detail"), members: t.ids("[data-pt-member]", "data-pt-member") };
    // Identity switch (generation bump) while the received page 2 is in flight.
    t.hold["received|" + R(50)] = true;
    await click(t.div, '[data-pt-more="received"]');
    const page1Before = t.count("received|");
    t.ctx.gen = 1;
    t.render();
    await tick(400);
    const reread = t.count("received|") - page1Before;
    const releasedIdentity = await t.release("received|" + R(50));
    const rows = t.ids("[data-pt-invitation]", "data-pt-invitation");
    return { releasedTeam, team, reread, releasedIdentity, received: rows.length, late: rows.includes(R(51)) };
  },
});
`;

type Run = (name: string, arg?: string) => Promise<unknown>;
/** Bundles ENTRY, serves it, opens Chromium at 360 px; `fn` drives window.scenarios. Always closes. */
async function mounted(fn: (run: Run, errors: string[], requests: string[]) => Promise<void>) {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const requests: string[] = [];
  const server: Server = createServer((rq, rs) => {
    if (rq.url !== "/") requests.push(String(rq.url));
    rs.setHeader("content-type", "text/html");
    rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><div class="ui-v2" id="app"></div><script>${js}</script>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 360, height: 900 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const run: Run = (name, arg) => page.evaluate(([n, a]: [string, string | undefined]) => (window as unknown as { scenarios: Record<string, (x?: string) => Promise<unknown>> }).scenarios[n](a), [name, arg]);
    await fn(run, errors, requests);
  } finally {
    await browser.close();
    server.close();
  }
}

test("équipes prestataires montées (Chromium, StrictMode, faux api par rôle serveur)", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  await mounted(async (run, errors, requests) => {
    type R = { missionsTab: { assign: number; unassign: number; techNote: number }; membersTab: { setrole: number; remove: number; rename: number }; invitationsTab: number; inviteForm: number; revoke: number; follow: { ack: number; done: number; text: string } | null; posts: number; gets: string[]; small: number; overflow: number; text: string };
    const owner = (await run("role", "owner")) as R;
    same([owner.missionsTab.assign, owner.missionsTab.unassign, owner.membersTab.setrole, owner.membersTab.remove, owner.membersTab.rename, owner.invitationsTab, owner.inviteForm, owner.revoke], [1, 1, 2, 2, 1, 1, 1, 1], "owner");
    const coord = (await run("role", "coordinator")) as R;
    same([coord.missionsTab.assign, coord.missionsTab.unassign, coord.membersTab.setrole, coord.membersTab.remove, coord.membersTab.rename, coord.invitationsTab], [1, 1, 0, 0, 0, 0], "coordinator");
    assert.ok(!coord.gets.includes("team:invitations"), "coordinator never reads the owner-only invitations section");
    const tech = (await run("role", "technician")) as R;
    same([tech.missionsTab.assign, tech.missionsTab.unassign, tech.missionsTab.techNote, tech.membersTab.setrole, tech.invitationsTab], [0, 0, 1, 0, 0], "technician");
    same([tech.follow?.ack, tech.follow?.done], [1, 0], "acknowledge only, as the server permissions say");
    assert.match(tech.text, /ni prix, ni paiement, ni documents/);
    assert.doesNotMatch(tech.text.replace("ni prix, ni paiement, ni documents", ""), /€|Payer|payé|Facture|Document|PDF|Devis/i, "no finance / documents for a technician");
    for (const r of [owner, coord, tech]) {
      same(r.posts, 0, "reading never posts");
      same([r.small, r.overflow <= 0], [0, true], "44 px targets, no overflow at 360 px");
    }
    const inv = (await run("invitee")) as { before: number; posts: { kind: string; body: Record<string, string> }[]; storedAtPost: string | null; teams: number; notice: string | null };
    same([inv.before, inv.posts.length, inv.posts[0].kind, inv.posts[0].body.action, inv.posts[0].body.invitation_id], [1, 1, "invitation", "accept_invitation", "90000000-0000-4000-8000-000000000001"]);
    assert.equal(JSON.parse(inv.storedAtPost!).command.body.command_id, inv.posts[0].body.command_id, "persisted before the POST");
    same([inv.teams, inv.notice], [1, "Invitation acceptée."]);
    // Client / manager accounts (audience "member"): invitation → accept (fence) → technician follow-up.
    type M = { visible: boolean; create: number; buttons: number; posts: { kind: string; action: string }[]; storedAtPost: string | null; commandId: string; follow: { ack: number; text: string } | null; assign: number };
    const member = (await run("member", "invited")) as M;
    same([member.visible, member.create, member.posts], [true, 0, [{ kind: "invitation", action: "accept_invitation" }]], "member invitee: visible, no creation, one POST");
    assert.equal(JSON.parse(member.storedAtPost!).command.body.command_id, member.commandId, "persisted before the POST");
    same([member.follow?.ack, member.assign], [1, 0], "member technician follow-up, no assignment action");
    assert.doesNotMatch(member.follow!.text.replace("ni prix, ni paiement, ni documents", ""), /€|Payer|payé|Facture|Document|PDF|Devis/i, "no finance / documents for a member account either");
    const empty = (await run("member", "empty")) as { visible: boolean; create: number; buttons: number; posts: number };
    same([empty.visible, empty.create, empty.buttons, empty.posts], [false, 0, 0, 0], "no invitation / membership ⇒ no block, no team action");
    const rm = (await run("removeFlow")) as { afterOpen: { posts: number; dialog: number }; posts: string[]; dialog: number };
    same([rm.afterOpen, rm.posts, rm.dialog], [{ posts: 0, dialog: 1 }, ["remove_member"], 0], "inline confirmation, then exactly one POST");
    same(errors, []);
    same(requests.filter((u) => u.startsWith("/api/")), []);
  });
});

test("équipes prestataires paginées (Chromium) : une reprise par section, dédoublonnage, erreur locale, génération après écriture / changement, membre 51 affectable", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  await mounted(async (run, errors, requests) => {
    const p = (await run("pages")) as { received: number[]; missions: (number | boolean)[]; members: (number | boolean)[]; sent: (number | boolean)[]; cursors: string[]; posts: number; small: number; overflow: number };
    same(p.received, [50, 55, 0], "received invitations continue past page 1");
    same(p.missions, [50, 55, true, 0], "missions continue past page 1, unique ids");
    same(p.members, [50, 60, true, 1, 0], "members: a double click reads page 2 once, no duplicated row");
    same(p.sent, [50, 55, true, 0], "sent invitations continue past page 1");
    same([...new Set(p.cursors)].sort(), ["A:invitations|90000000-0000-4000-8000-000000000050", "A:members|10000000-0000-4000-8000-000000000050", "A:missions|20000000-0000-4000-8000-000000000050", "received|80000000-0000-4000-8000-000000000050"], "each section resumes at its own next_after");
    same([p.posts, p.small, p.overflow <= 0], [0, 0, true], "reading never posts; 44 px targets, no overflow at 360 px");

    const a = (await run("assignBeyond")) as { before: { has51: boolean; cta: string | null }; keptAfterMissions: string; after: { has51: boolean; has60: boolean; kept: string; cta: number; reads: number }; post: { action: string; job: string; tech: string }[] };
    same(a.before, { has51: false, cta: "Charger les autres membres" }, "member 51 not choosable before the CTA");
    same(a.keptAfterMissions, "10000000-0000-4000-8000-000000000002", "selection kept across « Afficher plus »");
    same(a.after, { has51: true, has60: true, kept: "10000000-0000-4000-8000-000000000002", cta: 0, reads: 1 }, "CTA loads the next members once, selection kept");
    same(a.post, [{ action: "assign", job: "20000000-0000-4000-8000-000000000002", tech: "10000000-0000-4000-8000-000000000051" }], "member 51 assigned with one command");

    const e = (await run("localError")) as { receivedError: number; teamsShown: number; during: { error: number; rows: number; more: number }; missionsIntact: number; after: { error: number; rows: number; reads: number }; received: number; members: number };
    same([e.receivedError, e.teamsShown], [1, 2], "received invitations fail locally, teams still listed");
    same([e.during, e.missionsIntact], [{ error: 1, rows: 50, more: 0 }, 50], "members page 2 fails locally, page 1 and missions kept");
    same(e.after, { error: 0, rows: 60, reads: 2 }, "Réessayer re-reads the failed cursor");
    same([e.received, e.members], [50, 60], "received retry does not wipe the members");

    type V = { before: { missions: number; assign: number; cta: number }; lost: number; text: string; residue: number; received: number; accept: number; receivedRefused: number };
    for (const section of ["members", "missions", "invitations"]) {
      const v = (await run("revoked", section)) as V;
      same(v.before, { missions: 50, assign: 50, cta: 1 }, "page 1 visible with its actions");
      same([v.lost, v.residue], [1, 0], section + " continuation 404 ⇒ every team section and action cleared");
      assert.match(v.text, /Accès à l’équipe retiré ou inaccessible/);
      same([v.received, v.accept], [50, 50], "the received invitations are another scope, untouched");
    }
    const rv = (await run("revoked", "received")) as V;
    same([rv.received, rv.accept, rv.receivedRefused, rv.lost], [0, 0, 1, 0], "received continuation 404 ⇒ list and actions cleared, refusal shown");
    type W = { before: { missions: number; assign: number }; closed: { residue: number; lost: number; checking: string | null; text: string; notice: string | null; gone: number; private: boolean; posts: number; stored: number; received: number; create: number }; verifyReads: number; proven?: W["closed"] & { missions: number; assign: number }; postsLater?: number };
    const removed = (await run("writeRefused", "removed")) as W;
    same(removed.before, { missions: 50, assign: 50 }, "sections and actions visible before the write");
    same([removed.closed.residue, removed.closed.lost, removed.closed.private, removed.closed.notice, removed.closed.posts, removed.closed.stored, removed.verifyReads], [0, 1, false, null, 1, 0, 1], "write 404 + re-read 404 ⇒ closed, zero success, zero replay, one bounded re-read");
    assert.match(removed.closed.text, /Accès à l’équipe retiré ou inaccessible/);
    same([removed.closed.received, removed.closed.create], [50, 1], "received invitations and team creation stay outside the closed scope");
    const gone = (await run("writeRefused", "gone")) as W;
    same([gone.closed.residue, gone.closed.checking, gone.closed.private, gone.closed.notice, gone.closed.gone, gone.closed.posts], [0, "checking", false, null, 0, 1], "before the re-read proves access: nothing private, no action");
    same([gone.proven!.checking, gone.proven!.gone, gone.proven!.missions, gone.proven!.assign, gone.proven!.notice, gone.postsLater, gone.proven!.stored], [null, 1, 50, 50, null, 1, 0], "re-read 200 (target gone) ⇒ local error + refresh, no replay");
    const gc = (await run("writeRefused", "gone-coordinator")) as W & { sentReads: number };
    same([gc.before.missions, gc.before.assign, gc.closed.residue, gc.closed.checking, gc.closed.private], [50, 50, 0, "checking", false], "coordinator: closed until the re-read proves access");
    same([gc.proven!.lost, gc.proven!.checking, gc.proven!.gone, gc.proven!.missions, gc.proven!.assign, gc.proven!.notice, gc.postsLater, gc.proven!.stored, gc.sentReads], [0, null, 1, 50, 50, null, 1, 0, 0], "gone, coordinator: list back, team NOT closed, no replay, no success, sent invitations never read");
    const m = (await run("midMutation")) as { posts: string[]; reread: number; released: boolean; rows: number; late: boolean; more: number };
    same([m.posts, m.reread >= 1, m.released, m.rows, m.late, m.more], [["assign"], true, true, 50, false, 1], "a write re-reads page 1; the late page 2 is dropped");

    const sw = (await run("midSwitch")) as { releasedTeam: boolean; team: { detail: string; members: string[] }; reread: number; releasedIdentity: boolean; received: number; late: boolean };
    same([sw.releasedTeam, sw.team.detail, sw.team.members.length, sw.team.members.some((id) => id.startsWith("1"))], [true, "70000000-0000-4000-8000-000000000002", 3, false], "team switch: the late page of the old team never lands");
    same([sw.reread >= 1, sw.releasedIdentity, sw.received, sw.late], [true, true, 50, false], "identity switch: fresh page 1, the late page is dropped");
    same(errors, []);
    same(requests.filter((u) => u.startsWith("/api/")), []);
  });
});

test("câblage réel (démo client / gestionnaire « Vue d’ensemble ») : aucun bloc sans données serveur, aucun appel /api, pas de débordement à 390", { skip }, async () => {
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  const settings = client.slice(client.indexOf("function ProfileSettings("));
  assert.match(settings, /const demo = session\.mode === "demo"/);
  assert.match(settings, /<ProviderTeamsPanel key=\{`teams\|\$\{session\.mutationContext\.userId\(\) \?\? "-"\}\|\$\{session\.mutationContext\.generation\(\)\}`\} audience="member" context=\{session\.mutationContext\} demo=\{demo\} \/>/);
  const enterprise = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(enterprise, /<ProviderTeamsPanel key=\{`teams\|\$\{c\.session\.mutationContext\.userId\(\) \?\? "-"\}\|\$\{c\.session\.mutationContext\.generation\(\)\}`\} audience="member" context=\{c\.session\.mutationContext\} demo=\{c\.session\.mode === "demo"\} \/>/);
  assert.doesNotMatch(readFileSync("components/features/provider-teams/provider-teams-panel.tsx", "utf8"), /window\.confirm/);
  await withApp(async (open) => {
    for (const route of ["client-overview", "manager-overview"]) {
      const { page, errors, api } = await open(route, 390);
      const r = await page.evaluate(() => ({ block: !!document.querySelector("[data-provider-teams]"), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      same([r.block, r.overflow <= 0, api, errors], [false, true, [], []], route);
      await page.context().close();
    }
  });
});

test("câblage réel (démo artisan « Missions ») : note honnête, aucun appel /api", { skip }, async () => {
  const src = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(src, /<ProviderTeamsPanel\s+key=\{`teams\|\$\{session\.mutationContext\.userId\(\) \?\? "-"\}\|\$\{session\.mutationContext\.generation\(\)\}`\}\s+context=\{session\.mutationContext\}\s+demo=\{session\.mode === "demo"\}\s+\/>/);
  await withApp(async (open) => {
    const { page, errors, api } = await open("artisan-missions", 390);
    const r = await page.evaluate(() => ({ note: document.querySelector('[data-provider-teams="demo"]')?.textContent ?? null, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    assert.match(r.note ?? "", /aucune équipe n’est lue ni modifiée/);
    assert.ok(r.overflow <= 0);
    same([api, errors], [[], []]);
    await page.context().close();
  });
});
