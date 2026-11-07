"use client";
// Session controller: identity, mode (public/demo/live), role guards, hash routing, data
// loading with late-response protection, and every mutation (live contract or explicit demo
// counterpart). Role spaces under components/role render the screens.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { api, ApiRequestError, contractStateFromError, uploadDocument } from "./app/api";
import { createGuard, createRunner, runForResult, type RunContext, type Runner } from "./app/guard";
import { adoptIdentity } from "./app/identity";
import { demoTicketPermissions } from "./role/support-lists";
import { createDemoFeatureClients, createFeatureClients, planningProbeRange, reprobe, type FeatureKey, type ReprobeHint } from "./app/features";
import type { PlatformAccess } from "../lib/features/platform-operations/types";
import { PLATFORM_DEMO } from "../lib/features/platform-operations/demo";
import { demoNotificationPage } from "../lib/features/notifications/demo";
import { createRevalidationScheduler } from "./app/revalidate";
import { createRefreshCoordinator, refreshContextKey, type ReadResult, type RefreshCoordinator } from "./app/workspace-refresh";
import { safeCheckoutUrl } from "./app/booking-status";
import { CARD_RETURN_COPY, PENDING_COPY, cancelCardReturn, cardAction, lookupPending, sameReturn, verifyCardReturn, type CardReturn } from "./app/card-return";
import { createWorkspaceReader } from "./app/workspace-reader";
import {
  acknowledgeUpload,
  allUploaded,
  processUploadQueue,
  reconcileUncertain,
  removeQueue,
  uploadSummary,
  upsertQueue,
} from "./app/uploads";
import {
  DEMO_IDS,
  DEMO_KEYS,
  DEMO_NAMES,
  adminOverviewFromDemo,
  adminSeed,
  artisanSeed,
  clearDemo,
  demoParticipants,
  proSeed,
  readDemo,
  seed,
  writeDemo,
  type DemoOperations,
} from "./app/demo";
import { resolveDisplayName } from "./app/display-name";
import { draftNotice, getDraftStorage, readBootDraft } from "./app/request-draft-boot";
import { BOOKING_DRAFT_KEY, PAYMENT_LABEL, clearBooking, ensureRequestId, readBooking, saveBooking, type BookingDraft } from "./app/booking-draft";
import { DEFINITIVE_REFUSAL, prepareRequestKey, settleRequestKey } from "./app/request-key";
import { purgePrivateStorage } from "./app/private-storage";
import { bookingFromSignedRequest, readPhotoCount, writePhotoCount } from "./app/signed-booking";

type BookingReceipt = {
  status: "confirmed";
  intervention: { id: string; status: string; estimate_min_cents?: number; estimate_max_cents?: number };
  payment?: { method: "on_site" | "card_hold"; status: string };
};
import { savePublicDraft } from "../lib/shared/request-draft";
import { REALTIME_CHANNEL_CONFIG, REALTIME_TABLES, nextConnection } from "./app/realtime";
import { category, uid } from "./app/format";
import {
  CONNECT_RETURN_MESSAGE,
  INVITE_TOKEN,
  buildHash,
  enterpriseContext,
  canAccess,
  homeFor,
  loginLanding,
  membershipRole,
  monthPeriods,
  parseHash,
  parseReturnParams,
  paymentReturnMessage,
  protectedLink,
  pickQuote,
  validateContext,
  type DeepLink,
  type PaymentServerStatus,
} from "./app/session";
import type { PublicSession, Session } from "./app/session-types";
import {
  EMPTY_PROFESSIONAL,
  EMPTY_WORKSPACE,
  UNKNOWN_CAPABILITIES,
  type AdminInterventionDetail,
  type AdminInterventionsPage,
  type AdminListFilters,
  type AdminOverview,
  type DirectoryFilters,
  type DirectoryItem,
  type DirectoryKind,
  type DirectoryPage,
  type ArtisanCommand,
  type ArtisanDossier,
  type ArtisanPerformanceReport,
  type InvitationCreated,
  type OrganizationCommand,
  type OrganizationOverview,
  type PaymentStatusReport,
  type SiteAccessCommand,
  type SiteAccessOverview,
  type SupportCommand,
  type SupportCommandResult,
  type SupportCreateResult,
  type SupportDetail,
  type SupportEvent,
  type SupportListFilters,
  type SupportListPage,
  type SupportMessage,
  type SupportTicket,
  type UploadQueue,
  type Capabilities,
  type Category,
  type Intervention,
  type InterventionAction,
  type Line,
  type Mode,
  type OperationBody,
  type Operations,
  type ProfessionalData,
  type Profile,
  type Quote,
  type QuoteDraft,
  type QuoteDraftCommand,
  type QuoteDraftEnvelope,
  type QuoteDraftResult,
  type RequestValues,
  type ReturnContext,
  type Role,
  type Status,
  type StoredDocument,
  type View,
  type Workspace,
} from "./app/types";
import { PublicSite } from "./role/public-site";
import { ClientSpace } from "./role/client-space";
import { ArtisanSpace } from "./role/artisan-space";
import { EnterpriseSpace } from "./role/enterprise-space";
import { AdminSpace } from "./role/admin-space";
import { isTaxRate } from "./app/tax-rate";

const DRAFT_KEY = "courant-request-draft";
const INVITE_KEY = "courant-invitation-code";
type AuthMode = "login" | "signup" | "reset";

