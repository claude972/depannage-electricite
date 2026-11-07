// Appointment reminder (ENT-14 / SYS-04) — pure model (no React). One personal, in-app reminder
// per participant and dossier:
//   GET  /api/interventions/{id}/reminder → { intervention_id, appointment, record, can_schedule, eligibility, scheduled_for_current_slot }
//   POST /api/interventions/{id}/reminder  { command_id, action: "schedule", expected_version, appointment_version, remind_at }
//                                          { command_id, action: "cancel", expected_version } → { record, replayed }
// Every write: command_id persisted in tab storage (uid + generation key, read back) BEFORE the
// POST; a lost reply / 503 replays the same command; 409 ⇒ honest + reload; nothing automatic.
import { z } from "zod";
import { command, receipt, state } from "./contract";

export type ReminderState = z.infer<typeof state>;
export type ReminderCommand = z.infer<typeof command>;
export type Result = { status: number; body: unknown };
export type ReminderApi = { load(): Promise<Result>; command(body: ReminderCommand): Promise<Result> };
export type ReminderContext = { generation(): number; userId(): string | null };
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export const TIMEOUT_MS = 15_000;
export const TIMEOUT = -1;

async function timed(fetcher: typeof fetch, url: string, init: RequestInit): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: TIMEOUT, body: null });
    }, TIMEOUT_MS);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export const reminderPath = (interventionId: string) => `/api/interventions/${encodeURIComponent(interventionId)}/reminder`;
export function createReminderApi(interventionId: string, fetcher: typeof fetch = (...a) => fetch(...a)): ReminderApi {
  return {
    load: () => timed(fetcher, reminderPath(interventionId), { method: "GET" }),
    command: (body) => timed(fetcher, reminderPath(interventionId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  };
}
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export const PENDING_PREFIX = "appointment-reminder-pending";
export const pendingKey = (interventionId: string, uid: string | null, gen: number) => `${PENDING_PREFIX}:${interventionId}:${uid ?? "-"}:${gen}`;
const storedSchema = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), intervention_id: z.string().min(1), command }).strict();

/** Server state, strictly, for THIS dossier. */
export function parseState(body: unknown, interventionId: string): ReminderState | null {
  const p = state.safeParse(body);
  if (!p.success) return null;
  const id = interventionId.toLowerCase();
  if (p.data.intervention_id !== id || (p.data.record && p.data.record.intervention_id !== id)) return null;
  return p.data;
}
/** A receipt counts only if it is exactly the commanded outcome (version, status, slot, instant). */
export function verifyReceipt(body: unknown, cmd: ReminderCommand, interventionId: string): boolean {
  const p = receipt.safeParse(body);
  if (!p.success) return false;
  const r = p.data.record;
  if (r.intervention_id !== interventionId.toLowerCase()) return false;
  if (r.version !== (cmd.expected_version === null ? 1 : cmd.expected_version + 1)) return false;
  if (cmd.action === "cancel") return r.status === "cancelled";
  return r.status === "scheduled" && r.appointment_version === cmd.appointment_version && Date.parse(r.remind_at) === Date.parse(cmd.remind_at);
}

