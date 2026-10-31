// Logique pure du suivi (WEB-TRACKING-UI-006). Sans React : testée par tests/ui/tracking*.test.ts.
// Contrat : docs/TRACKING_UI_CONTRACT.md (a7a1fed + amendement fbaacaa).
import type { GeocodeCandidates, TrackingCommand, TrackingRoute, TrackingSnapshot } from "../../../lib/features/tracking/types";

export type GeocodeCandidate = GeocodeCandidates["candidates"][number];
/** Raisons 503 du contrat Codex (§ HTTP/types) : non exportées par lib/features/tracking/types.ts, listées ici pour l’affichage. */
export type TrackingUnavailableReason =
  | "position_unavailable"
  | "destination_required"
  | "provider_quota"
  | "provider_timeout"
  | "provider_unavailable"
  | "route_unavailable"
  | "invalid_provider_response"
  | "server_configuration";

export const CONSENT_POLICY = "tracking-v1" as const;
export const POINT_INTERVAL_MS = 5000;
export const MAX_ACCURACY_M = 250;
export const MAX_SAMPLE_AGE_MS = 60_000;
export const ROUTE_REFRESH_MS = 30_000;

// ---- Erreurs -------------------------------------------------------------------------------------
export type TrackingFailure = { status: number; message: string; reason?: string; retryAfterS?: number };
/** Lit une erreur levée par le client injecté (ApiRequestError ou équivalent) sans dépendre de sa classe. */
export function failureOf(error: unknown): TrackingFailure {
  const e = (error ?? {}) as { status?: unknown; message?: unknown; code?: unknown; reason?: unknown; retry_after_s?: unknown; retryAfterS?: unknown };
  const status = typeof e.status === "number" ? e.status : 0;
  const reason = typeof e.reason === "string" ? e.reason : typeof e.code === "string" ? e.code : undefined;
  const retry = typeof e.retry_after_s === "number" ? e.retry_after_s : typeof e.retryAfterS === "number" ? e.retryAfterS : undefined;
  const message = typeof e.message === "string" && e.message ? e.message : "Le service n’a pas pu traiter la demande.";
  return { status, message, ...(reason ? { reason } : {}), ...(retry !== undefined ? { retryAfterS: Math.max(0, Math.min(3600, retry)) } : {}) };
}

const ROUTE_MESSAGES: Record<TrackingUnavailableReason, string> = {
  position_unavailable: "Aucune position récente : l’arrivée ne peut pas être estimée.",
  destination_required: "Destination non confirmée : la personne habilitée doit la confirmer.",
  provider_quota: "Service d’itinéraire saturé.",
  provider_timeout: "Service d’itinéraire momentanément indisponible.",
  provider_unavailable: "Service d’itinéraire momentanément indisponible.",
  route_unavailable: "Aucun itinéraire routier trouvé jusqu’à la destination.",
  invalid_provider_response: "Réponse du service d’itinéraire inutilisable.",
  server_configuration: "Calcul d’itinéraire non configuré sur ce service.",
};
/** Message d’indisponibilité de l’arrivée estimée : jamais de chiffre d’ETA. */
export function routeFailureMessage(f: TrackingFailure): string {
  if (f.status === 503 && f.reason && f.reason in ROUTE_MESSAGES) {
    const base = ROUTE_MESSAGES[f.reason as TrackingUnavailableReason];
    return f.reason === "provider_quota" && f.retryAfterS !== undefined ? `${base} Nouvel essai possible dans ${Math.ceil(f.retryAfterS)} s.` : base;
  }
  if (f.status === 429) return `Trop de demandes : réessayez dans ${Math.ceil(f.retryAfterS ?? 30)} s.`;
  return f.message;
}

