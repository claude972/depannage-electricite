"use client";
import { useEffect, useRef } from "react";

/** Re-read a failed GET after connectivity returns. Never pass a mutation/retry command here. */
export function useOnlineReadRetry(enabled: boolean, read: () => Promise<unknown>) {
  const latest = useRef({ enabled, read });
  latest.current = { enabled, read };
  useEffect(() => {
    let running = false;
    let active = true;
    const online = () => {
      if (!active || !latest.current.enabled || running) return;
      running = true;
      void Promise.resolve().then(() => active && latest.current.enabled ? latest.current.read() : undefined)
        .catch(() => { /* The owning read controller displays its error and manual retry. */ })
        .finally(() => { running = false; });
    };
    window.addEventListener("online", online);
    return () => { active = false; window.removeEventListener("online", online); };
  }, []);
}
