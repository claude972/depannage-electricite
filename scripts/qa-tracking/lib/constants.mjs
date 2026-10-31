// WEB-TRACKING-QA-006 constants. Contract: docs/CLAUDE_TRACKING_QA_CONTRACT.md (A1–A5).
// API: origin/codex/gps-eta 8366c05 (docs/TRACKING_CONTRACT.md). UI: origin/claude/web-tracking-ui 22dd419.

/** Every browser position used by this harness is emulated by Playwright, never measured. */
export const POSITION_SOURCE = "simulated_browser_geolocation";
export const POSITION_DISCLAIMER = "Position émulée par Playwright (setGeolocation) sur des coordonnées publiques fixes — ce n'est ni une mesure GPS physique ni une preuve d'appareil.";
export const REASSIGNMENT_SOURCE = "simulated_service_key_reassignment";
export const REASSIGNMENT_DISCLAIMER = "État simulé par la clé service sur des identifiants de cohorte validés — pas une preuve du flux de réaffectation administrateur.";

/** Fixed PUBLIC coordinates (Fort-de-France). Never a user's position. */
export const PUBLIC_POINTS = Object.freeze({
  savane: Object.freeze({ latitude: 14.6035, longitude: -61.068 }),
  airport: Object.freeze({ latitude: 14.5911, longitude: -61.0032 }),
});
export const NOMINAL_ACCURACY_M = 20;
export const REJECTED_ACCURACY_M = 300;

/** Backend limits (8366c05). */
export const LIMITS = Object.freeze({ pointIntervalMs: 5000, freshnessMs: 60000, sampledPastMs: 60000, sampledFutureMs: 5000, accuracyMin: 1, accuracyMax: 250, maxInt: 2147483647 });
export const CONSENT_POLICY = "tracking-v1";

export const ROUTE_REASONS = Object.freeze(["position_unavailable", "destination_required", "provider_quota", "provider_timeout", "provider_unavailable", "route_unavailable", "invalid_provider_response", "server_configuration"]);

/** Tracking API paths (no query string is ever allowed on them). */
export const trackingPath = (id) => `/api/interventions/${id}/tracking`;
export const routePath = (id) => `${trackingPath(id)}/route`;
export const geocodePath = (id) => `${trackingPath(id)}/geocode`;

/** Dossier views where the lead mounts the leaves (existing hashes of the shells). */
export const VIEWS = Object.freeze({ artisan: (id) => `mission/${id}`, client: (id) => `detail/${id}`, manager: (id) => `detail/${id}` });

/** Accessible names and texts bound to UI 22dd419 (contract A1/A5). A missing one is a FAIL. */
export const UI = Object.freeze({
  share: "Partager ma position",
  consent: "Autoriser et démarrer",
  cancel: "Annuler",
  arrived: "Je suis arrivé",
  stop: "Arrêter le partage",
  resume: "Reprendre le partage",
  recalc: "Recalculer",
  removeDestination: "Retirer la destination",
  searchAddress: "Rechercher une adresse",
  confirmDestination: "Confirmer cette destination",
  zoomIn: "Zoomer",
  zoomOut: "Dézoomer",
  recenter: "Recentrer la carte",
  osmAttribution: "© OpenStreetMap contributors",
  declaredSource: "Position déclarée par le navigateur (non certifiée)",
  activeTracking: "Suivi actif",
  noRecentPosition: "Aucune position récente : l’arrivée ne peut pas être estimée.",
  reloadInterrupted: "Partage interrompu par le rechargement de la page.",
  permissionRefused: "Localisation refusée par le navigateur : autorisez-la dans les réglages du site pour partager votre position.",
  inaccurate: /Position trop imprécise \(± \d+ m\) : non envoyée\./,
  artisanPanelTitle: "Partage de ma position",
  clientCardTitle: "Suivi de l’artisan",
});

/** Scenario names (stable; reused by the report and the tests). */
export const SCENARIOS = Object.freeze(["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T8-fail", "T9", "T10", "T11", "T12-sim", "T13", "T14", "T15", "T16", "T18", "T19"]);
export const PROVIDER_SCENARIOS = Object.freeze(["provider-route", "provider-geocode"]);
