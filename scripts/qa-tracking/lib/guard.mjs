// Stop-gate guards for EVERY mutator of the harness (A5.4): service writes (via the shared
// Fixtures/guardWrites), tracking API POSTs sent by the harness, and browser actions that can
// trigger a POST (clicks). Once the gate is raised (SIGINT/SIGTERM/FATAL), each of them refuses
// with StopRequestedError before doing anything; scenarios stop at their next action.
import { api } from "../../qa/lib/browser.mjs";

/** Harness-issued tracking API call from inside a page (user cookies). POSTs are gated + intended. */
export function createTrackingApi({ gate, intents }) {
  return {
    async get(page, path) {
      gate.check();
      return api(page, path);
    },
    async post(page, path, body, key = null) {
      gate.check();
      const id = intents.begin(`api:${body?.action || path.split("/").pop()}`, path, key);
      let answer;
      try {
        answer = await api(page, path, body, "POST");
      } catch (error) {
        throw error; // transport failure: intent stays open (outcome unknown)
      }
      intents.settle(id, answer.status >= 200 && answer.status < 300 ? "done" : "refused", { status: answer.status });
      return answer;
    },
  };
}

/** Browser action that may emit a mutation (click, keyboard). Checked before and after. */
export async function act(gate, fn) {
  gate.check();
  const value = await fn();
  gate.check();
  return value;
}

/** Waits `ms` while staying responsive to the stop gate (no scenario continues after a signal). */
export async function gatedWait(gate, ms, step = 250) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    gate.check();
    await new Promise((r) => setTimeout(r, Math.min(step, until - Date.now())));
  }
  gate.check();
}
