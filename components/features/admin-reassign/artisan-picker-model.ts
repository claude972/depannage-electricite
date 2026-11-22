// ADM-03 — reassign picker model (pure). Source: GET /api/admin/directory?kind=artisans&approved=true
// through the existing session.loadAdminDirectory (q + opaque cursor, keyset pages, exact total).
// Only approved accounts whose artisan dossier is approved are offered (same rule as before).
import type { DirectoryArtisan, DirectoryPage } from "../../app/types";

/** Same literal rule as the route (2–80 letters, digits, spaces, hyphens, apostrophes). */
export function normalizeQuery(raw: string): { q: string | null; invalid: boolean } {
  const q = raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!q) return { q: null, invalid: false };
  if (q.length < 2 || q.length > 80 || !/^[\p{L}\p{M}\p{N} '’-]+$/u.test(q)) return { q: null, invalid: true };
  return { q, invalid: false };
}

/** Minimal projection kept for selection. */
export type PickerArtisan = { id: string; full_name: string; company_name: string | null };
export const eligible = (a: DirectoryArtisan) => a.artisan_approved === true && a.application_status === "approved";
export const project = (a: DirectoryArtisan): PickerArtisan => ({ id: a.id, full_name: a.full_name, company_name: a.company_name });

export type PickerState = {
  /** identity | dossier | query: the state is shown only under this exact key. */
  key: string;
  phase: "loading" | "ready" | "error";
  items: PickerArtisan[];
  next: string | null;
  total: number | null;
  loadingMore: boolean;
  moreError: boolean;
};
export const pickerInitial = (key: string): PickerState => ({ key, phase: "loading", items: [], next: null, total: null, loadingMore: false, moreError: false });

/** Appends a page, dropping ineligible rows and ids already listed. */
export function appendPage(state: PickerState, page: DirectoryPage<"artisans">): PickerState {
  const seen = new Set(state.items.map((i) => i.id));
  const fresh = page.items.filter(eligible).map(project).filter((a) => !seen.has(a.id) && (seen.add(a.id), true));
  return { ...state, phase: "ready", items: [...state.items, ...fresh], next: page.page.has_more ? page.page.next_cursor : null, total: page.page.total, loadingMore: false, moreError: false };
}

export const artisanLabel = (a: PickerArtisan) => (a.company_name ? `${a.full_name} — ${a.company_name}` : a.full_name);
