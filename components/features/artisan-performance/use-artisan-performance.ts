"use client";
// ART-10 — identity-fenced read of the server performance report.
// - demo: no read at all (the screens keep their existing demo computation);
// - live: one read per identity (uid|generation) and per explicit retry;
// - the frame is bound at render to the identity key and the retry nonce: an old frame is
//   never shown after an identity change, and a late reply (other seq or other identity
//   at reply time) is dropped.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtisanPerformanceReport } from "../../app/types";
import { identityKey, isEmptyReport, parseArtisanPerformance } from "./model";

export type PerformanceSource = {
  mode: string;
  mutationContext: { generation(): number; userId(): string | null };
  loadArtisanPerformance(): Promise<ArtisanPerformanceReport | null>;
};

export type PerformanceState =
  | { phase: "demo" }
  | { phase: "loading" }
  | { phase: "ready"; report: ArtisanPerformanceReport }
  | { phase: "empty"; report: ArtisanPerformanceReport }
  /** null from the session (401, 403, 404, 5xx, network: it does not tell them apart). */
  | { phase: "unavailable" }
  /** Rejected read or off-contract payload. */
  | { phase: "error" };

export type PerformanceHandle = PerformanceState & { retry: () => void };

type Frame = { key: string; nonce: number; state: PerformanceState };

export function useArtisanPerformance(source: PerformanceSource): PerformanceHandle {
  const live = source.mode !== "demo";
  const key = live ? identityKey(source.mutationContext) : null;
  const [nonce, setNonce] = useState(0);
  const [frame, setFrame] = useState<Frame | null>(null);
  const seq = useRef(0);
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  });

  useEffect(() => {
    if (!key) return;
    const my = ++seq.current;
    let cancelled = false;
    const still = () =>
      !cancelled && my === seq.current && identityKey(sourceRef.current.mutationContext) === key;
    // Promise.resolve().then: a synchronous throw of the loader is an error frame, not a crash.
    Promise.resolve()
      .then(() => sourceRef.current.loadArtisanPerformance())
      .then(
        (raw) => {
          if (!still()) return;
          if (raw === null) {
            setFrame({ key, nonce, state: { phase: "unavailable" } });
            return;
          }
          const report = parseArtisanPerformance(raw);
          setFrame({
            key,
            nonce,
            state: !report
              ? { phase: "error" }
              : isEmptyReport(report)
                ? { phase: "empty", report }
                : { phase: "ready", report },
          });
        },
        () => {
          if (still()) setFrame({ key, nonce, state: { phase: "error" } });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [key, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  let state: PerformanceState;
  if (!live) state = { phase: "demo" };
  else if (!key) state = { phase: "unavailable" };
  else if (!frame || frame.key !== key || frame.nonce !== nonce) state = { phase: "loading" };
  else state = frame.state;
  return { ...state, retry };
}
