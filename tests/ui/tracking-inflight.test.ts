// Revue ROOT 8bcee45 : une seule demande d’itinéraire en vol par carte.
// 1) Tests de l’ordonnanceur pur (RouteScheduler) ; 2) scénario ROOT porté : le VRAI corps de CardBody (source du
// dépôt compilée par esbuild) piloté par un shim de hooks React, horloge et minuteries factices — mêmes effets que
// le navigateur, sans DOM ni réseau.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { RouteScheduler, failureOf } from "../../components/features/tracking/model";
import type { TrackingRoute } from "../../lib/features/tracking/types";

const T0 = Date.parse("2026-10-31T20:00:00Z");
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}
const fakeRoute = (seq: number) => ({ point_seq: seq } as unknown as TrackingRoute);

// ---- 1) Ordonnanceur pur ---------------------------------------------------------------------------
test("une demande en vol bloque toute autre demande (minuterie, nouvel état, manuel), même après 30 s", async () => {
  const s = new RouteScheduler();
  const d = deferred<TrackingRoute | null>();
  let calls = 0;
  const route = () => (calls++, d.promise);
  let current = "k1";
  const first = s.request(T0, "k1", route, () => current);
  assert.ok(first);
  assert.equal(s.request(T0 + 15_000, "k2", route, () => "k2"), null, "nouvel état à 15 s");
  assert.equal(s.request(T0 + 30_000, "k2", route, () => "k2"), null, "minuterie à 30 s");
  assert.equal(s.request(T0 + 31_000, "k2", route, () => "k2"), null, "clic manuel");
  assert.equal(s.waitMs(T0 + 30_000, "k2"), Infinity);
  assert.equal(calls, 1);
  current = "k2"; // le sondage a apporté un nouvel état pendant le vol
  d.resolve(fakeRoute(1));
  const out = await first!;
  assert.equal(out.kind, "stale", "contexte changé (k1 → k2) : résultat ignoré");
  assert.equal(s.busy, false);
  assert.equal(s.waitMs(T0 + 30_000, "k2"), 0, "suivi permis, 30 s respectées");
  assert.ok(s.request(T0 + 30_000, "k2", route, () => "k2"));
  assert.equal(calls, 2);
});

test("après règlement : ≥ 30 s et Retry-After toujours respectés ; 409 bloque l’état", async () => {
  const s = new RouteScheduler();
  const d = deferred<TrackingRoute | null>();
  const p = s.request(T0, "k", () => d.promise, () => "k", () => T0 + 5_000)!;
  d.reject(Object.assign(new Error("quota"), { status: 503, reason: "provider_quota", retry_after_s: 45 }));
  const out = await p;
  assert.equal(out.kind, "failure");
  assert.equal(s.waitMs(T0 + 30_000, "k"), 20_000, "Retry-After compté depuis l’échec (5 s + 45 s)");
  const s409 = new RouteScheduler();
  const d2 = deferred<TrackingRoute | null>();
  const p2 = s409.request(T0, "k", () => d2.promise, () => "k")!;
  d2.reject(Object.assign(new Error("changed"), { status: 409 }));
  await p2;
  assert.equal(s409.waitMs(T0 + 60_000, "k"), Infinity);
  assert.equal(s409.waitMs(T0 + 60_000, "k2"), 0);
  assert.equal(failureOf({ status: 409 }).status, 409);
});

test("un règlement ancien ne libère pas un jeton plus récent ; invalidation : résultat ignoré, jeton libéré au règlement", async () => {
  const s = new RouteScheduler(0);
  const a = deferred<TrackingRoute | null>();
  const pa = s.request(T0, "k", () => a.promise, () => "k")!;
  s.invalidate(); // démontage / changement de dossier
  assert.equal(s.busy, true, "jeton tenu jusqu’au règlement");
  a.resolve(fakeRoute(1));
  assert.equal((await pa).kind, "stale");
  assert.equal(s.busy, false);
  const b = deferred<TrackingRoute | null>();
  const pb = s.request(T0 + 1, "k", () => b.promise, () => "k")!;
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0)); // les finally de A sont passés
  assert.equal(s.busy, true, "le jeton de B reste tenu");
  b.resolve(fakeRoute(2));
  assert.equal((await pb).kind, "result");
  assert.equal(s.busy, false);
});