// ---- Affichage : effacement strict (amendement §1) -----------------------------------------------
export type DisplayPosition = { latitude: number; longitude: number; accuracyM: number; sampledAt: string; ageS: number };
export type TrackingDisplay = {
  kind: "fresh" | "stale" | "stopped" | "no_position";
  /** Présente seulement si fraîche ; sinon effacée de la mémoire affichée. */
  position: DisplayPosition | null;
  /** Heure connue sans coordonnée (stale/stopped), sinon null. */
  knownTime: string | null;
  reason: string;
  sharing: boolean;
  destination: TrackingSnapshot["tracking"]["destination"];
  travelStage: TrackingSnapshot["tracking"]["travel_stage"];
};

export function trackingDisplay(snapshot: TrackingSnapshot | null, now: number): TrackingDisplay | null {
  if (!snapshot) return null;
  const t = snapshot.tracking;
  const base = { destination: t.destination, travelStage: t.travel_stage, sharing: t.shared };
  if (t.position_state === "fresh" && t.position) {
    const ageS = Math.max(0, Math.round((now - Date.parse(t.position.sampled_at)) / 1000));
    if (ageS * 1000 <= MAX_SAMPLE_AGE_MS)
      return {
        ...base,
        kind: "fresh",
        position: { latitude: t.position.latitude, longitude: t.position.longitude, accuracyM: t.position.accuracy_m, sampledAt: t.position.sampled_at, ageS },
        knownTime: null,
        reason: "Position partagée",
      };
    // Le serveur la dit fraîche mais l’horloge locale l’a dépassée : on l’efface aussi.
    return { ...base, kind: "stale", position: null, knownTime: t.position.sampled_at, reason: "Position périmée" };
  }
  const knownTime = t.position?.sampled_at ?? null;
  if (t.position_state === "stale") return { ...base, kind: "stale", position: null, knownTime, reason: "Position périmée" };
  if (t.position_state === "stopped") return { ...base, kind: "stopped", position: null, knownTime, reason: "Partage arrêté par l’artisan" };
  return { ...base, kind: "no_position", position: null, knownTime: null, reason: t.shared ? "En attente d’une première position" : "Aucune position partagée" };
}

/** Une route n’est affichable qu’avec une position fraîche du même état serveur (amendement §1). */
export function routeMatches(route: TrackingRoute | null, snapshot: TrackingSnapshot | null, display: TrackingDisplay | null): boolean {
  if (!route || !snapshot || !display || display.kind !== "fresh" || !snapshot.tracking.destination) return false;
  const t = snapshot.tracking;
  return (
    route.session_id === t.session_id &&
    route.control_version === t.control_version &&
    route.point_seq === t.last_seq &&
    route.destination_version === t.destination_version
  );
}

/** Heure d’arrivée = calculated_at + duration_s, jamais autre chose. */
export function arrivalEstimate(route: TrackingRoute) {
  const calculated = Date.parse(route.calculated_at);
  if (!Number.isFinite(calculated) || !(route.duration_s > 0)) return null;
  return {
    arrivalAt: new Date(calculated + route.duration_s * 1000).toISOString(),
    durationMin: Math.max(1, Math.round(route.duration_s / 60)),
    distanceKm: Math.round(route.distance_m / 100) / 10,
    calculatedAt: route.calculated_at,
  };
}

