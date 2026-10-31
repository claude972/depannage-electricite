// Bounded UI observation windows for "the interface issues no write" assertions (contract §20).
// The network log of a page (method/path/status, kept by newPage) also contains the DRIVER's own
// probes (deliberate refused POSTs). A window starts at an immutable baseline taken after those
// probes are settled; inside it, ANY mutating request to /api/ is a FAIL whatever its status.
import assert from "node:assert/strict";

const MUTATING = (n) => n.method !== "GET" && n.method !== "HEAD";
export const mutationsIn = (list, prefix = "/api/") => list.filter((n) => MUTATING(n) && typeof n.path === "string" && n.path.startsWith(prefix));

/**
 * Baseline after the driver probes: waits until exactly `driverMutations` mutating requests have
 * been observed since `since` (response events may land after the probe resolved), then freezes the
 * index. More than expected ⇒ FAIL (an unexplained write during the probes); never observed within
 * the timeout ⇒ harness anomaly (plain Error).
 */
export async function settledBaseline(h, { since = 0, driverMutations = 0, timeoutMs = 5000, prefix = "/api/" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let seen = mutationsIn(h.network.slice(since), prefix).length;
  while (seen < driverMutations && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    seen = mutationsIn(h.network.slice(since), prefix).length;
  }
  if (seen < driverMutations) throw new Error(`network log: ${seen}/${driverMutations} driver mutation(s) observed before the UI window`);
  assert.equal(seen, driverMutations, `unexpected mutating request(s) during the driver probes: ${JSON.stringify(mutationsIn(h.network.slice(since), prefix))}`);
  return Object.freeze({ index: h.network.length });
}

/** No mutating request to `prefix` inside the window (from the baseline to now), whatever its status. */
export function assertNoUiWrites(h, baseline, prefix = "/api/") {
  const writes = mutationsIn(h.network.slice(baseline.index), prefix);
  assert.deepEqual(writes, [], `interface issued ${writes.length} write request(s) during the observed UI navigation: ${JSON.stringify(writes)}`);
  return { window_from: baseline.index, observed: h.network.length - baseline.index };
}