// ---- 2) Scénario ROOT porté sur le vrai CardBody -----------------------------------------------------
type Slot = { value?: unknown; current?: unknown; fn?: unknown; deps?: unknown[]; cleanup?: (() => void) | void };
function harness() {
  let now = T0;
  let cursor = 0;
  let dirty = true;
  const slots: Slot[] = [];
  let effects: (() => void)[] = [];
  const timers = new Map<number, { fn: () => void; at: number; interval: number }>();
  let tid = 0;
  let seq = 0;
  const routes: ReturnType<typeof deferred<TrackingRoute | null>>[] = [];
  let recalc: (() => void) | null = null;
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(init: unknown) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof init === "function" ? (init as () => unknown)() : init };
      return [slots[i].value, (v: unknown) => {
        const next = typeof v === "function" ? (v as (x: unknown) => unknown)(slots[i].value) : v;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; }
      }];
    },
    useRef(value: unknown) { const i = cursor++; if (!slots[i]) slots[i] = { current: value }; return slots[i]; },
    useCallback(fn: unknown, deps: unknown[]) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn: () => (() => void) | void, deps?: unknown[]) {
      const i = cursor++;
      if (!slots[i] || !deps || !same(slots[i].deps, deps)) {
        const old = slots[i];
        slots[i] = { deps, cleanup: old?.cleanup };
        effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  class Clock extends Date {
    constructor(...args: unknown[]) { super(...((args.length ? args : [now]) as [number])); }
    static now() { return now; }
  }
  const add = (fn: () => void, ms: number, interval: number) => { const id = ++tid; timers.set(id, { fn, at: now + ms, interval }); return id; };
  const win = { setTimeout: (fn: () => void, ms: number) => add(fn, ms, 0), clearTimeout: (id: number) => timers.delete(id), setInterval: (fn: () => void, ms: number) => add(fn, ms, ms), clearInterval: (id: number) => timers.delete(id) };
  const textOf = (c: unknown): string => (Array.isArray(c) ? c.map(textOf).join("") : typeof c === "string" ? c : "");
  const jsx = (type: unknown, props: { onClick?: () => void; children?: unknown; disabled?: boolean }) => {
    if (props?.onClick && /Recalculer/.test(textOf(props.children))) recalc = props.onClick;
    return null;
  };
  const root = join(process.cwd(), "components/features/tracking");
  const compile = (file: string, imports: Record<string, unknown>) => {
    const mod = { exports: {} as Record<string, unknown> };
    const code = transformSync(readFileSync(join(root, file), "utf8").replace("function CardBody(", "export function CardBody("), { loader: "tsx", format: "cjs", target: "es2022", jsx: "automatic" }).code;
    vm.runInNewContext(code, { module: mod, exports: mod.exports, require: (n: string) => { if (n in imports) return imports[n]; throw new Error(`import non prévu : ${n}`); }, Date: Clock, Intl, window: win, Symbol, Promise, console, Math, Number, Object, Array, Error });
    return mod.exports;
  };
  const model = compile("model.ts", {});
  const card = compile("tracking-card.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "f" },
    "./model": model,
    "./props": { trackingKey: () => "" },
    "./tracking-map": { TrackingMap: () => null },
    "./destination-picker": { DestinationPicker: () => null },
    "../../app/ui": { Loader: () => null, Tag: () => null, Unavailable: () => null },
    "../../app/icons": { Icon: () => null },
    "./tracking.module.css": { default: {} },
  }) as { CardBody: (p: unknown) => unknown };
  let routeCalls = 0;
  const client = {
    load: async () => {
      const at = new Clock().toISOString();
      return {
        server_time: at, permissions: { can_share: false, can_confirm_destination: false },
        tracking: { intervention_id: "job", artisan_id: "artisan", travel_stage: "en_route", session_id: "sid", control_version: 2, shared: true, consent_at: at, last_seq: ++seq, destination_version: 1, position_state: "fresh",
          position: { latitude: 14.6, longitude: -61.06, accuracy_m: 10, sampled_at: at, received_at: at },
          destination: { latitude: 14.61, longitude: -61.05, label: "QA", source: "manual", confirmed_by: "client", confirmed_at: at } },
      };
    },
    route: () => { routeCalls++; const d = deferred<TrackingRoute | null>(); routes.push(d); return d.promise; },
    command: async () => null, geocode: async () => null,
  };
  const props = { state: "available", unavailableMessage: "", scope: { userId: "client", role: "client", authority: { canWrite: false } }, client, interventionId: "job", now: () => now };
  async function flush() {
    for (let n = 0; n < 30; n++) {
      if (dirty) { dirty = false; cursor = 0; effects = []; recalc = null; card.CardBody(props); const q = effects; effects = []; for (const run of q) run(); }
      await new Promise((r) => setImmediate(r));
      if (!dirty) return;
    }
    throw new Error("rendu instable");
  }
  async function advance(target: number) {
    for (let n = 0; n < 300; n++) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      const [id, t] = next;
      now = t.at;
      timers.delete(id);
      if (t.interval) timers.set(id, { ...t, at: now + t.interval });
      t.fn();
      await flush();
    }
    now = target;
    await flush();
  }
  return { flush, advance, routes, get routeCalls() { return routeCalls; }, get seq() { return seq; }, click: async () => { recalc?.(); await flush(); }, hasRecalc: () => recalc !== null };
}

test("scénario ROOT : route en vol à t0, nouvel état à t15, minuterie à t30 ⇒ une seule demande ; puis un seul suivi", async () => {
  const h = harness();
  await h.flush();
  await h.advance(T0);
  assert.equal(h.routeCalls, 1, "t0 : première demande");
  await h.advance(T0 + 15_000);
  assert.ok(h.seq >= 2, "sondage : nouvel état");
  assert.equal(h.routeCalls, 1, "t15 : aucune seconde demande");
  await h.advance(T0 + 30_000);
  assert.equal(h.routeCalls, 1, "t30 : toujours une seule demande en vol (repro ROOT : 2 avant correctif)");
  await h.click();
  assert.equal(h.routeCalls, 1, "clic « Recalculer » pendant le vol : aucune demande");
  await h.advance(T0 + 60_000);
  assert.equal(h.routeCalls, 1, "aucune demande tant que la première n’est pas réglée");
  h.routes[0].resolve(null);
  await h.flush();
  await h.advance(T0 + 60_001);
  assert.equal(h.routeCalls, 2, "règlement : exactement un suivi pour le nouvel état");
  await h.advance(T0 + 75_000);
  assert.equal(h.routeCalls, 2, "le suivi est lui-même en vol : pas de troisième");
});
