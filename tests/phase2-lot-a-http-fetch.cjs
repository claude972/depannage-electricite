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
