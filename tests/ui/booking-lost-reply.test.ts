// LOCAL PROOF (no cloud, no Chromium) of finding 1 on the current controller: a POST whose reply
// is lost AFTER the server committed leaves the draft and an enabled « Envoyer ma demande »; a
// second click POSTs again and the server stores a second row (no idempotency key).
// Uses the REAL api() helper against a local HTTP server that commits then drops the socket.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { api, ApiRequestError } from "../../components/app/api";

test("lost reply after commit ⇒ status 0 « a pu être enregistrée », and a naive resend creates a 2nd row", async () => {
  const rows: unknown[] = [];
  let dropNext = true;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      rows.push(JSON.parse(body)); // the server COMMITS first
      if (dropNext) {
        dropNext = false;
        req.socket.destroy(); // then the reply is lost
        return;
      }
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ intervention: { id: `row-${rows.length}` } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/interventions`;
  const values = { category: "socket", description: "Prestation choisie : Plusieurs prises sans courant.", address: "2 rue Test", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled" };
  try {
    await assert.rejects(api(url, values), (e: unknown) => e instanceof ApiRequestError && e.status === 0 && /a pu être enregistrée/.test(e.message));
    assert.equal(rows.length, 1, "the first POST was committed although the client saw an error");
    // What BookingConfirm does on the next click today: PATCH (idempotent) then the same POST.
    const second = await api<{ intervention: { id: string } }>(url, values);
    assert.equal(second.intervention.id, "row-2");
    assert.equal(rows.length, 2, "DUPLICATE: two dossiers for one booking");
  } finally {
    server.close();
  }
});

test("current code: nothing prevents that resend (facts the proof relies on)", () => {
  const app = readFileSync("components/courant-app.tsx", "utf8");
  const create = app.slice(app.indexOf("async function createIntervention"), app.indexOf("async function createIntervention") + 4000);
  assert.match(create, /const result = await api<\{ intervention: Intervention \}>\("\/api\/interventions", values\);/);
  assert.doesNotMatch(create, /idempot|request_id|Idempotency-Key/i, "no idempotency key sent");
  const confirm = readFileSync("components/role/booking-confirm.tsx", "utf8");
  assert.match(confirm, /disabled=\{sending \|\| busy \|\| editingContact\}/, "the send button is re-enabled once the failed chain ends");
  assert.doesNotMatch(confirm, /status === 0|uncertain|vérifier son état/, "no unknown-outcome state in the confirmation");
  const route = readFileSync("app/api/interventions/route.ts", "utf8");
  assert.doesNotMatch(route, /idempot|Idempotency-Key|client_request_id/i, "the route has no idempotency key");
});
