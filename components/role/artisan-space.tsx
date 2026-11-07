"use client";
// Artisan space (role "artisan"). Presentational: every mutation goes through `session`.
// Master references: M35 (shell + dashboard), M67 (offer), M34 (quote), M14 (documents),
// M65 (application), M36 (profile). Structure is reproduced, example figures are not.
import { PaymentLinkPanel } from "./payment-link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session } from "../app/session-types";
import type {
  Appointment,
  ArtisanApplicationStatus,
  ArtisanCommand,
  ArtisanCredential,
  ArtisanDossier,
  ArtisanProfile,
  Category,
  CredentialKind,
  Intervention,
  InterventionReport,
  OperationBody,
  Operations,
  Payment,
  Quote,
  ReportCheck,
  Role,
  Status,
  StoredDocument,
  TravelStage,
  View,
} from "../app/types";
import { Icon } from "../app/icons";
import { taxRateLabel } from "../app/tax-rate";
import { InstallPanel } from "../app/install-panel";
import {
  Alerts,
  Badge,
  Brand,
  ConfirmAction,
  DemoNote,
  Empty,
  Field,
  Forbidden,
  Loader,
  PageTitle,
  Segments,
  Tag,
  Unavailable,
} from "../app/ui";
import { DocumentManager, MessageCenter, ProfileForm } from "../app/forms";
import { AccountDataPanel } from "../features/account-data/account-data-panel";
import { SubscriptionsPanel } from "../features/subscriptions/subscriptions-panel";
import {
  ARTISAN_STATUS,
  CATEGORIES,
  ROLE_NAMES,
  TRAVEL_STAGE,
  category,
  date,
  dateTime,
  initials,
  money,
  quoteRef,
  shortId,
  time,
} from "../app/format";
import {
  canAccess,
  artisanMissions,
  artisanPerformance,
  pickQuote,
  quoteVersions,
  type Performance,
} from "../app/session";
import styles from "./artisan.module.css";
import theme from "./artisan-theme.module.css";
import { ThemeSurface } from "../app/theme-provider";
import { ThemeToggle } from "../app/theme-toggle";
import { QuoteDraftEditor } from "./artisan-quote-draft";
import { isDeclaredOnSite } from "../app/booking-status";
import { DossierHelpLink, SupportCenter } from "./support-tickets";
import { HeaderBell, NotificationsPage } from "./notifications-anchor";
import { QuoteDocumentsAnchor } from "./quote-documents-anchor";
import { TrackingAnchor } from "./tracking-anchor";
import { useDetailPresence } from "./use-detail-presence";
import { PointReadState } from "./detail-read-view";
import { ArtisanPlanning } from "../features/planning/artisan-planning";
import { CONTRACT_MESSAGES } from "../app/api";
import { demoPlanning } from "../../lib/features/planning/demo";
import { PLANNING_TIME_ZONE } from "../../lib/features/planning/types";
import { anchorEntryVisible, leafScope, platformEntries } from "./anchors";
import { PlatformPage } from "./platform-anchor";
import { FeatureUnavailable } from "./feature-unavailable";
import { CustomerInvoicesPanel } from "../features/customer-invoices/customer-invoices-panel";
import { AvailableMissionsPanel } from "../features/available-missions/available-missions-panel";
import { MissionRadiusPanel } from "../features/mission-radius/mission-radius-panel";
import type { MissionOffer } from "../features/available-missions/available-missions-model";
import {
  applicationSteps,
  appointmentSlotState,
  credentialDateLabel,
  credentialState,
  type CredentialState,
  credentialSummary,
  demoPlanningRange,
  fmtRating,
  missionSegmentOptions,
  perfTiles,
  planningAuthority,
  stepsSummary,
  type AppointmentEntry,
  type MissionSegment,
} from "./artisan-lists";
import { CredentialReviewPanel } from "../features/credential-reviews/credential-review-panel";
import { CredentialReminderPanel } from "../features/operational-reminders/operational-reminder-panel";
import { AppointmentReminderPanel } from "../features/appointment-reminders/appointment-reminder-panel";
import { ProviderTeamsPanel } from "../features/provider-teams/provider-teams-panel";
import { ContractSourceLine } from "../features/quote-grid/quote-grid";
import { PhotoReviewPanel } from "../features/photo-review/photo-review-panel";
import { reviewImage } from "../features/photo-review/model";

// ---- Static definitions ---------------------------------------------------------------
type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "violet";
/** `short` : libellé de l’onglet bas (une ligne à 360 px, M36 « Accueil ») ; le menu garde `label`. */
type NavItem = { view: View; label: string; icon: string; short?: string };

const PRIMARY_NAV: NavItem[] = [
  { view: "overview", label: "Tableau de bord", icon: "grid", short: "Accueil" },
  { view: "missions", label: "Missions", icon: "briefcase" },
  { view: "quotes", label: "Devis", icon: "receipt" },
  { view: "messages", label: "Messages", icon: "message" },
  { view: "profile", label: "Profil", icon: "person" },
];
const SECONDARY_NAV: NavItem[] = [
  { view: "planning", label: "Planning", icon: "calendar" },
  { view: "documents", label: "Documents", icon: "document" },
  { view: "application", label: "Dossier de candidature", icon: "badge" },
  { view: "performance", label: "Performance", icon: "chart" },
  { view: "help", label: "Aide", icon: "help" },
  { view: "support", label: "Assistance", icon: "shield" },
];
/**
 * Entrées secondaires réellement proposées : le planning dépend de la capacité serveur (jamais un
 * menu sans action) ; les sections du back-office n’apparaissent que si la plateforme a ouvert un
 * droit d’opérateur à ce compte (`platformEntries`, fail-closed), sans promotion de rôle.
 */
function secondaryNav(session: Session): NavItem[] {
  const base = SECONDARY_NAV.filter((item) =>
    item.view === "planning" ? anchorEntryVisible(canAccess("planning", session.role, session.mode), session.capabilities.planning) : true,
  );
  const platform = platformEntries(session.platformAccess, (v) => canAccess(v, session.role, session.mode));
  return [...base, ...platform];
}
const DRAWER_ID = "artisan-drawer";

const APPLICATION_STATUS: Record<
  ArtisanApplicationStatus,
  { label: string; tone: Tone; text: string }
> = {
  draft: {
    label: "Brouillon",
    tone: "neutral",
    text: "Votre dossier n’est pas soumis. Complétez les sections puis soumettez votre candidature ; l’examen est réalisé par l’opérateur.",
  },
  submitted: {
    label: "Candidature soumise",
    tone: "blue",
    text: "Votre candidature attend l’examen de l’opérateur. Aucun délai de réponse n’est garanti. Toute modification enregistrée la repasse en brouillon.",
  },
  changes_requested: {
    label: "Modifications demandées",
    tone: "amber",
    text: "L’opérateur demande des compléments. Corrigez votre dossier et vos justificatifs, puis soumettez à nouveau.",
  },
  approved: {
    label: "Approuvée",
    tone: "green",
    text: "Votre candidature est approuvée par l’opérateur. Enregistrer une modification repasse le dossier en brouillon et nécessite un nouvel examen.",
  },
  suspended: {
    label: "Suspendue",
    tone: "red",
    text: "Votre accès aux nouvelles missions est suspendu par l’opérateur. Vos dossiers en cours restent accessibles ; aucun canal de réclamation n’est encore activé sur ce service.",
  },
};
const CREDENTIAL_KINDS: { kind: CredentialKind; title: string; description: string }[] = [
  {
    kind: "registration",
    title: "Extrait Kbis ou inscription au registre",
    description: "Preuve d’immatriculation de votre entreprise.",
  },
  {
    kind: "liability",
    title: "Assurance responsabilité civile professionnelle",
    description: "Attestation en cours de validité.",
  },
  {
    kind: "qualification",
    title: "Diplôme ou qualification en électricité",
    description: "Titre, habilitation ou certificat justifiant vos compétences.",
  },
];
const CREDENTIAL_KIND_LABEL: Record<CredentialKind, string> = {
  registration: "Kbis / inscription",
  liability: "Assurance RC Pro",
  qualification: "Diplôme / qualification",
  other: "Autre justificatif",
};
const LEGAL_STATUSES = [
  "Entreprise individuelle",
  "Micro-entreprise",
  "EURL",
  "SARL",
  "SAS ou SASU",
  "Autre",
];
const CHECK_RESULTS: Record<ReportCheck["result"], string> = {
  pass: "Conforme",
  issue: "Anomalie constatée",
  not_applicable: "Sans objet",
};
const QUOTE_STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: "Envoyé, en attente du client", tone: "blue" },
  accepted: { label: "Accepté", tone: "green" },
  rejected: { label: "Refusé par le client", tone: "red" },
};

// ---- Pure helpers ---------------------------------------------------------------------
const maskPostal = (code: string) =>
  code.length >= 2 ? `${code.slice(0, 2)}•••` : "•••••";
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const activeNav = (view: View): View =>
  view === "mission" || view === "detail" || view === "quote" ? "missions" : view;
const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const isTel = (value: string) => /^[+\d][\d\s.-]{5,}$/.test(value.trim());
function quoteStatus(status: string) {
  return QUOTE_STATUS[status] || { label: status, tone: "neutral" as Tone };
}
function seniority(createdAt: string | undefined, now: Date): string | null {
  if (!createdAt) return null;
  const start = new Date(createdAt);
  if (Number.isNaN(start.getTime()) || start > now) return null;
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (months < 1) return "Moins d’un mois";
  if (months < 12) return `${months} mois`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `${years} an${years > 1 ? "s" : ""}${rest ? ` et ${rest} mois` : ""}`;
}
function paymentFor(quotes: Quote[], payments: Payment[], interventionId: string) {
  const accepted = quotes.find(
    (q) => q.intervention_id === interventionId && q.status === "accepted",
  );
  const payment = accepted
    ? [...payments]
        .filter((p) => p.quote_id === accepted.id)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
    : undefined;
  return { accepted, payment };
}
function approvalWording(status: ArtisanApplicationStatus | undefined): string {
  switch (status) {
    case "draft":
      return "Votre candidature est en brouillon : elle n’a pas été soumise. Les missions disponibles restent consultables mais ne peuvent pas être acceptées.";
    case "submitted":
      return "Votre candidature est soumise et attend l’examen de l’opérateur. Vous pourrez accepter des missions après approbation.";
    case "changes_requested":
      return "L’opérateur demande des modifications sur votre candidature. Corrigez votre dossier puis soumettez-le à nouveau.";
    case "approved":
      return "Votre candidature apparaît approuvée mais votre compte n’est pas encore activé pour les missions. L’activation dépend de l’opérateur ; l’état se met à jour à chaque actualisation de vos données.";
    case "suspended":
      return "Votre accès aux nouvelles missions est suspendu par l’opérateur. Vos dossiers en cours restent accessibles.";
    default:
      return "Votre compte artisan n’est pas encore approuvé. Complétez et soumettez votre dossier de candidature pour pouvoir accepter des missions.";
  }
}
type AppValues = {
  company_name: string;
  siret: string;
  legal_status: string;
  employee_count: string;
  address: string;
  postal_codes: string[];
  categories: Category[];
};
function appValuesFrom(profile: ArtisanProfile | null): AppValues {
  return {
    company_name: profile?.company_name ?? "",
    siret: profile?.siret ?? "",
    legal_status: profile?.legal_status ?? "",
    employee_count: profile ? String(profile.employee_count || 1) : "1",
    address: profile?.address ?? "",
    postal_codes: profile?.postal_codes ?? [],
    categories: profile?.categories ?? [],
  };
}
function missingItems(v: AppValues): string[] {
  const out: string[] = [];
  if (v.company_name.trim().length < 2) out.push("Nom de la société");
  if (!/^\d{14}$/.test(v.siret)) out.push("SIRET à 14 chiffres");
  if (!v.legal_status) out.push("Statut juridique");
  if (!Number.isInteger(Number(v.employee_count)) || Number(v.employee_count) < 1)
    out.push("Effectif (au moins 1, vous compris)");
  if (v.address.trim().length < 5) out.push("Adresse du siège");
  if (!v.postal_codes.length) out.push("Au moins un code postal d’intervention");
  if (!v.categories.length) out.push("Au moins une compétence");
  return out;
}
const appKey = (v: AppValues) =>
  [
    v.company_name.trim(),
    v.siret,
    v.legal_status,
    Number(v.employee_count),
    v.address.trim(),
    [...v.postal_codes].sort().join(","),
    [...v.categories].sort().join(","),
  ].join("|");

