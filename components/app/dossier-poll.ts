"use client";
// SYS-05 / CLI-04: light polling fallback for an OPEN dossier. Appointments, reports and amendments
// live in tables that are not in the `supabase_realtime` publication (only interventions, quotes and
// messages are — see realtime.ts), and saving them does not touch a published row, so no event
// reaches the other party. While a live dossier is shown in a visible, online tab, its small
// per-dossier reads (operations, amendments) are repeated on this tick; nothing else is re-read.
import { useEffect, useState } from "react";

export const DOSSIER_POLL_MS = 20_000;
/** A hidden or offline tab never polls. */
export const shouldPoll = (env: { hidden: boolean; online: boolean }) => !env.hidden && env.online;

export function useDossierPoll(enabled: boolean, ms: number = DOSSIER_POLL_MS): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const bump = () => {
      if (shouldPoll({ hidden: document.visibilityState === "hidden", online: navigator.onLine !== false })) setTick((n) => n + 1);
    };
    const timer = setInterval(bump, ms);
    // Back to the tab: catch up at once instead of waiting for the next interval.
    document.addEventListener("visibilitychange", bump);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", bump);
    };
  }, [enabled, ms]);
  return tick;
}
