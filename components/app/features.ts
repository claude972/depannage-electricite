// Clients for the advanced lots (WEB-SHARED-001). Every client is built here by the lead and
// injected into the leaf components, which never fetch on their own. Two rules apply to each call:
// - identity binding: a reply that lands after the identity generation changed (logout, login as
//   someone else, demo switch) resolves to null and touches nothing — the leaves treat null as a
//   stale chain (no message, no state update);
// - capability truth: a 404/405 marks the contract missing, a 503/network failure marks it
//   unavailable, any other refusal (401/403/409/422…) proves the contract is present and is
//   surfaced to the leaf as the server's own message.
import { api as defaultApi, ApiRequestError, contractStateFromError } from "./api";
import type { ContractState, Role } from "./types";
import { demoPlanning } from "../../lib/features/planning/demo";
import { toIsoWithOffset, weekRange } from "../../lib/features/planning/time";
import { PLANNING_TIME_ZONE } from "../../lib/features/planning/types";
import { demoNotificationPage, demoPreferences } from "../../lib/features/notifications/demo";
import { demoClient as demoSiteOperationsClient, demoReport } from "../../lib/features/site-operations/demo";
import { quoteDocumentsDemo } from "../../lib/features/quote-documents/demo";
import { PLATFORM_DEMO } from "../../lib/features/platform-operations/demo";
import type { PlanningClient } from "../../lib/features/planning/leaf";
import type { PlanningCommand, PlanningCommandResponse, PlanningCommandResult, PlanningView } from "../../lib/features/planning/types";
import type { MarkResult, NotificationsClient, PreferencesSaveResult } from "../../lib/features/notifications/leaf";
import type {
  NotificationListParams,
  NotificationMarkCommand,
  NotificationMarkResult,
  NotificationPage,
  NotificationSummary,
  PreferencesCommand,
  PreferencesView,
} from "../../lib/features/notifications/types";
import type { SiteOperationsClient, SiteOperationsCommand, SiteOperationsCommandResult, SiteOperationsReport } from "../../lib/features/site-operations/types";
import type { QuoteDocumentsClient, QuoteDocumentsCommand, QuoteDocumentsCommandResult, QuoteDocumentsOverview, QuoteDocumentsTarget } from "../../lib/features/quote-documents/types";
import type { ListQuery, PlatformAccess, PlatformClient } from "../../lib/features/platform-operations/types";

export type FeatureKey = "quoteDocuments" | "planning" | "notifications" | "siteOperations" | "platformOperations";
/** Context a re-probe needs when the contract has no context-free read. */
export type ReprobeHint = { siteId?: string; quoteId?: string; interventionId?: string };
/** Only a transient failure is worth a user retry; a missing contract is a deployment state. */
export function retryableState(state: ContractState): boolean {
  return state === "unavailable";
}

export type ReprobeContext = {
  bundle: FeatureClients;
  /** True while the identity, mode and bundle that started this re-probe are still current. */
  alive(): boolean;
  setState(key: FeatureKey, state: ContractState): void;
  /** null = the count is no longer known (current failure). */
  setUnread(count: number | null): void;
  /** null = the access reply is withdrawn (current refusal/failure): the shells close the gate. */
  setAccess(access: PlatformAccess | null): void;
  /** Active enterprise site when the hint carries none. */
  activeSiteId?: string;
};

/**
 * Re-probes ONE contract. Guarded at entry and after every await: a stale chain (identity changed,
 * demo switch, bundle rebuilt) produces no effect at all — `null` from a bound client means "stale",
 * never "currently failing", so nothing of the previous actor touches the next one's state.
 * The bound client itself records the capability from the reply (success → available, 404 →
 * missing, 503/network → unavailable); this function only applies the data side effects.
 */