// ---- Data hooks (cancellation flags, session functions read through refs) -------------
function useDossier(session: Session, version: number) {
  const [state, setState] = useState<{ dossier: ArtisanDossier | null; pending: boolean }>({
    dossier: null,
    pending: true,
  });
  const load = useRef(session.loadArtisanDossier);
  useEffect(() => {
    load.current = session.loadArtisanDossier;
  });
  const { mode, profileId } = session;
  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, pending: true }));
    void load.current().then((dossier) => {
      if (active) setState({ dossier, pending: false });
    });
    return () => {
      active = false;
    };
  }, [version, mode, profileId]);
  return state;
}
function useOperations(session: Session, id: string, version: number) {
  const [state, setState] = useState<{ ops: Operations | null; pending: boolean }>({
    ops: null,
    pending: true,
  });
  const load = useRef(session.loadOperations);
  useEffect(() => {
    load.current = session.loadOperations;
  });
  const { mode, profileId } = session;
  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, pending: true }));
    void load.current(id).then((ops) => {
      if (active) setState({ ops, pending: false });
    });
    return () => {
      active = false;
    };
  }, [id, version, mode, profileId]);
  return state;
}
function useAppointments(session: Session, ids: string[]) {
  const key = ids.join("|");
  const [map, setMap] = useState<Record<string, AppointmentEntry>>({});
  const load = useRef(session.loadOperations);
  useEffect(() => {
    load.current = session.loadOperations;
  });
  const { mode, profileId } = session;
  useEffect(() => {
    let active = true;
    setMap({});
    const list = key ? key.split("|") : [];
    void Promise.all(
      list.map(async (id) => {
        const ops = await load.current(id);
        return [id, ops ? { appointment: ops.appointment } : null] as const;
      }),
    ).then((entries) => {
      if (active) setMap(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [key, mode, profileId]);
  return map;
}

// ---- Root ------------------------------------------------------------------------------
export function ArtisanSpace({ session }: { session: Session }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dossierVersion, setDossierVersion] = useState(0);
  const [declinedIds, setDeclinedIds] = useState<string[]>([]);
  const menuButton = useRef<HTMLButtonElement>(null);
  // Where focus lands once the drawer is closed and the page body is no longer inert.
  const afterClose = useRef<"menu" | "main" | null>(null);
  const { dossier, pending: dossierPending } = useDossier(session, dossierVersion);

  const closeMenu = useCallback(() => {
    afterClose.current = "menu";
    setMenuOpen(false);
  }, []);
  useEffect(() => {
    if (menuOpen || !afterClose.current) return;
    const target = afterClose.current;
    afterClose.current = null;
    if (target === "main") document.getElementById("main")?.focus();
    else menuButton.current?.focus();
  }, [menuOpen]);
  const command = useCallback(
    async (body: ArtisanCommand) => {
      const ok = await session.artisanCommand(body);
      if (ok) setDossierVersion((v) => v + 1);
      return ok;
    },
    [session],
  );
  const onDeclined = useCallback(
    (id: string) => setDeclinedIds((ids) => (ids.includes(id) ? ids : [...ids, id])),
    [],
  );
  const navigate = (view: View, param?: string) => {
    if (menuOpen) afterClose.current = "main";
    setMenuOpen(false);
    session.go(view, param);
  };

  let content: ReactNode;
  if (session.loading) content = <Loader label="Chargement de votre espace…" />;
  else
    switch (session.view) {
      case "overview":
        content = (
          <Overview
            session={session}
            dossier={dossier}
            declinedIds={declinedIds}
          />
        );
        break;
      case "missions":
        content = (
          <>
            <Missions session={session} declinedIds={declinedIds} />
            {/* ART-12: provider team (invitations, members, internal assignment, technician follow-up). */}
            <ProviderTeamsPanel
              key={`teams|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}`}
              context={session.mutationContext}
              demo={session.mode === "demo"}
            />
          </>
        );
        break;
      case "mission":
      case "detail":
      case "quote":
        content = (
          <MissionView
            session={session}
            id={session.param}
            onDeclined={onDeclined}
          />
        );
        break;
      case "quotes":
        content = <Quotes session={session} />;
        break;
      case "messages":
        content = <Messages session={session} />;
        break;
      case "notifications":
        content = <NotificationsPage session={session} />;
        break;
      case "planning":
        content = <PlanningView session={session} dossier={dossier} />;
        break;
      case "platform-operators":
      case "platform-finance":
      case "platform-moderation":
      case "support-queue":
        content = <PlatformPage session={session} view={session.view} />;
        break;
      case "documents":
        content = (
          <Documents
            session={session}
            dossier={dossier}
            pending={dossierPending}
            onCommand={command}
          />
        );
        break;
      case "application":
        content = (
          <Application
            session={session}
            dossier={dossier}
            pending={dossierPending}
            onCommand={command}
          />
        );
        break;
      case "profile":
        content = (
          <Profile
            session={session}
            dossier={dossier}
            pending={dossierPending}
            onCommand={command}
          />
        );
        break;
      case "performance":
        content = <PerformanceView session={session} />;
        break;
      case "help":
        content = <HelpView session={session} />;
        break;
      case "support":
        content = (
          <div data-theme-island="support">
            <SupportCenter
              session={session}
              interventions={session.data.interventions.filter((x) => x.artisan_id === session.profileId)}
              backView="overview"
            />
          </div>
        );
        break;
      default:
        content = <Forbidden onHome={() => session.go("overview")} />;
    }

  const current = activeNav(session.view);
  return (
    <ThemeSurface className={theme.artisanSkin}>
      <div className={styles.space}>
        <Sidebar session={session} current={current} onNavigate={navigate} />
        <div className={styles.body} inert={menuOpen}>
          {session.mode === "demo" && <DemoBar session={session} />}
          <header className={styles.topbar}>
            <button
              ref={menuButton}
              type="button"
              className={`${styles.iconButton} ${styles.menuButton}`}
              aria-label="Ouvrir le menu"
              aria-expanded={menuOpen}
              aria-controls={DRAWER_ID}
              onClick={() => setMenuOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <div className={styles.greeting}>
              {session.firstName ? (
                <>
                  <span>Bonjour,</span>
                  <strong>{session.firstName}</strong>
                </>
              ) : (
                <strong>Bonjour</strong>
              )}
            </div>
            <ThemeToggle />
            <HeaderBell session={session} />
          </header>
          <main id="main" className={styles.main} tabIndex={-1}>
            <Alerts
              error={session.error}
              notice={session.notice}
              onClearError={() => session.setError("")}
              onClearNotice={() => session.setNotice("")}
            />
            {content}
          </main>
          <nav className={styles.bottomNav} aria-label="Onglets de l’espace artisan">
            {PRIMARY_NAV.map((item) => (
              <button
                key={item.view}
                type="button"
                className={styles.bottomItem}
                aria-current={current === item.view ? "page" : undefined}
                onClick={() => navigate(item.view)}
              >
                <Icon name={item.icon} size={22} />
                {item.short ?? item.label}
              </button>
            ))}
          </nav>
        </div>
        <Drawer
          open={menuOpen}
          session={session}
          current={current}
          onClose={closeMenu}
          onNavigate={navigate}
        />
      </div>
    </ThemeSurface>
  );
}

// ---- Chrome -----------------------------------------------------------------------------
function NavButtons({
  items,
  current,
  onNavigate,
  counts,
}: {
  items: NavItem[];
  current: View;
  onNavigate: (view: View) => void;
  counts?: Partial<Record<View, number>>;
}) {
  return (
    <>
      {items.map((item) => (
        <button
          key={item.view}
          type="button"
          className={styles.sideItem}
          aria-current={current === item.view ? "page" : undefined}
          onClick={() => onNavigate(item.view)}
        >
          <Icon name={item.icon} size={18} />
          {item.label}
          {counts?.[item.view] ? (
            <small>
              <span aria-hidden="true">{counts[item.view]}</span>
              <span className="sr-only">
                {item.view === "quotes"
                  ? `${counts[item.view]} devis à rédiger`
                  : `${counts[item.view]} missions en cours`}
              </span>
            </small>
          ) : null}
        </button>
      ))}
    </>
  );
}
function Sidebar({
  session,
  current,
  onNavigate,
}: {
  session: Session;
  current: View;
  onNavigate: (view: View) => void;
}) {
  const missions = artisanMissions(session.data.interventions, session.profileId);
  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarBrand}>
        <Brand />
      </div>
      <span className={styles.sideCaption}>Espace artisan</span>
      <nav className={styles.sideNav} aria-label="Navigation principale">
        <NavButtons
          items={PRIMARY_NAV}
          current={current}
          onNavigate={onNavigate}
          counts={{ missions: missions.active.length, quotes: missions.quotesToWrite.length }}
        />
      </nav>
      <span className={styles.sideCaption}>Dossier et aide</span>
      <nav className={styles.sideNav} aria-label="Navigation secondaire">
        <NavButtons items={secondaryNav(session)} current={current} onNavigate={onNavigate} />
      </nav>
      <div className={styles.sideFoot}>
        <div className={styles.sideUser}>
          <span className={styles.avatarSmall} aria-hidden="true">
            {initials(session.displayName)}
          </span>
          <div>
            <strong>{session.displayName}</strong>
            <span>
              {ROLE_NAMES.artisan}
              {session.mode === "demo" ? " — démonstration" : ""}
            </span>
          </div>
        </div>
        <button
          type="button"
          className={styles.sideItem}
          disabled={session.busy}
          onClick={() => void session.logout()}
        >
          <Icon name="logout" size={18} />
          Se déconnecter
        </button>
      </div>
    </aside>
  );
}
function Drawer({
  open,
  session,
  current,
  onClose,
  onNavigate,
}: {
  open: boolean;
  session: Session;
  current: View;
  onClose: () => void;
  onNavigate: (view: View) => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return <div id={DRAWER_ID} hidden />;
  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <div
        id={DRAWER_ID}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label="Menu de l’espace artisan"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.drawerHead}>
          <Brand compact />
          <button
            ref={closeButton}
            type="button"
            className={styles.iconButton}
            aria-label="Fermer le menu"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <nav className={styles.sideNav} aria-label="Menu principal">
          <NavButtons items={PRIMARY_NAV} current={current} onNavigate={onNavigate} />
        </nav>
        <span className={styles.sideCaption}>Dossier et aide</span>
        <nav className={styles.sideNav} aria-label="Menu secondaire">
          <NavButtons items={secondaryNav(session)} current={current} onNavigate={onNavigate} />
        </nav>
        <div className={styles.sideFoot}>
          <button
            type="button"
            className={styles.sideItem}
            disabled={session.busy}
            onClick={() => void session.logout()}
          >
            <Icon name="logout" size={18} />
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
function DemoBar({ session }: { session: Session }) {
  return (
    <div className={styles.demoBar} role="region" aria-label="Mode démonstration">
      <span className={styles.demoBarText}>
        <Icon name="info" size={15} />
        Démonstration — données fictives, aucun artisan contacté, aucun débit
      </span>
      <div className={styles.demoBarTools}>
        <label className={styles.demoRole}>
          Rôle exploré
          <select
            value={session.role}
            onChange={(e) => session.setDemoRole(e.target.value as Role)}
          >
            {(Object.keys(ROLE_NAMES) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_NAMES[r]}
              </option>
            ))}
          </select>
        </label>
        <ConfirmAction
          label="Réinitialiser"
          message="Effacer les données de démonstration de ce navigateur et revenir à l’exemple initial ?"
          confirmLabel="Réinitialiser la démonstration"
          className="text-button"
          busy={session.busy}
          onConfirm={async () => session.resetDemo()}
        />
      </div>
    </div>
  );
}

// ---- Overview (M35) ---------------------------------------------------------------------
function PanelArt() {
  return (
    <svg
      className={styles.bannerArt}
      viewBox="0 0 110 110"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="18" y="10" width="74" height="90" rx="6" />
      <path d="M26 24h58M26 44h58M26 64h58M26 84h58" />
      <path d="M34 30v8m12-8v8m12-8v8m12-8v8m12-8v8M34 50v8m12-8v8m12-8v8m12-8v8m12-8v8M34 70v8m12-8v8m12-8v8" />
      <circle cx="80" cy="74" r="3" />
    </svg>
  );
}
function appointmentSlot(entry: AppointmentEntry | undefined, now: Date): ReactNode {
  const slot = appointmentSlotState(entry, now);
  if (slot.kind === "loading")
    return (
      <span role="status" className={styles.rowHint}>
        Horaire en cours de lecture…
      </span>
    );
  if (slot.kind === "unavailable") return <span className={styles.rowHint}>Horaire indisponible</span>;
  if (slot.kind === "unscheduled") return <span className={styles.rowHint}>Horaire à fixer</span>;
  return (
    <>
      <strong>{slot.today ? "Aujourd’hui" : date(slot.startsAt)}</strong>
      <span>
        {time(slot.startsAt)} – {time(slot.endsAt)}
      </span>
    </>
  );
}
function MissionRow({
  intervention: i,
  right,
  onOpen,
}: {
  intervention: Intervention;
  right: ReactNode;
  onOpen: () => void;
}) {
  const c = category(i.category);
  return (
    <button type="button" className={styles.row} onClick={onOpen}>
      <span className={`${styles.rowIcon} ${styles[`tone_${c.id}`]}`}>
        <Icon name={c.icon} size={24} />
      </span>
      <span className={styles.rowBody}>
        <strong className={styles.rowTitle}>{c.label}</strong>
        <span className={styles.rowLine}>
          <span className={styles.rowMeta}>
            <Icon name="location" size={14} />
            <span className={styles.rowPlace}>
              {i.address}, {i.city}
            </span>
          </span>
          <Badge status={i.status} wording="artisan" />
        </span>
      </span>
      <span className={styles.rowRight}>{right}</span>
      <Icon name="arrow" size={16} />
    </button>
  );
}
function OfferRow({ intervention: i, onOpen }: { intervention: Intervention; onOpen: () => void }) {
  const c = category(i.category);
  return (
    <button type="button" className={styles.row} onClick={onOpen}>
      <span className={`${styles.rowIcon} ${styles[`tone_${c.id}`]}`}>
        <Icon name={c.icon} size={24} />
      </span>
      <span className={styles.rowBody}>
        <strong className={styles.rowTitle}>{c.label}</strong>
        <span className={styles.rowLine}>
          <span className={styles.rowMeta}>
            <Icon name="location" size={14} />
            <span className={styles.rowPlace}>
              {i.city} · {maskPostal(i.postal_code)}
            </span>
          </span>
          <Tag tone={i.urgency === "urgent" ? "amber" : "neutral"}>
            {i.urgency === "urgent" ? "Urgente" : "À planifier"}
          </Tag>
          <Tag tone="blue">{ARTISAN_STATUS.requested}</Tag>
        </span>
      </span>
      <span className={styles.rowRight}>
        <strong>
          {money(i.estimate_min_cents)} – {money(i.estimate_max_cents)}
        </strong>
        <span>Fourchette TTC estimée</span>
      </span>
      <Icon name="arrow" size={16} />
    </button>
  );
}
function PerformanceSummary({ perf, onDetail }: { perf: Performance; onDetail: () => void }) {
  return (
    <section className={`panel ${styles.perfPanel}`} aria-labelledby="perf-title">
      <div className={styles.perfHead}>
        <Icon name="trend" />
        <h2 id="perf-title">Performance</h2>
        <button type="button" className="text-button" onClick={onDetail}>
          Détail
        </button>
      </div>
      <div className={styles.perfPair}>
        <div className={styles.perfFigure}>
          <span className={`${styles.perfIcon} ${styles.amberIcon}`}>
            <Icon name="star" />
          </span>
          <div>
            <span className={styles.perfLabel}>Note moyenne</span>
            <strong className={styles.perfValue}>
              {perf.rating ? (
                <>
                  {fmtRating(perf.rating.average)}
                  <small>/5</small>
                </>
              ) : (
                "—"
              )}
            </strong>
            <span className={styles.perfNote}>
              {perf.rating
                ? `Basée sur ${perf.rating.count} avis`
                : "Aucun avis encore"}
            </span>
          </div>
        </div>
        <div className={styles.perfFigure}>
          <span className={`${styles.perfIcon} ${styles.greenIcon}`}>
            <Icon name="euro" />
          </span>
          <div>
            <span className={styles.perfLabel}>CA du mois</span>
            <strong className={styles.perfValue}>{money(perf.monthRevenueCents)}</strong>
            <span className={styles.perfNote}>Mois en cours</span>
          </div>
        </div>
      </div>
      <details className={styles.basis}>
        <summary>Base de calcul</summary>
        <div className={styles.basisBody}>
          <p>Période : {perf.period}.</p>
          <p>{perf.basis}</p>
          <p>
            Aucune évolution par rapport au mois précédent n’est affichée : cet historique n’est
            pas chargé dans votre espace.
          </p>
        </div>
      </details>
    </section>
  );
}
function Overview({
  session,
  dossier,
  declinedIds,
}: {
  session: Session;
  dossier: ArtisanDossier | null;
  declinedIds: string[];
}) {
  const { data, profileId } = session;
  const now = new Date();
  const missions = artisanMissions(data.interventions, profileId);
  const perf = artisanPerformance(
    data.interventions,
    data.quotes,
    data.payments,
    data.reviews,
    profileId,
    now,
  );
  const today = missions.active.slice(0, 6);
  const appointments = useAppointments(
    session,
    today.map((i) => i.id),
  );
  const offers = missions.offers.filter((o) => !declinedIds.includes(o.id));
  const live = session.mode === "live";
  const unapproved = live && session.profile?.artisan_approved === false;
  return (
    <>
      {unapproved && (
        <div className="alert warning" role="status">
          <Icon name="shield" />
          <span>{approvalWording(dossier?.artisan_profile?.application_status)}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => session.go("application")}
          >
            Voir ma candidature
          </button>
        </div>
      )}
      <section className={styles.banner} aria-labelledby="overview-title">
        <div>
          <span className={styles.bannerKicker}>Tableau de bord</span>
          <h1 id="overview-title">Vue d’ensemble</h1>
          <p>Voici votre activité et vos performances.</p>
        </div>
        <PanelArt />
      </section>
      <div className={styles.sectionHead}>
        <h2>Missions d’aujourd’hui</h2>
        <button type="button" className="text-button" onClick={() => session.go("missions")}>
          Voir tout
        </button>
      </div>
      {today.length ? (
        <>
          <div className={styles.rows}>
            {today.map((i) => (
              <MissionRow
                key={i.id}
                intervention={i}
                right={appointmentSlot(appointments[i.id], now)}
                onOpen={() => session.go("mission", i.id)}
              />
            ))}
          </div>
          <details className={`${styles.basis} ${styles.basisFlat}`}>
            <summary>Comment ces missions sont choisies</summary>
            <div className={styles.basisBody}>
              <p>
                Dossiers actifs qui vous sont affectés, sur les dossiers chargés. L’horaire affiché
                est le rendez-vous enregistré ; sans rendez-vous, il reste à fixer.
              </p>
            </div>
          </details>
        </>
      ) : (
        <section className="panel">
          <Empty
            icon="briefcase"
            title="Aucune mission active"
            action={
              <button
                type="button"
                className="button outline"
                onClick={() => session.go("missions")}
              >
                Voir les missions disponibles
              </button>
            }
          >
            Les missions acceptées apparaîtront ici avec leur statut et leur horaire.
          </Empty>
        </section>
      )}
      <PerformanceSummary perf={perf} onDetail={() => session.go("performance")} />
      <button
        type="button"
        className={`button primary ${styles.block} ${styles.cta}`}
        onClick={() => session.go("missions")}
      >
        Voir missions disponibles
        {offers.length ? <span className={styles.ctaCount}>{offers.length}</span> : null}
        <Icon name="arrow" size={18} />
      </button>
      {session.mode === "demo" && (
        <DemoNote>
          Les missions, avis et montants affichés sont des exemples de démonstration.
        </DemoNote>
      )}
    </>
  );
}

