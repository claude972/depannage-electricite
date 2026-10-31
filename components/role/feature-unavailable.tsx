"use client";
// SHARED-REV-006: when a lot contract is transiently unavailable (503/network), the shell shows the
// honest state WITH a bounded recovery action: a re-probe of that single contract under the current
// identity and rights. A missing contract (404) keeps the plain honest state (deployment matter).
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
