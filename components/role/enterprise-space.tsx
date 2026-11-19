"use client";
import { DemoBanner } from "../app/demo-banner";
import floatingNav from "./floating-navigation.module.css";
// Espace entreprise cliente (rôle "manager") : syndics, restauration, bureaux et ERP pilotant
// plusieurs sites. Références maîtresses : M66 (shell, tableau), M4 (filtres), V5-C08
// (approbation), V5-C01 / M50 (fiche de site), M13 / M56 / V5-C05 (tableaux de bord).
// Tout indicateur est calculé depuis session.data et annonce sa base ("dossiers chargés").
import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { isDeclaredOnSite } from "../app/booking-status";
import { reportDeclarant } from "../app/report-declarant";
import { ReportEvidenceSummary, ReportReceiptForm, canSignReport, dossierPhotos } from "../app/report-evidence";
import styles from "./enterprise.module.css";
import theme from "./enterprise-theme.module.css";
import { ThemeSurface } from "../app/theme-provider";
import { Icon } from "../app/icons";
import { InstallPanel } from "../app/install-panel";
import {
  Alerts,
  Badge,
  Brand,
  ConfirmAction,
  Empty,
  Field,
  Forbidden,
  Loader,
  PageTitle,
  Segments,
  Stat,
  Tag,
  Unavailable,
} from "../app/ui";
import {
  BudgetEditor,
  DocumentManager,
  MessageCenter,
  ProfessionalOperations,
  ProfileForm,
  RequestForm,
  ReviewForm,
  SiteForm,
  WarrantyPanel,
} from "../app/forms";
import {
  CATEGORIES,
  ROLE_NAMES,
  SITE_TYPES,
  STATUS,
  TRAVEL_STAGE,
  category,
  csv,
  date,
  dateTime,
  download,
  initials,
  money,
  quoteRef,
  shortId,
} from "../app/format";
import {
  canAccess,
  enterpriseAuthority,
  enterpriseContext,
  pickQuote,
  quoteVersions,
  type EnterpriseAuthority,
  type MemberScope,
} from "../app/session";
import type { Session } from "../app/session-types";
import { UploadQueuePanel } from "../app/upload-queue";
import {
  acceptedCommittedCents,
  FIGURE_PLACEHOLDER,
  dashboardFigures,
  overviewSubtitle,
  siteBudgetBars,
  NO_FILTERS,
  budgetFigures,
  budgetTone,
  filterInterventions,
  isFiltered,
  pageWindow,
  reconcileFilters,
  siteAlertSummary,
  siteAlerts,
  wholePercent,
  type InterventionFilters,
  type ListContext,
} from "./enterprise-lists";
import { DossierHelpLink, SupportCenter } from "./support-tickets";
import { HeaderBell, NotificationsPage } from "./notifications-anchor";
import { QuoteDocumentsAnchor } from "./quote-documents-anchor";
import { TrackingAnchor } from "./tracking-anchor";
import { useDetailPresence } from "./use-detail-presence";
import { PointReadState } from "./detail-read-view";
import { SiteOperationsView } from "../features/site-operations/site-operations-view";
import { SiteEnergyPanel } from "../features/energy/site-energy-panel";
import { EnergyConsolidationPanel } from "../features/energy-consolidation/energy-consolidation-panel";
import { SiteContactsPanel } from "../features/site-contacts/site-contacts-panel";
import { SiteAreasPanel } from "../features/site-areas/site-areas-panel";
import { ComplianceReminderPanel } from "../features/operational-reminders/operational-reminder-panel";
import { OrganizationSitesList, SiteSettingsPanel } from "../features/site-lifecycle/site-lifecycle-panels";
import { SiteDirectLoader } from "../features/site-lifecycle/site-direct";
import { ProviderTeamsPanel } from "../features/provider-teams/provider-teams-panel";
import { DelegatedPayerCheckout, DelegatedPayerManager } from "../features/delegated-payer/delegated-payer";
import { REPORT_COPY, reportQuery, useEnterpriseReport } from "../features/enterprise-reports/use-enterprise-report";
import { QUOTES_COPY, useRecipientQuote } from "../features/recipient-quotes/use-recipient-quotes";
import { DECISION_COPY, simplePending as decisionSimplePending, useDecisionContext } from "../features/enterprise-quote-decision/use-decision-context";
import { APPROVALS_COPY, useApprovalPoint, useApprovalsList, type ApprovalRow as ServerApproval, type StatusFilter as ApprovalFilter } from "../features/enterprise-approvals/use-enterprise-approvals";
import { RECORDS_COPY, useSiteRecords, type DueRow, type JobRow } from "../features/site-records/use-site-records";
import { SiteComplianceRecords } from "../features/site-records/site-compliance-records";
import { COUNTS_COPY, ENTERPRISE_SEARCH_COPY, ExportFeedback, PRO_COPY, useEnterpriseSearch, useOverviewCounts, useProfessionalOverview, type EnterpriseSearchFilters } from "../features/enterprise-search/use-enterprise-search";
import { ContractSourceLine, QuoteGridAccessPanel } from "../features/quote-grid/quote-grid";
import { QuoteApprovalPanel, SitePolicyPanel } from "../features/advanced-approvals/approvals";
import { acceptanceDecision, timelineApproval as advancedTimelineApproval, type WorkflowStatus } from "../features/advanced-approvals/model";
import { SiteAssetLinksPanel } from "../features/site-asset-links/site-asset-links-panel";
import type { AssetSource } from "../features/site-asset-links/asset-links-model";
import { createAreasApi, parseAreasPage } from "../features/site-areas/areas-model";
import { CoOwnershipPanel } from "../features/co-ownership/co-ownership-panel";
import { SiteDocumentsPanel } from "../features/site-documents/site-documents-panel";
import { SiteAttachmentsPanel } from "../features/site-attachments/site-attachments-panel";
import { CustomerInvoicesPanel } from "../features/customer-invoices/customer-invoices-panel";
import { PlatformPayAction } from "../app/platform-pay";
import { OrganizationSlaPanel } from "../features/organization-sla/organization-sla-panel";
import { CONTRACT_MESSAGES } from "../app/api";
import { demoReport } from "../../lib/features/site-operations/demo";
import { leafScope, platformEntries } from "./anchors";
import { PlatformPage } from "./platform-anchor";
import { FeatureUnavailable, useProbeWhenUnknown } from "./feature-unavailable";
import { EnterpriseTimeline } from "../features/enterprise-timeline/enterprise-timeline";
import { buildTimeline } from "../features/enterprise-timeline/timeline-model";
import { AccountDataPanel } from "../features/account-data/account-data-panel";
import { AccountSessionsPanel } from "../features/account-sessions/account-sessions-panel";
import type {
  Category,
  Approval,
  ApprovalRule,
  ComplianceRecord,
  Intervention,
  InvitationCreated,
  MemberSiteAccess,
  Operations,
  Organization,
  OrganizationCommand,
  OrganizationOverview,
  Payment,
  ProfessionalData,
  Quote,
  Role,
  Site,
  SiteAccessOverview,
  SiteGrant,
  SiteScope,
  Status,
  StoredDocument,
  View,
  Workspace,
} from "../app/types";

// ---- Constantes ------------------------------------------------------------------------
const OPEN_STATUSES: Status[] = ["requested", "assigned", "quoted", "accepted", "in_progress"];
const CANCELLABLE: Status[] = ["requested", "assigned", "quoted"];
const APPOINTMENT_STATUSES: Status[] = ["assigned", "quoted", "accepted"];
const PAGE_SIZE = 10;
const LOADED_NOTE = "Données chargées (100 derniers dossiers)";
const BASIS = "calculé sur les dossiers chargés";
const APPROVAL_META: Record<string, { label: string; tone: "amber" | "green" | "red" }> = {
  pending: { label: "En attente", tone: "amber" },
  approved: { label: "Approuvé", tone: "green" },
  rejected: { label: "Refusé", tone: "red" },
};
const COMPLIANCE_STATUS: Record<string, string> = {
  pending: "À traiter",
  scheduled: "Planifié",
  completed: "Terminé",
};
const COMPLIANCE_KIND: Record<string, string> = {
  maintenance: "Maintenance préventive",
  audit: "Audit électrique",
  safety: "Signalement de sécurité",
};
const MEMBER_ROLE: Record<string, string> = {
  owner: "Propriétaire",
  manager: "Gestionnaire",
  viewer: "Lecture",
};
const PAYMENT_META: Record<string, { label: string; tone: "amber" | "green" | "red" }> = {
  pending: { label: "En attente", tone: "amber" },
  paid: { label: "Réglé", tone: "green" },
  failed: { label: "Échoué", tone: "red" },
};
const NAV: { view: View; label: string; icon: string; section: "main" | "more" }[] = [
  { view: "overview", label: "Tableau de bord", icon: "grid", section: "main" },
  { view: "requests", label: "Interventions", icon: "wrench", section: "main" },
  { view: "sites", label: "Sites & contrats", icon: "building", section: "main" },
  { view: "approvals", label: "Devis & approbations", icon: "receipt", section: "main" },
  { view: "invoices", label: "Facturation", icon: "euro", section: "main" },
  { view: "reports", label: "Rapports", icon: "chart", section: "main" },
  { view: "messages", label: "Messages", icon: "message", section: "main" },
  { view: "documents", label: "Documents", icon: "document", section: "more" },
  { view: "members", label: "Membres", icon: "users", section: "more" },
  { view: "support", label: "Assistance", icon: "shield", section: "more" },
  { view: "profile", label: "Profil", icon: "person", section: "more" },
];
const NAV_PARENT: Partial<Record<View, View>> = {
  detail: "requests",
  quote: "requests",
  new: "requests",
  site: "sites",
  contracts: "sites",
  approval: "approvals",
};