// ---- Géométrie : distance de raccordement ---------------------------------------------------------
export function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---- Destination ---------------------------------------------------------------------------------
export type ManualDestinationInput = { latitude: string; longitude: string; label: string };
export type ManualDestinationErrors = Partial<Record<keyof ManualDestinationInput, string>>;
const parseCoord = (raw: string) => {
  const v = Number(raw.trim().replace(",", "."));
  return raw.trim() !== "" && Number.isFinite(v) ? v : null;
};
export function validateManualDestination(input: ManualDestinationInput):
  | { ok: true; value: { latitude: number; longitude: number; label: string } }
  | { ok: false; errors: ManualDestinationErrors } {
  const errors: ManualDestinationErrors = {};
  const lat = parseCoord(input.latitude);
  const lon = parseCoord(input.longitude);
  const label = input.label.trim();
  if (lat === null || lat < -90 || lat > 90) errors.latitude = "Latitude entre -90 et 90.";
  if (lon === null || lon < -180 || lon > 180) errors.longitude = "Longitude entre -180 et 180.";
  if (label.length < 1 || label.length > 200) errors.label = "Libellé de 1 à 200 caractères.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { latitude: lat!, longitude: lon!, label } };
}
export function destinationCommand(
  snapshot: TrackingSnapshot,
  choice: { kind: "candidate"; candidate: GeocodeCandidate } | { kind: "manual"; latitude: number; longitude: number; label: string } | { kind: "clear" },
): TrackingCommand {
  const expected_version = snapshot.tracking.control_version;
  if (choice.kind === "clear") return { action: "destination", expected_version, payload: { clear: true } };
  if (choice.kind === "candidate")
    return {
      action: "destination",
      expected_version,
      payload: { latitude: choice.candidate.latitude, longitude: choice.candidate.longitude, label: choice.candidate.label, source: "ign", candidate_label: choice.candidate.label },
    };
  return { action: "destination", expected_version, payload: { latitude: choice.latitude, longitude: choice.longitude, label: choice.label, source: "manual" } };
}
export const geocodeQueryValid = (q: string) => q.trim().length >= 2 && q.trim().length <= 200;

// ---- Carte : Web Mercator et tuiles visibles ------------------------------------------------------
export const TILE_SIZE = 256;
export const MIN_ZOOM = 11;
export const MAX_ZOOM = 17;
export const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z)));
/** Pixel monde (non borné) au zoom z. */
export function project(lon: number, lat: number, z: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** z;
  const s = Math.sin((Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
}
export function unproject(x: number, y: number, z: number): { lon: number; lat: number } {
  const scale = TILE_SIZE * 2 ** z;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { lon, lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) };
}
/** Zoom le plus fort qui fait tenir les points dans le cadre (marge), borné MIN..MAX. */
export function fitView(points: [number, number][], width: number, height: number, padding = 40) {
  if (!points.length) return null;
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const p = points.map(([lon, lat]) => project(lon, lat, z));
    const xs = p.map((q) => q.x);
    const ys = p.map((q) => q.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w <= width - 2 * padding && h <= height - 2 * padding || z === MIN_ZOOM)
      return { zoom: z, center: { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 } };
  }
  return null;
}
export type Tile = { z: number; x: number; y: number; left: number; top: number; url: string };
/** Seulement les tuiles qui recoupent le cadre ; jamais de chargement en masse. */
export function visibleTiles(center: { x: number; y: number }, z: number, width: number, height: number): Tile[] {
  const n = 2 ** z;
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  const x0 = Math.floor(left / TILE_SIZE);
  const y0 = Math.floor(top / TILE_SIZE);
  const x1 = Math.floor((left + width - 1) / TILE_SIZE);
  const y1 = Math.floor((top + height - 1) / TILE_SIZE);
  const tiles: Tile[] = [];
  for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty++)
    for (let tx = x0; tx <= x1; tx++) {
      const wx = ((tx % n) + n) % n;
      tiles.push({ z, x: wx, y: ty, left: tx * TILE_SIZE - left, top: ty * TILE_SIZE - top, url: `https://tile.openstreetmap.org/${z}/${wx}/${ty}.png` });
    }
  return tiles;
}

// ---- Partage artisan : contrôleur avec géolocalisation et horloge injectées -----------------------
export type GeoLike = Pick<Geolocation, "watchPosition" | "clearWatch">;
export type ShareStatus =
  | { kind: "idle" }
  | { kind: "consent" }
  | { kind: "starting" }
  | { kind: "sharing"; lastSent: DisplayPosition | null; note: string | null }
  | { kind: "interrupted"; reason: string }
  | { kind: "error"; message: string; retryable: boolean };

export type ShareDeps = {
  geolocation: GeoLike | null | undefined;
  now: () => number;
  uuid: () => string;
  /** Envoi au serveur ; résout le snapshot, null si chaîne périmée ; lève en cas de refus. */
  command: (input: TrackingCommand) => Promise<TrackingSnapshot | null>;
  onSnapshot: (s: TrackingSnapshot) => void;
  onStatus: (s: ShareStatus) => void;
  online?: () => boolean;
};

