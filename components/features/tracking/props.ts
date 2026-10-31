// Props normalisées des feuilles de suivi (contrat UI §2). Types serveur : lib/features/tracking/types.ts (Codex).
import type { TrackingClient, TrackingRoute, TrackingSnapshot } from "../../../lib/features/tracking/types";
import type { GeoLike } from "./model";

export type TrackingLeafProps = {
  state: "unknown" | "available" | "missing" | "unavailable";
  unavailableMessage: string;
  scope: {
    userId: string;
    role: "client" | "artisan" | "manager" | "admin";
    organizationId?: string;
    siteId?: string;
    authority: { canWrite: boolean; reason?: string };
  };
  client: TrackingClient;
  interventionId: string;
  /** Démonstration explicite seulement : rien n’est lu ni envoyé. */
  demo?: { snapshot: TrackingSnapshot; route?: TrackingRoute | null };
  onNavigate?: (view: string, param?: string) => void;
  /** Injectable pour les tests ; défaut navigator.geolocation. `null` = indisponible. */
  geolocation?: GeoLike | null;
  now?: () => number;
};

/** Remontage complet à chaque changement d’identité, d’organisation, de site ou de dossier. */
export const trackingKey = (p: Pick<TrackingLeafProps, "scope" | "interventionId">) =>
  `${p.scope.userId}|${p.scope.organizationId ?? ""}|${p.scope.siteId ?? ""}|${p.interventionId}`;
