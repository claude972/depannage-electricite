// CLI-09: the client profile mounts the real notification-preferences panel (the same leaf as the
// notification centre) instead of claiming that no preference is stored. Server-rendered with the
// real components (esbuild bundle, react-dom/server); no browser, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileNotificationPreferences } from "./components/role/client-space";
import { PreferencesPanel } from "./components/features/notifications/notification-center";
import { demoPreferences } from "./lib/features/notifications/demo";
export function renderProfile(session) { return renderToStaticMarkup(h(ProfileNotificationPreferences, { session })); }
export function renderPanel(props) { return renderToStaticMarkup(h(PreferencesPanel, props)); }
export { demoPreferences };
`;
type Mod = {
  renderProfile(session: unknown): string;
  renderPanel(props: unknown): string;
  demoPreferences(): { channels: Record<string, string>; preferences: Record<string, unknown> };
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
const client = { loadPreferences: () => new Promise(() => {}), savePreferences: async () => null };
const session = (over: Record<string, unknown>) => ({
  mode: "live",
  profileId: "10000000-0000-4000-8000-000000000001",
  capabilities: { notifications: "available" },
  features: { notifications: client },
  reprobeFeature: async () => {},
  ...over,
});

test("profile no longer claims that no notification preference is stored", () => {
  const src = readFileSync(path.join(ROOT, "components/role/client-space.tsx"), "utf8");
  assert.doesNotMatch(src, /ni préférence de notification n’est enregistré/);
  assert.match(src, /<ProfileNotificationPreferences session=\{session\} \/>/);
  // Saved addresses are the real CLI-09 leaf; saved payment methods are the real FIN-08 leaf.
  assert.match(src, /<ClientAddressesPanel key=/);
  assert.match(src, /<SavedPaymentMethodsPanel key=/);
});

test("live + available: the real panel loads through the injected client (loading state first)", async () => {
  const { renderProfile } = await load();
  const html = renderProfile(session({}));
  assert.match(html, /Chargement des préférences/);
});

test("live + not available: honest unavailable / verification state, never the form", async () => {
  const { renderProfile } = await load();
  const missing = renderProfile(session({ capabilities: { notifications: "missing" } }));
  assert.match(missing, /Préférences de notification indisponibles/);
  assert.doesNotMatch(missing, /<form/);
  const down = renderProfile(session({ capabilities: { notifications: "unavailable" } }));
  assert.match(down, /Préférences de notification indisponibles/);
  assert.match(down, /Réessayer/);
  const unknown = renderProfile(session({ capabilities: { notifications: "unknown" } }));
  assert.match(unknown, /Vérification des préférences de notification/);
  assert.doesNotMatch(unknown, /<form/);
});

test("demo: read-only form, no save button, SMS never shown as active", async () => {
  const { renderProfile, demoPreferences } = await load();
  assert.equal(demoPreferences().channels.sms, "unavailable");
  const html = renderProfile(session({ mode: "demo", capabilities: { notifications: "unknown" } }));
  assert.match(html, /Préférences de notification/);
  assert.doesNotMatch(html, /Enregistrer<\/button>/);
  assert.doesNotMatch(html, /Fermer/, "standalone panel has no close action");
  assert.doesNotMatch(html, />Actif</, "no external channel is presented as active");
});

test("panel: an external channel is « Actif » only when the server reports it available", async () => {
  const { renderPanel, demoPreferences } = await load();
  const view = demoPreferences();
  const html = renderPanel({ client, demo: { ...view, channels: { ...view.channels, email: "available" } }, writable: true });
  assert.equal((html.match(/>Actif</g) ?? []).length, 1);
  assert.match(html, /Enregistrer<\/button>/);
});
