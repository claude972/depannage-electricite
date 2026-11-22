declare module "web-push" {
  export function generateRequestDetails(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number; urgency: "normal" },
  ): { endpoint: string; method: string; headers: Record<string, string | number>; body: Buffer | null };
}