export async function reprobe(key: FeatureKey, hint: ReprobeHint | undefined, ctx: ReprobeContext): Promise<void> {
  if (!ctx.alive()) return;
  ctx.setState(key, "unknown");
  const swallow = () => null;
  // Three outcomes per read: a value (apply), null (stale chain: no effect at all), an exception
  // (CURRENT failure or refusal: withdraw the derived data under the same guard, never keep stale
  // rights alive — e.g. /me answering 401/403 after the rights were valid closes the gate).
  switch (key) {
    case "notifications": {
      let summary: Awaited<ReturnType<typeof ctx.bundle.notifications.summary>>;
      try {
        summary = await ctx.bundle.notifications.summary();
      } catch {
        if (ctx.alive()) ctx.setUnread(null);
        return;
      }
      if (!ctx.alive() || summary === null) return;
      ctx.setUnread(summary.unread_count);
      return;
    }
    case "platformOperations": {
      let access: Awaited<ReturnType<typeof ctx.bundle.platform.load.me>>;
      try {
        access = await ctx.bundle.platform.load.me();
      } catch {
        if (ctx.alive()) ctx.setAccess(null);
        return;
      }
      if (!ctx.alive() || access === null) return;
      ctx.setAccess(access);
      return;
    }
    case "planning":
      await ctx.bundle.planning.load(planningProbeRange()).catch(swallow);
      return;
    case "siteOperations": {
      const siteId = hint?.siteId || ctx.activeSiteId;
      if (siteId) await ctx.bundle.siteOperations.load(siteId).catch(swallow);
      return;
    }
    case "quoteDocuments": {
      const target = hint?.quoteId ? { quoteId: hint.quoteId } : hint?.interventionId ? { interventionId: hint.interventionId } : null;
      if (target) await ctx.bundle.quoteDocuments.load(target).catch(swallow);
      return;
    }
  }
}
export type Request = <T>(path: string, body?: unknown, method?: string) => Promise<T>;
export type FeatureDeps = {
  /** Current identity generation (createGuard().generation); bumped on every identity change. */
  generation(): number;
  /**
   * Generation that owns this client bundle, captured once at construction. A client kept by an
   * old callback after an identity change refuses BEFORE sending anything (no request under the
   * new actor's cookie) and drops any reply that lands after the change.
   */
  owner?: number;
  /** Records the observed availability of a contract. */
  setState(key: FeatureKey, state: ContractState): void;
  request?: Request;
};

const enc = encodeURIComponent;