/**
 * Machine d’état du partage. `watchPosition` n’est appelé qu’après consentement ET démarrage serveur réussi ;
 * toute sortie (arrêt, arrivée, masquage, déconnexion, changement de dossier, démontage, refus) appelle `clearWatch`
 * et incrémente la génération : tout rappel antérieur est ignoré. Aucune reprise automatique.
 */
export class ShareController {
  private generation = 0;
  private watchId: number | null = null;
  private sessionId: string | null = null;
  private version = 0;
  private seq = 0;
  private lastSentAt = 0;
  private sending = false;
  private disposed = false;
  constructor(private deps: ShareDeps) {}

  get watching() {
    return this.watchId !== null;
  }
  get currentGeneration() {
    return this.generation;
  }

  askConsent() {
    if (this.disposed) return;
    this.deps.onStatus({ kind: "consent" });
  }
  cancelConsent() {
    if (this.disposed) return;
    this.deps.onStatus({ kind: "idle" });
  }

  async start(snapshot: TrackingSnapshot) {
    if (this.disposed || this.watchId !== null) return;
    if (!snapshot.permissions.can_share) return;
    const geo = this.deps.geolocation;
    if (!geo) {
      this.deps.onStatus({ kind: "error", message: "La localisation n’est pas disponible dans ce navigateur.", retryable: false });
      return;
    }
    const gen = ++this.generation;
    const sessionId = this.deps.uuid();
    this.deps.onStatus({ kind: "starting" });
    let next: TrackingSnapshot | null;
    try {
      next = await this.deps.command({
        action: "start",
        expected_version: snapshot.tracking.control_version,
        payload: { session_id: sessionId, consent: true, consent_policy: CONSENT_POLICY },
      });
    } catch (error) {
      if (gen !== this.generation) return;
      this.deps.onStatus({ kind: "error", message: failureOf(error).message, retryable: true });
      return;
    }
    if (gen !== this.generation || this.disposed) return;
    if (next === null) return; // chaîne périmée : aucune transition
    this.sessionId = sessionId;
    this.version = next.tracking.control_version;
    this.seq = next.tracking.last_seq;
    this.lastSentAt = 0;
    this.deps.onSnapshot(next);
    this.deps.onStatus({ kind: "sharing", lastSent: null, note: null });
    this.watchId = geo.watchPosition(
      (p) => void this.onPosition(gen, p),
      (e) => this.onGeoError(gen, e),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  }

  private async onPosition(gen: number, p: GeolocationPosition) {
    if (gen !== this.generation || this.disposed || !this.sessionId) return;
    const now = this.deps.now();
    const sampledAt = p.timestamp || now;
    const accuracy = p.coords.accuracy;
    if (!(accuracy > 0) || accuracy > MAX_ACCURACY_M) {
      this.deps.onStatus({ kind: "sharing", lastSent: null, note: `Position trop imprécise (± ${Math.round(accuracy)} m) : non envoyée.` });
      return;
    }
    if (now - sampledAt > MAX_SAMPLE_AGE_MS) {
      this.deps.onStatus({ kind: "sharing", lastSent: null, note: "Position trop ancienne : non envoyée." });
      return;
    }
    if (this.deps.online && !this.deps.online()) {
      this.deps.onStatus({ kind: "sharing", lastSent: null, note: "Hors ligne : la position n’est pas envoyée (aucun envoi différé)." });
      return;
    }
    if (this.sending || now - this.lastSentAt < POINT_INTERVAL_MS) return;
    this.sending = true;
    this.lastSentAt = now;
    const seq = this.seq + 1;
    const payload = {
      session_id: this.sessionId,
      seq,
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
      accuracy_m: Math.round(accuracy * 10) / 10,
      sampled_at: new Date(sampledAt).toISOString(),
    };
    try {
      const next = await this.deps.command({ action: "point", expected_version: this.version, payload });
      if (gen !== this.generation || this.disposed) return;
      if (next === null) return;
      this.seq = seq;
      this.deps.onSnapshot(next);
      this.deps.onStatus({
        kind: "sharing",
        lastSent: { latitude: payload.latitude, longitude: payload.longitude, accuracyM: payload.accuracy_m, sampledAt: payload.sampled_at, ageS: 0 },
        note: null,
      });
    } catch (error) {
      if (gen !== this.generation) return;
      const f = failureOf(error);
      if (f.status === 429) {
        this.lastSentAt = now + (f.retryAfterS ?? 5) * 1000 - POINT_INTERVAL_MS;
        this.deps.onStatus({ kind: "sharing", lastSent: null, note: `Envoi ralenti par le service (${Math.ceil(f.retryAfterS ?? 5)} s).` });
        return;
      }
      // 409/403/404/… : la session n’est plus valide côté serveur.
      this.halt();
      this.deps.onStatus({ kind: "error", message: f.message, retryable: f.status === 409 });
    } finally {
      if (gen === this.generation) this.sending = false;
    }
  }

  private onGeoError(gen: number, e: GeolocationPositionError) {
    if (gen !== this.generation || this.disposed) return;
    if (e.code === 1) {
      this.halt();
      this.bestEffortStop();
      this.deps.onStatus({
        kind: "error",
        message: "Localisation refusée par le navigateur : autorisez-la dans les réglages du site pour partager votre position.",
        retryable: false,
      });
      return;
    }
    this.deps.onStatus({
      kind: "sharing",
      lastSent: null,
      note: e.code === 3 ? "Position non obtenue à temps ; nouvel essai en cours." : "Position momentanément indisponible ; nouvel essai en cours.",
    });
  }

  /** Arrêt local immédiat : clearWatch + nouvelle génération, sans appel serveur. */
  private halt() {
    this.generation++;
    if (this.watchId !== null) this.deps.geolocation?.clearWatch(this.watchId);
    this.watchId = null;
    this.sending = false;
  }

  /** Arrêt serveur tenté au mieux : non attendu, aucun message de succès. */
  private bestEffortStop() {
    const sessionId = this.sessionId;
    this.sessionId = null;
    if (!sessionId) return;
    void this.deps.command({ action: "stop", expected_version: this.version, payload: { session_id: sessionId } }).catch(() => undefined);
  }

  /** Arrêt ou arrivée demandés par l’artisan : attendus, résultat serveur rendu. */
  async finish(action: "stop" | "arrived") {
    const sessionId = this.sessionId;
    this.halt();
    this.sessionId = null;
    if (!sessionId) {
      this.deps.onStatus({ kind: "idle" });
      return;
    }
    const gen = this.generation;
    try {
      const next = await this.deps.command({ action, expected_version: this.version, payload: { session_id: sessionId } });
      if (gen !== this.generation || this.disposed || next === null) return;
      this.deps.onSnapshot(next);
      this.deps.onStatus({ kind: "idle" });
    } catch (error) {
      if (gen !== this.generation) return;
      this.deps.onStatus({ kind: "error", message: failureOf(error).message, retryable: false });
    }
  }

  /** Page masquée, déconnexion : arrêt local + arrêt serveur au mieux ; reprise uniquement explicite. */
  interrupt(reason: string) {
    if (this.watchId === null && !this.sessionId) return;
    this.halt();
    this.bestEffortStop();
    if (!this.disposed) this.deps.onStatus({ kind: "interrupted", reason });
  }

  /** Démontage / changement de dossier ou d’identité. */
  dispose() {
    if (this.disposed) return;
    this.halt();
    this.bestEffortStop();
    this.disposed = true;
  }
}

/** Snapshot serveur `shared=true` sans watch local (rechargement) : jamais repris automatiquement. */
export const needsExplicitRestart = (snapshot: TrackingSnapshot | null, watching: boolean) =>
  Boolean(snapshot?.tracking.shared) && !watching;

export const relativeAge = (seconds: number) =>
  seconds < 60 ? `il y a ${seconds} s` : seconds < 3600 ? `il y a ${Math.round(seconds / 60)} min` : `il y a ${Math.round(seconds / 3600)} h`;
