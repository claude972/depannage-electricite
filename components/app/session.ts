// Pure session logic: view access, hash routing, return parameters, quote selection and
// derived operational figures. No React, no network — covered by tests/ui.
import type {
  Intervention,
  Mode,
  Payment,
  Quote,
  ReturnContext,
  Review,
  Role,
  View,
} from "./types";

const PUBLIC_VIEWS: readonly View[] = [
  "home",
  "help",
  "about",
  "privacy",
  "legal",
  "pricing",
  "join",
  "join-organization",
  "demo",
  "auth",
  "new",
];
const ACCESS: Record<View, readonly Role[] | "public"> = {
  home: "public",
  help: "public",
  about: "public",
  privacy: "public",
  legal: "public",
  pricing: "public",
  join: "public",
  "join-organization": "public",
  demo: "public",
  auth: "public",
  forbidden: "public",
  new: ["client", "manager"],
  overview: ["client", "artisan", "manager", "admin"],
  requests: ["client", "manager"],
  detail: ["client", "artisan", "manager", "admin"],
  quote: ["client", "manager", "artisan", "admin"],
  missions: ["artisan"],
  mission: ["artisan"],
  quotes: ["artisan"],
  performance: ["artisan"],
  application: ["artisan"],
  messages: ["client", "artisan", "manager", "admin"],
  documents: ["client", "artisan", "manager", "admin"],
  profile: ["client", "artisan", "manager", "admin"],
  support: ["client", "artisan", "manager", "admin"],
  sites: ["manager"],
  site: ["manager"],
  approvals: ["manager"],
  approval: ["manager"],
  contracts: ["manager"],
  reports: ["manager"],
  members: ["manager"],
  invoices: ["manager"],
  admin: ["admin"],
  "admin-artisans": ["admin"],
  "admin-artisan": ["admin"],
  "admin-interventions": ["admin"],
  "admin-quotes": ["admin"],
  "admin-clients": ["admin"],
  "admin-reviews": ["admin"],
  "admin-messages": ["admin"],
  "admin-settings": ["admin"],
  "admin-warranty": ["admin"],
  // Advanced lots: role gate only; the server re-checks every right (visibility grants nothing).
  "quote-documents": ["client", "artisan", "manager", "admin"],
  planning: ["artisan"],
  notifications: ["client", "artisan", "manager", "admin"],
  "site-operations": ["manager"],
  // Back-office views: a limited operator keeps a client/manager profile role, so the role gate
  // admits every signed-in role and the server reply to /me decides, fail-closed (see
  // platformViewAllowed in features.ts). Visibility never grants anything.
  "platform-operators": ["client", "artisan", "manager", "admin"],
  "platform-finance": ["client", "artisan", "manager", "admin"],
  "platform-moderation": ["client", "artisan", "manager", "admin"],
  // E32: read-only audit journal, opened only by the /me capability `audit`.
  "platform-audit": ["client", "artisan", "manager", "admin"],
  "support-queue": ["client", "artisan", "manager", "admin"],
};
export const ALL_VIEWS = Object.keys(ACCESS) as View[];
export function isView(value: string): value is View {
  return Object.prototype.hasOwnProperty.call(ACCESS, value);
}
// Authorization of a rendered view. Public views stay reachable in every mode; authenticated
// views require a session (demo or live) whose role is listed. The demo role never grants
// anything in live mode because the live role is only ever the server profile role.
export function canAccess(view: View, role: Role | null, mode: Mode): boolean {
  const rule = ACCESS[view];
  if (rule === "public") return true;
  // Signed-out visitors may open the public request form directly (#new): it only saves a local
  // draft and leads to sign-up. Role-restricted views stay closed in public mode.
  if (mode === "public" || !role) return mode === "public" && PUBLIC_VIEWS.includes(view);
  return rule.includes(role);
}
export function homeFor(role: Role | null, mode: Mode): View {
  if (mode === "public" || !role) return "home";
  return role === "admin" ? "admin" : "overview";
}
export function parseHash(hash: string): { view: View | null; param: string } {
  const raw = hash.replace(/^#\/?/, "");
  if (!raw) return { view: null, param: "" };
  const [head, ...rest] = raw.split("/");
  if (!isView(head)) return { view: null, param: "" };
  const joined = rest.join("/");
  let param = "";
  try {
    param = decodeURIComponent(joined);
  } catch {
    // Malformed percent-encoding typed by hand: ignore the parameter, keep the view.
    param = "";
  }
  // Parameters are identifiers; anything else is dropped so it never reaches a lookup or the DOM.
  if (!/^[A-Za-z0-9_.-]{0,120}$/.test(param)) param = "";
  return { view: head, param };
}
export function buildHash(view: View, param?: string): string {
  return param ? `${view}/${encodeURIComponent(param)}` : view;
}
export function isPublicView(view: View) {
  return PUBLIC_VIEWS.includes(view) || view === "forbidden";
}
/** A signed-in destination reached by hash: a non-public view with its parameter. */
export type DeepLink = { view: View; param: string };
/** A hash that names a signed-in view (e.g. #detail/<id>), whatever the current mode; else null. */
export function protectedLink(hash: string): DeepLink | null {
  const parsed = parseHash(hash);
  return parsed.view && !isPublicView(parsed.view) ? { view: parsed.view, param: parsed.param } : null;
}
// Landing of a login chain (WEB-DEEPLINK-LOGIN-001). A signed-in view already in the address bar
// (link opened or set while the session was loading) wins; otherwise the deep link a signed-out
// visitor opened before going to the login form; otherwise null (role home). Never a view the
// role may not open: the role guard decides, the server still re-checks every read.
export function loginLanding(currentHash: string, pending: DeepLink | null, role: Role | null): DeepLink | null {
  for (const link of [protectedLink(currentHash), pending])
    if (link && canAccess(link.view, role, "live")) return link;
  return null;
}
// Server return parameters are only hints to re-read state; they never set a status.
export function parseReturnParams(search: string): ReturnContext | null {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const payment = q.get("payment");
  const intervention = q.get("intervention") || "";
  if (payment === "pending" || payment === "cancelled")
    return { kind: "payment", state: payment, interventionId: intervention };
  const connect = q.get("connect");
  if (connect === "returned" || connect === "refresh")
    return { kind: "connect", state: connect };
  const bookingId = q.get("booking_request_id") ?? "";
  const bookingReturn = q.get("booking_return");
  if ((bookingReturn === "success" || bookingReturn === "cancel") && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bookingId))
    return { kind: "booking", state: bookingReturn, requestId: bookingId.toLowerCase() };
  const auth = q.get("auth");
  if (auth === "confirmed" || auth === "expired")
    return { kind: "auth", state: auth };
  return null;
}
// The quote the user is looking at: the exact version when a quote id is given, otherwise the
// active (sent/accepted) quote, otherwise the most recent one. Acceptance must send this id.
export function pickQuote(
  quotes: Quote[],
  interventionId: string,
  quoteId?: string,
): Quote | undefined {
  const mine = quotes.filter((q) => q.intervention_id === interventionId);
  if (quoteId) return mine.find((q) => q.id === quoteId);
  return [...mine].sort(
    (a, b) =>
      Number(["sent", "accepted"].includes(b.status)) -
        Number(["sent", "accepted"].includes(a.status)) ||
      Date.parse(b.created_at) - Date.parse(a.created_at),
  )[0];
}
export function quoteVersions(quotes: Quote[], interventionId: string): Quote[] {
  return quotes
    .filter((q) => q.intervention_id === interventionId)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
// Artisan "missions of the day": assigned work that is active. Without appointments the
// day grouping uses the creation date of active dossiers and says so in the UI.
export function artisanMissions(interventions: Intervention[], artisanId: string) {
  const mine = interventions.filter((i) => i.artisan_id === artisanId);
  return {
    active: mine.filter((i) =>
      ["assigned", "quoted", "accepted", "in_progress"].includes(i.status),
    ),
    awaitingPayment: mine.filter((i) => i.status === "completed"),
    done: mine.filter((i) => i.status === "paid"),
    offers: interventions.filter(
      (i) => i.status === "requested" && !i.artisan_id,
    ),
    quotesToWrite: mine.filter((i) => i.status === "assigned"),
  };
}
export type Performance = {
  rating: { average: number; count: number } | null;
  monthRevenueCents: number;
  monthPaidCount: number;
  completedCount: number;
  onTimeRate: null;
  period: string;
  basis: string;
};
// Figures are computed only from loaded, authorised data and labelled with their formula.
// Punctuality has no measurable source yet (no appointments history on workspace) → null.
export function artisanPerformance(
  interventions: Intervention[],
  quotes: Quote[],
  payments: Payment[],
  reviews: Review[],
  artisanId: string,
  now: Date,
): Performance {
  const mine = interventions.filter((i) => i.artisan_id === artisanId);
  const mineIds = new Set(mine.map((i) => i.id));
  const myQuotes = new Map(
    quotes.filter((q) => mineIds.has(q.intervention_id)).map((q) => [q.id, q]),
  );
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let monthRevenueCents = 0;
  let monthPaidCount = 0;
  for (const p of payments) {
    if (p.status !== "paid" || !myQuotes.has(p.quote_id) || !p.paid_at) continue;
    const paid = new Date(p.paid_at);
    if (paid >= monthStart && paid <= now) {
      monthRevenueCents += p.total_cents;
      monthPaidCount += 1;
    }
  }
  const myReviews = reviews.filter((r) => mineIds.has(r.intervention_id));
  const rating = myReviews.length
    ? {
        average:
          Math.round(
            (myReviews.reduce((n, r) => n + r.rating, 0) / myReviews.length) * 10,
          ) / 10,
        count: myReviews.length,
      }
    : null;
  return {
    rating,
    monthRevenueCents,
    monthPaidCount,
    completedCount: mine.filter((i) => i.status === "paid").length,
    onTimeRate: null,
    period: new Intl.DateTimeFormat("fr-FR", {
      month: "long",
      year: "numeric",
    }).format(now),
    basis:
      "Règlements Stripe confirmés par le serveur (statut payé) sur les dossiers chargés, TTC ; avis déposés par les clients de vos interventions.",
  };
}
// Enterprise context: organisation must be explicit; the first organisation is a default only
// when there is exactly one. Sites and interventions follow the active organisation.
export function enterpriseContext<
  S extends { id: string; organization_id?: string },
  I extends { site_id?: string | null },
>(
  organizations: { id: string }[],
  sites: S[],
  interventions: I[],
  activeOrganizationId: string,
  activeSiteId: string,
) {
  const organizationId =
    activeOrganizationId && organizations.some((o) => o.id === activeOrganizationId)
      ? activeOrganizationId
      : organizations.length === 1
        ? organizations[0].id
        : "";
  const orgSites = organizationId
    ? sites.filter((s) => !s.organization_id || s.organization_id === organizationId)
    : sites;
  const siteId =
    activeSiteId && orgSites.some((s) => s.id === activeSiteId) ? activeSiteId : "";
  const siteIds = new Set(orgSites.map((s) => s.id));
  const scoped = interventions.filter((i) =>
    siteId ? i.site_id === siteId : !organizationId || (i.site_id && siteIds.has(i.site_id)),
  );
  return { organizationId, siteId, sites: orgSites, interventions: scoped, needsChoice: !organizationId && organizations.length > 1 };
}

// Calendar-month bounds in the browser's timezone, as ISO instants for the performance contract.
export function monthPeriods(now: Date) {
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    current_start: currentStart.toISOString(),
    current_end: currentEnd.toISOString(),
    previous_start: previousStart.toISOString(),
    previous_end: currentStart.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
  };
}
// Effective authority in the active organisation: the membership role, never the global role.
export function membershipRole(
  members: { organization_id: string; user_id: string; role: string }[],
  organizationId: string,
  userId: string,
): "owner" | "manager" | "viewer" | null {
  const m = members.find((x) => x.organization_id === organizationId && x.user_id === userId);
  if (!m) return null;
  return m.role === "owner" || m.role === "manager" || m.role === "viewer" ? m.role : null;
}
export const INVITE_TOKEN = /^[0-9a-f]{64}$/;

