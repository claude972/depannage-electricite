// Bounded UI observation windows for "the interface issues no write" assertions (contract §20,
// §20 bis). A window is an OPAQUE object created only here, bound to the page handle that opened
// it, with a frozen baseline index and a `page.on("request")` listener attached synchronously at
// opening: every mutating /api/ request is counted at EMISSION time (method + path only), so a UI
// write whose response is still pending already fails. Driver probes emitted before the window
// are excluded by construction.
import assert from "node:assert/strict";

const MUTATING = (method) => method !== "GET" && method !== "HEAD";
export const mutationsIn = (list, prefix = "/api/") => list.filter((n) => MUTATING(n.method) && typeof n.path === "string" && n.path.startsWith(prefix));

const windows = new WeakMap();
class WindowError extends Error {
  constructor(message) {
    super(`UI window: ${message}`);
    this.name = "UiWindowError";
  }
}

function pathOf(url, origin) {
  try {
    const u = new URL(url);
    if (origin && u.origin !== origin) return null;
    return u.pathname;
  } catch {
    return null;
  }
}

/**
 * Opens a window after the driver probes. Waits until exactly `driverMutations` mutating requests
 * have been recorded in `h.network` since `since` (late response events included); more ⇒ FAIL,
 * never observed ⇒ harness error. Then, with no await in between, freezes the baseline index and
 * attaches the emission listener. Returns an opaque frozen token.
 */
export async function openUiWindow(h, { since = 0, driverMutations = 0, timeoutMs = 5000, prefix = "/api/", origin = null } = {}) {
  if (!h || !Array.isArray(h.network) || !h.page || typeof h.page.on !== "function") throw new WindowError("handle without page or network log");
  if (!Number.isInteger(since) || since < 0 || since > h.network.length) throw new WindowError("invalid `since` index");
  const deadline = Date.now() + timeoutMs;
  let seen = mutationsIn(h.network.slice(since), prefix).length;
  while (seen < driverMutations && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    seen = mutationsIn(h.network.slice(since), prefix).length;
  }
  if (seen < driverMutations) throw new Error(`network log: ${seen}/${driverMutations} driver mutation(s) observed before the UI window`);
  assert.equal(seen, driverMutations, `unexpected mutating request(s) during the driver probes: ${JSON.stringify(mutationsIn(h.network.slice(since), prefix))}`);
  // ---- synchronous from here: baseline and listener are set before any later emission.
  const emitted = [];
  const listener = (request) => {
    try {
      const method = request.method();
      const path = pathOf(request.url(), origin);
      if (path && path.startsWith(prefix) && MUTATING(method)) emitted.push(Object.freeze({ method, path }));
    } catch {
      emitted.push(Object.freeze({ method: "UNKNOWN", path: "unreadable request" }));
    }
  };
  h.page.on("request", listener);
  const token = Object.freeze(Object.create(null));
  windows.set(token, { handle: h, index: h.network.length, emitted, listener, prefix, closed: false });
  return token;
}
/** Backwards-compatible name used by the suites. */
export const settledBaseline = openUiWindow;

function stateOf(h, token) {
  const state = token !== null && typeof token === "object" ? windows.get(token) : undefined;
  if (!state) throw new WindowError("not a window opened by openUiWindow (forged, malformed or missing)");
  if (state.handle !== h) throw new WindowError("window belongs to another page handle");
  if (!Number.isInteger(state.index) || state.index < 0 || state.index > h.network.length) throw new WindowError("baseline index out of range for this handle's log");
  return state;
}

/** Zero mutating /api/ request EMITTED (or recorded) since the window opened, whatever its status or response state. */
export function assertNoUiWrites(h, token) {
  const state = stateOf(h, token);
  const recorded = mutationsIn(h.network.slice(state.index), state.prefix);
  const writes = { emitted: [...state.emitted], recorded };
  assert.ok(state.emitted.length === 0 && recorded.length === 0, `interface issued write request(s) during the observed UI navigation: ${JSON.stringify(writes)}`);
  return { window_from: state.index, observed_responses: h.network.length - state.index, emitted_writes: 0 };
}
/** Detaches the emission listener; later assertions on the token remain valid (log frozen). */
export function closeUiWindow(h, token) {
  const state = stateOf(h, token);
  if (!state.closed) {
    state.closed = true;
    if (typeof h.page.off === "function") h.page.off("request", state.listener);
  }
}