export default function CourantApp() {
  const [mode, setMode] = useState<Mode>("public");
  const [role, setRole] = useState<Role>("client");
  const [data, setData] = useState<Workspace>(EMPTY_WORKSPACE);
  const [professional, setProfessional] =
    useState<ProfessionalData>(EMPTY_PROFESSIONAL);
  const [capabilities, setCapabilities] =
    useState<Capabilities>(UNKNOWN_CAPABILITIES);
  const [returnContext, setReturnContext] = useState<ReturnContext | null>(null);
  const [view, setView] = useState<View>("home");
  const [param, setParam] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [activeOrganizationId, setActiveOrganizationId] = useState("");
  const [activeSiteId, setActiveSiteId] = useState("");
  const [platformAccess, setPlatformAccess] = useState<PlatformAccess | null>(null);
  // Counts identity changes (logout, login as someone else, demo switch) so that the client bundle
  // handed to the leaves is rebuilt for the new actor; the old bundle refuses to send anything.
  const [identityEpoch, setIdentityEpoch] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connection, setConnection] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [categoryId, setCategoryId] = useState<Category>("panel");
  const [pendingDraft, setPendingDraft] = useState<RequestValues | null>(null);
  // Service booking extras (FASTSPLIT-SERVICE-BOOKING-FLOW-001): kept with the draft across login
  // by the SAME identity chain only, consumed after POST 201, dropped on any identity reset.
  const [booking, setBooking] = useState<BookingDraft | null>(null);
  const bookingCarry = useRef<BookingDraft | null>(null);
  // Card-hold provider return, independent of the booking draft (see components/app/card-return.ts).
  const [cardReturn, setCardReturn] = useState<CardReturn | null>(null);
  const cardReturnRef = useRef<CardReturn | null>(null);
  cardReturnRef.current = cardReturn;
  // Card verify/cancel bypass run(ctx): their own single flight + identity/session generation check.
  const cardFlight = useRef(false);
  const bookingRef = useRef<BookingDraft | null>(null);
  /** Photos chosen on the signed-in request form: kept IN MEMORY only (File objects cannot be
   *  stored), uploaded after the booking is confirmed; lost on reload / bank return (announced). */
  const bookingPhotos = useRef<File[]>([]);
  /** Demo only: the same booking confirmation step, kept in memory (never in tab storage, never sent). */
  const [demoBooking, setDemoBooking] = useState<{ draft: RequestValues; booking: BookingDraft } | null>(null);
  bookingRef.current = booking;
  const cardContext = { generation: () => guard.generation(), userId: () => userId.current };
  // Pending card attempt lookup: once per identity (after login / opening the requests), no polling.
  const [pendingLookup, setPendingLookup] = useState<"idle" | "error">("idle");
  const pendingCheckedFor = useRef<string | null>(null);
  const [pendingInvitation, setPendingInvitation] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadQueue[]>([]);
  // Incremented on every identity change: forces role spaces to remount with fresh local state.
  const [sessionKey, setSessionKey] = useState(0);

  // Identity and request bookkeeping (refs: no re-render, read inside async callbacks).
  // `guard` tracks the identity generation; `runner` binds every mutation chain to it.
  const guard = useRef(createGuard()).current;
  const runnerRef = useRef<Runner | null>(null);
  if (!runnerRef.current)
    runnerRef.current = createRunner(guard, { setBusy, setError, setNotice });
  const runner = runnerRef.current;
  const seq = useRef(0);
  const userId = useRef<string | null>(null);
  const modeRef = useRef<Mode>("public");
  const roleRef = useRef<Role>("client");
  // Signed-in deep link opened by a signed-out visitor (#detail/<id> at load or by hash change),
  // kept across the login form and consumed once by the login chain (WEB-DEEPLINK-LOGIN-001).
  const pendingLink = useRef<DeepLink | null>(null);
  const hashSeen = useRef(false);
  const activeOrgRef = useRef("");
  const activeSiteRef = useRef("");
  modeRef.current = mode;
  roleRef.current = role;
  activeOrgRef.current = activeOrganizationId;
  activeSiteRef.current = activeSiteId;
  const [refreshedAt, setRefreshedAt] = useState(0);

  const clearSessionState = useCallback(() => {
    seq.current += 1; // any in-flight workspace response is now stale
    guard.bump();
    setIdentityEpoch((e) => e + 1); // any in-flight mutation chain is now foreign
    runner.reset();
    userId.current = null;
    setData(EMPTY_WORKSPACE);
    setProfessional(EMPTY_PROFESSIONAL);
    setCapabilities(UNKNOWN_CAPABILITIES);
    setPlatformAccess(null);
    setUnreadNotifications(null);
    setReturnContext(null);
    setSelectedId("");
    setSelectedQuoteId("");
    setActiveOrganizationId("");
    setActiveSiteId("");
    setConnection("");
    setError("");
    setNotice("");
    setPendingDraft(null);
    setBooking(null);
    setCardReturn(null);
    setPendingLookup("idle");
    pendingCheckedFor.current = null;
    setUploads([]);
    clearBooking(getDraftStorage());
    try {
      sessionStorage.removeItem(DRAFT_KEY);
      // Pending private content of the outgoing user (unsent assistance request, identity-fenced
      // leaf commands with emails/notes/addresses, request payloads) never survives a logout or an
      // identity change; a same-user reload keeps it (no reset happens then).
      purgePrivateStorage(sessionStorage);
    } catch {}
    setSessionKey((k) => k + 1);
  }, []);

  const navigate = useCallback((next: View, nextParam?: string) => {
    setView(next);
    setParam(nextParam || "");
    setError("");
    setNotice("");
    if (typeof window !== "undefined") {
      const hash = buildHash(next, nextParam);
      if (window.location.hash.slice(1) !== hash)
        window.history.pushState(null, "", `#${hash}`);
      window.scrollTo({ top: 0 });
    }
  }, []);

  // Apply a workspace response only if it belongs to the request and user still current.
  // One workspace read, applied in place; the outcome is explicit so a caller can tell « loaded
  // and still absent » from « failed » (WEB-DEEPLINK-REFRESH-001). Only the refresh coordinator
  // calls it, so two reads are never in flight at once.
  const readWorkspace = useCallback(
    (): Promise<ReadResult> =>
      createWorkspaceReader({
        api: (path) => api<unknown>(path),
        nextSeq: () => ++seq.current,
        currentSeq: () => seq.current,
        expectedUser: () => userId.current,
        apply: (ws) => {
          const profileOfWs = ws.profile!; // validated by createWorkspaceReader
          userId.current = profileOfWs.id;
          setData({ ...EMPTY_WORKSPACE, ...ws });
          setRole(profileOfWs.role);
          setMode("live");
          setRefreshedAt(Date.now());
          // An organisation or site that vanished from the authorised workspace is no longer a
          // valid context: drop it (and the professional data loaded for it) immediately.
          const kept = validateContext(
            ws.organizations ?? [],
            ws.sites ?? [],
            activeOrgRef.current,
            activeSiteRef.current,
          );
          if (kept.organizationDropped) {
            setActiveOrganizationId("");
            setActiveSiteId("");
            setProfessional(EMPTY_PROFESSIONAL);
            setNotice("L’organisation active n’est plus accessible depuis votre compte. Le périmètre a été réinitialisé.");
          } else if (kept.siteId !== activeSiteRef.current) setActiveSiteId("");
        },
        signOut: (message) => {
          clearSessionState();
          setMode("public");
          if (message) setError(message);
        },
        setError,
      })(),
    [clearSessionState],
  );
  const readWorkspaceRef = useRef(readWorkspace);
  readWorkspaceRef.current = readWorkspace;
  // Single flight with causal freshness for every refresh cause (contract A3/A4).
  const coordinator = useRef<RefreshCoordinator | null>(null);
  if (!coordinator.current)
    coordinator.current = createRefreshCoordinator({
      read: () => readWorkspaceRef.current(),
      contextKey: () => refreshContextKey(guard.generation(), roleRef.current, activeOrgRef.current, activeSiteRef.current),
    });
  /** Every cause (post-write, « Actualiser », realtime event, focus, deep link) takes a barrier. */
  const ensureFresh = useCallback((options?: { barrier?: boolean }) => (coordinator.current as RefreshCoordinator).request(options), []);
  const refresh = useCallback(async () => {
    await ensureFresh();
  }, [ensureFresh]);

  const loadProfessional = useCallback(async () => {
    if (modeRef.current !== "live" || roleRef.current !== "manager") return;
    const my = seq.current;
    try {
      const result = await api<ProfessionalData>("/api/professional");
      if (my !== seq.current) return;
      setProfessional({ ...EMPTY_PROFESSIONAL, ...result });
      setCapabilities((c) => ({ ...c, professional: "available" }));
    } catch (e) {
      if (my !== seq.current) return;
      if (e instanceof ApiRequestError && e.status === 403) {
        setProfessional(EMPTY_PROFESSIONAL);
        setActiveOrganizationId("");
        setActiveSiteId("");
        setError("Vos droits sur cet espace ont changé. Le périmètre a été réinitialisé ; rechargez vos données.");
        return;
      }
      setCapabilities((c) => ({ ...c, professional: contractStateFromError(e) }));
      setError((e as Error).message);
    }
  }, []);

  // Revalidation when the tab becomes visible or focused again (live only). Signals are never
  // dropped: a run in progress gets one trailing run, a recent run delays the next to the end
  // of the quiet window (CL-UI-008). Workspace, then professional data for managers.
  const revalidateNow = useCallback(async () => {
    if (modeRef.current !== "live") return;
    await refresh();
    if (roleRef.current === "manager") await loadProfessional();
  }, [refresh, loadProfessional]);
  useEffect(() => {
    if (mode !== "live") return;
    const scheduler = createRevalidationScheduler(revalidateNow, { minIntervalMs: 15000 });
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduler.signal();
    };
    const onFocus = () => scheduler.signal();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      scheduler.cancel();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [mode, revalidateNow]);

  // Boot: draft, return parameters, existing session, auth listener.
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    // Canonical bounded format shared with /offline-request.html (strict category, 30 min TTL).
    const bootDraft = readBootDraft(getDraftStorage());
    if (bootDraft) setPendingDraft(bootDraft);
    if (bootDraft) {
      let rawBooking: string | null = null;
      try {
        rawBooking = getDraftStorage()?.getItem(BOOKING_DRAFT_KEY) ?? null;
      } catch {}
      const stored = readBooking(rawBooking);
      if (stored) setBooking(stored.booking);
    }
    try {
      const token = sessionStorage.getItem(INVITE_KEY);
      if (token && INVITE_TOKEN.test(token)) setPendingInvitation(token);
    } catch {}
    const back = parseReturnParams(window.location.search);
    if (back) {
      const url = new URL(window.location.href);
      url.search = "";
      window.history.replaceState(null, "", url.toString());
    }
    async function init() {
      try {
        const client = createClient();
        const { data: auth } = await client.auth.getUser();
        if (!active) return;
        if (auth.user) {
          userId.current = auth.user.id;
          await refresh();
          pendingLink.current = null; // already signed in: the hash routing handles the link
        }
        const sub = client.auth.onAuthStateChange((event, session) => {
          if (!active) return;
          const nextId = session?.user?.id ?? null;
          if (event === "SIGNED_OUT" || (!nextId && modeRef.current === "live")) {
            pendingLink.current = null;
            clearSessionState();
            setMode("public");
            setView("home");
            return;
          }
          if (nextId && nextId !== userId.current) {
            // Another account (same browser, other tab or renewed session): start clean.
            clearSessionState();
            userId.current = nextId;
            void refresh();
          }
        });
        unsubscribe = () => sub.data.subscription.unsubscribe();
      } catch {
        /* Public access stays available without a configured backend. */
      } finally {
        if (active) {
          setLoading(false);
          setBooting(false);
          if (back) setReturnContext(back);
        }
      }
    }
    void init();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [refresh, clearSessionState]);

  useEffect(() => {
    if (mode !== "live" || booting || role !== "client" || !userId.current) return;
    if (!["overview", "requests", "new", "detail"].includes(view)) return;
    if (pendingCheckedFor.current === userId.current) return;
    void checkPendingCardHold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, booting, role, view, data.profile?.id]);

  // Return parameters are hints: re-read server state, never mark anything as paid.
  useEffect(() => {
    if (!returnContext || booting) return;
    if (returnContext.kind === "booking") {
      // Wait for an identified session: the hint is kept until then (never a status from the URL).
      if (mode !== "live" || !userId.current) {
        setNotice("Connectez-vous avec le même compte pour vérifier votre réservation. Aucun statut n’est déduit du lien.");
        setAuthMode("login");
        navigate("auth");
        return;
      }
      const back = returnContext;
      setReturnContext(null);
      const state: CardReturn = {
        requestId: back.requestId,
        userId: userId.current,
        phase: back.state === "success" ? "checking" : "needs_action",
        message: back.state === "success" ? CARD_RETURN_COPY.checking : CARD_RETURN_COPY.interrupted,
      };
      setCardReturn(state);
      if (back.state === "success") void verifyCardHoldReturn(back.requestId);
      return;
    }
    if (returnContext.kind === "auth") {
      if (returnContext.state === "confirmed") {
        // Same-tab return from the signup email with a request prepared before: open its
        // confirmation (never an automatic POST), as the login chain does.
        const resume = mode === "live" && pendingDraft !== null;
        setNotice(
          resume
            ? "Votre adresse est confirmée. Vérifiez votre demande puis confirmez son envoi."
            : mode === "live"
              ? "Votre adresse est confirmée. Votre espace est chargé."
              : "Votre adresse est confirmée. Connectez-vous pour ouvrir votre espace.",
        );
        if (resume) navigate("new");
        if (mode === "public") {
          setAuthMode("login");
          navigate("auth");
        }
      } else {
        setError(
          "Ce lien de confirmation est expiré ou déjà utilisé. Demandez un nouveau lien depuis la connexion.",
        );
        if (mode === "public") navigate("auth");
      }
      setReturnContext(null);
      return;
    }
    if (mode !== "live") {
      setError(
        "Connectez-vous pour relire l’état de votre retour Stripe. Aucun statut n’est déduit du lien.",
      );
      setAuthMode("login");
      navigate("auth");
      setReturnContext(null);
      return;
    }
    if (returnContext.kind === "payment") {
      const back = returnContext;
      const job = data.interventions.find((i) => i.id === back.interventionId);
      const quote = job ? pickQuote(data.quotes, job.id) : undefined;
      if (job) {
        setSelectedId(job.id);
        setSelectedQuoteId(quote?.id || "");
        navigate("detail", job.id);
      }
      // The redirect only says "the customer came back". Ask the server what really happened,
      // whatever the URL claims (a cancel URL can be forged or outrun a confirmation).
      const g = guard.generation();
      void (async () => {
        let status: PaymentServerStatus = "unknown";
        if (quote) {
          const report = await loadPaymentStatus(quote.id);
          if (!guard.alive(g)) return;
          const raw =
            report?.payment?.status ??
            (report ? "none" : data.payments.find((p) => p.quote_id === quote.id)?.status);
          status =
            raw === "paid" || raw === "pending" || raw === "failed" || raw === "expired"
              ? raw
              : raw === "none"
                ? "none"
                : job?.status === "paid"
                  ? "paid"
                  : "unknown";
        } else if (job?.status === "paid") status = "paid";
        const message = paymentReturnMessage(back.state, status);
        if (message.tone === "error") setError(message.text);
        else setNotice(message.text);
      })();
    } else if (returnContext.kind === "connect") {
      navigate("profile");
      setNotice(CONNECT_RETURN_MESSAGE[returnContext.state]);
    }
    setReturnContext(null);
  }, [returnContext, booting, mode, data, navigate, pendingDraft]);

  // A kept invitation code is accepted once a live session exists (verified recipient server-side).
  const inviteAttempt = useRef("");
  useEffect(() => {
    if (mode !== "live" || !pendingInvitation || inviteAttempt.current === pendingInvitation) return;
    inviteAttempt.current = pendingInvitation;
    void acceptInvitation(pendingInvitation).then((ok) => {
      if (!ok) {
        setPendingInvitation(null);
        try {
          sessionStorage.removeItem(INVITE_KEY);
        } catch {}
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pendingInvitation]);

  // Hash routing with role guard. Unknown or forbidden targets never mount their view.
  useEffect(() => {
    const onHash = (event?: Event) => {
      const parsed = parseHash(window.location.hash);
      // Only a link the visitor opened (first load or a real hash change) is remembered — not the
      // stale hash a logout leaves behind when this effect re-runs on the mode change.
      if (mode === "public" && (event || !hashSeen.current)) {
        const link = protectedLink(window.location.hash);
        if (link) pendingLink.current = link;
      }
      hashSeen.current = true;
      const target = parsed.view ?? homeFor(mode === "public" ? null : role, mode);
      setParam(parsed.param);
      setView(canAccess(target, mode === "public" ? null : role, mode) ? target : "forbidden");
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, [mode, role]);

  // Demo persistence is scoped to demo mode only.
  useEffect(() => {
    if (mode === "demo" && !writeDemo(DEMO_KEYS.workspace, data))
      setNotice("Le navigateur ne conserve pas cette démonstration. Gardez cette page ouverte.");
  }, [data, mode]);
  useEffect(() => {
    if (mode === "demo") writeDemo(DEMO_KEYS.professional, professional);
  }, [professional, mode]);
  useEffect(() => {
    if (mode === "live" && role === "manager") void loadProfessional();
  }, [mode, role, loadProfessional]);

  // Realtime: refresh on authorised table changes, debounced.
  const profileIdForRealtime = mode === "live" ? data.profile?.id : undefined;
  useEffect(() => {
    if (!profileIdForRealtime) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    let client: ReturnType<typeof createClient>;
    try {
      client = createClient();
    } catch {
      return;
    }
    let channel = client.channel(`workspace-${profileIdForRealtime}`, REALTIME_CHANNEL_CONFIG);
    channel = channel.on("system", {}, (payload: { status?: string }) => {
      if (active) setConnection((c) => nextConnection(c, { kind: "system", status: payload?.status }));
    });
    for (const table of REALTIME_TABLES)
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (active) void refresh();
          }, 350);
        },
      );
    channel.subscribe((status) => {
      if (active) setConnection((c) => nextConnection(c, { kind: "status", status }));
    });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [profileIdForRealtime, refresh]);

  const run = useCallback(
    (task: (ctx: RunContext) => Promise<void>) => runner.run(task),
    [runner],
  );

  function startDemo(nextRole: Role = "client", next?: View, nextParam?: string) {
    if (modeRef.current === "live") return; // never mix a live account with demo data
    const valid = (v: unknown) => {
      const d = v as Workspace;
      return (
        !!d &&
        Array.isArray(d.interventions) &&
        Array.isArray(d.quotes) &&
        Array.isArray(d.sites) &&
        Array.isArray(d.messages)
      );
    };
    setData({ ...EMPTY_WORKSPACE, ...readDemo(DEMO_KEYS.workspace, seed(), valid) });
    setProfessional({ ...EMPTY_PROFESSIONAL, ...readDemo(DEMO_KEYS.professional, proSeed()) });
    setCapabilities({
      operations: "available",
      artisan: "available",
      adminOverview: "available",
      professional: "available",
      organizations: "available",
      performance: "available",
      payments: "available",
      siteAccess: "available",
      adminLists: "available",
      quoteDraft: "available",
      adminDirectory: "available",
      support: "available",
      quoteDocuments: "available",
      planning: "available",
      notifications: "available",
      siteOperations: "available",
      platformOperations: "available",
      tracking: "available",
    });
    guard.bump();
    setIdentityEpoch((e) => e + 1);
    runner.reset();
    setMode("demo");
    setRole(nextRole);
    setLoading(false);
    setSessionKey((k) => k + 1);
    if (nextParam) setSelectedId(nextParam);
    navigate(next || homeFor(nextRole, "demo"), nextParam);
  }
  async function logout() {
    if (modeRef.current === "live") {
      try {
        const result = await createClient().auth.signOut();
        if (result.error) throw result.error;
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    clearSessionState();
    setMode("public");
    navigate("home");
  }

  // ---- Mutations --------------------------------------------------------------------------
  const demoOps = () =>
    readDemo<DemoOperations>(DEMO_KEYS.operations, {}, (v) => !!v && typeof v === "object");
  const saveDemoOps = (ops: DemoOperations) => writeDemo(DEMO_KEYS.operations, ops);

  // Demo transition of a dossier, run INSIDE the caller's chain (never opens a second run: the
  // global busy guard would refuse it). Throws a user-facing Error when the action is refused.
  function demoTransition(
    ctx: RunContext,
    id: string,
    name: InterventionAction | "simulate_payment",
    extra?: Record<string, unknown>,
  ) {
    const i = data.interventions.find((x) => x.id === id);
    if (!i) throw new Error("Demande introuvable.");
    if (name === "accept_mission") {
      const artisan = readDemo(DEMO_KEYS.admin, adminSeed(), Array.isArray).find(
        (p) => p.id === DEMO_IDS.artisan,
      );
      if (artisan && !artisan.artisan_approved)
        throw new Error(
          "L’accès aux nouvelles missions de cet artisan de démonstration est suspendu. Réactivez sa candidature dans l’administration de démonstration.",
        );
    }
    const transitions: Record<string, Status> = {
      accept_mission: "assigned",
      send_quote: "quoted",
      accept_quote: "accepted",
      start: "in_progress",
      complete: "completed",
      cancel: "cancelled",
      simulate_payment: "paid",
    };
    const allowed: Record<string, Status[]> = {
      accept_mission: ["requested"],
      send_quote: ["assigned", "quoted"],
      accept_quote: ["quoted"],
      start: ["accepted"],
      complete: ["in_progress"],
      cancel: ["requested", "assigned", "quoted"],
      simulate_payment: ["completed"],
    };
    const status = transitions[name];
    if (!status) throw new Error("Action inconnue.");
    if (!allowed[name]?.includes(i.status))
      throw new Error("Cette action n’est plus disponible pour cette demande.");
    let qs = data.quotes;
    let pro = professional;
    if (name === "accept_quote") {
      const shown = qs.find((q) => q.id === extra?.quote_id);
      if (!shown || shown.intervention_id !== id || shown.status !== "sent")
        throw new Error(
          "Le devis affiché n’est plus la version active. Rechargez le dossier avant d’accepter.",
        );
      if (pro.approvals.some((a) => a.quote_id === shown.id && a.status !== "approved"))
        throw new Error(
          "Ce devis nécessite une approbation dans l’espace entreprise avant son acceptation.",
        );
      qs = qs.map((q) =>
        q.id === shown.id
          ? { ...q, status: "accepted", accepted_at: new Date().toISOString() }
          : q,
      );
    }
    if (name === "send_quote") {
      const lines = extra?.lines as Line[];
      // Explicit supported rate only: no coercion (Number(null) would be 0), no default.
      const rate = extra?.tax_rate;
      if (!isTaxRate(rate)) throw new Error("Choisissez le taux de TVA applicable avant d’envoyer le devis.");
      const subtotal = lines.reduce(
        (n, l) => n + Math.round(l.quantity * l.unit_price_cents),
        0,
      );
      // A revision replaces the previously sent (not accepted) version, as the server does.
      qs = qs.map((q) =>
        q.intervention_id === id && q.status === "sent" ? { ...q, status: "rejected" } : q,
      );
      const quote: Quote = {
        id: typeof extra?.quote_id === "string" ? extra.quote_id : uid(),
        intervention_id: id,
        artisan_id: DEMO_IDS.artisan,
        lines,
        subtotal_cents: subtotal,
        tax_cents: Math.round((subtotal * rate) / 100),
        total_cents: subtotal + Math.round((subtotal * rate) / 100),
        tax_rate: rate,
        status: "sent",
        created_at: new Date().toISOString(),
      };
      qs = [...qs, quote];
      const rule = i.site_id
        ? pro.approval_rules.find((r) => r.site_id === i.site_id && r.enabled)
        : undefined;
      if (rule && quote.total_cents > rule.threshold_cents)
        pro = {
          ...pro,
          approvals: [
            ...pro.approvals,
            {
              id: uid(),
              site_id: i.site_id!,
              quote_id: quote.id,
              status: "pending",
              created_at: new Date().toISOString(),
            },
          ],
        };
    }
    let payments = data.payments;
    if (name === "simulate_payment") {
      const accepted = qs.find((q) => q.intervention_id === id && q.status === "accepted");
      if (accepted)
        payments = [
          ...payments.filter((p) => p.quote_id !== accepted.id),
          {
            id: uid(),
            quote_id: accepted.id,
            total_cents: accepted.total_cents,
            currency: "eur",
            status: "paid",
            created_at: new Date().toISOString(),
            paid_at: new Date().toISOString(),
          },
        ];
    }
    ctx.when(setProfessional)(pro);
    ctx.when(setData)({
      ...data,
      quotes: qs,
      payments,
      interventions: data.interventions.map((x) =>
        x.id === id
          ? {
              ...x,
              status,
              artisan_id: name === "accept_mission" ? DEMO_IDS.artisan : x.artisan_id,
              completed_at: name === "complete" ? new Date().toISOString() : x.completed_at,
              paid_at: name === "simulate_payment" ? new Date().toISOString() : x.paid_at,
            }
          : x,
      ),
    });
    ctx.notice(
      name === "simulate_payment"
        ? "Paiement simulé dans la démonstration. Aucun débit bancaire n’a été effectué."
        : "Modification enregistrée dans la démonstration.",
    );
  }

  async function action(
    id: string,
    name: InterventionAction | "simulate_payment",
    extra?: Record<string, unknown>,
  ) {
    return run(async (ctx) => {
      if (modeRef.current === "demo") {
        demoTransition(ctx, id, name, extra);
        return;
      }
      if (name === "simulate_payment")
        throw new Error("La simulation de paiement n’existe qu’en démonstration.");
      if (name === "accept_quote" && !extra?.quote_id)
        throw new Error("Le devis affiché est introuvable. Rechargez le dossier.");
      await api(`/api/interventions/${id}/actions`, { action: name, ...extra });
      if (ctx.alive()) await refresh();
      ctx.notice("Modification enregistrée.");
    });
  }

  async function operate(id: string, body: OperationBody) {
    return run(async (ctx) => {
      if (modeRef.current === "demo") {
        const ops = demoOps();
        const entry = { ...(ops[id] || {}) };
        const i = data.interventions.find((x) => x.id === id);
        if (!i) throw new Error("Dossier introuvable.");
        let next = data;
        if (body.action === "decline_offer") {
          if (i.status !== "requested") throw new Error("Cette offre n’est plus ouverte.");
          entry.declined = true;
        } else if (body.action === "reject_quote") {
          const q = data.quotes.find((x) => x.id === body.quote_id);
          if (!q || q.intervention_id !== id || q.status !== "sent")
            throw new Error("Ce devis n’est plus la version active ; rechargez le dossier.");
          next = {
            ...data,
            quotes: data.quotes.map((x) => (x.id === q.id ? { ...x, status: "rejected" } : x)),
            interventions: data.interventions.map((x) =>
              x.id === id ? { ...x, status: "assigned" } : x,
            ),
            messages: [
              ...data.messages,
              {
                id: uid(),
                intervention_id: id,
                author_id: `demo-${roleRef.current}`,
                body: `Devis refusé : ${body.reason}`,
                created_at: new Date().toISOString(),
              },
            ],
          };
        } else if (body.action === "save_appointment") {
          if (!["assigned", "quoted", "accepted"].includes(i.status))
            throw new Error("Un rendez-vous ne peut être fixé qu’avant le début des travaux.");
          if (Date.parse(body.ends_at) <= Date.parse(body.starts_at))
            throw new Error("La fin du créneau doit suivre son début.");
          entry.appointment = {
            intervention_id: id,
            starts_at: body.starts_at,
            ends_at: body.ends_at,
            note: body.note,
            updated_by: `demo-${roleRef.current}`,
            updated_at: new Date().toISOString(),
          };
        } else if (body.action === "set_travel_stage") {
          if (!["accepted", "in_progress"].includes(i.status))
            throw new Error("L’étape de déplacement concerne une intervention acceptée ou en cours.");
          entry.travel_stage = body.stage;
          next = {
            ...data,
            interventions: data.interventions.map((x) =>
              x.id === id ? { ...x, travel_stage: body.stage } : x,
            ),
          };
        } else if (body.action === "save_report") {
          if (!["in_progress", "completed", "paid"].includes(i.status))
            throw new Error("Le compte rendu se rédige pendant ou après l’intervention.");
          entry.report = {
            intervention_id: id,
            artisan_id: DEMO_IDS.artisan,
            summary: body.summary,
            checks: body.checks,
            signature_name: body.signature_name,
            updated_at: new Date().toISOString(),
          };
        } else if (body.action === "reassign") {
          if (!["requested", "assigned", "quoted"].includes(i.status))
            throw new Error("La réaffectation n’est possible qu’avant l’acceptation du devis.");
          next = {
            ...data,
            quotes: data.quotes.map((x) =>
              x.intervention_id === id && x.status === "sent" ? { ...x, status: "rejected" } : x,
            ),
            interventions: data.interventions.map((x) =>
              x.id === id
                ? {
                    ...x,
                    artisan_id: body.artisan_id,
                    status: body.artisan_id ? "assigned" : "requested",
                    travel_stage: "planned",
                  }
                : x,
            ),
            messages: [
              ...data.messages,
              {
                id: uid(),
                intervention_id: id,
                author_id: DEMO_IDS.admin,
                body: `Réaffectation : ${body.reason}`,
                created_at: new Date().toISOString(),
              },
            ],
          };
          delete entry.appointment;
        }
        ops[id] = entry;
        saveDemoOps(ops);
        ctx.when(setData)(next);
        ctx.notice("Modification enregistrée dans la démonstration.");
        return;
      }
      try {
        await api(`/api/interventions/${id}/operations`, body);
        ctx.when(setCapabilities)((c) => ({ ...c, operations: "available" }));
      } catch (e) {
        const state = contractStateFromError(e);
        if (state === "missing") ctx.when(setCapabilities)((c) => ({ ...c, operations: "missing" }));
        throw e;
      }
      if (ctx.alive()) await refresh();
      ctx.notice("Modification enregistrée.");
    });
  }

  async function loadOperations(id: string): Promise<Operations | null> {
    if (modeRef.current === "demo") {
      const i = data.interventions.find((x) => x.id === id);
      const entry = demoOps()[id] || {};
      return {
        participants: i ? demoParticipants(i) : [],
        appointment: entry.appointment || null,
        report: entry.report || null,
        history: [],
        history_limit: 100,
        travel_stage: entry.travel_stage || i?.travel_stage || "planned",
      };
    }
    const my = seq.current;
    try {
      const result = await api<Operations>(`/api/interventions/${id}/operations`);
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, operations: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      if (e instanceof ApiRequestError && (e.status === 403 || e.status === 404)) {
        // The dossier is no longer readable (access withdrawn or removed): never keep it open.
        setSelectedId("");
        setSelectedQuoteId("");
        setCapabilities((c) => ({ ...c, operations: "available" }));
        void refresh();
        setError("Ce dossier n’est plus accessible depuis votre compte. Vos données ont été rechargées.");
        navigate(homeFor(roleRef.current, "live"));
        return null;
      }
      setCapabilities((c) => ({ ...c, operations: contractStateFromError(e) }));
      return null;
    }
  }

  async function loadArtisanDossier(userId?: string): Promise<ArtisanDossier | null> {
    if (modeRef.current === "demo") {
      if (userId && userId !== DEMO_IDS.artisan)
        return { artisan_profile: null, credentials: [] };
      return readDemo<ArtisanDossier>(
        DEMO_KEYS.artisan,
        artisanSeed(),
        (v) => !!v && typeof v === "object" && "credentials" in (v as object),
      );
    }
    const my = seq.current;
    try {
      const result = await api<ArtisanDossier>(
        userId ? `/api/artisan?user_id=${encodeURIComponent(userId)}` : "/api/artisan",
      );
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, artisan: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, artisan: contractStateFromError(e) }));
      return null;
    }
  }

  async function artisanCommand(body: ArtisanCommand) {
    return run(async (ctx) => {
      if (modeRef.current === "demo") {
        const dossier = readDemo<ArtisanDossier>(DEMO_KEYS.artisan, artisanSeed());
        const profile = dossier.artisan_profile || artisanSeed().artisan_profile!;
        let nextProfile = profile;
        let credentials = dossier.credentials;
        if (body.action === "save_profile") {
          // Mirrors the platform rule (CL-BE-001): no dossier edit while work is active or unpaid.
          const blocking = data.interventions.filter(
            (i) =>
              i.artisan_id === DEMO_IDS.artisan &&
              ["assigned", "quoted", "accepted", "in_progress", "completed"].includes(i.status),
          ).length;
          if (blocking)
            throw new Error(
              `Modification refusée : ${blocking} mission${blocking > 1 ? "s" : ""} en cours ou terminée${blocking > 1 ? "s" : ""} sans règlement. Terminez-les et attendez leur règlement, ou obtenez leur annulation ou réaffectation, avant de modifier le dossier. Rien n’a été modifié ; vos saisies restent dans le formulaire.`,
            );
          const { action: _a, ...fields } = body;
          nextProfile = {
            ...profile,
            ...fields,
            application_status: "draft",
            available: false,
            submitted_at: null,
            updated_at: new Date().toISOString(),
          };
        } else if (body.action === "submit_application") {
          if (
            !profile.company_name.trim() ||
            profile.siret.length !== 14 ||
            profile.address.trim().length < 5 ||
            !profile.postal_codes.length ||
            !profile.categories.length
          )
            throw new Error(
              "Complétez société, SIRET à 14 chiffres, adresse, zone et compétences avant de soumettre.",
            );
          nextProfile = {
            ...profile,
            application_status: "submitted",
            submitted_at: new Date().toISOString(),
          };
        } else if (body.action === "set_availability") {
          nextProfile = { ...profile, available: body.available };
        } else if (body.action === "link_credential") {
          credentials = [
            ...credentials.filter((c) => c.document_id !== body.document_id),
            {
              id: uid(),
              user_id: DEMO_IDS.artisan,
              document_id: body.document_id,
              kind: body.kind,
              expires_on: body.expires_on,
              created_at: new Date().toISOString(),
            },
          ];
        }
        writeDemo(DEMO_KEYS.artisan, { artisan_profile: nextProfile, credentials });
        ctx.when(setData)({ ...data, artisan_profile: nextProfile });
        ctx.notice("Dossier enregistré dans la démonstration. Aucune vérification réelle n’est effectuée.");
        return;
      }
      try {
        await api("/api/artisan", body);
        ctx.when(setCapabilities)((c) => ({ ...c, artisan: "available" }));
      } catch (e) {
        const state = contractStateFromError(e);
        if (state === "missing") ctx.when(setCapabilities)((c) => ({ ...c, artisan: "missing" }));
        if (body.action === "save_profile" && e instanceof ApiRequestError && e.status === 409)
          // Active-work guard: the dossier and the approval are untouched; the form keeps the input.
          throw new Error(
            `${e.message} Rien n’a été modifié et votre approbation est inchangée ; vos saisies restent dans le formulaire.`,
          );
        throw e;
      }
      if (ctx.alive()) await refresh();
      ctx.notice("Dossier enregistré. L’examen reste réalisé par l’opérateur.");
    });
  }

  async function loadAdminOverview(): Promise<AdminOverview | null> {
    if (modeRef.current === "demo")
      return adminOverviewFromDemo(data, readDemo(DEMO_KEYS.admin, adminSeed(), Array.isArray));
    const my = seq.current;
    try {
      const result = await api<AdminOverview>("/api/admin/overview");
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, adminOverview: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      if (e instanceof ApiRequestError && e.status === 403) {
        void refresh(); // the server role is authoritative; re-derive the space
        setError("Vos droits d’administration ne sont plus reconnus. Vos données ont été rechargées.");
        return null;
      }
      setCapabilities((c) => ({ ...c, adminOverview: contractStateFromError(e) }));
      return null;
    }
  }

  // Uploads the queue items one by one; each result is recorded, failures stay retryable.
  const processUploads = (ctx: RunContext, queue: UploadQueue, resendUncertain = false) =>
    processUploadQueue(
      queue,
      (file, interventionId) => uploadDocument(file, interventionId),
      () => ctx.alive(),
      ctx.when((q: UploadQueue) => setUploads((all) => upsertQueue(all, q))),
      { resendUncertain },
    );
  // Service booking (docs/GUEST_CHECKOUT_CONTRACT.md + ROOT POST /api/bookings): the booking
  // context NEVER posts the legacy /api/interventions (no silent fallback). One idempotent key,
  // proven stored before the POST; the draft and booking are consumed only on 201 « confirmed ».
  async function confirmBooking() {
    return run(async (ctx) => {
      const demo = modeRef.current === "demo";
      const draft = demo ? demoBooking?.draft ?? null : pendingDraft;
      const current = demo ? demoBooking?.booking ?? null : booking;
      if (!draft || !current) throw new Error("Aucune demande en attente de confirmation dans cet onglet.");
      if (!current.payment) throw new Error("Choisissez un mode de paiement avant d’envoyer votre demande ; rien n’a été envoyé.");
      if (demo) {
        // Demo: same step, local creation only (no POST, no bank, no stored key).
        const photos = bookingPhotos.current.length;
        bookingPhotos.current = [];
        demoCreate(ctx, draft, photos, ` Règlement choisi : ${PAYMENT_LABEL[current.payment]} (démonstration, rien n’est payé).`);
        ctx.when(setDemoBooking)(null);
        return;
      }
      const keyed = ensureRequestId(getDraftStorage(), current);
      if (!keyed)
        throw new Error(
          "Votre demande n’a pas été envoyée : ce navigateur n’a pas pu préparer son envoi en toute sécurité. Réessayez ; si cela persiste, rechargez la page.",
        );
      if (keyed.booking !== current) ctx.when(setBooking)(keyed.booking);
      const c = current.contact;
      const body = {
        request_id: keyed.request_id,
        service_slug: current.slug,
        category: draft.category,
        description: draft.description,
        address: draft.address,
        postal_code: draft.postal_code,
        city: draft.city,
        urgency: draft.urgency,
        contact: { first_name: c.first_name.trim(), last_name: c.last_name.trim(), email: c.email.trim(), phone: c.phone.trim() },
        payment_choice: current.payment,
      };
      let result: BookingReceipt | { status: "authorization_required"; url: string };
      try {
        result = await api<BookingReceipt | { status: "authorization_required"; url: string }>("/api/bookings", body);
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 409)
          throw new Error(
            "Cette demande a peut-être déjà été enregistrée avec un contenu différent. Vérifiez « Mes demandes » avant toute nouvelle demande.",
          );
        throw e; // draft, booking and key kept: the next attempt replays the SAME key
      }
      if (result?.status === "authorization_required") {
        // Card hold: the draft, booking and key stay in this tab; the provider page records an
        // authorisation (not a charge) and the return is verified by the server (finalize).
        const url = safeCheckoutUrl(result.url);
        if (!url) throw new ApiRequestError(502, "Le lien de paiement reçu n’est pas sûr ; rien n’a été débité. Réessayez ou choisissez le paiement après intervention sur la plateforme.");
        ctx.notice("Redirection vers la page sécurisée de votre banque… Aucun débit n’est effectué.");
        window.location.assign(url);
        return;
      }
      if (result?.status !== "confirmed" || !result.intervention?.id)
        throw new ApiRequestError(502, "Le service a répondu sans confirmation exploitable. Votre demande a pu être enregistrée : vérifiez « Mes demandes » avant de réessayer.");
      if (ctx.alive()) await refresh();
      ctx.when(setPendingDraft)(null);
      ctx.when(setBooking)(null);
      ctx.when(() => {
        clearBooking(getDraftStorage());
        try {
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {}
      })();
      ctx.when(setSelectedId)(result.intervention.id);
      ctx.when(navigate)("detail", result.intervention.id);
      const confirmedText =
        result.payment?.method === "on_site"
          ? "Demande confirmée. Paiement après l’intervention, sur la plateforme : rien n’est payé maintenant."
          : "Demande confirmée.";
      await uploadBookingPhotos(ctx, result.intervention.id, confirmedText);
    });
  }
  /** After a CONFIRMED creation only: the photos kept in memory are uploaded through the existing
   *  queue; if they were lost (reload, bank return), say so — never a silent or fake upload. */
  async function uploadBookingPhotos(ctx: RunContext, interventionId: string, confirmedText: string) {
    const files = bookingPhotos.current;
    const announced = readPhotoCount(getDraftStorage());
    bookingPhotos.current = [];
    writePhotoCount(getDraftStorage(), 0);
    if (!files.length) {
      ctx.notice(
        announced > 0
          ? `${confirmedText} ${announced} photo${announced > 1 ? "s" : ""} choisie${announced > 1 ? "s" : ""} avant le rechargement n’${announced > 1 ? "ont" : "a"} pas pu être conservée${announced > 1 ? "s" : ""} : ajoutez-${announced > 1 ? "les" : "la"} depuis le dossier.`
          : confirmedText,
      );
      return;
    }
    const queue: UploadQueue = {
      interventionId,
      startedAt: new Date().toISOString(),
      items: files.map((file, index) => ({ key: `${index}-${file.name}-${file.size}`, file, status: "pending" })),
    };
    ctx.when((q: UploadQueue) => setUploads((all) => upsertQueue(all, q)))(queue);
    const finished = await processUploads(ctx, queue);
    if (!ctx.alive()) return;
    await refresh();
    if (allUploaded(finished)) ctx.when(() => setUploads((all) => removeQueue(all, interventionId)))();
    ctx.notice(`${confirmedText} ${uploadSummary(finished)}`);
  }
  /** Signed-in client « Nouvelle demande » (ROOT decision): the request becomes a booking draft
   *  confirmed on BookingConfirm (payment choice) and sent by confirmBooking (POST /api/bookings).
   *  Nothing is sent here; storage must work or nothing is kept. */
  function startBooking(values: RequestValues, photos: File[] = []): boolean {
    if (roleRef.current !== "client") return false;
    if (modeRef.current === "demo") {
      bookingPhotos.current = photos;
      // Demo has no server profile: the demo cast name (never a made-up phone or last name).
      setDemoBooking({ draft: values, booking: bookingFromSignedRequest(values, data.profile ?? { full_name: DEMO_NAMES.client, phone: "" }) });
      return true;
    }
    if (modeRef.current !== "live") return false;
    const next = bookingFromSignedRequest(values, data.profile);
    const storage = getDraftStorage();
    if (!saveBooking(storage, next) || !savePublicDraft(storage, values).ok) {
      setError("Votre demande n’a pas été préparée : ce navigateur ne permet pas de la conserver en sécurité. Rien n’a été envoyé ; réessayez ou rechargez la page.");
      return false;
    }
    bookingPhotos.current = photos;
    writePhotoCount(storage, photos.length);
    setPendingDraft(values);
    setBooking(next);
    setError("");
    return true;
  }
  // Card hold verification (return, « Vérifier mon empreinte », retry): the URL proves nothing;
  // the server finalize decides. The dedicated return state is cleared ONLY on « confirmed ».
  async function verifyCardHoldReturn(requestId: string) {
    return cardAction(cardFlight, cardContext, async (still, me) => {
      setCardReturn((c) => (sameReturn(c, requestId, me) ? { ...c, phase: "checking", message: CARD_RETURN_COPY.checking } : c));
      const result = await verifyCardReturn((p, b) => api(p, b), requestId);
      if (!still()) return false; // identity/session changed meanwhile: never apply
      if (!result.ok) {
        setCardReturn((c) => (sameReturn(c, requestId, me) ? { ...c, phase: "needs_action", message: result.message } : c));
        return false;
      }
      setCardReturn((c) => (c?.requestId === requestId ? null : c));
      await refresh();
      if (!still()) return false; // re-checked AFTER the refresh: never clear another identity's draft
      if (bookingRef.current?.request_id === requestId) {
        setPendingDraft(null);
        setBooking(null);
        clearBooking(getDraftStorage());
        try {
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {}
      }
      setSelectedId(result.interventionId);
      navigate("detail", result.interventionId);
      setNotice("Demande confirmée. Empreinte bancaire enregistrée : aucun débit ; seul le montant du devis accepté pourra être prélevé.");
      return true;
    });
  }
  async function checkPendingCardHold() {
    const me = userId.current;
    if (!me || modeRef.current !== "live") return;
    pendingCheckedFor.current = me;
    setPendingLookup("idle");
    const r = await lookupPending((p) => api(p));
    if (userId.current !== me) return; // late reply for another identity
    if (!r.ok) {
      setPendingLookup("error");
      return;
    }
    if (r.pending && !cardReturnRef.current)
      setCardReturn({ requestId: r.pending.request_id, userId: me, phase: "needs_action", message: PENDING_COPY.found });
  }
  async function finalizeBooking(requestId: string) {
    if (!cardReturnRef.current || cardReturnRef.current.requestId !== requestId) {
      const me = userId.current;
      if (!me) return false;
      setCardReturn({ requestId, userId: me, phase: "checking", message: CARD_RETURN_COPY.checking });
    }
    return Boolean(await verifyCardHoldReturn(requestId));
  }
  // Server cancel of a card-hold attempt (from the return or from the confirmation). The key and
  // the return are dropped only after the server answers « cancelled »; the draft stays.
  async function cancelBooking(explicitId?: string) {
    const requestId = explicitId ?? cardReturnRef.current?.requestId ?? bookingRef.current?.request_id;
    if (!requestId) return false;
    return cardAction(cardFlight, cardContext, async (still, me) => {
      setCardReturn((c) => (sameReturn(c, requestId, me) ? { ...c, phase: "cancelling" } : c));
      const result = await cancelCardReturn((p, b) => api(p, b), requestId);
      if (!still()) return false;
      if (!result.ok) {
        setCardReturn((c) => (sameReturn(c, requestId, me) ? { ...c, phase: "needs_action", message: result.message } : c));
        if (!cardReturnRef.current) setError(result.message);
        return false;
      }
      setCardReturn((c) => (c?.requestId === requestId ? null : c));
      const current = bookingRef.current;
      if (current?.request_id === requestId) {
        const { request_id: _drop, ...rest } = current;
        void _drop;
        setBooking(rest);
        saveBooking(getDraftStorage(), rest);
      }
      setNotice("Réservation annulée par le service de paiement. Votre saisie est conservée.");
      return true;
    });
  }
  /** Demo creation (local, labelled; never a POST). */
  function demoCreate(ctx: RunContext, values: RequestValues, photoCount: number, extra: string) {
    const c = category(values.category);
    const intervention: Intervention = {
      ...values,
      id: uid(),
      status: "requested",
      client_id: roleRef.current === "manager" ? DEMO_IDS.manager : DEMO_IDS.client,
      created_at: new Date().toISOString(),
      estimate_min_cents: c.min,
      estimate_max_cents: c.max,
      travel_stage: "planned",
    };
    ctx.when(setData)({ ...data, interventions: [intervention, ...data.interventions] });
    ctx.when(setPendingDraft)(null);
    ctx.when(setBooking)(null);
    clearBooking(getDraftStorage());
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {}
    ctx.when(setSelectedId)(intervention.id);
    ctx.when(navigate)("detail", intervention.id);
    ctx.notice(
      (photoCount
        ? "Demande enregistrée dans la démonstration ; les photos ne sont pas envoyées en démonstration."
        : "Demande enregistrée dans la démonstration, sans envoi à un artisan réel.") + extra,
    );
  }
  async function createIntervention(values: RequestValues, photos: File[] = []) {
    return run(async (ctx) => {
      if (modeRef.current === "demo") {
        demoCreate(ctx, values, photos.length, "");
        return;
      }
      // 1. Create the dossier exactly once. A service booking carries its idempotency key: the
      //    server returns the SAME dossier for a replay of that key (lost reply, retry, reload).
      //    The canonical RequestValues / offline draft format is unchanged; only the API payload
      //    gains request_id. A legacy booking without a key gets one PROVEN stored first.
      // Key + frozen payload PROVEN stored before the POST (create_intervention_once). An
      // uncertain earlier attempt is replayed exactly (same key, original payload).
      const prepared = prepareRequestKey(getDraftStorage(), values);
      if (!prepared)
        throw new Error(
          "Votre demande n’a pas été envoyée : ce navigateur n’a pas pu préparer son envoi en toute sécurité. Réessayez ; si cela persiste, rechargez la page.",
        );
      const payload: RequestValues & { request_id: string } = { ...prepared.payload, request_id: prepared.request_id };
      let result: { intervention: Intervention };
      try {
        result = await api<{ intervention: Intervention }>("/api/interventions", payload);
      } catch (e) {
        if (e instanceof ApiRequestError && DEFINITIVE_REFUSAL.has(e.status)) settleRequestKey(getDraftStorage(), prepared.request_id);
        if (e instanceof ApiRequestError && e.status === 409)
          throw new Error(
            "Cette demande a peut-être déjà été enregistrée avec un contenu différent. Vérifiez « Mes demandes » avant toute nouvelle demande.",
          );
        throw e; // uncertain: key and frozen payload kept, the next attempt replays the SAME key
      }
      settleRequestKey(getDraftStorage(), prepared.request_id);
      const replayNote = prepared.replayed
        ? " Il s’agit de votre demande précédente, dont l’envoi n’avait pas été confirmé, enregistrée telle qu’envoyée : vos dernières modifications n’ont pas été transmises."
        : "";
      if (ctx.alive()) await refresh();
      ctx.when(setPendingDraft)(null);
      ctx.when(setBooking)(null);
      ctx.when(() => {
        clearBooking(getDraftStorage());
        try {
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {}
      })();
      const id = result.intervention?.id;
      if (id) {
        ctx.when(setSelectedId)(id);
        ctx.when(navigate)("detail", id);
      } else ctx.when(navigate)("requests");
      if (!id || !photos.length) {
        ctx.notice(`Votre demande a été enregistrée.${replayNote}`);
        return;
      }
      // 2. Then upload the photos; a failure never recreates the dossier.
      const queue: UploadQueue = {
        interventionId: id,
        startedAt: new Date().toISOString(),
        items: photos.map((file, index) => ({ key: `${index}-${file.name}-${file.size}`, file, status: "pending" })),
      };
      ctx.when((q: UploadQueue) => setUploads((all) => upsertQueue(all, q)))(queue);
      const finished = await processUploads(ctx, queue);
      if (!ctx.alive()) return;
      await refresh();
      if (allUploaded(finished)) ctx.when(() => setUploads((all) => removeQueue(all, id)))();
      ctx.notice(`Votre demande a été enregistrée.${replayNote} ${uploadSummary(finished)}`);
    });
  }
  async function retryUploads(interventionId: string, options: { resendUncertain?: boolean } = {}) {
    return run(async (ctx) => {
      if (modeRef.current !== "live") return;
      const queue = uploads.find((q) => q.interventionId === interventionId);
      if (!queue) return;
      // Uncertain items: the dossier's documents decide before anything is re-sent.
      await refresh();
      if (!ctx.alive()) return;
      let fresh: StoredDocument[] = [];
      try {
        const docs = await api<{ documents: StoredDocument[] }>("/api/documents");
        fresh = docs.documents ?? [];
      } catch {
        /* reconciliation falls back to the workspace documents already loaded */
        fresh = data.documents;
      }
      if (!ctx.alive()) return;
      const reconciled = reconcileUncertain(queue, fresh);
      ctx.when((q: UploadQueue) => setUploads((all) => upsertQueue(all, q)))(reconciled);
      const finished = await processUploads(ctx, reconciled, options.resendUncertain === true);
      if (!ctx.alive()) return;
      await refresh();
      if (allUploaded(finished)) {
        ctx.when(() => setUploads((all) => removeQueue(all, interventionId)))();
        ctx.notice("Toutes les photos sont enregistrées dans le dossier.");
      } else if (finished.items.some((i) => i.status === "uncertain") && !options.resendUncertain)
        ctx.notice(
          "Vérification effectuée : les documents du dossier portant le même nom sont proposés comme candidats. Ces photos restent incertaines tant que vous n’avez pas confirmé un candidat ou renvoyé le fichier.",
        );
      else ctx.error(uploadSummary(finished));
    });
  }
  async function sendMessage(interventionId: string, body: string) {
    return run(async (ctx) => {
      if (modeRef.current === "demo") {
        ctx.when(setData)({
          ...data,
          messages: [
            ...data.messages,
            {
              id: uid(),
              intervention_id: interventionId,
              body,
              author_id: `demo-${roleRef.current}`,
              created_at: new Date().toISOString(),
            },
          ],
        });
        ctx.notice("Message enregistré dans la démonstration.");
        return;
      }
      await api("/api/messages", { intervention_id: interventionId, body });
      if (ctx.alive()) await refresh();
      ctx.notice("Message envoyé.");
    });
  }
  async function submitReview(interventionId: string, values: { rating: number; body: string }) {
    return run(async (ctx) => {
      if (modeRef.current === "demo") {
        ctx.when(setData)({
          ...data,
          reviews: [
            ...data.reviews,
            {
              ...values,
              id: uid(),
              intervention_id: interventionId,
              author_id: `demo-${roleRef.current}`,
              created_at: new Date().toISOString(),
            },
          ],
        });
        ctx.notice("Avis enregistré dans la démonstration.");
        return;
      }
      await api("/api/reviews", { ...values, intervention_id: interventionId });
      if (ctx.alive()) await refresh();
      ctx.notice("Votre avis a été enregistré.");
    });
  }
  async function createSite(values: {
    name: string;
    type: string;
    address: string;
    budget_cents: number;
    organization_id?: string;
  }) {
    return run(async (ctx) => {
      if (modeRef.current === "demo") {
        ctx.when(setData)({
          ...data,
          sites: [
            ...data.sites,
            { ...values, id: uid(), organization_id: values.organization_id || "org-demo" },
          ],
        });
        ctx.notice("Site enregistré dans la démonstration.");
        return;
      }
      await api("/api/sites", values);
      if (ctx.alive()) await refresh();
      ctx.notice("Site enregistré.");
    });
  }
  async function updateProfile(values: { full_name: string; phone: string }) {
    return run(async (ctx) => {
      if (modeRef.current === "demo") {
        ctx.when(setData)({
          ...data,
          profile: {
            id: `demo-${roleRef.current}`,
            role: roleRef.current,
            full_name: values.full_name,
            phone: values.phone,
          },
        });
        ctx.notice("Profil de démonstration enregistré dans ce navigateur. Aucune donnée n’est transmise.");
        return;
      }
      await api("/api/profile", values, "PATCH");
      if (ctx.alive()) await refresh();
      ctx.notice("Profil mis à jour.");
    });
  }
  async function professionalCommand(values: Record<string, unknown>) {
    return run(async (ctx) => {
      if (modeRef.current === "demo") {
        const act = values.action;
        let next = professional;
        if (act === "set_approval_rule")
          next = {
            ...professional,
            approval_rules: [
              ...professional.approval_rules.filter((r) => r.site_id !== values.site_id),
              {
                id: uid(),
                site_id: String(values.site_id),
                threshold_cents: Number(values.threshold_cents),
                required_role: String(values.required_role),
                enabled: Boolean(values.enabled),
              },
            ],
          };
        if (act === "decide_approval")
          next = {
            ...professional,
            approvals: professional.approvals.map((a) =>
              a.id === values.approval_id
                ? {
                    ...a,
                    status: String(values.decision),
                    note: String(values.note || ""),
                    decided_by: DEMO_IDS.manager,
                    decided_at: new Date().toISOString(),
                  }
                : a,
            ),
          };
        if (act === "save_contract")
          next = {
            ...professional,
            contracts: [
              ...professional.contracts.filter((c) => c.id !== values.id),
              { ...(values as object), id: (values.id as string) || uid() } as never,
            ],
          };
        if (act === "save_compliance")
          next = {
            ...professional,
            compliance_records: [
              ...professional.compliance_records.filter((r) => r.id !== values.id),
              { ...(values as object), id: (values.id as string) || uid() } as never,
            ],
          };
        if (act === "set_site_budget")
          ctx.when(setData)({
            ...data,
            sites: data.sites.map((s) =>
              s.id === values.site_id ? { ...s, budget_cents: Number(values.budget_cents) } : s,
            ),
          });
        ctx.when(setProfessional)(next);
        ctx.notice("Modification enregistrée dans la démonstration.");
        return;
      }
      await api("/api/professional", values);
      if (ctx.alive()) await Promise.all([loadProfessional(), refresh()]);
      ctx.notice("Modification enregistrée.");
    });
  }
  async function checkout(quoteId: string) {
    await run(async (ctx) => {
      if (modeRef.current !== "live")
        throw new Error("Le règlement Stripe nécessite un compte réel. Utilisez la simulation de la démonstration.");
      const result = await api<{ url: string }>("/api/payments/checkout", { quote_id: quoteId });
      if (!result.url?.startsWith("https://checkout.stripe.com/"))
        throw new Error("La session de paiement n’est pas disponible.");
      if (ctx.alive()) window.location.assign(result.url);
    });
  }
  async function connectStripe() {
    await run(async (ctx) => {
      if (modeRef.current !== "live")
        throw new Error(
          "Le parcours Stripe Connect nécessite un compte artisan réel approuvé. Aucun compte bancaire n’est créé dans la démonstration.",
        );
      const result = await api<{ url: string }>("/api/payments/connect", {});
      if (!result.url?.startsWith("https://")) throw new Error("Le lien Stripe n’est pas disponible.");
      if (ctx.alive()) window.location.assign(result.url);
    });
  }

  async function loadAdminInterventions(
    params: AdminListFilters & { limit?: number; cursor?: string | null },
  ): Promise<AdminInterventionsPage | null> {
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));
    if (modeRef.current === "demo") {
      const rows = data.interventions
        .filter(
          (i) =>
            (!params.status || i.status === params.status) &&
            (!params.category || i.category === params.category) &&
            (!params.urgency || i.urgency === params.urgency) &&
            (!params.site_id || i.site_id === params.site_id) &&
            (!params.artisan_id || i.artisan_id === params.artisan_id) &&
            (!params.client_id || i.client_id === params.client_id) &&
            (!params.q ||
              `${i.description} ${i.city} ${i.postal_code}`.toLowerCase().includes(params.q.toLowerCase())),
        )
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
      const start = params.cursor ? Number(params.cursor) || 0 : 0;
      const slice = rows.slice(start, start + limit);
      return {
        interventions: slice.map((i) => ({
          id: i.id,
          client_id: i.client_id || "",
          artisan_id: i.artisan_id ?? null,
          site_id: i.site_id ?? null,
          category: i.category,
          city: i.city,
          postal_code: i.postal_code,
          urgency: i.urgency,
          status: i.status,
          created_at: i.created_at,
          updated_at: i.updated_at || i.created_at,
        })),
        page: {
          limit,
          has_more: start + limit < rows.length,
          next_cursor: start + limit < rows.length ? String(start + limit) : null,
          total: rows.length,
        },
        filters: params,
      };
    }
    const my = seq.current;
    try {
      const q = new URLSearchParams();
      q.set("limit", String(limit));
      if (params.cursor) q.set("cursor", params.cursor);
      for (const key of ["status", "category", "urgency", "site_id", "artisan_id", "client_id", "created_from", "created_to", "q"] as const) {
        const value = params[key];
        if (value) q.set(key, String(value));
      }
      const result = await api<AdminInterventionsPage>(`/api/admin/interventions?${q}`);
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, adminLists: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      if (e instanceof ApiRequestError && e.status === 422) {
        setError(e.message);
        return null;
      }
      if (e instanceof ApiRequestError && e.status === 403) {
        void refresh();
        setError("Vos droits d’administration ne sont plus reconnus. Vos données ont été rechargées.");
        return null;
      }
      setCapabilities((c) => ({ ...c, adminLists: contractStateFromError(e) }));
      return null;
    }
  }
  function demoDirectoryRows<K extends DirectoryKind>(kind: K): DirectoryItem<K>[] {
    const artisans = readDemo(DEMO_KEYS.admin, adminSeed(), Array.isArray);
    const dossier = readDemo(DEMO_KEYS.artisan, artisanSeed()).artisan_profile;
    if (kind === "artisans")
      return artisans.map((a) => ({
        id: a.id,
        full_name: a.full_name,
        phone: a.phone || "",
        artisan_approved: !!a.artisan_approved,
        created_at: a.created_at,
        company_name: a.id === DEMO_IDS.artisan ? dossier?.company_name ?? null : null,
        application_status: a.id === DEMO_IDS.artisan ? dossier?.application_status ?? null : a.artisan_approved ? "approved" : "submitted",
      })) as DirectoryItem<K>[];
    if (kind === "clients")
      return [
        { id: DEMO_IDS.client, full_name: DEMO_NAMES.client, phone: "", role: "client" as const, created_at: "2026-10-01T09:00:00Z" },
        { id: DEMO_IDS.manager, full_name: DEMO_NAMES.manager, phone: "", role: "manager" as const, created_at: "2026-10-02T09:00:00Z" },
      ] as DirectoryItem<K>[];
    return data.organizations.map((o) => ({
      id: o.id,
      name: o.name,
      owner_id: o.owner_id || DEMO_IDS.manager,
      created_at: "2026-10-02T09:00:00Z",
    })) as DirectoryItem<K>[];
  }
  async function loadAdminDirectory<K extends DirectoryKind>(
    kind: K,
    params: DirectoryFilters & { limit?: number; cursor?: string | null },
  ): Promise<DirectoryPage<K> | null> {
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));
    if (modeRef.current === "demo") {
      const q = params.q?.trim().toLowerCase();
      const rows = demoDirectoryRows(kind)
        .filter((row) => {
          const r = row as unknown as Record<string, unknown>;
          if (q && !String(r.full_name ?? r.name ?? "").toLowerCase().includes(q) && r.id !== q) return false;
          if (params.approved !== undefined && r.artisan_approved !== params.approved) return false;
          if (params.role && r.role !== params.role) return false;
          if (params.owner_id && r.owner_id !== params.owner_id) return false;
          return true;
        })
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
      const start = params.cursor ? Number(params.cursor) || 0 : 0;
      return {
        kind,
        items: rows.slice(start, start + limit),
        page: {
          limit,
          has_more: start + limit < rows.length,
          next_cursor: start + limit < rows.length ? String(start + limit) : null,
          total: rows.length,
        },
        filters: { q: params.q ?? null, approved: params.approved ?? null, role: params.role ?? null, owner_id: params.owner_id ?? null },
      };
    }
    const my = seq.current;
    try {
      const search = new URLSearchParams({ kind, limit: String(limit) });
      if (params.cursor) search.set("cursor", params.cursor);
      if (params.q) search.set("q", params.q);
      if (params.approved !== undefined) search.set("approved", String(params.approved));
      if (params.role) search.set("role", params.role);
      if (params.owner_id) search.set("owner_id", params.owner_id);
      const result = await api<DirectoryPage<K>>(`/api/admin/directory?${search}`);
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, adminDirectory: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      if (e instanceof ApiRequestError && e.status === 422) {
        setError(e.message);
        return null;
      }
      if (e instanceof ApiRequestError && e.status === 403) {
        void refresh();
        setError("Vos droits d’administration ne sont plus reconnus. Vos données ont été rechargées.");
        return null;
      }
      setCapabilities((c) => ({ ...c, adminDirectory: contractStateFromError(e) }));
      return null;
    }
  }
  async function loadAdminDirectoryItem<K extends DirectoryKind>(kind: K, id: string): Promise<DirectoryItem<K> | null> {
    if (modeRef.current === "demo") return demoDirectoryRows(kind).find((r) => r.id === id) ?? null;
    const my = seq.current;
    try {
      const result = await api<{ kind: K; item: DirectoryItem<K> }>(
        `/api/admin/directory?kind=${kind}&id=${encodeURIComponent(id)}`,
      );
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, adminDirectory: "available" }));
      return result.item;
    } catch (e) {
      if (my !== seq.current) return null;
      if (e instanceof ApiRequestError && e.status === 404) return null;
      setCapabilities((c) => ({ ...c, adminDirectory: contractStateFromError(e) }));
      return null;
    }
  }
  async function loadAdminIntervention(id: string): Promise<AdminInterventionDetail | null> {
    if (modeRef.current === "demo") {
      const intervention = data.interventions.find((i) => i.id === id);
      if (!intervention) return null;
      const quotes = data.quotes
        .filter((q) => q.intervention_id === id)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      return { intervention, quotes: quotes.slice(0, 50), quotes_limit: 50, quotes_limited: quotes.length > 50 };
    }
    const my = seq.current;
    try {
      const result = await api<AdminInterventionDetail>(
        `/api/admin/interventions?id=${encodeURIComponent(id)}`,
      );
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, adminLists: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      if (e instanceof ApiRequestError && e.status === 404) {
        setError("Ce dossier est introuvable.");
        return null;
      }
      setCapabilities((c) => ({ ...c, adminLists: contractStateFromError(e) }));
      return null;
    }
  }
  // ---- Quote draft (contract QUOTE-DRAFT-001). Demo: one private draft per dossier in the
  // browser; live: dedicated route, unavailable until the backend checkpoint is integrated.
  const demoDrafts = () =>
    readDemo<Record<string, { draft: QuoteDraft | null; version: number }>>(
      DEMO_KEYS.quoteDrafts,
      {},
      (v) => !!v && typeof v === "object",
    );
  function demoDraftEnvelope(interventionId: string): QuoteDraftEnvelope {
    const entry = demoDrafts()[interventionId] || { draft: null, version: 0 };
    const current = data.quotes.find(
      (q) => q.intervention_id === interventionId && q.status === "sent",
    );
    return {
      draft: entry.draft,
      version: entry.version,
      assignment_token: `demo-assignment-${interventionId}`,
      current_quote_id: current?.id ?? null,
    };
  }
  async function loadQuoteDraft(interventionId: string): Promise<QuoteDraftEnvelope | null> {
    if (modeRef.current === "demo") return demoDraftEnvelope(interventionId);
    const my = seq.current;
    try {
      const result = await api<QuoteDraftEnvelope>(`/api/interventions/${interventionId}/quote-draft`);
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, quoteDraft: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, quoteDraft: contractStateFromError(e) }));
      return null;
    }
  }
  async function quoteDraftCommand(
    interventionId: string,
    body: QuoteDraftCommand,
  ): Promise<QuoteDraftResult> {
    let outcome: QuoteDraftResult = { ok: false, conflict: false, message: "Action interrompue." };
    const completed = await run(async (ctx) => {
      if (modeRef.current === "demo") {
        const all = demoDrafts();
        const envelope = demoDraftEnvelope(interventionId);
        if (body.expected_version !== envelope.version || body.assignment_token !== envelope.assignment_token) {
          outcome = {
            ok: false,
            conflict: true,
            message: "Le brouillon a changé depuis votre dernière lecture. Rechargez-le ; votre saisie est conservée.",
          };
          return;
        }
        if (body.action === "save") {
          if (body.base_quote_id !== envelope.current_quote_id) {
            outcome = {
              ok: false,
              conflict: true,
              message: "Un devis a été publié entre-temps sur ce dossier. Rechargez avant d’enregistrer.",
            };
            return;
          }
          const draft: QuoteDraft = {
            intervention_id: interventionId,
            artisan_id: DEMO_IDS.artisan,
            version: envelope.version + 1,
            assignment_token: envelope.assignment_token,
            base_quote_id: body.base_quote_id,
            lines: body.lines,
            tax_rate: body.tax_rate,
            updated_at: new Date().toISOString(),
          };
          all[interventionId] = { draft, version: draft.version };
          writeDemo(DEMO_KEYS.quoteDrafts, all);
          outcome = { ok: true, envelope: { ...envelope, draft, version: draft.version } };
          ctx.notice("Brouillon enregistré dans la démonstration (non envoyé au client).");
          return;
        }
        if (!envelope.draft) {
          outcome = { ok: false, conflict: true, message: "Aucun brouillon actif à traiter. Rechargez le dossier." };
          return;
        }
        if (body.action === "discard") {
          all[interventionId] = { draft: null, version: envelope.version + 1 };
          writeDemo(DEMO_KEYS.quoteDrafts, all);
          outcome = { ok: true, envelope: { ...envelope, draft: null, version: envelope.version + 1 } };
          ctx.notice("Brouillon abandonné.");
          return;
        }
        // send: publish through the existing demo action; the draft is consumed only on success.
        const draft = envelope.draft;
        if (draft.tax_rate === null || !draft.lines.length || draft.lines.some((l) => !l.label.trim()))
          throw new Error("Le brouillon n’est pas publiable : lignes nommées et taux de TVA requis.");
        const newQuoteId = uid();
        // Same chain as this command (calling action() here re-entered run() and was refused as busy).
        try {
          demoTransition(ctx, interventionId, "send_quote", {
            lines: draft.lines,
            tax_rate: draft.tax_rate,
            quote_id: newQuoteId,
          });
        } catch (e) {
          outcome = {
            ok: false,
            conflict: false,
            message: `Le devis n’a pas pu être publié ; le brouillon est conservé. ${(e as Error).message}`.trim(),
          };
          return;
        }
        ctx.notice("Devis publié dans la démonstration (aucun envoi réel au client).");
        all[interventionId] = { draft: null, version: envelope.version + 1 };
        writeDemo(DEMO_KEYS.quoteDrafts, all);
        outcome = {
          ok: true,
          envelope: {
            ...envelope,
            draft: null,
            version: envelope.version + 1,
            quote_id: newQuoteId,
          },
        };
        return;
      }
      try {
        const result = await api<QuoteDraftEnvelope>(`/api/interventions/${interventionId}/quote-draft`, body);
        if (!ctx.alive()) return;
        ctx.when(setCapabilities)((c) => ({ ...c, quoteDraft: "available" }));
        outcome = { ok: true, envelope: result };
        if (body.action === "send") {
          if (ctx.alive()) await refresh();
          ctx.notice("Devis envoyé au client.");
        } else
          ctx.notice(
            body.action === "save"
              ? "Brouillon enregistré. Il n’est pas envoyé au client tant que vous ne publiez pas."
              : "Brouillon abandonné.",
          );
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 409) {
          outcome = { ok: false, conflict: true, message: e.message };
          return; // not an error banner: the editor shows the conflict and keeps the input
        }
        if (contractStateFromError(e) === "missing")
          ctx.when(setCapabilities)((c) => ({ ...c, quoteDraft: "missing" }));
        // Reported inline by the editor; no duplicate banner.
        outcome = { ok: false, conflict: false, message: (e as Error).message };
      }
    });
    // A chain that did not complete as the current identity reports neither success nor conflict.
    if (!completed) return { ok: false, conflict: false, message: "Action interrompue." };
    return outcome;
  }
  // ---- Assistance tickets (contract SUPPORT-001). Demo: browser-only tickets; live: dedicated
  // routes, honest unavailable state until the backend checkpoint is integrated.
  type DemoSupportStore = Record<string, { ticket: SupportTicket; messages: SupportMessage[]; events: SupportEvent[]; request_id?: string }>;
  const demoSupport = () =>
    readDemo<DemoSupportStore>(DEMO_KEYS.support, {}, (v) => !!v && typeof v === "object");
  const demoActor = () => `demo-${roleRef.current}`;
  async function loadSupportTickets(filters: SupportListFilters): Promise<SupportListPage | null> {
    const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
    if (modeRef.current === "demo") {
      const me = demoActor();
      const all = Object.values(demoSupport())
        .map((e) => e.ticket)
        .filter((t) => (roleRef.current === "admin" && filters.scope !== "mine") || t.creator_id === me)
        .filter((t) => !filters.status || t.status === filters.status)
        .filter((t) => !filters.intervention_id || t.intervention_id === filters.intervention_id)
        .filter((t) => !filters.q || t.subject.toLowerCase().includes(filters.q.toLowerCase()))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
      const start = filters.cursor ? Number(filters.cursor) || 0 : 0;
      return {
        tickets: all.slice(start, start + limit),
        page: { limit, total: all.length, has_more: start + limit < all.length, next_cursor: start + limit < all.length ? String(start + limit) : null },
        filters: { scope: filters.scope ?? (roleRef.current === "admin" ? "all" : "mine"), status: filters.status ?? null, intervention_id: filters.intervention_id ?? null, q: filters.q ?? null },
      };
    }
    const my = seq.current;
    try {
      const q = new URLSearchParams({ limit: String(limit) });
      if (filters.cursor) q.set("cursor", filters.cursor);
      if (filters.scope) q.set("scope", filters.scope);
      if (filters.status) q.set("status", filters.status);
      if (filters.intervention_id) q.set("intervention_id", filters.intervention_id);
      if (filters.q) q.set("q", filters.q);
      const result = await api<SupportListPage>(`/api/support?${q}`);
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, support: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      if (e instanceof ApiRequestError && e.status === 422) {
        setError(e.message);
        return null;
      }
      setCapabilities((c) => ({ ...c, support: contractStateFromError(e) }));
      return null;
    }
  }
  async function loadSupportTicket(id: string, page: { limit?: number; after_version?: number } = {}): Promise<SupportDetail | null> {
    const limit = Math.min(100, Math.max(1, page.limit ?? 50));
    const after = Math.max(0, page.after_version ?? 0);
    if (modeRef.current === "demo") {
      const entry = demoSupport()[id];
      if (!entry) return null;
      const me = demoActor();
      if (roleRef.current !== "admin" && entry.ticket.creator_id !== me) return null;
      const events = entry.events.filter((e) => e.version > after).sort((a, b) => a.version - b.version).slice(0, limit);
      const versions = new Set(events.map((e) => e.version));
      return {
        ticket: entry.ticket,
        messages: entry.messages.filter((m) => versions.has(m.version)),
        events,
        // Same rule as the server for an administrator (018): no reply on a resolved ticket.
        permissions: demoTicketPermissions(
          { can_reply_all: roleRef.current === "admin", can_set_status_all: roleRef.current === "admin" },
          me,
          entry.ticket,
        ),
        page: {
          limit,
          after_version: after,
          next_after_version: events.length === limit ? events[events.length - 1].version : null,
          has_more: entry.events.some((e) => e.version > (events[events.length - 1]?.version ?? after)),
          total_events: entry.events.length,
          total_messages: entry.messages.length,
        },
      };
    }
    const my = seq.current;
    try {
      const result = await api<SupportDetail>(
        `/api/support/${encodeURIComponent(id)}?limit=${limit}&after_version=${after}`,
      );
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, support: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      if (e instanceof ApiRequestError && (e.status === 404 || e.status === 403)) {
        setError("Cette demande d’assistance n’est pas accessible depuis votre compte.");
        return null;
      }
      setCapabilities((c) => ({ ...c, support: contractStateFromError(e) }));
      return null;
    }
  }
  async function createSupportTicket(values: { request_id: string; subject: string; body: string; intervention_id: string | null }): Promise<SupportCreateResult | null> {
    return runForResult<SupportCreateResult>(runner, async (ctx) => {
      if (modeRef.current === "demo") {
        const store = demoSupport();
        const existing = Object.values(store).find((e) => e.request_id === values.request_id);
        if (existing) return { ticket: existing.ticket, initial_message: existing.messages[0], replayed: true };
        const now = new Date().toISOString();
        const id = uid();
        const message: SupportMessage = { id: uid(), ticket_id: id, author_id: demoActor(), author_kind: "user", version: 1, body: values.body.trim(), created_at: now };
        const ticket: SupportTicket = { id, creator_id: demoActor(), intervention_id: values.intervention_id, subject: values.subject.trim(), status: "open", version: 1, created_at: now, updated_at: now, last_message_at: now };
        const event: SupportEvent = { id: uid(), ticket_id: id, actor_id: demoActor(), kind: "ticket_created", from_status: null, to_status: "open", version: 1, message_id: message.id, created_at: now };
        store[id] = { ticket, messages: [message], events: [event], request_id: values.request_id };
        writeDemo(DEMO_KEYS.support, store);
        ctx.notice("Demande d’assistance enregistrée dans la démonstration ; aucun opérateur réel n’est prévenu.");
        return { ticket, initial_message: message, replayed: false };
      }
      try {
        const result = await api<SupportCreateResult>("/api/support", values);
        if (!ctx.alive()) return undefined; // stale chain: runForResult yields null to the caller
        ctx.when(setCapabilities)((c) => ({ ...c, support: "available" }));
        ctx.notice(
          result.replayed
            ? "Votre demande avait déjà été enregistrée ; aucun doublon créé."
            : "Demande d’assistance enregistrée. Les réponses s’afficheront ici à l’actualisation.",
        );
        return result;
      } catch (e) {
        if (contractStateFromError(e) === "missing") ctx.when(setCapabilities)((c) => ({ ...c, support: "missing" }));
        throw e;
      }
    });
  }
  async function supportCommand(id: string, body: SupportCommand): Promise<SupportCommandResult> {
    let outcome: SupportCommandResult = { ok: false, conflict: false, message: "Action interrompue." };
    const completed = await run(async (ctx) => {
      if (modeRef.current === "demo") {
        const store = demoSupport();
        const entry = store[id];
        if (!entry) throw new Error("Demande d’assistance introuvable.");
        if (entry.ticket.version !== body.expected_version) {
          outcome = { ok: false, conflict: true, message: "La demande a évolué depuis votre lecture. Relisez-la ; votre texte est conservé." };
          return;
        }
        const isAdmin = roleRef.current === "admin";
        const now = new Date().toISOString();
        const version = entry.ticket.version + 1;
        let status = entry.ticket.status;
        let message: SupportMessage | null = null;
        if (body.action === "set_status") {
          if (!isAdmin) throw new Error("Seule l’administration peut changer l’état d’une demande.");
          const allowed: Record<string, string[]> = { open: ["in_progress", "awaiting_user", "resolved"], in_progress: ["awaiting_user", "resolved"], awaiting_user: ["in_progress", "resolved"], resolved: ["in_progress"] };
          if (!allowed[status]?.includes(body.status)) {
            outcome = { ok: false, conflict: true, message: "Ce changement d’état n’est pas possible depuis l’état actuel." };
            return;
          }
          status = body.status;
        } else {
          if (isAdmin && status === "resolved") {
            outcome = { ok: false, conflict: true, message: "Réouvrez la demande avant d’y répondre." };
            return;
          }
          if (!isAdmin && (status === "awaiting_user" || status === "resolved")) status = "open";
          message = { id: uid(), ticket_id: id, author_id: demoActor(), author_kind: isAdmin ? "admin" : "user", version, body: body.body.trim(), created_at: now };
        }
        const event: SupportEvent = { id: uid(), ticket_id: id, actor_id: demoActor(), kind: body.action === "reply" ? "replied" : "status_changed", from_status: entry.ticket.status, to_status: status, version, message_id: message?.id ?? null, created_at: now };
        entry.ticket = { ...entry.ticket, status, version, updated_at: now, last_message_at: message ? now : entry.ticket.last_message_at };
        if (message) entry.messages.push(message);
        entry.events.push(event);
        writeDemo(DEMO_KEYS.support, store);
        outcome = { ok: true, ticket: entry.ticket, message, event };
        ctx.notice("Enregistré dans la démonstration.");
        return;
      }
      try {
        const result = await api<{ ticket: SupportTicket; message: SupportMessage | null; event: SupportEvent }>(
          `/api/support/${encodeURIComponent(id)}`,
          body,
        );
        if (!ctx.alive()) return;
        ctx.when(setCapabilities)((c) => ({ ...c, support: "available" }));
        outcome = { ok: true, ...result };
        ctx.notice(body.action === "reply" ? "Réponse enregistrée." : "État de la demande mis à jour.");
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 409) {
          outcome = { ok: false, conflict: true, message: e.message };
          return;
        }
        if (contractStateFromError(e) === "missing") ctx.when(setCapabilities)((c) => ({ ...c, support: "missing" }));
        outcome = { ok: false, conflict: false, message: (e as Error).message };
      }
    });
    if (!completed) return { ok: false, conflict: false, message: "Action interrompue." };
    return outcome;
  }
  // Membership lost or never held: drop every cached view of the organisation.
  function dropOrganizationContext() {
    setActiveOrganizationId("");
    setActiveSiteId("");
    setProfessional(EMPTY_PROFESSIONAL);
    void refresh();
    setError("Vous ne faites plus partie de cette organisation. Les données ont été rechargées.");
  }
  async function loadOrganization(organizationId: string): Promise<OrganizationOverview | null> {
    if (modeRef.current === "demo") {
      const org = data.organizations.find((o) => o.id === organizationId);
      if (!org) return null;
      const members = data.organization_members.filter((m) => m.organization_id === organizationId);
      const me = members.find((m) => m.user_id === `demo-${roleRef.current}`);
      return {
        organization: org,
        current_role: (me?.role as "owner" | "manager" | "viewer" | undefined) ?? null,
        members: members.map((m) => ({
          user_id: m.user_id,
          role: m.role,
          full_name: m.user_id === DEMO_IDS.manager ? DEMO_NAMES.manager : "Membre (démo)",
        })),
        invitations: readDemo(DEMO_KEYS.invitations, [], Array.isArray),
        events: [],
        limits: {
          members: 200,
          invitations: 100,
          events: 100,
          members_limited: false,
          invitations_limited: false,
          events_limited: false,
        },
        permissions: {
          can_manage: me?.role === "owner",
          site_scoped_roles: false,
          automated_invitation_email: false,
        },
      };
    }
    const my = seq.current;
    try {
      const result = await api<OrganizationOverview>(
        `/api/organizations?organization_id=${encodeURIComponent(organizationId)}`,
      );
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, organizations: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      if (e instanceof ApiRequestError && (e.status === 403 || e.status === 404)) {
        dropOrganizationContext();
        return null;
      }
      setCapabilities((c) => ({ ...c, organizations: contractStateFromError(e) }));
      return null;
    }
  }
  async function organizationCommand(body: OrganizationCommand): Promise<InvitationCreated | boolean> {
    let created: InvitationCreated | null = null;
    const ok = await run(async (ctx) => {
      if (modeRef.current === "demo") {
        const invitations = readDemo<OrganizationOverview["invitations"]>(
          DEMO_KEYS.invitations,
          [],
          Array.isArray,
        );
        if (body.action === "create_invitation") {
          const code = Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
          const invitation = {
            id: uid(),
            organization_id: body.organization_id,
            email: body.email,
            role: body.role,
            status: "pending",
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + body.expires_in_days * 86400000).toISOString(),
          };
          writeDemo(DEMO_KEYS.invitations, [
            invitation,
            ...invitations.filter((i) => i.email !== body.email || i.status !== "pending"),
          ]);
          if (!ctx.alive()) return;
          created = {
            invitation,
            invitation_code: code,
            invite_url: `${window.location.origin}/#join-organization/${code}`,
            delivery: "manual_share",
          };
          ctx.notice("Invitation de démonstration créée. Le code ne fonctionne que dans cette démonstration.");
          return;
        }
        if (body.action === "revoke_invitation") {
          writeDemo(
            DEMO_KEYS.invitations,
            invitations.map((i) =>
              i.id === body.invitation_id ? { ...i, status: "revoked", revoked_at: new Date().toISOString() } : i,
            ),
          );
        } else if (body.action === "remove_member") {
          ctx.when(setData)({
            ...data,
            organization_members: data.organization_members.filter(
              (m) => !(m.organization_id === body.organization_id && m.user_id === body.user_id),
            ),
          });
        } else if (body.action === "change_member_role") {
          ctx.when(setData)({
            ...data,
            organization_members: data.organization_members.map((m) =>
              m.organization_id === body.organization_id && m.user_id === body.user_id
                ? { ...m, role: body.role }
                : m,
            ),
          });
        } else if (body.action === "transfer_ownership") {
          ctx.when(setData)({
            ...data,
            organization_members: data.organization_members.map((m) =>
              m.organization_id !== body.organization_id
                ? m
                : m.user_id === body.user_id
                  ? { ...m, role: "owner" }
                  : m.role === "owner"
                    ? { ...m, role: "manager" }
                    : m,
            ),
            organizations: data.organizations.map((o) =>
              o.id === body.organization_id ? { ...o, owner_id: body.user_id } : o,
            ),
          });
        }
        ctx.notice("Modification enregistrée dans la démonstration.");
        return;
      }
      try {
        const result = await api<InvitationCreated | { ok: true }>("/api/organizations", body);
        ctx.when(setCapabilities)((c) => ({ ...c, organizations: "available" }));
        if ("invitation_code" in result) created = result;
      } catch (e) {
        const state = contractStateFromError(e);
        if (state === "missing") ctx.when(setCapabilities)((c) => ({ ...c, organizations: "missing" }));
        throw e;
      }
      if (ctx.alive()) await refresh();
      ctx.notice(
        body.action === "create_invitation"
          ? "Invitation créée. Transmettez le code vous-même : aucun email n’est envoyé automatiquement."
          : "Modification enregistrée.",
      );
    });
    if (!ok) return false; // failed or stale: no one-time code may leak into another session
    return created ?? true;
  }
  async function acceptInvitation(token: string) {
    return run(async (ctx) => {
      if (!INVITE_TOKEN.test(token)) throw new Error("Ce code d’invitation n’a pas un format valide.");
      if (modeRef.current === "demo")
        throw new Error("Les invitations réelles s’acceptent avec un compte connecté, pas dans la démonstration.");
      try {
        await api("/api/organizations/invitations/accept", { token });
      } catch (e) {
        const state = contractStateFromError(e);
        if (state === "missing") ctx.when(setCapabilities)((c) => ({ ...c, organizations: "missing" }));
        throw e;
      }
      ctx.when(setPendingInvitation)(null);
      try {
        sessionStorage.removeItem(INVITE_KEY);
      } catch {}
      if (ctx.alive()) await refresh();
      ctx.notice("Invitation acceptée. L’organisation est maintenant disponible dans votre espace.");
      ctx.when(navigate)(homeFor(roleRef.current, "live"));
    });
  }
  async function loadSiteAccess(organizationId: string): Promise<SiteAccessOverview | null> {
    if (modeRef.current === "demo") {
      const scopes = readDemo<Record<string, { scope: "all" | "selected"; grants: { site_id: string; can_write: boolean }[] }>>(
        DEMO_KEYS.siteAccess,
        {},
        (v) => !!v && typeof v === "object",
      );
      const members = data.organization_members
        .filter((m) => m.organization_id === organizationId)
        .map((m) => ({
          user_id: m.user_id,
          role: m.role,
          full_name: m.user_id === DEMO_IDS.manager ? DEMO_NAMES.manager : "Membre (démo)",
          scope: m.role === "owner" ? ("all" as const) : scopes[m.user_id]?.scope || ("all" as const),
          grants: m.role === "owner" ? [] : scopes[m.user_id]?.grants || [],
        }));
      const me = `demo-${roleRef.current}`;
      const isOwner = members.some((m) => m.user_id === me && m.role === "owner");
      return {
        organization_id: organizationId,
        can_manage: isOwner,
        members: isOwner ? members : members.filter((m) => m.user_id === me),
      };
    }
    const my = seq.current;
    try {
      const result = await api<SiteAccessOverview>(
        `/api/organizations/site-access?organization_id=${encodeURIComponent(organizationId)}`,
      );
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, siteAccess: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      if (e instanceof ApiRequestError && (e.status === 403 || e.status === 404)) {
        dropOrganizationContext();
        return null;
      }
      setCapabilities((c) => ({ ...c, siteAccess: contractStateFromError(e) }));
      return null;
    }
  }
  async function setSiteAccess(body: SiteAccessCommand) {
    return run(async (ctx) => {
      if (body.scope === "all" && body.grants.length)
        throw new Error("Une portée « tous les sites » ne comporte pas de sites sélectionnés.");
      if (body.scope === "selected" && !body.grants.length)
        throw new Error("Sélectionnez au moins un site, ou choisissez « tous les sites ».");
      if (modeRef.current === "demo") {
        const scopes = readDemo<Record<string, unknown>>(DEMO_KEYS.siteAccess, {}, (v) => !!v && typeof v === "object");
        scopes[body.user_id] = { scope: body.scope, grants: body.grants };
        writeDemo(DEMO_KEYS.siteAccess, scopes);
        ctx.notice("Portée des sites enregistrée dans la démonstration.");
        return;
      }
      try {
        await api("/api/organizations/site-access", body);
        ctx.when(setCapabilities)((c) => ({ ...c, siteAccess: "available" }));
      } catch (e) {
        if (contractStateFromError(e) === "missing")
          ctx.when(setCapabilities)((c) => ({ ...c, siteAccess: "missing" }));
        throw e;
      }
      if (ctx.alive()) await refresh();
      ctx.notice("Portée des sites enregistrée.");
    });
  }
  async function loadArtisanPerformance(): Promise<ArtisanPerformanceReport | null> {
    const periods = monthPeriods(new Date());
    if (modeRef.current === "demo") {
      const paidIds = new Set(
        data.quotes
          .filter((q) => q.artisan_id === DEMO_IDS.artisan)
          .map((q) => q.id),
      );
      const inRange = (iso: string | null | undefined, start: string, end: string) =>
        !!iso && iso >= start && iso < end;
      const sum = (start: string, end: string) =>
        data.payments
          .filter((p) => p.status === "paid" && paidIds.has(p.quote_id) && inRange(p.paid_at, start, end))
          .reduce((n, p) => n + p.total_cents, 0);
      const count = (start: string, end: string) =>
        data.payments.filter(
          (p) => p.status === "paid" && paidIds.has(p.quote_id) && inRange(p.paid_at, start, end),
        ).length;
      const mine = new Set(
        data.interventions.filter((i) => i.artisan_id === DEMO_IDS.artisan).map((i) => i.id),
      );
      const reviews = data.reviews.filter((r) => mine.has(r.intervention_id));
      const cur = sum(periods.current_start, periods.current_end);
      const prev = sum(periods.previous_start, periods.previous_end);
      return {
        period: { ...periods, boundary: "inclusive_start_exclusive_end" },
        current: {
          paid_service_cents: cur,
          paid_count: count(periods.current_start, periods.current_end),
          completed_missions_count: data.interventions.filter(
            (i) => mine.has(i.id) && ["completed", "paid"].includes(i.status) && inRange(i.completed_at, periods.current_start, periods.current_end),
          ).length,
        },
        previous: {
          paid_service_cents: prev,
          paid_count: count(periods.previous_start, periods.previous_end),
          completed_missions_count: 0,
        },
        rating: {
          average: reviews.length
            ? Math.round((reviews.reduce((n, r) => n + r.rating, 0) / reviews.length) * 10) / 10
            : null,
          count: reviews.length,
          period: "all_time",
        },
        growth_percent: prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null,
        punctuality_rate: null,
        currency: "eur",
        scope: "demo_records",
        limited: false,
        basis: {
          revenue: "Prestations payées TTC de la démonstration, pas un revenu net.",
          completed: "Missions terminées ou réglées sur la période.",
          rating: "Avis déposés sur vos interventions (toutes périodes).",
          growth: "Variation du montant payé par rapport au mois précédent ; absente si ce mois était à zéro.",
          punctuality: "Aucune définition mesurée de la ponctualité.",
        },
      };
    }
    const my = seq.current;
    try {
      const q = new URLSearchParams({
        current_start: periods.current_start,
        current_end: periods.current_end,
        previous_start: periods.previous_start,
        previous_end: periods.previous_end,
      });
      const result = await api<ArtisanPerformanceReport>(`/api/artisan/performance?${q}`);
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, performance: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, performance: contractStateFromError(e) }));
      return null;
    }
  }

  async function loadPaymentStatus(quoteId: string): Promise<PaymentStatusReport | null> {
    if (modeRef.current === "demo") {
      const payment = data.payments.find((p) => p.quote_id === quoteId) || null;
      return {
        payment,
        attempts: payment ? [payment] : [],
        attempts_limit: 50,
        history_limited: false,
      };
    }
    const my = seq.current;
    try {
      const result = await api<PaymentStatusReport>(
        `/api/payments/status?quote_id=${encodeURIComponent(quoteId)}`,
      );
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, payments: "available" }));
      return result;
    } catch (e) {
      if (my !== seq.current) return null;
      setCapabilities((c) => ({ ...c, payments: contractStateFromError(e) }));
      return null;
    }
  }

  // Dependencies of the identity adoption sequence (login / signup with session).
  const identityDeps = {
    async currentUserId() {
      try {
        const { data } = await createClient().auth.getUser();
        return data.user?.id ?? null;
      } catch {
        return null;
      }
    },
    loadedUserId: () => userId.current,
    clearSessionState,
    setUserId(id: string | null) {
      userId.current = id;
    },
    refresh,
    navigate,
    // Restored by the login chain of THIS identity: the cleared storage is written back so a reload
    // before sending keeps the draft and the booking (never deleted before POST 201).
    setPendingDraft(draft: RequestValues | null) {
      setPendingDraft(draft);
      if (!draft) return;
      savePublicDraft(getDraftStorage(), draft);
      const carried = bookingCarry.current;
      bookingCarry.current = null;
      if (carried) {
        setBooking(carried);
        saveBooking(getDraftStorage(), carried);
      }
    },
    homeView: () => homeFor(roleRef.current, "live"),
    landing() {
      const link = loginLanding(window.location.hash, pendingLink.current, roleRef.current);
      pendingLink.current = null;
      return link;
    },
  };

  // ---- Public (unauthenticated) session -------------------------------------------------
  const publicSession: PublicSession = {
    view,
    param,
    busy,
    error,
    notice,
    authMode,
    categoryId,
    pendingDraft,
    booking: pendingDraft ? booking : null,
    pendingInvitation,
    keepInvitation(token) {
      if (!INVITE_TOKEN.test(token)) {
        setError("Ce lien d’invitation est incomplet ou invalide. Demandez un nouveau code au propriétaire de l’organisation.");
        navigate("home");
        return;
      }
      setPendingInvitation(token);
      try {
        sessionStorage.setItem(INVITE_KEY, token);
      } catch {}
      setAuthMode("login");
      navigate("auth");
      setNotice(
        "Connectez-vous avec l’adresse email qui a reçu l’invitation ; elle sera acceptée juste après la connexion.",
      );
    },
    go: navigate,
    setAuthMode,
    setCategory: setCategoryId,
    setError,
    setNotice,
    startDemo,
    saveDraft(values) {
      setPendingDraft(values);
      // Same canonical format as /offline-request.html; storage refusal keeps the in-memory draft.
      const saved = savePublicDraft(getDraftStorage(), values);
      setAuthMode("signup");
      navigate("auth");
      setNotice(draftNotice(saved)); // quota/refusal: the input stays in memory, never a false « saved »
    },
    async signIn(email, password) {
      return run(async (ctx) => {
        const client = createClient();
        const result = await client.auth.signInWithPassword({ email, password });
        if (result.error)
          throw new Error(
            "Connexion impossible. Vérifiez votre email, votre mot de passe et la confirmation de votre compte.",
          );
        bookingCarry.current = pendingDraft ? booking : null;
        const outcome = await adoptIdentity(ctx, result.data.user?.id ?? null, pendingDraft, identityDeps);
        if (outcome === "superseded")
          throw new Error(
            "Une autre connexion a été établie entre-temps dans ce navigateur. Rechargez la page pour continuer avec le compte actif.",
          );
      });
    },
    async signUp(values) {
      return run(async (ctx) => {
        const client = createClient();
        const result = await client.auth.signUp({
          email: values.email,
          password: values.password,
          // Confirmation link lands on the server callback (token_hash verify), never a fake session.
          options: { data: { full_name: values.full_name, role: values.role }, emailRedirectTo: `${window.location.origin}/auth/confirm` },
        });
        if (result.error) throw result.error;
        if (result.data.session) {
          bookingCarry.current = pendingDraft ? booking : null;
        const outcome = await adoptIdentity(ctx, result.data.user?.id ?? null, pendingDraft, identityDeps);
          if (outcome === "superseded")
            throw new Error(
              "Une autre connexion a été établie entre-temps dans ce navigateur. Rechargez la page pour continuer avec le compte actif.",
            );
        } else
          ctx.notice(
            pendingDraft && booking
              ? "Votre compte a été créé. Confirmez votre adresse depuis l’email reçu, puis revenez dans CET onglet et connectez-vous : votre demande y est gardée 30 minutes. Rien n’a encore été envoyé."
              : "Votre compte a été créé. Consultez votre email pour confirmer votre inscription avant de vous connecter.",
          );
      });
    },
    async resetPassword(email) {
      return run(async (ctx) => {
        const client = createClient();
        const result = await client.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/auth/reset-password",
        });
        if (result.error) throw result.error;
        ctx.notice("Si un compte existe pour cette adresse, un lien de réinitialisation vous sera envoyé.");
      });
    },
  };

  const profile: Profile | null = data.profile;
  const { displayName, firstName } = resolveDisplayName(mode === "demo" ? "demo" : "live", role, profile, DEMO_NAMES);
  // Advanced lots (WEB-SHARED-001): one client bundle per identity. Live clients are bound to the
  // identity generation (a reply after logout/login/demo switch is dropped); demonstration clients
  // operate on seeds only and never touch the network.
  const features = useMemo(
    () =>
      mode === "demo"
        ? createDemoFeatureClients(role)
        : createFeatureClients({
            generation: () => guard.generation(),
            setState: (key, state) => setCapabilities((c) => (c[key] === state ? c : { ...c, [key]: state })),
          }),
    [mode, role, guard, identityEpoch, profile?.id],
  );
  // Capability probes after each successful workspace load: cheap reads whose reply alone decides
  // availability (404 missing, 503 unavailable, 403 present). Nothing here grants anything: the
  // back-office reply is kept as data for a fail-closed gate, the unread count for the bell.
  useEffect(() => {
    if (mode !== "live" || !refreshedAt) return;
    let active = true;
    const ignore = () => undefined;
    void features.notifications
      .summary()
      .then((summary) => active && setUnreadNotifications(summary ? summary.unread_count : null))
      .catch(() => active && setUnreadNotifications(null));
    void features.platform.load
      .me()
      .then((access) => active && setPlatformAccess(access))
      .catch(() => active && setPlatformAccess(null));
    if (role === "artisan") void features.planning.load(planningProbeRange()).catch(ignore);
    if (role === "manager" && activeSiteId) void features.siteOperations.load(activeSiteId).catch(ignore);
    return () => {
      active = false;
    };
  }, [mode, role, refreshedAt, activeSiteId, features]);
  useEffect(() => {
    if (mode !== "demo") return;
    setPlatformAccess(role === "admin" ? PLATFORM_DEMO.access : null);
    setUnreadNotifications(demoNotificationPage({}).unread_count);
  }, [mode, role]);
  // SHARED-REV-006: explicit recovery action after a transient 503/network failure. Re-probes the
  // one contract with the bound client (same identity generation, same rights); the reply alone
  // sets the capability again. Errors are swallowed here: the capability already reflects them.
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const reprobeFeature = useCallback(
    async (key: FeatureKey, hint?: ReprobeHint) => {
      const bundle = features;
      // Alive = the bundle's OWNER generation (captured when the bundle was built, never at
      // invocation) is still the current one, mode still live, and the bundle handed to the leaves
      // is still this one. A guard bump before the next render already makes it false.
      const alive = () => modeRef.current === "live" && bundle.owner === guard.generation() && featuresRef.current === bundle;
      await reprobe(key, hint, {
        bundle,
        alive,
        setState: (k, state) => setCapabilities((c) => (c[k] === state ? c : { ...c, [k]: state })),
        setUnread: setUnreadNotifications,
        setAccess: setPlatformAccess,
        activeSiteId: activeSiteRef.current,
      });
    },
    [features, guard],
  );

  const session: Session = {
    mode: mode === "live" ? "live" : "demo",
    role,
    profile,
    profileId: mode === "live" ? profile?.id || "" : `demo-${role}`,
    displayName,
    firstName,
    // Live: only the draft adopted by THIS identity chain (clearSessionState drops it on any
    // identity change); demo never inherits a public draft.
    pendingDraft: mode === "live" ? pendingDraft : demoBooking?.draft ?? null,
    // « Modifier » on the booking confirmation: the edited request replaces the kept draft (same
    // tab storage), nothing is sent; the confirmation then shows it again.
    updatePendingDraft(values: RequestValues) {
      if (modeRef.current === "demo") {
        setDemoBooking((d) => (d ? { ...d, draft: values } : d));
        return;
      }
      if (modeRef.current !== "live") return;
      setPendingDraft(values);
      savePublicDraft(getDraftStorage(), values);
    },
    updateBookingPayment(payment: NonNullable<BookingDraft["payment"]>) {
      if (modeRef.current === "demo") {
        setDemoBooking((d) => (d ? { ...d, booking: { ...d.booking, payment } } : d));
        return;
      }
      if (modeRef.current !== "live" || !booking) return;
      const next = { ...booking, payment };
      setBooking(next);
      saveBooking(getDraftStorage(), next);
    },
    updateBookingContact(contact: BookingDraft["contact"]) {
      if (modeRef.current === "demo") {
        setDemoBooking((d) => (d ? { ...d, booking: { ...d.booking, contact } } : d));
        return;
      }
      if (modeRef.current !== "live" || !booking) return;
      const next = { ...booking, contact };
      setBooking(next);
      saveBooking(getDraftStorage(), next);
    },
    booking: mode === "live" ? (pendingDraft ? booking : null) : demoBooking?.booking ?? null,
    cardReturn: mode === "live" ? cardReturn : null,
    mutationContext: cardContext,
    pendingLookupFailed: mode === "live" && pendingLookup === "error",
    retryPendingLookup: () => void checkPendingCardHold(),
    data,
    professional,
    capabilities,
    returnContext,
    view,
    param,
    selectedId: param && view === "detail" ? param : selectedId,
    selectedQuoteId,
    busy,
    loading,
    connection,
    error,
    notice,
    activeOrganizationId,
    activeSiteId,
    refreshedAt,
    // Same rule as the enterprise space: a sole organisation is the implicit context, several
    // organisations require an explicit choice (never organizations[0]).
    membershipRole: membershipRole(
      data.organization_members,
      enterpriseContext(data.organizations, data.sites, [], activeOrganizationId, activeSiteId)
        .organizationId,
      mode === "live" ? profile?.id || "" : `demo-${role}`,
    ),
    go: navigate,
    openIntervention(id, quoteId) {
      setSelectedId(id);
      setSelectedQuoteId(quoteId || "");
      navigate("detail", id);
    },
    setNotice,
    setError,
    setActiveOrganization(id) {
      setActiveOrganizationId(id);
      setActiveSiteId("");
    },
    setActiveSite: setActiveSiteId,
    run,
    refresh,
    ensureFresh,
    refreshContext: refreshContextKey(guard.generation(), role, activeOrganizationId, activeSiteId),
    loadProfessional,
    action,
    operate,
    loadOperations,
    loadArtisanDossier,
    artisanCommand,
    loadAdminOverview,
    loadAdminInterventions,
    loadAdminDirectory,
    loadAdminDirectoryItem,
    loadAdminIntervention,
    loadQuoteDraft,
    quoteDraftCommand,
    loadSupportTickets,
    loadSupportTicket,
    createSupportTicket,
    supportCommand,
    loadOrganization,
    organizationCommand,
    acceptInvitation,
    loadSiteAccess,
    setSiteAccess,
    loadArtisanPerformance,
    loadPaymentStatus,
    createIntervention,
    startBooking,
    bookingPhotos: () => bookingPhotos.current,
    updateBookingPhotos(photos: File[]) {
      bookingPhotos.current = photos.slice(0, 6);
      if (modeRef.current === "live") writePhotoCount(getDraftStorage(), bookingPhotos.current.length);
    },
    confirmBooking,
    cancelBooking,
    finalizeBooking,
    uploads,
    retryUploads,
    acknowledgeUpload(interventionId, key, documentId) {
      setUploads((all) =>
        all.map((q) => (q.interventionId === interventionId ? acknowledgeUpload(q, key, documentId) : q)),
      );
      setNotice("Photo confirmée comme enregistrée dans le dossier.");
    },
    dismissUploads(interventionId) {
      setUploads((all) => removeQueue(all, interventionId));
    },
    sendMessage,
    submitReview,
    createSite,
    updateProfile,
    professionalCommand,
    checkout,
    connectStripe,
    logout,
    setDemoRole(next) {
      if (modeRef.current !== "demo") return;
      guard.bump();
    setIdentityEpoch((e) => e + 1);
      runner.reset();
      setRole(next);
      setSelectedId("");
      setSelectedQuoteId("");
      setActiveOrganizationId("");
      setActiveSiteId("");
      setSessionKey((k) => k + 1);
      navigate(homeFor(next, "demo"));
    },
    resetDemo() {
      if (modeRef.current !== "demo") return;
      clearDemo();
      setData(seed());
      setProfessional(proSeed());
      setNotice("Démonstration réinitialisée.");
    },
    saveDemo(next) {
      if (modeRef.current === "demo") setData(next);
    },
    setProfessional,
    features,
    platformAccess,
    unreadNotifications,
    reprobeFeature,
  };

  if (booting)
    return (
      <main id="main" className="page-loader boot" role="status">
        <span className="spinner" />
        Chargement…
      </main>
    );
  if (mode === "public") return <PublicSite key="public" session={publicSession} />;
  if (role === "artisan") return <ArtisanSpace key={sessionKey} session={session} />;
  if (role === "manager") return <EnterpriseSpace key={sessionKey} session={session} />;
  if (role === "admin") return <AdminSpace key={sessionKey} session={session} />;
  return <ClientSpace key={sessionKey} session={session} />;
}
