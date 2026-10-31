"use client";
// SHARED-REV-006: when a lot contract is transiently unavailable (503/network), the shell shows the
// honest state WITH a bounded recovery action: a re-probe of that single contract under the current
// identity and rights. A missing contract (404) keeps the plain honest state (deployment matter).
import { useEffect } from "react";
import { Unavailable } from "../app/ui";
import type { FeatureKey, ReprobeHint } from "../app/features";
import type { Session } from "../app/session-types";

export function FeatureUnavailable({
  session,
  featureKey,
  title,
  hint,
}: {
  session: Session;
  featureKey: FeatureKey;
  title: string;
  hint?: ReprobeHint;
}) {
  const state = session.capabilities[featureKey];
  return (
    <Unavailable
      title={title}
      state={state === "available" ? undefined : state}
      blocker={`${featureKey}:${state}`}
      onRetry={state === "unavailable" ? () => session.reprobeFeature(featureKey, hint) : undefined}
    />
  );
}

/**
 * Live mode: a lot contract whose availability is still unknown is probed ONCE for this target
 * through the identity-bound re-probe (the reply alone sets available / missing / unavailable).
 * Without it a leaf that waits for "available" would stay in "Vérification…" forever.
 */
export function useProbeWhenUnknown(session: Session, featureKey: FeatureKey, hint?: ReprobeHint, enabled = true) {
  const state = session.capabilities[featureKey];
  const live = session.mode === "live";
  const hintKey = hint ? `${hint.siteId ?? ""}|${hint.quoteId ?? ""}|${hint.interventionId ?? ""}` : "";
  useEffect(() => {
    if (!enabled || !live || state !== "unknown") return;
    void session.reprobeFeature(featureKey, hint);
    // Re-run only when the target or identity-bound state changes, never in a loop: after the
    // probe the state leaves "unknown".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, live, state, featureKey, hintKey]);
}
