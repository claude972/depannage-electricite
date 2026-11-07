// ADM-01 admin dashboard snapshot — pure model, no React. STRICT MIRROR of
// lib/features/admin-dashboard/handler.ts + docs/ADMIN_DASHBOARD_SNAPSHOT_BACKEND.md (read-only):
//   GET /api/admin/dashboard (no params, exact role admin) →
//   { counts: { interventions, active_interventions, pending_applications },
//     active: ≤ 6 { id, artisan_id | null, category, city, urgency, status, created_at },
//     pending: ≤ 6 { id, full_name, company_name, application_status: "submitted", account_created_at },
//     limit: 6, captured_at }      401 / 403 / 422 / 503
// account_created_at is the ACCOUNT date, never a submission date. No amount is computed here.
import { z } from "zod";

export const DASHBOARD_PATH = "/api/admin/dashboard";
const time = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const active = z
  .object({
    id: z.uuid(),
    artisan_id: z.uuid().nullable(),
    category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]),
    city: z.string(),
    urgency: z.enum(["urgent", "scheduled"]),
    status: z.enum(["requested", "assigned", "quoted", "accepted", "in_progress", "completed"]),
    created_at: time,
  })
  .strict();
const pending = z.object({ id: z.uuid(), full_name: z.string(), company_name: z.string(), application_status: z.literal("submitted"), account_created_at: time }).strict();
const snapshot = z
  .object({
    counts: z.object({ interventions: count, active_interventions: count, pending_applications: count }).strict(),
    active: z.array(active).max(6),
    pending: z.array(pending).max(6),
    limit: z.literal(6),
    captured_at: time,
  })
  .strict();
export type DashboardSnapshot = z.infer<typeof snapshot>;
export type ActiveRow = DashboardSnapshot["active"][number];
export type PendingRow = DashboardSnapshot["pending"][number];

const newestFirst = (rows: { id: string; at: string }[]) =>
  rows.every((r, i) => {
    if (i === 0) return true;
    const p = rows[i - 1];
    const a = Date.parse(p.at), b = Date.parse(r.at);
    return a > b || (a === b && p.id < r.id);
  }) && new Set(rows.map((r) => r.id)).size === rows.length;
/** Same consistency checks as the handler (counts vs bounded arrays, stable order, no duplicates). */
export function parseSnapshot(body: unknown): DashboardSnapshot | null {
  const r = snapshot.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if (d.counts.active_interventions > d.counts.interventions) return null;
  if (d.active.length !== Math.min(6, d.counts.active_interventions) || d.pending.length > d.counts.pending_applications) return null;
  if (!newestFirst(d.active.map((x) => ({ id: x.id, at: x.created_at }))) || !newestFirst(d.pending.map((x) => ({ id: x.id, at: x.account_created_at })))) return null;
  return d;
}

export type Result = { status: number; body: unknown };
export async function fetchSnapshot(fetcher: typeof fetch, timeoutMs = 15_000): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: -1, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(DASHBOARD_PATH, { method: "GET", credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export type SnapshotView = { ident: string; phase: "loading" | "ready" | "error" | "forbidden"; data: DashboardSnapshot | null; error: string };
export const COPY = {
  unverified: "Non vérifié",
  loading: "Lecture de l’instantané…",
  failed: "L’instantané du tableau de bord n’a pas pu être vérifié. Réessayez.",
  forbidden: "Réservé au Super Admin : vos droits, vérifiés par le serveur, ne couvrent pas cet instantané.",
  session: "Session expirée : reconnectez-vous.",
  refresh: "Actualiser",
  readAt: (iso: string) => `Instantané lu le ${new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Martinique" })}.`,
  morePending: (n: number, shown: number) => `${n} candidature(s) comptée(s), ${shown} affichable(s) ici : la liste complète est dans « Artisans ».`,
  moreActive: (n: number, shown: number) => `${n} dossier(s) non clos, les ${shown} plus récents affichés ici.`,
  accountDate: "Compte créé le",
} as const;
/** Counts that may be shown: only from a ready snapshot of the CURRENT role + identity. */
export function shownSnapshot(view: SnapshotView, ident: string): DashboardSnapshot | null {
  return view.ident === ident && view.phase === "ready" ? view.data : null;
}
