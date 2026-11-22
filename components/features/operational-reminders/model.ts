// Operational reminders (SYS-04 / ART-03 / ENT-14) — pure model, no React. Separate from the
// appointment reminders. Contract: docs/OPERATIONAL_REMINDERS_BACKEND.md:
//   GET  /api/artisan/credentials/<id>/reminder | /api/compliance/<id>/reminder
//        → { kind, record_id, source: { version, due_on }, record | null, eligibility, can_schedule, scheduled_for_current_source }
//   POST same path { action: "schedule", command_id, expected_version (null first), source_version, due_on, remind_at }
//                | { action: "cancel", command_id, expected_version } → { record, replayed }
// remind_at: chosen explicitly, future, strictly before the due day in Martinique time. A personal,
// in-app reminder only: it certifies nothing and its emission is never promised by this UI.
// 401 / 404 (source not accessible) / 409 / 422 / 429 / 503 (+ Retry-After).
import { z } from "zod";
import { command, receipt, state, type ReminderCommand, type ReminderState } from "../../../lib/features/operational-reminders/contract";

export type Kind = "credential" | "compliance";
export type { ReminderCommand, ReminderState };
export type ReminderRecord = NonNullable<ReminderState["record"]>;
export const OR_TIMEOUT_MS = 15_000;
export const OR_TIMEOUT = -1;
export type Result = { status: number; body: unknown; retryAfterS: number | null };
export const reminderPath = (kind: Kind, id: string) =>
  kind === "credential" ? `/api/artisan/credentials/${encodeURIComponent(id)}/reminder` : `/api/compliance/${encodeURIComponent(id)}/reminder`;

