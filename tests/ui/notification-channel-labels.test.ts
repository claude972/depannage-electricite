// SYS-04 / PUB-04: the notification centre states each external channel exactly, from data already
// loaded — « Disponible » (server reports it available), « Activé » (available AND the SAVED
// opt-in), unavailable as before — and makes no global claim that nothing is sent. Server-rendered
// with the real components (esbuild bundle, react-dom/server); no browser, no network, no call.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationCenter, PreferencesPanel, channelState } from "./components/features/notifications/notification-center";
import { demoNotificationPage, demoPreferences } from "./lib/features/notifications/demo";
export function renderPanel(view) { return renderToStaticMarkup(h(PreferencesPanel, { client: {}, demo: view, writable: false })); }
export function renderCenter(props) { return renderToStaticMarkup(h(NotificationCenter, props)); }
export { channelState, demoNotificationPage, demoPreferences };
`;
type View = { channels: Record<string, string>; preferences: Record<string, unknown>; [k: string]: unknown };
type Mod = {
  renderPanel(view: View): string;
  renderCenter(props: unknown): string;
  channelState(available: boolean, optIn: boolean): { tone: string; label: string };
  demoNotificationPage(p: object): unknown;
  demoPreferences(): View;
};
let mod: Mod;
async function load(): Promise<Mod> {
  if (mod) return mod;
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "node", format: "cjs", jsx: "automatic", loader: { ".css": "local-css" }, logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' } });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const m = { exports: {} as Mod };
  new Function("module", "exports", "require", js)(m, m.exports, (await import("node:module")).createRequire(path.join(ROOT, "package.json")));
  mod = m.exports;
  return mod;
}
/** Text of the label holding `name` (e-mail / SMS / push row), tags included. */
const row = (html: string, name: RegExp) => {
  const labels = html.split("<label").slice(1).map((l) => l.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  return labels.find((l) => name.test(l)) ?? "";
};
const view = (base: View, channels: Record<string, string>, prefs: Record<string, boolean>): View => ({ ...base, channels: { ...base.channels, ...channels }, preferences: { ...base.preferences, ...prefs } });

test("état par canal : indisponible, disponible sans opt-in, activé (opt-in serveur enregistré)", async () => {
  const m = await load();
  const unavailable = m.channelState(false, true).label;
  assert.deepEqual([m.channelState(false, false).label, m.channelState(true, false).label, m.channelState(true, true).label], [unavailable, "Disponible", "Activé"]);
  const base = m.demoPreferences();
  for (const [channel, name] of [["email", /E-mail|e-mail/], ["sms", /SMS/], ["push", /push/i]] as const) {
    const off = row(m.renderPanel(view(base, { [channel]: "unavailable" }, { [`${channel}_enabled`]: true })), name);
    assert.match(off, new RegExp(unavailable), `${channel}: unavailable stays unavailable even with a saved opt-in`);
    assert.doesNotMatch(off, /Activé|Disponible/);
    const avail = row(m.renderPanel(view(base, { [channel]: "available" }, { [`${channel}_enabled`]: false })), name);
    assert.match(avail, /Disponible/, `${channel}: available, opt-in false`);
    assert.doesNotMatch(avail, /Activé|Actif/, `${channel}: never « Activé » without the saved opt-in`);
    const on = row(m.renderPanel(view(base, { [channel]: "available" }, { [`${channel}_enabled`]: true })), name);
    assert.match(on, /Activé/, `${channel}: available + saved opt-in`);
    assert.doesNotMatch(on, /Actif sur ce navigateur/, `${channel}: the browser status is never inferred from the opt-in`);
  }
});

test("push : « Actif sur ce navigateur » vient seulement de l’inscription de ce navigateur (câblage web-push conservé)", () => {
  const src = readFileSync(path.join(ROOT, "components/features/notifications/notification-center.tsx"), "utf8");
  // The browser tag (pushTag: enrollment.browser === "current" ⇒ « Actif sur ce navigateur ») wins
  // over the channel state; without it, the push row uses the same server availability + opt-in.
  assert.match(src, /channel === "push" && pushTagState \? \(\s*<Tag tone="green">\{TAG_LABEL\[pushTagState\]\}<\/Tag>\s*\) : channel === "push" \? \(\s*<ChannelTag available=\{view\.channels\.push === "available"\} optIn=\{view\.preferences\.push_enabled\} \/>/);
  const model = readFileSync(path.join(ROOT, "components/features/web-push/model.ts"), "utf8");
  assert.match(model, /current: "Actif sur ce navigateur"/);
});

test("aucune affirmation globale « Aucun … n’est envoyé » dans le centre", async () => {
  const m = await load();
  const scope = { userId: "client-a", role: "client", authority: { canWrite: true } };
  const client = { list: async () => null, summary: async () => null, mark: async () => null, loadPreferences: async () => null, savePreferences: async () => null };
  const html = m.renderCenter({ state: "available", unavailableMessage: "", scope, client, demo: { page: m.demoNotificationPage({}), preferences: m.demoPreferences() } });
  assert.match(html, /se consultent dans cet espace/);
  assert.doesNotMatch(html, /Aucun e-mail|n’est envoyé|est envoyé/);
  const empty = m.renderCenter({ state: "available", unavailableMessage: "", scope, client, demo: { page: { notifications: [], page: { limit: 25, total: 0, has_more: false, next_cursor: null }, unread_count: 0, filters: { unread: false } }, preferences: m.demoPreferences() } });
  assert.doesNotMatch(empty, /n’est envoyé/);
  const src = readFileSync(path.join(ROOT, "components/features/notifications/notification-center.tsx"), "utf8");
  assert.doesNotMatch(src, /Aucun e-mail, SMS ni notification push n’est envoyé|Aucun e-mail ni SMS n’est envoyé|"Actif"/);
});