// ---- Local date/time → explicit instant with the user's own offset ----------------------------------
export const localTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "heure locale";
  } catch {
    return "heure locale";
  }
};
/** "2026-11-08" + "14:30" (local wall clock) ⇒ "2026-11-08T14:30:00-04:00" (offset of that local instant). */
export function localToInstant(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00`);
  if (Number.isNaN(d.getTime())) return null;
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${date}T${time}:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
/** The picked instant must be in the future and strictly before the appointment start (server re-checks). */
export function remindAtAllowed(instant: string | null, startsAt: string, now: number): boolean {
  if (!instant) return false;
  const at = Date.parse(instant);
  return Number.isFinite(at) && at > now && at < Date.parse(startsAt);
}
export const COPY = {
  channel: "Rappel dans le centre de notifications de l’application uniquement : aucun SMS, e-mail ni notification externe.",
  minute: (hhmm: string) => `Rappel prévu vers ${hhmm}, sans garantie à la minute.`,
  noAppointment: "Aucun rendez-vous enregistré pour ce dossier : un rappel se programme une fois le créneau fixé.",
  closed: "Ce dossier n’accepte plus de rappel (étape de l’intervention dépassée ou dossier fermé).",
  elapsed: "Le créneau a déjà commencé : aucun rappel ne peut être programmé.",
  loadFailed: "Le rappel n’a pas pu être vérifié. Réessayez.",
  forbidden: "Ce rappel n’est pas accessible avec vos droits actuels.",
  conflict: "Le rappel ou le rendez-vous a changé entre-temps : rien n’a été enregistré. Rechargez pour voir l’état actuel.",
  invalid: "Le serveur refuse cet horaire : il doit être dans le futur et avant le début du créneau.",
  retry: "L’enregistrement n’est pas confirmé. Réessayez : la même commande sera renvoyée.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé (une réponse perdue ne pourrait pas être rejouée à l’identique).",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : l’enregistrement est impossible ici.",
  demo: "En démonstration, aucun rappel n’est programmé ni envoyé.",
  pickBefore: "Choisissez un horaire dans le futur et avant le début du rendez-vous.",
} as const;
export const STATUS_TEXT: Record<NonNullable<ReminderState["record"]>["status"], string> = {
  scheduled: "Rappel programmé.",
  sent: "Rappel envoyé dans votre centre de notifications (ce n’est pas une preuve de lecture).",
  muted: "Rappel non envoyé : vos préférences de notification désactivent ce type de message.",
  invalidated: "Rappel annulé automatiquement : le rendez-vous a changé ou disparu, le dossier est fermé ou l’accès a été perdu.",
  expired: "Rappel non envoyé : le créneau a commencé avant son traitement (aucun envoi tardif).",
  cancelled: "Rappel annulé par vous.",
};
export const STALE_SCHEDULED = "Intention enregistrée pour un ancien créneau : le rendez-vous a changé et ce rappel ne sera pas envoyé. Reprogrammez-le si besoin.";

// ---- Controller (one command at a time, identity-fenced) --------------------------------------------
export type View = { phase: "loading" | "ready" | "error" | "forbidden"; data: ReminderState | null; busy: boolean; error: string; notice: string; pending: ReminderCommand | null };
export const VIEW_INITIAL: View = { phase: "loading", data: null, busy: false, error: "", notice: "", pending: null };

export function createReminderController({ interventionId, api, store, newId, context, get, set }: { interventionId: string; api: () => ReminderApi; store: () => Store | null; newId: () => string | null; context: ReminderContext; get: () => View; set: (v: View) => void }) {
  let inFlight = false;
  let loadSeq = 0;
  let pendingFor: string | null = null;
  const ident = () => ({ uid: context.userId(), gen: context.generation() });
  const same = (a: { uid: string | null; gen: number }) => context.userId() === a.uid && context.generation() === a.gen;
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const key = (a = ident()) => pendingKey(interventionId, a.uid, a.gen);
  const clearStored = (a = ident()) => safe(() => store()?.remove(key(a)));
  const forbid = () => {
    clearStored();
    pendingFor = null;
    set({ ...VIEW_INITIAL, phase: "forbidden" });
  };
  const load = async () => {
    const my = ++loadSeq;
    const a = ident();
    set({ ...get(), phase: get().data ? get().phase : "loading", error: get().pending ? get().error : "" });
    const r = await api().load();
    if (my !== loadSeq || !same(a)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const data = r.status === 200 ? parseState(r.body, interventionId) : null;
    if (!data) return set({ ...get(), phase: "error", error: COPY.loadFailed });
    set({ ...get(), phase: "ready", data });
  };
  const persist = (cmd: ReminderCommand, a: { uid: string | null; gen: number }) => {
    if (!a.uid) return false;
    const s = store();
    if (!s) return false;
    const value = JSON.stringify({ uid: a.uid, gen: a.gen, intervention_id: interventionId, command: cmd });
    return safe(() => {
      s.set(key(a), value);
      return s.get(key(a)) === value;
    }) === true;
  };
  const send = async (cmd: ReminderCommand) => {
    if (inFlight) return false;
    const a = ident();
    if (!persist(cmd, a)) {
      set({ ...get(), error: COPY.storage });
      return false;
    }
    inFlight = true;
    loadSeq++;
    set({ ...get(), busy: true, error: "", notice: "" });
    let r: Result;
    try {
      r = await api().command(cmd);
    } finally {
      inFlight = false;
    }
    if (!same(a)) return false; // account / rights changed: the reply belongs to another context
    if (r.status === 200 && verifyReceipt(r.body, cmd, interventionId)) {
      clearStored(a);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, notice: cmd.action === "cancel" ? "Rappel annulé." : "Rappel enregistré." });
      await load(); // the receipt may be replayed: the GET is the current truth
      return true;
    }
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    if (r.status === 409 || r.status === 422 || r.status === 400) {
      clearStored(a);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? COPY.conflict : COPY.invalid });
      return false;
    }
    pendingFor = `${a.uid}|${a.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: COPY.retry });
    return false;
  };
  const fresh = (build: (cid: string, data: ReminderState) => ReminderCommand | null) => {
    const data = get().data;
    if (!data || get().pending) return Promise.resolve(false);
    const cid = newId();
    if (!cid) {
      set({ ...get(), error: COPY.noUuid });
      return Promise.resolve(false);
    }
    const cmd = build(cid, data);
    return cmd ? send(cmd) : Promise.resolve(false);
  };
  return {
    load,
    restorePending() {
      const a = ident();
      if (!a.uid) return;
      const raw = safe(() => store()?.get(key(a)) ?? null) ?? null;
      if (raw === null) return;
      let parsed: z.infer<typeof storedSchema> | null = null;
      try {
        const r = storedSchema.safeParse(JSON.parse(raw));
        parsed = r.success ? r.data : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.uid !== a.uid || parsed.gen !== a.gen || parsed.intervention_id !== interventionId) {
        safe(() => store()?.remove(key(a)));
        return;
      }
      pendingFor = `${a.uid}|${a.gen}`;
      set({ ...get(), pending: parsed.command, error: COPY.retry });
    },
    /** Schedule / reschedule / resume: expected_version = the current record's version (or null). */
    schedule(remindAt: string) {
      return fresh((cid, d) =>
        d.can_schedule && d.appointment ? { command_id: cid, action: "schedule", expected_version: d.record?.version ?? null, appointment_version: d.appointment.version, remind_at: remindAt } : null,
      );
    },
    cancel() {
      return fresh((cid, d) => (d.record && d.record.status === "scheduled" ? { command_id: cid, action: "cancel", expected_version: d.record.version } : null));
    },
    retry() {
      const p = get().pending;
      if (!p) return Promise.resolve(false);
      const a = ident();
      if (pendingFor !== `${a.uid}|${a.gen}`) {
        pendingFor = null;
        set({ ...get(), pending: null, error: "" });
        return Promise.resolve(false);
      }
      return send(p);
    },
  };
}