// Wording after a Stripe Checkout return. The URL state is only a hint; the server status
// (payment status endpoint or workspace payment) decides. Never promises absence of debit,
// never promises a retry the server may refuse.
export type PaymentServerStatus = "paid" | "pending" | "failed" | "expired" | "none" | "unknown";
export function paymentReturnMessage(
  urlState: "pending" | "cancelled",
  serverStatus: PaymentServerStatus,
): { tone: "success" | "error" | "info"; text: string } {
  if (serverStatus === "paid")
    return {
      tone: "success",
      text: "Règlement confirmé par la plateforme. Le devis accepté est archivé dans vos documents.",
    };
  if (serverStatus === "failed")
    return {
      tone: "error",
      text: "Le paiement n’a pas abouti selon Stripe. Le règlement reste à effectuer ; aucune nouvelle tentative n’est lancée automatiquement. Vérifiez auprès de votre banque avant de recommencer.",
    };
  if (serverStatus === "expired")
    return {
      tone: "error",
      text: "La page de paiement a expiré sans règlement confirmé. Vous pouvez relancer le paiement depuis ce dossier.",
    };
  if (urlState === "cancelled")
    return {
      tone: "info",
      text: "Retour depuis la page de paiement sans confirmation. Aucun règlement n’est confirmé pour l’instant ; si vous aviez validé un paiement, sa confirmation arrivera par Stripe et ce dossier se mettra à jour.",
    };
  if (serverStatus === "unknown")
    return {
      tone: "info",
      text: "Retour de paiement reçu, mais l’état n’a pas pu être relu pour le moment. Actualisez ce dossier dans un instant : le statut affiché vient toujours de la plateforme.",
    };
  return {
    tone: "info",
    text: "Retour de paiement reçu. La confirmation définitive arrive par Stripe ; ce dossier se mettra à jour automatiquement.",
  };
}
export const CONNECT_RETURN_MESSAGE: Record<"returned" | "refresh", string> = {
  returned:
    "Retour depuis Stripe enregistré. Cette interface n’a pas vérifié l’état de votre compte de règlement : Stripe peut encore demander des informations avant d’activer les virements.",
  refresh:
    "Le lien Stripe a expiré avant la fin du parcours. Relancez la configuration pour obtenir un nouveau lien.",
};

