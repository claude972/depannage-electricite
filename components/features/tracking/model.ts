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
/** Plancher du cadrage automatique : assez bas pour un trajet à l’échelle de la Martinique (≈ 70 km) sur 288 px. */
export const FIT_MIN_ZOOM = 8;
export const MAX_ZOOM = 17;
export const clampZoom = (z: number, minZoom = MIN_ZOOM) => Math.max(minZoom, Math.min(MAX_ZOOM, Math.round(z)));
/** Zoom minimal offert à l’utilisateur : jamais au-dessus du zoom de cadrage (dézoom possible jusqu’à tout voir). */
export const userMinZoom = (fittedZoom: number | null) => Math.max(FIT_MIN_ZOOM, Math.min(MIN_ZOOM, fittedZoom ?? MIN_ZOOM));
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
export type Insets = { top: number; right: number; bottom: number; left: number };
export type Rect = { left: number; top: number; right: number; bottom: number };
/** Marge des marqueurs (épingle 26 px au-dessus du point, halo) en plus des zones de contrôle. */
export const MARKER_MARGIN = 32;

/**
 * Marges réservées à partir des boîtes réellement mesurées des surcouches (contrôles +/−/recentrer, mention de fond) :
 * une surcouche collée au bord droit réserve toute sa largeur à droite, etc. Aucun chiffre figé.
 */
export function overlayInsets(frame: Rect, overlays: Rect[], margin = MARKER_MARGIN): Insets {
  const ins: Insets = { top: margin, right: margin, bottom: margin, left: margin };
  const w = frame.right - frame.left;
  const h = frame.bottom - frame.top;
  for (const o of overlays) {
    const l = o.left - frame.left;
    const r = frame.right - o.right;
    const t = o.top - frame.top;
    const b = frame.bottom - o.bottom;
    const ow = o.right - o.left;
    const oh = o.bottom - o.top;
    // Bande verticale (plus haute que large) : réserve à gauche ou à droite ; sinon bande horizontale haut/bas.
    if (oh >= ow) {
      if (r <= l) ins.right = Math.max(ins.right, w - l + margin / 2);
      else ins.left = Math.max(ins.left, l + ow + margin / 2);
    } else if (t <= b) ins.top = Math.max(ins.top, t + oh + margin / 2);
    else ins.bottom = Math.max(ins.bottom, h - t + margin / 2);
  }
  return ins;
}

/**
 * Cadrage : zoom le plus fort (borné, 15 au plus pour un point unique) tel que tous les points tiennent dans le cadre
 * moins les marges ; le centre est décalé pour que le contenu soit centré dans la zone utile, hors des contrôles.
 */
