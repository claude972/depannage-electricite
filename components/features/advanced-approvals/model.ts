// ENT-12 ordered B2B quote approvals — pure model (no React). Strict browser copy of
// lib/features/advanced-approvals/contract.ts + http.ts checks (backend 05cc515):
//   GET/POST /api/sites/:id/approval-policy  → { site_id, policy|null, can_manage } / { site_id, version, replayed }
//   GET/POST /api/quotes/:id/approval[?after] → status (workflow, permissions, events) / { quote_id, version, state, current_step, replayed }
// The UI displays the server state only (chain, current step, permissions); an internal approval is
// never a client acceptance. Every write: identity fence under `courant-private-approvals:` (write +
// read-back or 0 POST, uid + generation + scope, strict restore never auto-sent, no replay after an
// identity change, 401/403 clear), 409 ⇒ honest + reload, 503 / lost reply ⇒ same command.
import { z } from "zod";

export const AP_TIMEOUT_MS = 15_000;
export const AP_TIMEOUT = -1;
export type Result = { status: number; body: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID);
const version = z.number().int().min(1).max(2147483647);
const instant = z.string().refine((v) => /T.*(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)));
const step = z.union([z.object({ role: z.enum(["owner", "manager"]) }).strict(), z.object({ user_id: uuid }).strict()]);
export type Step = z.infer<typeof step>;
const policy = z.object({ version, enabled: z.boolean(), threshold_cents: z.number().int().min(0).max(100000000), steps: z.array(step).min(1).max(10) }).strict();
export type Policy = z.infer<typeof policy>;
const policyCommand = z.object({ command_id: uuid, expected_version: version.max(2147483646).nullable(), enabled: z.boolean(), threshold_cents: policy.shape.threshold_cents, steps: policy.shape.steps }).strict();
export type PolicyCommand = z.infer<typeof policyCommand>;
export const ACTIONS = ["submit", "approve", "reject", "request_information", "respond"] as const;
export type Action = (typeof ACTIONS)[number];
const workflowCommand = z
  .object({ command_id: uuid, expected_version: version.max(2147483646).nullable(), action: z.enum(ACTIONS), note: z.string().max(2000) })
  .strict()
  .refine((v) => v.note === v.note.trim() && (!["reject", "request_information", "respond"].includes(v.action) || v.note.length > 0));
export type WorkflowCommand = z.infer<typeof workflowCommand>;
const STATES = ["pending", "changes_requested", "approved", "rejected"] as const;
export type WfState = (typeof STATES)[number];
const policyStatus = z.object({ site_id: uuid, policy: policy.nullable(), can_manage: z.boolean() }).strict();
export type PolicyStatus = z.infer<typeof policyStatus>;
const policyReceipt = z.object({ site_id: uuid, version, replayed: z.boolean() }).strict();
const workflowReceipt = z.object({ quote_id: uuid, version, state: z.enum(STATES), current_step: z.number().int().min(1).max(10), replayed: z.boolean() }).strict();
const workflowStatus = z
  .object({
    quote_id: uuid,
    site_id: uuid,
    required: z.boolean(),
    approved_current: z.boolean(),
    policy: policy.nullable(),
    workflow: z.object({ version, policy_version: version, state: z.enum(STATES), current_step: z.number().int().min(1).max(10), steps: policy.shape.steps, snapshot_matches: z.boolean() }).strict().nullable(),
    permissions: z.object({ can_submit: z.boolean(), can_decide: z.boolean(), can_respond: z.boolean() }).strict(),
    events: z.array(z.object({ version, actor_id: uuid, action: z.enum(ACTIONS), note: z.string().max(2000), created_at: instant }).strict()).max(50),
    next_after: version.nullable(),
  })
  .strict();
export type WorkflowStatus = z.infer<typeof workflowStatus>;
const lower = (v: string) => v.toLowerCase();

