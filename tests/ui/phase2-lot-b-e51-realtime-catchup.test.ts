// E51 (registre phase 2) — SYS-05 : état périmé après reconnexion du canal. Attendu (P6) : quand le
// canal redevient SUBSCRIBED après une perte (fermeture du socket, erreur), un GET de rattrapage est
// demandé une fois ; jamais au premier abonnement (le démarrage a déjà lu le workspace).
// Vrai canal @supabase/realtime-js (transport simulé : rejointure réelle du SDK après coupure) et la
// vraie décision partagée du shell (components/app/realtime.ts → createRealtimeCatchUp).
// Preuve au niveau SDK + décision partagée ; la reproduction DOM d’origine est dans le registre.
import test from "node:test";
import assert from "node:assert/strict";
import { RealtimeClient } from "@supabase/realtime-js";
import * as RT from "../../components/app/realtime";

const sockets: { close(): void }[] = [];
function transport() {
  return class FakeSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = 0; binaryType = "arraybuffer"; url: string;
    onopen: ((e: unknown) => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
    onclose: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null;
    constructor(url: string) { this.url = url; sockets.push(this); setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 1); }
    send(raw: string) {
      const m = JSON.parse(raw);
      const [joinRef, ref, topic, event, payload] = Array.isArray(m) ? m : [m.join_ref, m.ref, m.topic, m.event, m.payload];
      if (event !== "phx_join") return;
      const pc = (payload.config.postgres_changes as { event: string; schema: string; table: string }[]).map((b, n) => ({ ...b, id: n + 1 }));
      setTimeout(() => this.onmessage?.({ data: JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: pc } }]) }), 2);
    }
    close() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
  };
}
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("E51 · reconnexion du canal ⇒ un rattrapage ; premier abonnement ⇒ aucun", async () => {
  const create = (RT as Record<string, unknown>).createRealtimeCatchUp as ((onCatchUp: () => void) => (status: string) => void) | undefined;
  assert.equal(typeof create, "function", "décision de rattrapage partagée exposée par components/app/realtime.ts");
  let catchUps = 0;
  const onStatus = create!(() => catchUps++);
  const statuses: string[] = [];
  const client = new RealtimeClient("ws://realtime.test/socket", { params: { apikey: "test" }, transport: transport() as never, heartbeatIntervalMs: 60_000, reconnectAfterMs: () => 20 } as never);
  let channel = client.channel("workspace-u1", RT.REALTIME_CHANNEL_CONFIG as never);
  for (const table of RT.REALTIME_TABLES) channel = channel.on("postgres_changes" as never, { event: "*", schema: "public", table } as never, (() => {}) as never);
  channel.subscribe((status) => { statuses.push(status); onStatus(status); });
  try {
    for (let i = 0; i < 100 && !statuses.includes("SUBSCRIBED"); i++) await tick(10);
    assert.equal(catchUps, 0, "premier abonnement : pas de rattrapage");
    sockets[sockets.length - 1].close(); // network cut: the SDK reconnects and rejoins by itself
    for (let i = 0; i < 300 && statuses.filter((s) => s === "SUBSCRIBED").length < 2; i++) await tick(10);
    assert.ok(statuses.filter((s) => s === "SUBSCRIBED").length >= 2, `rejointure observée (${statuses.join(",")})`);
    assert.equal(catchUps, 1, `un rattrapage après la reconnexion (${statuses.join(",")})`);
    // System error after the rejoin, then a new SUBSCRIBED ⇒ one more catch-up.
    onStatus("CHANNEL_ERROR"); onStatus("SUBSCRIBED");
    assert.equal(catchUps, 2);
  } finally {
    client.disconnect();
  }
});

test("E51 · le shell branche la décision de rattrapage sur le canal du workspace", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("components/courant-app.tsx", "utf8");
  assert.match(src, /createRealtimeCatchUp\(/, "le shell utilise la décision partagée");
});
