// In-page QA probe (contract §2, A2 P2-2, A3): installed by context.addInitScript BEFORE login, on
// every document. QA-only, no app effect, read-only towards the app. It keeps:
//  - a random document marker (same document ⇔ same marker; a reload creates a new one);
//  - WINDOW focus/blur (target === window) and document visibilitychange events (type + time);
//  - first-seen times of the deep-link texts, caught on every DOM mutation batch (a flash counts).
// Kept as SOURCE TEXT so no transpiler helper is injected into the page.
import { UI } from "./constants.mjs";

const NEEDLES = { loading: UI.loading, clientNotFound: UI.clientNotFound, artisanNotFound: UI.artisanNotFound, enterpriseNotFound: UI.enterpriseNotFound, error: UI.errorTitle };

export const PROBE_SOURCE = String.raw`(() => {
  if (window.__qaDl) return;
  const needles = ${JSON.stringify(NEEDLES)};
  const st = { marker: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)), created: Date.now(), focus: [], seen: {} };
  Object.defineProperty(window, "__qaDl", { value: st, enumerable: false, configurable: false });
  const push = (type) => { if (st.focus.length < 200) st.focus.push({ type, at: Date.now() }); };
  window.addEventListener("focus", (e) => { if (e.target === window) push("focus"); });
  window.addEventListener("blur", (e) => { if (e.target === window) push("blur"); });
  document.addEventListener("visibilitychange", () => push("visibilitychange"));
  const check = (text) => {
    if (!text) return;
    for (const key in needles) if (!st.seen[key] && text.indexOf(needles[key]) !== -1) st.seen[key] = Date.now();
  };
  const textOf = (node) => {
    if (!node) return "";
    if (node.nodeType === 3) return node.data;
    if (node.nodeType !== 1 || node.nodeName === "SCRIPT" || node.nodeName === "STYLE") return "";
    return node.textContent || "";
  };
  const start = () => {
    check(document.body ? document.body.textContent : "");
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData") check(r.target.data);
        for (const n of r.addedNodes) check(textOf(n));
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  };
  if (document.documentElement) start(); else document.addEventListener("DOMContentLoaded", start);
})();`;

export async function installProbe(context) {
  await context.addInitScript({ content: PROBE_SOURCE });
}

const READ = `(() => { const s = window.__qaDl; return s ? { marker: s.marker, created: s.created, now: Date.now(), focus: s.focus.slice(), seen: Object.assign({}, s.seen) } : null; })()`;
const RESET = `(() => { const s = window.__qaDl; if (s) { for (const k of Object.keys(s.seen)) delete s.seen[k]; } return Boolean(s); })()`;
export const readProbe = (page) => page.evaluate(READ);
export const resetSeen = (page) => page.evaluate(RESET);

/** Leak check (D3), booleans only: needle in the visible text or in any data-* / aria-* attribute. */
const LEAK = (needles) => `(() => {
  const needles = ${JSON.stringify(needles)};
  const text = document.body ? document.body.innerText : "";
  const attrs = [];
  for (const el of document.querySelectorAll("*")) for (const a of el.attributes) if (a.name.startsWith("data-") || a.name.startsWith("aria-")) attrs.push(a.value);
  const blob = text + " " + attrs.join(" ");
  return needles.map((n) => blob.indexOf(n) !== -1);
})()`;
export const leakFlags = (page, needles) => page.evaluate(LEAK(needles));

/**
 * DL-QA-806-001: LATCHING leak observer, armed BEFORE the navigation of each window. Any appearance
 * of a needle — even transient (shown then removed) — in DOM text or in a data-* / aria-* attribute
 * sets a boolean that stays true. Only booleans are kept (needles live in page memory only; the
 * harness never persists them). Re-arming resets the latch.
 */
const ARM_LATCH = (needles) => `(() => {
  const needles = ${JSON.stringify(needles)};
  if (window.__qaDlLatch) window.__qaDlLatch.observer.disconnect();
  const flags = needles.map(() => false);
  const check = (s) => { if (!s) return; for (let i = 0; i < needles.length; i++) if (!flags[i] && s.indexOf(needles[i]) !== -1) flags[i] = true; };
  const attrs = (el) => { if (!el || !el.attributes) return; for (const a of el.attributes) if (a.name.startsWith("data-") || a.name.startsWith("aria-")) check(a.value); };
  const scan = (node) => {
    if (!node) return;
    if (node.nodeType === 3) return check(node.data);
    if (node.nodeType !== 1 || node.nodeName === "SCRIPT" || node.nodeName === "STYLE") return;
    check(node.textContent);
    attrs(node);
    for (const el of node.querySelectorAll("*")) attrs(el);
  };
  scan(document.body);
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") check(r.target.data);
      else if (r.type === "attributes") { if (r.attributeName && (r.attributeName.startsWith("data-") || r.attributeName.startsWith("aria-"))) check(r.target.getAttribute(r.attributeName)); }
      else for (const n of r.addedNodes) scan(n);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  Object.defineProperty(window, "__qaDlLatch", { value: { flags, observer }, configurable: true, enumerable: false });
  return true;
})()`;
const READ_LATCH = `(() => { const l = window.__qaDlLatch; return l ? l.flags.slice() : null; })()`;
export const armLeakLatch = (page, needles) => page.evaluate(ARM_LATCH(needles));
/** Reads the latch after one task tick, so pending mutation records have been delivered. */
export async function readLeakLatch(page) {
  await page.evaluate("new Promise((r) => setTimeout(r, 0))");
  return page.evaluate(READ_LATCH);
}