const retryAfter = (v: string | null): number | null => (v && /^\d{1,5}$/.test(v.trim()) ? Math.min(Number(v.trim()), 3600) : null);
export async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs = OR_TIMEOUT_MS): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: OR_TIMEOUT, body: null, retryAfterS: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null), retryAfterS: retryAfter(r.headers.get("retry-after")) };
    } catch {
      return { status: controller?.signal.aborted ? OR_TIMEOUT : 0, body: null, retryAfterS: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Same scope checks as the route: the state answers exactly this kind and record. */
export function parseState(body: unknown, kind: Kind, id: string): ReminderState | null {
  const s = state.safeParse(body);
  if (!s.success) return null;
  const d = s.data;
  if (d.kind !== kind || d.record_id !== id.toLowerCase() || (d.record && (d.record.kind !== kind || d.record.record_id !== id.toLowerCase()))) return null;
  return d;
}
/** A receipt must confirm exactly the command (version + 1, status, and for schedule the same source/date/instant). */
export function parseReceipt(body: unknown, kind: Kind, id: string, cmd: ReminderCommand): { record: ReminderRecord; replayed: boolean } | null {
  const r = receipt.safeParse(body);
  if (!r.success) return null;
  const v = r.data.record;
  if (v.kind !== kind || v.record_id !== id.toLowerCase() || v.version !== (cmd.expected_version ?? 0) + 1 || v.status !== (cmd.action === "schedule" ? "scheduled" : "cancelled")) return null;
  if (cmd.action === "schedule" && (v.source_version !== cmd.source_version || v.due_on !== cmd.due_on || Date.parse(v.remind_at) !== Date.parse(cmd.remind_at))) return null;
  return r.data;
}

// ---- Martinique time (UTC−4, no daylight saving) ---------------------------------------------------
export const MQ_OFFSET = "-04:00";
export const martiniqueInstant = (date: string, time: string) => `${date}T${time}:00${MQ_OFFSET}`;
export const martiniqueDay = (iso: string) => new Date(Date.parse(iso) - 4 * 3600_000).toISOString().slice(0, 10);
export function formatMq(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleString("fr-FR", { timeZone: "America/Martinique", dateStyle: "long", timeStyle: "short" })} (heure de Martinique)`;
}
export function formatDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("fr-FR", { timeZone: "UTC", dateStyle: "long" });
}
/** Explicit date + time (Martinique) → remind_at, or the reason it is refused (nothing is proposed). */
export function validateRemindAt(date: string, time: string, dueOn: string, now: number): { remind_at: string } | { error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { error: COPY.pickBoth };
  const iso = martiniqueInstant(date, time);
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return { error: COPY.pickBoth };
  if (at <= now) return { error: COPY.past };
  if (martiniqueDay(iso) >= dueOn) return { error: COPY.notBefore(formatDay(dueOn)) };
  return { remind_at: iso };
}

export const COPY = {
  title: "Rappel d’échéance personnel",
  intro: "Un rappel pour vous seul, affiché dans les notifications de votre espace. L’enregistrer ne garantit pas son émission, et il ne certifie ni la validité d’un justificatif ni la conformité d’un site.",
  loading: "Lecture du rappel…",
  loadFailed: "Le rappel n’a pas pu être vérifié. Réessayez.",
  notAccessible: "Échéance non accessible avec vos droits actuels : aucun rappel ne peut être géré ici.",
  session: "Session expirée : reconnectez-vous.",
  demo: "En démonstration, aucun rappel n’est lu ni programmé : aucun appel n’est fait.",
  pickBoth: "Choisissez une date et une heure.",
  past: "Choisissez un moment dans le futur.",
  notBefore: (due: string) => `Le rappel doit tomber avant le jour de l’échéance (${due}, heure de Martinique).`,
  conflict: "L’échéance ou le rappel a changé entre-temps : rien n’est renvoyé automatiquement. L’état actuel a été relu.",
  invalid: "Le serveur refuse ce rappel : vérifiez la date choisie.",
  retry: "L’action n’est pas confirmée. Réessayez : la même commande sera renvoyée, sans doublon.",
  restored: "Une action envoyée depuis cet onglet n’a pas été confirmée : renvoyez-la (même commande) ou abandonnez-la.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune action n’est possible ici.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être renvoyée à l’identique.",
  scheduled: "Rappel enregistré.",
  cancelled: "Rappel annulé. Une notification déjà émise n’est pas effacée.",
  replayed: "Cette action avait déjà été enregistrée (même commande) : état relu.",
} as const;
export const ELIGIBILITY: Record<ReminderState["eligibility"], (due: string | null) => string> = {
  available: (due) => `Échéance enregistrée : ${due ? formatDay(due) : "—"}. Vous pouvez choisir le moment du rappel, avant ce jour.`,
  no_date: () => "Aucune date d’échéance enregistrée : aucun rappel ne peut être programmé, et aucune date n’est proposée automatiquement.",
  closed: () => "Cette échéance n’est plus ouverte : aucun rappel ne peut être programmé.",
  elapsed: (due) => `La date d’échéance${due ? ` (${formatDay(due)})` : ""} est atteinte ou dépassée : aucun rappel ne peut être programmé.`,
};
export const STATUS: Record<ReminderRecord["status"], (r: ReminderRecord) => string> = {
  scheduled: (r) => `Programmé pour le ${formatMq(r.remind_at)}, avant l’échéance du ${formatDay(r.due_on)}.`,
  cancelled: () => "Annulé.",
  sent: (r) => `Notification interne créée${r.processed_at ? ` le ${formatMq(r.processed_at)}` : ""} — cela ne signifie pas qu’elle a été lue.`,
  invalidated: () => "Invalidé : l’échéance, le document ou vos droits ont changé depuis. Reprogrammez explicitement si besoin.",
  expired: () => "Non émis : l’échéance était atteinte avant le moment prévu (aucune notification tardive).",
  muted: () => "Non émis : vos préférences de notification l’ont mis en sourdine.",
};
export function statusError(status: number, retryAfterS: number | null): string {
  if (status === 401) return COPY.session;
  if (status === 403 || status === 404) return COPY.notAccessible;
  if (status === 422) return COPY.invalid;
  if (status === 429) return retryAfterS ? `Trop de demandes : réessayez dans ${retryAfterS} s.` : "Trop de demandes : réessayez dans quelques instants.";
  if (status === 503) return retryAfterS ? `Vérification momentanément indisponible : réessayez dans ${retryAfterS} s.` : "Vérification momentanément indisponible : réessayez.";
  return COPY.loadFailed;
}

// ---- Identity-fenced commands --------------------------------------------------------------------
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
/** Private tab storage; purged centrally (courant-app) on logout / identity change by this prefix. */
export const PENDING_PREFIX = "courant-private-op-reminders:";
export const pendingKey = (uid: string | null, gen: number, kind: Kind, id: string) => `${PENDING_PREFIX}${uid ?? "-"}:${gen}:${kind}:${id.toLowerCase()}`;
const stored = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), kind: z.enum(["credential", "compliance"]), record_id: z.string().min(1), command }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export type View = {
  phase: "loading" | "ready" | "error" | "forbidden";
  data: ReminderState | null;
  busy: boolean;
  error: string;
  notice: string;
  pending: ReminderCommand | null;
  waitS: number | null;
};
export const VIEW_INITIAL: View = { phase: "loading", data: null, busy: false, error: "", notice: "", pending: null, waitS: null };

export function createReminder({ kind, id, fetcher, store, newId, context, now = () => Date.now(), get, set }: { kind: Kind; id: string; fetcher: () => typeof fetch; store: () => Store | null; newId: () => string | null; context: Context; now?: () => number; get: () => View; set: (v: View) => void }) {
  const path = reminderPath(kind, id);
  let inFlight = false;
  let loadSeq = 0;
  let pendingFor: string | null = null;
  const identity = () => ({ uid: context.userId(), gen: context.generation() });
  const same = (a: { uid: string | null; gen: number }) => context.userId() === a.uid && context.generation() === a.gen;
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const key = (who: { uid: string | null; gen: number }) => pendingKey(who.uid, who.gen, kind, id);
  const clearStored = (who = identity()) => safe(() => store()?.remove(key(who)));
  const forbid = (status: number) => {
    clearStored();
    pendingFor = null;
    set({ ...VIEW_INITIAL, phase: "forbidden", error: statusError(status, null) });
  };
  const load = async () => {
    const my = ++loadSeq;
    const who = identity();
    set({ ...get(), phase: get().data ? get().phase : "loading" });
    const r = await timed(fetcher(), path, { method: "GET" });
    if (my !== loadSeq || !same(who)) return;
    if (r.status === 401 || r.status === 403 || r.status === 404) return forbid(r.status);
    const d = r.status === 200 ? parseState(r.body, kind, id) : null;
    if (!d) return set({ ...get(), phase: get().data ? get().phase : "error", error: statusError(r.status === 200 ? 0 : r.status, r.retryAfterS) });
    set({ ...get(), phase: "ready", data: d, error: get().phase === "error" ? "" : get().error });
  };
  const persist = (cmd: ReminderCommand, who: { uid: string | null; gen: number }): boolean => {
    if (!who.uid) return false;
    const s = safe(store);
    if (!s) return false;
    const value = JSON.stringify({ uid: who.uid, gen: who.gen, kind, record_id: id.toLowerCase(), command: cmd });
    return safe(() => {
      s.set(key(who), value);
      return s.get(key(who)) === value;
    }) === true;
  };
  const send = async (cmd: ReminderCommand): Promise<boolean> => {
    if (inFlight) return false;
    const who = identity();
    if (!persist(cmd, who)) {
      set({ ...get(), error: COPY.storage });
      return false;
    }
    inFlight = true;
    loadSeq++;
    set({ ...get(), busy: true, error: "", notice: "", waitS: null });
    let r: Result;
    try {
      r = await timed(fetcher(), path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
    } finally {
      inFlight = false;
    }
    if (!same(who)) return false; // identity changed: the reply is dropped, never replayed
    const ok = r.status === 200 ? parseReceipt(r.body, kind, id, cmd) : null;
    if (ok) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, notice: ok.replayed ? COPY.replayed : cmd.action === "schedule" ? COPY.scheduled : COPY.cancelled });
      await load();
      return true;
    }
    if (r.status === 401 || r.status === 403 || r.status === 404) {
      forbid(r.status);
      return false;
    }
    if (r.status === 409 || r.status === 422 || r.status === 400) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? COPY.conflict : COPY.invalid });
      if (r.status === 409) await load();
      return false;
    }
    pendingFor = `${who.uid}|${who.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: r.status === 429 || r.status === 503 ? `${statusError(r.status, r.retryAfterS)} ${COPY.retry}` : COPY.retry, waitS: r.status === 429 || r.status === 503 ? r.retryAfterS : null });
    return false;
  };
  const fresh = (build: (cid: string, d: ReminderState) => ReminderCommand | string): Promise<boolean> => {
    const d = get().data;
    if (!d || get().pending || inFlight) return Promise.resolve(false);
    // Validate first: a refused input never consumes a command id.
    const probe = build("", d);
    if (typeof probe === "string") {
      set({ ...get(), error: probe });
      return Promise.resolve(false);
    }
    const cid = safe(newId) ?? null;
    if (!cid) {
      set({ ...get(), error: COPY.noUuid });
      return Promise.resolve(false);
    }
    const built = { ...probe, command_id: cid };
    const cmd = command.safeParse(built);
    if (!cmd.success) {
      set({ ...get(), error: COPY.invalid });
      return Promise.resolve(false);
    }
    return send(cmd.data);
  };
  return {
    load,
    restorePending() {
      const who = identity();
      if (!who.uid) return;
      const raw = safe(() => store()?.get(key(who)) ?? null) ?? null;
      if (raw === null) return;
      let parsed: z.infer<typeof stored> | null = null;
      try {
        const r = stored.safeParse(JSON.parse(raw));
        parsed = r.success ? r.data : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.uid !== who.uid || parsed.gen !== who.gen || parsed.kind !== kind || parsed.record_id !== id.toLowerCase()) {
        safe(() => store()?.remove(key(who)));
        return;
      }
      pendingFor = `${who.uid}|${who.gen}`;
      set({ ...get(), pending: parsed.command, error: COPY.restored });
    },
    /** Schedule at the explicitly chosen Martinique date + time (nothing proposed). */
    schedule: (date: string, time: string) =>
      fresh((cid, d) => {
        if (!d.can_schedule || d.eligibility !== "available" || !d.source.due_on) return COPY.invalid;
        const v = validateRemindAt(date, time, d.source.due_on, now());
        if ("error" in v) return v.error;
        return { action: "schedule", command_id: cid, expected_version: d.record?.version ?? null, source_version: d.source.version, due_on: d.source.due_on, remind_at: v.remind_at };
      }),
    cancel: () =>
      fresh((cid, d) => (d.record && d.record.status === "scheduled" ? { action: "cancel", command_id: cid, expected_version: d.record.version } : COPY.invalid)),
    retry: () => {
      const p = get().pending;
      if (!p) return Promise.resolve(false);
      const who = identity();
      if (pendingFor !== `${who.uid}|${who.gen}`) {
        pendingFor = null;
        set({ ...get(), pending: null, error: "" });
        return Promise.resolve(false);
      }
      return send(p);
    },
    discard: () => {
      clearStored();
      pendingFor = null;
      set({ ...get(), pending: null, error: "", waitS: null });
    },
  };
}