export function parsePolicyStatus(body: unknown, siteId: string): PolicyStatus | null {
  const r = policyStatus.safeParse(body);
  return r.success && lower(r.data.site_id) === lower(siteId) ? r.data : null;
}
/** Same page / scope checks as the route. */
export function parseWorkflowStatus(body: unknown, quoteId: string, after: number): WorkflowStatus | null {
  const r = workflowStatus.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if (lower(d.quote_id) !== lower(quoteId)) return null;
  if (d.events.some((e, i) => e.version <= after || (i > 0 && e.version <= d.events[i - 1].version))) return null;
  if (d.next_after !== null && (d.events.length !== 50 || d.next_after !== d.events[d.events.length - 1].version)) return null;
  if (d.workflow && d.workflow.current_step > d.workflow.steps.length) return null;
  return d;
}
export function parsePolicyReceipt(body: unknown, siteId: string, cmd: PolicyCommand) {
  const r = policyReceipt.safeParse(body);
  return r.success && lower(r.data.site_id) === lower(siteId) && r.data.version === (cmd.expected_version ?? 0) + 1 ? r.data : null;
}
export function parseWorkflowReceipt(body: unknown, quoteId: string, cmd: WorkflowCommand) {
  const r = workflowReceipt.safeParse(body);
  if (!r.success) return null;
  const allowed: WfState[] = cmd.action === "approve" ? ["pending", "approved"] : [cmd.action === "reject" ? "rejected" : cmd.action === "request_information" ? "changes_requested" : "pending"];
  return lower(r.data.quote_id) === lower(quoteId) && r.data.version === (cmd.expected_version ?? 0) + 1 && allowed.includes(r.data.state) ? r.data : null;
}

export type StepView = { index: number; step: Step; status: "done" | "current" | "locked" | "rejected" | "changes_requested" | "approved" };
/** Chain exactly as the server states it: steps before current_step are done, later ones locked. */
export function chain(w: NonNullable<WorkflowStatus["workflow"]>): StepView[] {
  return w.steps.map((step, i) => {
    const n = i + 1;
    if (w.state === "approved") return { index: n, step, status: "approved" };
    if (n < w.current_step) return { index: n, step, status: "done" };
    if (n > w.current_step) return { index: n, step, status: "locked" };
    return { index: n, step, status: w.state === "rejected" ? "rejected" : w.state === "changes_requested" ? "changes_requested" : "current" };
  });
}
/** Mapping for the enterprise timeline: the approval step reflects the server state only. */
export function timelineApproval(s: WorkflowStatus | null | undefined): { status: string } | null | undefined {
  if (!s) return undefined; // unknown: keep the existing (simple) source
  if (!s.required && !s.workflow) return undefined;
  if (s.approved_current) return { status: "approved" };
  if (!s.workflow) return { status: "pending" };
  return { status: s.workflow.state === "rejected" ? "rejected" : s.workflow.state === "approved" && s.workflow.snapshot_matches ? "approved" : "pending" };
}
/** Client acceptance stays blocked while the server requires an approval not yet current. */
export const acceptanceBlocked = (s: WorkflowStatus | null | undefined) => !!s && s.required && !s.approved_current;

/** Whether the client acceptance of the displayed quote is blocked (Astra review of ddc34c7).
 *  - An ACTIVE advanced policy (server policy.enabled) is authoritative: blocked only while the
 *    server says required && !approved_current. An old simple approval still « pending » no longer
 *    blocks, and a quote under the advanced threshold (required false) is not blocked.
 *  - No advanced policy (absent or disabled): the simple rule applies unchanged.
 *  - Live and the advanced state still loading (undefined) or unreadable (null): prudent block.
 *  - Demo (no server state): the simple rule. */
export type AcceptanceDecision = { blocked: boolean; reason: "advanced" | "simple" | "unknown" | null };
/** `advanced` must be the state read FOR THE DISPLAYED QUOTE (callers reset it per quote_id).
 *  `hasSite` false ⇒ no site policy can apply (the route answers 404 for a site-less dossier) ⇒
 *  simple rule. Only a validated 200 (WorkflowStatus) with policy null/disabled confirms the simple
 *  rule for a dossier WITH a site; 401/403/404/error/loading stay undetermined (blocked). */
export function acceptanceDecision(simplePending: boolean, advanced: WorkflowStatus | null | undefined, live: boolean, hasSite = true): AcceptanceDecision {
  const simple: AcceptanceDecision = simplePending ? { blocked: true, reason: "simple" } : { blocked: false, reason: null };
  if (!live || !hasSite) return simple;
  if (advanced === undefined || advanced === null) return { blocked: true, reason: "unknown" };
  if (advanced.policy?.enabled) return advanced.required && !advanced.approved_current ? { blocked: true, reason: "advanced" } : { blocked: false, reason: null };
  return simple;
}