// After a workspace reload, an active organisation or site that the server no longer returns
// is not a valid context anymore. Returns what must be kept.
export function validateContext(
  organizations: { id: string }[],
  sites: { id: string }[],
  activeOrganizationId: string,
  activeSiteId: string,
): { organizationId: string; siteId: string; organizationDropped: boolean } {
  const orgOk = !activeOrganizationId || organizations.some((o) => o.id === activeOrganizationId);
  if (!orgOk) return { organizationId: "", siteId: "", organizationDropped: true };
  const siteOk = !activeSiteId || sites.some((s) => s.id === activeSiteId);
  return { organizationId: activeOrganizationId, siteId: siteOk ? activeSiteId : "", organizationDropped: false };
}

// Write authority inside the active organisation, derived from the membership role AND the
// site scope/grants of the current member (contract 009). The global "manager" role grants
// nothing by itself. Used to disable/hide write controls before the server refuses them.
export type MemberScope = {
  scope: "all" | "selected";
  grants: { site_id: string; can_write: boolean }[];
};
export type EnterpriseAuthority = {
  role: "owner" | "manager" | "viewer" | null;
  /** Organisation-wide writes (create site, contracts, invitations…): owner/manager with scope all. */
  canWriteOrganization: boolean;
  /** Operational writes on a given site (requests, budget, rules, compliance). */
  canWriteSite(siteId: string | null | undefined): boolean;
  canReadSite(siteId: string | null | undefined): boolean;
  /** Short reason shown next to a disabled control. */
  readOnlyReason: string | null;
};
// Fail closed: a manager whose site scope could not be read gets NO write control until the
// scope is known; only the canonical owner always has every site.
export function enterpriseAuthority(
  role: "owner" | "manager" | "viewer" | null,
  scope: MemberScope | null | undefined,
): EnterpriseAuthority {
  const scopeKnown = role === "owner" || !!scope;
  const effectiveScope: MemberScope =
    role === "owner" ? { scope: "all", grants: [] } : scope ?? { scope: "selected", grants: [] };
  const writer = (role === "owner" || role === "manager") && scopeKnown;
  const canWriteOrganization = writer && effectiveScope.scope === "all";
  const canReadSite = (siteId: string | null | undefined) =>
    !!role && (effectiveScope.scope === "all" || !siteId || effectiveScope.grants.some((g) => g.site_id === siteId));
  const canWriteSite = (siteId: string | null | undefined) => {
    if (!writer) return false;
    if (effectiveScope.scope === "all") return true;
    if (!siteId) return false;
    return effectiveScope.grants.some((g) => g.site_id === siteId && g.can_write);
  };
  const readOnlyReason =
    role === null
      ? "Vous n’êtes pas membre de cette organisation."
      : role === "viewer"
        ? "Votre rôle est en lecture seule dans cette organisation."
        : !scopeKnown
          ? "Vos droits par site n’ont pas pu être vérifiés : les modifications sont désactivées jusqu’à la prochaine actualisation."
          : effectiveScope.scope === "selected"
            ? "Vos droits d’écriture sont limités à certains sites."
            : null;
  return { role, canWriteOrganization, canWriteSite, canReadSite, readOnlyReason };
}