// ---- Missions list -------------------------------------------------------------------------
/** Demo only: the anonymized offer shape of the paged feed (never address, contact or full postcode). */
function toDemoOffer(i: Intervention): MissionOffer {
  return {
    id: i.id,
    category: i.category,
    city: i.city,
    postal_code: `${i.postal_code.slice(0, 3)}**`,
    urgency: i.urgency,
    status: "requested",
    estimate_min_cents: i.estimate_min_cents,
    estimate_max_cents: i.estimate_max_cents,
    created_at: i.created_at,
  };
}
function Missions({ session, declinedIds }: { session: Session; declinedIds: string[] }) {
  const [segment, setSegment] = useState<MissionSegment>("available");
  const [radiusRev, setRadiusRev] = useState(0);
  const m = artisanMissions(session.data.interventions, session.profileId);
  const offers = m.offers.filter((o) => !declinedIds.includes(o.id));
  const hidden = m.offers.length - offers.length;
  const done = [...m.awaitingPayment, ...m.done].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const demo = session.mode === "demo";
  // Live: offers come from the paged server feed (beyond 100), so no exhaustive count is shown.
  const options = missionSegmentOptions({ offers: demo ? offers.length : null, active: m.active.length, done: done.length });
  const open = (id: string) => session.go("mission", id);
  return (
    <>
      <PageTitle
        title="Missions"
        subtitle="Offres, dossiers en cours et terminés, sur les dossiers chargés."
      />
      <div className={styles.segmentsWrap}>
        <Segments label="Filtrer les missions" value={segment} options={options} onChange={setSegment} />
      </div>
      {segment === "available" && (
        <MissionRadiusPanel demo={demo} context={session.mutationContext} onSaved={() => setRadiusRev((n) => n + 1)} />
      )}
      {segment === "available" && (
        <AvailableMissionsPanel
          key={`${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${demo ? "demo" : "live"}|${radiusRev}`}
          context={session.mutationContext}
          demo={demo}
          demoItems={demo ? offers.map(toDemoOffer) : undefined}
          onAccept={(id) => session.action(id, "accept_mission")}
          onOpenAccepted={(id) => session.openIntervention(id)}
        />
      )}
      {segment === "available" && demo && hidden > 0 && (
        <p className={styles.sectionNote}>
          {hidden} offre{hidden > 1 ? "s" : ""} refusée{hidden > 1 ? "s" : ""} pendant cette
          session, masquée{hidden > 1 ? "s" : ""}.
        </p>
      )}
      {segment === "active" &&
        (m.active.length ? (
          <div className={styles.rows}>
            {m.active.map((i) => (
              <MissionRow
                key={i.id}
                intervention={i}
                right={
                  <>
                    <strong>{shortId(i.id)}</strong>
                    <span>{i.urgency === "urgent" ? "Urgente" : "À planifier"}</span>
                  </>
                }
                onOpen={() => open(i.id)}
              />
            ))}
          </div>
        ) : (
          <section className="panel">
            <Empty
              icon="briefcase"
              title="Aucune mission en cours"
              action={
                <button
                  type="button"
                  className="button outline"
                  onClick={() => setSegment("available")}
                >
                  Voir les missions disponibles
                </button>
              }
            >
              Acceptez une mission disponible pour commencer un dossier.
            </Empty>
          </section>
        ))}
      {segment === "done" &&
        (done.length ? (
          <div className={styles.rows}>
            {done.map((i) => (
              <MissionRow
                key={i.id}
                intervention={i}
                right={
                  <>
                    <strong>{shortId(i.id)}</strong>
                    <span>
                      {i.paid_at
                        ? `Réglée le ${date(i.paid_at)}`
                        : i.completed_at
                          ? `Terminée le ${date(i.completed_at)}`
                          : "Terminée"}
                    </span>
                  </>
                }
                onOpen={() => open(i.id)}
              />
            ))}
          </div>
        ) : (
          <section className="panel">
            <Empty icon="check" title="Aucune intervention terminée">
              Les interventions terminées et réglées seront listées ici.
            </Empty>
          </section>
        ))}
      {session.mode === "demo" && (
        <DemoNote>Offres et dossiers de démonstration : aucun client réel n’est concerné.</DemoNote>
      )}
    </>
  );
}

