// QA page (claim §5): the app's real browser client (@supabase/ssr createBrowserClient with the app's
// supabase-js / realtime-js), bundled locally with esbuild into the run's temporary folder (outside
// Git) and served on loopback. The page keeps received INSERT ids IN MEMORY and only answers booleans.
import http from "node:http";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import path from "node:path";

const ENTRY = String.raw`
import { createBrowserClient } from "@supabase/ssr";
const st = { client: null, channel: null, statuses: [], err: null, received: new Set(), t0: 0, tokenChanges: 0, mark: 0 };
const FINAL = ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"];
window.__rt = {
  init(url, key) {
    st.client = createBrowserClient(url, key);
    st.client.auth.onAuthStateChange((event) => { if (event === "TOKEN_REFRESHED") st.tokenChanges++; });
    return true;
  },
  async signIn(email, password) {
    const { data, error } = await st.client.auth.signInWithPassword({ email, password });
    return { ok: !error && Boolean(data && data.session), uid: (data && data.user && data.user.id) || null };
  },
  subscribe(spec, timeoutMs) {
    st.statuses = []; st.err = null; st.received = new Set(); st.t0 = performance.now(); st.mark = st.tokenChanges;
    let ch = st.client.channel(spec.channel, spec.wait ? { config: { postgres_changes_options: { wait: true } } } : undefined);
    for (const table of spec.tables) ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, (p) => {
      if (p && p.table === "interventions" && p.eventType === "INSERT" && p.new && typeof p.new.id === "string") st.received.add(p.new.id);
    });
    st.channel = ch;
    return new Promise((resolve) => {
      const done = () => resolve({ statuses: st.statuses.slice(), error: st.err });
      const timer = setTimeout(done, timeoutMs);
      ch.subscribe((status, err) => {
        st.statuses.push({ status: String(status), t_ms: Math.round(performance.now() - st.t0) });
        if (err) st.err = String((err && err.message) || err);
        // The SDK may report CLOSED just before CHANNEL_ERROR (mismatch ⇒ unsubscribe then error):
        // a CLOSED waits briefly for a following error before the join outcome is settled.
        if (status === "CLOSED") setTimeout(() => { clearTimeout(timer); done(); }, 200);
        else if (FINAL.includes(status)) { clearTimeout(timer); done(); }
      });
    });
  },
  statuses() { return st.statuses.slice(); },
  received(id) { return st.received.has(id); },
  tokenChangesSinceJoin() { return st.tokenChanges - st.mark; },
  async refreshSession() { const r = await st.client.auth.refreshSession(); return !r.error; },
  async close() { if (st.channel) { const ch = st.channel; st.channel = null; await st.client.removeChannel(ch); } return true; },
};
`;

export function sdkVersions(appDir) {
  const v = (pkg) => {
    try {
      return JSON.parse(readFileSync(path.join(appDir, "node_modules", pkg, "package.json"), "utf8")).version;
    } catch {
      return null;
    }
  };
  return { realtime_js: v("@supabase/realtime-js"), supabase_js: v("@supabase/supabase-js"), ssr: v("@supabase/ssr"), source: "app node_modules (@supabase/ssr createBrowserClient)" };
}

export async function buildBundle({ appDir, outDir }) {
  const esbuild = createRequire(import.meta.url)("esbuild");
  const result = await esbuild.build({ stdin: { contents: ENTRY, resolveDir: appDir, loader: "js" }, bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent", minify: false });
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const file = path.join(outDir, "rt-probe.js");
  writeFileSync(file, result.outputFiles[0].text, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/** Loopback server: "/" = the QA page, "/rt.js" = the bundle. Nothing else. */
export function servePage(bundleFile) {
  const js = readFileSync(bundleFile);
  const html = `<!doctype html><meta charset="utf-8"><title>QA realtime probe</title><script src="/rt.js"></script>`;
  const server = http.createServer((req, res) => {
    if (req.url === "/rt.js") return res.writeHead(200, { "content-type": "text/javascript" }).end(js);
    if (req.url === "/" || req.url.startsWith("/?")) return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}
