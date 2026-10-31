// WEB-DEEPLINK-QA-001 constants (docs/CLAUDE_DEEPLINK_QA_CONTRACT.md, A1–A3b, B2 claim).
export const SCENARIOS = Object.freeze(["D1", "D2", "D3", "D4"]);
export const REALTIME_PATH = "/realtime/v1/websocket";
export const REALTIME_CLOSE = Object.freeze({ code: 4000, reason: "qa-realtime-blocked" });
/** A3: a window opens only ≥ 16 s after the last window focus/blur/visibility event (or page creation). */
export const REVALIDATE_GUARD_MS = 16000;
export const QUIET_MS = 1000;
export const GATE_TIMEOUT_MS = 45000;
export const SETTLE_TIMEOUT_MS = 15000;
/** D1/D2: the dossier must be shown well before the ≥ 15 s focus revalidation could explain it. */
export const SHOW_TIMEOUT_MS = 10000;
/** D4 (d): quiet window with no action. */
export const QUIET_WINDOW_MS = 10000;
export const WORKSPACE_PATH = "/api/workspace";
export const UI = Object.freeze({
  loading: "Recherche du dossier…",
  clientNotFound: "Intervention introuvable",
  clientNotFoundText: "Ce dossier n’existe pas dans votre espace ou son lien n’est plus valide.",
  artisanNotFound: "Dossier introuvable",
  enterpriseNotFound: "Dossier introuvable sur ce périmètre",
  errorTitle: "Dossier momentanément indisponible",
  errorBlocker: "deeplink:error",
  retry: "Réessayer",
  badge: /^Connexion temps réel : (Connecté|non connectée) · Actualiser$/,
  badgeBlocked: "Connexion temps réel : non connectée · Actualiser",
});
export const VIEWS = Object.freeze({ client: (id) => `detail/${id}`, artisan: (id) => `mission/${id}`, enterprise: (id) => `detail/${id}`, requests: "requests" });
