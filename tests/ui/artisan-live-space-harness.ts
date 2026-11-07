// Shared helper (not a test file): real ArtisanSpace bundled with esbuild and mounted in live mode on a
// fake Session (StrictMode, ThemeProvider), served with globals.css. Fields the screen under test does
// not use fall back to inert values: unknown session methods resolve null, unknown data lists are [],
// capabilities are "available". Every fetch is recorded and answered by window.respond (default 503).
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

/** `setup` is browser code run before mount; it may define window.seed = { data, session } overrides. */
export async function serveLiveArtisan(setup: string) {
  const entry = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArtisanSpace } from "./components/role/artisan-space";
import { ThemeProvider } from "./components/app/theme-provider";
window.fetches = [];
window.respond = () => new Response(JSON.stringify({ error: "x" }), { status: 503, headers: { "Retry-After": "2" } });
window.fetch = async (url, init) => { window.fetches.push(String(url)); return window.respond(String(url), init); };
${setup}
const seed = window.seed || {};
const listData = new Proxy(seed.data || {}, { get: (t, k) => (k in t ? t[k] : []) });
function Host() {
  const [, setTick] = useState(0);
  window.rerender = () => setTick((t) => t + 1);
  const base = {
    mode: "live", role: "artisan", profileId: window.uid || "u1", displayName: "Artisan Test", firstName: "Artisan",
    profile: { id: window.uid || "u1", role: "artisan", full_name: "Artisan Test", phone: "", created_at: "2024-01-15T10:00:00Z", artisan_approved: true },
    pendingDraft: null, booking: null, cardReturn: null, pendingLookupFailed: false,
    mutationContext: { userId: () => window.uid || "u1", generation: () => window.gen || 1 },
    data: listData, professional: new Proxy({}, { get: () => [] }),
    capabilities: new Proxy({}, { get: () => "available" }),
    returnContext: null, view: window.view || "overview", param: window.param || "", selectedId: "", selectedQuoteId: "",
    busy: false, loading: false, connection: "", error: "", notice: "", activeOrganizationId: "", activeSiteId: "", membershipRole: null, refreshedAt: 1,
    go: (view, param) => { window.view = view; window.param = param || ""; window.gone = (window.gone || []).concat([[view, param || ""]]); window.rerender(); },
    openIntervention: (id, quoteId) => { window.opened = (window.opened || []).concat([[id, quoteId ?? null]]); },
    run: async (task) => { await task(); return true; },
    ...(seed.session || {}),
  };
  const session = new Proxy(base, { get: (t, k) => (k in t ? t[k] : typeof k === "string" ? async () => null : undefined) });
  return h(ArtisanSpace, { session });
}
const div = document.createElement("div"); div.id = "app"; document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(ThemeProvider, null, h(Host))));
`;
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: entry, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body></html>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
