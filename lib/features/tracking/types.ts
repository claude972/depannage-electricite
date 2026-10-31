export type Position = { latitude: number; longitude: number; accuracy_m: number; sampled_at: string; received_at: string };
export type Destination = { latitude: number; longitude: number; label: string; source: "manual" | "ign"; confirmed_by: string; confirmed_at: string };
export type TrackingSnapshot = {
 server_time: string;
 permissions: { can_share: boolean; can_confirm_destination: boolean };
 tracking: { intervention_id: string; artisan_id: string | null; travel_stage: "planned" | "en_route" | "on_site"; session_id: string | null; control_version: number; shared: boolean; consent_at: string | null; last_seq: number; destination_version: number; position_state: "no_position" | "fresh" | "stale" | "stopped"; position: Position | null; destination: Destination | null };
};
export type TrackingCommand = { expected_version: number } & (
 | { action: "start"; payload: { session_id: string; consent: true; consent_policy: "tracking-v1" } }
 | { action: "point"; payload: { session_id: string; seq: number; latitude: number; longitude: number; accuracy_m: number; sampled_at: string } }
 | { action: "stop" | "arrived"; payload: { session_id: string } }
 | { action: "destination"; payload: { clear: true } | { latitude: number; longitude: number; label: string; source: "manual" | "ign"; candidate_label?: string } }
);
export type TrackingRoute = { state: "available"; source: "IGN Géoplateforme / BD TOPO"; resource: "bdtopo-valhalla"; resource_version: string; distance_m: number; duration_s: number; calculated_at: string; position_sampled_at: string; session_id: string; control_version: number; point_seq: number; destination_version: number; geometry: { type: "LineString"; coordinates: [number, number][] }; snapped_start: [number, number]; snapped_end: [number, number]; traffic: "not_available"; attribution: string };
export type GeocodeCandidates = { source: "IGN / BAN"; candidates: { latitude: number; longitude: number; label: string; score: number; type: string }[]; attribution: string };
/** Lead injects an identity-bound client; null is stale ownership, never success. */
export type TrackingClient = { load(): Promise<TrackingSnapshot | null>; command(input: TrackingCommand): Promise<TrackingSnapshot | null>; route(): Promise<TrackingRoute | null>; geocode(query: string): Promise<GeocodeCandidates | null> };
