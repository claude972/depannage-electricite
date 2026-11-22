import test from "node:test";
import assert from "node:assert/strict";
import { ApiRequestError, api, parseApiBody } from "../../components/app/api";
import { paymentReturnMessage } from "../../components/app/session";

const respond = (status: number, body: string, type = "application/json") => async () =>
  new Response(body, { status, headers: { "Content-Type": type } });

test("valid JSON on 2xx is returned", async () => {
  const data = await api<{ ok: boolean }>("/api/x", undefined, undefined, respond(200, '{"ok":true}'));
  assert.deepEqual(data, { ok: true });
});
test("a 200 with malformed or non-object body is not a success (CL-UI-004)", async () => {
  for (const body of ["<html>proxy</html>", "", "null", '"text"', "{broken"])
    await assert.rejects(
      api("/api/x", { a: 1 }, undefined, respond(200, body, "text/html")),
      (e: unknown) => e instanceof ApiRequestError && e.status === 502 && /rechargez/.test(e.message),
    );
});
test("non-2xx surfaces the server error text or a safe default", async () => {
  await assert.rejects(api("/api/x", undefined, undefined, respond(409, '{"error":"Conflit"}')), (e: unknown) =>
    e instanceof ApiRequestError && e.status === 409 && e.message === "Conflit");
  await assert.rejects(api("/api/x", undefined, undefined, respond(404, "nope")), (e: unknown) =>
    e instanceof ApiRequestError && e.status === 404 && /pas encore activée/.test(e.message));
  await assert.rejects(api("/api/x", undefined, undefined, respond(500, "<html>")), (e: unknown) =>
    e instanceof ApiRequestError && e.status === 500);
  assert.throws(() => parseApiBody(401, false, ""), (e: unknown) => e instanceof ApiRequestError && e.status === 401);
});
test("network failure on a mutation reports an uncertain outcome", async () => {
  await assert.rejects(
    api("/api/x", { a: 1 }, undefined, async () => {
      throw new TypeError("Failed to fetch");
    }),
    (e: unknown) => e instanceof ApiRequestError && e.status === 0 && /a pu être enregistrée/.test(e.message),
  );
});
test("payment return wording follows the server, not the URL (CL-UI-003)", () => {
  assert.equal(paymentReturnMessage("cancelled", "paid").tone, "success", "forged cancel URL cannot hide a confirmed payment");
  assert.equal(paymentReturnMessage("pending", "failed").tone, "error");
  assert.doesNotMatch(paymentReturnMessage("pending", "failed").text, /aucun montant|aucun débit/i, "no banking promise");
  assert.doesNotMatch(paymentReturnMessage("cancelled", "none").text, /aucun débit/i);
  assert.match(paymentReturnMessage("cancelled", "none").text, /Aucun règlement n’est confirmé/);
  assert.match(paymentReturnMessage("pending", "unknown").text, /n’a pas pu être relu/);
  assert.equal(paymentReturnMessage("pending", "pending").tone, "info");
});
