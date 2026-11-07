// Realtime fix (root probe bb05/H1b): only the 3 published tables, wait:true, honest state on a
// server refusal or system error. Drives the REAL realtime-js channel over a fake socket transport.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RealtimeClient } from "@supabase/realtime-js";
import { REALTIME_CHANNEL_CONFIG, REALTIME_TABLES, nextConnection } from "../../components/app/realtime";

type Reply = (join: { topic: string; ref: string; joinRef: string; payload: Record<string, unknown> }) => unknown[];

function fakeTransport(onJoin: Reply, joins: Record<string, unknown>[]) {
  return class FakeSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = 0; binaryType = "arraybuffer"; url: string;
    onopen: ((e: unknown) => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null;
    constructor(url: string) { this.url = url; setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 1); }
    send(raw: string) {
      const m = JSON.parse(raw);
      const [joinRef, ref, topic, event, payload] = Array.isArray(m) ? m : [m.join_ref, m.ref, m.topic, m.event, m.payload];
      if (event !== "phx_join") return;
      joins.push(payload);
      for (const msg of onJoin({ topic, ref, joinRef, payload })) setTimeout(() => this.onmessage?.({ data: JSON.stringify(msg) }), 2);
    }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  };
}

async function run(onJoin: Reply, expectedEvents = 1) {
  const joins: Record<string, unknown>[] = [];
  const client = new RealtimeClient("ws://realtime.test/socket", { params: { apikey: "test" }, transport: fakeTransport(onJoin, joins) as never, heartbeatIntervalMs: 60_000 } as never);
  let connection = "";
  const seen: string[] = [];
  let finish!: () => void;
  const observed = new Promise<void>((resolve) => { finish = resolve; });
  const record = () => {
    seen.push(connection);
    if (seen.length === expectedEvents) finish();
  };
  let channel = client.channel("workspace-u1", REALTIME_CHANNEL_CONFIG as never);
  channel = channel.on("system" as never, {} as never, ((p: { status?: string }) => { connection = nextConnection(connection, { kind: "system", status: p?.status }); record(); }) as never);
  for (const table of REALTIME_TABLES) channel = channel.on("postgres_changes" as never, { event: "*", schema: "public", table } as never, (() => {}) as never);
  channel.subscribe((status) => { connection = nextConnection(connection, { kind: "status", status }); record(); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Expected ${expectedEvents} Realtime events, observed ${seen.length}`)), 5_000);
  });
  try {
    await Promise.race([observed, deadline]);
    return { joins, connection, seen: [...seen] }; // before teardown (closing reports CHANNEL_ERROR)
  } finally {
    clearTimeout(timer);
    client.disconnect();
  }
}
const reply = (j: { topic: string; ref: string; joinRef: string }, status: string, response: unknown) => [j.joinRef, j.ref, j.topic, "phx_reply", { status, response }];
const okReply = (j: Parameters<Reply>[0]) => {
  const pc = ((j.payload.config as { postgres_changes: { event: string; schema: string; table: string }[] }).postgres_changes).map((b, n) => ({ ...b, id: n + 1 }));
  return reply(j, "ok", { postgres_changes: pc });
};

test("join: exactly the 3 published tables (never payments) and postgres_changes wait:true", async () => {
  const { joins, connection } = await run((j) => [okReply(j)]);
  const config = joins[0].config as { postgres_changes: { table: string }[]; postgres_changes_options?: { wait?: boolean } };
  assert.deepEqual(config.postgres_changes.map((b) => b.table), ["interventions", "quotes", "messages"]);
  assert.equal(config.postgres_changes_options?.wait, true);
  assert.equal(connection, "SUBSCRIBED", "nominal: server confirmed the bindings");
});

test("server refusal (join error) ⇒ CHANNEL_ERROR, never « Connecté »", async () => {
  const { seen } = await run((j) => [reply(j, "error", { reason: "Unable to subscribe to changes" })]);
  assert.ok(!seen.includes("SUBSCRIBED"));
  assert.ok(seen.includes("CHANNEL_ERROR"));
});

test("system error after SUBSCRIBED ⇒ state drops to CHANNEL_ERROR; system ok keeps SUBSCRIBED", async () => {
  const failed = await run((j) => [okReply(j), [null, null, j.topic, "system", { status: "error", message: "Unable to subscribe", extension: "postgres_changes" }]], 2);
  assert.deepEqual(failed.seen.slice(-2), ["SUBSCRIBED", "CHANNEL_ERROR"]);
  assert.equal(failed.connection, "CHANNEL_ERROR");
  const ok = await run((j) => [okReply(j), [null, null, j.topic, "system", { status: "ok", message: "Subscribed to PostgreSQL", extension: "postgres_changes" }]], 2);
  assert.equal(ok.connection, "SUBSCRIBED");
});

test("courant-app subscribes through the shared list and config only", () => {
  const src = readFileSync("components/courant-app.tsx", "utf8");
  assert.match(src, /client\.channel\(`workspace-\$\{profileIdForRealtime\}`, REALTIME_CHANNEL_CONFIG\)/);
  assert.match(src, /for \(const table of REALTIME_TABLES\)/);
  assert.doesNotMatch(src, /"interventions", "quotes", "messages", "payments"/);
});
