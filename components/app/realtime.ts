// Workspace Realtime (FASTSPLIT RT fix, root probe bb05 / H1b). Only the tables actually in the
// `supabase_realtime` publication are subscribed: a binding on an unpublished table (payments) makes
// the server reject the whole postgres_changes join (« Unable to subscribe ») after SUBSCRIBED.
// Payments are reflected through intervention updates and the manual refresh.
// `wait: true` holds SUBSCRIBED until the server confirms the postgres_changes subscription.
export const REALTIME_TABLES = ["interventions", "quotes", "messages"] as const;
export const REALTIME_CHANNEL_CONFIG = { config: { postgres_changes_options: { wait: true } } } as const;

/** Honest connection state: « SUBSCRIBED » only while the server has not reported a system error. */
export function nextConnection(current: string, event: { kind: "status"; status: string } | { kind: "system"; status?: string }): string {
  if (event.kind === "status") return event.status;
  return event.status === "error" ? "CHANNEL_ERROR" : current;
}
