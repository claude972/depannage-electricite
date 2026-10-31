"use client";
// Session controller: identity, mode (public/demo/live), role guards, hash routing, data
// loading with late-response protection, and every mutation (live contract or explicit demo
// counterpart). Role spaces under components/role render the screens.
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { api, ApiRequestError, contractStateFromError } from "./app/api";
import { createGuard, createRunner, type RunContext, type Runner } from "./app/guard";
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
import { category, uid } from "./app/format";
import {
  INVITE_TOKEN,
  buildHash,
  canAccess,
  homeFor,
  membershipRole,
  monthPeriods,
  parseHash,
  parseReturnParams,
  pickQuote,
} from "./app/session";
import type { PublicSession, Session } from "./app/session-types";
import {
  EMPTY_PROFESSIONAL,
  EMPTY_WORKSPACE,
  UNKNOWN_CAPABILITIES,
  type AdminOverview,
  type ArtisanCommand,
  type ArtisanDossier,
  type ArtisanPerformanceReport,
  type InvitationCreated,
  type OrganizationCommand,
  type OrganizationOverview,
  type PaymentStatusReport,
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
  type RequestValues,
  type ReturnContext,
  type Role,
  type Status,
  type View,
  type Workspace,
} from "./app/types";
import { PublicSite } from "./role/public-site";
import { ClientSpace } from "./role/client-space";
import { ArtisanSpace } from "./role/artisan-space";
import { EnterpriseSpace } from "./role/enterprise-space";
import { AdminSpace } from "./role/admin-space";

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
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connection, setConnection] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [categoryId, setCategoryId] = useState<Category>("panel");
  const [pendingDraft, setPendingDraft] = useState<RequestValues | null>(null);
  const [pendingInvitation, setPendingInvitation] = useState<string | null>(null);
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
  modeRef.current = mode;
  roleRef.current = role;

  const clearSessionState = useCallback(() => {
    seq.current += 1; // any in-flight workspace response is now stale
    guard.bump(); // any in-flight mutation chain is now foreign
    runner.reset();
    userId.current = null;
    setData(EMPTY_WORKSPACE);
    setProfessional(EMPTY_PROFESSIONAL);
    setCapabilities(UNKNOWN_CAPABILITIES);
    setReturnContext(null);
    setSelectedId("");
    setSelectedQuoteId("");
    setActiveOrganizationId("");
    setActiveSiteId("");
    setConnection("");
    setError("");
    setNotice("");
    setPendingDraft(null);
    try {
      sessionStorage.removeItem(DRAFT_KEY);
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
  const refresh = useCallback(async () => {
    const my = ++seq.current;
    const expectedUser = userId.current;
    setError("");
    try {
      const ws = await api<Workspace>("/api/workspace");
      if (my !== seq.current) return;
      if (!ws.profile) throw new ApiRequestError(401, "Session invalide.");
      if (expectedUser && ws.profile.id !== expectedUser) {
        // Identity changed under us: discard and reset instead of mixing accounts.
        clearSessionState();
        setMode("public");
        return;
      }
      userId.current = ws.profile.id;
      setData({ ...EMPTY_WORKSPACE, ...ws });
      setRole(ws.profile.role);
      setMode("live");
    } catch (e) {
      if (my !== seq.current) return;
      if (e instanceof ApiRequestError && e.status === 401) {
        clearSessionState();
        setMode("public");
        setError("Votre session a expiré. Reconnectez-vous pour retrouver vos dossiers.");
        return;
      }
      setError((e as Error).message);
    }
  }, [clearSessionState]);

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
      setCapabilities((c) => ({ ...c, professional: contractStateFromError(e) }));
      setError((e as Error).message);
    }
  }, []);

  // Boot: draft, return parameters, existing session, auth listener.
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
      if (draft && draft.savedAt > Date.now() - 1800000 && draft.values?.category)
        setPendingDraft(draft.values);
    } catch {}
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
        }
        const sub = client.auth.onAuthStateChange((event, session) => {
          if (!active) return;
          const nextId = session?.user?.id ?? null;
          if (event === "SIGNED_OUT" || (!nextId && modeRef.current === "live")) {
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

  // Return parameters are hints: re-read server state, never mark anything as paid.
  useEffect(() => {
    if (!returnContext || booting) return;
    if (returnContext.kind === "auth") {
      if (returnContext.state === "confirmed") {
        setNotice(
          mode === "live"
            ? "Votre adresse est confirmée. Votre espace est chargé."
            : "Votre adresse est confirmée. Connectez-vous pour ouvrir votre espace.",
        );
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
      if (back.state === "cancelled") {
        setNotice(
          "Paiement annulé : aucun débit n’a été effectué. Vous pouvez reprendre le règlement quand vous le souhaitez.",
        );
      } else if (!quote) {
        setNotice(
          "Retour de paiement reçu. Le dossier ne contient pas de devis accepté chargé ; l’état sera relu depuis le serveur.",
        );
      } else {
        // The redirect only says "the customer came back". Ask the server what really happened.
        const g = guard.generation();
        void (async () => {
          const report = await loadPaymentStatus(quote.id);
          if (!guard.alive(g)) return;
          const status = report?.payment?.status ?? data.payments.find((p) => p.quote_id === quote.id)?.status;
          if (status === "paid")
            setNotice("Règlement confirmé par le serveur. Le devis accepté est archivé dans vos documents.");
          else if (status === "failed")
            setError("Le paiement a échoué selon Stripe. Aucun montant n’a été prélevé ; vous pouvez réessayer.");
          else if (status === "expired")
            setError("La page de paiement a expiré sans règlement. Vous pouvez relancer le paiement.");
          else
            setNotice(
              "Retour de paiement reçu. La confirmation définitive arrive par Stripe ; cet écran se mettra à jour automatiquement.",
            );
        })();
      }
    } else if (returnContext.kind === "connect") {
      navigate("profile");
      setNotice(
        returnContext.state === "returned"
          ? "Retour Stripe Connect enregistré. L’état de votre compte de règlement est relu depuis le serveur ; Stripe peut encore demander des informations."
          : "Le lien Stripe a expiré. Relancez la configuration pour obtenir un nouveau lien.",
      );
    }
    setReturnContext(null);
  }, [returnContext, booting, mode, data, navigate]);

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
    const onHash = () => {
      const parsed = parseHash(window.location.hash);
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
    let channel = client.channel(`workspace-${profileIdForRealtime}`);
    for (const table of ["interventions", "quotes", "messages", "payments"])
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
      if (active) setConnection(status);
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

  function startDemo(nextRole: Role = "client", next?: View) {
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
    });
    guard.bump();
    runner.reset();
    setMode("demo");
    setRole(nextRole);
    setLoading(false);
    setSessionKey((k) => k + 1);
    navigate(next || homeFor(nextRole, "demo"));
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

  async function action(
    id: string,
    name: InterventionAction | "simulate_payment",
    extra?: Record<string, unknown>,
  ) {
    return run(async (ctx) => {
      if (modeRef.current === "demo") {
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
          send_quote: ["assigned"],
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
          const rate = Number(extra?.tax_rate);
          const subtotal = lines.reduce(
            (n, l) => n + Math.round(l.quantity * l.unit_price_cents),
            0,
          );
          const quote: Quote = {
            id: uid(),
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
      setCapabilities((c) => ({ ...c, operations: contractStateFromError(e) }));
      return null;
    }
  }

  async function loadArtisanDossier(): Promise<ArtisanDossier | null> {
    if (modeRef.current === "demo")
      return readDemo<ArtisanDossier>(
        DEMO_KEYS.artisan,
        artisanSeed(),
        (v) => !!v && typeof v === "object" && "credentials" in (v as object),
      );
    const my = seq.current;
    try {
      const result = await api<ArtisanDossier>("/api/artisan");
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
      setCapabilities((c) => ({ ...c, adminOverview: contractStateFromError(e) }));
      return null;
    }
  }

  async function createIntervention(values: RequestValues) {
    return run(async (ctx) => {
      if (modeRef.current === "demo") {
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
        try {
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {}
        ctx.when(setSelectedId)(intervention.id);
        ctx.when(navigate)("detail", intervention.id);
        ctx.notice("Demande enregistrée dans la démonstration, sans envoi à un artisan réel.");
        return;
      }
      const result = await api<{ intervention: Intervention }>("/api/interventions", values);
      if (ctx.alive()) await refresh();
      ctx.when(setPendingDraft)(null);
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {}
      if (result.intervention?.id) {
        ctx.when(setSelectedId)(result.intervention.id);
        ctx.when(navigate)("detail", result.intervention.id);
      } else ctx.when(navigate)("requests");
      ctx.notice("Votre demande a été enregistrée.");
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
      if (e instanceof ApiRequestError && e.status === 403) {
        // Membership lost: drop every cached view of this organisation.
        setActiveOrganizationId("");
        setActiveSiteId("");
        setProfessional(EMPTY_PROFESSIONAL);
        void refresh();
        setError("Vous ne faites plus partie de cette organisation. Les données ont été rechargées.");
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
    return created ?? ok;
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
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), values }));
      } catch {}
      setAuthMode("signup");
      navigate("auth");
      setNotice(
        "Votre brouillon est conservé dans ce navigateur. Connectez-vous ou créez votre compte pour enregistrer cette demande.",
      );
    },
    async signIn(email, password) {
      return run(async (ctx) => {
        const client = createClient();
        const result = await client.auth.signInWithPassword({ email, password });
        if (result.error)
          throw new Error(
            "Connexion impossible. Vérifiez votre email, votre mot de passe et la confirmation de votre compte.",
          );
        clearSessionState();
        userId.current = result.data.user?.id ?? null;
        const keepDraft = pendingDraft;
        if (ctx.alive()) await refresh();
        if (keepDraft) {
          ctx.when(setPendingDraft)(keepDraft);
          ctx.when(navigate)("new");
        } else ctx.when(navigate)(homeFor(roleRef.current, "live"));
      });
    },
    async signUp(values) {
      return run(async (ctx) => {
        const client = createClient();
        const result = await client.auth.signUp({
          email: values.email,
          password: values.password,
          options: { data: { full_name: values.full_name, role: values.role } },
        });
        if (result.error) throw result.error;
        if (result.data.session) {
          const keepDraft = pendingDraft;
          clearSessionState();
          userId.current = result.data.user?.id ?? null;
          if (ctx.alive()) await refresh();
          if (keepDraft) {
            ctx.when(setPendingDraft)(keepDraft);
            ctx.when(navigate)("new");
          } else ctx.when(navigate)(homeFor(roleRef.current, "live"));
        } else
          ctx.notice(
            "Votre compte a été créé. Consultez votre email pour confirmer votre inscription avant de vous connecter.",
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
  const displayName =
    mode === "demo"
      ? profile?.role === role && profile.full_name
        ? profile.full_name
        : DEMO_NAMES[role]
      : profile?.full_name || "Bienvenue";
  const session: Session = {
    mode: mode === "live" ? "live" : "demo",
    role,
    profile,
    profileId: mode === "live" ? profile?.id || "" : `demo-${role}`,
    displayName,
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
    membershipRole: membershipRole(
      data.organization_members,
      activeOrganizationId,
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
    loadProfessional,
    action,
    operate,
    loadOperations,
    loadArtisanDossier,
    artisanCommand,
    loadAdminOverview,
    loadOrganization,
    organizationCommand,
    acceptInvitation,
    loadArtisanPerformance,
    loadPaymentStatus,
    createIntervention,
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