// ---- Helpers purs ----------------------------------------------------------------------
const cx = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(" ");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const byDateDesc = <T extends { created_at: string }>(rows: T[]) =>
  [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
const fullAddress = (i: Intervention) =>
  [i.address, [i.postal_code, i.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
const percent = (value: number) => `${value.toFixed(1).replace(".", ",")} %`;
const approvalMeta = (status: string) =>
  APPROVAL_META[status] || { label: status, tone: "amber" as const };
const paymentMeta = (status: string) =>
  PAYMENT_META[status] || { label: status, tone: "amber" as const };
const urgencyTag = (i: Intervention) =>
  i.urgency === "urgent" ? <Tag tone="amber">Urgent</Tag> : <Tag>Planifiée</Tag>;

type Scope = {
  sites: Site[];
  interventions: Intervention[];
  quotes: Quote[];
  payments: Payment[];
  approvals: Approval[];
  compliance: ComplianceRecord[];
  documents: StoredDocument[];
  rules: ApprovalRule[];
};
function buildScope(
  sites: Site[],
  interventions: Intervention[],
  data: Workspace,
  professional: ProfessionalData,
): Scope {
  const siteIds = new Set(sites.map((s) => s.id));
  const ids = new Set(interventions.map((i) => i.id));
  const quotes = data.quotes.filter((q) => ids.has(q.intervention_id));
  const quoteIds = new Set(quotes.map((q) => q.id));
  return {
    sites,
    interventions,
    quotes,
    payments: data.payments.filter((p) => quoteIds.has(p.quote_id)),
    approvals: professional.approvals.filter((a) =>
      a.site_id ? siteIds.has(a.site_id) : quoteIds.has(a.quote_id),
    ),
    compliance: professional.compliance_records.filter((r) => siteIds.has(r.site_id)),
    documents: data.documents.filter((d) => d.intervention_id && ids.has(d.intervention_id)),
    rules: professional.approval_rules.filter((r) => siteIds.has(r.site_id)),
  };
}
// Chiffres d’un site : devis acceptés (engagé), règlements confirmés, dossiers ouverts.
function siteFigures(site: Site, data: Workspace) {
  const mine = data.interventions.filter((i) => i.site_id === site.id);
  const ids = new Set(mine.map((i) => i.id));
  const accepted = data.quotes.filter(
    (q) => ids.has(q.intervention_id) && q.status === "accepted",
  );
  const acceptedIds = new Set(accepted.map((q) => q.id));
  // Commitment = base + accepted amendments (server accepted_total_cents), like the real payments.
  const committed = sum(accepted.map((q) => acceptedCommittedCents(q)));
  const paidRows = data.payments.filter((p) => acceptedIds.has(p.quote_id) && p.status === "paid");
  const paid = sum(paidRows.map((p) => p.total_cents));
  // Part of « Réglé » that is a receipt DECLARED on site by the artisan (not a bank confirmation).
  const declared = sum(paidRows.filter((p) => isDeclaredOnSite(p)).map((p) => p.total_cents));
  const budget = site.budget_cents || 0;
  // `ratio` est le taux réel (peut dépasser 100), `width` la seule valeur plafonnée (barre).
  const { ratio, width, over } = budgetFigures(committed, budget);
  return {
    budget,
    committed,
    paid,
    declared,
    remaining: budget - committed,
    ratio,
    width,
    over,
    count: mine.length,
    open: mine.filter((i) => OPEN_STATUSES.includes(i.status)).length,
  };
}

type Ctx = {
  session: Session;
  demo: boolean;
  organization: Organization | null;
  activeSite: Site | null;
  /** Sites de l’organisation active (tous, quel que soit le site filtré). */
  orgSites: Site[];
  /** Dossiers de l’organisation active (accès aux fiches, indépendamment du filtre site). */
  orgInterventions: Intervention[];
  /** Périmètre affiché : organisation + site éventuellement filtré. */
  scope: Scope;
  /** Portées de sites des membres : undefined = chargement, null = indisponible. */
  siteAccess: SiteAccessOverview | null | undefined;
  /** Pouvoir d’écriture : rôle de membre ET portée de sites du membre courant (jamais le rôle seul). */
  authority: EnterpriseAuthority;
  /** Au moins un site où une demande peut être créée (ou écriture sur toute l’organisation). */
  canCreateRequest: boolean;
  reloadSiteAccess: () => void;
  go: (view: View, param?: string) => void;
};

// ---- Composant principal --------------------------------------------------------------
export function EnterpriseSpace({ session }: { session: Session }) {
  const { data, professional, view, param } = session;
  const demo = session.mode === "demo";
  const ctx = enterpriseContext(
    data.organizations,
    data.sites,
    data.interventions,
    session.activeOrganizationId,
    session.activeSiteId,
  );
  const orgCtx = enterpriseContext(
    data.organizations,
    data.sites,
    data.interventions,
    session.activeOrganizationId,
    "",
  );
  const organization = data.organizations.find((o) => o.id === ctx.organizationId) || null;
  const activeSite = ctx.sites.find((s) => s.id === ctx.siteId) || null;
  const scope = useMemo(
    () => buildScope(activeSite ? [activeSite] : ctx.sites, ctx.interventions, data, professional),
    // ctx.* dérivent de data/professional/active ids ; la dépendance directe suffit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, professional, ctx.organizationId, ctx.siteId],
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [siteAccess, setSiteAccess] = useState<SiteAccessOverview | null | undefined>(undefined);
  const [accessKey, setAccessKey] = useState(0);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null);
  const restoreMenuFocus = useRef(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const navId = useId();
  const helpId = useId();

  // Mobile layout: the off-canvas sidebar is inert while closed, the rest of the page while open.
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        restoreMenuFocus.current = true;
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    sidebarRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen || !restoreMenuFocus.current) return;
    restoreMenuFocus.current = false;
    menuButton.current?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !menuOpen) {
        setHelpOpen(false);
        helpButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, menuOpen]);

  useEffect(() => {
    if (!ctx.organizationId) {
      setSiteAccess(undefined);
      return;
    }
    let active = true;
    setSiteAccess(undefined);
    void session.loadSiteAccess(ctx.organizationId).then((result) => {
      if (active) setSiteAccess(result);
    });
    return () => {
      active = false;
    };
    // Recharge à chaque changement d’organisation, sur demande explicite (membres) ou après
    // une relecture du workspace (focus/visibilité).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.organizationId, accessKey, session.refreshedAt]);

  // Autorité d’écriture recalculée à chaque changement de rôle ou de portée (les deux sont relus
  // sur session.refreshedAt). Portée inconnue (chargement/indisponible) → null : le helper ferme
  // l’écriture pour owner excepté, les contrôles restent en lecture jusqu’au chargement.
  const ownScope = useMemo<MemberScope | null>(() => {
    const me = siteAccess?.members.find((m) => m.user_id === session.profileId);
    return me ? { scope: me.scope, grants: me.grants } : null;
  }, [siteAccess, session.profileId]);
  const authority = useMemo(
    () => enterpriseAuthority(session.membershipRole, ownScope),
    [session.membershipRole, ownScope],
  );
  const canCreateRequest =
    authority.canWriteOrganization || orgCtx.sites.some((s) => authority.canWriteSite(s.id));

  const closeMenu = () => {
    restoreMenuFocus.current = true;
    setMenuOpen(false);
  };
  const closeHelp = () => {
    setHelpOpen(false);
    helpButton.current?.focus();
  };
  const go = (next: View, nextParam?: string) => {
    setMenuOpen(false);
    session.go(next, nextParam);
  };
  const c: Ctx = {
    session,
    demo,
    organization,
    activeSite,
    orgSites: orgCtx.sites,
    orgInterventions: orgCtx.interventions,
    scope,
    siteAccess,
    authority,
    canCreateRequest,
    reloadSiteAccess: () => setAccessKey((k) => k + 1),
    go,
  };

  const pendingApprovals = scope.approvals.filter((a) => a.status === "pending").length;
  const scopedIds = new Set(scope.interventions.map((i) => i.id));
  const receivedMessages = data.messages.filter(
    (m) => scopedIds.has(m.intervention_id) && m.author_id !== session.profileId,
  ).length;
  const activeNav = NAV_PARENT[view] || view;

  function renderView(): ReactNode {
    if (session.loading) return <Loader label="Chargement de votre espace…" />;
    if (ctx.needsChoice) return <OrganizationChoice c={c} organizations={data.organizations} />;
    const body = (() => {
      switch (view) {
        case "overview":
          return (
            <>
              <OverviewView c={c} />
              {/* ART-12: shown only when the server returns a team invitation or membership for this account. */}
              <ProviderTeamsPanel key={`teams|${c.session.mutationContext.userId() ?? "-"}|${c.session.mutationContext.generation()}`} audience="member" context={c.session.mutationContext} demo={c.session.mode === "demo"} />
            </>
          );
        case "requests":
          return <RequestsView c={c} />;
        case "new":
          // #new/<site UUID> pre-selects a site (unchanged); #new/<category> (service page CTA)
          // pre-selects the category only — never a site, authority or right.
          return isRequestCategory(param) ? (
            <NewRequestView key={param} c={c} siteId="" initialCategory={param} />
          ) : (
            <NewRequestView key={param} c={c} siteId={param} />
          );
        case "detail":
          return (
            <DossierView
              key={`${param || session.selectedId}-${session.selectedQuoteId}`}
              c={c}
              id={param || session.selectedId}
            />
          );
        case "quote":
          return <EnterpriseQuoteRoute key={param || session.selectedId} c={c} ref_={param || session.selectedId} />;
        case "sites":
          return <SitesView c={c} />;
        case "site":
          return <SiteSheet key={param} c={c} id={param} />;
        case "approvals":
          return <ApprovalsView c={c} />;
        case "approval":
          return <ApprovalDetail key={param} c={c} id={param} />;
        case "contracts":
          return <ContractsView c={c} />;
        case "reports":
          return <ReportsView c={c} />;
        case "invoices":
          return <InvoicesView c={c} />;
        case "members":
          return <MembersView c={c} />;
        case "messages":
          return <MessagesView c={c} />;
        case "notifications":
          return (
            <NotificationsPage
              session={session}
              organizationId={c.organization?.id}
              siteId={c.activeSite?.id}
            />
          );
        case "platform-operators":
        case "platform-finance":
        case "platform-moderation":
        case "platform-audit":
        case "support-queue":
      case "support-queue":
          return <PlatformPage session={session} view={view} />;
        case "documents":
          return <DocumentsView c={c} />;
        case "profile":
          return <ProfileView c={c} />;
        case "support":
          return <SupportCenter session={session} interventions={c.orgInterventions} backView="overview" />;
        case "help":
          return (
            <>
              <PageTitle title="Aide" subtitle="Repères pour piloter vos sites dans cet espace." />
              <HelpContent onSupport={() => go("support")} />
            </>
          );
        default:
          return <Forbidden onHome={() => go("overview")} />;
      }
    })();
    return (
      <>
        <ContextBar c={c} organizations={data.organizations} sites={ctx.sites} siteId={ctx.siteId} />
        {body}
      </>
    );
  }

  return (
    <ThemeSurface className={theme.enterpriseSkin}>
    <div className={styles.shell}>
      <header className={styles.topbar} inert={isNarrow && menuOpen}>
        <button
          ref={menuButton}
          type="button"
          className={styles.menuButton}
          aria-expanded={menuOpen}
          aria-controls={navId}
          aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
          onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
        >
          <Icon name={menuOpen ? "close" : "menu"} />
        </button>
        <button type="button" className={styles.brandButton} onClick={() => go("overview")}>
          <Brand compact />
          <span className={styles.brandSub}>Portail entreprise</span>
        </button>
        <div className={styles.topbarActions}>

          <span className={styles.topbarBell}>
            <HeaderBell session={session} />
          </span>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={
              receivedMessages
                ? `Messages, ${receivedMessages} reçus sur le périmètre`
                : "Messages"
            }
            title="Messages"
            onClick={() => go("messages")}
          >
            <Icon name="message" />
            {receivedMessages > 0 && (
              <span className={styles.iconCount} aria-hidden="true">
                {receivedMessages}
              </span>
            )}
          </button>
          <button
            ref={helpButton}
            type="button"
            className={cx(styles.iconButton, helpOpen && styles.iconButtonActive)}
            aria-expanded={helpOpen}
            aria-controls={helpId}
            aria-label="Aide"
            title="Aide"
            onClick={() => setHelpOpen((o) => !o)}
          >
            <Icon name="help" />
          </button>
          <button
            type="button"
            className={styles.account}
            onClick={() => go("profile")}
            aria-label={`Compte : ${session.displayName}, ${organization?.name || "aucune organisation active"}`}
          >
            <span className={styles.accountAvatar} aria-hidden="true">
              {initials(session.displayName) || "?"}
            </span>
            <span className={styles.accountText}>
              <strong>{session.displayName}</strong>
              <small>{organization?.name || "Aucune organisation active"}</small>
            </span>
          </button>
        </div>
      </header>

      {demo && <DemoBanner session={session} inert={isNarrow && menuOpen} />}

      <div className={styles.body}>
        {menuOpen && (
          <button
            type="button"
            className={styles.overlay}
            aria-label="Fermer le menu"
            tabIndex={-1}
            onClick={closeMenu}
          />
        )}
        <aside
          ref={sidebarRef}
          id={navId}
          className={cx(styles.sidebar, menuOpen && styles.sidebarOpen)}
          inert={isNarrow && !menuOpen}
        >
          <button type="button" className={styles.sidebarClose} aria-label="Fermer le menu" onClick={closeMenu}>
            <Icon name="close" />
          </button>
          <nav aria-label="Navigation de l’espace entreprise" className={styles.nav}>
            {NAV.filter((n) => n.section === "main").map((n) => (
              <NavButton key={n.view} item={n} active={activeNav === n.view} onClick={() => go(n.view)}
                count={n.view === "approvals" ? pendingApprovals : 0} />
            ))}
            <span className={styles.navDivider} role="separator" />
            {NAV.filter((n) => n.section === "more").map((n) => (
              <NavButton key={n.view} item={n} active={activeNav === n.view} onClick={() => go(n.view)} />
            ))}
            {platformEntries(session.platformAccess, (v) => canAccess(v, session.role, session.mode)).map((n, k) => (
              <Fragment key={n.view}>
                {k === 0 && <span className={styles.navDivider} role="separator" />}
                <NavButton item={{ ...n, section: "more" }} active={activeNav === n.view} onClick={() => go(n.view)} />
              </Fragment>
            ))}
          </nav>
          <div className={styles.sidebarBottom}>
            <button type="button" className={styles.sidebarHelp} onClick={() => go("support")}>
              <Icon name="help" size={20} />
              <span>
                <strong>Besoin d’aide ?</strong>
                Ouvrir une demande d’assistance
              </span>
              <Icon name="arrow" size={16} />
            </button>
            <button type="button" className={styles.navItem} onClick={() => void session.logout()}>
              <Icon name="logout" />
              Se déconnecter
            </button>
          </div>
        </aside>

        <main id="main" className={`${styles.main} ${floatingNav.reserve}`} inert={isNarrow && menuOpen}>
          <Alerts
            error={session.error}
            notice={session.notice}
            onClearError={() => session.setError("")}
            onClearNotice={() => session.setNotice("")}
          />
          {helpOpen && (
            <section id={helpId} className={styles.helpPanel} aria-label="Aide de l’espace entreprise">
              <button type="button" className={styles.helpClose} aria-label="Fermer l’aide" onClick={closeHelp}>
                <Icon name="close" size={18} />
              </button>
              <h2>Comment utiliser cet espace</h2>
              <HelpContent onSupport={() => go("support")} />
            </section>
          )}
          {renderView()}
        </main>
      </div>
    </div>
      <nav className={floatingNav.nav} aria-label="Navigation rapide entreprise" inert={isNarrow && menuOpen}>
        <button type="button" onClick={() => go("overview")} aria-current={view === "overview" ? "page" : undefined}><Icon name="grid" size={20} />Accueil</button>
        <button type="button" onClick={() => go("requests")} aria-current={view === "requests" ? "page" : undefined}><Icon name="wrench" size={20} />Dossiers</button>
        <button type="button" onClick={() => go("sites")} aria-current={view === "sites" ? "page" : undefined}><Icon name="building" size={20} />Sites</button>
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu complet"><Icon name="menu" size={20} />Menu</button>
      </nav>
    </ThemeSurface>
  );
}

function NavButton({
  item,
  active,
  count = 0,
  onClick,
}: {
  item: (typeof NAV)[number];
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cx(styles.navItem, active && styles.navItemActive)}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <Icon name={item.icon} />
      {item.label}
      {count > 0 && (
        <span className={styles.navCount}>
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">{`${count} en attente d’approbation`}</span>
        </span>
      )}
    </button>
  );
}

function HelpContent({ onSupport }: { onSupport: () => void }) {
  return (
    <>
    <ul>
      <li>Choisissez l’organisation puis, si besoin, un site : toutes les listes, indicateurs et exports suivent ce périmètre.</li>
      <li>Les indicateurs sont calculés sur les dossiers chargés (100 derniers) ; le rapport CSV du serveur fait foi.</li>
      <li>Un devis soumis à une règle d’approbation doit être approuvé depuis « Devis & approbations » avant d’être accepté.</li>
      <li>Le règlement sur la plateforme est réservé au demandeur du dossier ou au membre que le propriétaire de l’organisation désigne explicitement comme payeur de ce dossier.</li>
      <li>Les fonctions absentes (factures, invitations, équipements, SLA…) sont signalées avec leur bloqueur plutôt que simulées.</li>
    </ul>
    <p className={styles.description} style={{ marginTop: 12 }}>
      Une question que ces repères ne couvrent pas ? Écrivez à l’équipe de la plateforme : les réponses
      apparaissent dans cet espace, sans appel ni email, et aucun délai n’est garanti.
    </p>
    <div className={styles.actions}>
      <button type="button" className="button outline" onClick={onSupport}>
        <Icon name="shield" size={17} />
        Ouvrir l’assistance
      </button>
    </div>
    </>
  );
}

/** Remplace un contrôle d’écriture masqué : la raison est toujours affichée en texte. */
function ReadOnlyNote({ reason, compact = false }: { reason: string | null; compact?: boolean }) {
  return (
    <p className={cx(styles.readOnly, compact && styles.readOnlyCompact)}>
      <Icon name="lock" size={15} />
      <span>{reason || "Vos droits ne permettent pas cette action sur ce périmètre."}</span>
    </p>
  );
}

// ---- Contexte organisation / site -------------------------------------------------------
function OrganizationChoice({ c, organizations }: { c: Ctx; organizations: Organization[] }) {
  return (
    <section className={cx("panel", styles.choicePanel)} aria-labelledby="org-choice-title">
      <h1 id="org-choice-title">Choisissez l’organisation à piloter</h1>
      <p>
        Vous êtes membre de plusieurs organisations. Aucune donnée n’est affichée tant que
        l’organisation active n’est pas choisie explicitement.
      </p>
      <div className={styles.choiceList}>
        {organizations.map((o) => (
          <button
            key={o.id}
            type="button"
            className={styles.choiceButton}
            onClick={() => c.session.setActiveOrganization(o.id)}
          >
            <Icon name="building" size={22} />
            <span>
              <strong>{o.name}</strong>
              <small>{(o.type && SITE_TYPES[o.type]) || "Organisation cliente"}</small>
            </span>
            <Icon name="arrow" size={17} />
          </button>
        ))}
      </div>
    </section>
  );
}

function ContextBar({
  c,
  organizations,
  sites,
  siteId,
}: {
  c: Ctx;
  organizations: Organization[];
  sites: Site[];
  siteId: string;
}) {
  const orgId = useId();
  const siteSelectId = useId();
  const ownAccess =
    c.session.membershipRole && c.session.membershipRole !== "owner"
      ? c.siteAccess?.members.find((m) => m.user_id === c.session.profileId)
      : undefined;
  return (
    <div className={styles.contextBar} role="group" aria-label="Périmètre actif">
      <div className={styles.contextNames}>
        <Icon name="building" size={18} />
        <span>
          Organisation active : <strong>{c.organization?.name || "aucune"}</strong> · Site :{" "}
          <strong>{c.activeSite ? c.activeSite.name : "Tous les sites"}</strong>
          {ownAccess && (
            <>
              {" · "}Votre accès : <strong>{scopeText(ownAccess, c.orgSites)}</strong>
            </>
          )}
        </span>
      </div>
      <div className={styles.contextControls}>
        {organizations.length > 1 && (
          <label htmlFor={orgId}>
            Organisation
            <select
              id={orgId}
              value={c.organization?.id || ""}
              onChange={(e) => c.session.setActiveOrganization(e.target.value)}
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor={siteSelectId}>
          Site
          <select
            id={siteSelectId}
            value={siteId}
            onChange={(e) => c.session.setActiveSite(e.target.value)}
            disabled={!sites.length}
          >
            <option value="">Tous les sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

// ---- Tableau d’interventions (M4 structure, M66 lignes) -----------------------------------
const timeOf = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));

type InterventionList = ReturnType<typeof useInterventionList>;
/** One table row, from the cached workspace (demo) or from the server search DTO (live). */
type ListRow = Pick<Intervention, "id" | "category" | "address" | "postal_code" | "city" | "urgency" | "status" | "created_at"> & { siteLabel: string; assigned: boolean };
function useInterventionList(c: Ctx) {
  const { scope } = c;
  const [filters, setFilters] = useState<InterventionFilters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  // Périmètre global vu au dernier rendu : un changement d’organisation ou de site global
  // invalide le filtre local de site (sélecteur masqué) et ramène à la première page.
  const context: ListContext = { organizationId: c.organization?.id || "", siteId: c.activeSite?.id || "" };
  const [seen, setSeen] = useState(context);
  const reconciled = reconcileFilters(
    filters,
    seen,
    context,
    scope.sites.map((s) => s.id),
  );
  if (seen.organizationId !== context.organizationId || seen.siteId !== context.siteId) setSeen(context);
  if (reconciled.reset) {
    if (reconciled.filters !== filters) setFilters(reconciled.filters);
    if (page !== 1) setPage(1);
  }
  const siteName = (id?: string | null) => scope.sites.find((s) => s.id === id)?.name || "";
  // Le prédicat effectif ne croise jamais un site local avec un périmètre incompatible.
  const effective = reconciled.filters;
  // Live : recherche serveur sur tout le périmètre (pas seulement les 100 dossiers chargés). Démo :
  // liste locale inchangée, aucun appel. Le site global (ou, à défaut, le filtre de site) donne site_id.
  const live = !c.demo;
  const serverFilters: EnterpriseSearchFilters | null = c.organization
    ? {
        organization_id: c.organization.id,
        site_id: c.activeSite?.id || effective.site || null,
        category: (effective.type || null) as EnterpriseSearchFilters["category"],
        status: (effective.status || null) as EnterpriseSearchFilters["status"],
        search: effective.search,
        sort: effective.sort,
      }
    : null;
  const remote = useEnterpriseSearch({ enabled: live, context: c.session.mutationContext, filters: serverFilters, page: reconciled.reset ? 1 : page });
  const local = filterInterventions(scope.interventions, effective, (i) =>
    [siteName(i.site_id), i.description, shortId(i.id), fullAddress(i), category(i.category).label].join(" "),
  );
  const toRow = (i: Intervention): ListRow => ({ ...i, siteLabel: siteName(i.site_id) || "Hors site", assigned: Boolean(i.artisan_id) });
  const localPages = Math.max(1, Math.ceil(local.length / PAGE_SIZE));
  const localCurrent = Math.min(reconciled.reset ? 1 : page, localPages);
  const set = <K extends keyof InterventionFilters>(key: K, value: InterventionFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const reset = () => {
    setFilters((f) => ({ ...NO_FILTERS, sort: f.sort }));
    setPage(1);
  };
  if (live) {
    const r = remote.state;
    return {
      live,
      filters: effective,
      total: r.total,
      pageRows: r.items.map((i): ListRow => ({ ...i, siteLabel: i.site_name, assigned: i.artisan_assigned })),
      current: r.page,
      pages: r.pages,
      filtered: isFiltered(effective),
      phase: r.phase,
      error: r.error,
      retry: remote.retry,
      refresh: remote.refresh,
      footNote: ENTERPRISE_SEARCH_COPY.serverNote,
      exportBusy: r.exporting,
      exportNotice: r.exportNotice,
      exportError: r.exportError,
      setPage,
      set,
      reset,
      exportCsv: () => void remote.exportCsv(),
    };
  }
  return {
    live,
    filters: effective,
    total: local.length,
    pageRows: local.slice((localCurrent - 1) * PAGE_SIZE, localCurrent * PAGE_SIZE).map(toRow),
    current: localCurrent,
    pages: localPages,
    filtered: isFiltered(effective),
    phase: "ready" as const,
    error: "",
    retry: () => {},
    refresh: () => false,
    footNote: LOADED_NOTE.toLowerCase(),
    exportBusy: false,
    exportNotice: "",
    exportError: "",
    setPage,
    set,
    reset,
    exportCsv: () => {
      download(
        "interventions.csv",
        csv([
          ["Référence", "Site", "Type", "Statut", "Adresse", "Estimation min (EUR)", "Estimation max (EUR)", "Date"],
          ...local.map((i) => [
            shortId(i.id),
            siteName(i.site_id) || "Hors site",
            category(i.category).label,
            STATUS[i.status],
            fullAddress(i),
            (i.estimate_min_cents / 100).toFixed(2),
            (i.estimate_max_cents / 100).toFixed(2),
            dateTime(i.created_at),
          ]),
        ]),
        "text/csv;charset=utf-8",
      );
    },
  };
}

// Keep wide operational tables reachable without widening the page. Mobile rows
// already reflow as cards; only overflowing tables add a keyboard scroll stop.
function ScrollableTable({ label, children }: { label: string; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const table = element.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      {overflowing && <p className={styles.tableScrollHint}>Faites défiler le tableau horizontalement pour voir toutes les colonnes.</p>}
      <div ref={viewport} className={styles.tableViewport} role={overflowing ? "region" : undefined}
        aria-label={overflowing ? label : undefined} tabIndex={overflowing ? 0 : undefined}>
        {children}
      </div>
    </>
  );
}

function ExportButton({ list }: { list: InterventionList }) {
  return (
    <span data-enterprise-export="" style={{ display: "contents" }}>
      <button type="button" className="button outline" onClick={list.exportCsv} disabled={!list.total || list.exportBusy || list.phase !== "ready"}>
        <Icon name="download" size={17} />
        {list.exportBusy ? ENTERPRISE_SEARCH_COPY.exporting : "Exporter"}
      </button>
      <ExportFeedback notice={list.exportNotice} error={list.exportError} />
    </span>
  );
}

// Carte de filtres séparée, au-dessus du tableau (M4) ; recherche reprise de M66.
function InterventionFiltersCard({ c, list }: { c: Ctx; list: InterventionList }) {
  const { filters: f, set } = list;
  return (
    <div className={cx("panel", styles.filtersCard)} role="search" aria-label="Filtres des interventions">
      {!c.activeSite && (
        <label className={styles.filterField}>
          Site
          <select value={f.site} onChange={(e) => set("site", e.target.value)}>
            <option value="">Tous les sites</option>
            {c.scope.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={styles.filterField}>
        Type d’intervention
        <select value={f.type} onChange={(e) => set("type", e.target.value)}>
          <option value="">Tous les types</option>
          {CATEGORIES.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.label}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.filterField}>
        Statut
        <select value={f.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">Tous les statuts</option>
          {(Object.keys(STATUS) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className={cx(styles.filterField, styles.filterSearch)}>
        Recherche
        <span className={styles.searchInput}>
          <Icon name="search" size={16} />
          <input
            type="search"
            value={f.search}
            maxLength={120}
            placeholder="Site, référence, adresse…"
            onChange={(e) => set("search", e.target.value)}
          />
        </span>
      </label>
      <button type="button" className={styles.resetButton} onClick={list.reset} disabled={!list.filtered}>
        <Icon name="refresh" size={16} />
        Réinitialiser
      </button>
    </div>
  );
}

function InterventionsTable({
  c,
  list,
  title,
  emptyAction,
  refreshable = false,
}: {
  c: Ctx;
  list: InterventionList;
  title: string;
  emptyAction?: ReactNode;
  /** Interventions page only: one « Actualiser » re-reading the same key (live). */
  refreshable?: boolean;
}) {
  const { total, pageRows, current, pages, filtered } = list;
  const headingId = useId();
  const count = `${total} intervention${total > 1 ? "s" : ""}`;
  return (
    <section className={cx("panel", styles.tablePanel)} aria-labelledby={headingId} aria-busy={list.phase === "loading" || undefined} data-enterprise-list={list.live ? list.phase : "demo"}>
      <div className={styles.tableHead}>
        <h2 id={headingId}>
          {count}
          {filtered ? " après filtres" : ""}
          <span className="sr-only"> — {title}</span>
        </h2>
        {refreshable && list.live && (
          <button type="button" className="button outline" disabled={list.phase === "loading"} onClick={() => list.refresh()} data-enterprise-list-refresh="">
            <Icon name="refresh" size={16} />
            Actualiser
          </button>
        )}
        <label className={styles.sortField}>
          Trier par :
          <select
            value={list.filters.sort}
            onChange={(e) => list.set("sort", e.target.value as InterventionFilters["sort"])}
          >
            <option value="recent">Date de création (récent)</option>
            <option value="oldest">Date de création (ancien)</option>
          </select>
        </label>
      </div>
      {list.phase === "loading" || list.phase === "idle" ? (
        <p className={styles.muted} role="status">{ENTERPRISE_SEARCH_COPY.loading}</p>
      ) : list.phase === "error" || list.phase === "forbidden" ? (
        <div role="alert" data-enterprise-list-error="">
          <p>{list.error}</p>
          {list.phase === "error" && (
            <button type="button" className="button outline" onClick={() => list.retry()}>
              Réessayer
            </button>
          )}
        </div>
      ) : total === 0 ? (
        <Empty
          icon="wrench"
          title={filtered ? "Aucun dossier ne correspond aux filtres" : "Aucune intervention sur ce périmètre"}
          action={
            filtered ? (
              <button type="button" className="button outline" onClick={list.reset}>
                Réinitialiser les filtres
              </button>
            ) : (
              emptyAction
            )
          }
        >
          {filtered
            ? "Élargissez la recherche ou changez de site."
            : "Les demandes créées depuis vos sites apparaîtront ici."}
        </Empty>
      ) : (
        <>
          <ScrollableTable label="Interventions — tableau à défilement horizontal">
            <table className={cx(styles.table, styles.interventionsTable)}>
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  <th scope="col">Site</th>
                  <th scope="col">Type</th>
                  <th scope="col">Artisan</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Date</th>
                  <th scope="col">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((i) => (
                  <tr key={i.id}>
                    <td className={styles.cellSite}>
                      <button
                        type="button"
                        className={styles.rowOpen}
                        onClick={() => c.session.openIntervention(i.id)}
                      >
                        <Icon name="building" size={22} />
                        <span>
                          <strong>{i.siteLabel}</strong>
                          <small>{[i.address, [i.postal_code, i.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</small>
                        </span>
                      </button>
                    </td>
                    <td className={styles.cellType}>
                      <span>{category(i.category).label}</span>
                      {i.urgency === "urgent" ? <Tag tone="amber">Urgent</Tag> : <Tag>Planifiée</Tag>}
                    </td>
                    <td className={styles.cellArtisan}>
                      {i.assigned ? "Artisan attribué" : <span className={styles.muted}>Recherche en cours</span>}
                    </td>
                    <td className={styles.cellStatus}>
                      <Badge status={i.status} />
                    </td>
                    <td className={styles.cellDate}>
                      <time dateTime={i.created_at}>
                        {date(i.created_at)}
                        <small>{timeOf(i.created_at)}</small>
                      </time>
                    </td>
                    <td className={styles.cellAction}>
                      <button
                        type="button"
                        className={styles.rowMore}
                        onClick={() => c.session.openIntervention(i.id)}
                        aria-label={`Ouvrir le dossier ${shortId(i.id)}`}
                        title="Ouvrir le dossier"
                      >
                        <Icon name="arrow" size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
          <div className={styles.tableFoot}>
            <span>
              {count} · {list.footNote}
            </span>
            {pages > 1 && (
              <nav className={styles.pagination} aria-label="Pagination des interventions">
                <button
                  type="button"
                  className={styles.pageButton}
                  aria-label="Page précédente"
                  disabled={current <= 1}
                  onClick={() => list.setPage(current - 1)}
                >
                  <Icon name="back" size={16} />
                </button>
                {pageWindow(current, pages).map((n, k) =>
                  n === null ? (
                    <span key={`gap-${k}`} className={styles.pageGap} aria-hidden="true">
                      …
                    </span>
                  ) : (
                    <button
                      key={n}
                      type="button"
                      className={cx(styles.pageNumber, n === current && styles.pageNumberActive)}
                      aria-current={n === current ? "page" : undefined}
                      aria-label={`Page ${n}`}
                      onClick={() => list.setPage(n)}
                    >
                      {n}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  className={styles.pageButton}
                  aria-label="Page suivante"
                  disabled={current >= pages}
                  onClick={() => list.setPage(current + 1)}
                >
                  <Icon name="arrow" size={16} />
                </button>
              </nav>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ---- Tableau de bord ---------------------------------------------------------------------
/** Exported for tests only (live KPI + refresh wiring). */
export function OverviewView({ c }: { c: Ctx }) {
  const { scope } = c;
  const list = useInterventionList(c);
  // V5-C05 : chiffres réels seulement (ouverts, dont urgentes). Les chiffres qui dépendent des données
  // professionnelles (échéances, approbations, budget) ne sont affichés que lorsque le contrat est
  // réellement chargé ; sinon leur état est dit (vérification / non vérifié), jamais un 0.
  const professionalState = c.session.capabilities.professional;
  const figures = dashboardFigures(professionalState, scope, new Date().toISOString().slice(0, 10), (status) => OPEN_STATUSES.includes(status));
  const open = figures.open;
  // Live : compteurs exacts du serveur pour la carte « Interventions en cours » (périmètre organisation
  // + site global, sans limite des 100 dossiers). Chargement / erreur ne valent jamais zéro. Démo inchangée.
  const counts = useOverviewCounts({ enabled: !c.demo, context: c.session.mutationContext, organizationId: c.organization?.id || null, siteId: c.activeSite?.id || null });
  const openValue = c.demo ? open : counts.state.phase === "ready" ? counts.state.open : counts.state.phase === "loading" ? "…" : "—";
  const urgentCount = c.demo ? figures.urgent : counts.state.urgent;
  const openNote =
    !c.demo && counts.state.phase !== "ready" ? (
      counts.state.phase === "loading" || counts.state.phase === "idle" ? (
        COUNTS_COPY.loading
      ) : (
        <span role="alert" data-overview-counts-error="">
          {counts.state.error}{" "}
          {counts.state.phase === "error" && (
            <button type="button" className="text-button" onClick={() => counts.retry()}>
              Réessayer
            </button>
          )}
        </span>
      )
    ) : urgentCount > 0 ? (
      `dont ${urgentCount} urgente${urgentCount > 1 ? "s" : ""} · hors terminées et annulées`
    ) : (
      "Demandes ouvertes, hors terminées et annulées"
    );
  const loaded = figures.professional === "loaded";
  const placeholder = figures.professional === "loaded" ? "" : FIGURE_PLACEHOLDER[figures.professional];
  // Live : chiffres professionnels exacts du serveur (périmètre organisation + site global, sans limite
  // de dossiers chargés) pour « Devis à approuver », « Échéances à 30 jours », « Budget engagé ».
  // Chargement « … » / erreur « — » + Réessayer, jamais 0 ; démo inchangée ; graphiques inchangés.
  const pro = useProfessionalOverview({ enabled: !c.demo, context: c.session.mutationContext, organizationId: c.organization?.id || null, siteId: c.activeSite?.id || null });
  const proData = !c.demo && pro.state.phase === "ready" ? pro.state.data : null;
  const proPending = pro.state.phase === "loading" || pro.state.phase === "idle" ? "…" : "—";
  // Une seule alerte (et un seul « Réessayer ») sous les indicateurs ; les cartes disent seulement l’état.
  const proState = c.demo || proData ? null : pro.state.phase === "loading" || pro.state.phase === "idle" ? PRO_COPY.loading : PRO_COPY.failed;
  const refreshAll = () => {
    // Même périmètre, mêmes gardes : chaque lecture ne repart que si sa clé est celle affichée.
    list.refresh();
    counts.refresh();
    pro.refresh();
  };
  const siteBars = loaded ? siteBudgetBars(scope.sites, scope.interventions, scope.quotes) : [];
  const pending = byDateDesc(
    scope.approvals.filter((a) => a.status === "pending").map((a) => ({ ...a, created_at: a.created_at || "" })),
  );
  const budget = sum(scope.sites.map((s) => s.budget_cents || 0));
  const deadlines = [...scope.compliance]
    .filter((r) => r.status !== "completed")
    .sort((a, b) => a.due_on.localeCompare(b.due_on))
    .slice(0, 6);
  return (
    <>
      <PageTitle
        title="Tableau de bord"
        subtitle={overviewSubtitle(professionalState, c.organization?.name || "Organisation", LOADED_NOTE)}
        action={
          c.canCreateRequest ? (
            <button type="button" className="button primary" onClick={() => c.go("new")}>
              <Icon name="plus" size={17} />
              Nouvelle demande
            </button>
          ) : (
            <ReadOnlyNote compact reason={c.authority.readOnlyReason} />
          )
        }
      />
      <div className={cx("stats-strip", styles.kpis)} data-professional={figures.professional}>
        <Stat
          icon="wrench"
          label="Interventions en cours"
          value={openValue}
          note={openNote}
        />
        <Stat
          icon="receipt"
          tone="amber"
          label="Devis à approuver"
          value={c.demo ? figures.approvalsPending ?? placeholder : proData ? proData.counts.approvals_pending : proPending}
          note={c.demo ? (loaded ? "Approbations en attente parmi les données chargées" : "Données professionnelles non chiffrables") : proData ? PRO_COPY.approvals : proState}
        />
        <Stat
          icon="calendar"
          tone="violet"
          label="Échéances à 30 jours"
          value={c.demo ? figures.deadlines30 ?? placeholder : proData ? proData.counts.deadlines30 : proPending}
          note={c.demo ? (loaded ? "Contrôles et maintenances enregistrés, non terminés, parmi les données chargées" : "Données professionnelles non chiffrables") : proData ? PRO_COPY.deadlines(proData.window.from, proData.window.to) : proState}
        />
        <Stat
          icon="euro"
          tone="navy"
          label="Budget engagé"
          value={c.demo ? (figures.committedCents === null ? placeholder : money(figures.committedCents)) : proData ? money(proData.amounts.accepted_commitment_cents) : proPending}
          note={
            !c.demo
              ? proData
                ? PRO_COPY.commitment(proData.amounts.reference_budget_cents > 0 ? money(proData.amounts.reference_budget_cents) : null)
                : proState
              : !loaded
                ? "Données professionnelles non chiffrables"
                : budget > 0
                  ? `sur ${money(budget)} de budget de référence · ${BASIS}`
                  : `Aucun budget de référence · ${BASIS}`
          }
        />
        <Stat icon="building" tone="green" label="Sites suivis" value={scope.sites.length} note={c.activeSite ? "Site filtré" : "Organisation active"} />
      </div>
      {!c.demo && (pro.state.phase === "error" || pro.state.phase === "forbidden") && (
        <div role="alert" className={styles.muted} data-professional-overview-error="">
          {pro.state.error}{" "}
          {pro.state.phase === "error" && (
            <button type="button" className="text-button" onClick={() => pro.retry()}>
              Réessayer
            </button>
          )}
        </div>
      )}
      {!c.demo && (
        <button type="button" className="button outline" onClick={refreshAll} data-overview-refresh="">
          <Icon name="refresh" size={16} />
          Actualiser
        </button>
      )}
      <InterventionFiltersCard c={c} list={list} />
      <InterventionsTable
        c={c}
        list={list}
        title="Interventions récentes"
        emptyAction={
          c.canCreateRequest ? (
            <button type="button" className="button primary" onClick={() => c.go("new")}>
              Créer une demande
            </button>
          ) : undefined
        }
      />
      {siteBars.length > 0 && (
        <section className="panel" aria-labelledby="site-budgets-title">
          <div className={styles.panelTitle}>
            <div>
              <h2 id="site-budgets-title">Budget par site</h2>
              <p>Devis acceptés rapportés au budget de référence de chaque site · {BASIS}</p>
            </div>
            <button type="button" className={styles.textLink} onClick={() => c.go("sites")}>
              Sites & contrats
              <Icon name="arrow" size={15} />
            </button>
          </div>
          <ul className={styles.siteBudgets}>
            {siteBars.map((b) => (
              <li key={b.id}>
                <span className={styles.siteBudgetName}>{b.name}</span>
                <div
                  className={cx(styles.budgetBar, b.over && styles.budgetBarOver)}
                  role="img"
                  aria-label={b.ratio === null ? `${b.name} : pas de budget de référence` : `${b.name} : ${percent(b.ratio)} du budget engagé${b.over ? ", budget dépassé" : ""}`}
                >
                  <span style={{ width: `${b.width}%` }} />
                </div>
                <span className={styles.siteBudgetValue}>
                  <strong>{money(b.committed)}</strong>
                  {b.ratio === null ? " · pas de budget de référence" : ` · ${percent(b.ratio)} de ${money(b.budget)}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className={styles.twoCol}>
        <section className="panel" aria-labelledby="pending-approvals-title">
          <div className={styles.panelTitle}>
            <div>
              <h2 id="pending-approvals-title">Approbations en attente</h2>
              <p>Devis dépassant le seuil d’un site</p>
            </div>
            <button type="button" className={styles.textLink} onClick={() => c.go("approvals")}>
              Tout voir
              <Icon name="arrow" size={15} />
            </button>
          </div>
          {pending.length ? (
            pending.slice(0, 5).map((a) => <ApprovalRow key={a.id} c={c} approval={a} />)
          ) : (
            <p className={styles.muted}>Aucun devis n’attend votre décision.</p>
          )}
        </section>
        <section className="panel" aria-labelledby="deadlines-title">
          <div className={styles.panelTitle}>
            <div>
              <h2 id="deadlines-title">Échéances</h2>
              <p>Maintenance, audits et signalements enregistrés</p>
            </div>
            <button type="button" className={styles.textLink} onClick={() => c.go("contracts")}>
              Gérer
              <Icon name="arrow" size={15} />
            </button>
          </div>
          {deadlines.length ? (
            deadlines.map((r) => <ComplianceRow key={r.id} c={c} record={r} />)
          ) : (
            <p className={styles.muted}>Aucune échéance ouverte sur ce périmètre.</p>
          )}
        </section>
      </div>
    </>
  );
}

function ApprovalRow({ c, approval }: { c: Ctx; approval: Approval }) {
  const quote = c.session.data.quotes.find((q) => q.id === approval.quote_id);
  const site = c.orgSites.find((s) => s.id === approval.site_id);
  const meta = approvalMeta(approval.status);
  return (
    <button
      type="button"
      className={cx(styles.listRow, styles.listRowButton)}
      onClick={() => c.go("approval", approval.id)}
    >
      <section>
        <strong>{quote ? money(quote.total_cents) : "Montant non chargé"}</strong>
        <small>
          {site?.name || "Site de l’intervention"} · {quoteRef(approval.quote_id)}
          {approval.created_at ? ` · ${date(approval.created_at)}` : ""}
        </small>
      </section>
      <Tag tone={meta.tone}>{meta.label}</Tag>
      <Icon name="arrow" size={16} />
    </button>
  );
}

/** Server row (live): amount, site and dates come from the approval read itself, never from the cache. */
function ServerApprovalRow({ c, approval }: { c: Ctx; approval: ServerApproval }) {
  const meta = approvalMeta(approval.status);
  return (
    <button type="button" className={cx(styles.listRow, styles.listRowButton)} onClick={() => c.go("approval", approval.id)} data-approval={approval.id}>
      <section>
        <strong>{money(approval.quote.total_cents)}</strong>
        <small>
          {approval.site.name} · {quoteRef(approval.quote_id)} · {date(approval.created_at)}
        </small>
      </section>
      <Tag tone={meta.tone}>{meta.label}</Tag>
      <Icon name="arrow" size={16} />
    </button>
  );
}

function ComplianceRow({ c, record }: { c: Ctx; record: ComplianceRecord }) {
  const site = c.orgSites.find((s) => s.id === record.site_id);
  return (
    <div className={styles.listRow}>
      <section>
        <strong>{record.title}</strong>
        <small>
          {site?.name || "Site"} · {COMPLIANCE_KIND[record.kind] || record.kind} · échéance {date(record.due_on)}
        </small>
      </section>
      <Tag tone={record.status === "completed" ? "green" : "amber"}>
        {COMPLIANCE_STATUS[record.status] || record.status}
      </Tag>
    </div>
  );
}

// ---- Interventions -------------------------------------------------------------------------
/** Exported for tests only (live server search wiring). */
export function RequestsView({ c }: { c: Ctx }) {
  const list = useInterventionList(c);
  return (
    <>
      <PageTitle
        title="Interventions"
        subtitle={`Suivez les demandes de ${c.activeSite ? c.activeSite.name : "tous vos sites"}, de la demande au règlement.`}
        action={
          <div className={styles.titleActions}>
            <ExportButton list={list} />
            {c.canCreateRequest ? (
              <button type="button" className="button primary" onClick={() => c.go("new")}>
                <Icon name="plus" size={17} />
                Nouvelle demande
              </button>
            ) : (
              <ReadOnlyNote compact reason={c.authority.readOnlyReason} />
            )}
          </div>
        }
      />
      <InterventionFiltersCard c={c} list={list} />
      <InterventionsTable
        c={c}
        list={list}
        title="Toutes les interventions"
        refreshable
        emptyAction={
          c.canCreateRequest ? (
            <button type="button" className="button primary" onClick={() => c.go("new")}>
              Créer une demande
            </button>
          ) : undefined
        }
      />
    </>
  );
}

const isRequestCategory = (value: string): value is Category => CATEGORIES.some((cat) => cat.id === value);

const SITE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function NewRequestView({ c, siteId: routeSiteId, initialCategory = "panel" }: { c: Ctx; siteId: string; initialCategory?: Category }) {
  // Without an explicit site in the route, the site chosen in the header is the natural default.
  const siteId = routeSiteId || (c.activeSite && !c.activeSite.archived_at && c.authority.canWriteSite(c.activeSite.id) ? c.activeSite.id : "");
  const site = c.orgSites.find((s) => s.id === siteId) || null;
  // ENT-03: a site id absent from the bootstrap cache ⇒ exact read in the ACTIVE organisation, then the
  // existing form for that site only (live). The normal path below is unchanged.
  if (!site && siteId && SITE_UUID.test(siteId) && c.session.mode !== "demo")
    return (
      <DirectNewRequest
        key={`${c.session.mutationContext.userId() ?? "-"}|${c.session.mutationContext.generation()}|${c.organization?.id ?? "-"}|${siteId}`}
        c={c}
        siteId={siteId}
        initialCategory={initialCategory}
      />
    );
  const writableSites = c.orgSites.filter((s) => !s.archived_at && c.authority.canWriteSite(s.id));
  const allowed = siteId ? writableSites.some((s) => s.id === siteId) : c.canCreateRequest;
  if (!allowed)
    return (
      <>
        <PageTitle
          title="Nouvelle demande"
          subtitle={site ? `Site ${site.name}` : c.organization?.name || "Organisation active"}
          back={{ label: "Retour aux interventions", onClick: () => c.go("requests") }}
        />
        <Unavailable
          title="Création de demande non autorisée sur ce périmètre"
          reason={site?.archived_at ? "Le site est archivé et ne peut plus recevoir de demande." : c.authority.readOnlyReason || "Ce site est indisponible ou vos droits ne permettent pas de créer une demande ici."}
        />
      </>
    );
  return (
    <>
      {site && (
        <p className={styles.note}>
          Demande rattachée au site <strong>{site.name}</strong>. L’adresse est préremplie ; complétez le
          code postal et la ville.
        </p>
      )}
      <RequestForm
        initialCategory={initialCategory}
        initialValues={
          site
            ? {
                category: "panel",
                description: "",
                address: site.address,
                postal_code: "",
                city: "",
                urgency: "scheduled",
                site_id: site.id,
              }
            : // Draft kept across login (service booking flow): prefilled, the manager still picks an
              // authorised site; no organisation or right is derived from it.
              c.session.pendingDraft
                ? { ...c.session.pendingDraft, site_id: undefined }
                : null
        }
        sites={writableSites}
        siteRequired
        mode={c.session.mode}
        busy={c.session.busy}
        onBack={() => c.go("requests")}
        onSubmit={async (values, photos) => {
          await c.session.createIntervention(values, photos);
        }}
        onDemo={() => undefined}
      />
    </>
  );
}

/**
 * ENT-03 — request creation for a site loaded by its exact read (absent from the cache). The form is
 * rendered only after SiteDirectLoader proved the site in the active organisation, for an active site
 * whose settings GET says can_write; reader, archived site or another organisation ⇒ refusal, no form,
 * no POST. The only offered site is that exact site, prefilled with its address. Server unchanged.
 */
function DirectNewRequest({ c, siteId, initialCategory }: { c: Ctx; siteId: string; initialCategory: Category }) {
  const { session } = c;
  const back = (
    <button type="button" className="button outline" onClick={() => c.go("requests")}>
      Retour aux interventions
    </button>
  );
  return (
    <SiteDirectLoader
      siteId={siteId}
      organizationId={c.organization?.id ?? null}
      context={session.mutationContext}
      demo={false}
      back={back}
      render={(site, state) => {
        if (site.archived_at !== null || !state.canWrite)
          return (
            <div data-direct-request="refused">
              <PageTitle
                title="Nouvelle demande"
                subtitle={`Site ${site.name}`}
                back={{ label: "Retour aux interventions", onClick: () => c.go("requests") }}
              />
              <Unavailable
                title="Création de demande non autorisée sur ce périmètre"
                reason={site.archived_at !== null ? "Le site est archivé et ne peut plus recevoir de demande." : c.authority.readOnlyReason || "Vos droits ne permettent pas de créer une demande sur ce site."}
              />
            </div>
          );
        const only: Site = { id: site.id, organization_id: site.organization_id, name: site.name, type: site.type, address: site.address, budget_cents: site.budget_cents, created_at: site.created_at, archived_at: null };
        return (
          <div data-direct-request="form">
            <p className={styles.note}>
              Demande rattachée au site <strong>{site.name}</strong>. L’adresse est préremplie ; complétez le
              code postal et la ville.
            </p>
            <RequestForm
              initialCategory={initialCategory}
              initialValues={{ category: initialCategory, description: "", address: site.address, postal_code: "", city: "", urgency: "scheduled", site_id: site.id }}
              sites={[only]}
              siteRequired
              mode={session.mode}
              busy={session.busy}
              onBack={() => c.go("requests")}
              onSubmit={async (values, photos) => {
                // Only this exact site can be sent (the form offers no other).
                if (values.site_id !== site.id) return;
                await session.createIntervention(values, photos);
              }}
              onDemo={() => undefined}
            />
          </div>
        );
      }}
    />
  );
}

// ---- Dossier (vue gestionnaire) ----------------------------------------------------------
/** Exported for tests only. `initialQuoteId`: the EXACT version asked by a #quote/<id> link (first
 *  render, no session.selectedQuoteId needed). */
export function DossierView({ c, id, initialQuoteId }: { c: Ctx; id: string; initialQuoteId?: string }) {
  const { session, demo } = c;
  const intervention = (demo ? c.orgInterventions : c.scope.interventions).find((i) => i.id === id);
  const [versionId, setVersionId] = useState(initialQuoteId ?? session.selectedQuoteId);
  const [ops, setOps] = useState<Operations | null>(null);
  const [opsLoading, setOpsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  /** ENT-12: server state of the ordered approval of the displayed quote (undefined = not read). */
  // Advanced approval state, kept WITH the quote it was read for: a quote switch never reuses the
  // previous quote's answer (undetermined until the new quote's own validated read).
  const [advancedRead, setAdvancedRead] = useState<{ quoteId: string; status: WorkflowStatus | null } | null>(null);
  const statusKey = intervention?.status || "";
  // Deep link to a dossier absent from the cached perimeter: one causal refresh before « introuvable ».
  // Presence uses the active organisation and site scope, including the direct dossier read.
  // E66 (counter-review): only this enterprise case — the workspace holds the dossier, its site is
  // absent from the truncated site window, and the active scope allows that site ⇒ automatic read.
  const held = demo ? undefined : session.data.interventions.find((i) => i.id === id);
  const siteWindowMayHide =
    !demo && !intervention && !!held?.site_id && session.data.limits?.sites?.limited === true &&
    // Absent from the CACHE (a site known for another organisation is not this case: no GET).
    !!c.organization && !session.data.sites.some((s) => s.id === held.site_id) && (!c.activeSite || c.activeSite.id === held.site_id);
  const presence = useDetailPresence(session, "enterprise-dossier", id, Boolean(intervention), undefined, { siteWindowMayHide });
  useEffect(() => {
    if (!intervention) return;
    let active = true;
    setOpsLoading(true);
    void session.loadOperations(id).then((result) => {
      if (!active) return;
      setOps(result);
      setOpsLoading(false);
    });
    return () => {
      active = false;
    };
    // Recharge sur changement de dossier, de statut ou après une opération.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, statusKey, reloadKey]);

  if (!intervention) {
    if (presence.decision === "loading") return <Loader label="Recherche du dossier…" />;
    if (presence.decision === "detail" || presence.decision === "detail_loading" || presence.decision === "detail_error") {
      const outside = (d: NonNullable<typeof presence.detail>) =>
        !c.organization || d.site.status !== "ok" || d.site.value.organization_id !== c.organization.id ||
        Boolean(c.activeSite && d.intervention.site_id !== c.activeSite.id);
      return (
        <>
          <PointReadState presence={presence} backLabel="Interventions" onBack={() => c.go("requests")} outsideActivePerimeter={outside} />
          {/* PUB-06: warranty follow-up of an authorized out-of-cache paid dossier in the active perimeter. */}
          {presence.decision === "detail" && presence.detail && presence.detail.intervention.status === "paid" && !outside(presence.detail) && (
            <WarrantyPanel
              key={presence.detail.intervention.id}
              interventionId={presence.detail.intervention.id}
              demo={demo}
              role={session.role}
              context={session.mutationContext}
              ownerId={presence.detail.intervention.client_id}
            />
          )}
        </>
      );
    }
    if (presence.decision === "error")
      return (
        <Unavailable
          title="Dossier momentanément indisponible"
          reason="Ce dossier n’a pas pu être vérifié. Vos données n’ont pas été modifiées : réessayez."
          blocker="deeplink:error"
          onRetry={presence.retry}
        />
      );
  }
  if (!intervention)
    return (
      <Empty
        level={1}
        icon="search"
        title={presence.openAnyway ? "Dossier absent des interventions chargées" : "Dossier introuvable sur ce périmètre"}
        action={
          <>
            <button type="button" className="button outline" onClick={() => c.go("requests")}>
              Retour aux interventions
            </button>
            {presence.openAnyway && (
              <button type="button" className="button outline" onClick={presence.openAnyway}>
                Ouvrir quand même
              </button>
            )}
          </>
        }
      >
        {presence.openAnyway
          ? "Ce dossier n’apparaît pas parmi les interventions chargées. Vous pouvez essayer de l’ouvrir directement."
          : "Le dossier n’appartient pas à l’organisation active ou n’est pas parmi les dossiers chargés."}
      </Empty>
    );

  const site = c.orgSites.find((s) => s.id === intervention.site_id) || null;
  const versions = quoteVersions(session.data.quotes, id);
  const displayed = pickQuote(
    session.data.quotes,
    id,
    versionId && versions.some((v) => v.id === versionId) ? versionId : undefined,
  );
  const acceptedQuote = versions.find((q) => q.status === "accepted");
  const approval = displayed
    ? session.professional.approvals.find((a) => a.quote_id === displayed.id)
    : undefined;
  const advanced: WorkflowStatus | null | undefined = displayed && advancedRead?.quoteId === displayed.id ? advancedRead.status : undefined;
  // Advanced policy authoritative when active; simple rule otherwise or without a site; prudent while
  // unknown (live, dossier with a site).
  const acceptance = acceptanceDecision(Boolean(approval && approval.status !== "approved"), advanced, !demo && Boolean(displayed), Boolean(intervention.site_id));
  const blocking = acceptance.blocked;
  const canDecide = displayed?.status === "sent" && intervention.status === "quoted";
  const payment = acceptedQuote
    ? session.data.payments.find((p) => p.quote_id === acceptedQuote.id)
    : undefined;
  const review = session.data.reviews.find((r) => r.intervention_id === id);
  const documents = session.data.documents.filter((d) => d.intervention_id === id);
  const artisan = ops?.participants.find((p) => p.role === "artisan");
  // Chronology derived from what this view already holds (no extra loading).
  const timelineApproval =
    (acceptedQuote && session.professional.approvals.find((a) => a.quote_id === acceptedQuote.id)) || approval || null;
  // ENT-12: when an ordered approval exists for the displayed quote, the timeline shows the server state.
  const advancedApproval = advancedTimelineApproval(advanced);
  const timeline = buildTimeline({
    intervention,
    approval: advancedApproval ?? timelineApproval,
    ruleApplies: c.scope.rules.some((r) => r.site_id === intervention.site_id && r.enabled) || Boolean(advanced?.required),
    appointment: opsLoading || !ops ? undefined : ops.appointment,
    report: opsLoading || !ops ? undefined : ops.report,
    payment: payment ?? null,
  });
  const isPayer = Boolean(intervention.client_id) && session.profileId === intervention.client_id;
  // Actions opérationnelles (devis, créneau, annulation) : écriture sur le site du dossier.
  const canOperate = c.authority.canWriteSite(intervention.site_id);
  const cat = category(intervention.category);

  async function reject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!displayed) return;
    if (reason.trim().length < 5) {
      setReasonError("Indiquez le motif du refus (5 caractères minimum).");
      return;
    }
    setReasonError("");
    const ok = await session.operate(id, {
      action: "reject_quote",
      quote_id: displayed.id,
      reason: reason.trim(),
    });
    if (ok) {
      setRejectOpen(false);
      setReason("");
      setReloadKey((k) => k + 1);
    }
  }

  return (
    <>
      <PageTitle
        title={`${cat.label} · ${shortId(intervention.id)}`}
        subtitle={`${site ? site.name : "Hors site"} · créée le ${dateTime(intervention.created_at)}`}
        back={{ label: "Retour aux interventions", onClick: () => c.go("requests") }}
        action={
          <div className={styles.actions}>
            <Badge status={intervention.status} />
            <button type="button" className="button outline" onClick={() => c.go("messages", intervention.id)}>
              <Icon name="message" size={17} />
              Messages
            </button>
          </div>
        }
      />
      <DossierHelpLink session={session} interventionId={intervention.id} />
      <div className={styles.detailGrid}>
        <div>
          <section className="panel" aria-labelledby="dossier-summary">
            <div className={styles.panelTitle}>
              <h2 id="dossier-summary">Résumé de la demande</h2>
              {urgencyTag(intervention)}
            </div>
            <div className={styles.actions}>
              {site && <Tag tone="blue">{site.name}</Tag>}
              {site?.type && <Tag>{SITE_TYPES[site.type] || site.type}</Tag>}
              <Tag>{cat.label}</Tag>
            </div>
            <p className={styles.description}>{intervention.description}</p>
            <div className={styles.facts}>
              <div>
                <small>Adresse d’intervention</small>
                <strong>{fullAddress(intervention)}</strong>
              </div>
              <div>
                <small>Estimation indicative</small>
                <strong>
                  {money(intervention.estimate_min_cents)} – {money(intervention.estimate_max_cents)}
                </strong>
              </div>
              <div>
                <small>Artisan</small>
                <strong>
                  {artisan
                    ? `${artisan.full_name}${artisan.phone ? ` · ${artisan.phone}` : ""}`
                    : intervention.artisan_id
                      ? "Attribué (coordonnées non chargées)"
                      : "En attente d’attribution"}
                </strong>
              </div>
              <div>
                <small>Déplacement</small>
                <strong>
                  {["accepted", "in_progress"].includes(intervention.status)
                    ? TRAVEL_STAGE[ops?.travel_stage || intervention.travel_stage || "planned"]
                    : "Non concerné à ce stade"}
                </strong>
              </div>
            </div>
          </section>

          <EnterpriseTimeline steps={timeline} cancelled={intervention.status === "cancelled"} />

          {/* ENT-07/08: explicit equipment / zone links of THIS dossier (site-scoped route). */}
          {intervention.site_id && (
            <SiteAssetLinksPanel
              siteId={intervention.site_id}
              interventionId={intervention.id}
              assets={siteAssetSource(session, intervention.site_id)}
              context={session.mutationContext}
              demo={demo}
              readOnly={!canOperate}
            />
          )}

          {["accepted", "in_progress"].includes(intervention.status) && (
            <TrackingAnchor
              session={c.session}
              variant="viewer"
              interventionId={intervention.id}
              authority={
                canOperate
                  ? { canWrite: true }
                  : { canWrite: false, reason: c.authority.readOnlyReason || "Vos droits d’écriture ne couvrent pas le site de ce dossier." }
              }
              organizationId={c.organization?.id}
              siteId={intervention.site_id || undefined}
            />
          )}

          <section className="panel" aria-labelledby="dossier-quote">
            <div className={styles.panelTitle}>
              <div>
                <h2 id="dossier-quote">Devis</h2>
                <p>{versions.length ? `${versions.length} version${versions.length > 1 ? "s" : ""} reçue${versions.length > 1 ? "s" : ""}` : "Aucun devis reçu pour le moment"}</p>
              </div>
              {displayed && (
                <Tag tone={displayed.status === "accepted" ? "green" : displayed.status === "rejected" ? "red" : "blue"}>
                  {displayed.status === "accepted" ? "Accepté" : displayed.status === "rejected" ? "Refusé" : "Envoyé"}
                </Tag>
              )}
            </div>
            {/* ENT-12: ordered internal approval of the EXACT displayed quote (server state; never an acceptance). */}
            {displayed && intervention.site_id && (
              <QuoteApprovalPanel
                key={displayed.id}
                quoteId={displayed.id}
                context={session.mutationContext}
                demo={demo}
                onStatus={(st) => setAdvancedRead({ quoteId: displayed.id, status: st })}
                loadMembers={c.organization ? () => session.loadOrganization(c.organization!.id).then((o) => o?.members.map((m) => ({ id: m.user_id, label: m.full_name || `Membre ${m.user_id.slice(0, 8)}` })) ?? null) : undefined}
              />
            )}
            {/* ENT-13: contract source of the displayed quote (server-stated) and the owner's grid access. */}
            {displayed && <ContractSourceLine key={displayed.id} quoteId={displayed.id} demo={demo} />}
            <QuoteGridAccessPanel interventionId={intervention.id} context={session.mutationContext} demo={demo} />
            {versions.length > 1 && (
              <div className={styles.versions} role="group" aria-label="Versions du devis">
                {versions.map((q, index) => (
                  <button
                    key={q.id}
                    type="button"
                    className={cx(styles.versionButton, displayed?.id === q.id && styles.versionSelected)}
                    aria-pressed={displayed?.id === q.id}
                    onClick={() => {
                      if (displayed?.id === q.id) return;
                      setAdvancedRead(null); // undetermined until the new quote's own read
                      setVersionId(q.id);
                    }}
                  >
                    Version {index + 1} · {quoteRef(q.id)}
                  </button>
                ))}
              </div>
            )}
            {displayed ? (
              <>
                <p className={styles.muted}>
                  {quoteRef(displayed.id)} · reçu le {dateTime(displayed.created_at)}
                </p>
                <div className={styles.lines}>
                  {displayed.lines.map((l, index) => (
                    <div key={index}>
                      <span>
                        {l.label}
                        {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                      </span>
                      <strong>{money(l.quantity * l.unit_price_cents)}</strong>
                    </div>
                  ))}
                </div>
                <div className={styles.totals}>
                  <div>
                    <span>Total HT</span>
                    <span>{money(displayed.subtotal_cents)}</span>
                  </div>
                  <div>
                    <span>TVA {String(displayed.tax_rate).replace(".", ",")} %</span>
                    <span>{money(displayed.tax_cents)}</span>
                  </div>
                  <div>
                    <span>Total TTC</span>
                    <span>{money(displayed.total_cents)}</span>
                  </div>
                </div>
                {approval && (
                  <div className={cx("inline-note")}>
                    <Icon name="shield" />
                    <p>
                      Ce devis dépasse le seuil d’approbation du site : décision{" "}
                      <strong>{approvalMeta(approval.status).label.toLowerCase()}</strong>.{" "}
                      <button type="button" className={styles.textLink} onClick={() => c.go("approval", approval.id)}>
                        Ouvrir l’approbation
                      </button>
                    </p>
                  </div>
                )}
                {canDecide && !blocking && canOperate && (
                  <div className={styles.quoteActions}>
                    <ConfirmAction
                      label="Accepter le devis"
                      message={`Accepter la version ${quoteRef(displayed.id)} pour ${money(displayed.total_cents)} TTC ? L’artisan pourra planifier l’intervention.`}
                      confirmLabel="Confirmer l’acceptation"
                      className="button primary"
                      busy={session.busy}
                      onConfirm={() => session.action(id, "accept_quote", { quote_id: displayed.id })}
                    />
                    {!rejectOpen ? (
                      <button type="button" className="button outline" disabled={session.busy} onClick={() => setRejectOpen(true)}>
                        Refuser ce devis
                      </button>
                    ) : (
                      <form className={styles.rejectForm} onSubmit={reject}>
                        <Field label="Motif du refus (obligatoire)" error={reasonError}>
                          <textarea
                            required
                            minLength={5}
                            maxLength={2000}
                            rows={3}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </Field>
                        <div className={styles.actions}>
                          <button type="submit" className="button destructive-button" disabled={session.busy}>
                            {session.busy ? "Enregistrement…" : "Confirmer le refus"}
                          </button>
                          <button type="button" className="button outline" disabled={session.busy} onClick={() => setRejectOpen(false)}>
                            Annuler
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
                {canDecide && blocking && (
                  <Unavailable
                    title="Acceptation suspendue à l’approbation"
                    reason={
                      acceptance.reason === "advanced"
                        ? "Le circuit d’approbation interne de ce devis n’est pas terminé (voir « Approbation interne du devis » ci-dessus)."
                        : acceptance.reason === "unknown"
                          ? "L’état de l’approbation interne de ce devis n’a pas encore pu être lu : l’acceptation reste suspendue tant qu’il n’est pas connu."
                          : "Le devis affiché doit être approuvé dans « Devis & approbations » avant de pouvoir être accepté."
                    }
                  />
                )}
                {canDecide && !blocking && !canOperate && (
                  <ReadOnlyNote reason={c.authority.readOnlyReason} />
                )}
              </>
            ) : (
              <p className={styles.muted}>Le devis de l’artisan apparaîtra ici dès son envoi.</p>
            )}
          </section>

          <AppointmentPanel
            c={c}
            intervention={intervention}
            canWrite={canOperate}
            ops={ops}
            loading={opsLoading}
            onSaved={() => setReloadKey((k) => k + 1)}
          />

          {ops?.report && (
            <section className="panel" aria-labelledby="dossier-report">
              <h2 id="dossier-report">Compte rendu de l’artisan</h2>
              <p className={styles.description}>{ops.report.summary}</p>
              {ops.report.checks.length > 0 && (
                <ul className={styles.checks}>
                  {ops.report.checks.map((check, index) => (
                    <li key={index}>
                      <span>{check.label}</span>
                      <Tag tone={check.result === "pass" ? "green" : check.result === "issue" ? "amber" : "neutral"}>
                        {check.result === "pass" ? "Conforme" : check.result === "issue" ? "Point à traiter" : "Sans objet"}
                      </Tag>
                    </li>
                  ))}
                </ul>
              )}
              <p className={styles.note}>
                {reportDeclarant(ops.report.signature_name, ops.report.updated_at ? dateTime(ops.report.updated_at) : undefined)}
              </p>
              <ReportEvidenceSummary ops={ops} report={ops.report} photos={dossierPhotos(session.data.documents, intervention.id, intervention.artisan_id)} noteClass={styles.note} declarant={false} receiptVisible={intervention.client_id === session.profileId} openContext={demo ? undefined : session.mutationContext} />
              {/* E60: only the authenticated requester of the dossier, within its writable perimeter. */}
              {!demo && canOperate && canSignReport(ops, intervention.status, intervention.client_id === session.profileId) && (
                <ReportReceiptForm
                  key={`${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${intervention.id}|${ops.report.report_revision}`}
                  scope={`${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${intervention.id}`}
                  revision={ops.report.report_revision}
                  busy={session.busy}
                  onSign={async (values) => {
                    const ok = await session.operate(intervention.id, { action: "sign_report", ...values });
                    setReloadKey((k) => k + 1);
                    return ok;
                  }}
                />
              )}
            </section>
          )}

          {intervention.status === "paid" && (
            <>
              <ReviewForm
                existing={review}
                enabled
                busy={session.busy}
                onSubmit={async (values) => {
                  await session.submitReview(id, values);
                }}
              />
              <WarrantyPanel interventionId={id} demo={demo} role={session.role} context={session.mutationContext} ownerId={intervention.client_id} />
            </>
          )}
          <UploadQueuePanel session={session} interventionId={id} />
        </div>

        <div>
          <section className="panel" aria-labelledby="dossier-payment">
            <h2 id="dossier-payment">Règlement</h2>
            {intervention.status === "paid" ? (
              <>
                <div className={styles.keyValue}>
                  <span>Statut</span>
                  <strong>Réglé{intervention.paid_at ? ` le ${dateTime(intervention.paid_at)}` : ""}</strong>
                </div>
                {payment && (
                  <div className={styles.keyValue}>
                    <span>Montant</span>
                    <strong>{money(payment.total_cents)}</strong>
                  </div>
                )}
              </>
            ) : intervention.status === "completed" && acceptedQuote ? (
              <>
                {acceptedQuote.accepted_total_cents !== undefined ? (
                  <div className={styles.keyValue}>
                    <span>Devis et avenants acceptés (calcul serveur)</span>
                    <strong>{money(acceptedQuote.accepted_total_cents)}</strong>
                  </div>
                ) : (
                  <div className={styles.keyValue}>
                    <span>Devis initial accepté</span>
                    <strong>{money(acceptedQuote.total_cents)}</strong>
                  </div>
                )}
                {payment?.status === "failed" && (
                  <p className={cx("alert error")} role="alert">
                    Le dernier paiement n’a pas abouti selon Stripe. Le règlement reste à effectuer ; vérifiez auprès de votre banque avant de recommencer.
                  </p>
                )}
                {demo ? (
                  <button
                    type="button"
                    className="button primary full"
                    disabled={session.busy}
                    onClick={() => void session.action(id, "simulate_payment")}
                  >
                    {session.busy ? "Enregistrement…" : "Simuler le règlement"}
                  </button>
                ) : isPayer ? (
                  <PlatformPayAction
                    demo={false}
                    busy={session.busy}
                    busyLabel="Redirection…"
                    className="button primary full"
                    onPay={() => void session.checkout(acceptedQuote.id)}
                    reminder={{ quoteId: acceptedQuote.id, context: session.mutationContext }}
                  />
                ) : (
                  // ENT-16: a delegated member sees the SAME Checkout CTA only while the server says so.
                  <DelegatedPayerCheckout
                    interventionId={intervention.id}
                    context={session.mutationContext}
                    renderCheckout={() => (
                      <PlatformPayAction
                        demo={false}
                        busy={session.busy}
                        busyLabel="Redirection…"
                        className="button primary full"
                        onPay={() => void session.checkout(acceptedQuote.id)}
                        reminder={{ quoteId: acceptedQuote.id, context: session.mutationContext }}
                      />
                    )}
                  />
                )}
              </>
            ) : (
              <p className={styles.muted}>
                Le règlement est proposé une fois l’intervention terminée par l’artisan, sur la base du devis accepté.
              </p>
            )}
            {/* ENT-16: owner grants / revokes the payer mandate (shown only when the server says can_manage). */}
            {intervention.status !== "paid" && (
              <DelegatedPayerManager
                interventionId={intervention.id}
                context={session.mutationContext}
                demo={demo}
                loadMembers={c.organization ? () => session.loadOrganization(c.organization!.id).then((o) => o?.members.map((m) => ({ id: m.user_id, label: m.full_name || `Membre ${m.user_id.slice(0, 8)}` })) ?? null) : undefined}
              />
            )}
          </section>

          {(intervention.status === "completed" || intervention.status === "paid") && (
            <CustomerInvoicesPanel
              title="Factures et avoirs de ce dossier"
              filters={{ intervention_id: intervention.id, basis: "service", ...(c.organization ? { organization_id: c.organization.id } : {}) }}
              context={session.mutationContext}
              demo={demo}
            />
          )}

          <section className="panel" aria-labelledby="dossier-docs">
            <h2 id="dossier-docs">Pièces du dossier</h2>
            {documents.length ? (
              documents.map((d) => (
                <div key={d.id} className={styles.keyValue}>
                  <span>{d.name}</span>
                  <strong>{date(d.created_at)}</strong>
                </div>
              ))
            ) : (
              <p className={styles.muted}>Aucune pièce jointe enregistrée.</p>
            )}
            <button type="button" className={styles.textLink} onClick={() => c.go("documents")}>
              Gérer les documents
              <Icon name="arrow" size={15} />
            </button>
          </section>

          {CANCELLABLE.includes(intervention.status) && (
            <section className="panel" aria-labelledby="dossier-cancel">
              <h2 id="dossier-cancel">Annulation</h2>
              <p className={styles.note}>Possible tant que le devis n’est pas accepté.</p>
              {canOperate ? (
                <ConfirmAction
                  label="Annuler la demande"
                  message="Annuler cette demande ? L’artisan éventuellement affecté en sera informé et aucun montant ne sera dû."
                  confirmLabel="Confirmer l’annulation"
                  danger
                  busy={session.busy}
                  onConfirm={() => session.action(id, "cancel")}
                />
              ) : (
                <ReadOnlyNote reason={c.authority.readOnlyReason} />
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function AppointmentPanel({
  c,
  intervention,
  canWrite,
  ops,
  loading,
  onSaved,
}: {
  c: Ctx;
  intervention: Intervention;
  /** Écriture sur le site du dossier (rôle + portée) : sinon le panneau reste en lecture. */
  canWrite: boolean;
  ops: Operations | null;
  loading: boolean;
  onSaved: () => void;
}) {
  const { session } = c;
  const [open, setOpen] = useState(false);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const stageOpen = APPOINTMENT_STATUSES.includes(intervention.status);
  const editable = stageOpen && canWrite;
  const slotRevision = ops?.appointment ? ops.appointment.reminder_version ?? 0 : 0;
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  const conflict = open && refusedAt !== null && refusedAt !== slotRevision;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const start = Date.parse(starts);
    const end = Date.parse(ends);
    if (!starts || !ends || Number.isNaN(start) || Number.isNaN(end)) {
      setError("Renseignez le début et la fin du créneau.");
      return;
    }
    if (end <= start) {
      setError("La fin du créneau doit suivre son début.");
      return;
    }
    // O3 : un créneau passé est refusé par le serveur ; le dire avant tout envoi.
    if (start <= Date.now()) {
      setError("Ce créneau est déjà passé : choisissez une date et une heure à venir.");
      return;
    }
    setError("");
    const sentVersion = slotRevision;
    const ok = await session.operate(intervention.id, {
      action: "save_appointment",
      expected_version: sentVersion,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
      note: note.trim(),
    });
    setRefusedAt(ok ? null : sentVersion);
    if (ok) setOpen(false);
    // Saved ⇒ fresh read; refused (409 version, rights…) ⇒ re-read too, the typed form is kept (E15).
    onSaved();
  }
  return (
    <section className="panel" aria-labelledby="dossier-appointment">
      <div className={styles.panelTitle}>
        <h2 id="dossier-appointment">Rendez-vous</h2>
        {editable && !open && !loading && ops && (
          <button type="button" className="button outline" disabled={session.busy} onClick={() => { setRefusedAt(null); setOpen(true); }}>
            {ops.appointment ? "Proposer un autre créneau" : "Proposer un créneau"}
          </button>
        )}
      </div>
      {loading ? (
        <Loader label="Chargement du rendez-vous…" />
      ) : !ops ? (
        <Unavailable
          title="Rendez-vous et participants non disponibles"
          state={session.capabilities.operations}
        />
      ) : (
        <>
          {ops.appointment ? (
            <>
              <div className={styles.keyValue}>
                <span>Créneau</span>
                <strong>
                  {dateTime(ops.appointment.starts_at)} → {dateTime(ops.appointment.ends_at)}
                </strong>
              </div>
              {ops.appointment.note && (
                <div className={styles.keyValue}>
                  <span>Note</span>
                  <strong>{ops.appointment.note}</strong>
                </div>
              )}
              {ops.appointment.updated_at && (
                <p className={styles.note}>Dernière mise à jour {dateTime(ops.appointment.updated_at)}.</p>
              )}
            </>
          ) : (
            <p className={styles.muted}>
              {editable
                ? "Aucun créneau enregistré. Vous pouvez en proposer un à l’artisan."
                : "Aucun créneau enregistré pour ce dossier."}
            </p>
          )}
          {stageOpen && !canWrite && <ReadOnlyNote reason={c.authority.readOnlyReason} />}
          {open && (
            <form className={cx(styles.rejectForm)} onSubmit={save}>
              <div className="form-columns">
                <Field label="Début du créneau">
                  <input type="datetime-local" required value={starts} onChange={(e) => setStarts(e.target.value)} />
                </Field>
                <Field label="Fin du créneau">
                  <input type="datetime-local" required min={starts || undefined} value={ends} onChange={(e) => setEnds(e.target.value)} />
                </Field>
              </div>
              <Field label="Consignes d’accès (facultatif)" error={error}>
                <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              {conflict && (
                <p className={styles.note} role="alert" data-slot-conflict="">
                  Le créneau a été modifié entre-temps : la version actuelle est affichée ci-dessus. Votre saisie est conservée ; enregistrez à nouveau pour la confirmer.
                </p>
              )}
              <div className={styles.actions}>
                <button type="submit" className="button primary" disabled={session.busy}>
                  {session.busy ? "Enregistrement…" : "Enregistrer le créneau"}
                </button>
                <button type="button" className="button outline" disabled={session.busy} onClick={() => setOpen(false)}>
                  Annuler
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}

// ---- Sites & contrats --------------------------------------------------------------------
function ProfessionalBlock({ c, initialTab = "approvals" }: { c: Ctx; initialTab?: "approvals" | "contracts" }) {
  const { session, demo } = c;
  const organizationId = c.organization?.id ?? null;
  const context = session.mutationContext;
  const state = session.capabilities.professional;
  if (!demo && state === "unknown") return <Loader label="Vérification du pilotage professionnel…" />;
  if (!demo && state !== "available")
    return (
      <Unavailable title="Approbations, contrats et échéances indisponibles" state={state}>
        <button type="button" className="button outline" onClick={() => void session.loadProfessional()}>
          Réessayer
        </button>
      </Unavailable>
    );
  return (
    <ProfessionalOperations
      key={demo ? undefined : `${context.userId()}|${context.generation()}|${organizationId}`}
      initialTab={demo ? "approvals" : initialTab}
      contracts={{ organizationId, context }}
      data={{
        ...session.professional,
        approvals: c.scope.approvals,
        compliance_records: c.scope.compliance,
        approval_rules: c.scope.rules,
        contracts: session.professional.contracts.filter(
          (k) => !c.organization || k.organization_id === c.organization.id,
        ),
      }}
      sites={c.scope.sites}
      organizations={c.organization ? [c.organization] : []}
      quotes={session.data.quotes}
      demo={demo}
      busy={session.busy}
      onRefresh={session.loadProfessional}
      onSave={session.professionalCommand}
      canWriteOrganization={c.authority.canWriteOrganization}
      canWriteSite={c.authority.canWriteSite}
      readOnlyReason={c.authority.readOnlyReason}
    />
  );
}

// Sites (M13 « Mes immeubles » + « Interventions récentes ») : tableaux denses, données réelles.
function SitesView({ c }: { c: Ctx }) {
  const { session, scope } = c;
  // Disponibilité réelle des approbations/échéances : jamais supposée (VIS-REV-001).
  const alertsState = session.capabilities.professional;
  const recent = byDateDesc(scope.interventions).slice(0, 5);
  const siteName = (id?: string | null) => scope.sites.find((s) => s.id === id)?.name || "Hors site";
  // W4 : un site archivé ne reçoit plus de demande ; il n'est plus listé parmi « Mes sites »
  // (il reste consultable depuis « Sites archivés » du portefeuille ci-dessous).
  const activeSites = scope.sites.filter((s) => !s.archived_at);
  return (
    <>
      <PageTitle
        title="Sites & contrats"
        subtitle={`Vos sites, leurs interventions en cours et le budget engagé (${BASIS}).`}
        action={
          <div className={styles.titleActions}>
            <button type="button" className="button outline" onClick={() => c.go("contracts")}>
              <Icon name="document" size={17} />
              Contrats cadres
            </button>
            {c.canCreateRequest && (
              <button type="button" className="button primary" onClick={() => c.go("new")}>
                <Icon name="plus" size={17} />
                Nouvelle demande
              </button>
            )}
          </div>
        }
      />
      <section className={styles.listSection} aria-labelledby="sites-table-title">
        <div className={styles.sectionHead}>
          <h2 id="sites-table-title">
            Mes sites <span className={styles.countPill}>{activeSites.length}</span>
          </h2>
        </div>
        {activeSites.length && alertsState !== "unknown" && alertsState !== "available" ? (
          <Unavailable title="Alertes des sites non vérifiées" state={alertsState}>
            <p>
              Les devis à approuver et les échéances de contrôle n’ont pas pu être chargés : aucune
              absence d’alerte n’est affirmée ci-dessous.
            </p>
            <button type="button" className="button outline" onClick={() => void session.loadProfessional()}>
              Réessayer
            </button>
          </Unavailable>
        ) : null}
        {activeSites.length ? (
          <div className={cx("panel", styles.tablePanel, styles.scrollX)}>
            <ScrollableTable label="Sites — tableau à défilement horizontal">
              <table className={cx(styles.table, styles.sitesTable)}>
                <caption className="sr-only">
                  Sites de l’organisation active ; interventions, budget et alertes {BASIS}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col">Interventions en cours</th>
                    <th scope="col">Budget engagé</th>
                    <th scope="col">Montant</th>
                    <th scope="col">
                      Alertes
                      <span className={styles.thHint}>parmi les données chargées</span>
                    </th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeSites.map((s) => {
                    const f = siteFigures(s, session.data);
                    const tone = budgetTone(f.ratio ?? 0, f.over);
                    const alerts = siteAlertSummary(
                      alertsState,
                      siteAlerts(
                        s.id,
                        scope.approvals,
                        scope.compliance,
                        session.data.interventions,
                        session.data.quotes,
                      ),
                    );
                    const writable = c.authority.canWriteSite(s.id);
                    return (
                      <tr key={s.id}>
                        <td className={styles.cellSite}>
                          <button type="button" className={styles.rowOpen} onClick={() => c.go("site", s.id)}>
                            <span className={styles.siteIcon} aria-hidden="true">
                              <Icon name="building" size={20} />
                            </span>
                            <span>
                              <strong>{s.name}</strong>
                              <small>
                                {(s.type && SITE_TYPES[s.type]) || "Site"} · {s.address}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td className={styles.cellOpen}>
                          <span className={styles.openWrap}>
                            <span className={cx(styles.openCount, f.open === 0 && styles.openCountNone)} aria-hidden="true">
                              {f.open}
                            </span>
                            <span className={f.open ? styles.openText : styles.muted}>
                              {f.open} en cours
                              <small>
                                {f.count} dossier{f.count > 1 ? "s" : ""} au total
                              </small>
                            </span>
                          </span>
                        </td>
                        <td className={styles.cellBudget}>
                          {f.ratio !== null ? (
                            <span className={styles.budgetLine}>
                              <span
                                className={cx(styles.budgetBar, styles[`budget_${tone}`])}
                                role="img"
                                aria-label={`${percent(f.ratio)} du budget de référence engagé${f.over ? ", budget dépassé" : ""}`}
                              >
                                <span style={{ width: `${f.width}%` }} />
                              </span>
                              <span className={cx(styles.budgetPercent, f.over && styles.budgetPercentOver)}>
                                {wholePercent(f.ratio)}
                              </span>
                            </span>
                          ) : (
                            <span className={styles.muted}>Pas de budget de référence</span>
                          )}
                        </td>
                        <td className={styles.cellAmount}>
                          <strong>{money(f.committed)}</strong>
                          <small>{f.budget > 0 ? `sur ${money(f.budget)}` : "devis acceptés"}</small>
                        </td>
                        <td className={styles.cellAlerts}>
                          {alerts.kind === "alerts" ? (
                            <span className={alerts.overdue ? styles.alertRed : styles.alertAmber}>
                              {alerts.parts.join(", ")}
                            </span>
                          ) : alerts.kind === "none" ? (
                            <span className={styles.muted}>
                              Aucune
                              {/* Visible sur mobile (en-tête de colonne masqué), lu partout. */}
                              <span className={styles.alertQualifier}> parmi les données chargées</span>
                            </span>
                          ) : alerts.kind === "checking" ? (
                            <span className={styles.muted}>Vérification…</span>
                          ) : (
                            <span className={styles.alertUnverified}>
                              <Icon name="lock" size={14} />
                              Non vérifiées
                            </span>
                          )}
                        </td>
                        <td className={styles.cellActions}>
                          <button type="button" className={styles.rowLink} onClick={() => c.go("site", s.id)}>
                            Fiche<span className="sr-only"> du site {s.name}</span>
                          </button>
                          {writable ? (
                            <button type="button" className={styles.rowLink} onClick={() => c.go("new", s.id)}>
                              <Icon name="plus" size={15} />
                              Demande<span className="sr-only"> pour {s.name}</span>
                            </button>
                          ) : (
                            <span className={styles.readOnlyTag} title="Lecture seule sur ce site">
                              <Icon name="lock" size={14} />
                              Lecture seule
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableTable>
          </div>
        ) : (
          <div className="panel">
            <Empty icon="building" title="Aucun site sur ce périmètre">
              {c.authority.canWriteOrganization
                ? "Ajoutez un premier site pour rattacher vos demandes, budgets et règles d’approbation."
                : "Aucun site ne vous est accessible sur ce périmètre."}
            </Empty>
          </div>
        )}
      </section>

      {/* Active / archived sites from the server (paged): the only place archived sites are listed. */}
      {c.organization && (
        <OrganizationSitesList
          key={`${c.organization.id}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`}
          organizationId={c.organization.id}
          context={session.mutationContext}
          demo={session.mode === "demo"}
          onOpen={(id) => c.go("site", id)}
        />
      )}

      {scope.sites.length > 0 && (
        <section className={styles.listSection} aria-labelledby="sites-recent-title">
          <div className={styles.sectionHead}>
            <h2 id="sites-recent-title">
              Interventions récentes <span className={styles.sectionHint}>(tous les sites)</span>{" "}
              <span className={styles.countPill}>{scope.interventions.length}</span>
            </h2>
            <button type="button" className={styles.textLink} onClick={() => c.go("requests")}>
              Voir toutes les interventions
              <Icon name="arrow" size={15} />
            </button>
          </div>
          <div className={cx("panel", styles.tablePanel)}>
            {recent.length ? (
              <ScrollableTable label="Interventions récentes — tableau à défilement horizontal">
                <table className={cx(styles.table, styles.recentTable)}>
                  <caption className="sr-only">Cinq dernières interventions de vos sites</caption>
                  <thead>
                    <tr>
                      <th scope="col">Référence</th>
                      <th scope="col">Site</th>
                      <th scope="col">Intervention</th>
                      <th scope="col">Date</th>
                      <th scope="col">Statut</th>
                      <th scope="col">Priorité</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((i) => (
                      <tr key={i.id}>
                        <td className={styles.cellRef}>
                          <button type="button" className={styles.refLink} onClick={() => c.session.openIntervention(i.id)}>
                            {shortId(i.id)}
                          </button>
                        </td>
                        <td className={styles.cellRecentSite}>{siteName(i.site_id)}</td>
                        <td className={styles.cellRecentType}>{category(i.category).label}</td>
                        <td className={styles.cellRecentDate}>{date(i.created_at)}</td>
                        <td className={styles.cellStatus}>
                          <Badge status={i.status} />
                        </td>
                        <td className={styles.cellPriority}>
                          <span className={i.urgency === "urgent" ? styles.priorityUrgent : styles.priorityPlanned}>
                            {i.urgency === "urgent" ? "Urgent" : "Planifiée"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableTable>
            ) : (
              <Empty icon="wrench" title="Aucune intervention sur vos sites">
                Les demandes créées depuis un site apparaîtront ici.
              </Empty>
            )}
          </div>
        </section>
      )}

      {c.authority.canWriteOrganization ? (
        <SiteForm
          busy={session.busy}
          onSubmit={async (values) => {
            await session.createSite({
              ...values,
              organization_id: c.organization?.id || undefined,
            });
          }}
        />
      ) : (
        <section className="panel" aria-labelledby="site-add-readonly">
          <h2 id="site-add-readonly">Ajouter un site</h2>
          <ReadOnlyNote
            reason={`L’ajout d’un site requiert un droit d’écriture sur toute l’organisation. ${c.authority.readOnlyReason || ""}`.trim()}
          />
        </section>
      )}
      <ProfessionalBlock c={c} />
    </>
  );
}

function ContractsView({ c }: { c: Ctx }) {
  return (
    <>
      <PageTitle
        title="Contrats cadres & règles"
        subtitle="Approbations, contrats enregistrés et échéances de l’organisation active"
        back={{ label: "Retour aux sites", onClick: () => c.go("sites") }}
      />
      <ProfessionalBlock c={c} initialTab="contracts" />
    </>
  );
}

// ---- Fiche de site (V5-C01 / M50, données réelles uniquement) -------------------------------
/** Live paginated intervention history of ONE site (« En cours » ⇐ open, « Passées » ⇐ past), shared by
 *  SiteSheet and DirectSiteSheet. Rows only (opening a dossier); no write action. */
function SiteInterventionsPanel({ session, siteId, headingId, title = "Interventions", onForbidden }: { session: Session; siteId: string; headingId: string; title?: string; /** Lifts a 401/403/404 (site contract) to the sheet. */ onForbidden?: () => void }) {
  const [tab, setTab] = useState<"open" | "past">("open");
  const jobs = useSiteRecords({ enabled: session.mode !== "demo", context: session.mutationContext, siteId, kind: tab });
  const forbidden = jobs.state.phase === "forbidden";
  useEffect(() => {
    if (forbidden) onForbidden?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forbidden]);
  return (
    <section className="panel" aria-labelledby={headingId} data-site-interventions={siteId}>
      <div className={styles.panelTitle}>
        <h2 id={headingId}>{title}</h2>
        <div className={styles.segmentsWrap}>
          <Segments
            label="Filtre des interventions du site"
            value={tab}
            options={[
              ["open", "En cours"],
              ["past", "Passées"],
            ]}
            onChange={setTab}
          />
        </div>
      </div>
      <div data-site-records={`jobs:${tab}:${jobs.state.phase}`}>
        {(jobs.state.phase === "loading" || jobs.state.phase === "idle") && <p className={styles.muted} role="status">{RECORDS_COPY.loading}</p>}
        {(jobs.state.phase === "error" || jobs.state.phase === "forbidden") && (
          <div role="alert">
            <p className={styles.muted}>{jobs.state.error}</p>
            {jobs.state.phase === "error" && <button type="button" className="button outline" onClick={() => jobs.retry()}>Réessayer</button>}
          </div>
        )}
        {jobs.state.phase === "ready" &&
          (jobs.state.items.length ? (
            (jobs.state.items as JobRow[]).map((i) => (
              <button key={i.id} type="button" className={cx(styles.listRow, styles.listRowButton, styles.datedRow)} onClick={() => session.openIntervention(i.id)} data-site-job={i.id}>
                <time dateTime={i.created_at}>{date(i.created_at)}</time>
                <section>
                  <strong>{category(i.category).label}</strong>
                  <small>
                    {shortId(i.id)} · {dateTime(i.created_at)}
                  </small>
                </section>
                {i.urgency === "urgent" && <Tag tone="red">Urgent</Tag>}
                <Badge status={i.status} />
                <Icon name="arrow" size={16} />
              </button>
            ))
          ) : (
            <p className={styles.muted}>{tab === "open" ? "Aucune intervention en cours sur ce site." : "Aucune intervention passée sur ce site."}</p>
          ))}
        {jobs.state.failed === "more" && (
          <div role="alert">
            <p className={styles.muted}>{jobs.state.error}</p>
            <button type="button" className="button outline" onClick={() => jobs.retry()}>Réessayer</button>
          </div>
        )}
        {jobs.state.phase === "ready" && jobs.state.next && jobs.state.failed !== "more" && (
          <button type="button" className="button outline" disabled={jobs.state.loadingMore} onClick={() => jobs.more()} data-site-records-more="jobs">
            {jobs.state.loadingMore ? "Chargement…" : RECORDS_COPY.more}
          </button>
        )}
      </div>
    </section>
  );
}

/** Exported for tests only (real-mount layout checks). */
export function SiteSheet({ c, id }: { c: Ctx; id: string }) {
  const { session } = c;
  const site = c.orgSites.find((s) => s.id === id);
  // Live: probe the site-operations contract for THIS site once while it is unknown (works with
  // « Tous les sites » too, where no global active site triggers the controller probe).
  useProbeWhenUnknown(c.session, "siteOperations", { siteId: id }, Boolean(site && !site.archived_at));
  const [tab, setTab] = useState<"open" | "past">("open");
  // Live (SYS-07 / ENT-04 / ENT-10): interventions, due dates and audits come from the paginated
  // server reads of THIS site (GET /api/sites/<id>/records), never from the 100 / 300 caches. Demo:
  // unchanged, zero call. Rows are bound at render to identity + site + kind.
  const live = session.mode !== "demo";
  const recordsSite = site && !site.archived_at ? site.id : null;
  const [dueTab, setDueTab] = useState<"upcoming" | "completed">("upcoming");
  const upcoming = useSiteRecords({ enabled: live, context: session.mutationContext, siteId: recordsSite, kind: "upcoming" });
  const completedDue = useSiteRecords({ enabled: live && dueTab === "completed", context: session.mutationContext, siteId: recordsSite, kind: "completed" });
  const auditRecords = useSiteRecords({ enabled: live && (site?.type || site?.vertical || "") === "erp", context: session.mutationContext, siteId: recordsSite, kind: "audits" });
  // One reminder panel at a time, mounted only on demand (no GET per row); any scope change closes it.
  const dueList = dueTab === "upcoming" ? upcoming : completedDue;
  const reminderScope = `${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${recordsSite ?? "-"}|${dueTab}|${dueList.state.key}|${dueList.state.items.length}`;
  const [reminder, setReminder] = useState<{ scope: string; id: string } | null>(null);
  const openReminder = reminder && reminder.scope === reminderScope ? reminder.id : null;
  // Site-level « inaccessible »: ANY active records read of THIS site answering 401/403/404 hides the
  // whole sheet. Keyed by identity + site (resets elsewhere). A 503 stays panel-level.
  const siteScope = `${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${recordsSite ?? "-"}`;
  const [forbiddenScope, setForbiddenScope] = useState<string | null>(null);
  const siteForbidden = live && (forbiddenScope === siteScope || [upcoming, completedDue, auditRecords].some((x) => x.state.phase === "forbidden"));
  // Absent from the workspace cache (portfolio page > 1, archived site): exact server read.
  if (!site || site.archived_at) return <DirectSiteSheet c={c} id={id} />;
  if (siteForbidden)
    return (
      <div data-site-sheet="inaccessible">
        <button type="button" className="back-link" onClick={() => c.go("sites")}>
          <Icon name="back" size={17} />
          Retour aux sites
        </button>
        <section className="panel" role="alert">
          <h2>Site inaccessible</h2>
          <p className={styles.muted}>{RECORDS_COPY.notFound}</p>
        </section>
      </div>
    );
  const f = siteFigures(site, session.data);
  const interventions = byDateDesc(session.data.interventions.filter((i) => i.site_id === site.id));
  const open = interventions.filter((i) => OPEN_STATUSES.includes(i.status));
  const past = interventions.filter((i) => !OPEN_STATUSES.includes(i.status));
  const shown = tab === "open" ? open : past;
  const compliance = [...session.professional.compliance_records]
    .filter((r) => r.site_id === site.id)
    .sort((a, b) => a.due_on.localeCompare(b.due_on));
  const next = compliance.find((r) => r.status !== "completed");
  const rule = session.professional.approval_rules.find((r) => r.site_id === site.id);
  const siteIds = new Set(interventions.map((i) => i.id));
  const documents = session.data.documents.filter((d) => d.intervention_id && siteIds.has(d.intervention_id));
  const vertical = site.type || site.vertical || "";
  const audits = compliance.filter((r) => ["audit", "safety"].includes(r.kind));
  // Écriture opérationnelle sur CE site : rôle de membre et portée (jamais le rôle seul).
  const canWrite = c.authority.canWriteSite(site.id);
  // Opérations du site (lot B2B) : état réel du contrat, libellé commun quand il n’est pas disponible.

  return (
    <>
      <button type="button" className="back-link" onClick={() => c.go("sites")}>
        <Icon name="back" size={17} />
        Retour aux sites
      </button>
      <div className={styles.sheetHeader}>
        <div>
          <span className={styles.kicker}>Fiche de site</span>
          <h1>
            {site.name}
            <Tag tone="blue">{(vertical && SITE_TYPES[vertical]) || "Site"}</Tag>
          </h1>
          <p>
            <Icon name="location" size={15} />
            {site.address}
          </p>
          {/* V5-C01 « Présentation du bâtiment » : seuls les faits enregistrés (type, adresse, budget). */}
          <dl className={styles.facts} aria-label="Identité du site">
            <div>
              <dt>Type de site</dt>
              <dd>{(vertical && SITE_TYPES[vertical]) || "Non renseigné"}</dd>
            </div>
            <div>
              <dt>Adresse</dt>
              <dd>{site.address}</dd>
            </div>
            <div>
              <dt>Budget de référence</dt>
              <dd>{f.budget > 0 ? money(f.budget) : "Non renseigné"}</dd>
            </div>
          </dl>
        </div>
        <div className={styles.sheetActions}>
          {canWrite ? (
            <button type="button" className="button primary" onClick={() => c.go("new", site.id)}>
              <Icon name="plus" size={16} />
              Nouvelle demande
            </button>
          ) : (
            <ReadOnlyNote reason={c.authority.readOnlyReason} />
          )}
        </div>
      </div>

      <div className={styles.tiles}>
        <div className={styles.tile}>
          <span>Budget de référence</span>
          <strong>{f.budget > 0 ? money(f.budget) : "Non renseigné"}</strong>
        </div>
        <div className={styles.tile}>
          <span>Engagé (devis acceptés)</span>
          <strong>{money(f.committed)}</strong>
          <small>{BASIS}</small>
        </div>
        <div className={styles.tile}>
          <span>Restant</span>
          <strong>{f.budget > 0 ? money(f.remaining) : "—"}</strong>
          <small>
            {f.ratio === null
              ? "Budget non défini"
              : f.over
                ? `Budget dépassé · ${percent(f.ratio)} engagé`
                : `${percent(f.ratio)} engagé`}
          </small>
        </div>
        <div className={styles.tile}>
          <span>Interventions en cours</span>
          <strong>{f.open}</strong>
          <small>{f.count} dossier{f.count > 1 ? "s" : ""} chargé{f.count > 1 ? "s" : ""}</small>
        </div>
        <div className={styles.tile} data-site-next-due={live ? upcoming.state.phase : "demo"}>
          <span>Prochaine échéance</span>
          {!live ? (
            <>
              <strong>{next ? date(next.due_on) : "Aucune"}</strong>
              {next && <small>{next.title}</small>}
            </>
          ) : upcoming.state.phase === "ready" ? (
            <>
              <strong>{upcoming.state.items[0] ? date((upcoming.state.items[0] as DueRow).due_on) : "Aucune"}</strong>
              {upcoming.state.items[0] && <small>{(upcoming.state.items[0] as DueRow).title}</small>}
            </>
          ) : upcoming.state.phase === "loading" || upcoming.state.phase === "idle" ? (
            <strong>…</strong>
          ) : (
            <>
              <strong>Non vérifiée</strong>
              <small>Lecture des échéances indisponible</small>
            </>
          )}
        </div>
      </div>

      <div className={styles.twoCol}>
        {live ? (
          <SiteInterventionsPanel session={session} siteId={site.id} headingId="site-interventions" onForbidden={() => setForbiddenScope(siteScope)} />
        ) : (
        <section className="panel" aria-labelledby="site-interventions">
          <div className={styles.panelTitle}>
            <h2 id="site-interventions">Interventions</h2>
            <div className={styles.segmentsWrap}>
              <Segments
                label="Filtre des interventions du site"
                value={tab}
                options={[
                  ["open", `En cours (${open.length})`],
                  ["past", `Passées (${past.length})`],
                ]}
                onChange={setTab}
              />
            </div>
          </div>
          {shown.length ? (
            shown.map((i) => (
              <button
                key={i.id}
                type="button"
                className={cx(styles.listRow, styles.listRowButton, styles.datedRow)}
                onClick={() => session.openIntervention(i.id)}
              >
                <time dateTime={i.created_at}>{date(i.created_at)}</time>
                <section>
                  <strong>{category(i.category).label}</strong>
                  <small>
                    {shortId(i.id)} · {dateTime(i.created_at)}
                  </small>
                </section>
                <Badge status={i.status} />
                <Icon name="arrow" size={16} />
              </button>
            ))
          ) : (
            <p className={styles.muted}>
              {tab === "open" ? "Aucune intervention en cours sur ce site." : "Aucune intervention passée chargée pour ce site."}
            </p>
          )}
        </section>
        )}

        <section className="panel" aria-labelledby="site-budget">
          <h2 id="site-budget">Budget</h2>
          <div className={styles.budgetHead}>
            <span>Devis acceptés</span>
            <strong>
              {money(f.committed)}
              {f.budget > 0 ? ` / ${money(f.budget)}` : ""}
            </strong>
          </div>
          <div
            className={cx(styles.budgetBar, f.over && styles.budgetBarOver)}
            role="img"
            aria-label={
              f.ratio === null
                ? "Aucun budget de référence"
                : `${percent(f.ratio)} du budget engagé${f.over ? ", budget dépassé" : ""}`
            }
          >
            <span style={{ width: `${f.width}%` }} />
          </div>
          <div className={styles.keyValue}>
            <span>Réglé</span>
            <strong>{money(f.paid)}</strong>
          </div>
          {f.declared > 0 && (
            <div className={styles.keyValue}>
              <span>dont déclaré reçu sur place</span>
              <strong>{money(f.declared)}</strong>
            </div>
          )}
          <div className={styles.keyValue}>
            <span>Engagé non réglé</span>
            <strong>{money(f.committed - f.paid)}</strong>
          </div>
          <p className={styles.note}>Montants TTC {BASIS}. Le rapport CSV du serveur fait foi.</p>
          {canWrite ? (
            <BudgetEditor
              budgetCents={f.budget}
              busy={session.busy}
              onSave={(cents) =>
                session.professionalCommand({ action: "set_site_budget", site_id: site.id, budget_cents: cents })
              }
            />
          ) : (
            <>
              <div className={styles.keyValue}>
                <span>Budget de référence</span>
                <strong>{f.budget > 0 ? money(f.budget) : "Non renseigné"}</strong>
              </div>
              <ReadOnlyNote reason={c.authority.readOnlyReason} />
            </>
          )}
        </section>

        <section className="panel" aria-labelledby="site-compliance">
          <div className={styles.panelTitle}>
            <h2 id="site-compliance">Échéances & conformité</h2>
            {canWrite ? (
              <button type="button" className={styles.textLink} onClick={() => c.go("contracts")}>
                Ajouter
                <Icon name="arrow" size={15} />
              </button>
            ) : (
              <ReadOnlyNote compact reason="Lecture seule" />
            )}
          </div>
          {live ? (
            <div data-site-records={`due:${dueTab}:${dueList.state.phase}`}>
              <div className={styles.segmentsWrap}>
                <Segments
                  label="Filtre des échéances du site"
                  value={dueTab}
                  options={[
                    ["upcoming", "En attente"],
                    ["completed", "Terminées"],
                  ]}
                  onChange={(v) => {
                    setReminder(null);
                    setDueTab(v);
                  }}
                />
              </div>
              {(dueList.state.phase === "loading" || dueList.state.phase === "idle") && <p className={styles.muted} role="status">{RECORDS_COPY.loading}</p>}
              {(dueList.state.phase === "error" || dueList.state.phase === "forbidden") && (
                <div role="alert">
                  <p className={styles.muted}>{dueList.state.error}</p>
                  {dueList.state.phase === "error" && <button type="button" className="button outline" onClick={() => dueList.retry()}>Réessayer</button>}
                </div>
              )}
              {dueList.state.phase === "ready" &&
                (dueList.state.items.length ? (
                  (dueList.state.items as DueRow[]).map((r) => (
                    <Fragment key={r.id}>
                      <div className={styles.listRow} data-site-due={r.id}>
                        <section>
                          <strong>{r.title}</strong>
                          <small>
                            {COMPLIANCE_KIND[r.kind] || r.kind} · échéance {date(r.due_on)}
                            {r.notes ? ` · ${r.notes}` : ""}
                          </small>
                        </section>
                        <Tag tone={r.status === "completed" ? "green" : "amber"}>{COMPLIANCE_STATUS[r.status] || r.status}</Tag>
                        {r.status !== "completed" && canWrite && (
                          <button
                            type="button"
                            className={cx("button outline", styles.rowAction)}
                            disabled={session.busy}
                            onClick={async () => {
                              const ok = await session.professionalCommand({ action: "save_compliance", id: r.id, site_id: r.site_id, title: r.title, kind: r.kind, due_on: r.due_on, status: "completed", notes: r.notes });
                              // Server-confirmed only: re-read both lists, never patch rows locally.
                              if (ok) {
                                setReminder(null);
                                upcoming.refresh();
                                completedDue.refresh();
                              }
                            }}
                            data-site-due-complete={r.id}
                          >
                            Marquer terminé
                          </button>
                        )}
                        {r.status !== "completed" && (
                          <button
                            type="button"
                            className={cx("button outline", styles.rowAction)}
                            aria-expanded={openReminder === r.id}
                            aria-controls={`site-reminder-${r.id}`}
                            onClick={() => setReminder(openReminder === r.id ? null : { scope: reminderScope, id: r.id })}
                            data-site-reminder-toggle={r.id}
                          >
                            Gérer le rappel
                          </button>
                        )}
                      </div>
                      {openReminder === r.id && (
                        <div id={`site-reminder-${r.id}`}>
                          <ComplianceReminderPanel key={reminderScope} complianceId={r.id} context={session.mutationContext} demo={false} />
                        </div>
                      )}
                    </Fragment>
                  ))
                ) : (
                  <p className={styles.muted}>{dueTab === "upcoming" ? "Aucune échéance en attente pour ce site." : "Aucune échéance terminée pour ce site."}</p>
                ))}
              {dueList.state.failed === "more" && (
                <div role="alert">
                  <p className={styles.muted}>{dueList.state.error}</p>
                  <button type="button" className="button outline" onClick={() => dueList.retry()}>Réessayer</button>
                </div>
              )}
              {dueList.state.phase === "ready" && dueList.state.next && dueList.state.failed !== "more" && (
                <button type="button" className="button outline" disabled={dueList.state.loadingMore} onClick={() => dueList.more()} data-site-records-more="due">
                  {dueList.state.loadingMore ? "Chargement…" : RECORDS_COPY.more}
                </button>
              )}
            </div>
          ) : compliance.length ? (
            compliance.map((r) => (
              <Fragment key={r.id}>
              <div className={styles.listRow}>
                <section>
                  <strong>{r.title}</strong>
                  <small>
                    {COMPLIANCE_KIND[r.kind] || r.kind} · échéance {date(r.due_on)}
                    {r.notes ? ` · ${r.notes}` : ""}
                  </small>
                </section>
                <Tag tone={r.status === "completed" ? "green" : "amber"}>{COMPLIANCE_STATUS[r.status] || r.status}</Tag>
                {r.status !== "completed" && canWrite && (
                  <button
                    type="button"
                    className={cx("button outline", styles.rowAction)}
                    disabled={session.busy}
                    onClick={() =>
                      void session.professionalCommand({
                        action: "save_compliance",
                        id: r.id,
                        site_id: r.site_id,
                        title: r.title,
                        kind: r.kind,
                        due_on: r.due_on,
                        status: "completed",
                        notes: r.notes,
                      })
                    }
                  >
                    Marquer terminé
                  </button>
                )}
              </div>
              {/* Internal reminder of this due date (server state and rights; no external send). */}
              {r.status !== "completed" && (
                <ComplianceReminderPanel complianceId={r.id} context={session.mutationContext} demo={session.mode === "demo"} />
              )}
              </Fragment>
            ))
          ) : (
            <p className={styles.muted}>Aucune échéance enregistrée pour ce site.</p>
          )}
          {!canWrite && (live ? upcoming.state.items.length > 0 : compliance.some((r) => r.status !== "completed")) && (
            <ReadOnlyNote reason={c.authority.readOnlyReason} />
          )}
          <p className={styles.note}>Ces enregistrements organisent le suivi ; ils ne certifient pas la conformité d’une installation.</p>
        </section>

        <section className="panel" aria-labelledby="site-rule">
          <h2 id="site-rule">Règle d’approbation</h2>
          {rule ? (
            <>
              <div className={styles.keyValue}>
                <span>Seuil TTC</span>
                <strong>{money(rule.threshold_cents)}</strong>
              </div>
              <div className={styles.keyValue}>
                <span>Décideur</span>
                <strong>{rule.required_role === "owner" ? "Propriétaire" : "Gestionnaire"}</strong>
              </div>
              <div className={styles.keyValue}>
                <span>État</span>
                <strong>{rule.enabled ? "Active" : "Désactivée"}</strong>
              </div>
            </>
          ) : (
            <p className={styles.muted}>Aucune règle : les devis de ce site sont acceptables sans approbation préalable.</p>
          )}
          {canWrite ? (
            <button type="button" className={styles.textLink} onClick={() => c.go("contracts")}>
              Configurer la règle
              <Icon name="arrow" size={15} />
            </button>
          ) : (
            <ReadOnlyNote reason={c.authority.readOnlyReason} />
          )}
          {/* ENT-12: explicit ordered policy of this site (edit only when the server says can_manage). */}
          <SitePolicyPanel
            siteId={site.id}
            context={session.mutationContext}
            demo={session.mode === "demo"}
            loadMembers={c.organization ? () => session.loadOrganization(c.organization!.id).then((o) => o?.members.map((m) => ({ id: m.user_id, label: m.full_name || `Membre ${m.user_id.slice(0, 8)}` })) ?? null) : undefined}
          />
        </section>

        <SiteOperationsSection
          c={c}
          siteId={site.id}
          organizationId={c.organization?.id}
          canWrite={canWrite}
          readOnlyReason={c.authority.readOnlyReason || "Lecture seule sur ce site."}
        />

        {vertical === "restaurant" && (
          <Unavailable
            title="Équipements critiques (cuisine, froid, éclairage)"
            reason="Les équipements, leur criticité et leur état se gèrent dans « Opérations du site » ci-dessus. Aucune télémesure ni alerte automatique n’est raccordée : l’état affiché est celui déclaré."
            blocker="ENT-07"
          />
        )}
        <SiteSettingsPanel
          key={`${site.id}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`}
          siteId={site.id}
          context={session.mutationContext}
          demo={session.mode === "demo"}
          onChanged={() => void session.refresh()}
        />
        {session.mode === "demo" ? (
          <Unavailable
            title="Étages, zones et parties communes"
            reason="En démonstration, aucun découpage n’est enregistré : connectez-vous à votre espace pour déclarer les étages, zones et parties communes du site."
            blocker="ENT-08"
          />
        ) : (
          <SiteAreasPanel siteId={site.id} context={session.mutationContext} demo={false} />
        )}
        {session.mode === "demo" ? (
          <Unavailable
            title="Consommation électrique"
            reason="En démonstration, aucune période de consommation n’est enregistrée : connectez-vous à votre espace pour saisir vos relevés et factures."
            blocker="ENT-09"
          />
        ) : (
          <SiteEnergyPanel
            key={`${site.id}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`}
            siteId={site.id}
            context={session.mutationContext}
          />
        )}
        {vertical === "erp" && (
          <section className="panel" aria-labelledby="site-audits">
            <h2 id="site-audits">Audits & réserves</h2>
            {live ? (
              <div data-site-records={`audits:${auditRecords.state.phase}`}>
                {(auditRecords.state.phase === "loading" || auditRecords.state.phase === "idle") && <p className={styles.muted} role="status">{RECORDS_COPY.loading}</p>}
                {(auditRecords.state.phase === "error" || auditRecords.state.phase === "forbidden") && (
                  <div role="alert">
                    <p className={styles.muted}>{auditRecords.state.error}</p>
                    {auditRecords.state.phase === "error" && <button type="button" className="button outline" onClick={() => auditRecords.retry()}>Réessayer</button>}
                  </div>
                )}
                {auditRecords.state.phase === "ready" &&
                  (auditRecords.state.items.length ? (
                    (auditRecords.state.items as DueRow[]).map((r) => (
                      <div key={r.id} className={styles.listRow} data-site-audit={r.id}>
                        <section>
                          <strong>{r.title}</strong>
                          <small>
                            {COMPLIANCE_KIND[r.kind] || r.kind} · {date(r.due_on)}
                          </small>
                        </section>
                        <Tag tone={r.status === "completed" ? "green" : "amber"}>{COMPLIANCE_STATUS[r.status] || r.status}</Tag>
                      </div>
                    ))
                  ) : (
                    <p className={styles.muted}>Aucun audit ni signalement de sécurité enregistré pour cet ERP.</p>
                  ))}
                {auditRecords.state.failed === "more" && (
                  <div role="alert">
                    <p className={styles.muted}>{auditRecords.state.error}</p>
                    <button type="button" className="button outline" onClick={() => auditRecords.retry()}>Réessayer</button>
                  </div>
                )}
                {auditRecords.state.phase === "ready" && auditRecords.state.next && auditRecords.state.failed !== "more" && (
                  <button type="button" className="button outline" disabled={auditRecords.state.loadingMore} onClick={() => auditRecords.more()} data-site-records-more="audits">
                    {auditRecords.state.loadingMore ? "Chargement…" : RECORDS_COPY.more}
                  </button>
                )}
              </div>
            ) : audits.length ? (
              audits.map((r) => (
                <div key={r.id} className={styles.listRow}>
                  <section>
                    <strong>{r.title}</strong>
                    <small>
                      {COMPLIANCE_KIND[r.kind] || r.kind} · {date(r.due_on)}
                    </small>
                  </section>
                  <Tag tone={r.status === "completed" ? "green" : "amber"}>{COMPLIANCE_STATUS[r.status] || r.status}</Tag>
                </div>
              ))
            ) : (
              <p className={styles.muted}>Aucun audit ni signalement de sécurité enregistré pour cet ERP.</p>
            )}
          </section>
        )}
        {vertical === "syndic" &&
          (session.mode === "demo" ? (
            <Unavailable
              title="Assemblées générales & appels de fonds"
              reason="En démonstration, aucune assemblée ni aucun appel de fonds n’est enregistré : connectez-vous à votre espace pour les consigner."
              blocker="ENT-05"
            />
          ) : (
            <CoOwnershipPanel siteId={site.id} context={session.mutationContext} demo={false} />
          ))}

        {session.mode === "demo" ? (
          <Unavailable
            title="Contacts du site"
            reason="En démonstration, aucun contact n’est enregistré : connectez-vous à votre espace pour déclarer les contacts et consignes du site."
            blocker="ENT-04"
          />
        ) : (
          <SiteContactsPanel
            key={`${site.id}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`}
            siteId={site.id}
            context={session.mutationContext}
          />
        )}

        {/* ENT-04: live ⇒ paged server documents of THIS site (beyond the workspace cache); demo unchanged. */}
        {live ? (
          <SiteDocumentsPanel
            key={`docs|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${c.organization?.id ?? "-"}|${site.id}`}
            siteId={site.id}
            organizationId={c.organization?.id}
            context={session.mutationContext}
            onOpenDossier={(id) => session.openIntervention(id)}
          />
        ) : (
        <section className="panel" aria-labelledby="site-docs">
          <h2 id="site-docs">Documents</h2>
          {documents.length ? (
            documents.map((d) => (
              <div key={d.id} className={styles.keyValue}>
                <span>
                  {d.name}
                  {d.intervention_id ? ` · ${shortId(d.intervention_id)}` : ""}
                </span>
                <strong>{date(d.created_at)}</strong>
              </div>
            ))
          ) : (
            <p className={styles.muted}>Aucun document rattaché aux interventions de ce site.</p>
          )}
          <p className={styles.note}>Seuls les documents liés à une intervention du site sont listés ; les justificatifs personnels restent dans « Documents ».</p>
          <button type="button" className={styles.textLink} onClick={() => c.go("documents")}>
            Ouvrir les documents
            <Icon name="arrow" size={15} />
          </button>
        </section>
        )}
        {/* ENT-04 / SYS-06: the site's own pieces (plans, maintenance, compliance); upload capped by the
            member's write right on this site, the server's can_manage_site stays the authority. */}
        <SiteAttachmentsPanel
          key={`attach|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${c.organization?.id ?? "-"}|${site.id}`}
          siteId={site.id}
          organizationId={c.organization?.id}
          context={session.mutationContext}
          canUpload={canWrite}
          archived={Boolean(site.archived_at)}
          demo={!live}
        />
      </div>
    </>
  );
}

/** Site opened by id but absent from the workspace: read by GET /api/sites/:id/settings under the
 *  current identity, refused for another organisation. An archived site is strictly read-only;
 *  dossiers listed are only those already loaded (never claimed exhaustive). */
/**
 * « Opérations du site » — ONE module for the normal sheet and the direct (out-of-cache) sheet:
 * the same SiteOperationsView, client, interventionSearch and SLA ticket navigation. The caller
 * gives the exact site + organisation and the write cap; the report limits stay the second cap.
 */
function SiteOperationsSection({ c, siteId, organizationId, canWrite, readOnlyReason }: { c: Ctx; siteId: string; organizationId: string | undefined; canWrite: boolean; readOnlyReason: string }) {
  const { session } = c;
  const opsState = session.capabilities.siteOperations;
  const opsMessage = opsState === "available" ? "" : CONTRACT_MESSAGES[opsState];
  return (
    <section className={cx("panel", styles.operationsPanel)} aria-labelledby="site-operations">
      <h2 id="site-operations">Opérations du site</h2>
      <p className={styles.muted}>
        Équipements, maintenance, budget, grilles, délais et contrôles enregistrés pour ce site.
      </p>
      {opsState === "unavailable" ? (
        <FeatureUnavailable session={session} featureKey="siteOperations" title="Opérations du site momentanément indisponibles" hint={{ siteId }} />
      ) : (
        <SiteOperationsView
          state={opsState}
          unavailableMessage={opsMessage}
          scope={leafScope(session.profileId, session.role, canWrite ? { canWrite: true } : { canWrite: false, reason: readOnlyReason }, { organizationId, siteId })}
          client={session.features.siteOperations}
          demo={session.mode === "demo" ? demoReport() : undefined}
          interventionSearch={session.mode === "demo" ? undefined : { context: session.mutationContext }}
          onNavigate={(view, param) => {
            if (view === "intervention" && param) session.openIntervention(param);
          }}
        />
      )}
    </section>
  );
}

/**
 * ENT-08 — operations of a site loaded by its exact read (absent from the bootstrap cache). Mounted
 * ONLY after SiteDirectLoader is ready for THIS organisation and only for a non-archived site, so the
 * probe and the reads happen exactly then. Write cap = the settings GET's can_write (never the cache).
 */
function DirectSiteOperations({ c, site, canWrite }: { c: Ctx; site: { id: string; organization_id: string }; canWrite: boolean }) {
  useProbeWhenUnknown(c.session, "siteOperations", { siteId: site.id });
  return (
    <SiteOperationsSection
      c={c}
      siteId={site.id}
      organizationId={site.organization_id}
      canWrite={canWrite}
      readOnlyReason={c.authority.readOnlyReason || "Lecture seule sur ce site."}
    />
  );
}

function DirectSiteSheet({ c, id }: { c: Ctx; id: string }) {
  const { session } = c;
  // Same site-level « inaccessible » as the full sheet, keyed by identity + site.
  const directScope = `${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${id}`;
  const [forbiddenScope, setForbiddenScope] = useState<string | null>(null);
  const back = (
    <button type="button" className="button outline" onClick={() => c.go("sites")}>
      Retour aux sites
    </button>
  );
  return (
    <SiteDirectLoader
      siteId={id}
      organizationId={c.organization?.id ?? null}
      context={session.mutationContext}
      demo={session.mode === "demo"}
      back={back}
      render={(site, state, reload) => {
        const archived = site.archived_at !== null;
        if (forbiddenScope === directScope)
          return (
            <div data-site-sheet="inaccessible">
              <button type="button" className="back-link" onClick={() => c.go("sites")}>
                <Icon name="back" size={17} />
                Retour aux sites
              </button>
              <section className="panel" role="alert">
                <h2>Site inaccessible</h2>
                <p className={styles.muted}>{RECORDS_COPY.notFound}</p>
              </section>
            </div>
          );
        return (
          <div data-site-sheet="direct" data-site-archived={archived ? "" : undefined}>
            <button type="button" className="back-link" onClick={() => c.go("sites")}>
              <Icon name="back" size={17} />
              Retour aux sites
            </button>
            <div className={styles.sheetHeader}>
              <div>
                <span className={styles.kicker}>Fiche de site</span>
                <h1>
                  {site.name}
                  <Tag tone="blue">{SITE_TYPES[site.type] || "Site"}</Tag>
                  {archived && <Tag tone="neutral">Archivé</Tag>}
                </h1>
                <p>
                  <Icon name="location" size={15} />
                  {site.address}
                </p>
              </div>
              <div className={styles.sheetActions}>
                {/* ENT-03: active site + server can_write (settings GET) ⇒ request creation for THIS site. */}
                {!archived && state.canWrite && session.mode !== "demo" ? (
                  <button type="button" className="button primary" onClick={() => c.go("new", site.id)} data-direct-new-request="">
                    <Icon name="plus" size={16} />
                    Nouvelle demande
                  </button>
                ) : (
                  <ReadOnlyNote
                    reason={
                      archived
                        ? "Site archivé : ses paramètres et son historique restent consultables. Ce site ne reçoit plus de nouvelle demande."
                        : "Site absent des données chargées : seules ses informations serveur sont affichées ici."
                    }
                  />
                )}
              </div>
            </div>
            <div className={styles.twoCol}>
              {/* Live: mounted only here, i.e. after SiteDirectLoader proved the organization and the site. */}
              {session.mode === "demo" ? (
                <section className="panel" aria-labelledby="site-direct-interventions">
                  <h2 id="site-direct-interventions">Interventions chargées</h2>
                  {session.data.interventions.some((i) => i.site_id === site.id) ? (
                    byDateDesc(session.data.interventions.filter((i) => i.site_id === site.id)).map((i) => (
                      <button key={i.id} type="button" className={cx(styles.listRow, styles.listRowButton, styles.datedRow)} onClick={() => session.openIntervention(i.id)}>
                        <time dateTime={i.created_at}>{date(i.created_at)}</time>
                        <section>
                          <strong>{category(i.category).label}</strong>
                          <small>{shortId(i.id)} · {dateTime(i.created_at)}</small>
                        </section>
                        <Badge status={i.status} />
                        <Icon name="arrow" size={16} />
                      </button>
                    ))
                  ) : (
                    <p className={styles.muted}>Aucun dossier de ce site parmi les interventions chargées.</p>
                  )}
                  <p className={styles.note}>Seuls les dossiers déjà chargés sont listés : la liste peut être incomplète.</p>
                </section>
              ) : (
                <SiteInterventionsPanel session={session} siteId={site.id} headingId="site-direct-interventions" onForbidden={() => setForbiddenScope(directScope)} />
              )}
              <SiteSettingsPanel
                siteId={site.id}
                context={session.mutationContext}
                demo={false}
                initial={state}
                onChanged={() => {
                  reload();
                  void session.refresh();
                }}
              />
              {!archived && <SiteAreasPanel siteId={site.id} context={session.mutationContext} demo={false} />}
              {!archived && <SiteContactsPanel siteId={site.id} context={session.mutationContext} />}
            </div>
            {session.mode !== "demo" && (
              <SiteComplianceRecords
                key={`compliance|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${site.organization_id}|${site.id}`}
                siteId={site.id}
                context={session.mutationContext}
                canWrite={!archived && state.canWrite}
                busy={session.busy}
                complete={(row) => session.professionalCommand({
                  action: "save_compliance",
                  id: row.id,
                  site_id: site.id,
                  title: row.title,
                  kind: row.kind,
                  due_on: row.due_on,
                  status: "completed",
                  notes: row.notes,
                })}
                kindLabels={COMPLIANCE_KIND}
                statusLabels={COMPLIANCE_STATUS}
              />
            )}
            {/* ENT-08: same operations module (maintenance, plans, visits…) for an active site read exactly;
                archived ⇒ not mounted (no probe, no new write). Keyed on identity + organisation + site. */}
            {!archived && session.mode !== "demo" && (
              <DirectSiteOperations
                key={`${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${site.organization_id}|${site.id}`}
                c={c}
                site={site}
                canWrite={state.canWrite && site.archived_at === null}
              />
            )}
            {/* ENT-09 / ENT-05: the EXISTING energy and co-ownership panels, only for an active site proven in
                the current organisation (rendered by the loader only then); rights stay each panel's server
                permissions. Archived / demo / other organisation ⇒ nothing mounted, nothing read. */}
            {!archived && session.mode !== "demo" && (
              <SiteEnergyPanel
                key={`${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${site.organization_id}|${site.id}`}
                siteId={site.id}
                context={session.mutationContext}
              />
            )}
            {/* ENT-04: read-only documents of THIS site (also archived: the server proves the exact right). */}
            {session.mode !== "demo" && (
              <SiteDocumentsPanel
                key={`docs|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${site.organization_id}|${site.id}`}
                siteId={site.id}
                organizationId={site.organization_id}
                context={session.mutationContext}
                onOpenDossier={(iid) => session.openIntervention(iid)}
                headingId="site-direct-docs"
              />
            )}
            {/* ENT-04 / SYS-06: site pieces on the direct sheet; upload only for an active site with the
                settings GET can_write (archived ⇒ read only). */}
            {session.mode !== "demo" && (
              <SiteAttachmentsPanel
                key={`attach|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${site.organization_id}|${site.id}`}
                siteId={site.id}
                organizationId={site.organization_id}
                context={session.mutationContext}
                canUpload={state.canWrite && !archived}
                archived={archived}
                headingId="site-direct-attachments"
              />
            )}
            {!archived && session.mode !== "demo" && site.type === "syndic" && (
              <CoOwnershipPanel
                key={`${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${site.organization_id}|${site.id}`}
                siteId={site.id}
                context={session.mutationContext}
                demo={false}
              />
            )}
          </div>
        );
      }}
    />
  );
}

/** Asset labels and choices from the EXISTING APIs only (first page of active areas + the site
 *  operations equipment). Partial lists are reported as such; nothing is guessed. */
function siteAssetSource(session: Session, siteId: string): AssetSource {
  return async () => {
    const [areas, ops] = await Promise.all([
      createAreasApi().list(siteId, null).catch(() => null),
      session.features.siteOperations.load(siteId).catch(() => null),
    ]);
    const page = areas && areas.status === 200 ? parseAreasPage(areas.body, siteId, true) : null;
    if (!page && !ops) return null;
    return {
      assets: [
        ...(ops?.snapshot.equipment ?? []).map((e) => ({ kind: "equipment" as const, id: e.id, label: e.name, archived: e.status === "retired" })),
        ...(page?.records ?? []).map((a) => ({ kind: "area" as const, id: a.id, label: a.label, archived: a.archived_at !== null })),
      ],
      complete: Boolean(page?.page.complete) && Boolean(ops) && !ops!.snapshot.limits.equipment_limited,
    };
  };
}

// ---- Approbations ----------------------------------------------------------------------------
/** Exported for tests only (live approvals wiring). */
export function ApprovalsView({ c }: { c: Ctx }) {
  // Live (ENT-12): the list comes ONLY from the server (organization + global site + status filter,
  // paginated). Demo: local list unchanged, zero call.
  const live = !c.demo;
  const [filter, setFilter] = useState<ApprovalFilter>("all");
  const server = useApprovalsList({ enabled: live, context: c.session.mutationContext, organizationId: c.organization?.id ?? null, siteId: c.activeSite?.id ?? null, status: filter });
  if (live)
    return (
      <>
        <PageTitle
          title="Devis & approbations"
          subtitle={c.organization ? `Liste du serveur · ${c.activeSite ? c.activeSite.name : "tous les sites de l’organisation"}` : APPROVALS_COPY.chooseOrg}
          action={
            <button type="button" className="button outline" onClick={() => c.go("contracts")}>
              <Icon name="shield" size={17} />
              Règles d’approbation
            </button>
          }
        />
        <section className="panel" aria-label="Liste des approbations" data-approvals={server.state.phase}>
          <div className={styles.segmentsWrap}>
            <Segments
              label="Filtrer les approbations"
              value={filter}
              options={[
                ["all", "Toutes"],
                ["pending", "En attente"],
                ["approved", "Approuvées"],
                ["rejected", "Refusées"],
              ]}
              onChange={setFilter}
            />
          </div>
          {!c.organization ? (
            <p className={styles.muted}>{APPROVALS_COPY.chooseOrg}</p>
          ) : server.state.phase === "loading" || server.state.phase === "idle" ? (
            <p className={styles.muted} role="status">{APPROVALS_COPY.loading}</p>
          ) : server.state.phase === "forbidden" ? (
            <p className={styles.muted} role="alert" data-approvals-inaccessible="">{server.state.error}</p>
          ) : server.state.phase === "error" ? (
            <div role="alert">
              <p className={styles.muted}>{server.state.error}</p>
              <button type="button" className="button outline" onClick={() => server.retry()}>Réessayer</button>
            </div>
          ) : server.state.items.length ? (
            server.state.items.map((a) => <ServerApprovalRow key={a.id} c={c} approval={a} />)
          ) : (
            <Empty icon="receipt" title={filter === "all" ? "Aucune approbation sur ce périmètre" : "Aucune approbation pour ce filtre"}>
              Les devis qui dépassent le seuil d’un site apparaîtront ici pour décision.
            </Empty>
          )}
          {server.state.failed === "more" && (
            <div role="alert">
              <p className={styles.muted}>{server.state.error}</p>
              <button type="button" className="button outline" onClick={() => server.retry()}>Réessayer</button>
            </div>
          )}
          {server.state.phase === "ready" && server.state.next && server.state.failed !== "more" && (
            <button type="button" className="button outline" disabled={server.state.loadingMore} onClick={() => server.more()} data-approvals-more="">
              {server.state.loadingMore ? "Chargement…" : APPROVALS_COPY.more}
            </button>
          )}
        </section>
      </>
    );
  const rows = [...c.scope.approvals].sort(
    (a, b) =>
      Number(b.status === "pending") - Number(a.status === "pending") ||
      Date.parse(b.created_at || "") - Date.parse(a.created_at || ""),
  );
  const pending = rows.filter((a) => a.status === "pending").length;
  return (
    <>
      <PageTitle
        title="Devis & approbations"
        subtitle={`${pending} en attente · ${rows.length} au total sur le périmètre`}
        action={
          <button type="button" className="button outline" onClick={() => c.go("contracts")}>
            <Icon name="shield" size={17} />
            Règles d’approbation
          </button>
        }
      />
      <section className="panel" aria-label="Liste des approbations">
        {rows.length ? (
          rows.map((a) => <ApprovalRow key={a.id} c={c} approval={a} />)
        ) : (
          <Empty icon="receipt" title="Aucune approbation sur ce périmètre" action={
            <button type="button" className="button outline" onClick={() => c.go("contracts")}>
              Configurer une règle
            </button>
          }>
            Les devis qui dépassent le seuil d’un site apparaîtront ici pour décision.
          </Empty>
        )}
      </section>
    </>
  );
}

/** Exported for tests only (live approval point read). The decision form state (choice, note, error)
 *  is bound to identity + organization + site + approval id: any change remounts it from scratch. */
export function ApprovalDetail({ c, id }: { c: Ctx; id: string }) {
  const k = `${c.session.mutationContext.userId() ?? "-"}|${c.session.mutationContext.generation()}|${c.organization?.id ?? "-"}|${c.activeSite?.id ?? "-"}|${id}`;
  return <ApprovalDetailInner key={k} c={c} id={id} />;
}
function ApprovalDetailInner({ c, id }: { c: Ctx; id: string }) {
  const { session } = c;
  // Live (ENT-12): exact point read of THIS approval (row + site rule), never the 200-row cache.
  const live = !c.demo;
  const point = useApprovalPoint({ enabled: live, context: session.mutationContext, approvalId: id, organizationId: c.organization?.id ?? null, siteId: c.activeSite?.id ?? null });
  const serverRow = live && point.state.phase === "ready" ? point.state.data!.approval : null;
  const cached = c.scope.approvals.find((a) => a.id === id) ||
    session.professional.approvals.find((a) => a.id === id && c.orgSites.some((s) => s.id === a.site_id));
  const approval = live ? (serverRow ? { id: serverRow.id, quote_id: serverRow.quote_id, site_id: serverRow.site_id, status: serverRow.status, note: serverRow.note, decided_by: serverRow.decided_by, created_at: serverRow.created_at, decided_at: serverRow.decided_at } : undefined) : cached;
  const [decision, setDecision] = useState<"approved" | "rejected" | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  if (live && !c.organization)
    return <Empty icon="receipt" title={APPROVALS_COPY.chooseOrg} action={<button type="button" className="button outline" onClick={() => c.go("approvals")}>Retour à la liste</button>} />;
  if (live && point.state.phase !== "ready")
    return (
      <section className="panel" data-approval-point={point.state.phase}>
        <button type="button" className="back-link" onClick={() => c.go("approvals")}>
          <Icon name="back" size={17} />
          Retour à la liste
        </button>
        {point.state.phase === "loading" || point.state.phase === "idle" ? (
          <p className={styles.muted} role="status">{APPROVALS_COPY.loading}</p>
        ) : point.state.phase === "forbidden" ? (
          <p className={styles.muted} role="alert" data-approval-inaccessible="">{point.state.error}</p>
        ) : (
          <div role="alert">
            <p className={styles.muted}>{point.state.error}</p>
            <button type="button" className="button outline" onClick={() => point.retry()}>Réessayer</button>
          </div>
        )}
      </section>
    );
  if (!approval)
    return (
      <Empty
        icon="receipt"
        title="Approbation introuvable sur ce périmètre"
        action={
          <button type="button" className="button outline" onClick={() => c.go("approvals")}>
            Retour à la liste
          </button>
        }
      />
    );
  const quote = session.data.quotes.find((q) => q.id === approval.quote_id);
  const intervention = quote ? c.orgInterventions.find((i) => i.id === quote.intervention_id) : undefined;
  const site = c.orgSites.find((s) => s.id === (approval.site_id || intervention?.site_id));
  // Live: the exact dossier / quote / site / rule of THIS approval come from the point read.
  const exactDossierId = serverRow ? serverRow.intervention.id : intervention?.id ?? null;
  const exactAmount = serverRow ? serverRow.quote.total_cents : quote ? quote.total_cents : null;
  const exactSiteName = serverRow ? serverRow.site.name : site?.name ?? null;
  const documents = intervention ? session.data.documents.filter((d) => d.intervention_id === intervention.id) : [];
  const members = session.data.organization_members;
  const actorName = (actorId?: string | null) =>
    !actorId
      ? "—"
      : actorId === session.profileId
        ? session.displayName
        : members.some((m) => m.user_id === actorId)
          ? "Membre de l’organisation"
          : "Acteur non résolu";
  const meta = approvalMeta(approval.status);
  const rule = live
    ? point.state.data!.rule // null = no rule for this exact site, proven by the server
    : session.professional.approval_rules.find((r) => r.site_id === (approval.site_id || intervention?.site_id));
  // Décision : rôle de membre (règle du site) ET écriture sur le site du devis (portée).
  const role = c.authority.role;
  const decisionSiteId = approval.site_id || intervention?.site_id;
  const decisionBlocked =
    role === "viewer"
      ? "Votre accès à cette organisation est en lecture seule : la décision revient à un gestionnaire ou au propriétaire."
      : !c.authority.canWriteSite(decisionSiteId)
        ? c.authority.readOnlyReason || "Vos droits d’écriture ne couvrent pas le site de ce devis."
        : rule?.required_role === "owner" && role === "manager"
          ? "La règle de ce site réserve la décision au propriétaire de l’organisation."
          : "";
  const history = [
    {
      date: approval.created_at || "",
      status: "Soumis",
      tone: "blue" as const,
      actor: "Règle d’approbation du site",
      comment: "—",
    },
    ...(approval.decided_at
      ? [
          {
            date: approval.decided_at,
            status: meta.label,
            tone: meta.tone,
            actor: actorName(approval.decided_by),
            comment: approval.note || "—",
          },
        ]
      : []),
    ...(session.professional.audit || [])
      .filter((e) => e.subject_id === approval.id)
      .map((e) => ({
        date: e.created_at,
        status: live ? "Journal (événement chargé)" : "Événement du journal",
        tone: "neutral" as const,
        actor: actorName(e.actor_id),
        comment: e.action.replace(/_/g, " "),
      })),
  ].sort((a, b) => Date.parse(a.date || "") - Date.parse(b.date || ""));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!decision) {
      setError("Choisissez Approuver ou Refuser avant d’enregistrer.");
      return;
    }
    if (decision === "rejected" && !note.trim()) {
      setError("Un commentaire est obligatoire en cas de refus.");
      return;
    }
    setError("");
    const ok = await session.professionalCommand({
      action: "decide_approval",
      approval_id: approval!.id,
      decision,
      note: note.trim(),
    });
    // Server-confirmed only: re-read the exact approval (no local patch).
    if (ok && live) point.refresh();
  }

  return (
    <>
      <nav className={styles.breadcrumb} aria-label="Fil d’Ariane">
        <button type="button" onClick={() => c.go("approvals")}>
          Devis
        </button>
        <Icon name="arrow" size={14} />
        <span>Approbations</span>
      </nav>
      <PageTitle
        title="Approbation d’un devis"
        subtitle={`Décision tracée pour ${c.organization?.name || "l’organisation"}`}
        action={
          <button type="button" className="button outline" onClick={() => c.go("approvals")}>
            <Icon name="back" size={16} />
            Retour à la liste
          </button>
        }
      />
      <div className={styles.approvalGrid}>
        <section className="panel" aria-labelledby="approval-quote">
          <h2 id="approval-quote">Détails du devis</h2>
          <div className={styles.quoteFacts} style={{ marginTop: 14 }}>
            <div>
              <small>Référence</small>
              <strong>{quoteRef(approval.quote_id)}</strong>
            </div>
            <div>
              <small>Site</small>
              <strong>{exactSiteName || "Site non chargé"}</strong>
              {site && <p>{site.address}</p>}
            </div>
            <div>
              <small>Artisan</small>
              <strong data-approval-artisan="">{live && !intervention ? "Attribution à consulter dans le dossier" : intervention?.artisan_id ? "Artisan attribué" : "Non attribué"}</strong>
              <p>Identité consultable dans le dossier d’intervention.</p>
            </div>
            <div>
              <small>Date de réception</small>
              <strong>{approval.created_at ? dateTime(approval.created_at) : "—"}</strong>
            </div>
            <div className={styles.quoteFactsWide}>
              <small>Description de l’intervention</small>
              {serverRow ? (
                <p>
                  {category(serverRow.intervention.category).label} · {shortId(serverRow.intervention.id)}
                  {intervention ? ` — ${intervention.description}` : ""}
                </p>
              ) : intervention ? (
                <p>
                  {category(intervention.category).label} · {shortId(intervention.id)} — {intervention.description}
                </p>
              ) : (
                <p>Dossier non chargé sur ce périmètre.</p>
              )}
              {exactDossierId && (
                <button type="button" className={styles.textLink} onClick={() => (live ? session.openIntervention(exactDossierId) : session.openIntervention(exactDossierId, approval.quote_id))} data-approval-open-dossier={exactDossierId}>
                  {/* Live: the dossier point read may omit this quote (capped); the exact quote stays below (QuoteDocumentsAnchor). */}
                  {live ? "Ouvrir le dossier" : "Ouvrir le dossier et le devis"}
                  <Icon name="arrow" size={15} />
                </button>
              )}
            </div>
            <div className={styles.quoteFactsWide}>
              <small data-approval-documents-label="">{live ? "Pièces jointes (documents chargés)" : "Pièces jointes"}</small>
              {documents.length ? (
                documents.map((d) => (
                  <p key={d.id}>
                    {d.name} · {date(d.created_at)}
                  </p>
                ))
              ) : (
                <p>Aucune pièce jointe enregistrée pour cette intervention.</p>
              )}
            </div>
          </div>
          <div className={styles.amountBlock}>
            <span>Montant TTC{serverRow ? " (devis de base)" : ""}</span>
            {exactAmount !== null ? (
              <>
                <strong>{money(exactAmount)}</strong>
                {quote && <Tag tone="green">TVA {String(quote.tax_rate).replace(".", ",")} % incluse</Tag>}
              </>
            ) : (
              <strong>Devis non chargé</strong>
            )}
          </div>
        </section>


        <section className="panel" aria-labelledby="approval-decision">
          <h2 id="approval-decision">Votre décision</h2>
          {live && (
            <p className={styles.muted} data-approval-rule={rule ? "rule" : "none"}>
              {rule
                ? `Règle du site : décision ${rule.required_role === "owner" ? "réservée au propriétaire" : "par un gestionnaire"} au-delà de ${money(rule.threshold_cents)}${rule.enabled ? "" : " (règle désactivée)"}.`
                : APPROVALS_COPY.noRule}
            </p>
          )}
          {approval.status !== "pending" ? (
            <>
              <p className={styles.muted} style={{ marginTop: 10 }}>
                Décision enregistrée{approval.decided_at ? ` le ${dateTime(approval.decided_at)}` : ""} par {actorName(approval.decided_by)}.
              </p>
              <div style={{ marginTop: 12 }}>
                <Tag tone={meta.tone}>{meta.label}</Tag>
              </div>
              {approval.note && <p className={styles.description}>{approval.note}</p>}
            </>
          ) : decisionBlocked ? (
            <Unavailable title="Décision réservée" reason={decisionBlocked} />
          ) : (
            <form onSubmit={submit} style={{ marginTop: 14 }}>
              <div className={styles.decisionButtons} role="group" aria-label="Choix de la décision">
                <button
                  type="button"
                  className={cx(styles.decisionButton, styles.decisionApprove)}
                  aria-pressed={decision === "approved"}
                  onClick={() => setDecision(decision === "approved" ? "" : "approved")}
                >
                  <Icon name="check" size={18} />
                  Approuver
                </button>
                <button
                  type="button"
                  className={cx(styles.decisionButton, styles.decisionReject)}
                  aria-pressed={decision === "rejected"}
                  onClick={() => setDecision(decision === "rejected" ? "" : "rejected")}
                >
                  <Icon name="close" size={18} />
                  Refuser
                </button>
              </div>
              <Field
                label={decision === "rejected" ? "Commentaire (obligatoire pour un refus)" : "Commentaire (facultatif)"}
                error={error}
              >
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Motivez votre décision…"
                />
              </Field>
              <span className={styles.counter} aria-live="polite">
                {note.length} / 2000
              </span>
              <button type="submit" className="button primary full" disabled={session.busy || !decision}>
                <Icon name="send" size={17} />
                {session.busy ? "Enregistrement…" : "Enregistrer ma décision"}
              </button>
            </form>
          )}
        </section>
      </div>

      {/* V5-C08 : documents, validité et avenants sous la décision, pleine largeur (JSX de l’ancrage inchangé). */}
      <section className={styles.approvalDocuments} aria-label="Documents, validité et avenants du devis">
        <QuoteDocumentsAnchor
          session={session}
          variant="enterprise"
          target={{ quoteId: approval.quote_id }}
          authority={
            c.authority.canWriteSite(decisionSiteId)
              ? { canWrite: true }
              : { canWrite: false, reason: c.authority.readOnlyReason || "Vos droits d’écriture ne couvrent pas le site de ce devis." }
          }
          organizationId={c.organization?.id}
          siteId={decisionSiteId || undefined}
        />
      </section>
      <section className="panel" aria-labelledby="approval-history">
        <h2 id="approval-history">Historique des statuts</h2>
        <table className={styles.historyTable} style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Statut</th>
              <th scope="col">Acteur</th>
              <th scope="col">Commentaire</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, index) => (
              <tr key={index}>
                <td>{h.date ? dateTime(h.date) : "—"}</td>
                <td>
                  <Tag tone={h.tone}>{h.status}</Tag>
                </td>
                <td>{h.actor}</td>
                <td>{h.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.footNote}>
          <Icon name="lock" size={15} />
          Les décisions sont enregistrées et tracées côté serveur.
          {live && <span data-approval-journal-note=""> Journal (événements chargés) : les événements affichés sont ceux déjà chargés.</span>}
        </p>
      </section>
    </>
  );
}

/** #quote/<id> (deep links, notifications). Every quote id is honoured EXACTLY:
 *  - a loaded quote ⇒ its dossier with THAT version as the initial one (never the current by default);
 *  - an explicitly loaded dossier id ⇒ that dossier, as before;
 *  - live, otherwise ⇒ the exact point read (EnterpriseQuoteView); its 404 keeps the dossier-id meaning,
 *    a 401/403 stays « inaccessible » (never another quote). Exported for tests only. */
export function EnterpriseQuoteRoute({ c, ref_ }: { c: Ctx; ref_: string }) {
  const { session } = c;
  const quote = (c.demo ? session.data.quotes : c.scope.quotes).find((q) => q.id === ref_);
  if (quote) return <DossierView key={`${quote.intervention_id}-${quote.id}`} c={c} id={quote.intervention_id} initialQuoteId={quote.id} />;
  if (session.mode === "live" && !c.scope.interventions.some((i) => i.id === ref_)) return <EnterpriseQuoteView c={c} quoteId={ref_} />;
  return <DossierView key={`${ref_}-${session.selectedQuoteId}`} c={c} id={ref_} />;
}

/** Exact enterprise quote by id (live, outside the caches): GET /api/quotes/<id>?organization_id=&site_id=.
 *  A 404 keeps the former meaning of the link (a dossier id); 401/403 ⇒ inaccessible.
 *  ENT-12 guarded decision, offered ONLY when every proof holds (re-checked at click, before any POST):
 *   1. the exact scoped point read: same id, « sent », is_current AND current_quote_id === id, dossier « quoted »;
 *   2. GET /api/quotes/<id>/decision-context: same quote / dossier / site, can_write, validity not expired;
 *   3. the existing authority c.authority.canWriteSite(site);
 *   4. the simple rule (applies only if enabled AND TTC > threshold) ⇒ the exact approval « approved »,
 *      and the advanced workflow (QuoteApprovalPanel read) — both through the existing acceptanceDecision.
 *  Commands: the EXISTING POSTs only — session.action(dossier, "accept_quote", { quote_id }) via
 *  ConfirmAction, and session.operate(dossier, { action: "reject_quote", quote_id, reason }) with the
 *  existing reason flow. After any outcome: re-read the quote, its decision context and its approval.
 *  Old / not-current versions stay read-only; `is_current` alone never enables anything. */
export function EnterpriseQuoteView({ c, quoteId }: { c: Ctx; quoteId: string }) {
  // FULL scope key (identity + organization + site + quote): any change remounts the whole subtree —
  // proofs, advanced read, decision form, refusal note and the QuoteApprovalPanel are cleared at the
  // first render of the new scope; a late reply of the old scope lands on an unmounted instance.
  const k = `${c.session.mutationContext.userId() ?? "-"}|${c.session.mutationContext.generation()}|${c.organization?.id ?? "-"}|${c.activeSite?.id ?? "-"}|${quoteId}`;
  return <EnterpriseQuoteInner key={k} c={c} quoteId={quoteId} />;
}
function EnterpriseQuoteInner({ c, quoteId }: { c: Ctx; quoteId: string }) {
  const { session } = c;
  const point = useRecipientQuote({ enabled: !c.demo, context: session.mutationContext, quoteId, scope: { org: c.organization?.id ?? null, site: c.activeSite?.id ?? null } });
  // ENT-12 decision on this EXACT quote: decision context (scope rights, simple rule / approval,
  // validity) + the existing advanced approval read, combined by the existing acceptanceDecision.
  // Read only for a version that could be decided (exact current « sent »): never for old / 404 ones.
  const candidate = point.state.phase === "ready" && point.state.data!.quote.status === "sent" && point.state.data!.version.is_current;
  const decisionCtx = useDecisionContext({ enabled: !c.demo && candidate, context: session.mutationContext, quoteId, organizationId: c.organization?.id ?? null, siteId: c.activeSite?.id ?? null });
  const [advancedRead, setAdvancedRead] = useState<{ quoteId: string; status: WorkflowStatus | null } | null>(null);
  const [approvalRound, setApprovalRound] = useState(0);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  // Latest proofs, re-checked at click time (before any POST).
  const proofRef = useRef<() => boolean>(() => false);
  if (!c.organization) return <Empty icon="document" title={QUOTES_COPY.chooseOrg} />;
  // 404: not a quote of this scope — the link keeps its former meaning (a dossier id), read exactly by DossierView.
  if (point.state.phase === "forbidden" && point.state.notFound)
    return <DossierView key={quoteId} c={c} id={quoteId} />;
  if (point.state.phase !== "ready")
    return (
      <section className="panel" data-enterprise-quote={point.state.phase}>
        {point.state.phase === "loading" || point.state.phase === "idle" ? (
          <p className={styles.muted} role="status">{QUOTES_COPY.loadingOne}</p>
        ) : point.state.phase === "forbidden" ? (
          <p className={styles.muted} role="alert" data-enterprise-quote-inaccessible="">{point.state.error}</p>
        ) : (
          <div role="alert">
            <p className={styles.muted}>{point.state.error}</p>
            <button type="button" className="button outline" onClick={() => point.retry()}>Réessayer</button>
          </div>
        )}
      </section>
    );
  const { quote, intervention, version } = point.state.data!;
  const statusLabel = quote.status === "accepted" ? "Accepté" : quote.status === "rejected" ? "Refusé" : "Envoyé";
  // Every proof, all required (never inferred from an error, a stale read or another scope).
  const exactCurrent = quote.id.toLowerCase() === quoteId.toLowerCase() && quote.status === "sent" && version.is_current && version.current_quote_id === quote.id && intervention.status === "quoted";
  const ctx = decisionCtx.state.phase === "ready" ? decisionCtx.state.data : null;
  const ctxMatches = !!ctx && ctx.quote_id.toLowerCase() === quote.id.toLowerCase() && ctx.intervention_id.toLowerCase() === intervention.id.toLowerCase() && !!intervention.site_id && ctx.site_id.toLowerCase() === intervention.site_id.toLowerCase();
  const advanced: WorkflowStatus | null | undefined = advancedRead?.quoteId === quote.id ? advancedRead.status : undefined;
  const acceptance = ctxMatches ? acceptanceDecision(decisionSimplePending(ctx!, quote.total_cents), advanced, true, true) : { blocked: true, reason: "unknown" as const };
  const expired = ctx?.validity.state === "expired";
  const decidable = exactCurrent && ctxMatches && ctx!.can_write && !acceptance.blocked && !expired && c.authority.canWriteSite(intervention.site_id);
  proofRef.current = () => decidable;
  const blockedReason = !exactCurrent
    ? null
    : decisionCtx.state.phase === "loading" || decisionCtx.state.phase === "idle"
      ? DECISION_COPY.loading
      : decisionCtx.state.phase !== "ready" || !ctxMatches
        ? decisionCtx.state.phase === "forbidden" ? DECISION_COPY.inaccessible : DECISION_COPY.failed
        : expired
          ? DECISION_COPY.expired
          : !ctx!.can_write || !c.authority.canWriteSite(intervention.site_id)
            ? DECISION_COPY.noWrite
            : acceptance.blocked
              ? acceptance.reason === "advanced" ? DECISION_COPY.advanced : acceptance.reason === "simple" ? DECISION_COPY.simple : DECISION_COPY.unknown
              : null;
  const rereadAll = () => {
    // After ANY outcome: re-read the exact quote, its decision context and its approval state.
    point.refresh();
    decisionCtx.refresh();
    setAdvancedRead(null);
    setApprovalRound((n) => n + 1);
  };
  async function accept() {
    if (!proofRef.current()) return false; // re-checked at click time: no proof ⇒ no POST
    const ok = await session.action(intervention.id, "accept_quote", { quote_id: quote.id });
    rereadAll();
    return ok;
  }
  async function reject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (reason.trim().length < 5) {
      setReasonError("Indiquez le motif du refus (5 caractères minimum).");
      return;
    }
    if (!proofRef.current()) return;
    setReasonError("");
    const ok = await session.operate(intervention.id, { action: "reject_quote", quote_id: quote.id, reason: reason.trim() });
    if (ok) {
      setRejectOpen(false);
      setReason("");
    }
    rereadAll();
  }
  return (
    <div data-enterprise-quote="ready">
      <PageTitle title={`Devis ${quoteRef(quote.id)}`} subtitle={`Reçu le ${dateTime(quote.created_at)} — ${category(intervention.category).label}, ${shortId(intervention.id)}`} />
      {!version.is_current && (
        <div className="alert warning" role="status" data-enterprise-quote-superseded="">
          <Icon name="info" />
          <span>
            {QUOTES_COPY.readOnly}{" "}
            {version.current_quote_id && (
              <button type="button" className="text-button" onClick={() => c.go("quote", version.current_quote_id!)}>
                Voir la version actuelle
              </button>
            )}
          </span>
        </div>
      )}
      <section className="panel" aria-labelledby="enterprise-quote-lines">
        <h2 id="enterprise-quote-lines">Détail du devis · {statusLabel}</h2>
        <table className={styles.table}>
          <caption className="sr-only">Détail du devis {quoteRef(quote.id)}</caption>
          <thead>
            <tr>
              <th scope="col">Prestation</th>
              <th scope="col">Quantité</th>
              <th scope="col">Prix unitaire HT</th>
              <th scope="col">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((l, k) => (
              <tr key={k}>
                <td data-label="Prestation">{l.label}</td>
                <td data-label="Quantité">{l.quantity}</td>
                <td data-label="Prix unitaire HT">{money(l.unit_price_cents)}</td>
                <td data-label="Total HT">{money(Math.round(l.quantity * l.unit_price_cents))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.keyValue}>
          <span>Sous-total HT</span>
          <strong>{money(quote.subtotal_cents)}</strong>
        </div>
        <div className={styles.keyValue}>
          <span>TVA ({String(quote.tax_rate).replace(".", ",")} %)</span>
          <strong>{money(quote.tax_cents)}</strong>
        </div>
        <div className={styles.keyValue}>
          <span>Total TTC (devis seul)</span>
          <strong data-enterprise-quote-total="">{money(quote.total_cents)}</strong>
        </div>
        {exactCurrent && intervention.site_id && (
          <QuoteApprovalPanel
            key={`${quote.id}|${approvalRound}`}
            quoteId={quote.id}
            context={session.mutationContext}
            demo={c.demo}
            onStatus={(st) => setAdvancedRead({ quoteId: quote.id, status: st })}
          />
        )}
        {decidable ? (
          <div className={styles.quoteActions} data-enterprise-quote-decision="">
            <ConfirmAction
              label="Accepter le devis"
              message={`Accepter la version ${quoteRef(quote.id)} pour ${money(quote.total_cents)} TTC ? L’artisan pourra planifier l’intervention.`}
              confirmLabel="Confirmer l’acceptation"
              className="button primary"
              busy={session.busy}
              onConfirm={accept}
            />
            {!rejectOpen ? (
              <button type="button" className="button outline" disabled={session.busy} onClick={() => setRejectOpen(true)}>
                Refuser ce devis
              </button>
            ) : (
              <form className={styles.rejectForm} onSubmit={reject} data-enterprise-quote-reject="">
                <Field label="Motif du refus (obligatoire)" error={reasonError}>
                  <textarea required minLength={5} maxLength={2000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <div className={styles.actions}>
                  <button type="submit" className="button destructive-button" disabled={session.busy}>
                    {session.busy ? "Enregistrement…" : "Confirmer le refus"}
                  </button>
                  <button type="button" className="button outline" disabled={session.busy} onClick={() => setRejectOpen(false)}>
                    Annuler
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div data-enterprise-quote-blocked-box="">
            <p className={styles.muted} data-enterprise-quote-readonly="" data-enterprise-quote-blocked={blockedReason ? "" : undefined}>
              {exactCurrent ? blockedReason : QUOTES_COPY.readOnly}
            </p>
            {exactCurrent && decisionCtx.state.phase === "error" && (
              // Re-read only (never a POST): a 503 is recoverable without reloading the page.
              <button type="button" className="button outline" onClick={() => decisionCtx.retry()} data-enterprise-quote-ctx-retry="">
                Réessayer
              </button>
            )}
            {exactCurrent && ctxMatches && acceptance.blocked && acceptance.reason === "simple" && ctx!.simple_approval && (
              <button type="button" className={styles.textLink} onClick={() => c.go("approval", ctx!.simple_approval!.id)} data-enterprise-quote-approval={ctx!.simple_approval.id}>
                Ouvrir l’approbation
                <Icon name="arrow" size={15} />
              </button>
            )}
          </div>
        )}
        <button type="button" className="button outline" onClick={() => session.openIntervention(intervention.id)} data-enterprise-quote-dossier={intervention.id}>
          Ouvrir le dossier
        </button>
      </section>
      <section className={styles.approvalDocuments} aria-label="Documents du devis">
        <QuoteDocumentsAnchor
          session={session}
          variant="enterprise"
          target={{ quoteId: quote.id }}
          authority={{ canWrite: false, reason: "Consultation du devis exact (lecture seule)." }}
          organizationId={c.organization?.id}
          siteId={intervention.site_id || undefined}
        />
      </section>
    </div>
  );
}

// ---- Rapports --------------------------------------------------------------------------------
/** Exported for tests only (live report wiring). */
export function ReportsView({ c }: { c: Ctx }) {
  const { session, scope, demo } = c;
  // Export guard: a scope generation bumped AT RENDER on every scope change (identity uid+gen,
  // organization, site) and on unmount. An export applies (download, error, busy) only for the
  // generation captured at its click — A→B→A or a logout invalidates it even if the key looks equal.
  const exportScope = `${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${c.organization?.id ?? "-"}|${c.activeSite?.id ?? "-"}`;
  const scopeGen = useRef({ key: exportScope, gen: 0, mounted: true });
  if (scopeGen.current.key !== exportScope) scopeGen.current = { ...scopeGen.current, key: exportScope, gen: scopeGen.current.gen + 1 };
  useEffect(() => {
    scopeGen.current.mounted = true;
    return () => {
      scopeGen.current = { ...scopeGen.current, gen: scopeGen.current.gen + 1, mounted: false };
    };
  }, []);
  const [exportState, setExportState] = useState<{ gen: number; busy: boolean; error: string }>({ gen: -1, busy: false, error: "" });
  const ownExport = exportState.gen === scopeGen.current.gen;
  const busy = ownExport && exportState.busy;
  const error = ownExport ? exportState.error : "";
  // Live (ENT-15) : tableau et totaux UNIQUEMENT depuis le JSON serveur de /api/reports, même périmètre
  // que l’export CSV (organisation choisie + site éventuel). Aucune organisation choisie ⇒ rien n’est lu
  // et l’export est désactivé. Démo : calcul local inchangé, aucun appel.
  const live = !demo;
  const orgId = c.organization?.id ?? null;
  const siteId = c.activeSite?.id ?? null;
  const report = useEnterpriseReport({ enabled: live, context: session.mutationContext, organizationId: orgId, siteId });
  const rows = scope.sites.map((s) => ({ site: s, ...siteFigures(s, session.data) }));
  const totals = {
    budget: sum(rows.map((r) => r.budget)),
    committed: sum(rows.map((r) => r.committed)),
    paid: sum(rows.map((r) => r.paid)),
    declared: sum(rows.map((r) => r.declared)),
    count: sum(rows.map((r) => r.count)),
  };
  const server = live && report.state.phase === "ready" ? report.state.data : null;
  async function downloadCsv() {
    const gen = scopeGen.current.gen;
    // Identity captured at click and re-read LIVE (a logout applied in the context before the
    // rerender bumps the generation still invalidates the export).
    const uid = session.mutationContext.userId(), mgen = session.mutationContext.generation();
    const current = () => scopeGen.current.mounted && scopeGen.current.gen === gen && session.mutationContext.userId() === uid && session.mutationContext.generation() === mgen;
    setExportState({ gen, busy: false, error: "" });
    if (demo) {
      download(
        "rapport-demo.csv",
        csv([
          ["Site", "Activité", "Budget EUR", "Payé EUR", "Engagé non payé EUR", "Interventions"],
          ...rows.map((r) => [
            r.site.name,
            r.site.type || "",
            (r.budget / 100).toFixed(2),
            (r.paid / 100).toFixed(2),
            ((r.committed - r.paid) / 100).toFixed(2),
            r.count,
          ]),
        ]),
        "text/csv;charset=utf-8",
      );
      return;
    }
    if (!orgId) return;
    setExportState({ gen, busy: true, error: "" });
    try {
      const url = reportQuery(orgId, siteId, "csv");
      const response = await fetch(url, { cache: "no-store" });
      if (!current()) return; // scope changed during the request: dropped silently (state bound to the old generation)
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error((result as { error?: string }).error || "Le rapport n’est pas disponible.");
      }
      // A success must be the server CSV: an HTML (or any non-CSV) 200 is refused.
      if (!/^text\/csv\b/i.test(response.headers.get("content-type") ?? "")) throw new Error("La réponse du serveur n’est pas un fichier CSV : rien n’a été téléchargé.");
      const disposition = response.headers.get("content-disposition");
      if (disposition !== null && !/^attachment;\s*filename="[A-Za-z0-9._-]{1,120}\.csv"$/i.test(disposition)) throw new Error("La réponse du serveur n’est pas un fichier CSV : rien n’a été téléchargé.");
      const body = await response.text();
      if (!current()) return; // scope changed while reading the body: no download
      download("rapport.csv", body, "text/csv;charset=utf-8");
    } catch (e) {
      if (current()) setExportState({ gen, busy: false, error: (e as Error).message });
    } finally {
      if (current()) setExportState((s) => (s.gen === gen ? { ...s, busy: false } : s));
    }
  }
  return (
    <>
      <PageTitle
        title="Rapports"
        subtitle={live ? `Rapport consolidé de ${c.activeSite ? c.activeSite.name : "tous les sites de l’organisation"} · ${REPORT_COPY.serverNote}` : `Rapport consolidé de ${c.activeSite ? c.activeSite.name : "tous les sites"} · ${LOADED_NOTE}`}
        action={
          <button type="button" className="button primary" disabled={busy || (live && !orgId)} onClick={() => void downloadCsv()} data-report-csv="">
            <Icon name="download" size={17} />
            {busy ? "Préparation…" : demo ? "Télécharger l’export de démonstration (CSV généré localement)" : "Télécharger le rapport CSV"}
          </button>
        }
      />
      {error && (
        <div className="alert error" role="alert">
          <Icon name="warning" />
          <span>{error}</span>
        </div>
      )}
      <section className={cx("panel", styles.tablePanel)} aria-labelledby="report-table-title" tabIndex={0} data-report={live ? report.state.phase : "demo"}>
        <div className={styles.tableHead}>
          <div>
            <h2 id="report-table-title">Budget et engagements par site</h2>
            <p className={styles.muted}>{live ? (server?.page ? REPORT_COPY.pageNote : server && !server.scope.complete ? REPORT_COPY.partialNote : REPORT_COPY.totalsNote) : `Totaux ${BASIS} (démonstration) ; l’export CSV de démonstration est généré localement à partir de ces données.`}</p>
          </div>
        </div>
        {live && !orgId ? (
          <p className={styles.muted} data-report-choose-org="">{REPORT_COPY.chooseOrg}</p>
        ) : live && (report.state.phase === "loading" || report.state.phase === "idle") ? (
          <p className={styles.muted} role="status">{REPORT_COPY.loading}</p>
        ) : live && (report.state.phase === "error" || report.state.phase === "forbidden") ? (
          <div role="alert" data-report-error="">
            <p>{report.state.error}</p>
            {report.state.phase === "error" && (
              <button type="button" className="button outline" onClick={() => report.retry()}>
                Réessayer
              </button>
            )}
            {report.pageNumber > 1 && (
              // E61: a failed page > 1 can always go back (re-read of the previous page).
              <button type="button" className="button outline" onClick={() => report.previous()}>
                Page précédente
              </button>
            )}
          </div>
        ) : server ? (
          server.sites.length ? (
            <>
              <ReportBudgetAlerts sites={server.sites} onOpen={(id) => c.go("site", id)} />
              {!server.totals.financial_complete && <p className={styles.muted} data-report-unverified="">{REPORT_COPY.unverified(money(server.totals.unverified_paid_cents))}</p>}
              <table className={styles.table}>
                <caption className="sr-only">Budget et engagements par site</caption>
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col">Budget de référence</th>
                    <th scope="col">Devis acceptés</th>
                    <th scope="col">Paiements Stripe enregistrés</th>
                    <th scope="col">Interventions</th>
                  </tr>
                </thead>
                <tbody>
                  {server.sites.map((r) => (
                    <tr key={r.site_id} data-report-site={r.site_id}>
                      <td data-label="Site">
                        <strong>{r.name}</strong>
                        <span className={styles.cellSub}>{SITE_TYPES[r.type] || "Site"}</span>
                      </td>
                      <td data-label="Budget">{r.budget_cents > 0 ? money(r.budget_cents) : "—"}</td>
                      <td data-label="Devis acceptés">{money(r.accepted_cents)}</td>
                      <td data-label="Paiements Stripe enregistrés">
                        {money(r.paid_cents)}
                        {r.declared_paid_cents > 0 && <span className={styles.cellSub} data-report-declared="">Historiques déclarés sur place : {money(r.declared_paid_cents)}</span>}
                      </td>
                      <td data-label="Interventions">{r.interventions}</td>
                    </tr>
                  ))}
                  <tr data-report-total={server.scope.complete ? "complete" : "partial"}>
                    <td data-label="Total">
                      <strong>{server.page ? `Somme de la page ${report.pageNumber} (pas un total de l’organisation)` : server.scope.complete ? "Total" : "Somme des lignes reçues (non garantie complète)"}</strong>
                    </td>
                    <td data-label="Budget">{server.totals.budget_cents > 0 ? money(server.totals.budget_cents) : "—"}</td>
                    <td data-label="Devis acceptés">{money(server.totals.accepted_cents)}</td>
                    <td data-label="Paiements Stripe enregistrés">
                      {money(server.totals.paid_cents)}
                      {server.totals.declared_paid_cents > 0 && <span className={styles.cellSub} data-report-declared="">Historiques déclarés sur place : {money(server.totals.declared_paid_cents)}</span>}
                    </td>
                    <td data-label="Interventions">{server.sites.reduce((n, r) => n + r.interventions, 0)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : server.page ? (
            // E61: a split scope whose page came back empty (sites removed meanwhile) is not « no site ».
            <p className={styles.muted} data-report-empty-page="">Aucun site sur cette page : le périmètre a pu changer depuis la page précédente.</p>
          ) : (
            <Empty icon="chart" title="Aucun site à consolider">
              Ajoutez un site pour obtenir un rapport.
            </Empty>
          )
        ) : rows.length ? (
          <table className={styles.table}>
            <caption className="sr-only">Budget et engagements par site</caption>
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Budget de référence</th>
                <th scope="col">Devis acceptés</th>
                <th scope="col">Réglé</th>
                <th scope="col">Interventions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.site.id}>
                  <td data-label="Site">
                    <strong>{r.site.name}</strong>
                    <span className={styles.cellSub}>{(r.site.type && SITE_TYPES[r.site.type]) || "Site"}</span>
                  </td>
                  <td data-label="Budget">{r.budget > 0 ? money(r.budget) : "—"}</td>
                  <td data-label="Devis acceptés">{money(r.committed)}</td>
                  <td data-label="Réglé">
                    {money(r.paid)}
                    {r.declared > 0 && <span className={styles.cellSub}>dont {money(r.declared)} déclarés reçus sur place</span>}
                  </td>
                  <td data-label="Interventions">{r.count}</td>
                </tr>
              ))}
              <tr>
                <td data-label="Total">
                  <strong>Total</strong>
                </td>
                <td data-label="Budget">{totals.budget > 0 ? money(totals.budget) : "—"}</td>
                <td data-label="Devis acceptés">{money(totals.committed)}</td>
                <td data-label="Réglé">
                  {money(totals.paid)}
                  {totals.declared > 0 && <span className={styles.cellSub}>dont {money(totals.declared)} déclarés reçus sur place</span>}
                </td>
                <td data-label="Interventions">{totals.count}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <Empty icon="chart" title="Aucun site à consolider">
            Ajoutez un site pour obtenir un rapport.
          </Empty>
        )}
        {live && server?.page && (
          <div className={styles.actions} data-report-pager="">
            <span className={styles.muted}>Page {report.pageNumber}</span>
            {report.pageNumber > 1 && (
              <button type="button" className="button outline" onClick={() => report.previous()}>Page précédente</button>
            )}
            {server.page.has_more && (
              <button type="button" className="button outline" onClick={() => report.next()}>Page suivante</button>
            )}
          </div>
        )}
      </section>
      <EnergyConsolidationPanel
        key={`${c.organization?.id ?? "-"}|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}`}
        organizationId={c.organization?.id ?? null}
        sites={c.orgSites.map((x) => ({ id: x.id, name: x.name, archived: Boolean((x as { archived_at?: string | null }).archived_at) }))}
        demo={demo}
        context={session.mutationContext}
      />
      <div className={styles.threeCol}>
        <Unavailable
          title="Assemblées générales & appels de fonds (consolidé)"
          reason="Les assemblées générales et appels de fonds se consignent copropriété par copropriété, dans la fiche de chaque site en syndic. Aucun total multi-sites n’est calculé ici ; l’application ne calcule aucun quorum et n’encaisse rien."
          blocker="ENT-05"
        />
      </div>
      {demo || !c.organization ? (
        <Unavailable
          title="Respect des SLA (consolidé)"
          reason={
            demo
              ? "En démonstration, aucun rapport SLA consolidé n’est calculé : les délais se suivent site par site dans « Opérations du site »."
              : "Choisissez une organisation pour obtenir le rapport SLA consolidé de ses sites."
          }
          blocker="ENT-11"
        />
      ) : (
        <OrganizationSlaPanel key={`${c.organization.id}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`} organizationId={c.organization.id} context={session.mutationContext} />
      )}
    </>
  );
}

function ReportBudgetAlerts({ sites, onOpen }: {
  sites: readonly { site_id: string; name: string; budget_cents: number; accepted_cents: number }[];
  onOpen(id: string): void;
}) {
  const exceeded = sites.filter((site) => site.budget_cents > 0 && site.accepted_cents > site.budget_cents);
  if (exceeded.length === 0) return null;
  return (
    <section className="alert warning" aria-labelledby="report-budget-alerts" data-report-budget-alerts="">
      <Icon name="warning" />
      <div>
        <h3 id="report-budget-alerts">Budgets de référence dépassés</h3>
        <p>Devis acceptés des sites affichés dans ce rapport.</p>
        <ul>
          {exceeded.map((site) => (
            <li key={site.site_id}>
              <button type="button" className="text-button" onClick={() => onOpen(site.site_id)}>{site.name}</button>
              {" · "}{money(site.accepted_cents - site.budget_cents)} au-dessus du budget de référence
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---- Facturation -----------------------------------------------------------------------------
function InvoicesView({ c }: { c: Ctx }) {
  const { scope, session } = c;
  const payments = byDateDesc(scope.payments);
  return (
    <>
      <PageTitle title="Facturation" subtitle="Trace financière réelle des dossiers chargés" />
      {c.organization ? (
        <CustomerInvoicesPanel
          title="Factures et avoirs émis"
          filters={{ organization_id: c.organization.id, ...(c.activeSite ? { site_id: c.activeSite.id } : {}), basis: "service" }}
          context={session.mutationContext}
          demo={c.demo}
        />
      ) : (
        <Unavailable title="Factures et avoirs" reason="Choisissez une organisation pour consulter ses factures et avoirs émis." blocker="FIN-05" />
      )}
      <p className={styles.muted}>Les relances de paiement ne sont pas envoyées par l’application : aucune relance automatique n’est configurée.</p>
      <section className="panel" aria-labelledby="payments-title">
        <h2 id="payments-title">Règlements</h2>
        {payments.length ? (
          payments.map((p) => {
            const quote = session.data.quotes.find((q) => q.id === p.quote_id);
            const meta = paymentMeta(p.status);
            return (
              <div key={p.id} className={styles.listRow}>
                <section>
                  <strong>{money(p.total_cents)}</strong>
                  <small>
                    {quoteRef(p.quote_id)}
                    {quote ? ` · ${shortId(quote.intervention_id)}` : ""} · {dateTime(p.paid_at || p.created_at)}
                  </small>
                </section>
                <Tag tone={meta.tone}>{meta.label}</Tag>
                {quote && (
                  <button
                    type="button"
                    className={cx("button outline", styles.rowAction)}
                    onClick={() => session.openIntervention(quote.intervention_id, quote.id)}
                  >
                    Dossier
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <p className={styles.muted} style={{ marginTop: 10 }}>
            Aucun règlement enregistré sur ce périmètre.
          </p>
        )}
      </section>
    </>
  );
}

// ---- Membres et accès aux sites (via session) ------------------------------------------------
const INVITATION_META: Record<string, { label: string; tone: "amber" | "green" | "red" | "neutral" }> = {
  pending: { label: "En attente", tone: "amber" },
  accepted: { label: "Acceptée", tone: "green" },
  revoked: { label: "Révoquée", tone: "red" },
  expired: { label: "Expirée", tone: "neutral" },
};
const MEMBERSHIP_EVENT: Record<string, string> = {
  create_invitation: "Invitation créée",
  revoke_invitation: "Invitation révoquée",
  accept_invitation: "Invitation acceptée",
  change_member_role: "Rôle modifié",
  remove_member: "Membre retiré",
  transfer_ownership: "Propriété transférée",
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Libellé lisible d’une portée : « Tous les sites » ou la liste des sites avec le droit. */
function scopeText(access: MemberSiteAccess | null | undefined, sites: Site[]): string {
  if (!access || access.scope !== "selected") return "Tous les sites";
  if (!access.grants.length) return "Sites sélectionnés : aucun";
  const names = access.grants.map((g) => {
    const name = sites.find((s) => s.id === g.site_id)?.name || "Site inconnu";
    return `${name} (${g.can_write ? "écriture" : "lecture"})`;
  });
  return `Sites sélectionnés : ${names.join(", ")}`;
}
/** Portée éventuellement renvoyée avec une invitation (champs optionnels côté serveur). */
function invitationAccess(inv: object): MemberSiteAccess | null {
  const raw = inv as { site_scope?: unknown; site_grants?: unknown };
  if (raw.site_scope !== "selected") return null;
  const grants = Array.isArray(raw.site_grants)
    ? raw.site_grants
        .filter((g): g is SiteGrant => !!g && typeof g === "object" && typeof (g as SiteGrant).site_id === "string")
        .map((g) => ({ site_id: g.site_id, can_write: Boolean(g.can_write) }))
    : [];
  return { user_id: "", scope: "selected", grants };
}

const SCOPE_NOTE =
  "Un membre limité à certains sites ne voit plus les dossiers des autres sites, y compris ceux qu’il a lui-même créés ; cette portée ne délègue aucun pouvoir de paiement.";

/** Choix de portée (tous les sites / sites sélectionnés + écriture par site). */
function SiteScopeControl({
  legend,
  sites,
  scope,
  grants,
  writable,
  disabled,
  error,
  onChange,
}: {
  legend: string;
  sites: Site[];
  scope: SiteScope;
  grants: SiteGrant[];
  /** false pour le rôle Lecture : l’écriture reste désactivée. */
  writable: boolean;
  disabled?: boolean;
  error?: string;
  onChange: (scope: SiteScope, grants: SiteGrant[]) => void;
}) {
  const group = useId();
  const sorted = useMemo(() => [...sites].sort((a, b) => a.name.localeCompare(b.name, "fr")), [sites]);
  const toggleSite = (siteId: string, checked: boolean) =>
    onChange(
      "selected",
      checked
        ? [...grants.filter((g) => g.site_id !== siteId), { site_id: siteId, can_write: false }]
        : grants.filter((g) => g.site_id !== siteId),
    );
  const toggleWrite = (siteId: string, checked: boolean) =>
    onChange(
      "selected",
      grants.map((g) => (g.site_id === siteId ? { ...g, can_write: checked } : g)),
    );
  return (
    <fieldset className={styles.scopeControl} disabled={disabled}>
      <legend>{legend}</legend>
      <div className={styles.scopeRadios}>
        <label>
          <input type="radio" name={group} checked={scope === "all"} onChange={() => onChange("all", [])} />
          Tous les sites
        </label>
        <label>
          <input
            type="radio"
            name={group}
            checked={scope === "selected"}
            onChange={() => onChange("selected", grants)}
          />
          Sites sélectionnés
        </label>
      </div>
      {scope === "selected" &&
        (sorted.length ? (
          <ul className={styles.scopeSites} aria-label="Sites accessibles">
            {sorted.map((s) => {
              const grant = grants.find((g) => g.site_id === s.id);
              const writeOff = !grant || !writable;
              return (
                <li key={s.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(grant)}
                      onChange={(e) => toggleSite(s.id, e.target.checked)}
                    />
                    <span>{s.name}</span>
                  </label>
                  <label className={cx(styles.scopeWrite, writeOff && styles.scopeWriteOff)}>
                    <input
                      type="checkbox"
                      checked={Boolean(grant?.can_write) && writable}
                      disabled={writeOff}
                      onChange={(e) => toggleWrite(s.id, e.target.checked)}
                    />
                    écriture
                    <span className="sr-only"> pour {s.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.note}>Aucun site dans cette organisation : ajoutez un site avant de restreindre l’accès.</p>
        ))}
      {scope === "selected" && !writable && (
        <p className={styles.note}>Le rôle Lecture reste en lecture seule : l’écriture ne peut pas lui être accordée.</p>
      )}
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
      <p className={styles.note}>{SCOPE_NOTE}</p>
    </fieldset>
  );
}

/** Ligne membre : rôle, portée des sites et, pour le propriétaire, l’éditeur « Accès aux sites ». */
function MemberItem({
  c,
  orgId,
  member,
  me,
  manageable,
  canEditAccess,
  access,
  scopeLine,
  command,
  onSaved,
}: {
  c: Ctx;
  orgId: string;
  member: { user_id: string; role: string; full_name: string };
  me: boolean;
  manageable: boolean;
  canEditAccess: boolean;
  access: MemberSiteAccess | undefined;
  scopeLine: string;
  command: (body: OrganizationCommand) => Promise<InvitationCreated | boolean>;
  onSaved: () => void;
}) {
  const { session } = c;
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<SiteScope>(access?.scope || "all");
  const [grants, setGrants] = useState<SiteGrant[]>(access?.grants || []);
  const [error, setError] = useState("");
  const writable = member.role === "manager";
  useEffect(() => {
    setScope(access?.scope || "all");
    setGrants(access?.grants || []);
  }, [access]);

  function reset() {
    setScope(access?.scope || "all");
    setGrants(access?.grants || []);
    setError("");
    setOpen(false);
  }
  async function save() {
    if (scope === "selected" && !grants.length) {
      setError("Sélectionnez au moins un site, ou choisissez « Tous les sites ».");
      return;
    }
    setError("");
    const ok = await session.setSiteAccess({
      organization_id: orgId,
      user_id: member.user_id,
      scope,
      grants:
        scope === "all"
          ? []
          : grants.map((g) => ({ site_id: g.site_id, can_write: writable && g.can_write })),
    });
    if (ok) {
      setOpen(false);
      onSaved();
    }
  }
  return (
    <div className={styles.memberItem}>
      <div className={cx(styles.memberRow, me && styles.memberMe)}>
        <span className="avatar" aria-hidden="true">
          {initials(member.full_name) || "?"}
        </span>
        <section>
          <strong>
            {member.full_name}
            {me ? " (vous)" : ""}
          </strong>
          <small>{MEMBER_ROLE[member.role] || member.role}</small>
          {scopeLine && <small className={styles.memberScope}>{scopeLine}</small>}
        </section>
        {manageable ? (
          <div className={styles.memberActions}>
            {canEditAccess && (
              <button
                type="button"
                className="button outline"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => (open ? reset() : setOpen(true))}
              >
                Accès aux sites
              </button>
            )}
            <label className={styles.filterField}>
              <span className="sr-only">Rôle de {member.full_name}</span>
              <select
                value={member.role === "viewer" ? "viewer" : "manager"}
                disabled={session.busy}
                onChange={(e) =>
                  void command({
                    action: "change_member_role",
                    organization_id: orgId,
                    user_id: member.user_id,
                    role: e.target.value as "manager" | "viewer",
                  })
                }
              >
                <option value="manager">Gestionnaire</option>
                <option value="viewer">Lecture</option>
              </select>
            </label>
            <ConfirmAction
              label="Transférer la propriété"
              message={`Faire de ${member.full_name} le propriétaire de l’organisation ? Vous deviendrez gestionnaire.`}
              confirmLabel="Transférer"
              busy={session.busy}
              onConfirm={() =>
                command({ action: "transfer_ownership", organization_id: orgId, user_id: member.user_id })
              }
            />
            <ConfirmAction
              label="Retirer"
              message={`Retirer ${member.full_name} de l’organisation ? Cette personne perdra l’accès aux sites et dossiers.`}
              confirmLabel="Confirmer le retrait"
              danger
              busy={session.busy}
              onConfirm={() =>
                command({ action: "remove_member", organization_id: orgId, user_id: member.user_id })
              }
            />
          </div>
        ) : (
          <Tag tone={member.role === "owner" ? "blue" : "neutral"}>{MEMBER_ROLE[member.role] || member.role}</Tag>
        )}
      </div>
      {open && (
        <div id={panelId} className={styles.accessPanel}>
          <SiteScopeControl
            legend={`Accès aux sites de ${member.full_name}`}
            sites={c.orgSites}
            scope={scope}
            grants={grants}
            writable={writable}
            disabled={session.busy}
            error={error}
            onChange={(nextScope, nextGrants) => {
              setScope(nextScope);
              setGrants(nextGrants);
              setError("");
            }}
          />
          <div className={styles.actions}>
            <button type="button" className="button primary" disabled={session.busy} onClick={() => void save()}>
              {session.busy ? "Enregistrement…" : "Enregistrer l’accès"}
            </button>
            <button type="button" className="button outline" disabled={session.busy} onClick={reset}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MembersView({ c }: { c: Ctx }) {
  const { session } = c;
  const orgId = c.organization?.id || "";
  const [overview, setOverview] = useState<OrganizationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"manager" | "viewer">("manager");
  const [days, setDays] = useState("7");
  const [inviteError, setInviteError] = useState("");
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [copied, setCopied] = useState("");
  const [inviteScope, setInviteScope] = useState<SiteScope>("all");
  const [inviteGrants, setInviteGrants] = useState<SiteGrant[]>([]);
  const [inviteScopeError, setInviteScopeError] = useState("");
  const memberList = session.data.organization_members;
  const siteAccess = c.siteAccess;
  const accessOf = (userId: string) => siteAccess?.members.find((m) => m.user_id === userId);
  const selfAccess = accessOf(session.profileId);
  useEffect(() => {
    if (!orgId) {
      setOverview(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void session.loadOrganization(orgId).then((result) => {
      if (!active) return;
      setOverview(result);
      setLoading(false);
    });
    return () => {
      active = false;
    };
    // Recharge quand l’organisation, la liste des membres, une commande ou une relecture
    // du workspace (focus/visibilité) change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, reloadKey, memberList, session.refreshedAt]);

  const reload = () => {
    setReloadKey((k) => k + 1);
    c.reloadSiteAccess();
  };
  const canManage = Boolean(overview?.permissions.can_manage);
  const isOwner = session.membershipRole === "owner";
  const canEditAccess = canManage && isOwner && Boolean(siteAccess?.can_manage);
  const nameOf = (userId?: string | null) =>
    !userId
      ? "—"
      : userId === session.profileId
        ? session.displayName
        : overview?.members.find((m) => m.user_id === userId)?.full_name || "Ancien membre";

  async function command(body: OrganizationCommand) {
    const result = await session.organizationCommand(body);
    if (result) reload();
    return result;
  }
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const expires = Number(days);
    if (!EMAIL.test(email.trim())) {
      setInviteError("Renseignez une adresse email valide.");
      return;
    }
    if (!Number.isInteger(expires) || expires < 1 || expires > 14) {
      setInviteError("La validité doit être comprise entre 1 et 14 jours.");
      return;
    }
    if (inviteScope === "selected" && !inviteGrants.length) {
      setInviteScopeError("Sélectionnez au moins un site, ou choisissez « Tous les sites ».");
      return;
    }
    setInviteError("");
    setInviteScopeError("");
    setCreated(null);
    setCopied("");
    const result = await command({
      action: "create_invitation",
      organization_id: orgId,
      email: email.trim(),
      role: inviteRole,
      expires_in_days: expires,
      site_scope: inviteScope,
      site_grants:
        inviteScope === "all"
          ? []
          : inviteGrants.map((g) => ({ site_id: g.site_id, can_write: inviteRole === "manager" && g.can_write })),
    });
    if (result && typeof result === "object") {
      setCreated(result);
      setEmail("");
      setInviteScope("all");
      setInviteGrants([]);
    }
  }
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied("");
      setInviteError("Copie automatique impossible : sélectionnez le texte et copiez-le manuellement.");
    }
  }

  if (!orgId)
    return (
      <>
        <PageTitle title="Membres" subtitle="Accès à l’organisation active" />
        <Empty icon="users" title="Aucune organisation active">
          Ajoutez un premier site pour créer votre organisation ; ses membres apparaîtront ici.
        </Empty>
      </>
    );
  return (
    <>
      <PageTitle
        title="Membres"
        subtitle={`Accès à ${c.organization?.name || "l’organisation active"}`}
        action={
          session.membershipRole ? (
            <Tag tone="blue">Votre rôle : {MEMBER_ROLE[session.membershipRole]}</Tag>
          ) : undefined
        }
      />
      {loading ? (
        <Loader label="Chargement des membres…" />
      ) : !overview ? (
        <Unavailable title="Membres de l’organisation indisponibles" state={session.capabilities.organizations}>
          <button type="button" className="button outline" onClick={reload}>
            Réessayer
          </button>
        </Unavailable>
      ) : (
        <>
          {!isOwner && (
            <section className={cx("panel", styles.accessSelf)} aria-labelledby="own-access-title">
              <h2 id="own-access-title">Votre accès</h2>
              {siteAccess === undefined ? (
                <Loader label="Chargement de votre accès…" />
              ) : siteAccess === null ? (
                <Unavailable title="Portée de vos sites indisponible" state={session.capabilities.siteAccess} />
              ) : (
                <>
                  <p>
                    <strong>{scopeText(selfAccess, c.orgSites)}</strong>
                  </p>
                  <p className={styles.note}>
                    {selfAccess?.scope === "selected"
                      ? "Seuls ces sites et leurs dossiers vous sont visibles ; le propriétaire de l’organisation ajuste cette portée."
                      : "Vous accédez à tous les sites de l’organisation selon votre rôle."}
                  </p>
                </>
              )}
            </section>
          )}
          <section className="panel" aria-labelledby="members-title">
            <div className={styles.panelTitle}>
              <div>
                <h2 id="members-title">Membres de l’organisation</h2>
                <p>
                  {overview.members.length} membre{overview.members.length > 1 ? "s" : ""}
                  {overview.limits.members_limited ? ` · liste limitée aux ${overview.limits.members} premiers` : ""}
                </p>
              </div>
            </div>
            {isOwner && siteAccess === null && (
              <Unavailable title="Accès par site indisponible" state={session.capabilities.siteAccess}>
                <button type="button" className="button outline" onClick={c.reloadSiteAccess}>
                  Réessayer
                </button>
              </Unavailable>
            )}
            {overview.members.length ? (
              overview.members.map((m) => {
                const me = m.user_id === session.profileId;
                const manageable = canManage && !me && m.role !== "owner";
                const access = accessOf(m.user_id);
                const scopeLine =
                  m.role === "owner"
                    ? "Tous les sites"
                    : siteAccess === undefined
                      ? "Accès aux sites : chargement…"
                      : access
                        ? scopeText(access, c.orgSites)
                        : "";
                return (
                  <MemberItem
                    key={m.user_id}
                    c={c}
                    orgId={orgId}
                    member={m}
                    me={me}
                    manageable={manageable}
                    canEditAccess={canEditAccess}
                    access={access}
                    scopeLine={scopeLine}
                    command={command}
                    onSaved={reload}
                  />
                );
              })
            ) : (
              <p className={styles.muted}>Aucun membre chargé pour cette organisation.</p>
            )}
            {canEditAccess && <p className={styles.note}>Le propriétaire conserve toujours tous les sites. {SCOPE_NOTE}</p>}
            {!canManage && (
              <p className={styles.note}>
                Seul le propriétaire de l’organisation gère les membres et les invitations.
              </p>
            )}
            {overview.permissions.site_scoped_roles === false && (
              <p className={styles.note}>Les rôles s’appliquent à toute l’organisation ; il n’existe pas de droits par site.</p>
            )}
          </section>

          <div className={styles.twoCol}>
            <section className="panel" aria-labelledby="invitations-title">
              <div className={styles.panelTitle}>
                <div>
                  <h2 id="invitations-title">Invitations</h2>
                  <p>
                    {overview.permissions.automated_invitation_email
                      ? "Envoi automatique par email"
                      : "Aucun e-mail automatique : transmettez le code vous-même"}
                  </p>
                </div>
              </div>
              {overview.invitations.length ? (
                overview.invitations.map((inv) => {
                  const meta = INVITATION_META[inv.status] || { label: inv.status, tone: "neutral" as const };
                  return (
                    <div key={inv.id} className={styles.listRow}>
                      <section>
                        <strong>{inv.email}</strong>
                        <small>
                          {MEMBER_ROLE[inv.role] || inv.role} · créée le {date(inv.created_at)} · expire le {date(inv.expires_at)}
                        </small>
                        {invitationAccess(inv) && (
                          <small className={styles.memberScope}>{scopeText(invitationAccess(inv), c.orgSites)}</small>
                        )}
                      </section>
                      <Tag tone={meta.tone}>{meta.label}</Tag>
                      {canManage && inv.status === "pending" && (
                        <ConfirmAction
                          label="Révoquer"
                          message={`Révoquer l’invitation de ${inv.email} ? Le code transmis ne fonctionnera plus.`}
                          confirmLabel="Révoquer"
                          danger
                          busy={session.busy}
                          onConfirm={() =>
                            command({ action: "revoke_invitation", organization_id: orgId, invitation_id: inv.id })
                          }
                        />
                      )}
                    </div>
                  );
                })
              ) : (
                <p className={styles.muted}>Aucune invitation enregistrée.</p>
              )}
              {overview.limits.invitations_limited && (
                <p className={styles.note}>Liste limitée aux {overview.limits.invitations} invitations les plus récentes.</p>
              )}
              {canManage && (
                <form onSubmit={invite} className={styles.inviteForm}>
                  <h3>Inviter un membre</h3>
                  <Field label="Adresse e-mail" error={inviteError}>
                    <input
                      type="email"
                      required
                      maxLength={254}
                      autoComplete="off"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                  <div className="form-columns">
                    <Field label="Rôle">
                      <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "manager" | "viewer")}>
                        <option value="manager">Gestionnaire</option>
                        <option value="viewer">Lecture</option>
                      </select>
                    </Field>
                    <Field label="Validité (jours)" hint="Entre 1 et 14 jours (7 par défaut).">
                      <input
                        type="number"
                        min={1}
                        max={14}
                        step={1}
                        required
                        value={days}
                        onChange={(e) => setDays(e.target.value)}
                      />
                    </Field>
                  </div>
                  <SiteScopeControl
                    legend="Accès aux sites"
                    sites={c.orgSites}
                    scope={inviteScope}
                    grants={inviteGrants}
                    writable={inviteRole === "manager"}
                    disabled={session.busy}
                    error={inviteScopeError}
                    onChange={(nextScope, nextGrants) => {
                      setInviteScope(nextScope);
                      setInviteGrants(nextGrants);
                      setInviteScopeError("");
                    }}
                  />
                  <button type="submit" className="button primary" disabled={session.busy}>
                    {session.busy ? "Enregistrement…" : "Créer l’invitation"}
                  </button>
                </form>
              )}
              {created && (
                <div className={styles.inviteCode} role="status">
                  <strong>Invitation créée pour {created.invitation.email}</strong>
                  <p>
                    Transmettez ce code ou ce lien vous-même ; il n’est affiché qu’une fois et expire le{" "}
                    {date(created.invitation.expires_at)}.
                  </p>
                  <code>{created.invitation_code}</code>
                  <div className={styles.actions}>
                    <button type="button" className="button outline" onClick={() => void copy(created.invitation_code, "code")}>
                      {copied === "code" ? "Code copié" : "Copier le code"}
                    </button>
                    <button type="button" className="button outline" onClick={() => void copy(created.invite_url, "url")}>
                      {copied === "url" ? "Lien copié" : "Copier le lien"}
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="panel" aria-labelledby="membership-events-title">
              <div className={styles.panelTitle}>
                <div>
                  <h2 id="membership-events-title">Historique des accès</h2>
                  <p>Journal serveur des membres et invitations</p>
                </div>
              </div>
              {overview.events.length ? (
                overview.events.map((ev) => (
                  <div key={ev.id} className={styles.listRow}>
                    <section>
                      <strong>{MEMBERSHIP_EVENT[ev.action] || ev.action}</strong>
                      <small>
                        {nameOf(ev.actor_id)}
                        {ev.target_user_id ? ` → ${nameOf(ev.target_user_id)}` : ""}
                        {ev.previous_role || ev.next_role
                          ? ` (${MEMBER_ROLE[ev.previous_role || ""] || ev.previous_role || "—"} → ${MEMBER_ROLE[ev.next_role || ""] || ev.next_role || "—"})`
                          : ""}
                        {" · "}
                        {dateTime(ev.created_at)}
                      </small>
                    </section>
                  </div>
                ))
              ) : (
                <p className={styles.muted}>Aucun événement enregistré.</p>
              )}
              {overview.limits.events_limited && (
                <p className={styles.note}>Journal limité aux {overview.limits.events} événements les plus récents.</p>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

// ---- Messages, documents, profil ------------------------------------------------------------
function MessagesView({ c }: { c: Ctx }) {
  const { session, scope } = c;
  const selected = session.param || session.selectedId;
  // Only a dossier of the ACTIVE scope is opened; the view is re-keyed on the refresh context
  // (identity, role, organisation, site) and on that visible target, so nothing of another scope
  // (messages, history, draft, late replies) survives a switch or a rights change.
  const visible = scope.interventions.some((i) => i.id === selected) ? selected : "";
  const outside = selected && !visible ? (session.data.interventions.some((i) => i.id === selected) ? "scope" : "unloaded") : null;
  return (
    <>
      <PageTitle title="Messages" subtitle="Échanges liés aux interventions du périmètre" />
      {outside && (
        <p className="inline-note" data-message-target={outside}>
          {outside === "scope"
            ? "Ce dossier est hors de ce périmètre. Choisissez son organisation ou son site pour ouvrir sa conversation."
            : "Ce dossier n’est pas chargé dans la liste actuelle (dossiers les plus récents). Ouvrez-le depuis sa fiche."}
        </p>
      )}
      {scope.interventions.length ? (
        <MessageCenter
          live={session.mode === "live"}
          key={`${session.refreshContext}|${visible}`}
          interventions={byDateDesc(scope.interventions)}
          messages={session.data.messages}
          role={session.role}
          profileId={session.profileId}
          selectedId={visible}
          busy={session.busy}
          onSubmit={session.sendMessage}
          canSend={(id) => {
            const row = scope.interventions.find((i) => i.id === id);
            return Boolean(row && c.authority.canWriteSite(row.site_id));
          }}
          readOnlyReason={c.authority.readOnlyReason || undefined}
          context={session.mutationContext}
          loadOperations={session.loadOperations}
        />
      ) : (
        <Empty icon="message" title="Aucune conversation" action={
          c.canCreateRequest ? (
            <button type="button" className="button primary" onClick={() => c.go("new")}>
              Créer une demande
            </button>
          ) : undefined
        }>
          Les échanges apparaissent dès qu’une intervention existe sur le périmètre.
        </Empty>
      )}
    </>
  );
}

function DocumentsView({ c }: { c: Ctx }) {
  const { session, scope, demo } = c;
  const quotes = byDateDesc(scope.quotes);
  return (
    <>
      <PageTitle title="Documents" subtitle="Devis reçus et pièces privées du périmètre" />
      <section className="panel" aria-labelledby="quotes-title">
        <h2 id="quotes-title">Devis</h2>
        {quotes.length ? (
          quotes.map((q) => {
            const i = scope.interventions.find((x) => x.id === q.intervention_id);
            return (
              <button
                key={q.id}
                type="button"
                className={cx(styles.listRow, styles.listRowButton)}
                onClick={() => session.openIntervention(q.intervention_id, q.id)}
              >
                <section>
                  <strong>
                    {quoteRef(q.id)} · {money(q.total_cents)}
                  </strong>
                  <small>
                    {i ? `${category(i.category).label} · ${shortId(i.id)}` : shortId(q.intervention_id)} · {dateTime(q.created_at)}
                  </small>
                </section>
                <Tag tone={q.status === "accepted" ? "green" : q.status === "rejected" ? "red" : "blue"}>
                  {q.status === "accepted" ? "Accepté" : q.status === "rejected" ? "Refusé" : "Envoyé"}
                </Tag>
                <Icon name="arrow" size={16} />
              </button>
            );
          })
        ) : (
          <p className={styles.muted} style={{ marginTop: 10 }}>
            Aucun devis reçu sur ce périmètre.
          </p>
        )}
      </section>
      <DocumentManager
        live={session.mode === "live"}
        profileId={session.profileId}
        documents={session.data.documents}
        interventions={byDateDesc(scope.interventions)}
        demo={demo}
        onRefresh={session.refresh}
      />
    </>
  );
}

function ProfileView({ c }: { c: Ctx }) {
  const { session, demo } = c;
  return (
    <>
      <PageTitle
        title="Profil"
        subtitle={`Entreprise cliente · organisation active : ${c.organization?.name || "aucune"}`}
      />
      <ProfileForm
        key={session.displayName + (session.profile?.phone || "")}
        name={session.displayName}
        phone={session.profile?.phone || ""}
        role={session.role}
        demo={demo}
        busy={session.busy}
        onSubmit={async (values) => {
          await session.updateProfile(values);
        }}
      />
      <InstallPanel />
      <AccountSessionsPanel key={`sessions:${session.mode}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`} demo={demo} context={session.mutationContext} />
      <AccountDataPanel
        key={`${session.mode}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`}
        demo={demo}
        context={session.mutationContext}
        onOpenTicket={(id) => c.go("support", id)}
        erasureRequests
      />
      <section className="panel" aria-labelledby="profile-role">
        <h2 id="profile-role">Votre rôle</h2>
        <p className={styles.description}>
          Vous pilotez les sites de <strong>{c.organization?.name || "votre organisation"}</strong> en tant qu’entreprise
          cliente : demandes, approbations de devis, budgets et suivi des échéances. Le règlement d’un dossier reste
          réservé à son demandeur.
        </p>
        {/* Emplacement réservé à l’installation PWA (composant Codex, hors de ce lot). */}
        <div className={styles.actions} style={{ marginTop: 16 }}>
          <button type="button" className="button outline" onClick={() => c.go("support")}>
            <Icon name="shield" size={17} />
            Assistance
          </button>
          <button type="button" className="button outline" onClick={() => void session.logout()}>
            <Icon name="logout" size={17} />
            Se déconnecter
          </button>
        </div>
      </section>
    </>
  );
}