// ---- API ------------------------------------------------------------------------------------------
async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: AP_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? AP_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export type ApApi = {
  policy(siteId: string): Promise<Result>;
  setPolicy(siteId: string, cmd: PolicyCommand): Promise<Result>;
  workflow(quoteId: string, after: number | null): Promise<Result>;
  act(quoteId: string, cmd: WorkflowCommand): Promise<Result>;
};
export function createApApi(fetcher: typeof fetch = (...a) => fetch(...a)): ApApi {
  const enc = encodeURIComponent;
  const post = (url: string, body: unknown) => timed(fetcher, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, AP_TIMEOUT_MS);
  return {
    policy: (id) => timed(fetcher, `/api/sites/${enc(id)}/approval-policy`, { method: "GET" }, AP_TIMEOUT_MS),
    setPolicy: (id, cmd) => post(`/api/sites/${enc(id)}/approval-policy`, cmd),
    workflow: (id, after) => timed(fetcher, `/api/quotes/${enc(id)}/approval${after ? `?after=${after}` : ""}`, { method: "GET" }, AP_TIMEOUT_MS),
    act: (id, cmd) => post(`/api/quotes/${enc(id)}/approval`, cmd),
  };
}

// ---- Identity-fenced writer ----------------------------------------------------------------------
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
export const PENDING_PREFIX = "courant-private-approvals:";
export const pendingKey = (uid: string | null, gen: number, scope: string) => `${PENDING_PREFIX}${uid ?? "-"}:${gen}:${scope}`;
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export const COPY = {
  policyTitle: "Circuit d’approbation du site",
  policyNone: "Aucun circuit avancé : la règle simple du site s’applique.",
  policyDisabled: "Circuit désactivé : la règle simple du site s’applique.",
  policyNote: "Le circuit s’applique aux devis dont le total TTC dépasse strictement le seuil. Un approbateur nommé ne reçoit aucun autre droit.",
  quoteTitle: "Approbation interne du devis",
  notRequired: "Aucune approbation avancée n’est requise pour ce devis.",
  notSubmitted: "Approbation requise : le devis n’a pas encore été soumis au circuit.",
  approved: "Approuvé en interne. Ce n’est pas une acceptation : le devis s’accepte ensuite explicitement.",
  snapshotChanged: "Le devis ou la politique a changé depuis la soumission : une nouvelle soumission est nécessaire.",
  resubmitNote: "Une nouvelle soumission remet toutes les étapes à zéro ; l’historique est conservé.",
  readOnly: "Lecture seule : le circuit est affiché sans action pour votre compte.",
  loading: "Lecture du circuit d’approbation…",
  loadFailed: "Le circuit d’approbation n’a pas pu être lu. Réessayez.",
  forbidden: "Vos droits, vérifiés par le serveur, ne couvrent pas ce circuit d’approbation.",
  demo: "En démonstration, aucun circuit d’approbation n’est lu ni modifié.",
  noEvents: "Aucun événement enregistré.",
  conflict: "Le circuit ou le devis a changé entre-temps (version périmée) : rien n’est renvoyé automatiquement. L’état actuel a été relu.",
  invalid: "Le serveur refuse cette action (étape, droit ou saisie).",
  limited: "Trop de commandes en peu de temps : réessayez dans un instant.",
  notFound: "Cet élément n’est plus accessible.",
  retry: "L’action n’est pas confirmée. Réessayez : la même commande sera renvoyée.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être rejouée à l’identique.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune action n’est possible ici.",
  noteRequired: "Un commentaire est obligatoire pour cette action.",
  saved: "Circuit enregistré.",
  replayed: "Commande déjà enregistrée : l’état actuel a été relu.",
} as const;
export const ACTION_LABEL: Record<Action, string> = { submit: "Soumission", approve: "Approbation", reject: "Rejet", request_information: "Demande de complément", respond: "Réponse" };
export const ACTION_DONE: Record<Action, string> = { submit: "Devis soumis au circuit.", approve: "Étape approuvée.", reject: "Devis rejeté pour cette soumission.", request_information: "Complément demandé.", respond: "Réponse enregistrée." };
export const STEP_STATUS: Record<StepView["status"], string> = { done: "Approuvée", current: "En attente de décision", locked: "Verrouillée (étape précédente non terminée)", rejected: "Rejetée", changes_requested: "Complément demandé", approved: "Approuvée" };

export type WriterState = { busy: boolean; pending: unknown | null; error: string; notice: string };
export const WRITER_INITIAL: WriterState = { busy: false, pending: null, error: "", notice: "" };

