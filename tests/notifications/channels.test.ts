import test from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, CHANNEL_ENV, ChannelUnavailableError, detectChannel, detectChannels, sendExternal } from "../../lib/features/notifications/channels";

test("no external channel is available without a configured, supported provider", () => {
  const report = detectChannels({});
  assert.equal(report.in_app, "available");
  for (const channel of ["email", "sms", "push"] as const) {
    assert.equal(report[channel], "unavailable");
    assert.match(report.reasons[channel], /aucun fournisseur configuré/i);
    assert.match(report.reasons[channel], /Aucun envoi n’est effectué/);
  }
  assert.equal(ADAPTERS.length, 0);
});
test("a provider name in the environment does not enable a channel this build cannot drive", () => {
  const detection = detectChannel("email", { [CHANNEL_ENV.email]: "some-provider" });
  assert.equal(detection.state, "unavailable");
  assert.match(detection.reason, /n’est pas pris en charge/);
  assert.match(detection.reason, /some-provider/);
  assert.equal(detectChannel("sms", { [CHANNEL_ENV.sms]: "x".repeat(80) }).reason.includes("x".repeat(41)), false);
});
test("sending through an unavailable channel refuses explicitly and never pretends", async () => {
  await assert.rejects(
    sendExternal("sms", { recipient: "+596000000000", title: "Test", body: "Test" }, {}),
    (error: unknown) => error instanceof ChannelUnavailableError && error.channel === "sms" && /aucun fournisseur/i.test(error.message),
  );
  await assert.rejects(sendExternal("push", { recipient: "token", title: "Test", body: "Test" }, { [CHANNEL_ENV.push]: "fcm" }), ChannelUnavailableError);
});
