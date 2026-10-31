// Counting windows (contract A2 P2-2, A3, A3b). A window opens only through the passive gate:
//   no GET /api/workspace in flight  AND  ≥ quietMs since the last workspace activity
//   AND  ≥ guardMs since the last window focus/blur/visibility event (or the page creation).
// Gate not reached within timeoutMs ⇒ BLOCKED. Inside a clean window every UI GET started after the
// opening is attributed to the action: a wrong count is a FAIL (never generalised to BLOCKED). A
// focus/visibility event inside the window makes the count unattributable ⇒ BLOCKED.
import { AppDefect } from "../../qa/lib/report.mjs";
import { readProbe } from "./probe.mjs";
import { REVALIDATE_GUARD_MS, QUIET_MS, GATE_TIMEOUT_MS, SETTLE_TIMEOUT_MS } from "./constants.mjs";

export function blocked(message) {
  const error = new Error(message);
  error.blocked = true;
  return error;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pure gate decision (unit-tested with ROOT's t0/t7/t15 counter-example). */
export function gateOpen({ probe, inFlight, lastActivity, nowMs, guardMs = REVALIDATE_GUARD_MS, quietMs = QUIET_MS }) {
  if (!probe) return { open: false, why: "probe missing" };
  const lastFocus = probe.focus.reduce((m, e) => Math.max(m, e.at), probe.created);
  if (inFlight > 0) return { open: false, why: "workspace request in flight" };
  if (nowMs - lastActivity < quietMs) return { open: false, why: "workspace not quiet" };
  if (probe.now - lastFocus < guardMs) return { open: false, why: "revalidation guard" };
  return { open: true };
}

export async function openCleanWindow({ page, observer, gate = null, now = Date.now, sleep = defaultSleep, guardMs = REVALIDATE_GUARD_MS, quietMs = QUIET_MS, timeoutMs = GATE_TIMEOUT_MS, pollMs = 200 }) {
  const deadline = now() + timeoutMs;
  let last = "not evaluated";
  while (now() <= deadline) {
    gate?.check();
    const probe = await readProbe(page);
    const decision = gateOpen({ probe, inFlight: observer.inFlightWorkspace().length, lastActivity: observer.lastWorkspaceActivity(), nowMs: now(), guardMs, quietMs });
    if (decision.open) return { openedAt: now(), pageOpenedAt: probe.now, marker: probe.marker };
    last = decision.why;
    await sleep(pollMs);
  }
  throw blocked(`revalidation gate not reached within ${timeoutMs} ms (${last})`);
}

/** Waits for the window's requests to settle (bounded), then measures it. */
export async function closeWindow({ page, observer, win, now = Date.now, sleep = defaultSleep, quietMs = QUIET_MS, timeoutMs = SETTLE_TIMEOUT_MS, pollMs = 100 }) {
  const deadline = now() + timeoutMs;
  let settled = false;
  while (now() <= deadline) {
    if (!observer.inFlightWorkspace().length && now() - observer.lastWorkspaceActivity() >= quietMs) {
      settled = true;
      break;
    }
    await sleep(pollMs);
  }
  const closedAt = now();
  const probe = await readProbe(page);
  const gets = observer.workspaceGets({ from: win.openedAt, to: closedAt });
  return {
    settled,
    count: gets.length,
    statuses: gets.map((g) => g.status),
    focusInWindow: probe ? probe.focus.filter((e) => e.at >= win.pageOpenedAt).length : null,
    sameDocument: Boolean(probe) && probe.marker === win.marker,
    authEvents: observer.authEvents({ from: win.openedAt, to: closedAt }),
    seen: probe ? probe.seen : {},
  };
}

/** Verdict of one window: BLOCKED only for unattributable windows; everything else is FAIL or pass. */
export function assertWindow(w, expected, what) {
  if (w.focusInWindow === null) throw blocked(`${what}: probe missing at the end of the window`);
  if (w.focusInWindow > 0) throw blocked(`${what}: passive revalidation in window (${w.focusInWindow} focus/visibility event(s))`);
  if (!w.settled) throw blocked(`${what}: workspace requests did not settle`);
  if (!w.sameDocument) throw new AppDefect(`${what}: the document changed (reload) during the window`);
  if (w.authEvents.length) throw new AppDefect(`${what}: auth event(s) during the window (${w.authEvents.join(", ")})`);
  if (w.count !== expected) throw new AppDefect(`${what}: ${w.count} GET /api/workspace in a clean window (expected ${expected})`);
  return w;
}