/** Generic fenced writer for one scope (`site:<id>` or `quote:<id>`). */
export function createWriter<C extends { command_id: string; expected_version: number | null }>({
  scope,
  schema,
  post,
  receipt,
  store,
  context,
  get,
  set,
  after,
  onForbidden,
  notice,
}: {
  scope: string;
  schema: z.ZodType<C>;
  post: (cmd: C) => Promise<Result>;
  receipt: (body: unknown, cmd: C) => { replayed: boolean } | null;
  store: () => Store | null;
  context: Context;
  get: () => WriterState;
  set: (s: WriterState) => void;
  after: () => Promise<void>;
  onForbidden: () => void;
  notice: (cmd: C) => string;
}) {
  let alive = true;
  let inFlight = false;
  let pendingFor: string | null = null;
  const identity = () => ({ uid: context.userId(), gen: context.generation() });
  const same = (a: { uid: string | null; gen: number }) => alive && context.userId() === a.uid && context.generation() === a.gen;
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const stored = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), scope: z.literal(scope), command: schema }).strict();
  const clearStored = (who = identity()) => safe(() => store()?.remove(pendingKey(who.uid, who.gen, scope)));
  const persist = (cmd: C, who: { uid: string | null; gen: number }) => {
    if (!who.uid) return false;
    const s = store();
    if (!s) return false;
    const key = pendingKey(who.uid, who.gen, scope);
    const value = JSON.stringify({ uid: who.uid, gen: who.gen, scope, command: cmd });
    return safe(() => {
      s.set(key, value);
      return s.get(key) === value;
    }) === true;
  };
  const send = async (cmd: C): Promise<boolean> => {
    if (inFlight) return false;
    const who = identity();
    if (!same(who) || !schema.safeParse(cmd).success || !persist(cmd, who)) {
      set({ ...get(), error: COPY.storage });
      return false;
    }
    inFlight = true;
    set({ ...get(), busy: true, error: "", notice: "" });
    let r: Result;
    try {
      r = await post(cmd);
    } finally {
      inFlight = false;
    }
    if (!same(who)) return false;
    if (r.status === 401 || r.status === 403) {
      clearStored(who);
      pendingFor = null;
      set({ ...WRITER_INITIAL });
      onForbidden();
      return false;
    }
    const ok = r.status === 200 ? receipt(r.body, cmd) : null;
    if (ok) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, notice: ok.replayed ? COPY.replayed : notice(cmd) });
      await after();
      return true;
    }
    if ([409, 400, 404, 422, 429].includes(r.status)) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? COPY.conflict : r.status === 404 ? COPY.notFound : r.status === 429 ? COPY.limited : COPY.invalid });
      if (r.status === 409) await after(); // re-read only, never a replay
      return false;
    }
    pendingFor = `${who.uid}|${who.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: COPY.retry });
    return false;
  };
  return {
    run(cmd: C) {
      if (get().pending || get().busy) return Promise.resolve(false);
      return send(cmd);
    },
    retry() {
      const p = get().pending as C | null;
      if (!p) return Promise.resolve(false);
      const who = identity();
      if (pendingFor !== `${who.uid}|${who.gen}`) {
        pendingFor = null;
        set({ ...get(), pending: null, error: "" });
        return Promise.resolve(false);
      }
      return send(p);
    },
    restore() {
      const who = identity();
      if (!who.uid) return;
      const key = pendingKey(who.uid, who.gen, scope);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return;
      let json: { command?: C } | null = null;
      let ok = false;
      try {
        json = JSON.parse(raw);
        const r = stored.safeParse(json);
        ok = r.success && r.data.uid === who.uid && r.data.gen === who.gen;
      } catch {
        ok = false;
      }
      if (!ok || !json?.command) {
        safe(() => store()?.remove(key));
        return;
      }
      pendingFor = `${who.uid}|${who.gen}`;
      set({ ...get(), pending: json.command, error: COPY.retry });
    },
    stop() {
      alive = false;
    },
  };
}
export const schemas = { policyCommand, workflowCommand };
/** Policy form → command (euros → integer cents, explicit; 1–10 steps, role XOR named member). */
export function buildPolicy(form: { enabled: boolean; threshold: string; steps: Step[] }, commandId: string, expected: number | null): PolicyCommand | null {
  const t = form.threshold.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  const cmd = { command_id: lower(commandId), expected_version: expected, enabled: form.enabled, threshold_cents: cents, steps: form.steps };
  return policyCommand.safeParse(cmd).success ? (cmd as PolicyCommand) : null;
}
export function buildAction(action: Action, note: string, commandId: string, expected: number | null): WorkflowCommand | null {
  const cmd = { command_id: lower(commandId), expected_version: expected, action, note: note.trim() };
  return workflowCommand.safeParse(cmd).success ? (cmd as WorkflowCommand) : null;
}
