import type { ChannelReport, ChannelState } from "./types";
// External delivery adapters (email, SMS, push). NO provider is configured in this project:
// detection reads the environment and reports "unavailable" with a reason. The email and push
// outbox in external-delivery is inactive and requires an idempotent worker adapter.
export type ExternalChannel = "email" | "sms" | "push";
export type ChannelDetection = { state: ChannelState; reason: string };
export interface NotificationChannelAdapter {
  readonly channel: ExternalChannel;
  /** Pure configuration check; never contacts a provider. */
  detect(env: Readonly<Record<string, string | undefined>>): ChannelDetection;
  /** Sends one message. Must throw ChannelUnavailableError when detect() is not "available". */
  send(message: { recipient: string; title: string; body: string }): Promise<{ delivered: true; reference: string }>;
}
export class ChannelUnavailableError extends Error {
  constructor(
    public channel: ExternalChannel,
    reason: string,
  ) {
    super(reason);
  }
}
export const CHANNEL_ENV: Record<ExternalChannel, string> = {
  email: "NOTIFICATIONS_EMAIL_PROVIDER",
  sms: "NOTIFICATIONS_SMS_PROVIDER",
  push: "NOTIFICATIONS_PUSH_PROVIDER",
};
export const CHANNEL_LABELS: Record<ExternalChannel, string> = { email: "E-mail", sms: "SMS", push: "Notification push" };
/** Adapters known to this build. Empty on purpose: no provider has been chosen or configured. */
export const ADAPTERS: ReadonlyArray<NotificationChannelAdapter> = [];
const NO_PROVIDER = (channel: ExternalChannel) =>
  `${CHANNEL_LABELS[channel]} : aucun fournisseur configuré sur ce service. Aucun envoi n’est effectué.`;
export function detectChannel(channel: ExternalChannel, env: Readonly<Record<string, string | undefined>> = process.env): ChannelDetection {
  const adapter = ADAPTERS.find((a) => a.channel === channel);
  const configured = (env[CHANNEL_ENV[channel]] ?? "").trim();
  if (!adapter) {
    return {
      state: "unavailable",
      reason: configured
        ? `${CHANNEL_LABELS[channel]} : le fournisseur « ${configured.slice(0, 40)} » n’est pas pris en charge par cette version. Aucun envoi n’est effectué.`
        : NO_PROVIDER(channel),
    };
  }
  return adapter.detect(env);
}
export function detectChannels(env: Readonly<Record<string, string | undefined>> = process.env): ChannelReport {
  const email = detectChannel("email", env);
  const sms = detectChannel("sms", env);
  const push = detectChannel("push", env);
  return {
    in_app: "available",
    email: email.state,
    sms: sms.state,
    push: push.state,
    reasons: { email: email.reason, sms: sms.reason, push: push.reason },
  };
}
export const CHANNELS_NOTE =
  "Les notifications sont consultables dans cet espace. Aucun e-mail, SMS ni notification push n’est envoyé tant qu’aucun fournisseur n’est configuré ; vos préférences sont conservées pour une activation ultérieure.";
/** Guarded send: refuses explicitly instead of pretending. */
export async function sendExternal(
  channel: ExternalChannel,
  message: { recipient: string; title: string; body: string },
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<{ delivered: true; reference: string }> {
  const detection = detectChannel(channel, env);
  const adapter = ADAPTERS.find((a) => a.channel === channel);
  if (detection.state !== "available" || !adapter) throw new ChannelUnavailableError(channel, detection.reason);
  return adapter.send(message);
}
