// Client dossier map (CLI-05) — pure model (no React). Provider-agnostic: the map itself is a
// `MapProvider` chosen by the owner; until then `provider = null` and NOTHING leaves the browser
// (no tile server, no geocoder, no iframe). What is real is still shown: the declared address
// (as declared, not verified), the server tracking state (travel stage, sharing/consent, the
// artisan's position ONLY when the server returns it fresh, with its time), and its freshness.
// Data source: the existing tracking contract (lib/features/tracking/types.ts), read through the
// session's TrackingClient — reused, not duplicated (trackingDisplay from ../tracking/model).
import type { ReactNode } from "react";
import type { TrackingSnapshot } from "../../../lib/features/tracking/types";
import { MAX_SAMPLE_AGE_MS, trackingDisplay, type TrackingDisplay } from "../tracking/model";

export type DeclaredAddress = { address: string; postal_code: string; city: string };
/** A map provider decided by the owner (licence, terms, privacy). Null by default. */
export type MapProvider = {
  id: string;
  name: string;
  /** Rendered in the attribution slot whenever the provider is active. */
  attribution: ReactNode;
  /** Renders the map; receives only what the dossier already exposes. */
  render(input: { address: DeclaredAddress; position: { latitude: number; longitude: number; accuracyM: number } | null }): ReactNode;
};

/** Server snapshot older than this ⇒ the shown state is labelled « à actualiser ». */
export const SNAPSHOT_STALE_MS = 2 * 60_000;
/** A shared position older than this is never shown as current (same bound as the tracking leaf). */
export const POSITION_STALE_MS = MAX_SAMPLE_AGE_MS;

export const STAGE_LABEL: Record<TrackingSnapshot["tracking"]["travel_stage"], string> = {
  planned: "Déplacement prévu",
  en_route: "Artisan en route",
  on_site: "Artisan sur place",
};
export const MAP_COPY = {
  noProvider: "Carte non activée : aucun fournisseur de cartographie n’a encore été choisi. Votre adresse n’est envoyée à aucun service tiers.",
  declared: "Adresse déclarée dans votre demande, non vérifiée.",
  noEta: "Aucune durée de trajet ni heure d’arrivée n’est calculée ici.",
  notYet: "Le suivi du déplacement est proposé une fois l’intervention acceptée.",
  loading: "Lecture du suivi…",
  loadFailed: "Le suivi n’a pas pu être lu. Réessayez.",
  offline: "Hors connexion : le suivi n’est pas lisible pour le moment. L’adresse déclarée reste affichée.",
  unavailable: "Suivi du déplacement momentanément indisponible.",
  demo: "Démonstration : suivi fictif, aucune position réelle.",
  externalNotice:
    "Ouvrir dans votre application de cartes transmet l’adresse de l’intervention à cette application (service tiers, hors de la plateforme). Rien n’est envoyé tant que vous ne l’ouvrez pas.",
} as const;

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "il y a moins d’une minute";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h} h ${String(m % 60).padStart(2, "0")}`;
}

export type MapView = {
  stage: string;
  freshness: { text: string; stale: boolean };
  /** Sharing / consent state, always explicit. */
  sharing: { kind: TrackingDisplay["kind"] | "not_shared"; text: string };
  /** Only when the server returned a fresh, consented position. */
  position: { latitude: number; longitude: number; accuracyM: number; text: string } | null;
};
/** Server snapshot → what can honestly be said. Never invents a position, ETA or distance. */
export function mapView(snapshot: TrackingSnapshot, now: number): MapView {
  const t = snapshot.tracking;
  const display = trackingDisplay(snapshot, now)!;
  const serverAge = now - Date.parse(snapshot.server_time);
  const stale = !(serverAge <= SNAPSHOT_STALE_MS);
  const freshness = { text: `Mis à jour à ${hhmm(snapshot.server_time)} (${ago(snapshot.server_time, now)})${stale ? " — à actualiser" : ""}. Source : suivi de la plateforme.`, stale };
  let sharing: MapView["sharing"];
  let position: MapView["position"] = null;
  if (display.kind === "fresh" && display.position) {
    position = { latitude: display.position.latitude, longitude: display.position.longitude, accuracyM: display.position.accuracyM, text: `Position partagée par l’artisan à ${hhmm(display.position.sampledAt)} (précision ±${Math.round(display.position.accuracyM)} m).` };
    sharing = { kind: "fresh", text: "Partage de position actif, avec l’accord de l’artisan." };
  } else if (display.kind === "stale") {
    sharing = { kind: "stale", text: display.knownTime ? `Dernière position partagée à ${hhmm(display.knownTime)} : périmée (plus d’une minute), non affichée.` : "Position périmée, non affichée." };
  } else if (display.kind === "stopped") {
    sharing = { kind: "stopped", text: "Partage de position arrêté par l’artisan." };
  } else if (t.shared) {
    sharing = { kind: "no_position", text: "Partage accepté par l’artisan, en attente d’une première position." };
  } else {
    sharing = { kind: "not_shared", text: t.consent_at ? "Partage de position terminé." : "L’artisan ne partage pas sa position (aucun accord de partage en cours)." };
  }
  return { stage: STAGE_LABEL[t.travel_stage], freshness, sharing, position };
}

/** Device map app link (geo: URI), built ONLY after the explicit consent click; no web domain. */
export const externalMapsHref = (a: DeclaredAddress) => `geo:0,0?q=${encodeURIComponent(`${a.address}, ${a.postal_code} ${a.city}`)}`;
