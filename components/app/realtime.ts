// Workspace Realtime (FASTSPLIT RT fix, root probe bb05 / H1b). Only the tables actually in the
// `supabase_realtime` publication are subscribed: a binding on an unpublished table (payments) makes
// the server reject the whole postgres_changes join (« Unable to subscribe ») after SUBSCRIBED.
// Payments are reflected through intervention updates and the manual refresh.
// Appointments, reports and quote amendments are not published either: an open dossier re-reads
// them on a light polling tick (dossier-poll.ts) instead of a binding that would break the join.
// `wait: true` holds SUBSCRIBED until the server confirms the postgres_changes subscription.
export const REALTIME_TABLES = ["interventions", "quotes", "messages"] as const;
export const REALTIME_CHANNEL_CONFIG = { config: { postgres_changes_options: { wait: true } } } as const;

/** Honest connection state: « SUBSCRIBED » only while the server has not reported a system error. */
export function nextConnection(current: string, event: { kind: "status"; status: string } | { kind: "system"; status?: string }): string {
  if (event.kind === "status") return event.status;
  return event.status === "error" ? "CHANNEL_ERROR" : current;
}

/**
 * E51 (P6): catch-up after a reconnection. The first SUBSCRIBED is the boot (the workspace was just
 * read): nothing. Any later SUBSCRIBED that follows a loss (closed socket, timeout, channel error)
 * may have missed events: `onCatchUp` is called once, the caller re-reads (GET).
 */
export function createRealtimeCatchUp(onCatchUp: () => void): (status: string) => void {
  let joined = false;
  let lost = false;
  return (status: string) => {
    if (status === "SUBSCRIBED") {
      if (joined && lost) {
        lost = false;
        onCatchUp();
      }
      joined = true;
      return;
    }
    if (joined) lost = true;
  };
}
