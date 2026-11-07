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

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
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
  const calls = { get: [], post: [], stored: [] };
  const map = new Map();
  const store = () => ({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v), remove: (k) => map.delete(k) });
  let teamsCalls = 0;
  const api = {
    teams: () => (calls.get.push("teams"), teamsCalls++, ok({ records: role === "invitee" && teamsCalls === 1 ? [] : [team(role === "invitee" ? "technician" : role)], next_after: null })),
    invitations: () => (calls.get.push("invitations"), ok({ records: role === "invitee" && calls.post.length === 0 ? [{ id: INV, team_id: TEAM, team_name: "Équipe Nord", role: "technician", expires_at: AT, team_active: true }] : [], next_after: null })),
    team: (id, section) => (calls.get.push("team:" + section), section === "invitations" && role !== "owner" ? Promise.resolve({ status: 403, body: null }) : ok({ team: team(role === "invitee" ? "technician" : role), section, records: section === "members" ? (role === "technician" ? [members[2]] : members) : section === "missions" ? missions(role) : [{ id: INV, email: "tom@example.test", role: "technician", status: "pending", expires_at: AT, expired: false }], next_after: null })),
    mission: () => (calls.get.push("mission"), ok(mission)),
    send: (cmd) => { calls.post.push(cmd); calls.stored.push([...map.values()][0] ?? null); const c = cmd.body; return ok({ team_id: cmd.kind === "team" ? cmd.teamId : c.team_id, action: c.action, team_version: 4, entity_id: c.invitation_id ?? c.intervention_id ?? TEAM, entity_version: c.action === "assign" ? 1 : null, state: c.action === "accept_invitation" ? "accepted" : c.action === "assign" ? "assigned" : "x", replayed: false }); },
  };
  const div = document.createElement("div"); document.body.appendChild(div);
  createRoot(div).render(h(StrictMode, null, h(ProviderTeamsPanel, { context: { generation: () => 0, userId: () => OWNER }, api, store, newId: () => crypto.randomUUID(), now: () => Date.parse(AT) })));
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
  async invitee() {
    const { div, calls } = setup("invitee");
    await tick(250);
    const before = has(div, "[data-pt-accept]");
    await click(div, "[data-pt-accept]");
    await tick(300);
    return { before, posts: calls.post, storedAtPost: calls.stored[0], teams: has(div, "[data-pt-team]"), notice: div.querySelector("[data-pt-notice]")?.textContent ?? null };
  },
};
`;

test("équipes prestataires montées (Chromium, StrictMode, faux api par rôle serveur)", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
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
    const run = (name: string, arg?: string) => page.evaluate(([n, a]: [string, string | undefined]) => (window as unknown as { scenarios: Record<string, (x?: string) => Promise<unknown>> }).scenarios[n](a), [name, arg]);
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
    same(errors, []);
    same(requests.filter((u) => u.startsWith("/api/")), []);
  } finally {
    await browser.close();
    server.close();
  }
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
