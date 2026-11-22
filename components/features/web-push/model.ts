// Web push enrollment — pure model + browser adapters (injected), no React. Contract given by ROOT
// (backend, route and service-worker statics in progress; nothing here edits them):
//   GET  /api/notifications/push → { available, public_key: string | null,
//        enrollment: null | { version, opted_in, browser: "none" | "current" | "other" } }
//   POST same route (same-origin) { action: "register", expected_version, consent: true,
//        subscription: { endpoint, keys: { p256dh, auth } } } | { action: "remove", expected_version }
//        → same view. One account, one chosen browser: a new browser replaces the previous one.
// The subscription (endpoint / keys) only lives in memory for the POST: never stored nor logged.
import { z } from "zod";

export const PUSH_PATH = "/api/notifications/push";
export const PUSH_TIMEOUT_MS = 15_000;
export const READY_TIMEOUT_MS = 3_000;
export type Result = { status: number; body: unknown };
export type Context = { generation(): number; userId(): string | null };

export const pushView = z
  .object({
    available: z.boolean(),
    public_key: z.string().regex(/^[A-Za-z0-9_-]{40,200}$/).nullable(),
    enrollment: z.object({ version: z.number().int().min(0).max(2147483647), opted_in: z.boolean(), browser: z.enum(["none", "current", "other"]) }).strict().nullable(),
  })
  .strict()
  .refine((v) => !v.available || v.public_key !== null);
export type PushView = z.infer<typeof pushView>;
export const parsePushView = (body: unknown): PushView | null => {
  const r = pushView.safeParse(body);
  return r.success ? r.data : null;
};
export type SubscriptionJSON = { endpoint: string; keys: { p256dh: string; auth: string } };
// Same shape as the route (5c6703c): p256dh 87 chars (65-byte point), auth 22 chars (16 bytes).
const subscriptionJson = z.object({ endpoint: z.string().url().max(2048), keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }) });
export type PushCommand = { action: "register"; expected_version: number; consent: true; subscription: SubscriptionJSON } | { action: "remove"; expected_version: number };

