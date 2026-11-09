// Preload for the isolated Next child only. Block network outside the loopback
// fixture, including any unexpected provider endpoint.
const realFetch = globalThis.fetch;
globalThis.fetch = async function fixtureFetch(input, options) {
  const address = typeof input === "string" || input instanceof URL ? input : input.url;
  const url = new URL(address);
  if (url.origin === process.env.NEXT_PUBLIC_SUPABASE_URL) return realFetch(input, options);
  if (options?.method === "POST" && url.href === "https://api.resend.com/emails") {
    return Response.json({ id: "c2438f43-ecc3-4d65-8838-16daaccc3c47" }, { status: 200 });
  }
  if (options?.method === "POST" && url.href === "https://fcm.googleapis.com/fcm/send/fixture-endpoint") {
    return new Response(null, { status: 201 });
  }
  throw new Error("Unexpected outbound network call in the isolated HTTP fixture");
};

// Preserve the Stripe SDK's Node transport and error parsing, but send only the
// expected test request to a disposable loopback server.
if (process.env.QA_STRIPE_LOOPBACK_PORT) {
  const https = require("node:https");
  const http = require("node:http");
  https.request = (options, callback) => {
    const allowed = process.env.QA_STRIPE_FIXTURE === "refund"
      ? (options.method === "GET" && /^\/v1\/(checkout\/sessions\/cs_test_QA[a-z0-9]+|payment_intents\/pi_QA|charges\/ch_QA)$/.test(options.path))
        || (options.method === "POST" && options.path === "/v1/refunds")
      : options.method === "POST" && options.path === "/v2/core/accounts";
    if (options.host !== "api.stripe.com" || !allowed) {
      throw new Error("Unexpected HTTPS request in the isolated Stripe fixture");
    }
    return http.request({
      hostname: "127.0.0.1", port: Number(process.env.QA_STRIPE_LOOPBACK_PORT),
      path: options.path, method: options.method, headers: options.headers,
    }, callback);
  };
}
