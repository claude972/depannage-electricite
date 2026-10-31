// Runtime-error scan of the demo spaces through the Chrome DevTools Protocol (no extra deps).
import { spawn } from "node:child_process";
const CH = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const base = process.argv[2] || "http://localhost:3178/";
const urls = (process.argv[3] || "").split(",").filter(Boolean);
const port = 9333;
const chrome = spawn(CH, [`--remote-debugging-port=${port}`, "--headless", "--disable-gpu", "--window-size=1280,1000", "--user-data-dir=/Users/claudebrafa/.claude/jobs/b4b555f0/tmp/qa/profile", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(path) { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: path.startsWith("/json/new") ? "PUT" : "GET" }); return r.json(); }
for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(250); } }
const results = [];
for (const u of urls) {
  const target = await json(`/json/new?about:blank`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") errors.push("EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split("\n")[0]);
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning"))
      errors.push(m.params.type.toUpperCase() + " " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0].slice(0, 220));
    if (m.method === "Network.responseReceived" && m.params.response.status >= 400 && m.params.response.url.startsWith(base))
      errors.push(`HTTP ${m.params.response.status} ${m.params.response.url.replace(base, "/")}`);
  };
  await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable");
  await send("Page.navigate", { url: base + u });
  await sleep(6000);
  const title = await send("Runtime.evaluate", { expression: "document.querySelector('main h1, main h2')?.textContent?.trim().slice(0,60) || document.title", returnByValue: true });
  results.push({ url: u, h1: title?.result?.value, errors: [...new Set(errors)] });
  ws.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
}
chrome.kill();
for (const r of results) {
  console.log(`\n== ${r.url}  [${r.h1}]`);
  if (!r.errors.length) console.log("   OK no console error / exception / 4xx-5xx same-origin");
  for (const e of r.errors) console.log("   " + e);
}
