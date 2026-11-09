"use client";
// Public pages: the PUBLISHED operator profile only (no auth, no draft). Loading / error keep the
// pending wording; nothing is invented.
// E58 (P6): `readKey` (the public view) re-reads the published profile on every internal navigation,
// never showing a withdrawn publication from an earlier read. E79: `retry` re-reads after a failure.
import { useCallback, useEffect, useState } from "react";
import { loadPublished, type PublicProfileState } from "./model";

export function usePublishedOperatorProfile(enabled: boolean, fetcher?: typeof fetch, readKey = ""): PublicProfileState & { retry: () => void } {
  const [state, setState] = useState<PublicProfileState>({ phase: "loading", published: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState({ phase: "loading", published: null });
    void loadPublished(fetcher).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, readKey, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
