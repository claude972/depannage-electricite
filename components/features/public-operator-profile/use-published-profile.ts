"use client";
// Public pages: the PUBLISHED operator profile only (no auth, no draft). Loading / error keep the
// pending wording; nothing is invented.
import { useEffect, useState } from "react";
import { loadPublished, type PublicProfileState } from "./model";

export function usePublishedOperatorProfile(enabled: boolean, fetcher?: typeof fetch): PublicProfileState {
  const [state, setState] = useState<PublicProfileState>({ phase: "loading", published: null });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadPublished(fetcher).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return state;
}