export function fitView(points: [number, number][], width: number, height: number, insets: Insets | number = 40, singleZoom = 15) {
  if (!points.length) return null;
  const ins = typeof insets === "number" ? { top: insets, right: insets, bottom: insets, left: insets } : insets;
  const usableW = Math.max(1, width - ins.left - ins.right);
  const usableH = Math.max(1, height - ins.top - ins.bottom);
  const single = points.every((p) => p[0] === points[0][0] && p[1] === points[0][1]);
  for (let z = single ? Math.min(singleZoom, MAX_ZOOM) : MAX_ZOOM; z >= FIT_MIN_ZOOM; z--) {
    const p = points.map(([lon, lat]) => project(lon, lat, z));
    const xs = p.map((q) => q.x);
    const ys = p.map((q) => q.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const fits = w <= usableW && h <= usableH;
    if (fits || z === FIT_MIN_ZOOM) {
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
      const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      return { zoom: z, center: { x: cx - (ins.left - ins.right) / 2, y: cy - (ins.top - ins.bottom) / 2 }, fits };
    }
  }
  return null;
}
/** Position écran d’un point pour une vue donnée (cadre width × height). */
export function toScreenPoint(view: { zoom: number; center: { x: number; y: number } }, width: number, height: number, lon: number, lat: number) {
  const p = project(lon, lat, view.zoom);
  return { x: p.x - view.center.x + width / 2, y: p.y - view.center.y + height / 2 };
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
  /** Démarrage en attente de réponse serveur (pour l’interruption et la compensation). */
  private pendingStart = false;
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
    if (this.pendingStart) return;
    const gen = ++this.generation;
    const sessionId = this.deps.uuid();
    // Client lié capturé au démarrage : seule voie pour une éventuelle compensation (même acteur).
    const command = this.deps.command;
    this.pendingStart = true;
    this.deps.onStatus({ kind: "starting" });
    let next: TrackingSnapshot | null;
    try {
      next = await command({
        action: "start",
        expected_version: snapshot.tracking.control_version,
        payload: { session_id: sessionId, consent: true, consent_policy: CONSENT_POLICY },
      });
    } catch (error) {
      if (gen === this.generation) this.pendingStart = false;
      if (gen !== this.generation) return;
      this.deps.onStatus({ kind: "error", message: failureOf(error).message, retryable: true });
      return;
    }
    if (gen !== this.generation || this.disposed) {
      // Interrompu pendant le démarrage. Si le serveur partage maintenant cette session abandonnée : UN arrêt
      // compensatoire au mieux, par le même client lié, pour cette session exacte. `null` (identité périmée) : rien.
      if (next !== null && next.tracking.session_id === sessionId && next.tracking.shared)
        void command({ action: "stop", expected_version: next.tracking.control_version, payload: { session_id: sessionId } }).catch(() => undefined);
      return;
    }
    this.pendingStart = false;
    if (next === null) {
      this.deps.onStatus({ kind: "idle" });
      return; // chaîne périmée : aucune transition vers le partage
    }
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

  /** Arrêt local immédiat : clearWatch + nouvelle génération (invalide aussi start/point/stop en attente), sans appel serveur. */
  private halt() {
    this.generation++;
    this.pendingStart = false;
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

  /**
   * « Reprendre le partage » après rechargement (le serveur partage encore, aucun watch local) : le serveur refuse un
   * nouveau start (409) tant que l’ancienne session est active. Sur clic explicite : `stop` avec le `session_id` du
   * snapshot, puis — seulement si réussi — retour à l’écran de consentement ; le `start` (nouvelle session) n’est envoyé
   * qu’après confirmation via `start()`. Échec du stop : relecture du snapshot et affichage de l’état serveur, aucun start,
   * aucune nouvelle tentative automatique.
   */
  async closeStaleSession(snapshot: TrackingSnapshot, reload: () => Promise<TrackingSnapshot | null>) {
    if (this.disposed || this.watchId !== null) return;
    const t = snapshot.tracking;
    if (!t.shared || !t.session_id || !snapshot.permissions.can_share) return;
    const gen = ++this.generation;
    this.deps.onStatus({ kind: "starting" });
    try {
      const next = await this.deps.command({ action: "stop", expected_version: t.control_version, payload: { session_id: t.session_id } });
      if (gen !== this.generation || this.disposed || next === null) return;
      this.deps.onSnapshot(next);
      this.deps.onStatus({ kind: "consent" });
    } catch (error) {
      if (gen !== this.generation || this.disposed) return;
      const f = failureOf(error);
      const fresh = await reload().catch(() => null);
      if (gen !== this.generation || this.disposed) return;
      if (fresh) this.deps.onSnapshot(fresh);
      this.deps.onStatus({ kind: "error", message: f.message, retryable: false });
    }
  }

  /** Page masquée, déconnexion : arrêt local + arrêt serveur au mieux ; reprise uniquement explicite. */
  interrupt(reason: string) {
    const active = this.watchId !== null || Boolean(this.sessionId) || this.pendingStart;
    // Toujours invalider la génération, y compris pour un démarrage ou un point en attente.
    this.halt();
    if (!active) return;
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

// ---- Route : 409 tracking_changed (revue P3-4) -----------------------------------------------------
/** Clé de l’état serveur dont dépend une route. */
export const routeKey = (s: TrackingSnapshot | null) =>
  s ? `${s.tracking.session_id}|${s.tracking.control_version}|${s.tracking.last_seq}|${s.tracking.destination_version}` : "";
/** 409 reçu pendant le calcul : relire le snapshot ; nouvelle demande au plus une fois par nouvel état, jamais en boucle. */
export const isTrackingChanged = (f: TrackingFailure) => f.status === 409;
export const mayRequestRoute = (snapshot: TrackingSnapshot | null, blockedKey: string | null) =>
  Boolean(snapshot) && routeKey(snapshot) !== blockedKey;

// ---- Destination : arrêt du partage (revue P3-3) ---------------------------------------------------
/** Confirmer ou retirer une destination arrête le partage en cours côté serveur : à dire avant confirmation. */
export const destinationStopsSharing = (s: TrackingSnapshot) => s.tracking.shared;
export const DESTINATION_STOP_WARNING = "Le partage de position en cours sera arrêté ; l’artisan devra le relancer.";

/** Points de cadrage d’une position avec son halo de précision (± accuracy_m en latitude et longitude). */
export function haloPoints(lon: number, lat: number, accuracyM: number): [number, number][] {
  const dLat = accuracyM / 111_320;
  const dLon = accuracyM / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return [[lon, lat], [lon - dLon, lat - dLat], [lon + dLon, lat + dLat]];
}

// ---- P2-2 : régulation des demandes d’itinéraire ---------------------------------------------------
/** Clé de contexte stable d’une route (jamais l’identité de l’objet snapshot re-sondé). */
export function routeContextKey(snapshot: TrackingSnapshot | null, freshKind: string | undefined): string {
  if (!snapshot || freshKind !== "fresh" || !snapshot.tracking.destination) return "";
  const t = snapshot.tracking;
  return `${t.session_id}|${t.control_version}|${t.last_seq}|${t.position?.sampled_at ?? ""}|${t.destination_version}`;
}

/**
 * Porte d’itinéraire : au plus une demande par `intervalMs` (≥ 30 s), jamais avant la fin d’un Retry-After serveur,
 * jamais pour un état bloqué par un 409 (une relecture, puis seulement pour un nouvel état). Les demandes manuelles
 * passent par la même porte.
 */
export class RouteGate {
  private lastRequestAt: number | null = null;
  private notBefore = 0;
  private blockedKey: string | null = null;
  constructor(private intervalMs = ROUTE_REFRESH_MS) {}
  canRequest(now: number, key: string): boolean {
    return this.waitMs(now, key) === 0;
  }
  /** Temps restant avant qu’une demande soit permise (Infinity si l’état est bloqué ou vide). */
  waitMs(now: number, key: string): number {
    if (!key || key === this.blockedKey) return Infinity;
    const byInterval = this.lastRequestAt === null ? 0 : this.lastRequestAt + this.intervalMs - now;
    return Math.max(0, byInterval, this.notBefore - now);
  }
  onRequest(now: number) {
    this.lastRequestAt = now;
  }
  onFailure(now: number, key: string, f: TrackingFailure) {
    if (f.retryAfterS !== undefined) this.notBefore = Math.max(this.notBefore, now + f.retryAfterS * 1000);
    if (f.status === 409) this.blockedKey = key;
  }
}

// ---- Revue ROOT 8bcee45 : une seule demande d’itinéraire en vol par carte -------------------------
export type RouteRequestOutcome =
  | { kind: "result"; route: TrackingRoute }
  | { kind: "failure"; failure: TrackingFailure }
  | { kind: "stale" } // client null (identité périmée) ou contexte changé / carte démontée : résultat ignoré
  ;

/**
 * Ordonnanceur utilisé tel quel par TrackingCard (corps de l’effet extrait pour être testé).
 * Exclusion SYNCHRONE : un jeton `inFlight` (pas d’état React) bloque toute autre demande — minuterie, sondage,
 * changement de contexte ou clic « Recalculer » — tant que la demande en cours n’est pas réglée.
 * Choix explicite : jamais deux demandes simultanées d’une même carte vers le serveur. Au changement de contexte ou au
 * démontage, le résultat en vol est ignoré (génération), mais le jeton n’est libéré qu’au règlement de SA promesse
 * (comparaison de jeton : un `finally` ancien ne libère jamais un jeton plus récent). Ensuite la porte (≥ 30 s,
 * Retry-After, 409) s’applique ; un état plus récent vu entre-temps déclenche au plus une demande de suivi.
 */
export class RouteScheduler {
  readonly gate: RouteGate;
  private inFlight: symbol | null = null;
  private generation = 0;
  private disposed = false;
  constructor(intervalMs = ROUTE_REFRESH_MS) {
    this.gate = new RouteGate(intervalMs);
  }
  get busy() {
    return this.inFlight !== null;
  }
  /** Attente avant la prochaine demande possible ; Infinity si une demande est en vol ou l’état bloqué. */
  waitMs(now: number, key: string): number {
    if (this.inFlight !== null || this.disposed) return Infinity;
    return this.gate.waitMs(now, key);
  }
  /** Invalide les résultats en vol (changement d’identité/dossier, démontage) sans libérer le jeton. */
  invalidate() {
    this.generation++;
  }
  dispose() {
    this.disposed = true;
    this.generation++;
  }
  /**
   * Émet au plus une demande. Retourne null si refusée de façon synchrone (en vol, porte fermée, démonté) ;
   * sinon la promesse de l’issue. `currentKey()` est relu au règlement pour ignorer un résultat d’un ancien contexte.
   */
  request(now: number, key: string, route: () => Promise<TrackingRoute | null>, currentKey: () => string, clock: () => number = () => now): Promise<RouteRequestOutcome> | null {
    if (this.disposed || this.inFlight !== null || !this.gate.canRequest(now, key)) return null;
    const token = Symbol("route");
    const gen = this.generation;
    this.inFlight = token;
    this.gate.onRequest(now);
    let call: Promise<TrackingRoute | null>;
    try {
      call = route();
    } catch (error) {
      call = Promise.reject(error);
    }
    return call.then(
      (r): RouteRequestOutcome => {
        if (gen !== this.generation || this.disposed || r === null || currentKey() !== key) return { kind: "stale" };
        return { kind: "result", route: r };
      },
      (error): RouteRequestOutcome => {
        const f = failureOf(error);
        this.gate.onFailure(clock(), key, f); // Retry-After et 409 s’appliquent même si le contexte a changé
        if (gen !== this.generation || this.disposed) return { kind: "stale" };
        return { kind: "failure", failure: f };
      },
    ).finally(() => {
      if (this.inFlight === token) this.inFlight = null;
    });
  }
}