// ---- Mission (offer or work dossier) -----------------------------------------------------
function MissionView({
  session,
  id,
  onDeclined,
}: {
  session: Session;
  id: string;
  onDeclined: (id: string) => void;
}) {
  const i = session.data.interventions.find((x) => x.id === id);
  // Deep link to a mission absent from the cached workspace: one causal refresh before « introuvable ».
  const presence = useDetailPresence(session, "artisan-mission", id, Boolean(i));
  if (id && !i) {
    if (presence.decision === "loading") return <Loader label="Recherche du dossier…" />;
    if (presence.decision === "detail" || presence.decision === "detail_loading" || presence.decision === "detail_error")
      return <PointReadState presence={presence} backLabel="Missions" onBack={() => session.go("missions")} />;
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
  if (!id || !i)
    return (
      <>
        <PageTitle
          back={{ label: "Missions", onClick: () => session.go("missions") }}
          title={presence.openAnyway ? "Dossier non chargé" : "Dossier introuvable"}
        />
        <section className="panel">
          <Empty
            icon="search"
            title="Ce dossier n’est pas dans vos données chargées"
            action={
              <>
                <button
                  type="button"
                  className="button outline"
                  disabled={session.busy}
                  onClick={() => void session.refresh()}
                >
                  <Icon name="refresh" />
                  Actualiser mes données
                </button>
                {presence.openAnyway && (
                  <button type="button" className="button outline" onClick={presence.openAnyway}>
                    Ouvrir quand même
                  </button>
                )}
              </>
            }
          >
            Il a peut-être été attribué à un autre artisan ou retiré par le client.
          </Empty>
        </section>
      </>
    );
  if (i.artisan_id === session.profileId) return <WorkDossier session={session} intervention={i} />;
  if (i.status === "requested" && !i.artisan_id)
    return <OfferView session={session} intervention={i} onDeclined={onDeclined} />;
  return <Forbidden onHome={() => session.go("overview")} />;
}
function OfferView({
  session,
  intervention: i,
  onDeclined,
}: {
  session: Session;
  intervention: Intervention;
  onDeclined: (id: string) => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const c = category(i.category);
  const blocked = session.mode === "live" && session.profile?.artisan_approved === false;
  async function decline(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (reason.trim().length < 5) {
      setReasonError("Indiquez un motif d’au moins 5 caractères.");
      return;
    }
    setReasonError("");
    const ok = await session.operate(i.id, { action: "decline_offer", reason: reason.trim() });
    if (ok) {
      onDeclined(i.id);
      session.go("missions");
    }
  }
  return (
    <>
      <PageTitle
        back={{ label: "Missions", onClick: () => session.go("missions") }}
        title="Nouvelle mission"
        subtitle={`${shortId(i.id)} — ${ARTISAN_STATUS.requested}`}
        action={
          <Tag tone={i.urgency === "urgent" ? "amber" : "neutral"}>
            {i.urgency === "urgent" ? "Urgente" : "À planifier"}
          </Tag>
        }
      />
      <section className={`panel ${styles.card}`}>
        <span className={`${styles.cardIcon} ${styles.greenIcon}`}>
          <Icon name="location" size={24} />
        </span>
        <div>
          <span className={styles.cardLabel}>Lieu d’intervention</span>
          <strong className={styles.cardValue}>
            {i.city} — {maskPostal(i.postal_code)}
          </strong>
          <p>Adresse complète visible après acceptation.</p>
        </div>
      </section>
      <section className={`panel ${styles.card}`}>
        <span className={`${styles.cardIcon} ${styles.blueIcon}`}>
          <Icon name={c.icon} size={24} />
        </span>
        <div>
          <span className={styles.cardLabel}>Type de problème</span>
          <strong className={styles.cardValue}>{c.label}</strong>
          {i.description ? (
            <p className={styles.description}>{i.description}</p>
          ) : (
            <p>Description détaillée transmise après acceptation.</p>
          )}
        </div>
      </section>
      <div className={styles.tiles}>
        <section className={`panel ${styles.tile}`}>
          <Unavailable
            title="Distance"
            reason="Aucune source de mesure de position : la distance n’est pas calculée. Repérez-vous avec l’adresse du dossier."
            blocker="géolocalisation non prévue dans cette version"
          />
        </section>
        <section className={`panel ${styles.tile}`}>
          <span className={`${styles.perfIcon} ${styles.greenIcon}`}>
            <Icon name="euro" />
          </span>
          <div>
            <span className={styles.tileLabel}>Fourchette</span>
            <strong className={styles.tileValue}>
              {money(i.estimate_min_cents)} – {money(i.estimate_max_cents)}
            </strong>
            <span className={styles.tileNote}>TTC estimé, indicatif — le devis fera foi</span>
          </div>
        </section>
      </div>
      {blocked && (
        <div className="alert warning" role="status">
          <Icon name="shield" />
          <span>
            Votre compte n’est pas approuvé : l’acceptation est désactivée tant que l’opérateur
            n’a pas validé votre candidature.
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => session.go("application")}
          >
            Voir ma candidature
          </button>
        </div>
      )}
      <div className={styles.offerActions}>
        <button
          type="button"
          className={`button primary large ${styles.block}`}
          disabled={session.busy || blocked}
          onClick={() => void session.action(i.id, "accept_mission")}
        >
          {session.busy ? "Acceptation…" : "Accepter la mission"}
        </button>
        {!declining ? (
          <button
            type="button"
            className={`button outline ${styles.block}`}
            disabled={session.busy}
            onClick={() => setDeclining(true)}
          >
            Refuser la mission
          </button>
        ) : (
          <form className={`panel ${styles.declineForm}`} onSubmit={decline}>
            <Field
              label="Motif du refus"
              hint="Enregistré avec votre refus ; la demande du client reste ouverte."
              error={reasonError}
            >
              <textarea
                required
                minLength={5}
                maxLength={500}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className={styles.formActions}>
              <button type="submit" className="button outline" disabled={session.busy}>
                {session.busy ? "Enregistrement…" : "Confirmer le refus"}
              </button>
              <button type="button" className="text-button" onClick={() => setDeclining(false)}>
                Annuler
              </button>
            </div>
          </form>
        )}
      </div>
      <Unavailable
        title="Appeler le client"
        reason="Les coordonnées du client sont transmises après l’attribution de la mission."
      />
      {i.urgency === "urgent" && (
        <div className={`${styles.note} ${styles.noteAmber}`}>
          <Icon name="warning" />
          <div>
            <strong>Demande urgente</strong>
            <p>
              Le client souhaite une prise en charge prioritaire. Aucun délai n’est garanti par la
              plateforme ; précisez votre disponibilité après acceptation.
            </p>
          </div>
        </div>
      )}
      {session.mode === "demo" && (
        <DemoNote>Offre de démonstration : aucun client réel n’est contacté.</DemoNote>
      )}
    </>
  );
}
function WorkDossier({ session, intervention: i }: { session: Session; intervention: Intervention }) {
  const [opsVersion, setOpsVersion] = useState(0);
  const { ops, pending } = useOperations(session, i.id, opsVersion);
  const [viewQuoteId, setViewQuoteId] = useState(session.selectedQuoteId);
  const operate = async (body: OperationBody) => {
    const ok = await session.operate(i.id, body);
    if (ok) setOpsVersion((v) => v + 1);
    return ok;
  };
  const c = category(i.category);
  const versions = quoteVersions(session.data.quotes, i.id);
  const current = pickQuote(
    session.data.quotes,
    i.id,
    versions.some((v) => v.id === viewQuoteId) ? viewQuoteId : undefined,
  );
  const stage: TravelStage = ops?.travel_stage ?? i.travel_stage ?? "planned";
  const canAppoint = ["assigned", "quoted", "accepted"].includes(i.status);
  const canTravel = ["accepted", "in_progress"].includes(i.status);
  const canReport = ["in_progress", "completed", "paid"].includes(i.status);
  const state = session.capabilities.operations;
  return (
    <>
      <PageTitle
        back={{ label: "Missions", onClick: () => session.go("missions") }}
        title={c.label}
        subtitle={`${shortId(i.id)} — créée le ${dateTime(i.created_at)}`}
        action={<Badge status={i.status} wording="artisan" />}
      />
      <div data-theme-leaf="support-help">
        <DossierHelpLink session={session} interventionId={i.id} />
      </div>
      <div className={styles.dossierGrid}>
        <div className={styles.dossierMain}>
          <section className="panel" aria-labelledby="dossier-intervention">
            <h2 id="dossier-intervention">Intervention</h2>
            <p className={styles.description}>{i.description || "Aucune description transmise."}</p>
            <dl className={styles.facts}>
              <div>
                <dt>Adresse</dt>
                <dd>
                  {i.address}
                  <br />
                  {i.postal_code} {i.city}
                </dd>
              </div>
              <div>
                <dt>Besoin</dt>
                <dd>{i.urgency === "urgent" ? "Demande urgente" : "Intervention à planifier"}</dd>
              </div>
              <div>
                <dt>Estimation initiale</dt>
                <dd>
                  {money(i.estimate_min_cents)} – {money(i.estimate_max_cents)}
                  <small>Indicative, TTC. Le devis accepté fait foi.</small>
                </dd>
              </div>
              <div>
                <dt>Déplacement</dt>
                <dd>{TRAVEL_STAGE[stage]}</dd>
              </div>
            </dl>
          </section>
          <NextAction session={session} intervention={i} />
          <DocumentManager
            key={`${i.id}|${session.profileId}|${session.mutationContext.generation()}`}
            documents={[]}
            interventions={[]}
            interventionId={i.id}
            profileId={session.profileId}
            live={session.mode === "live"}
            demo={session.mode === "demo"}
            onRefresh={session.refresh}
            photoReview={session.mutationContext}
          />
          {/* SYS-10: photo review of this dossier (validate / reject per server flags). */}
          {!i.site_id && i.status !== "cancelled" && <PhotoReviewPanel
            key={`${i.id}|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}`}
            interventionId={i.id}
            role="artisan"
            photos={session.data.documents.filter((d) => d.intervention_id === i.id && reviewImage(d.mime_type)).map((d) => ({ id: d.id, name: d.name }))}
            context={session.mutationContext}
            demo={session.mode === "demo"}
          />}
          <AppointmentPanel
            appointment={ops?.appointment ?? null}
            loaded={ops !== null}
            pending={pending}
            state={state}
            editable={canAppoint}
            busy={session.busy}
            onSave={(starts_at, ends_at, note) =>
              operate({ action: "save_appointment", starts_at, ends_at, note })
            }
            reminder={
              <AppointmentReminderPanel
                key={`${i.id}|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}`}
                interventionId={i.id}
                role="artisan"
                context={session.mutationContext}
                demo={session.mode === "demo"}
              />
            }
          />
          {canTravel && (
            <TravelPanel
              stage={stage}
              busy={session.busy}
              onSet={(next) => operate({ action: "set_travel_stage", stage: next })}
            />
          )}
          {canTravel && <TrackingAnchor session={session} variant="artisan" interventionId={i.id} authority={{ canWrite: true }} />}
          <QuotePanel
            session={session}
            intervention={i}
            versions={versions}
            current={current}
            onView={setViewQuoteId}
            onPublished={(quoteId) => setViewQuoteId(quoteId ?? "")}
          />
          {canReport && (
            <ReportPanel
              report={ops?.report ?? null}
              loaded={ops !== null}
              pending={pending}
              state={state}
              busy={session.busy}
              onSave={(values) => operate({ action: "save_report", ...values })}
            />
          )}
        </div>
        <aside className={styles.dossierSide}>
          <ParticipantsPanel ops={ops} pending={pending} state={state} />
          {/* Platform-only payment: no artisan declaration of a payment received on site. The
              payment panel below shows the state (and keeps historical declarations honest). */}
          {["completed", "paid"].includes(i.status) && (
            <PaymentPanel session={session} intervention={i} />
          )}
          <section className="panel" aria-labelledby="dossier-messages">
            <h2 id="dossier-messages">Échanges</h2>
            <p>Conversation liée à ce dossier, visible du client.</p>
            <button
              type="button"
              className={`button outline ${styles.block}`}
              style={{ marginTop: 12 }}
              onClick={() => session.go("messages", i.id)}
            >
              <Icon name="message" />
              Ouvrir la conversation
            </button>
          </section>
          {session.mode === "demo" && (
            <DemoNote>Dossier de démonstration : participants et montants sont des exemples.</DemoNote>
          )}
        </aside>
      </div>
    </>
  );
}
function NextAction({ session, intervention: i }: { session: Session; intervention: Intervention }) {
  const s: Status = i.status;
  let body: ReactNode;
  if (s === "assigned")
    body = <p>Prochaine étape : établir le devis ci-dessous et l’envoyer au client.</p>;
  else if (s === "quoted")
    body = <p>Devis envoyé. L’intervention démarre après acceptation du devis par le client.</p>;
  else if (s === "accepted")
    body = (
      <>
        <p>Le client a accepté le devis. Fixez le créneau, puis démarrez l’intervention sur place.</p>
        <div className={styles.formActions}>
          <ConfirmAction
            label="Démarrer l’intervention"
            message="Confirmer le démarrage ? Le client verra l’intervention passer « en cours »."
            confirmLabel="Démarrer"
            className="button primary"
            busy={session.busy}
            onConfirm={() => session.action(i.id, "start")}
          />
        </div>
      </>
    );
  else if (s === "in_progress")
    body = (
      <>
        <p>
          Intervention en cours. Rédigez le compte rendu, puis terminez l’intervention : le client
          sera invité à régler le devis accepté.
        </p>
        <div className={styles.formActions}>
          <ConfirmAction
            label="Terminer l’intervention"
            message="Confirmer la fin de l’intervention ? Le règlement du devis accepté sera demandé au client."
            confirmLabel="Terminer"
            className="button primary"
            busy={session.busy}
            onConfirm={() => session.action(i.id, "complete")}
          />
        </div>
      </>
    );
  else if (s === "completed")
    body = <p>Intervention terminée. Règlement attendu du client ; l’état se met à jour à l’actualisation.</p>;
  else if (s === "paid") body = <p>Dossier réglé. Aucune action attendue de votre part.</p>;
  else if (s === "cancelled") body = <p>Dossier annulé. Aucune action possible.</p>;
  else body = <p>Ce dossier est en attente d’attribution.</p>;
  return (
    <section className="panel" aria-labelledby="dossier-next">
      <h2 id="dossier-next">Prochaine action</h2>
      {body}
    </section>
  );
}
function AppointmentPanel({
  appointment,
  loaded,
  pending,
  state,
  editable,
  busy,
  onSave,
  reminder,
}: {
  appointment: Appointment | null;
  loaded: boolean;
  pending: boolean;
  state: Session["capabilities"]["operations"];
  editable: boolean;
  busy: boolean;
  onSave: (starts_at: string, ends_at: string, note: string) => Promise<boolean>;
  /** Personal appointment reminder (shared leaf), shown after the slot. */
  reminder?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState("2");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  function edit() {
    if (appointment) {
      setStart(toLocalInput(appointment.starts_at));
      const hours = Math.round(
        (Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 3600000,
      );
      setDuration(String(Math.min(4, Math.max(1, hours || 1))));
      setNote(appointment.note || "");
    }
    setError("");
    setOpen(true);
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const s = new Date(start);
    if (!start || Number.isNaN(s.getTime())) {
      setError("Choisissez une date et une heure de début.");
      return;
    }
    setError("");
    const end = new Date(s.getTime() + Number(duration) * 3600000);
    void onSave(s.toISOString(), end.toISOString(), note.trim()).then((ok) => {
      if (ok) setOpen(false);
    });
  }
  return (
    <section className="panel" aria-labelledby="dossier-appointment">
      <h2 id="dossier-appointment">Rendez-vous</h2>
      {pending ? (
        <Loader label="Lecture du rendez-vous…" />
      ) : !loaded ? (
        <Unavailable title="Rendez-vous" state={state} />
      ) : appointment ? (
        <div className={styles.appointmentLine}>
          <Icon name="calendar" />
          <div>
            {dateTime(appointment.starts_at)} – {time(appointment.ends_at)}
            {appointment.note && <small>{appointment.note}</small>}
            {appointment.updated_at && (
              <small>Enregistré le {dateTime(appointment.updated_at)}</small>
            )}
          </div>
        </div>
      ) : (
        <p>Aucun créneau proposé pour le moment.</p>
      )}
      {reminder}
      {loaded && !pending && editable && !open && (
        <div className={styles.formActions}>
          <button type="button" className="button outline" disabled={busy} onClick={edit}>
            <Icon name="calendar" size={17} />
            {appointment ? "Modifier le créneau" : "Proposer un créneau"}
          </button>
        </div>
      )}
      {loaded && !pending && !editable && (
        <p className={styles.sectionNote} style={{ marginTop: 10 }}>
          Le créneau ne se modifie qu’avant le début des travaux.
        </p>
      )}
      {open && (
        <form onSubmit={submit} style={{ marginTop: 14 }}>
          <Field label="Début du créneau" error={error}>
            <input
              type="datetime-local"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="Durée prévue">
            <select value={duration} onChange={(e) => setDuration(e.target.value)}>
              <option value="1">1 heure</option>
              <option value="2">2 heures</option>
              <option value="3">3 heures</option>
              <option value="4">4 heures</option>
            </select>
          </Field>
          <Field label="Note pour le client (facultative)">
            <input
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Accès, interphone, matériel à prévoir…"
            />
          </Field>
          <div className={styles.formActions}>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer le créneau"}
            </button>
            <button type="button" className="text-button" onClick={() => setOpen(false)}>
              Annuler
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
function TravelPanel({
  stage,
  busy,
  onSet,
}: {
  stage: TravelStage;
  busy: boolean;
  onSet: (stage: TravelStage) => Promise<boolean>;
}) {
  const stages: TravelStage[] = ["planned", "en_route", "on_site"];
  return (
    <section className="panel" aria-labelledby="dossier-travel">
      <h2 id="dossier-travel">Déplacement</h2>
      <p>Indiquez au client où vous en êtes. Ces étapes ne transmettent aucune position.</p>
      <div className={styles.stageButtons} style={{ marginTop: 12 }}>
        {stages.map((s) => (
          <button
            key={s}
            type="button"
            className={styles.stageButton}
            aria-pressed={stage === s}
            disabled={busy || stage === s}
            onClick={() => void onSet(s)}
          >
            <Icon name={s === "planned" ? "clock" : s === "en_route" ? "truck" : "location"} size={17} />
            {TRAVEL_STAGE[s]}
          </button>
        ))}
      </div>
    </section>
  );
}
function QuotePanel({
  session,
  intervention: i,
  versions,
  current,
  onView,
  onPublished,
}: {
  session: Session;
  intervention: Intervention;
  versions: Quote[];
  current: Quote | undefined;
  onView: (id: string) => void;
  /** Publication from the draft editor: exact quote id, or undefined (newest sent is shown). */
  onPublished: (quoteId: string | undefined) => void;
}) {
  // Contract QUOTE-DRAFT-001: the draft editor is available while the dossier is assigned
  // (first quote) or quoted (revision replacing the sent quote). The sent quote stays shown.
  const sentQuote = [...versions].reverse().find((q) => q.status === "sent");
  if (i.status === "assigned")
    return (
      <>
        <QuoteDraftEditor session={session} interventionId={i.id} onPublished={onPublished} />
        {versions.length > 0 && (
          <section className="panel" aria-labelledby="dossier-previous-quotes">
            <h2 id="dossier-previous-quotes">Versions précédentes</h2>
            {versions.map((q) => (
              <div key={q.id} className={styles.quoteLine}>
                <div>
                  {quoteRef(q.id)}
                  <span>
                    {dateTime(q.created_at)} — {quoteStatus(q.status).label}
                  </span>
                </div>
                <strong>{money(q.total_cents)}</strong>
              </div>
            ))}
          </section>
        )}
      </>
    );
  return (
    <>
      <section className="panel" aria-labelledby="dossier-quote">
        <h2 id="dossier-quote">Devis</h2>
        {!current ? (
          <p>Aucun devis pour ce dossier.</p>
        ) : (
          <>
            <div className={styles.quoteHead}>
              <strong>{quoteRef(current.id)}</strong>
              <Tag tone={quoteStatus(current.status).tone}>
                {quoteStatus(current.status).label}
                {current.status === "accepted" && current.accepted_at
                  ? ` le ${date(current.accepted_at)}`
                  : ""}
              </Tag>
            </div>
            {/* ENT-13: contract source only when the server states it. */}
            <ContractSourceLine key={current.id} quoteId={current.id} demo={session.mode === "demo"} />
            {versions.length > 1 && (
              <div className={styles.versionList} role="group" aria-label="Versions du devis">
                {versions.map((q, index) => (
                  <button
                    key={q.id}
                    type="button"
                    className={styles.versionButton}
                    aria-pressed={q.id === current.id}
                    onClick={() => onView(q.id)}
                  >
                    Version {index + 1} — {dateTime(q.created_at)}
                  </button>
                ))}
              </div>
            )}
            <div className={styles.quoteLines}>
              {current.lines.map((l, index) => (
                <div key={index} className={styles.quoteLine}>
                  <div>
                    {l.label}
                    <span>
                      {l.quantity} × {money(l.unit_price_cents)} HT
                    </span>
                  </div>
                  <strong>{money(Math.round(l.quantity * l.unit_price_cents))}</strong>
                </div>
              ))}
            </div>
            <div className={styles.quoteTotals}>
              <div>
                <span>Total HT</span>
                <span>{money(current.subtotal_cents)}</span>
              </div>
              <div>
                <span>TVA ({taxRateLabel(current.tax_rate)})</span>
                <span>{money(current.tax_cents)}</span>
              </div>
              <div className={styles.quoteTotal}>
                <span>Total TTC</span>
                <span>{money(current.total_cents)}</span>
              </div>
            </div>
          </>
        )}
      </section>
      {current && (
        <QuoteDocumentsAnchor
          session={session}
          variant="artisan"
          target={{ interventionId: i.id }}
          authority={{ canWrite: true }}
        />
      )}
      {i.status === "quoted" && (
        <QuoteDraftEditor
          session={session}
          interventionId={i.id}
          replaces={sentQuote}
          onPublished={onPublished}
        />
      )}
    </>
  );
}
function ReportPanel({
  report,
  loaded,
  pending,
  state,
  busy,
  onSave,
}: {
  report: InterventionReport | null;
  loaded: boolean;
  pending: boolean;
  state: Session["capabilities"]["operations"];
  busy: boolean;
  onSave: (values: {
    summary: string;
    checks: ReportCheck[];
    signature_name: string;
  }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="panel" aria-labelledby="dossier-report">
      <h2 id="dossier-report">Compte rendu d’intervention</h2>
      {pending ? (
        <Loader label="Lecture du compte rendu…" />
      ) : !loaded ? (
        <Unavailable title="Compte rendu" state={state} />
      ) : editing ? (
        <ReportForm
          key={report?.updated_at || "new"}
          initial={report}
          busy={busy}
          onSave={onSave}
          onDone={() => setEditing(false)}
        />
      ) : report ? (
        <>
          <p className={styles.description}>{report.summary}</p>
          {report.checks.length > 0 && (
            <ul className={styles.reportChecks}>
              {report.checks.map((c, index) => (
                <li key={index}>
                  <span>{c.label}</span>
                  <Tag tone={c.result === "pass" ? "green" : c.result === "issue" ? "amber" : "neutral"}>
                    {CHECK_RESULTS[c.result]}
                  </Tag>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.sectionNote}>
            Nom déclaré : {report.signature_name}
            {report.updated_at ? ` — enregistré le ${dateTime(report.updated_at)}` : ""}. Il ne
            s’agit pas d’une signature électronique certifiée.
          </p>
          <div className={styles.formActions}>
            <button type="button" className="button outline" disabled={busy} onClick={() => setEditing(true)}>
              <Icon name="edit" size={17} />
              Modifier le compte rendu
            </button>
          </div>
        </>
      ) : (
        <>
          <p>Aucun compte rendu enregistré. Il est visible du client dans son dossier.</p>
          <div className={styles.formActions}>
            <button type="button" className="button outline" disabled={busy} onClick={() => setEditing(true)}>
              <Icon name="edit" size={17} />
              Rédiger le compte rendu
            </button>
          </div>
        </>
      )}
    </section>
  );
}
function ReportForm({
  initial,
  busy,
  onSave,
  onDone,
}: {
  initial: InterventionReport | null;
  busy: boolean;
  onSave: (values: {
    summary: string;
    checks: ReportCheck[];
    signature_name: string;
  }) => Promise<boolean>;
  onDone: () => void;
}) {
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [checks, setChecks] = useState<ReportCheck[]>(
    initial?.checks ?? [
      { label: "Remise sous tension vérifiée", result: "pass" },
      { label: "Zone de travail laissée propre", result: "pass" },
    ],
  );
  const [signature, setSignature] = useState(initial?.signature_name ?? "");
  const [errors, setErrors] = useState<{ summary?: string; checks?: string; signature?: string }>(
    {},
  );
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: typeof errors = {};
    if (summary.trim().length < 10) next.summary = "Décrivez l’intervention en au moins 10 caractères.";
    if (checks.some((c) => !c.label.trim())) next.checks = "Chaque point de contrôle doit avoir un intitulé.";
    if (signature.trim().length < 2) next.signature = "Indiquez le nom de la personne qui déclare ce compte rendu.";
    setErrors(next);
    if (Object.keys(next).length) return;
    void onSave({
      summary: summary.trim(),
      checks: checks.map((c) => ({ label: c.label.trim(), result: c.result })),
      signature_name: signature.trim(),
    }).then((ok) => {
      if (ok) onDone();
    });
  }
  return (
    <form onSubmit={submit}>
      <Field label="Résumé des travaux réalisés" hint="Au moins 10 caractères." error={errors.summary}>
        <textarea
          required
          minLength={10}
          maxLength={4000}
          rows={4}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </Field>
      <fieldset style={{ border: 0, padding: 0, margin: "0 0 14px" }}>
        <legend className={styles.sectionNote} style={{ fontWeight: 600, color: "#102a43" }}>
          Points de contrôle
        </legend>
        <div className={styles.checksList}>
          {checks.map((c, index) => (
            <div key={index} className={styles.checkRow}>
              <Field label={`Contrôle ${index + 1}`}>
                <input
                  required
                  maxLength={160}
                  value={c.label}
                  onChange={(e) =>
                    setChecks(checks.map((x, j) => (j === index ? { ...x, label: e.target.value } : x)))
                  }
                />
              </Field>
              <Field label="Résultat">
                <select
                  value={c.result}
                  onChange={(e) =>
                    setChecks(
                      checks.map((x, j) =>
                        j === index ? { ...x, result: e.target.value as ReportCheck["result"] } : x,
                      ),
                    )
                  }
                >
                  {(Object.keys(CHECK_RESULTS) as ReportCheck["result"][]).map((r) => (
                    <option key={r} value={r}>
                      {CHECK_RESULTS[r]}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Supprimer le contrôle ${index + 1}`}
                disabled={checks.length === 1}
                onClick={() => setChecks(checks.filter((_, j) => j !== index))}
              >
                <Icon name="close" size={17} />
              </button>
            </div>
          ))}
        </div>
        {errors.checks && (
          <p className="inline-validation" role="alert">
            {errors.checks}
          </p>
        )}
        <button
          type="button"
          className="text-button"
          onClick={() => setChecks([...checks, { label: "", result: "pass" }])}
        >
          <Icon name="plus" size={17} />
          Ajouter un point de contrôle
        </button>
      </fieldset>
      <Field
        label="Nom déclaré"
        hint="Nom de la personne qui déclare ce compte rendu. Il ne s’agit pas d’une signature électronique certifiée."
        error={errors.signature}
      >
        <input
          required
          minLength={2}
          maxLength={100}
          autoComplete="name"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
        />
      </Field>
      <div className={styles.formActions}>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer le compte rendu"}
        </button>
        <button type="button" className="text-button" onClick={onDone}>
          Annuler
        </button>
      </div>
    </form>
  );
}
function ParticipantsPanel({
  ops,
  pending,
  state,
}: {
  ops: Operations | null;
  pending: boolean;
  state: Session["capabilities"]["operations"];
}) {
  return (
    <section className="panel" aria-labelledby="dossier-participants">
      <h2 id="dossier-participants">Participants</h2>
      {pending ? (
        <Loader label="Lecture des participants…" />
      ) : !ops ? (
        <Unavailable title="Participants" state={state} />
      ) : ops.participants.length ? (
        ops.participants.map((p) => (
          <div key={p.id} className={styles.participant}>
            <strong>{p.full_name}</strong>
            <span>{(ROLE_NAMES as Record<string, string>)[p.role] || p.role}</span>
            {p.phone ? (
              isTel(p.phone) ? (
                <a href={`tel:${p.phone.replace(/[\s.-]/g, "")}`}>{p.phone}</a>
              ) : (
                <span>{p.phone}</span>
              )
            ) : (
              <span>Téléphone non transmis</span>
            )}
          </div>
        ))
      ) : (
        <p>Aucun participant transmis pour ce dossier.</p>
      )}
    </section>
  );
}
function PaymentPanel({ session, intervention: i }: { session: Session; intervention: Intervention }) {
  const { accepted, payment } = paymentFor(session.data.quotes, session.data.payments, i.id);
  let tag: ReactNode;
  let text: string;
  let awaiting = false;
  if (i.status === "paid" || payment?.status === "paid") {
    tag = <Tag tone="green">Réglé{payment?.paid_at ? ` le ${date(payment.paid_at)}` : ""}</Tag>;
    text = isDeclaredOnSite(payment)
      ? "Règlement déclaré reçu sur place. Ce n’est pas une confirmation bancaire."
      : "Règlement confirmé par la plateforme.";
  } else if (payment?.status === "pending") {
    tag = <Tag tone="amber">Paiement en cours</Tag>;
    text = "Une session de paiement est ouverte côté client ; la confirmation arrive par Stripe.";
  } else if (payment?.status === "failed") {
    tag = <Tag tone="red">Paiement échoué</Tag>;
    text = "Le dernier paiement n’a pas abouti selon Stripe. Le règlement reste attendu ; aucune nouvelle tentative n’est lancée automatiquement.";
  } else {
    tag = <Tag tone="neutral">Règlement attendu du client</Tag>;
    awaiting = true;
    text = "Le client règle le devis accepté (avenants acceptés compris) sur la plateforme après l’intervention, par carte depuis le suivi du dossier ; vous pouvez lui transmettre le lien de suivi ci-dessous. N’acceptez aucun paiement direct : espèces, terminal ou virement personnel.";
  }
  return (
    <section className="panel" aria-labelledby="dossier-payment">
      <h2 id="dossier-payment">Règlement</h2>
      <div className={styles.quoteHead}>
        <strong>{accepted ? `Devis initial accepté : ${money(accepted.total_cents)}` : "Montant du devis accepté introuvable"}</strong>
        {tag}
      </div>
      <p>{text}</p>
      {/* Follow-up link only (GET /api/payments/link): never a Checkout for the artisan, never a collect action. */}
      {awaiting && session.mode === "live" && (
        <PaymentLinkPanel key={`${session.profileId}|${i.id}`} interventionId={i.id} viewer="artisan" amountCents={null} />
      )}
      {session.mode === "demo" && (
        <DemoNote>En démonstration, le règlement est simulé par le rôle client.</DemoNote>
      )}
    </section>
  );
}

// ---- Quotes list ------------------------------------------------------------------------------
function Quotes({ session }: { session: Session }) {
  const { data, profileId } = session;
  const mine = data.interventions.filter((i) => i.artisan_id === profileId);
  const mineIds = new Set(mine.map((i) => i.id));
  const myQuotes = data.quotes
    .filter((q) => mineIds.has(q.intervention_id) || q.artisan_id === profileId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const toWrite = artisanMissions(data.interventions, profileId).quotesToWrite;
  const groups: { key: string; label: string }[] = [
    { key: "sent", label: "Envoyés, en attente du client" },
    { key: "accepted", label: "Acceptés" },
    { key: "rejected", label: "Refusés" },
  ];
  const others = myQuotes.filter((q) => !groups.some((g) => g.key === q.status));
  const byIntervention = new Map(data.interventions.map((i) => [i.id, i]));
  if (!myQuotes.length && !toWrite.length)
    return (
      <>
        <PageTitle title="Devis" subtitle="Vos devis, groupés par état, avec leur total TTC." />
        <section className="panel">
          <Empty
            icon="receipt"
            title="Aucun devis"
            action={
              <button type="button" className="button outline" onClick={() => session.go("missions")}>
                Voir les missions
              </button>
            }
          >
            Un devis se crée depuis une mission acceptée, au statut « Devis à établir ».
          </Empty>
        </section>
      </>
    );
  return (
    <>
      <PageTitle title="Devis" subtitle="Vos devis, groupés par état, avec leur total TTC — sur les dossiers chargés." />
      {toWrite.length > 0 && (
        <>
          <div className={styles.groupHead}>
            <h2>Devis à établir</h2>
            <span>
              {toWrite.length} mission{toWrite.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className={styles.rows}>
            {toWrite.map((i) => (
              <MissionRow
                key={i.id}
                intervention={i}
                right={
                  <>
                    <strong>{shortId(i.id)}</strong>
                    <span>Établir le devis</span>
                  </>
                }
                onOpen={() => session.go("mission", i.id)}
              />
            ))}
          </div>
        </>
      )}
      {groups.map((g) => {
        const rows = myQuotes.filter((q) => q.status === g.key);
        const total = rows.reduce((n, q) => n + q.total_cents, 0);
        return (
          <div key={g.key}>
            <div className={styles.groupHead}>
              <h2>{g.label}</h2>
              <span>
                {rows.length} devis — total TTC <strong>{money(total)}</strong>
              </span>
            </div>
            {rows.length ? (
              <div className={styles.rows}>
                {rows.map((q) => (
                  <QuoteRow
                    key={q.id}
                    quote={q}
                    intervention={byIntervention.get(q.intervention_id)}
                    onOpen={() => session.openIntervention(q.intervention_id, q.id)}
                  />
                ))}
              </div>
            ) : (
              <p className={styles.sectionNote}>Aucun devis dans cet état.</p>
            )}
          </div>
        );
      })}
      {others.length > 0 && (
        <>
          <div className={styles.groupHead}>
            <h2>Autres états</h2>
          </div>
          <div className={styles.rows}>
            {others.map((q) => (
              <QuoteRow
                key={q.id}
                quote={q}
                intervention={byIntervention.get(q.intervention_id)}
                onOpen={() => session.openIntervention(q.intervention_id, q.id)}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
function QuoteRow({
  quote: q,
  intervention,
  onOpen,
}: {
  quote: Quote;
  intervention: Intervention | undefined;
  onOpen: () => void;
}) {
  const status = quoteStatus(q.status);
  return (
    <button type="button" className={styles.row} onClick={onOpen}>
      <span className={styles.rowIcon}>
        <Icon name="receipt" size={24} />
      </span>
      <span className={styles.rowBody}>
        <strong className={styles.rowTitle}>{quoteRef(q.id)}</strong>
        <span className={styles.rowMeta}>
          {intervention ? `${category(intervention.category).label} — ${shortId(intervention.id)}` : shortId(q.intervention_id)}
        </span>
        <span className={styles.rowTags}>
          <Tag tone={status.tone}>{status.label}</Tag>
        </span>
      </span>
      <span className={styles.rowRight}>
        <strong>{money(q.total_cents)}</strong>
        <span>{dateTime(q.created_at)}</span>
      </span>
      <Icon name="arrow" size={16} />
    </button>
  );
}

// ---- Messages ---------------------------------------------------------------------------------
function Messages({ session }: { session: Session }) {
  const mine = session.data.interventions
    .filter((i) => i.artisan_id === session.profileId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const selected = session.param || session.selectedId;
  return (
    <>
      <PageTitle
        title="Messages"
        subtitle="Un fil par mission attribuée. Les offres non acceptées n’ouvrent pas de conversation."
      />
      {mine.length ? (
        <MessageCenter
          live={session.mode === "live"}
          key={selected}
          interventions={mine}
          messages={session.data.messages}
          role={session.role}
          profileId={session.profileId}
          selectedId={selected}
          busy={session.busy}
          onSubmit={(id, body) => session.sendMessage(id, body)}
        />
      ) : (
        <section className="panel">
          <Empty
            icon="message"
            title="Aucune conversation"
            action={
              <button type="button" className="button outline" onClick={() => session.go("missions")}>
                Voir les missions disponibles
              </button>
            }
          >
            Les échanges s’ouvrent une fois une mission acceptée.
          </Empty>
        </section>
      )}
    </>
  );
}

// ---- Documents (M14) --------------------------------------------------------------------------
function Documents({
  session,
  dossier,
  pending,
  onCommand,
}: {
  session: Session;
  dossier: ArtisanDossier | null;
  pending: boolean;
  onCommand: (body: ArtisanCommand) => Promise<boolean>;
}) {
  const [linking, setLinking] = useState<CredentialKind | null>(null);
  const mine = session.data.interventions.filter((i) => i.artisan_id === session.profileId);
  const personal = session.data.documents.filter((d) => !d.intervention_id);
  const today = localDate(new Date());
  const status = dossier?.artisan_profile?.application_status;
  const states = CREDENTIAL_KINDS.map((k) => ({
    ...k,
    state: credentialState(dossier?.credentials ?? [], k.kind, today),
  }));
  const summary = credentialSummary(states.map((s) => s.state));
  return (
    <>
      <PageTitle title="Mes documents" subtitle="Justificatifs obligatoires et pièces de vos dossiers." />
      <section aria-labelledby="documents-required">
        <div className={styles.credHead}>
          <div>
            <h2 id="documents-required">Documents obligatoires</h2>
            <p className={styles.sectionNote} style={{ margin: "4px 0 0" }}>
              Nécessaires pour exercer sur la plateforme. L’opérateur rend une décision sur chaque
              pièce (acceptée, modifications demandées ou refusée, avec son motif) ; une décision
              n’approuve pas à elle seule votre candidature.
            </p>
          </div>
          {!pending && dossier && (
            <div className={styles.credHeadStatus}>
              <span className={`${styles.credCount} ${summary.complete ? styles.credCountComplete : ""}`}>
                <Icon name="shield" size={20} />
                {summary.label}
              </span>
              {/* L’approbation porte sur le dossier ; une décision par pièce ne l’approuve pas à elle seule (ART-03). */}
              {status && (
                <Tag tone={APPLICATION_STATUS[status].tone}>
                  Candidature : {APPLICATION_STATUS[status].label.toLowerCase()}
                </Tag>
              )}
            </div>
          )}
        </div>
        {pending ? (
          <Loader label="Lecture de votre dossier…" />
        ) : !dossier ? (
          <Unavailable title="Justificatifs" state={session.capabilities.artisan} />
        ) : (
          <>
            <div className={styles.credCards}>
              {states.map((s) => (
                <CredentialCard
                  key={s.kind}
                  title={s.title}
                  description={s.description}
                  state={s.state}
                  document={session.data.documents.find((d) => d.id === s.state.credential?.document_id)}
                  busy={session.busy}
                  onLink={() => setLinking(s.kind)}
                  review={
                    s.state.credential ? (
                      <>
                        <CredentialReviewPanel credentialId={s.state.credential.id} mode="artisan" context={session.mutationContext} demo={session.mode === "demo"} />
                        <CredentialReminderPanel credentialId={s.state.credential.id} context={session.mutationContext} demo={session.mode === "demo"} />
                      </>
                    ) : undefined
                  }
                />
              ))}
            </div>
            {linking && (
              <CredentialLinkForm
                key={linking}
                kind={linking}
                documents={personal}
                demo={session.mode === "demo"}
                busy={session.busy}
                onCancel={() => setLinking(null)}
                onSubmit={async (body) => {
                  const ok = await onCommand(body);
                  if (ok) setLinking(null);
                  return ok;
                }}
              />
            )}
          </>
        )}
      </section>
      <div className={styles.note}>
        <Icon name="shield" />
        <div>
          <strong>Pourquoi ces documents ?</strong>
          <p>
            Ils permettent à l’opérateur de vérifier votre immatriculation, votre assurance et vos
            compétences avant d’approuver votre candidature. Ils ne sont pas visibles des clients.
          </p>
        </div>
      </div>
      <DocumentManager
        live={session.mode === "live"}
        profileId={session.profileId}
        documents={session.data.documents}
        interventions={mine}
        demo={session.mode === "demo"}
        onRefresh={session.refresh}
      />
      {/* FIN-05: platform commission invoices addressed to this artisan (read-only, private PDFs). */}
      <CustomerInvoicesPanel filters={{ basis: "platform_commission" }} context={session.mutationContext} demo={session.mode === "demo"} title="Factures de commission de la plateforme" />
    </>
  );
}
function CredentialCard({
  title,
  description,
  state,
  document,
  busy,
  onLink,
  review,
}: {
  title: string;
  description: string;
  state: CredentialState;
  document: StoredDocument | undefined;
  busy: boolean;
  onLink: () => void;
  /** ART-03: read-only decisions of this credential (history, current decision, reason). */
  review?: ReactNode;
}) {
  const iconClass = state.key === "pending" ? styles.credBlue : state.key === "expired" ? styles.credAmber : styles.credRed;
  const icon = state.key === "pending" ? "clock" : state.key === "expired" ? "refresh" : "warning";
  return (
    <section className={`panel ${styles.credCard}`} aria-label={title}>
      <span className={`${styles.credIcon} ${iconClass}`}>
        <Icon name={icon} size={26} />
      </span>
      <div className={styles.credBody}>
        <div className={styles.credTitle}>{title}</div>
        <p className={styles.credDesc}>{description}</p>
        {state.credential && (
          <p className={styles.credMeta}>
            {document ? document.name : "Document lié (nom indisponible dans vos données chargées)"}
            {" — transmis le "}
            {date(state.credential.created_at)}
          </p>
        )}
      </div>
      {/* M14 : colonne d’état à droite — pastille réelle et date d’expiration réelle, sinon dit sans date. */}
      <div className={styles.credStatus}>
        <Tag tone={state.tone}>{state.label}</Tag>
        {credentialDateLabel(state) && <small>{credentialDateLabel(state)}</small>}
      </div>
      <div className={styles.credActions}>
        <button type="button" className="button outline" disabled={busy} onClick={onLink}>
          <Icon name="upload" size={17} />
          {state.credential ? "Remplacer le document" : "Ajouter le document"}
        </button>
      </div>
      {review && <div className={styles.credActions}>{review}</div>}
    </section>
  );
}
function CredentialLinkForm({
  kind: initialKind,
  documents,
  demo,
  busy,
  onCancel,
  onSubmit,
}: {
  kind: CredentialKind;
  documents: StoredDocument[];
  demo: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: ArtisanCommand) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<CredentialKind>(initialKind);
  const [documentId, setDocumentId] = useState(documents[0]?.id ?? "");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!documentId) {
      setError("Choisissez un document déjà déposé.");
      return;
    }
    setError("");
    void onSubmit({ action: "link_credential", document_id: documentId, kind, expires_on: expires || null });
  }
  return (
    <form className={`panel ${styles.linkForm}`} onSubmit={submit} aria-labelledby="link-credential">
      <h2 id="link-credential" style={{ marginBottom: 6 }}>
        Relier un justificatif
      </h2>
      <p className={styles.sectionNote}>
        Choisissez un document déjà déposé dans votre espace privé, puis précisez sa nature et sa
        date d’expiration. Le document remplace le précédent du même type.
      </p>
      {documents.length === 0 ? (
        <Unavailable
          title="Aucun document personnel déposé"
          reason={
            demo
              ? "Le dépôt de fichiers est désactivé dans la démonstration ; le lien de justificatif ne peut pas être illustré."
              : "Déposez d’abord le fichier dans « Pièces et justificatifs » ci-dessous (sans dossier associé), puis revenez le relier."
          }
        />
      ) : (
        <>
          <Field label="Document déposé" error={error}>
            <select value={documentId} onChange={(e) => setDocumentId(e.target.value)} required>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {date(d.created_at)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nature du justificatif">
            <select value={kind} onChange={(e) => setKind(e.target.value as CredentialKind)}>
              {(Object.keys(CREDENTIAL_KIND_LABEL) as CredentialKind[]).map((k) => (
                <option key={k} value={k}>
                  {CREDENTIAL_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date d’expiration (facultative)" hint="Laissez vide si le document n’expire pas.">
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        </>
      )}
      <div className={styles.formActions}>
        {documents.length > 0 && (
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Enregistrement…" : "Relier le document"}
          </button>
        )}
        <button type="button" className="text-button" onClick={onCancel}>
          {documents.length ? "Annuler" : "Fermer"}
        </button>
      </div>
    </form>
  );
}

// ---- Application (M65) -------------------------------------------------------------------------
function AvailabilitySwitch({
  available,
  busy,
  onToggle,
}: {
  available: boolean;
  busy: boolean;
  onToggle: (next: boolean) => Promise<boolean>;
}) {
  return (
    <div className={styles.switchRow}>
      <span>
        Disponible pour de nouvelles missions
        <small>Indique à l’opérateur et aux clients si vous acceptez de nouvelles demandes.</small>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={available}
        className={styles.switchButton}
        disabled={busy}
        onClick={() => void onToggle(!available)}
      >
        <span className={styles.switchTrack} aria-hidden="true">
          <span className={styles.switchKnob} />
        </span>
        {available ? "Oui" : "Non"}
      </button>
    </div>
  );
}
function Application({
  session,
  dossier,
  pending,
  onCommand,
}: {
  session: Session;
  dossier: ArtisanDossier | null;
  pending: boolean;
  onCommand: (body: ArtisanCommand) => Promise<boolean>;
}) {
  const profile = dossier?.artisan_profile ?? null;
  const formKey = profile ? `${appKey(appValuesFrom(profile))}|${profile.application_status}` : "new";
  const today = localDate(new Date());
  const credentialStates = CREDENTIAL_KINDS.map((k) => ({
    ...k,
    state: credentialState(dossier?.credentials ?? [], k.kind, today),
  }));
  return (
    <>
      <PageTitle
        title="Dossier de candidature"
        subtitle="Les informations examinées par l’opérateur avant de vous confier des missions."
      />
      {pending ? (
        <Loader label="Lecture de votre dossier…" />
      ) : !dossier ? (
        <Unavailable title="Dossier de candidature" state={session.capabilities.artisan} />
      ) : (
        <ApplicationForm
          key={formKey}
          session={session}
          profile={profile}
          credentialStates={credentialStates}
          onCommand={onCommand}
        />
      )}
    </>
  );
}
function ApplicationForm({
  session,
  profile,
  credentialStates,
  onCommand,
}: {
  session: Session;
  profile: ArtisanProfile | null;
  credentialStates: { kind: CredentialKind; title: string; state: CredentialState }[];
  onCommand: (body: ArtisanCommand) => Promise<boolean>;
}) {
  const [values, setValues] = useState<AppValues>(() => appValuesFrom(profile));
  const [postal, setPostal] = useState("");
  const [postalError, setPostalError] = useState("");
  const [touched, setTouched] = useState(false);
  const status: ArtisanApplicationStatus = profile?.application_status ?? "draft";
  const meta = APPLICATION_STATUS[status];
  const missing = missingItems(values);
  const dirty = appKey(values) !== appKey(appValuesFrom(profile));
  const busy = session.busy;
  const canSubmit = status === "draft" || status === "changes_requested";
  // Dossier edits are refused by the platform while work is active or completed but unpaid
  // (contract CL-BE-001): count them from the loaded dossiers to explain the rule up front.
  const mine = session.data.interventions.filter((i) => i.artisan_id === session.profileId);
  const activeJobs = mine.filter((i) =>
    ["assigned", "quoted", "accepted", "in_progress"].includes(i.status),
  ).length;
  const unpaidJobs = mine.filter((i) => i.status === "completed").length;
  const editBlocked = activeJobs + unpaidJobs > 0;
  const set = <K extends keyof AppValues>(key: K, value: AppValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const saveBody = (): ArtisanCommand => ({
    action: "save_profile",
    company_name: values.company_name.trim(),
    siret: values.siret,
    legal_status: values.legal_status,
    employee_count: Number(values.employee_count),
    address: values.address.trim(),
    postal_codes: values.postal_codes,
    categories: values.categories,
  });
  function addPostal() {
    const code = postal.trim();
    if (!/^\d{5}$/.test(code)) {
      setPostalError("Saisissez un code postal à 5 chiffres.");
      return;
    }
    if (values.postal_codes.includes(code)) {
      setPostalError("Ce code postal est déjà dans vos zones.");
      return;
    }
    setPostalError("");
    set("postal_codes", [...values.postal_codes, code]);
    setPostal("");
  }
  async function saveDraft() {
    setTouched(true);
    return onCommand(saveBody());
  }
  async function submitApplication() {
    setTouched(true);
    if (missing.length) return;
    let ok = true;
    if (dirty || !profile) ok = await onCommand(saveBody());
    if (ok) await onCommand({ action: "submit_application" });
  }
  const sections = applicationSteps({
    personalDone: Boolean(session.profile?.full_name) || session.mode === "demo",
    companyName: values.company_name,
    siret: values.siret,
    legalStatus: values.legal_status,
    address: values.address,
    postalCodes: values.postal_codes,
    categories: values.categories,
    credentialsComplete: credentialStates.every((c) => c.state.key !== "missing"),
    hasProfile: Boolean(profile),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void saveDraft();
      }}
      aria-describedby="application-status"
    >
      <div className={styles.appStatus} id="application-status">
        <Tag tone={meta.tone}>{meta.label}</Tag>
        <p>
          {meta.text}
          {profile?.submitted_at && status !== "draft" ? ` Soumise le ${dateTime(profile.submitted_at)}.` : ""}
        </p>
      </div>
      {editBlocked && (
        <div className="alert warning" role="note">
          <Icon name="info" />
          <span>
            Dossier professionnel verrouillé tant que des missions restent à terminer ou à régler
            ({activeJobs} en cours, {unpaidJobs} terminée{unpaidJobs > 1 ? "s" : ""} sans règlement).
            Terminez-les et attendez leur règlement, ou obtenez leur annulation ou réaffectation,
            avant de modifier société, zone ou compétences. Votre disponibilité immédiate et vos
            coordonnées restent modifiables à tout moment ; votre approbation n’est pas retirée.
          </span>
        </div>
      )}
      {/* M65 : barre d’étapes avec connecteurs ; sous 760 px les libellés passent en lecteur d’écran et le résumé reste visible. */}
      <ol className={styles.appSteps} aria-label="Sections du dossier">
        {sections.map((s) => (
          <li key={s.n} className={s.done ? styles.stepDone : undefined}>
            <span aria-hidden="true">{s.done ? <Icon name="check" size={14} /> : s.n}</span>
            <span className={styles.stepLabel}>
              {s.label}
              <small>{s.done ? "Renseignée" : "À compléter"}</small>
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.stepsSummary} role="status">{stepsSummary(sections)}</p>

      <div className={styles.appColumns}>
      <div className={styles.appColumn}>
      <section className={`panel ${styles.sectionCard}`} aria-labelledby="app-s1">
        <div className={styles.sectionTitle}>
          <span className={styles.sectionNum} aria-hidden="true">1</span>
          <h2 id="app-s1">Informations personnelles</h2>
        </div>
        <div className={styles.readonlyRow}>
          <span>Nom complet</span>
          <strong>{session.displayName}</strong>
        </div>
        <div className={styles.readonlyRow}>
          <span>Téléphone</span>
          <strong>{session.profile?.phone || "Non renseigné"}</strong>
        </div>
        <button type="button" className={styles.inlineLink} onClick={() => session.go("profile")}>
          Modifier ces informations dans le profil
          <Icon name="arrow" size={15} />
        </button>
      </section>

      <section className={`panel ${styles.sectionCard}`} aria-labelledby="app-s2">
        <div className={styles.sectionTitle}>
          <span className={styles.sectionNum} aria-hidden="true">2</span>
          <h2 id="app-s2">Informations société</h2>
        </div>
        <div className="form-columns">
          <Field
            label="Nom de la société (obligatoire)"
            error={touched && values.company_name.trim().length < 2 ? "Indiquez le nom de votre société." : undefined}
          >
            <input
              required
              minLength={2}
              maxLength={120}
              autoComplete="organization"
              value={values.company_name}
              onChange={(e) => set("company_name", e.target.value)}
            />
          </Field>
          <Field
            label="SIRET (obligatoire)"
            hint="14 chiffres, sans espace."
            error={touched && !/^\d{14}$/.test(values.siret) ? "Le SIRET doit comporter exactement 14 chiffres." : undefined}
          >
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{14}"
              maxLength={14}
              value={values.siret}
              onChange={(e) => set("siret", e.target.value.replace(/\D/g, "").slice(0, 14))}
            />
          </Field>
        </div>
        <div className="form-columns">
          <Field
            label="Statut juridique (obligatoire)"
            error={touched && !values.legal_status ? "Choisissez un statut juridique." : undefined}
          >
            <select required value={values.legal_status} onChange={(e) => set("legal_status", e.target.value)}>
              <option value="">Sélectionnez…</option>
              {LEGAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Effectif (vous compris)">
            <input
              required
              type="number"
              min="1"
              max="999"
              step="1"
              value={values.employee_count}
              onChange={(e) => set("employee_count", e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Adresse du siège (obligatoire)"
          error={touched && values.address.trim().length < 5 ? "Indiquez l’adresse complète du siège." : undefined}
        >
          <input
            required
            minLength={5}
            maxLength={250}
            autoComplete="street-address"
            value={values.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
      </section>

      <section className={`panel ${styles.sectionCard}`} aria-labelledby="app-s4">
        <div className={styles.sectionTitle}>
          <span className={styles.sectionNum} aria-hidden="true">4</span>
          <h2 id="app-s4">Zones d’intervention et compétences</h2>
        </div>
        <div className={styles.chipInput}>
          <Field label="Ajouter un code postal" hint="5 chiffres, puis Ajouter." error={postalError}>
            <input
              inputMode="numeric"
              pattern="[0-9]{5}"
              maxLength={5}
              value={postal}
              onChange={(e) => setPostal(e.target.value.replace(/\D/g, "").slice(0, 5))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPostal();
                }
              }}
            />
          </Field>
          <button type="button" className="button outline" onClick={addPostal}>
            <Icon name="plus" size={17} />
            Ajouter
          </button>
        </div>
        {values.postal_codes.length ? (
          <ul className={styles.chips} aria-label="Codes postaux couverts" style={{ listStyle: "none", padding: 0 }}>
            {values.postal_codes.map((code) => (
              <li key={code} className={styles.chip}>
                {code}
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={`Retirer le code postal ${code}`}
                  onClick={() => set("postal_codes", values.postal_codes.filter((c) => c !== code))}
                >
                  <Icon name="close" size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.sectionNote}>
            {touched ? "Ajoutez au moins un code postal." : "Aucune zone renseignée pour le moment."}
          </p>
        )}
        <fieldset style={{ border: 0, padding: 0, margin: "8px 0 0" }}>
          <legend className={styles.sectionNote} style={{ fontWeight: 600, color: "#102a43" }}>
            Compétences proposées
          </legend>
          <div className={styles.checkGrid}>
            {CATEGORIES.map((c) => (
              <label key={c.id} className="checkbox-field">
                <input
                  type="checkbox"
                  checked={values.categories.includes(c.id)}
                  onChange={(e) =>
                    set(
                      "categories",
                      e.target.checked
                        ? [...values.categories, c.id]
                        : values.categories.filter((x) => x !== c.id),
                    )
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
          {touched && !values.categories.length && (
            <p className="inline-validation" role="alert">
              Cochez au moins une compétence.
            </p>
          )}
        </fieldset>
      </section>

      </div>
      <div className={styles.appColumn}>
      <section className={`panel ${styles.sectionCard}`} aria-labelledby="app-s3">
        <div className={styles.sectionTitle}>
          <span className={styles.sectionNum} aria-hidden="true">3</span>
          <h2 id="app-s3">Pièces justificatives</h2>
        </div>
        {credentialStates.map((c) => (
          <div key={c.kind} className={styles.readonlyRow}>
            <span>{c.title}</span>
            <Tag tone={c.state.tone}>{c.state.label}</Tag>
          </div>
        ))}
        <p className={styles.sectionNote} style={{ marginTop: 10 }}>
          Les pièces se déposent et se relient depuis vos documents. Elles peuvent être transmises
          avant ou après la soumission ; l’opérateur les examine.
        </p>
        <button type="button" className={styles.inlineLink} onClick={() => session.go("documents")}>
          Gérer mes documents
          <Icon name="arrow" size={15} />
        </button>
      </section>

      <section className={`panel ${styles.sectionCard}`} aria-labelledby="app-s5">
        <div className={styles.sectionTitle}>
          <span className={styles.sectionNum} aria-hidden="true">5</span>
          <h2 id="app-s5">Disponibilité</h2>
        </div>
        {profile ? (
          <AvailabilitySwitch
            available={profile.available}
            busy={busy}
            onToggle={(next) => onCommand({ action: "set_availability", available: next })}
          />
        ) : (
          <p className={styles.sectionNote}>
            La disponibilité se règle une fois le brouillon enregistré.
          </p>
        )}
      </section>

      <section className={`panel ${styles.sectionCard}`} aria-label="Enregistrement et soumission">
        {status === "approved" && dirty && (
          <div className="alert warning" role="status">
            <Icon name="warning" />
            <span>
              Votre candidature est approuvée : enregistrer ces modifications la repasse en
              brouillon et nécessitera un nouvel examen par l’opérateur.
            </span>
          </div>
        )}
        <div className={styles.formActions}>
          {status === "approved" ? (
            <ConfirmAction
              label="Enregistrer le brouillon"
              message="Enregistrer ces modifications repasse votre dossier en brouillon : vous ne pourrez plus accepter de missions tant que l’opérateur ne l’a pas réexaminé. Continuer ?"
              confirmLabel="Enregistrer et repasser en brouillon"
              className="button outline"
              busy={busy}
              onConfirm={saveDraft}
            />
          ) : (
            <button type="submit" className="button outline" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer le brouillon"}
            </button>
          )}
          <button
            type="button"
            className="button primary"
            disabled={busy || missing.length > 0 || !canSubmit}
            onClick={() => void submitApplication()}
          >
            {busy ? "Envoi…" : "Soumettre ma candidature"}
          </button>
        </div>
        {!canSubmit ? (
          <p className={styles.sectionNote} style={{ marginTop: 10 }}>
            {status === "submitted"
              ? "Candidature déjà soumise : l’opérateur l’examine."
              : status === "approved"
                ? "Candidature déjà approuvée. Une modification enregistrée la repassera en brouillon."
                : "Dossier suspendu : la soumission n’est pas possible."}
          </p>
        ) : missing.length ? (
          <>
            <p className={styles.sectionNote} style={{ marginTop: 10 }}>
              Pour soumettre, complétez :
            </p>
            <ul className={styles.missing}>
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.sectionNote} style={{ marginTop: 10 }}>
            Dossier complet. {dirty ? "Vos modifications seront enregistrées puis soumises." : "Vous pouvez soumettre."}
          </p>
        )}
        {session.mode === "demo" && (
          <DemoNote>Dossier de démonstration : aucune vérification réelle n’est effectuée.</DemoNote>
        )}
      </section>
      </div>
      </div>
    </form>
  );
}

// ---- Profile (M36) and performance ------------------------------------------------------------
function PerfTile({
  icon,
  tone,
  label,
  value,
  note,
}: {
  icon: string;
  tone: string;
  label: string;
  value: ReactNode;
  note: string;
}) {
  return (
    <div className={styles.perfTile}>
      <div className={styles.perfTileTop}>
        <span className={`${styles.perfIcon} ${tone}`}>
          <Icon name={icon} />
        </span>
        <strong>{value}</strong>
      </div>
      <span>{label}</span>
      <small>{note}</small>
    </div>
  );
}
const PERF_TONE = { amber: "amberIcon", green: "greenIcon", blue: "blueIcon" } as const;
function PerfGrid({ perf, since }: { perf: Performance; since: string | null }) {
  // Six tuiles M36 ; les indicateurs sans source restent explicitement indisponibles.
  return (
    <>
      <div className={styles.perfGrid}>
        {perfTiles(perf, since).map((t) =>
          t.kind === "unavailable" ? (
            <div key={t.id} className={styles.perfTile}>
              <Unavailable title={t.label} reason={t.reason} blocker={t.blocker} />
            </div>
          ) : (
            <PerfTile
              key={t.id}
              icon={t.icon}
              tone={styles[PERF_TONE[t.tone]]}
              label={t.label}
              value={t.value}
              note={t.note}
            />
          ),
        )}
      </div>
      <details className={styles.basis}>
        <summary>Base de calcul</summary>
        <div className={styles.basisBody}>
          <p>Période : {perf.period}. Calculs réalisés sur vos dossiers chargés, sans extrapolation.</p>
          <p>{perf.basis}</p>
          <ul className={styles.formulaList}>
            <li>Note moyenne : moyenne des notes (1 à 5) des avis déposés sur vos interventions, arrondie au dixième.</li>
            <li>CA du mois : somme TTC des règlements au statut « payé » dont la date de paiement est dans le mois en cours.</li>
            <li>Interventions réalisées : dossiers au statut « réglée ».</li>
            <li>Ancienneté : écart entre la date de création de votre compte et aujourd’hui.</li>
            <li>Taux de satisfaction et ponctualité : aucune source de données ; non calculés.</li>
          </ul>
          <p>
            Aucune évolution par rapport au mois précédent n’est affichée : cet historique n’est pas
            chargé dans votre espace.
          </p>
        </div>
      </details>
    </>
  );
}
function Profile({
  session,
  dossier,
  pending,
  onCommand,
}: {
  session: Session;
  dossier: ArtisanDossier | null;
  pending: boolean;
  onCommand: (body: ArtisanCommand) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const { data, profileId } = session;
  const now = new Date();
  const perf = artisanPerformance(data.interventions, data.quotes, data.payments, data.reviews, profileId, now);
  const artisan = dossier?.artisan_profile ?? null;
  const verified = session.profile?.artisan_approved === true;
  const today = localDate(now);
  const transmitted = CREDENTIAL_KINDS.filter(
    (k) => credentialState(dossier?.credentials ?? [], k.kind, today).key !== "missing",
  ).length;
  const since = seniority(session.profile?.created_at, now);
  return (
    <>
      <PageTitle title="Profil artisan" />
      <div className={styles.profileHead}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(session.displayName)}
        </span>
        <div>
          <h2 className={styles.profileName}>{artisan?.company_name || session.displayName}</h2>
          {artisan?.company_name && <p className={styles.profileSub}>{session.displayName}</p>}
          <div className={styles.profileLine}>
            {perf.rating ? (
              <span>
                <Icon name="star" size={16} /> {fmtRating(perf.rating.average)} / 5 ({perf.rating.count} avis)
              </span>
            ) : (
              <span>Aucun avis pour le moment</span>
            )}
            {verified ? (
              <Tag tone="green">Artisan vérifié</Tag>
            ) : artisan ? (
              <Tag tone={APPLICATION_STATUS[artisan.application_status].tone}>
                Candidature : {APPLICATION_STATUS[artisan.application_status].label.toLowerCase()}
              </Tag>
            ) : null}
          </div>
        </div>
      </div>
      <section className={`panel ${styles.docCard}`} aria-labelledby="profile-docs">
        <span className={`${styles.perfIcon} ${styles.blueIcon}`}>
          <Icon name="shield" />
        </span>
        <div>
          <h2 id="profile-docs">Documents et assurances</h2>
          <p role="status">
            {pending
              ? "Lecture du dossier…"
              : dossier
                ? "Justificatifs transmis, examinés par l’opérateur."
                : "Dossier indisponible pour le moment."}
          </p>
          <button type="button" className={styles.inlineLink} onClick={() => session.go("documents")}>
            Voir les documents
            <Icon name="arrow" size={15} />
          </button>
        </div>
        {!pending && dossier && <span className={styles.docCount}>{transmitted}/3</span>}
      </section>
      <div className={styles.sectionHead} style={{ marginTop: 8 }}>
        <h2>Performance</h2>
      </div>
      <PerfGrid perf={perf} since={since} />
      <div className={styles.profileActions}>
        <button
          type="button"
          className={`button primary ${styles.block}`}
          aria-expanded={editing}
          aria-controls="profile-form"
          onClick={() => setEditing((v) => !v)}
        >
          <Icon name="edit" size={18} />
          {editing ? "Fermer le formulaire" : "Modifier le profil"}
        </button>
        <button type="button" className={`button outline ${styles.block}`} onClick={() => session.go("performance")}>
          <Icon name="chart" size={18} />
          Voir les statistiques détaillées
        </button>
        {editing && (
          <div id="profile-form">
            <ProfileForm
              name={session.displayName}
              phone={session.profile?.phone || ""}
              role={session.role}
              demo={session.mode === "demo"}
              busy={session.busy}
              onSubmit={async (values) => {
                const ok = await session.updateProfile(values);
                if (ok) setEditing(false);
              }}
            />
          </div>
        )}
        <button
          type="button"
          className={`button outline ${styles.block}`}
          disabled={session.busy}
          onClick={() => void session.connectStripe()}
        >
          <Icon name="euro" size={18} />
          Configurer mes règlements Stripe
        </button>
        <p className={styles.sectionNote}>
          Compte artisan approuvé requis ; état du compte actualisé à votre retour.
        </p>
      </div>
      <section className="panel" aria-labelledby="profile-availability">
        <h2 id="profile-availability" style={{ fontSize: 17, marginBottom: 6 }}>
          Disponibilité
        </h2>
        {pending ? (
          <Loader label="Lecture du dossier…" />
        ) : artisan ? (
          <AvailabilitySwitch
            available={artisan.available}
            busy={session.busy}
            onToggle={(next) => onCommand({ action: "set_availability", available: next })}
          />
        ) : (
          <Unavailable
            title="Disponibilité"
            reason={dossier ? "Enregistrez d’abord votre dossier de candidature." : undefined}
            state={dossier ? undefined : session.capabilities.artisan}
          />
        )}
      </section>
      <section className={`panel ${styles.accountLinks}`} aria-label="Mon compte">
        {secondaryNav(session).map((item) => (
          <button key={item.view} type="button" className={styles.accountLink} onClick={() => session.go(item.view)}>
            <Icon name={item.icon} size={18} />
            {item.label}
            <Icon name="arrow" size={16} />
          </button>
        ))}
      </section>
      <InstallPanel />
      <AccountDataPanel
        key={`${session.mode}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`}
        demo={session.mode === "demo"}
        context={session.mutationContext}
        onOpenTicket={(id) => session.go("support", id)}
      />
      <SubscriptionsPanel
        key={`${session.mode}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`}
        role="artisan"
        demo={session.mode === "demo"}
        context={session.mutationContext}
      />
      <div className={styles.profileActions}>
        <button
          type="button"
          className={`button outline ${styles.block}`}
          disabled={session.busy}
          onClick={() => void session.logout()}
        >
          <Icon name="logout" size={18} />
          Se déconnecter
        </button>
      </div>
      {session.mode === "demo" && (
        <DemoNote>Profil de démonstration : notes, montants et dossier sont des exemples.</DemoNote>
      )}
    </>
  );
}
function PerformanceView({ session }: { session: Session }) {
  const { data, profileId } = session;
  const now = new Date();
  const perf = artisanPerformance(data.interventions, data.quotes, data.payments, data.reviews, profileId, now);
  const since = seniority(session.profile?.created_at, now);
  const mineIds = new Set(data.interventions.filter((i) => i.artisan_id === profileId).map((i) => i.id));
  const quoteById = new Map(data.quotes.map((q) => [q.id, q]));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const paidThisMonth = data.payments
    .filter((p) => {
      const q = quoteById.get(p.quote_id);
      if (p.status !== "paid" || !p.paid_at || !q || !mineIds.has(q.intervention_id)) return false;
      const paid = new Date(p.paid_at);
      return paid >= monthStart && paid <= now;
    })
    .sort((a, b) => Date.parse(b.paid_at || "") - Date.parse(a.paid_at || ""));
  const byIntervention = new Map(data.interventions.map((i) => [i.id, i]));
  return (
    <>
      <PageTitle
        back={{ label: "Profil", onClick: () => session.go("profile") }}
        title="Performance"
        subtitle={`Période : ${perf.period} — sur vos dossiers chargés.`}
      />
      <PerfGrid perf={perf} since={since} />
      <section className="panel" aria-labelledby="perf-paid">
        <h2 id="perf-paid" style={{ fontSize: 17, marginBottom: 8 }}>
          Règlements confirmés ce mois-ci
        </h2>
        {paidThisMonth.length ? (
          <div className={styles.paidList}>
            {paidThisMonth.map((p) => {
              const q = quoteById.get(p.quote_id);
              const i = q ? byIntervention.get(q.intervention_id) : undefined;
              return (
                <div key={p.id} className={styles.paidRow}>
                  <div>
                    {i ? category(i.category).label : "Intervention"}
                    <span>
                      {i ? shortId(i.id) : ""}
                      {q ? ` — ${quoteRef(q.id)}` : ""}
                      {p.paid_at ? ` — réglé le ${date(p.paid_at)}` : ""}
                    </span>
                  </div>
                  <strong>{money(p.total_cents)}</strong>
                </div>
              );
            })}
          </div>
        ) : (
          <p>Aucun règlement confirmé ce mois-ci sur vos dossiers chargés.</p>
        )}
      </section>
      {session.mode === "demo" && (
        <DemoNote>Indicateurs calculés sur les données de démonstration.</DemoNote>
      )}
    </>
  );
}

// ---- Planning (ADV-PLANNING-NOTIFICATIONS-001) --------------------------------------------------
function PlanningView({ session, dossier }: { session: Session; dossier: ArtisanDossier | null }) {
  const state = session.capabilities.planning;
  const authority = planningAuthority(
    session.mode,
    session.profile?.artisan_approved,
    dossier?.artisan_profile?.application_status,
  );
  return (
    <>
      <PageTitle
        title="Planning"
        subtitle="Vos disponibilités hebdomadaires et vos rendez-vous, heure de Martinique."
      />
      {state === "unavailable" ? (
        <FeatureUnavailable session={session} featureKey="planning" title="Planning momentanément indisponible" />
      ) : (
      <ArtisanPlanning
        state={state}
        unavailableMessage={state === "available" ? "" : CONTRACT_MESSAGES[state]}
        scope={leafScope(session.profileId, session.role, authority)}
        client={session.features.planning}
        demo={session.mode === "demo" ? demoPlanning(demoPlanningRange(new Date(), PLANNING_TIME_ZONE)) : undefined}
        timeZone={PLANNING_TIME_ZONE}
        onNavigate={(view, param) => {
          if (view === "intervention" && param) session.go("mission", param);
        }}
      />
      )}
    </>
  );
}

// ---- Help --------------------------------------------------------------------------------------
function HelpView({ session }: { session: Session }) {
  return (
    <>
      <PageTitle title="Aide" subtitle="Fonctionnement de votre espace artisan." />
      <section className={`panel ${styles.helpList}`}>
        <details>
          <summary>Comment une mission m’est-elle confiée ?</summary>
          <p>
            Les demandes sans artisan apparaissent dans « Missions disponibles », anonymisées. En
            acceptant, le dossier vous est attribué : l’adresse complète et les participants deviennent
            visibles. Une mission déjà attribuée à un autre artisan ne peut plus être acceptée.
          </p>
        </details>
        <details>
          <summary>Quand établir le devis ?</summary>
          <p>
            Dès que la mission est au statut « Devis à établir ». Le client accepte ou refuse la version
            affichée ; l’intervention démarre après acceptation. Le règlement porte sur le devis accepté,
            pas sur l’estimation initiale.
          </p>
        </details>
        <details>
          <summary>Comment suis-je réglé ?</summary>
          <p>
            Le client règle le devis accepté via Stripe une fois l’intervention terminée. Cet espace relit
            l’état confirmé par la plateforme. Le versement vers votre compte nécessite la configuration
            Stripe Connect depuis votre profil.
          </p>
        </details>
        <details>
          <summary>À quoi servent les justificatifs ?</summary>
          <p>
            L’opérateur vérifie Kbis, assurance et qualification avant d’approuver votre candidature.
            Une pièce transmise n’est pas validée automatiquement.
          </p>
        </details>
      </section>
      <section className="panel">
        <h2 style={{ fontSize: 17, marginBottom: 8 }}>Contacter quelqu’un</h2>
        <p>Pour une intervention, utilisez la conversation du dossier : le client la voit.</p>
        <div className={styles.formActions}>
          <button type="button" className="button outline" onClick={() => session.go("messages")}>
            <Icon name="message" size={17} />
            Ouvrir mes messages
          </button>
        </div>
        <h3 style={{ fontSize: 15, margin: "18px 0 6px" }}>Contacter l’équipe de la plateforme</h3>
        <p>
          Pour une question sur votre dossier de candidature, un règlement ou le fonctionnement de
          l’espace, ouvrez une demande d’assistance : les réponses apparaissent ici, sans appel ni
          email, et aucun délai n’est garanti.
        </p>
        <div className={styles.formActions}>
          <button type="button" className="button outline" onClick={() => session.go("support")}>
            <Icon name="shield" size={17} />
            Ouvrir l’assistance
          </button>
        </div>
      </section>
    </>
  );
}