export type PushApi = { load(): Promise<Result>; command(body: PushCommand): Promise<Result> };
async function timed(fetcher: typeof fetch, init: RequestInit): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: -1, body: null });
    }, PUSH_TIMEOUT_MS);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(PUSH_PATH, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export function createPushApi(fetcher: typeof fetch = (...a) => fetch(...a)): PushApi {
  return {
    load: () => timed(fetcher, { method: "GET" }),
    command: (body) => timed(fetcher, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  };
}

// ---- Browser adapters (injected in tests) -----------------------------------------------------------
export type PushSub = { options?: { applicationServerKey?: ArrayBuffer | null }; toJSON(): unknown; unsubscribe(): Promise<boolean> };
export type PushReg = {
  active: { postMessage(message: unknown, transfer: Transferable[]): void } | null;
  pushManager: { getSubscription(): Promise<PushSub | null>; subscribe(options: { userVisibleOnly: true; applicationServerKey: Uint8Array }): Promise<PushSub> };
};
export type PushEnv = {
  /** Service worker + PushManager + Notification present. */
  supported(): boolean;
  permission(): "granted" | "denied" | "default";
  /** The page's service-worker registration (none ⇒ null). */
  registration(): Promise<PushReg | null>;
};
export function browserEnv(): PushEnv {
  return {
    supported: () =>
      typeof window !== "undefined" && typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    permission: () => (typeof Notification !== "undefined" ? Notification.permission : "denied"),
    registration: async () => ((await navigator.serviceWorker.getRegistration()) as unknown as PushReg | undefined) ?? null,
  };
}
/** The worker answers { type: "PRIVATE_PUSH_READY" } to { type: "CHECK_PRIVATE_PUSH" } on a MessageChannel, in time. */
export function checkReady(reg: PushReg | null, timeoutMs = READY_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    if (!reg?.active || typeof MessageChannel !== "function") return resolve(false);
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, timeoutMs);
    channel.port1.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve((e.data as { type?: unknown } | null)?.type === "PRIVATE_PUSH_READY");
    };
    try {
      reg.active.postMessage({ type: "CHECK_PRIVATE_PUSH" }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}
/** VAPID public key (base64url) → bytes for applicationServerKey. */
export function keyBytes(publicKey: string): Uint8Array | null {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const out: number[] = [];
  let acc = 0, bits = 0;
  for (const ch of publicKey) {
    const v = alphabet.indexOf(ch);
    if (v < 0) return null;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return out.length === 65 && out[0] === 4 ? new Uint8Array(out) : null; // uncompressed P-256 point
}
export function sameKey(sub: PushSub | null, bytes: Uint8Array): boolean {
  const k = sub?.options?.applicationServerKey;
  if (!k) return false;
  const a = new Uint8Array(k);
  return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
}
export function subscriptionBody(sub: PushSub): SubscriptionJSON | null {
  const r = subscriptionJson.safeParse(sub.toJSON());
  return r.success ? { endpoint: r.data.endpoint, keys: { p256dh: r.data.keys.p256dh, auth: r.data.keys.auth } } : null;
}

/** Channel tag of the preferences: « Disponible » only when the server says available; « Actif sur
 *  ce navigateur » ONLY for an opted-in enrollment of THIS browser; otherwise nothing is claimed. */
export type PushTag = "available" | "current" | null;
export function pushTag(v: PushView | null, phase: string): PushTag {
  if (!v || !v.available || phase === "forbidden" || phase === "unsupported") return null;
  return v.enrollment?.opted_in && v.enrollment.browser === "current" ? "current" : "available";
}
export const TAG_LABEL = { available: "Disponible", current: "Actif sur ce navigateur" } as const;
export const COPY = {
  title: "Notifications push sur ce navigateur",
  intro: "Un seul navigateur reçoit les notifications push de votre compte : en activer un nouveau remplace le précédent.",
  checking: "Vérification de ce navigateur…",
  unsupported: "Ce navigateur ne permet pas les notifications push (service worker, Push API ou notifications indisponibles).",
  unavailable: "Les notifications push ne sont pas disponibles sur ce service pour le moment.",
  notReady: "Ce navigateur n’est pas encore prêt à recevoir des notifications push (service de l’application non prêt). Rechargez la page plus tard.",
  savePreferenceFirst: "Cochez « Notifications push » puis enregistrez vos préférences pour pouvoir activer ce navigateur.",
  denied: "Les notifications sont bloquées pour ce site dans votre navigateur : autorisez-les dans ses réglages pour pouvoir les activer.",
  refused: "Autorisation refusée : rien n’a été activé.",
  activate: "Activer sur ce navigateur",
  replace: "Remplacer par ce navigateur",
  disable: "Désactiver",
  reset: "Réinitialiser l’abonnement de ce navigateur",
  resetNote: "Ce navigateur conserve un abonnement créé avec une autre clé : réinitialisez-le, puis activez à nouveau.",
  current: "Activées sur ce navigateur.",
  other: "Activées sur un autre navigateur. Les activer ici remplacera cet autre navigateur.",
  off: "Désactivées.",
  activated: "Notifications push activées sur ce navigateur.",
  removed: "Notifications push désactivées.",
  reread: "Le serveur n’a pas confirmé l’action : l’état actuel a été relu. Rien n’est renvoyé automatiquement.",
  session: "Session expirée : reconnectez-vous.",
  forbidden: "Vérifiez votre session et vos préférences de notification (préférence push enregistrée) : le serveur a refusé.",
  loadFailed: "L’état des notifications push n’a pas pu être lu. Réessayez.",
  demo: "En démonstration, aucune notification push n’est activée et aucun appel n’est fait.",
  sending: "Enregistrement…",
} as const;