function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    parts.push(`${enc(key)}=${enc(value === true ? "1" : String(value))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/** Records only what an error proves about the contract: absent, down, or present (other refusals). */
function observe(deps: FeatureDeps, key: FeatureKey, error: unknown): void {
  if (error instanceof ApiRequestError) {
    if (error.status === 404 || error.status === 405 || error.status === 503 || error.status === 0) {
      deps.setState(key, contractStateFromError(error));
      return;
    }
    deps.setState(key, "available");
  }
}

/**
 * Runs one request bound to the identity generation. Resolves null when the identity changed
 * meanwhile (success or failure alike: nothing of another identity reaches the screen); otherwise
 * returns the value or rethrows the server's error for the leaf to render.
 */
export async function bound<T>(deps: FeatureDeps, key: FeatureKey, task: () => Promise<T>): Promise<T | null> {
  const generation = deps.owner ?? deps.generation();
  if (generation !== deps.generation()) return null; // stale bundle: nothing is sent
  try {
    const value = await task();
    if (generation !== deps.generation()) return null;
    deps.setState(key, "available");
    return value;
  } catch (error) {
    if (generation !== deps.generation()) return null;
    observe(deps, key, error);
    throw error;
  }
}

/** Same binding, but refusals become a `{ ok:false }` result instead of a thrown error. */
async function boundResult<T, R>(
  deps: FeatureDeps,
  key: FeatureKey,
  task: () => Promise<T>,
  success: (value: T) => R,
  refusal: (error: ApiRequestError) => R,
): Promise<R | null> {
  try {
    const value = await bound(deps, key, task);
    return value === null ? null : success(value);
  } catch (error) {
    if (error instanceof ApiRequestError) return refusal(error);
    throw error;
  }
}

const requestOf = (deps: FeatureDeps): Request => deps.request ?? ((path, body, method) => defaultApi(path, body, method));
/** Pins the bundle to the generation current at construction (idempotent when already pinned). */
const owned = (deps: FeatureDeps): FeatureDeps => (deps.owner === undefined ? { ...deps, owner: deps.generation() } : deps);

/**
 * Range used by the controller's planning probe: the current week in the planning time zone, as
 * full ISO instants with offset (what GET /api/planning validates), end strictly after start.
 */
export function planningProbeRange(now: Date | number | string = new Date(), zone = PLANNING_TIME_ZONE): { from: string; to: string } {
  const week = weekRange(now, zone);
  return { from: toIsoWithOffset(week.from, zone), to: toIsoWithOffset(week.to, zone) };
}

export function createPlanningClient(input: FeatureDeps): PlanningClient {
  const deps = owned(input);
  const request = requestOf(deps);
  return {
    load: (range) => bound(deps, "planning", () => request<PlanningView>(`/api/planning${query({ from: range.from, to: range.to })}`)),
    command: (body: PlanningCommand) =>
      boundResult<PlanningCommandResponse, PlanningCommandResult>(
        deps,
        "planning",
        () => request<PlanningCommandResponse>("/api/planning", body),
        (data) => ({ ok: true as const, data }),
        (error) => ({ ok: false as const, conflict: error.status === 409, message: error.message }),
      ),
  };
}

export function createNotificationsClient(input: FeatureDeps): NotificationsClient {
  const deps = owned(input);
  const request = requestOf(deps);
  const refusal = (error: ApiRequestError) => ({ ok: false as const, conflict: error.status === 409, message: error.message });
  return {
    list: (params: NotificationListParams) =>
      bound(deps, "notifications", () => request<NotificationPage>(`/api/notifications${query({ limit: params.limit, cursor: params.cursor, unread: params.unread })}`)),
    summary: () => bound(deps, "notifications", () => request<NotificationSummary>("/api/notifications/summary")),
    mark: (body: NotificationMarkCommand) =>
      boundResult<NotificationMarkResult, MarkResult>(deps, "notifications", () => request<NotificationMarkResult>("/api/notifications", body), (result) => ({ ok: true as const, result }), refusal),
    loadPreferences: () => bound(deps, "notifications", () => request<PreferencesView>("/api/notifications/preferences")),
    savePreferences: (body: PreferencesCommand) =>
      boundResult<PreferencesView, PreferencesSaveResult>(deps, "notifications", () => request<PreferencesView>("/api/notifications/preferences", body), (view) => ({ ok: true as const, view }), refusal),
  };
}

export function createSiteOperationsClient(input: FeatureDeps): SiteOperationsClient {
  const deps = owned(input);
  const request = requestOf(deps);
  return {
    load: (siteId: string) => bound(deps, "siteOperations", () => request<SiteOperationsReport>(`/api/site-operations${query({ site_id: siteId })}`)),
    command: (command: SiteOperationsCommand) => bound(deps, "siteOperations", () => request<SiteOperationsCommandResult>("/api/site-operations", command)),
  };
}

export function createQuoteDocumentsClient(input: FeatureDeps): QuoteDocumentsClient {
  const deps = owned(input);
  const request = requestOf(deps);
  return {
    load: (target: QuoteDocumentsTarget) =>
      bound(deps, "quoteDocuments", () =>
        request<QuoteDocumentsOverview>(
          `/api/quote-documents${query("quoteId" in target ? { quote_id: target.quoteId } : { intervention_id: target.interventionId })}`,
        ),
      ),
    command: (body: QuoteDocumentsCommand) =>
      bound(deps, "quoteDocuments", () =>
        request<QuoteDocumentsCommandResult>(body.action === "set_terms" || body.action === "generate" ? "/api/quote-documents" : "/api/quote-amendments", body),
      ),
    documentHref: (documentId: string, inline?: boolean) => `/api/quote-documents/${enc(documentId)}${inline ? "?inline=1" : ""}`,
  };
}

const PLATFORM = "/api/platform-operations";
const listPath = (segment: string, q?: ListQuery) => `${PLATFORM}/${segment}${query((q ?? {}) as Record<string, string | number | null | undefined>)}`;

export function createPlatformClient(input: FeatureDeps): PlatformClient {
  const deps = owned(input);
  const request = requestOf(deps);
  const key: FeatureKey = "platformOperations";
  const get = <T>(path: string) => bound(deps, key, () => request<T>(path));
  const post = <T>(path: string, body: unknown, method?: string) => bound(deps, key, () => request<T>(path, body, method));
  return {
    load: {
      me: () => get<PlatformAccess>(`${PLATFORM}/me`),
      operators: (q) => get(listPath("operators", q)),
      audit: (q) => get(listPath("audit", q)),
      settings: () => get(`${PLATFORM}/settings`),
      billingContact: (subject_kind, subject_id) => get(`${PLATFORM}/billing-contacts${query({ subject_kind, subject_id })}`),
      finance: () => get(`${PLATFORM}/finance`),
      ledger: (q) => get(listPath("finance/ledger", q)),
      invoices: (q) => get(listPath("finance/invoices", q)),
      invoice: (id) => get(`${PLATFORM}/finance/invoices/${enc(id)}`),
      refundRequests: (q) => get(listPath("finance/refund-requests", q)),
      disputes: (q) => get(listPath("finance/disputes", q)),
      reviews: (q) => get(listPath("reviews", q)),
    },
    command: {
      grant: (input) => post(`${PLATFORM}/operators`, { action: "grant", ...input }),
      revoke: (input) => post(`${PLATFORM}/operators`, { action: "revoke", ...input }),
      setSuperAdmin: (input) => post(`${PLATFORM}/super-admins`, input),
      setSetting: (input) => post(`${PLATFORM}/settings`, input, "PUT"),
      setBillingContact: (input) => post(`${PLATFORM}/billing-contacts`, input, "PUT"),
      reconcile: (input) => post(`${PLATFORM}/finance`, { action: "reconcile", ...input }),
      invoiceReadiness: (input) => post(`${PLATFORM}/finance/invoices`, { action: "readiness", ...input }),
      issueInvoice: (input) => post(`${PLATFORM}/finance/invoices`, { action: "issue", ...input }),
      issueCreditNote: (input) => post(`${PLATFORM}/finance/invoices`, { action: "credit_note", ...input }),
      requestRefund: (input) => post(`${PLATFORM}/finance/refund-requests`, input),
      decideRefund: (id, input) => post(`${PLATFORM}/finance/refund-requests/${enc(id)}`, input),
      openDispute: (input) => post(`${PLATFORM}/finance/disputes`, input),
      decideDispute: (id, input) => post(`${PLATFORM}/finance/disputes/${enc(id)}`, input),
      moderateReview: (id, input) => post(`${PLATFORM}/reviews/${enc(id)}`, input),
      contestReview: (id, input) => post(`${PLATFORM}/reviews/${enc(id)}`, { action: "contest", ...input }),
      decideContestation: (id, input) => post(`${PLATFORM}/reviews/${enc(id)}`, { action: "decide", ...input }),
    },
  };
}

export type PlatformView = "platform-operators" | "platform-finance" | "platform-moderation";
/**
 * Fail-closed gate for the back-office views: the server reply to /me is the only truth. A limited
 * operator keeps an ordinary profile role (client/manager) and is never promoted; without a reply
 * (unknown, unavailable, stale) nothing is rendered.
 */
export function platformViewAllowed(access: PlatformAccess | null | undefined, view: PlatformView): boolean {
  if (!access) return false;
  if (access.super_admin === true) return true;
  const caps = access.capabilities;
  if (!caps) return false;
  switch (view) {
    case "platform-operators":
      return caps.operators === true;
    case "platform-finance":
      return caps.finance === true;
    case "platform-moderation":
      return caps.reviews_moderation === true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Bundle injected through the session, and the strictly isolated demonstration counterpart.
export type FeatureClients = {
  planning: PlanningClient;
  notifications: NotificationsClient;
  siteOperations: SiteOperationsClient;
  quoteDocuments: QuoteDocumentsClient;
  platform: PlatformClient;
  /** True when every client above operates on demonstration seeds only (no network). */
  demo: boolean;
  /** Identity generation that owns this bundle, captured at construction (never at invocation). */
  owner: number;
};

export function createFeatureClients(input: FeatureDeps): FeatureClients {
  const deps = owned(input); // one owner generation for the whole bundle
  return {
    planning: createPlanningClient(deps),
    notifications: createNotificationsClient(deps),
    siteOperations: createSiteOperationsClient(deps),
    quoteDocuments: createQuoteDocumentsClient(deps),
    platform: createPlatformClient(deps),
    demo: false,
    owner: deps.owner as number,
  };
}

export const DEMO_COMMAND_MESSAGE = "Démonstration : action non disponible.";
const page = <T,>(items: T[]) => ({ limit: items.length, total: items.length, has_more: false, next_cursor: null });

/**
 * Demonstration clients: seeds in memory, zero network, every command refused with the explicit
 * demonstration message (rendered as-is by the leaves). The leaves also receive the seeds through
 * their `demo` prop and never call `load` in that mode; these clients are the safety net.
 */
export function createDemoFeatureClients(role: Role): FeatureClients {
  const refuse = { ok: false as const, conflict: false, message: DEMO_COMMAND_MESSAGE };
  const refusal = () => Promise.reject(new ApiRequestError(403, DEMO_COMMAND_MESSAGE));
  const d = PLATFORM_DEMO;
  return {
    planning: {
      load: async (range) => demoPlanning(range),
      command: async () => refuse,
    },
    notifications: {
      list: async (params) => demoNotificationPage(params),
      summary: async () => ({ unread_count: demoNotificationPage({}).unread_count, latest_created_at: null }),
      mark: async () => refuse,
      loadPreferences: async () => demoPreferences(),
      savePreferences: async () => refuse,
    },
    siteOperations: demoSiteOperationsClient(demoReport()),
    quoteDocuments: {
      load: async () => quoteDocumentsDemo(role),
      command: refusal,
      documentHref: (documentId, inline) => `/api/quote-documents/${enc(documentId)}${inline ? "?inline=1" : ""}`,
    },
    platform: {
      load: {
        me: async () => d.access,
        operators: async () => ({ grants: d.grants, page: page(d.grants) }),
        audit: async () => ({ entries: d.audit, page: page(d.audit) }),
        settings: async () => ({ invoice_issuer: null, commission_bps: null }),
        billingContact: async () => ({ billing_contact: null }),
        finance: async () => ({ report: d.report, config: d.access.config }),
        ledger: async () => ({ entries: d.ledger, page: page(d.ledger) }),
        invoices: async () => ({ invoices: d.invoices, page: page(d.invoices) }),
        invoice: refusal,
        refundRequests: async () => ({ requests: d.refundRequests, page: page(d.refundRequests) }),
        disputes: async () => ({ disputes: d.disputes, page: page(d.disputes) }),
        reviews: async () => ({ reviews: d.reviews, page: page(d.reviews) }),
      },
      command: {
        grant: refusal,
        revoke: refusal,
        setSuperAdmin: refusal,
        setSetting: refusal,
        setBillingContact: refusal,
        reconcile: refusal,
        invoiceReadiness: refusal,
        issueInvoice: refusal,
        issueCreditNote: refusal,
        requestRefund: refusal,
        decideRefund: refusal,
        openDispute: refusal,
        decideDispute: refusal,
        moderateReview: refusal,
        contestReview: refusal,
        decideContestation: refusal,
      },
    },
    demo: true,
    owner: -1, // demonstration bundles never re-probe
  };
}
