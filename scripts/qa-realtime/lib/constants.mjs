// WEB-REALTIME-PROBE-001 constants (docs/REALTIME_DIAGNOSTIC_CONTRACT.md §3, §3 bis, §5 claim).
export const EXPECTED_SDK = "2.118.0";
export const REALTIME_PATH = "/realtime/v1/websocket";
export const JOIN_TIMEOUT_MS = 15000;
export const WINDOW_MS = 10000;
export const CLOSE_TIMEOUT_MS = 5000;
/** The app's channel: courant-app.tsx ~515–529 — 4 bindings, this order, event "*", schema public. */
export const APP_TABLES = Object.freeze(["interventions", "quotes", "messages", "payments"]);
export const MEASUREMENTS = Object.freeze([
  { name: "app-4", channel: (uid) => `workspace-${uid}`, tables: APP_TABLES, wait: false },
  { name: "pub-3", channel: (uid) => `qa-rt-pub3-${uid}`, tables: ["interventions", "quotes", "messages"], wait: false },
  { name: "int-1", channel: (uid) => `qa-rt-int1-${uid}`, tables: ["interventions"], wait: false },
  { name: "app-4-wait", channel: (uid) => `qa-rt-wait-${uid}`, tables: APP_TABLES, wait: true },
]);
export const MEASUREMENT_NAMES = Object.freeze(MEASUREMENTS.map((m) => m.name));
/** §3: whitelisted system / error texts; any other text is replaced by "other". */
export const SYSTEM_WHITELIST = Object.freeze([
  "Unable to subscribe to changes with given parameters",
  "mismatch between server and client bindings for postgres changes",
  "Subscribed to PostgreSQL",
  "RLS",
  "timeout",
]);
export const PUBLIC_TABLES = Object.freeze(["interventions", "quotes", "messages", "payments"]);
export const EVENTS = Object.freeze(["*", "INSERT", "UPDATE", "DELETE"]);
