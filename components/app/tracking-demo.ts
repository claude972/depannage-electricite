// Démonstration explicite du suivi (WEB-TRACKING-UI-006) : un instantané construit à l’affichage,
// jamais envoyé ni lu sur le réseau. Il ne porte AUCUN itinéraire : aucune durée, distance ni
// heure d’arrivée n’est inventée ; la carte montre une position et une destination fictives.
import type { TrackingSnapshot } from "../../lib/features/tracking/types";
import type { Role } from "./types";

const DEMO_ARTISAN_ID = "00000000-0000-4000-8000-00000000d0a1";

export function trackingDemo(interventionId: string, role: Role, now: number = Date.now()): TrackingSnapshot {
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  const artisan = role === "artisan";
  return {
    server_time: at(0),
    permissions: { can_share: artisan, can_confirm_destination: !artisan && role !== "admin" },
    tracking: {
      intervention_id: interventionId,
      artisan_id: DEMO_ARTISAN_ID,
      travel_stage: "en_route",
      // Côté artisan la démonstration part d’un partage arrêté : rien n’est lu, le bouton reste inerte.
      session_id: artisan ? null : "00000000-0000-4000-8000-00000000d0a2",
      control_version: 1,
      shared: !artisan,
      consent_at: artisan ? null : at(240_000),
      last_seq: artisan ? 0 : 12,
      destination_version: 1,
      position_state: artisan ? "no_position" : "fresh",
      position: artisan
        ? null
        : { latitude: 14.6161, longitude: -61.0588, accuracy_m: 25, sampled_at: at(8_000), received_at: at(7_000) },
      destination: {
        latitude: 14.6037,
        longitude: -61.0677,
        label: "Adresse de démonstration, Fort-de-France",
        source: "manual",
        confirmed_by: "00000000-0000-4000-8000-00000000d0a3",
        confirmed_at: at(3_600_000),
      },
    },
  };
}
