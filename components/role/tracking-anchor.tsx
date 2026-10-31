"use client";
// Point d’ancrage du suivi de déplacement (WEB-TRACKING-UI-006) : panneau de partage artisan et
// carte de suivi client/entreprise. Capacité, client lié à l’identité et démonstration isolée
// viennent de la session ; l’autorité d’écriture est fournie par la coque appelante. Les droits
// réels (partager, confirmer la destination) restent ceux de l’instantané serveur.
import { useMemo } from "react";
import { ArtisanTrackingPanel, TrackingCard } from "../features/tracking";
import { CONTRACT_MESSAGES } from "../app/api";
import { trackingDemo } from "../app/tracking-demo";
import { FeatureUnavailable, useProbeWhenUnknown } from "./feature-unavailable";
import type { Session } from "../app/session-types";
import { leafScope } from "./anchors";

export function TrackingAnchor({
  session,
  variant,
  interventionId,
  authority,
  organizationId,
  siteId,
}: {
  session: Session;
  variant: "artisan" | "viewer";
  interventionId: string;
  authority: { canWrite: boolean; reason?: string };
  organizationId?: string;
  siteId?: string;
}) {
  const state = session.capabilities.tracking;
  useProbeWhenUnknown(session, "tracking", { interventionId });
  const features = session.features;
  // Un client par dossier et par bundle : il suit le propriétaire du bundle (identité courante).
  const client = useMemo(() => features.tracking(interventionId), [features, interventionId]);
  const demo = useMemo(
    () => (session.mode === "demo" ? { snapshot: trackingDemo(interventionId, session.role), route: null } : undefined),
    [session.mode, session.role, interventionId],
  );
  if (state === "unavailable")
    return (
      <FeatureUnavailable
        session={session}
        featureKey="tracking"
        title="Suivi du déplacement momentanément indisponible"
        hint={{ interventionId }}
      />
    );
  const props = {
    state,
    unavailableMessage: state === "available" ? "" : CONTRACT_MESSAGES[state],
    scope: leafScope(session.profileId, session.role, authority, { organizationId, siteId }),
    client,
    interventionId,
    demo,
  };
  return variant === "artisan" ? <ArtisanTrackingPanel {...props} /> : <TrackingCard {...props} />;
}
