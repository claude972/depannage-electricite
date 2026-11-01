"use client";
// Platform Super Admin space (reference M43). The operator of the platform, not the owner of a
// client organisation. Every figure comes from session.loadAdminOverview() (global counts,
// lists bounded to capabilities.list_limit), from the server-paginated dossier list
// (session.loadAdminInterventions / loadAdminIntervention, contract WEB-PWA-ADMIN-LISTS-001),
// from the server-paginated directories (session.loadAdminDirectory / loadAdminDirectoryItem,
// contract WEB-PWA-ADMIN-DIRECTORIES-001) or from session.data; every mutation goes through session.* or the shared forms that already
// carry their own confirmation.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session } from "../app/session-types";
import type {
  AdminInterventionDetail,
  AdminInterventionRow,
  AdminInterventionsPage,
  AdminOverview,
  ArtisanApplicationStatus,
  ArtisanDossier,
  Category,
  CredentialKind,
  DirectoryArtisan,
  DirectoryClient,
  DirectoryFilters,
  DirectoryItem,
  DirectoryKind,
  DirectoryPage,
  Intervention,
  Message,
  Operations,
  Quote,
  Role,
  Status,
  SupportCommand,
  SupportDetail,
  SupportEvent,
  SupportListPage,
  SupportMessage,
  SupportStatus,
  Urgency,
  View,
} from "../app/types";
import { Icon } from "../app/icons";
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
  Segments,
  Tag,
  Unavailable,
} from "../app/ui";
import {
  ArtisanAdministration,
  DocumentManager,
  ProfileForm,
  WarrantyPanel,
} from "../app/forms";
import { canAccess, quoteVersions } from "../app/session";
import {
  CATEGORIES,
  ROLE_NAMES,
  SITE_TYPES,
  STATUS,
  TRAVEL_STAGE,
  category,
  date,
  dateTime,
  initials,
  money,
  quoteRef,
  shortId,
} from "../app/format";
import styles from "./admin.module.css";
import theme from "./admin-theme.module.css";
import { ThemeSurface } from "../app/theme-provider";
import { ThemeToggle } from "../app/theme-toggle";
import { HeaderBell, NotificationsPage } from "./notifications-anchor";
import { PLATFORM_TITLES, PlatformPage } from "./platform-anchor";
import { adminKpis, dashboardRows, loadedNote } from "./admin-lists";
import { platformEntries } from "./anchors";

type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "violet";
type OverviewArtisan = AdminOverview["artisans"][number];

const NAV: { view: View; label: string; icon: string }[] = [
  { view: "admin", label: "Tableau de bord", icon: "home" },
  { view: "admin-artisans", label: "Artisans", icon: "users" },
  { view: "admin-interventions", label: "Interventions", icon: "list" },
  { view: "admin-quotes", label: "Devis & Factures", icon: "receipt" },
  { view: "admin-clients", label: "Clients", icon: "person" },
  { view: "admin-reviews", label: "Avis & Notes", icon: "star" },
  { view: "admin-messages", label: "Messages", icon: "message" },
  { view: "admin-warranty", label: "Garantie", icon: "shield" },
  { view: "admin-settings", label: "Paramètres", icon: "settings" },
];
// Which sidebar entry is highlighted for secondary views.
const NAV_PARENT: Partial<Record<View, View>> = {
  overview: "admin",
  "admin-artisan": "admin-artisans",
  detail: "admin-interventions",
  quote: "admin-interventions",
  messages: "admin-messages",
};
const APPLICATION: Record<ArtisanApplicationStatus, { label: string; tone: Tone }> = {
  draft: { label: "Brouillon", tone: "neutral" },
  submitted: { label: "Soumis, à examiner", tone: "amber" },
  changes_requested: { label: "Compléments demandés", tone: "amber" },
  approved: { label: "Approuvé", tone: "green" },
  suspended: { label: "Suspendu", tone: "red" },
};
const STEP_ORDER: Status[] = [
  "requested",
  "assigned",
  "quoted",
  "accepted",
  "in_progress",
  "completed",
  "paid",
];
const REASSIGNABLE: Status[] = ["requested", "assigned", "quoted"];
const QUOTE_STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: "Envoyé", tone: "blue" },
  accepted: { label: "Accepté", tone: "green" },
  rejected: { label: "Refusé", tone: "red" },
};
const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "En attente", tone: "amber" },
  paid: { label: "Payé", tone: "green" },
  failed: { label: "Échoué", tone: "red" },
};
const CREDENTIAL_LABEL: Record<CredentialKind, string> = {
  registration: "Extrait Kbis ou inscription au registre",
  liability: "Assurance responsabilité civile professionnelle",
  qualification: "Diplôme ou qualification en électricité",
  other: "Autre justificatif",
};
const CHECK_RESULT = {
  pass: "Conforme",
  issue: "Point à traiter",
  not_applicable: "Sans objet",
} as const;

const byNewest = <T extends { created_at: string }>(a: T, b: T) =>
  Date.parse(b.created_at) - Date.parse(a.created_at);
const isApprovedArtisan = (a: OverviewArtisan) =>
  Boolean(a.artisan_approved) && a.application_status === "approved";
const clientKind = (role: Role) =>
  role === "client" ? "Particulier" : role === "manager" ? "Entreprise cliente" : ROLE_NAMES[role];
const shortUser = (id: string | null | undefined) =>
  id ? (id.startsWith("demo-") ? id : `${id.replaceAll("-", "").slice(0, 8)}…`) : "—";
// SIRET shown to the operator with only the last four digits readable.
const maskSiret = (siret: string) => {
  const digits = siret.replace(/\D/g, "");
  if (!digits) return "Non renseigné";
  if (digits.length <= 4) return digits;
  return `${"•".repeat(digits.length - 4)} ${digits.slice(-4)}`;
};
const yesNo = (value: boolean) => (value ? "Oui" : "Non");
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function applicationTag(status: ArtisanApplicationStatus | null | undefined) {
  if (!status) return <Tag tone="neutral">Aucun dossier</Tag>;
  const a = APPLICATION[status];
  return <Tag tone={a.tone}>{a.label}</Tag>;
}
function authorLabel(message: Message, intervention: Intervention | undefined, adminId: string) {
  if (message.author_id === adminId || message.author_id === "demo-admin") return "Exploitant";
  if (intervention?.artisan_id && message.author_id === intervention.artisan_id) return "Artisan";
  if (intervention?.client_id && message.author_id === intervention.client_id) return "Client";
  return "Participant";
}

// ---- Local building blocks -----------------------------------------------------------------
function Kpi({
  icon,
  tone,
  label,
  value,
  note,
}: {
  icon: string;
  tone: "blue" | "amber" | "green" | "navy";
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className={styles.kpi}>
      <span className={`${styles.kpiIcon} ${styles[tone]}`}>
        <Icon name={icon} size={22} />
      </span>
      <div>
        <span className={styles.kpiLabel}>{label}</span>
        <strong className={styles.kpiValue}>{value}</strong>
        {note && <small className={styles.kpiNote}>{note}</small>}
      </div>
    </div>
  );
}
function Panel({
  title,
  count,
  action,
  intro,
  children,
  className,
}: {
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.panel} ${className || ""}`}>
      <div className={styles.panelHead}>
        <h2>
          {title}
          {count !== undefined && <span className={styles.count}>{count}</span>}
        </h2>
        {action}
        {intro && <p>{intro}</p>}
      </div>
      {children}
    </section>
  );
}
type Column<T> = { key: string; label: string; render: (row: T) => ReactNode; wide?: boolean; className?: string };
function DataTable<T>({
  columns,
  rows,
  keyOf,
  caption,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  caption: string;
  empty: ReactNode;
}) {
  if (!rows.length) return <>{empty}</>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th scope="col" key={c.key} className={c.className}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={keyOf(row)}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} className={[c.wide ? "wide" : "", c.className || ""].filter(Boolean).join(" ") || undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Basis({ children }: { children: ReactNode }) {
  return <p className={styles.basis}>{children}</p>;
}
function Person({ name, sub }: { name: string; sub?: ReactNode }) {
  return (
    <span className={styles.person}>
      <span className="avatar">{initials(name) || "?"}</span>
      <span>
        <strong>{name}</strong>
        {sub && <small>{sub}</small>}
      </span>
    </span>
  );
}
function InterventionRow({
  intervention,
  onOpen,
  artisanName,
}: {
  intervention: Intervention;
  onOpen: () => void;
  artisanName?: string;
}) {
  const c = category(intervention.category);
  return (
    <button type="button" className={styles.row} onClick={onOpen}>
      <span className={`service-icon ${intervention.category}`}>
        <Icon name={c.icon} size={22} />
      </span>
      <span className={styles.rowBody}>
        <strong>{c.label}</strong>
        <span>
          {shortId(intervention.id)} · {intervention.city}
        </span>
        <span>Artisan : {intervention.artisan_id ? artisanName || "Artisan attribué" : "Non attribué"}</span>
      </span>
      <span className={styles.rowMeta}>
        <Badge status={intervention.status} />
        <span>Créée le {date(intervention.created_at)}</span>
      </span>
    </button>
  );
}

// ---- Space ---------------------------------------------------------------------------------
export function AdminSpace({ session }: { session: Session }) {
  const demo = session.mode === "demo";
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Overview: loaded on mount and again whenever the workspace changes (mutation or realtime).
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [staleNote, setStaleNote] = useState("");
  // Name of the artisan opened from the directory when the bounded overview does not hold it.
  const [detailName, setDetailName] = useState("");
  const load = useCallback(async () => {
    setReloading(true);
    const result = await sessionRef.current.loadAdminOverview();
    if (!alive.current) return;
    setReloading(false);
    if (result) {
      setOverview(result);
      setOverviewFailed(false);
      setStaleNote("");
      setLoadedAt(new Date());
    } else {
      setOverviewFailed(true);
      setStaleNote(
        "La dernière actualisation a échoué. Les données affichées datent de la lecture précédente.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, session.data, session.mode]);

  // Off-canvas navigation (mobile).
  const [menuOpen, setMenuOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstNav = useRef<HTMLButtonElement>(null);
  const restoreMenuFocus = useRef(false);
  const closeMenu = useCallback(() => {
    restoreMenuFocus.current = true;
    setMenuOpen(false);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    // Focus goes back to the toggle once the main column is no longer inert.
    if (menuOpen || !restoreMenuFocus.current) return;
    restoreMenuFocus.current = false;
    menuButton.current?.focus();
  }, [menuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    firstNav.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, closeMenu]);
  const go = (view: View, param?: string) => {
    setMenuOpen(false);
    session.go(view, param);
  };
  const openDossier = (id: string) => {
    setMenuOpen(false);
    session.openIntervention(id);
  };

  const view = session.view;
  const activeNav = NAV_PARENT[view] || view;
  const caps = overview?.capabilities;
  const limitNote = caps
    ? `Liste limitée aux ${caps.list_limit} derniers enregistrements ; les compteurs sont globaux.`
    : "Liste limitée aux 100 derniers enregistrements ; les compteurs sont globaux.";
  const artisanName = (id: string | null | undefined) =>
    overview?.artisans.find((a) => a.id === id)?.full_name;

  // Renders a view that needs the overview, with the honest loading / unavailable states.
  const withOverview = (render: (o: AdminOverview) => ReactNode) => {
    if (overview) return render(overview);
    if (!overviewFailed) return <Loader label="Chargement de la vue d’ensemble…" />;
    const state = session.capabilities.adminOverview;
    return (
      <Unavailable
        title="Vue d’ensemble indisponible"
        state={state}
        reason={
          state === "available"
            ? "La vue d’ensemble n’a pas pu être chargée. Réessayez dans un instant."
            : undefined
        }
      >
        <div className={styles.actions} style={{ marginTop: 12 }}>
          <button type="button" className="button outline" onClick={() => void load()} disabled={reloading}>
            <Icon name="refresh" size={16} />
            {reloading ? "Actualisation…" : "Réessayer"}
          </button>
        </div>
      </Unavailable>
    );
  };

  // ---- Heading per view ------------------------------------------------------------------
  const heading = ((): { title: string; subtitle: string } => {
    switch (view) {
      case "admin":
      case "overview":
        return {
          title: "Tableau de bord administrateur",
          subtitle: "Vue d’ensemble de l’activité et des validations en attente",
        };
      case "admin-artisans":
        return { title: "Artisans", subtitle: "Candidatures, approbations et suspensions" };
      case "admin-artisan":
        return {
          title: artisanName(session.param) || detailName || "Dossier artisan",
          subtitle: "Examen d’une candidature artisan",
        };
      case "admin-interventions":
        return { title: "Interventions", subtitle: "Recherche et pagination sur l’ensemble des dossiers" };
      case "detail":
      case "quote":
        return { title: `Dossier ${shortId(session.param || "")}`, subtitle: "Lecture administrateur d’une intervention" };
      case "admin-quotes":
        return { title: "Devis & Factures", subtitle: "Devis émis, règlements et pièces financières" };
      case "admin-clients":
        return { title: "Clients", subtitle: "Particuliers, entreprises clientes et organisations" };
      case "admin-reviews":
        return { title: "Avis & Notes", subtitle: "Avis déposés par les clients après règlement" };
      case "admin-messages":
      case "messages":
        return { title: "Messages", subtitle: "Assistance et messages des dossiers" };
      case "notifications":
        return { title: "Notifications", subtitle: "Événements enregistrés par la plateforme pour votre compte" };
      case "platform-operators":
      case "platform-finance":
      case "platform-moderation":
      case "support-queue":
        return PLATFORM_TITLES[view];
      case "admin-settings":
        return { title: "Paramètres", subtitle: "Réglages de la plateforme, fonctions activées et journal d’audit" };
      case "admin-warranty":
        return { title: "Garantie", subtitle: "Suivi après intervention et décisions de garantie" };
      case "documents":
        return { title: "Documents", subtitle: "Pièces de l’espace administrateur" };
      case "profile":
        return { title: "Mon compte", subtitle: "Identité de l’opérateur et déconnexion" };
      default:
        return { title: "Espace Super Admin", subtitle: "Administration de la plateforme" };
    }
  })();

  // ---- Views -------------------------------------------------------------------------------
  const renderDashboard = (o: AdminOverview) => {
    const { pending, active } = dashboardRows(o);
    const kpis = adminKpis(o);
    return (
      <>
        <div className={styles.kpis}>
          {kpis.map((k) => (
            <Kpi key={k.id} icon={k.icon} tone={k.tone} label={k.label} value={k.value} note={k.note} />
          ))}
        </div>
        <details className={styles.kpiBasis}>
          <summary>Base de calcul des indicateurs</summary>
          <ul>
            {kpis.map((k) => (
              <li key={k.id}>{k.basis}</li>
            ))}
          </ul>
        </details>
        <div className={styles.columns}>
          <Panel
            title="Validations artisans en attente"
            count={o.counts.pending_applications}
            action={
              <button type="button" className={styles.link} onClick={() => go("admin-artisans")}>
                Voir toutes les candidatures
              </button>
            }
          >
            <DataTable
              caption="Candidatures artisans en attente"
              rows={pending}
              keyOf={(a) => a.id}
              columns={[
                {
                  key: "name",
                  label: "Artisan",
                  wide: true,
                  render: (a) => <Person name={a.full_name} sub={a.company_name || "Société non renseignée"} />,
                },
                { key: "status", label: "Dossier", render: (a) => applicationTag(a.application_status) },
                {
                  key: "actions",
                  label: "Actions",
                  className: styles.actions,
                  render: (a) => (
                    <button
                      type="button"
                      className={styles.rowAction}
                      aria-label={`Examiner la candidature de ${a.full_name}`}
                      onClick={() => go("admin-artisan", a.id)}
                    >
                      <Icon name="eye" size={15} />
                      <span className={styles.rowActionLabel}>Examiner</span>
                    </button>
                  ),
                },
              ]}
              empty={
                <Empty icon="shield" title="Aucune candidature soumise">
                  Les dossiers artisans soumis à examen apparaîtront ici.
                </Empty>
              }
            />
            <Basis>
              Dossiers au statut « soumis » {loadedNote(o.capabilities.list_limit).replace("chargés", "artisans chargés")}, dans l’ordre transmis ; le compteur est global. La date de soumission n’est pas transmise dans cette vue : elle figure dans le dossier.
            </Basis>
          </Panel>
          <Panel
            title="Interventions en cours"
            count={o.counts.active_interventions}
            action={
              <button type="button" className={styles.link} onClick={() => go("admin-interventions")}>
                Voir toutes les interventions
              </button>
            }
          >
            {active.length ? (
              <div className={styles.rowList}>
                {active.map((i) => (
                  <InterventionRow key={i.id} intervention={i} artisanName={artisanName(i.artisan_id)} onOpen={() => openDossier(i.id)} />
                ))}
              </div>
            ) : (
              <Empty icon="list" title="Aucune intervention en cours">
                Les dossiers actifs apparaîtront ici dès qu’une demande sera enregistrée.
              </Empty>
            )}
            <Basis>Six dossiers non clos les plus récents {loadedNote(o.capabilities.list_limit)}. Les noms des clients ne sont pas transmis dans cette vue.</Basis>
          </Panel>
        </div>
      </>
    );
  };

  // Server-paginated directory (contract WEB-PWA-ADMIN-DIRECTORIES-001): does not depend on the
  // overview, which only feeds the labelled fallback list.
  const renderArtisans = () => (
    <ArtisansView
      session={session}
      overview={overview}
      overviewFailed={overviewFailed}
      demo={demo}
      limitNote={limitNote}
      onOpen={(id) => go("admin-artisan", id)}
      onReloadOverview={() => void load()}
      reloadingOverview={reloading}
    />
  );

  const renderArtisan = () => (
    <ArtisanDetailView
      key={session.param}
      id={session.param}
      session={session}
      overview={overview}
      overviewFailed={overviewFailed}
      demo={demo}
      onBack={() => go("admin-artisans")}
      onOpenDossier={openDossier}
      onResolvedName={setDetailName}
      onReloadOverview={() => void load()}
      reloadingOverview={reloading}
    />
  );

  // Server-paginated list: does not depend on the overview (only artisan names come from it).
  const renderInterventions = () => (
    <InterventionsView
      session={session}
      overview={overview}
      overviewFailed={overviewFailed}
      limitNote={limitNote}
      artisanName={artisanName}
      onOpen={openDossier}
      onReloadOverview={() => void load()}
      reloadingOverview={reloading}
    />
  );

  const renderDossier = (interventionId: string) => (
    <DossierView
      key={interventionId}
      id={interventionId}
      session={session}
      overview={overview}
      overviewFailed={overviewFailed}
      onBack={() => go("admin-interventions")}
      artisanName={artisanName}
    />
  );

  const renderQuotes = () => {
    const quotes = [...session.data.quotes].sort(byNewest);
    const payments = [...session.data.payments].sort(byNewest);
    const interventionOf = (id: string) =>
      session.data.interventions.find((i) => i.id === id) || overview?.interventions.find((i) => i.id === id);
    return (
      <>
        <Panel title="Devis" count={quotes.length} intro="Devis chargés dans l’espace de travail administrateur. Ce sont des devis, pas des factures.">
          <DataTable
            caption="Devis"
            rows={quotes}
            keyOf={(q) => q.id}
            columns={[
              { key: "ref", label: "Référence", render: (q) => <span className={styles.mono}>{quoteRef(q.id)}</span> },
              {
                key: "intervention",
                label: "Intervention",
                wide: true,
                render: (q) => {
                  const i = interventionOf(q.intervention_id);
                  return (
                    <span className={styles.cellStack}>
                      <button type="button" className={styles.link} onClick={() => openDossier(q.intervention_id)}>
                        {shortId(q.intervention_id)}
                      </button>
                      <small>{i ? category(i.category).label : "Dossier non chargé"}</small>
                    </span>
                  );
                },
              },
              { key: "total", label: "Total TTC", render: (q) => <span className={styles.mono}>{money(q.total_cents)}</span> },
              {
                key: "status",
                label: "Statut",
                render: (q) => {
                  const s = QUOTE_STATUS[q.status];
                  return <Tag tone={s?.tone || "neutral"}>{s?.label || q.status}</Tag>;
                },
              },
              { key: "date", label: "Date", render: (q) => date(q.created_at) },
            ]}
            empty={
              <Empty icon="receipt" title="Aucun devis chargé">
                Les devis apparaissent ici lorsqu’ils sont transmis dans l’espace de travail (selon vos droits de lecture).
              </Empty>
            }
          />
        </Panel>
        <Panel title="Règlements" count={payments.length} intro="Règlements Stripe confirmés ou en attente, tels qu’enregistrés sur la plateforme.">
          <DataTable
            caption="Règlements"
            rows={payments}
            keyOf={(p) => p.id}
            columns={[
              { key: "quote", label: "Devis", render: (p) => <span className={styles.mono}>{quoteRef(p.quote_id)}</span> },
              { key: "amount", label: "Montant", render: (p) => <span className={styles.mono}>{money(p.total_cents)}</span> },
              {
                key: "status",
                label: "Statut",
                render: (p) => {
                  const s = PAYMENT_STATUS[p.status];
                  return <Tag tone={s?.tone || "neutral"}>{s?.label || p.status}</Tag>;
                },
              },
              { key: "created", label: "Créé", render: (p) => dateTime(p.created_at) },
              { key: "paid", label: "Payé le", render: (p) => (p.paid_at ? dateTime(p.paid_at) : "—") },
            ]}
            empty={
              <Empty icon="euro" title="Aucun règlement chargé">
                Les règlements apparaissent ici une fois confirmés par Stripe.
              </Empty>
            }
          />
        </Panel>
        {/* Invoices, credit notes and the register live in the platform finance space. */}
        <p className="inline-note" data-admin-finance-link="">
          <a href="#platform-finance">Factures, avoirs et registre : espace Finance plateforme</a>
        </p>
        <Unavailable
          title="Remboursements et litiges"
          reason={
            caps?.refunds
              ? "Fonction annoncée mais pas encore activée dans cette interface : attendez son activation."
              : "Pas encore activé sur ce service : aucun remboursement ni litige ne se traite depuis cette interface. Un remboursement se fait directement dans Stripe."
          }
          blocker="FIN-04"
        />
        <Unavailable title="Commission plateforme" reason="Taux de commission non défini par l’exploitant. Aucun montant de commission n’est calculé ni affiché." blocker="Q-C3" />
      </>
    );
  };

  const renderClients = () => (
    <ClientsView
      session={session}
      overview={overview}
      overviewFailed={overviewFailed}
      limitNote={limitNote}
      onReloadOverview={() => void load()}
      reloadingOverview={reloading}
    />
  );

  const renderReviews = () => {
    const reviews = [...session.data.reviews].sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""));
    const interventionOf = (id: string) =>
      session.data.interventions.find((i) => i.id === id) || overview?.interventions.find((i) => i.id === id);
    const average = reviews.length ? Math.round((reviews.reduce((n, r) => n + r.rating, 0) / reviews.length) * 10) / 10 : null;
    return (
      <>
        <Panel
          title="Avis déposés"
          count={reviews.length}
          intro={average !== null ? `Moyenne ${String(average).replace(".", ",")}/5 sur les ${reviews.length} avis chargés.` : "Aucune moyenne : aucun avis chargé."}
        >
          <DataTable
            caption="Avis"
            rows={reviews}
            keyOf={(r) => r.id}
            columns={[
              {
                key: "intervention",
                label: "Intervention",
                wide: true,
                render: (r) => {
                  const i = interventionOf(r.intervention_id);
                  return (
                    <span className={styles.cellStack}>
                      <button type="button" className={styles.link} onClick={() => openDossier(r.intervention_id)}>
                        {shortId(r.intervention_id)}
                      </button>
                      <small>{i ? `${category(i.category).label} · ${i.city}` : "Dossier non chargé"}</small>
                    </span>
                  );
                },
              },
              {
                key: "rating",
                label: "Note",
                render: (r) => (
                  <span className={styles.mono}>
                    {r.rating}/5 <span className={styles.stars} aria-hidden="true">{"★".repeat(r.rating)}{"☆".repeat(Math.max(0, 5 - r.rating))}</span>
                  </span>
                ),
              },
              { key: "body", label: "Commentaire", wide: true, render: (r) => r.body || <span className={styles.muted}>Sans commentaire</span> },
              { key: "date", label: "Date", render: (r) => (r.created_at ? date(r.created_at) : "—") },
            ]}
            empty={
              <Empty icon="star" title="Aucun avis chargé">
                Les avis sont déposés par les clients après le règlement d’une intervention.
              </Empty>
            }
          />
          <Basis>Avis présents dans l’espace de travail administrateur ; aucun avis n’est inventé ni pondéré.</Basis>
        </Panel>
        <Unavailable title="Modération des avis" reason="Pas encore activé sur ce service : les avis sont affichés tels que publiés, sans masquage, réponse ni signalement." blocker="ADM-06" />
      </>
    );
  };

  const renderMessages = () => {
    const messages = [...session.data.messages].sort(byNewest).slice(0, 20);
    const interventionOf = (id: string) =>
      session.data.interventions.find((i) => i.id === id) || overview?.interventions.find((i) => i.id === id);
    return (
      <>
        <AssistanceCentre
          session={session}
          ticketId={view === "admin-messages" ? session.param : ""}
          onOpenTicket={(id) => go("admin-messages", id)}
          onBack={() => go("admin-messages")}
          onOpenDossier={openDossier}
        />
        <Panel title="Messages des dossiers (lecture)" count={messages.length} intro="Vingt derniers messages échangés dans les dossiers chargés, en lecture seule.">
          {messages.length ? (
            <div className={styles.messages}>
              {messages.map((m) => {
                const i = interventionOf(m.intervention_id);
                return (
                  <article className={styles.message} key={m.id}>
                    <header>
                      <strong>{authorLabel(m, i, session.profileId)}</strong>
                      <span>
                        {shortId(m.intervention_id)}
                        {i ? ` · ${category(i.category).label}` : ""} · {dateTime(m.created_at)}
                      </span>
                    </header>
                    <p>{m.body}</p>
                    <button type="button" className={styles.link} onClick={() => openDossier(m.intervention_id)}>
                      Ouvrir le dossier
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty icon="message" title="Aucun message chargé">
              Les échanges entre clients et artisans apparaîtront ici en lecture.
            </Empty>
          )}
        </Panel>
      </>
    );
  };

  const renderSettings = (o: AdminOverview) => {
    const audit = [...o.audit].sort(byNewest);
    return (
      <>
        <Unavailable title="Paramètres de la plateforme" reason="Aucun réglage n’est modifiable depuis cette interface : les valeurs ci-dessous restent à définir par l’exploitant." blocker="ADM-08">
          <dl className={styles.definitions} style={{ padding: "12px 0 0" }}>
            {["Taux de commission", "TVA par défaut", "Territoire couvert", "Identité de l’exploitant", "Barème public"].map((item) => (
              <FragmentPair key={item} term={item} value="À définir par l’exploitant" />
            ))}
          </dl>
        </Unavailable>
        <Panel title="Fonctions activées sur le service" intro="Lecture seule : l’activation de ces fonctions ne se règle pas depuis cette interface.">
          <div className={`${styles.tableWrap} ${styles.capTable}`}>
            <table className={styles.table}>
              <caption className="sr-only">Fonctions activées</caption>
              <thead>
                <tr>
                  <th scope="col">Fonction</th>
                  <th scope="col">Valeur</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Réaffectation avant acceptation du devis", yesNo(o.capabilities.dispatch_before_quote_acceptance)],
                    ["Remboursements", yesNo(o.capabilities.refunds)],
                    ["Factures", yesNo(o.capabilities.invoices)],
                    [
                      "Demandes d’assistance",
                      o.capabilities.support_tickets
                        ? "Oui"
                        : session.capabilities.support === "available"
                          ? "Activé par le service d’assistance"
                          : "Non",
                    ],
                  ] as const
                ).map(([label, value]) => (
                  <tr key={label}>
                    <td data-label="Fonction">{label}</td>
                    <td data-label="Valeur">{value}</td>
                  </tr>
                ))}
                <tr>
                  <td data-label="Fonction">Taille des listes</td>
                  <td data-label="Valeur">{o.capabilities.list_limit} derniers enregistrements</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Journal d’audit" count={audit.length} intro={`${o.capabilities.list_limit} derniers événements au plus, tels qu’enregistrés par la plateforme.`}>
          <DataTable
            caption="Journal d’audit"
            rows={audit}
            keyOf={(e) => String(e.id)}
            columns={[
              { key: "action", label: "Action", wide: true, render: (e) => e.action },
              { key: "actor", label: "Acteur", render: (e) => <span className={styles.mono}>{shortUser(e.actor_id)}</span> },
              { key: "intervention", label: "Intervention", render: (e) => (e.intervention_id ? <span className={styles.mono}>{shortId(e.intervention_id)}</span> : "—") },
              { key: "date", label: "Date", render: (e) => dateTime(e.created_at) },
            ]}
            empty={
              <Empty icon="document" title="Aucun événement d’audit">
                {demo ? "La démonstration n’enregistre pas de journal d’audit." : "Les actions administratives et opérationnelles seront journalisées ici."}
              </Empty>
            }
          />
        </Panel>
      </>
    );
  };

  const renderProfile = () => (
    <div className={styles.detailGrid}>
      <div>
        <ProfileForm
          name={session.displayName}
          phone={session.profile?.phone || ""}
          role="admin"
          demo={demo}
          busy={session.busy}
          onSubmit={async (values) => {
            await session.updateProfile(values);
          }}
        />
        <InstallPanel />
      </div>
      <aside>
        <Panel title="Rôle Super Admin">
          <div className={styles.panelBody}>
            <p>
              Ce compte administre la plateforme : examen des artisans, lecture de tous les dossiers, réaffectation avant acceptation d’un devis et décisions de garantie. Il n’est ni client, ni artisan, ni propriétaire d’une organisation cliente.
            </p>
            <p className={styles.formNote}>Le rôle est attribué par l’exploitant et ne se modifie pas depuis ce formulaire.</p>
            <div className={styles.actions} style={{ marginTop: 16 }}>
              <button type="button" className="button outline" onClick={() => void session.logout()} disabled={session.busy}>
                <Icon name="logout" size={16} />
                Déconnexion
              </button>
            </div>
          </div>
        </Panel>
      </aside>
    </div>
  );

  let content: ReactNode;
  if (session.loading) content = <Loader />;
  else
    switch (view) {
      case "admin":
      case "overview":
        content = withOverview(renderDashboard);
        break;
      case "admin-artisans":
        content = renderArtisans();
        break;
      case "admin-artisan":
        content = renderArtisan();
        break;
      case "admin-interventions":
        content = renderInterventions();
        break;
      case "detail":
        content = renderDossier(session.param);
        break;
      case "quote": {
        const q = session.data.quotes.find((x) => x.id === session.param);
        content = renderDossier(q ? q.intervention_id : session.param);
        break;
      }
      case "admin-quotes":
        content = renderQuotes();
        break;
      case "admin-clients":
        content = renderClients();
        break;
      case "admin-reviews":
        content = renderReviews();
        break;
      case "admin-messages":
      case "messages":
        content = renderMessages();
        break;
      case "notifications":
        content = <NotificationsPage session={session} withTitle={false} />;
        break;
      case "platform-operators":
      case "platform-finance":
      case "platform-moderation":
      case "support-queue":
        content = <PlatformPage session={session} view={view} withTitle={false} />;
        break;
      case "admin-settings":
        content = withOverview(renderSettings);
        break;
      case "admin-warranty":
        content = <WarrantyPanel demo={demo} role="admin" />;
        break;
      case "documents":
        content = (
          <DocumentManager live={session.mode === "live"} profileId={session.profileId} documents={session.data.documents} interventions={session.data.interventions} demo={demo} onRefresh={session.refresh} />
        );
        break;
      case "profile":
        content = renderProfile();
        break;
      default:
        content = <Forbidden onHome={() => go("admin")} />;
    }

  const pendingCount = overview?.counts.pending_applications || 0;
  return (
    <ThemeSurface className={theme.adminSkin}>
    <div className={styles.space}>
      <aside
        id="admin-sidebar"
        className={`${styles.sidebar} ${menuOpen ? styles.open : ""}`}
        aria-label="Navigation Super Admin"
        inert={isNarrow && !menuOpen}
      >
        <div className={styles.sidebarTop}>
          <Brand compact />
          <button type="button" className={styles.closeButton} onClick={closeMenu} aria-label="Fermer le menu">
            <Icon name="close" size={18} />
          </button>
        </div>
        <nav className={styles.nav} aria-label="Sections de l’administration">
          {[...NAV, ...platformEntries(session.platformAccess, (v) => canAccess(v, session.role, session.mode))].map((item, index) => (
            <button
              type="button"
              key={item.view}
              ref={index === 0 ? firstNav : undefined}
              className={styles.navItem}
              aria-current={activeNav === item.view ? "page" : undefined}
              onClick={() => go(item.view)}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
              {item.view === "admin-artisans" && pendingCount > 0 && (
                <span className={styles.navCount}>
                  <span aria-hidden="true">{pendingCount}</span>
                  <span className="sr-only">{`${pendingCount} candidatures à examiner`}</span>
                </span>
              )}
            </button>
          ))}
        </nav>
        {demo && (
          <div className={styles.roleSwitch}>
            <label htmlFor="admin-demo-role">Explorer un autre rôle (démonstration)</label>
            <select id="admin-demo-role" value={session.role} onChange={(e) => session.setDemoRole(e.target.value as Role)}>
              {(Object.keys(ROLE_NAMES) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_NAMES[r]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className={styles.account}>
          <button type="button" className={styles.accountButton} aria-current={view === "profile" ? "page" : undefined} onClick={() => go("profile")}>
            <span className="avatar">{initials(session.displayName) || "SA"}</span>
            <span>
              <strong>{session.displayName}</strong>
              <small>Super Admin</small>
            </span>
          </button>
          <button type="button" className="button outline" onClick={() => void session.logout()} disabled={session.busy}>
            <Icon name="logout" size={16} />
            Déconnexion
          </button>
        </div>
      </aside>
      {menuOpen && <div className={styles.overlay} onClick={closeMenu} aria-hidden="true" />}
      <div className={styles.main} inert={isNarrow && menuOpen}>
        {demo && (
          <div className={styles.demoBanner}>
            <span>
              <Icon name="info" size={16} />
              Démonstration — données fictives, aucun artisan contacté, aucun débit
            </span>
            <ConfirmAction
              label="Réinitialiser la démonstration"
              message="Les données de démonstration de ce navigateur seront remplacées par le jeu d’exemple initial."
              confirmLabel="Réinitialiser"
              busy={session.busy}
              onConfirm={async () => session.resetDemo()}
            />
          </div>
        )}
        <header className={styles.header}>
          <button
            type="button"
            ref={menuButton}
            className={styles.menuButton}
            aria-expanded={menuOpen}
            aria-controls="admin-sidebar"
            aria-label="Ouvrir le menu"
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" size={20} />
          </button>
          <div className={styles.heading}>
            <h1>{heading.title}</h1>
            <p>{heading.subtitle}</p>
          </div>
          <div className={styles.tools}>
            <ThemeToggle />
            <HeaderBell session={session} />
            <span className={styles.chip} role="status">
              <Icon name="clock" size={16} />
              {loadedAt ? `Données au ${dateTime(loadedAt.toISOString())}` : reloading ? "Lecture des données…" : "Données non chargées"}
            </span>
            <button type="button" className="button outline" onClick={() => void load()} disabled={reloading}>
              <Icon name="refresh" size={16} />
              {reloading ? "Actualisation…" : "Actualiser"}
            </button>
          </div>
        </header>
        <main id="main" className={styles.content}>
          <Alerts error={session.error} notice={session.notice} onClearError={() => session.setError("")} onClearNotice={() => session.setNotice("")} />
          {staleNote && overview && (
            <p className={styles.stale} role="status">
              {staleNote}
            </p>
          )}
          {demo && view !== "profile" && (
            <DemoNote>Les noms, montants et dates affichés sont des exemples de démonstration.</DemoNote>
          )}
          {content}
        </main>
      </div>
    </div>
    </ThemeSurface>
  );
}

// Read-only artisan dossier for the operator: company, zone, skills and credentials.
function ArtisanDossierPanel({
  session,
  userId,
  summary,
}: {
  session: Session;
  userId: string;
  summary: Pick<ArtisanRow, "company_name" | "application_status">;
}) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [dossier, setDossier] = useState<ArtisanDossier | null | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    setDossier(undefined);
    void sessionRef.current.loadArtisanDossier(userId).then((result) => {
      if (active) setDossier(result);
    });
    return () => {
      active = false;
    };
  }, [userId, reloadKey, session.data]);

  const profile = dossier?.artisan_profile ?? null;
  const today = todayIso();
  const documentName = (documentId: string) =>
    session.data.documents.find((d) => d.id === documentId)?.name || `Pièce ${shortUser(documentId)}`;

  let body: ReactNode;
  if (dossier === undefined) {
    body = (
      <div className={styles.panelBody}>
        <Loader label="Lecture du dossier…" />
      </div>
    );
  } else if (dossier === null) {
    body = (
      <div className={styles.panelBody}>
        <Unavailable title="Dossier de l’artisan" state={session.capabilities.artisan}>
          <div className={styles.actions} style={{ marginTop: 12 }}>
            <button type="button" className="button outline" onClick={() => setReloadKey((k) => k + 1)}>
              <Icon name="refresh" size={16} />
              Réessayer la lecture
            </button>
          </div>
        </Unavailable>
      </div>
    );
  } else if (!profile) {
    body = (
      <>
        <dl className={styles.definitions}>
          <dt>Société</dt>
          <dd>{summary.company_name || "Non renseignée"}</dd>
          <dt>État du dossier</dt>
          <dd>{applicationTag(summary.application_status)}</dd>
        </dl>
        <Empty icon="document" title="Dossier non constitué">
          L’artisan n’a pas encore enregistré son dossier (société, SIRET, adresse, zone, compétences). Rien n’est à examiner pour l’instant.
        </Empty>
      </>
    );
  } else {
    const skills = profile.categories.map((c) => CATEGORIES.find((k) => k.id === c)?.label || c);
    body = (
      <>
        <dl className={styles.definitions}>
          <dt>Société</dt>
          <dd>{profile.company_name || "Non renseignée"}</dd>
          <dt>SIRET</dt>
          <dd className={styles.mono}>{maskSiret(profile.siret)}</dd>
          <dt>Statut juridique</dt>
          <dd>{profile.legal_status || "Non renseigné"}</dd>
          <dt>Effectif</dt>
          <dd>{profile.employee_count > 0 ? `${profile.employee_count} personne${profile.employee_count > 1 ? "s" : ""}` : "Non renseigné"}</dd>
          <dt>Adresse</dt>
          <dd>{profile.address || "Non renseignée"}</dd>
          <dt>Zone d’intervention</dt>
          <dd>{profile.postal_codes.length ? profile.postal_codes.join(", ") : "Aucun code postal déclaré"}</dd>
          <dt>Compétences</dt>
          <dd>
            {skills.length ? (
              <span className={styles.tagList}>
                {skills.map((label) => (
                  <Tag key={label} tone="blue">
                    {label}
                  </Tag>
                ))}
              </span>
            ) : (
              "Aucune compétence déclarée"
            )}
          </dd>
          <dt>Disponibilité</dt>
          <dd>{profile.available ? <Tag tone="green">Disponible</Tag> : <Tag tone="neutral">Indisponible</Tag>}</dd>
          <dt>État du dossier</dt>
          <dd>{applicationTag(profile.application_status)}</dd>
          <dt>Soumis le</dt>
          <dd>{profile.submitted_at ? dateTime(profile.submitted_at) : "Pas encore soumis"}</dd>
        </dl>
        <div className={styles.panelBody}>
          <h3 className={styles.subheading}>Justificatifs reliés</h3>
          {dossier.credentials.length ? (
            <ul className={styles.credList}>
              {dossier.credentials.map((c) => {
                const expired = Boolean(c.expires_on && c.expires_on < today);
                return (
                  <li key={c.id} className={styles.credRow}>
                    <Icon name="document" size={18} />
                    <div>
                      <strong>{CREDENTIAL_LABEL[c.kind] || CREDENTIAL_LABEL.other}</strong>
                      <span>{documentName(c.document_id)}</span>
                      <span>
                        {c.expires_on
                          ? `${expired ? "Expiré le" : "Expire le"} ${date(c.expires_on)}`
                          : "Sans date d’expiration"}
                        {" · relié le "}
                        {date(c.created_at)}
                      </span>
                    </div>
                    {expired ? <Tag tone="amber">Expiré</Tag> : <Tag tone="neutral">Transmis</Tag>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.formNote}>Aucun justificatif relié. L’artisan les ajoute depuis son espace « Mes documents ».</p>
          )}
          <p className={styles.formNote}>
            Un justificatif transmis n’est pas validé automatiquement : l’examen des pièces vous revient avant l’approbation.
          </p>
        </div>
      </>
    );
  }
  return <Panel title="Entreprise et dossier">{body}</Panel>;
}
function FragmentPair({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </>
  );
}

// ---- Artisans ------------------------------------------------------------------------------
// Row shape shared by the directory projection and the bounded overview list.
type ArtisanRow = {
  id: string;
  full_name: string;
  phone?: string | null;
  artisan_approved?: boolean;
  created_at?: string | null;
  company_name?: string | null;
  application_status?: ArtisanApplicationStatus | null;
};
type ApprovedFilter = "" | "true" | "false";

function ArtisanTable<T extends ArtisanRow>({ rows, caption, onOpen }: { rows: T[]; caption: string; onOpen: (id: string) => void }) {
  return (
    <DataTable
      caption={caption}
      rows={rows}
      keyOf={(a) => a.id}
      columns={[
        { key: "name", label: "Artisan", wide: true, render: (a) => <Person name={a.full_name} sub={a.created_at ? `Inscrit le ${date(a.created_at)}` : undefined} /> },
        { key: "company", label: "Société", render: (a) => a.company_name || "—" },
        { key: "status", label: "Dossier", render: (a) => applicationTag(a.application_status) },
        {
          key: "approved",
          label: "Approuvé",
          render: (a) => (
            <span className={styles.badges}>
              {a.artisan_approved ? "Oui" : "Non"}
              {a.artisan_approved ? <Tag tone="green">Missions ouvertes</Tag> : <Tag tone="neutral">Missions fermées</Tag>}
            </span>
          ),
        },
        {
          key: "actions",
          label: "Actions",
          render: (a) => (
            <button type="button" className={styles.rowAction} onClick={() => onOpen(a.id)}>
              <Icon name="eye" size={15} />
              Examiner
            </button>
          ),
        },
      ]}
      empty={null}
    />
  );
}

// Server-paginated artisan directory. The bounded overview list only appears, labelled as such,
// when the directory is unavailable; the decisions block below is the existing administration.
function ArtisansView({
  session,
  overview,
  overviewFailed,
  demo,
  limitNote,
  onOpen,
  onReloadOverview,
  reloadingOverview,
}: {
  session: Session;
  overview: AdminOverview | null;
  overviewFailed: boolean;
  demo: boolean;
  limitNote: string;
  onOpen: (id: string) => void;
  onReloadOverview: () => void;
  reloadingOverview: boolean;
}) {
  const directory = useDirectory(session, "artisans");
  const [showBounded, setShowBounded] = useState(false);
  const approved: ApprovedFilter =
    directory.filters.approved === undefined ? "" : directory.filters.approved ? "true" : "false";
  const filtering = Boolean(directory.filters.q || directory.filters.approved !== undefined);
  const boundedLabel = `${overview?.capabilities.list_limit ?? 100} derniers artisans chargés`;

  let body: ReactNode;
  if (directory.page === undefined) {
    body = <Loader label="Chargement des artisans…" />;
  } else if (directory.page === null) {
    body = (
      <DirectoryUnavailable
        title="Annuaire des artisans indisponible"
        state={session.capabilities.adminDirectory}
        onRetry={directory.retry}
        fallbackLabel={`Afficher les ${boundedLabel}`}
        fallbackShown={showBounded}
        onFallback={() => setShowBounded(true)}
      />
    );
  } else if (!directory.rows.length) {
    body = (
      <DirectoryEmpty
        directory={directory}
        filtering={filtering}
        icon="users"
        texts={{
          gone: "Cette page ne contient plus d’artisan",
          noMatch: "Aucun artisan ne correspond",
          none: "Aucun artisan inscrit",
          noneText: "Les inscriptions artisans apparaîtront ici.",
        }}
      />
    );
  } else {
    body = <ArtisanTable rows={directory.rows} caption="Annuaire des artisans" onOpen={onOpen} />;
  }

  return (
    <>
      <Panel title="Artisans inscrits" count={directory.page?.page.total}>
        <form className={styles.filters} onSubmit={directory.submitSearch} noValidate>
          <DirectorySearch id="admin-artisan-search" label="Recherche (nom ou identifiant complet)" placeholder="Nom de l’artisan" directory={directory} />
          <Segments
            label="Approbation"
            value={approved}
            options={[
              ["", "Tous"],
              ["true", "Approuvés"],
              ["false", "Non approuvés"],
            ]}
            onChange={(v) => directory.restart({ approved: v === "" ? undefined : v === "true" })}
          />
          <PageSizeSelect label="Artisans par page" directory={directory} />
          <button type="button" className={styles.link} onClick={directory.reset}>
            <Icon name="refresh" size={15} />
            Réinitialiser
          </button>
          <DirectorySearchHelp id="admin-artisan-search" directory={directory} />
        </form>
        {body}
        <DirectoryPager directory={directory} noun={{ one: "artisan", many: "artisans" }} />
        <Basis>
          Nombre total compté sur l’ensemble des artisans inscrits selon les filtres, pas seulement sur la page affichée. La recherche porte sur le nom, pas sur la société. Les inscriptions ou modifications survenues pendant la consultation n’apparaissent qu’après une actualisation.
        </Basis>
      </Panel>
      {showBounded && (
        <BoundedArtisansView
          overview={overview}
          overviewFailed={overviewFailed}
          overviewState={session.capabilities.adminOverview}
          limitNote={limitNote}
          label={boundedLabel}
          onOpen={onOpen}
          onHide={() => setShowBounded(false)}
          onReload={onReloadOverview}
          reloading={reloadingOverview}
        />
      )}
      <Panel
        title="Décisions d’approbation et suspension"
        intro="Approuver ouvre l’accès aux missions après vérification du dossier ; suspendre ferme les nouvelles missions et les écritures terrain. Après une décision, actualisez les données pour mettre l’annuaire ci-dessus à jour."
        action={
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              directory.retry();
              onReloadOverview();
            }}
            disabled={reloadingOverview}
          >
            <Icon name="refresh" size={15} />
            {reloadingOverview ? "Actualisation…" : "Actualiser les données"}
          </button>
        }
      >
        <div className={styles.embedded}>
          <ArtisanAdministration demo={demo} />
        </div>
      </Panel>
    </>
  );
}

// Fallback when the directory is unavailable: the bounded overview list, filtered in the browser
// and labelled as such. Never presented as the complete directory, never with a total.
function BoundedArtisansView({
  overview,
  overviewFailed,
  overviewState,
  limitNote,
  label,
  onOpen,
  onHide,
  onReload,
  reloading,
}: {
  overview: AdminOverview | null;
  overviewFailed: boolean;
  overviewState: Session["capabilities"]["adminOverview"];
  limitNote: string;
  label: string;
  onOpen: (id: string) => void;
  onHide: () => void;
  onReload: () => void;
  reloading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "none" | ArtisanApplicationStatus>("all");
  const artisans = overview?.artisans;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (artisans || [])
      .filter((a) => {
        if (status === "none" && a.application_status) return false;
        if (status !== "all" && status !== "none" && a.application_status !== status) return false;
        if (!q) return true;
        return a.full_name.toLowerCase().includes(q) || (a.company_name || "").toLowerCase().includes(q);
      })
      .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""));
  }, [artisans, search, status]);
  return (
    <BoundedPanel
      label={label}
      overview={overview}
      overviewFailed={overviewFailed}
      overviewState={overviewState}
      onHide={onHide}
      onReload={onReload}
      reloading={reloading}
      count={(o) => o.artisans.length}
      intro={(o) => `Liste de secours : les ${o.capabilities.list_limit} derniers artisans chargés au plus, filtrés dans le navigateur. Elle n’est pas exhaustive et n’affiche aucun total.`}
    >
      {(o) => (
        <>
          <div className={styles.filters}>
            <label className={styles.filter}>
              Recherche (nom ou société)
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom de l’artisan ou de la société" maxLength={100} />
            </label>
            <label className={styles.filter}>
              État du dossier
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="all">Tous les états</option>
                {(Object.keys(APPLICATION) as ArtisanApplicationStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {APPLICATION[s].label}
                  </option>
                ))}
                <option value="none">Aucun dossier</option>
              </select>
            </label>
          </div>
          {rows.length ? (
            <ArtisanTable rows={rows} caption={label} onOpen={onOpen} />
          ) : o.artisans.length ? (
            <Empty icon="search" title="Aucun artisan chargé ne correspond">
              Modifiez la recherche ou l’état du dossier ; seuls les derniers artisans chargés sont parcourus.
            </Empty>
          ) : (
            <Empty icon="users" title="Aucun artisan chargé">
              La vue d’ensemble n’a transmis aucun artisan.
            </Empty>
          )}
          <Basis>{limitNote}</Basis>
        </>
      )}
    </BoundedPanel>
  );
}

// Shared chrome of the fallback lists: hide link, loading and unavailable states of the overview.
function BoundedPanel({
  label,
  overview,
  overviewFailed,
  overviewState,
  onHide,
  onReload,
  reloading,
  count,
  intro,
  children,
}: {
  label: string;
  overview: AdminOverview | null;
  overviewFailed: boolean;
  overviewState: Session["capabilities"]["adminOverview"];
  onHide: () => void;
  onReload: () => void;
  reloading: boolean;
  count: (o: AdminOverview) => number;
  intro: (o: AdminOverview) => string;
  children: (o: AdminOverview) => ReactNode;
}) {
  const hide = (
    <button type="button" className={styles.link} onClick={onHide}>
      Masquer cette liste
    </button>
  );
  if (!overview) {
    return (
      <Panel title={label} action={hide}>
        {overviewFailed ? (
          <div className={styles.panelBody}>
            <Unavailable title="Derniers enregistrements chargés indisponibles" state={overviewState}>
              <div className={styles.actions} style={{ marginTop: 12 }}>
                <button type="button" className="button outline" onClick={onReload} disabled={reloading}>
                  <Icon name="refresh" size={16} />
                  {reloading ? "Actualisation…" : "Réessayer"}
                </button>
              </div>
            </Unavailable>
          </div>
        ) : (
          <Loader label="Chargement des derniers enregistrements…" />
        )}
      </Panel>
    );
  }
  return (
    <Panel title={label} count={count(overview)} action={hide} intro={intro(overview)}>
      {children(overview)}
    </Panel>
  );
}

// Admin reading of one artisan. The header comes from the bounded overview when it holds the
// artisan, otherwise from the directory detail; the full dossier stays ArtisanDossierPanel.
function ArtisanDetailView({
  id,
  session,
  overview,
  overviewFailed,
  demo,
  onBack,
  onOpenDossier,
  onResolvedName,
  onReloadOverview,
  reloadingOverview,
}: {
  id: string;
  session: Session;
  overview: AdminOverview | null;
  overviewFailed: boolean;
  demo: boolean;
  onBack: () => void;
  onOpenDossier: (id: string) => void;
  onResolvedName: (name: string) => void;
  onReloadOverview: () => void;
  reloadingOverview: boolean;
}) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const fromOverview = overview?.artisans.find((a) => a.id === id);
  const needsItem = !fromOverview;
  // undefined = loading, null = absent (404) or directory unavailable.
  const [item, setItem] = useState<DirectoryArtisan | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!needsItem) return;
    let active = true;
    setItem(undefined);
    void sessionRef.current.loadAdminDirectoryItem("artisans", id).then((result) => {
      if (active) setItem(result);
    });
    return () => {
      active = false;
    };
  }, [id, needsItem, attempt, session.data]);
  const nameRef = useRef(onResolvedName);
  nameRef.current = onResolvedName;
  const resolvedName = fromOverview ? "" : item?.full_name ?? "";
  useEffect(() => {
    nameRef.current(resolvedName);
    return () => nameRef.current("");
  }, [resolvedName]);

  const artisan: ArtisanRow | undefined = fromOverview ?? item ?? undefined;
  const back = (
    <button type="button" className={styles.backLink} onClick={onBack}>
      <Icon name="back" size={16} />
      Retour aux artisans
    </button>
  );
  if (!artisan && item === undefined)
    return (
      <>
        {back}
        <Loader label="Recherche de l’artisan…" />
      </>
    );
  if (!artisan) {
    const state = session.capabilities.adminDirectory;
    return (
      <>
        {back}
        <Empty
          icon="person"
          title="Artisan introuvable"
          action={
            <button type="button" className="button outline" onClick={() => setAttempt((n) => n + 1)}>
              <Icon name="refresh" size={16} />
              Réessayer
            </button>
          }
        >
          Aucune fiche artisan ne correspond à cet identifiant, ou l’annuaire n’a pas répondu. Revenez à la liste pour choisir un artisan.
        </Empty>
        {state !== "available" && <Unavailable title="Annuaire des artisans" state={state} />}
      </>
    );
  }
  const missions = overview ? overview.interventions.filter((i) => i.artisan_id === artisan.id).sort(byNewest) : [];
  return (
    <>
      {back}
      <div className={styles.detailGrid}>
        <div>
          <Panel title="Identité">
            <dl className={styles.definitions}>
              <dt>Nom</dt>
              <dd>{artisan.full_name}</dd>
              {artisan.phone && (
                <>
                  <dt>Téléphone</dt>
                  <dd>{artisan.phone}</dd>
                </>
              )}
              <dt>Approbation</dt>
              <dd>{artisan.artisan_approved ? <Tag tone="green">Approuvé</Tag> : <Tag tone="amber">Non approuvé</Tag>}</dd>
              <dt>Société</dt>
              <dd>{artisan.company_name || "Non renseignée"}</dd>
              <dt>État du dossier</dt>
              <dd>{applicationTag(artisan.application_status)}</dd>
              <dt>Inscription</dt>
              <dd>{artisan.created_at ? date(artisan.created_at) : "Date non transmise"}</dd>
              <dt>Identifiant</dt>
              <dd className={styles.mono}>{shortUser(artisan.id)}</dd>
            </dl>
            {!fromOverview && <Basis>Fiche lue dans l’annuaire : cet artisan ne figure pas parmi les derniers enregistrements de la vue d’ensemble.</Basis>}
          </Panel>
          <ArtisanDossierPanel session={session} userId={artisan.id} summary={artisan} />
          <Panel title="Règles d’approbation">
            <ul className={styles.rules}>
              <li>L’approbation exige un dossier soumis par l’artisan (société, SIRET, adresse, zone et compétences).</li>
              <li>Toute modification du dossier par l’artisan remet son approbation à zéro : le dossier repasse en brouillon.</li>
              <li>La suspension bloque l’accès aux nouvelles missions et les écritures terrain (étape de déplacement, compte rendu).</li>
            </ul>
          </Panel>
          <Panel title={`Interventions de ${artisan.full_name}`} count={overview ? missions.length : undefined}>
            {!overview ? (
              overviewFailed ? (
                <div className={styles.panelBody}>
                  <Unavailable title="Interventions de l’artisan indisponibles" state={session.capabilities.adminOverview}>
                    <div className={styles.actions} style={{ marginTop: 12 }}>
                      <button type="button" className="button outline" onClick={onReloadOverview} disabled={reloadingOverview}>
                        <Icon name="refresh" size={16} />
                        {reloadingOverview ? "Actualisation…" : "Réessayer"}
                      </button>
                    </div>
                  </Unavailable>
                </div>
              ) : (
                <Loader label="Chargement des derniers dossiers…" />
              )
            ) : missions.length ? (
              <div className={styles.rowList}>
                {missions.map((i) => (
                  <InterventionRow key={i.id} intervention={i} artisanName={artisan.full_name} onOpen={() => onOpenDossier(i.id)} />
                ))}
              </div>
            ) : (
              <Empty icon="list" title="Aucune intervention attribuée">
                Aucun dossier parmi les {overview.capabilities.list_limit} derniers chargés n’est attribué à cet artisan.
              </Empty>
            )}
            {overview && <Basis>Dossiers attribués à cet artisan parmi les {overview.capabilities.list_limit} derniers chargés ; la liste complète de ses interventions n’est pas transmise.</Basis>}
          </Panel>
        </div>
        <aside>
          <Panel title="Décision">
            <div className={styles.highlight}>
              <Icon name="info" size={16} />
              <span>
                Retrouvez la ligne « {artisan.full_name} » dans la liste ci-dessous pour approuver ou suspendre sa candidature. La liste est celle de l’administration existante ; actualisez ensuite les données.
              </span>
            </div>
            <div className={styles.embedded}>
              <ArtisanAdministration demo={demo} />
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}

// ---- Interventions -------------------------------------------------------------------------
const PAGE_SIZES = [25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Contract rule for the search text: Unicode letters (accents included), digits, spaces, hyphens
// and apostrophes, 2 to 80 characters once whitespace is collapsed. Built from a string so the
// compiler target does not matter; every current browser supports Unicode property escapes.
const SEARCH_RE = new RegExp("^[\\p{L}\\p{M}\\p{N} '’-]+$", "u");
type SearchCheck = { ok: true; value: string } | { ok: false; error: string };
function checkSearch(raw: string): SearchCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: "" };
  // A full dossier identifier is sent untouched: it is read as an exact reference.
  if (UUID_RE.test(trimmed)) return { ok: true, value: trimmed };
  const value = trimmed.replace(/\s+/g, " ");
  if (value.length < 2) return { ok: false, error: "Saisissez au moins 2 caractères." };
  if (value.length > 80) return { ok: false, error: "La recherche est limitée à 80 caractères." };
  if (!SEARCH_RE.test(value))
    return {
      ok: false,
      error: "Seuls les lettres, chiffres, espaces, tirets et apostrophes sont acceptés.",
    };
  return { ok: true, value };
}
type ListFilters = { status: "" | Status; category: "" | Category; urgency: "" | Urgency; q: string };
const NO_FILTERS: ListFilters = { status: "", category: "", urgency: "", q: "" };
// A visited page: the cursor that produced it and how many rows preceded it.
type PagePosition = { cursor: string | null; offset: number };
const FIRST_PAGE: PagePosition = { cursor: null, offset: 0 };
const SEARCH_HELP =
  "2 à 80 caractères : lettres, chiffres, espaces, tirets et apostrophes. Un identifiant complet de dossier ouvre cette référence exacte.";

// Row shape shared by the server list and the bounded overview list.
type RowLike = Pick<AdminInterventionRow, "id" | "category" | "urgency" | "city" | "postal_code" | "status" | "created_at"> & {
  artisan_id?: string | null;
};
function DossierTable<T extends RowLike>({
  rows,
  caption,
  artisanName,
  onOpen,
}: {
  rows: T[];
  caption: string;
  artisanName: (id: string | null | undefined) => string | undefined;
  onOpen: (id: string) => void;
}) {
  return (
    <DataTable
      caption={caption}
      rows={rows}
      keyOf={(i) => i.id}
      columns={[
        { key: "ref", label: "Référence", render: (i) => <span className={styles.mono}>{shortId(i.id)}</span> },
        {
          key: "type",
          label: "Type",
          wide: true,
          render: (i) => (
            <span className={styles.cellStack}>
              {category(i.category).label}
              <small>{i.urgency === "urgent" ? "Demande urgente" : "À planifier"}</small>
            </span>
          ),
        },
        { key: "place", label: "Lieu", render: (i) => `${i.city} (${i.postal_code})` },
        { key: "status", label: "Statut", render: (i) => <Badge status={i.status} /> },
        {
          key: "artisan",
          label: "Artisan",
          render: (i) => (i.artisan_id ? artisanName(i.artisan_id) || "Attribué" : <span className={styles.muted}>Non attribué</span>),
        },
        { key: "created", label: "Créée", render: (i) => date(i.created_at) },
        {
          key: "actions",
          label: "Actions",
          render: (i) => (
            <button type="button" className={styles.rowAction} onClick={() => onOpen(i.id)}>
              <Icon name="eye" size={15} />
              Ouvrir
            </button>
          ),
        },
      ]}
      empty={null}
    />
  );
}

// Server-paginated dossier list (contract WEB-PWA-ADMIN-LISTS-001). Filters restart from the
// first page; "Précédent" replays the cursors kept client-side; the total is the server count.
function InterventionsView({
  session,
  overview,
  overviewFailed,
  limitNote,
  artisanName,
  onOpen,
  onReloadOverview,
  reloadingOverview,
}: {
  session: Session;
  overview: AdminOverview | null;
  overviewFailed: boolean;
  limitNote: string;
  artisanName: (id: string | null | undefined) => string | undefined;
  onOpen: (id: string) => void;
  onReloadOverview: () => void;
  reloadingOverview: boolean;
}) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS);
  const [limit, setLimit] = useState<PageSize>(25);
  const [position, setPosition] = useState<PagePosition>(FIRST_PAGE);
  const [previous, setPrevious] = useState<PagePosition[]>([]);
  const [search, setSearch] = useState("");
  const [searchError, setSearchError] = useState("");
  // undefined = loading, null = unavailable (capabilities.adminLists tells why).
  const [page, setPage] = useState<AdminInterventionsPage | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [showBounded, setShowBounded] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const my = ++requestId.current;
    setPage(undefined);
    void sessionRef.current
      .loadAdminInterventions({
        status: filters.status || undefined,
        category: filters.category || undefined,
        urgency: filters.urgency || undefined,
        q: filters.q || undefined,
        limit,
        cursor: position.cursor,
      })
      .then((result) => {
        if (my === requestId.current) setPage(result);
      });
  }, [filters, limit, position, attempt, session.data]);

  // Any filter change invalidates the cursor (its fingerprint covers the filters): restart.
  const restart = (next: Partial<ListFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setPosition(FIRST_PAGE);
    setPrevious([]);
  };
  // The page size does not change the filters, but the loaded range is only exact from page 1.
  const changeLimit = (next: PageSize) => {
    setLimit(next);
    setPosition(FIRST_PAGE);
    setPrevious([]);
  };
  const reset = () => {
    setSearch("");
    setSearchError("");
    setLimit(25);
    restart(NO_FILTERS);
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const check = checkSearch(search);
    if (!check.ok) {
      setSearchError(check.error);
      return;
    }
    setSearchError("");
    setSearch(check.value);
    if (check.value !== filters.q) restart({ q: check.value });
  };
  const goNext = () => {
    if (!page?.page.next_cursor) return;
    setPrevious((stack) => [...stack, position]);
    setPosition({ cursor: page.page.next_cursor, offset: position.offset + page.interventions.length });
  };
  const goPrevious = () => {
    const last = previous[previous.length - 1];
    if (!last) return;
    setPrevious((stack) => stack.slice(0, -1));
    setPosition(last);
  };

  const filtering = Boolean(filters.status || filters.category || filters.urgency || filters.q);
  const boundedLabel = `${overview?.capabilities.list_limit ?? 100} derniers dossiers chargés`;
  const rows = page?.interventions ?? [];
  const total = page?.page.total;
  const from = position.offset + 1;
  const to = position.offset + rows.length;

  let body: ReactNode;
  if (page === undefined) {
    body = <Loader label="Chargement des dossiers…" />;
  } else if (page === null) {
    const state = session.capabilities.adminLists;
    body = (
      <div className={styles.panelBody}>
        <Unavailable
          title="Liste des dossiers indisponible"
          state={state}
          reason={
            state === "available"
              ? "La liste n’a pas pu être chargée. Vérifiez les filtres ou réessayez dans un instant."
              : undefined
          }
        >
          <div className={styles.actions} style={{ marginTop: 12 }}>
            <button type="button" className="button outline" onClick={() => setAttempt((n) => n + 1)}>
              <Icon name="refresh" size={16} />
              Réessayer
            </button>
            <button type="button" className="button outline" onClick={() => setShowBounded(true)} aria-pressed={showBounded}>
              <Icon name="list" size={16} />
              Afficher les {boundedLabel}
            </button>
          </div>
        </Unavailable>
      </div>
    );
  } else if (!rows.length) {
    body =
      position.offset > 0 ? (
        <Empty
          icon="list"
          title="Cette page ne contient plus de dossier"
          action={
            <button type="button" className="button outline" onClick={reset}>
              Revenir au début de la liste
            </button>
          }
        >
          Des dossiers ont changé depuis le chargement de la page précédente.
        </Empty>
      ) : filtering ? (
        <Empty
          icon="search"
          title="Aucun dossier ne correspond"
          action={
            <button type="button" className="button outline" onClick={reset}>
              Réinitialiser les filtres
            </button>
          }
        >
          Modifiez les filtres ou la recherche.
        </Empty>
      ) : (
        <Empty icon="list" title="Aucun dossier enregistré">
          Les demandes des clients apparaîtront ici.
        </Empty>
      );
  } else {
    body = <DossierTable rows={rows} caption="Dossiers de la plateforme" artisanName={artisanName} onOpen={onOpen} />;
  }

  return (
    <>
      <Panel title="Dossiers" count={total}>
        <form className={styles.filters} onSubmit={submitSearch} noValidate>
          <label className={styles.filter} htmlFor="admin-dossier-search">
            Recherche (description, ville, code postal ou identifiant complet)
            <input
              id="admin-dossier-search"
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (searchError) setSearchError("");
              }}
              placeholder="Ville, code postal ou mot de la description"
              maxLength={120}
              aria-invalid={searchError ? true : undefined}
              aria-describedby="admin-dossier-search-help"
            />
          </label>
          <button type="submit" className="button outline">
            <Icon name="search" size={16} />
            Rechercher
          </button>
          <label className={styles.filter}>
            Statut
            <select value={filters.status} onChange={(e) => restart({ status: e.target.value as ListFilters["status"] })}>
              <option value="">Tous les statuts</option>
              {(Object.keys(STATUS) as Status[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.filter}>
            Catégorie
            <select value={filters.category} onChange={(e) => restart({ category: e.target.value as ListFilters["category"] })}>
              <option value="">Toutes les catégories</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <Segments
            label="Urgence"
            value={filters.urgency}
            options={[
              ["", "Toutes"],
              ["urgent", "Urgentes"],
              ["scheduled", "Planifiées"],
            ]}
            onChange={(urgency) => restart({ urgency })}
          />
          <label className={styles.filter}>
            Dossiers par page
            <select value={limit} onChange={(e) => changeLimit(Number(e.target.value) as PageSize)}>
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={styles.link} onClick={reset}>
            <Icon name="refresh" size={15} />
            Réinitialiser
          </button>
          <p id="admin-dossier-search-help" className={styles.searchHelp} data-error={searchError ? "true" : undefined} role={searchError ? "alert" : undefined}>
            {searchError || SEARCH_HELP}
          </p>
        </form>
        {body}
        {page && (
          <div className={styles.pager}>
            <p className={styles.pagerInfo} role="status">
              <strong>
                {total} {total === 1 ? "dossier correspondant" : "dossiers correspondants"}
              </strong>
              {rows.length ? ` · dossiers ${from} à ${to} affichés` : ""}
              {` · ${page.page.has_more ? "d’autres dossiers suivent" : "fin de la liste"}`}
            </p>
            <div className={styles.pagerButtons}>
              <button type="button" className="button outline" onClick={goPrevious} disabled={!previous.length}>
                <Icon name="back" size={16} />
                Précédent
              </button>
              <button type="button" className="button outline" onClick={goNext} disabled={!page.page.has_more || !page.page.next_cursor}>
                Suivant
              </button>
            </div>
          </div>
        )}
        <Basis>
          Nombre total compté sur l’ensemble des dossiers accessibles selon les filtres, pas seulement sur la page affichée. Les dossiers créés ou modifiés pendant la consultation n’apparaissent qu’après une actualisation.
        </Basis>
      </Panel>
      {showBounded && (
        <BoundedInterventionsView
          overview={overview}
          overviewFailed={overviewFailed}
          overviewState={session.capabilities.adminOverview}
          limitNote={limitNote}
          label={boundedLabel}
          artisanName={artisanName}
          onOpen={onOpen}
          onHide={() => setShowBounded(false)}
          onReload={onReloadOverview}
          reloading={reloadingOverview}
        />
      )}
    </>
  );
}

// Fallback when the paginated list is unavailable: the bounded overview list, filtered in the
// browser and labelled as such. Never presented as the complete list.
function BoundedInterventionsView({
  overview,
  overviewFailed,
  overviewState,
  limitNote,
  label,
  artisanName,
  onOpen,
  onHide,
  onReload,
  reloading,
}: {
  overview: AdminOverview | null;
  overviewFailed: boolean;
  overviewState: Session["capabilities"]["adminOverview"];
  limitNote: string;
  label: string;
  artisanName: (id: string | null | undefined) => string | undefined;
  onOpen: (id: string) => void;
  onHide: () => void;
  onReload: () => void;
  reloading: boolean;
}) {
  const [status, setStatus] = useState<"all" | Status>("all");
  const [urgency, setUrgency] = useState<"all" | Urgency>("all");
  const [search, setSearch] = useState("");
  const interventions = overview?.interventions;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (interventions || [])
      .filter((i) => (status === "all" || i.status === status) && (urgency === "all" || i.urgency === urgency))
      .filter((i) => !q || shortId(i.id).toLowerCase().includes(q) || i.city.toLowerCase().includes(q) || i.postal_code.includes(q))
      .sort(byNewest);
  }, [interventions, status, urgency, search]);
  const hide = (
    <button type="button" className={styles.link} onClick={onHide}>
      Masquer cette liste
    </button>
  );
  if (!overview) {
    return (
      <Panel title={label} action={hide}>
        {overviewFailed ? (
          <div className={styles.panelBody}>
            <Unavailable title="Derniers dossiers chargés indisponibles" state={overviewState}>
              <div className={styles.actions} style={{ marginTop: 12 }}>
                <button type="button" className="button outline" onClick={onReload} disabled={reloading}>
                  <Icon name="refresh" size={16} />
                  {reloading ? "Actualisation…" : "Réessayer"}
                </button>
              </div>
            </Unavailable>
          </div>
        ) : (
          <Loader label="Chargement des derniers dossiers…" />
        )}
      </Panel>
    );
  }
  return (
    <Panel
      title={label}
      count={overview.interventions.length}
      action={hide}
      intro={`Liste de secours : les ${overview.capabilities.list_limit} derniers dossiers chargés au plus, filtrés dans le navigateur. Elle n’est pas exhaustive et n’affiche aucun total.`}
    >
      <div className={styles.filters}>
        <label className={styles.filter}>
          Recherche (référence, ville ou code postal)
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="INT-… ou ville" maxLength={60} />
        </label>
        <label className={styles.filter}>
          Statut
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">Tous les statuts</option>
            {(Object.keys(STATUS) as Status[]).map((s) => (
              <option key={s} value={s}>
                {STATUS[s]}
              </option>
            ))}
          </select>
        </label>
        <Segments
          label="Urgence"
          value={urgency}
          options={[
            ["all", "Toutes"],
            ["urgent", "Urgentes"],
            ["scheduled", "Planifiées"],
          ]}
          onChange={setUrgency}
        />
      </div>
      {rows.length ? (
        <DossierTable rows={rows} caption={label} artisanName={artisanName} onOpen={onOpen} />
      ) : overview.interventions.length ? (
        <Empty icon="search" title="Aucun dossier chargé ne correspond">
          Modifiez les filtres ou la recherche ; seuls les derniers dossiers chargés sont parcourus.
        </Empty>
      ) : (
        <Empty icon="list" title="Aucun dossier chargé">
          La vue d’ensemble n’a transmis aucun dossier.
        </Empty>
      )}
      <Basis>{limitNote}</Basis>
    </Panel>
  );
}

// ---- Directories (contract WEB-PWA-ADMIN-DIRECTORIES-001) ----------------------------------
const DIRECTORY_SEARCH_HELP =
  "2 à 80 caractères : lettres, chiffres, espaces, tirets et apostrophes. Un identifiant complet ouvre cette fiche exacte.";
type Directory<K extends DirectoryKind> = {
  page: DirectoryPage<K> | null | undefined;
  rows: DirectoryItem<K>[];
  filters: DirectoryFilters;
  limit: PageSize;
  position: PagePosition;
  hasPrevious: boolean;
  search: string;
  searchError: string;
  setSearch: (value: string) => void;
  submitSearch: (event: FormEvent) => void;
  restart: (next: DirectoryFilters) => void;
  changeLimit: (next: PageSize) => void;
  reset: () => void;
  retry: () => void;
  goNext: () => void;
  goPrevious: () => void;
};
// One server-paginated directory: a filter change restarts from the first page (the cursor is
// bound to the filters), "Précédent" replays the cursors kept client-side, the total is the
// server count. undefined = loading, null = unavailable (capabilities.adminDirectory tells why).
function useDirectory<K extends DirectoryKind>(session: Session, kind: K): Directory<K> {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [filters, setFilters] = useState<DirectoryFilters>({});
  const [limit, setLimit] = useState<PageSize>(25);
  const [position, setPosition] = useState<PagePosition>(FIRST_PAGE);
  const [previous, setPrevious] = useState<PagePosition[]>([]);
  const [search, setSearchText] = useState("");
  const [searchError, setSearchError] = useState("");
  const [page, setPage] = useState<DirectoryPage<K> | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const my = ++requestId.current;
    setPage(undefined);
    void sessionRef.current
      .loadAdminDirectory(kind, {
        q: filters.q || undefined,
        approved: filters.approved,
        role: filters.role,
        owner_id: filters.owner_id,
        limit,
        cursor: position.cursor,
      })
      .then((result) => {
        if (my === requestId.current) setPage(result);
      });
  }, [kind, filters, limit, position, attempt, session.data]);

  const restart = useCallback((next: DirectoryFilters) => {
    setFilters((f) => ({ ...f, ...next }));
    setPosition(FIRST_PAGE);
    setPrevious([]);
  }, []);
  const changeLimit = (next: PageSize) => {
    setLimit(next);
    setPosition(FIRST_PAGE);
    setPrevious([]);
  };
  const reset = () => {
    setSearchText("");
    setSearchError("");
    setLimit(25);
    setFilters({});
    setPosition(FIRST_PAGE);
    setPrevious([]);
  };
  const setSearch = (value: string) => {
    setSearchText(value);
    if (searchError) setSearchError("");
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const check = checkSearch(search);
    if (!check.ok) {
      setSearchError(check.error);
      return;
    }
    setSearchError("");
    setSearchText(check.value);
    if (check.value !== (filters.q || "")) restart({ q: check.value || undefined });
  };
  const goNext = () => {
    if (!page?.page.next_cursor) return;
    setPrevious((stack) => [...stack, position]);
    setPosition({ cursor: page.page.next_cursor, offset: position.offset + page.items.length });
  };
  const goPrevious = () => {
    const last = previous[previous.length - 1];
    if (!last) return;
    setPrevious((stack) => stack.slice(0, -1));
    setPosition(last);
  };
  return {
    page,
    rows: page?.items ?? [],
    filters,
    limit,
    position,
    hasPrevious: previous.length > 0,
    search,
    searchError,
    setSearch,
    submitSearch,
    restart,
    changeLimit,
    reset,
    retry: () => setAttempt((n) => n + 1),
    goNext,
    goPrevious,
  };
}
type AnyDirectory = Directory<DirectoryKind>;

function DirectorySearch({
  id,
  label,
  placeholder,
  directory,
}: {
  id: string;
  label: string;
  placeholder: string;
  directory: Pick<AnyDirectory, "search" | "searchError" | "setSearch">;
}) {
  return (
    <>
      <label className={styles.filter} htmlFor={id}>
        {label}
        <input
          id={id}
          type="search"
          value={directory.search}
          onChange={(e) => directory.setSearch(e.target.value)}
          placeholder={placeholder}
          maxLength={120}
          aria-invalid={directory.searchError ? true : undefined}
          aria-describedby={`${id}-help`}
        />
      </label>
      <button type="submit" className="button outline">
        <Icon name="search" size={16} />
        Rechercher
      </button>
    </>
  );
}
function DirectorySearchHelp({ id, directory }: { id: string; directory: Pick<AnyDirectory, "searchError"> }) {
  return (
    <p id={`${id}-help`} className={styles.searchHelp} data-error={directory.searchError ? "true" : undefined} role={directory.searchError ? "alert" : undefined}>
      {directory.searchError || DIRECTORY_SEARCH_HELP}
    </p>
  );
}
function PageSizeSelect({ label, directory }: { label: string; directory: Pick<AnyDirectory, "limit" | "changeLimit"> }) {
  return (
    <label className={styles.filter}>
      {label}
      <select value={directory.limit} onChange={(e) => directory.changeLimit(Number(e.target.value) as PageSize)}>
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
// Any server-paginated source: the directories and the assistance list share this pager.
type PagerSource = {
  page: { page: { total: number; has_more: boolean; next_cursor: string | null } } | null | undefined;
  rows: unknown[];
  position: PagePosition;
  hasPrevious: boolean;
  goNext: () => void;
  goPrevious: () => void;
};
function DirectoryPager({ directory, noun }: { directory: PagerSource; noun: { one: string; many: string } }) {
  const { page, rows, position } = directory;
  if (!page) return null;
  const total = page.page.total;
  const from = position.offset + 1;
  const to = position.offset + rows.length;
  return (
    <div className={styles.pager}>
      <p className={styles.pagerInfo} role="status">
        <strong>
          {total} {total === 1 ? noun.one : noun.many}
        </strong>
        {rows.length ? (from === to ? ` · ligne ${from} affichée` : ` · lignes ${from} à ${to} affichées`) : ""}
        {` · ${page.page.has_more ? `d’autres ${noun.many} suivent` : "fin de la liste"}`}
      </p>
      <div className={styles.pagerButtons}>
        <button type="button" className="button outline" onClick={directory.goPrevious} disabled={!directory.hasPrevious}>
          <Icon name="back" size={16} />
          Précédent
        </button>
        <button type="button" className="button outline" onClick={directory.goNext} disabled={!page.page.has_more || !page.page.next_cursor}>
          Suivant
        </button>
      </div>
    </div>
  );
}
function DirectoryUnavailable({
  title,
  state,
  onRetry,
  fallbackLabel,
  fallbackShown,
  onFallback,
}: {
  title: string;
  state: Session["capabilities"]["adminDirectory"];
  onRetry: () => void;
  fallbackLabel: string;
  fallbackShown: boolean;
  onFallback: () => void;
}) {
  return (
    <div className={styles.panelBody}>
      <Unavailable
        title={title}
        state={state}
        reason={state === "available" ? "L’annuaire n’a pas pu être chargé. Vérifiez les filtres ou réessayez dans un instant." : undefined}
      >
        <div className={styles.actions} style={{ marginTop: 12 }}>
          <button type="button" className="button outline" onClick={onRetry}>
            <Icon name="refresh" size={16} />
            Réessayer
          </button>
          <button type="button" className="button outline" onClick={onFallback} aria-pressed={fallbackShown}>
            <Icon name="list" size={16} />
            {fallbackLabel}
          </button>
        </div>
      </Unavailable>
    </div>
  );
}
function DirectoryEmpty({
  directory,
  filtering,
  icon,
  texts,
}: {
  directory: Pick<AnyDirectory, "position" | "reset">;
  filtering: boolean;
  icon: string;
  texts: { gone: string; noMatch: string; none: string; noneText: string };
}) {
  if (directory.position.offset > 0)
    return (
      <Empty
        icon={icon}
        title={texts.gone}
        action={
          <button type="button" className="button outline" onClick={directory.reset}>
            Revenir au début de la liste
          </button>
        }
      >
        Des fiches ont changé depuis le chargement de la page précédente.
      </Empty>
    );
  if (filtering)
    return (
      <Empty
        icon="search"
        title={texts.noMatch}
        action={
          <button type="button" className="button outline" onClick={directory.reset}>
            Réinitialiser les filtres
          </button>
        }
      >
        Modifiez les filtres ou la recherche.
      </Empty>
    );
  return (
    <Empty icon={icon} title={texts.none}>
      {texts.noneText}
    </Empty>
  );
}

// ---- Clients -------------------------------------------------------------------------------
type RoleFilter = "" | "client" | "manager";
const DIRECTORY_TOTAL_NOTE =
  "Nombre total compté sur l’ensemble des fiches selon les filtres, pas seulement sur la page affichée. Les fiches créées ou modifiées pendant la consultation n’apparaissent qu’après une actualisation.";

// Two server-paginated directories: clients (particuliers and entreprises clientes) and
// organisations, each with its own pager and total. A client row can restrict the organisations
// to those it owns (owner_id); the owner of an organisation is named from the loaded clients.
function ClientsView({
  session,
  overview,
  overviewFailed,
  limitNote,
  onReloadOverview,
  reloadingOverview,
}: {
  session: Session;
  overview: AdminOverview | null;
  overviewFailed: boolean;
  limitNote: string;
  onReloadOverview: () => void;
  reloadingOverview: boolean;
}) {
  const clients = useDirectory(session, "clients");
  const organizations = useDirectory(session, "organizations");
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null);
  const [showBounded, setShowBounded] = useState(false);
  const organizationsPanel = useRef<HTMLDivElement>(null);
  const role: RoleFilter = clients.filters.role ?? "";
  const ownerId = organizations.filters.owner_id;
  const boundedLabel = `${overview?.capabilities.list_limit ?? 100} derniers clients et organisations chargés`;
  const ownerName = (id: string) =>
    clients.rows.find((c) => c.id === id)?.full_name ||
    overview?.clients.find((c) => c.id === id)?.full_name ||
    (owner?.id === id ? owner.name : undefined);
  const filterByOwner = (c: DirectoryClient) => {
    setOwner({ id: c.id, name: c.full_name });
    organizations.restart({ owner_id: c.id });
    organizationsPanel.current?.scrollIntoView({ block: "start" });
  };
  const clearOwner = () => {
    setOwner(null);
    organizations.restart({ owner_id: undefined });
  };
  const resetOrganizations = () => {
    setOwner(null);
    organizations.reset();
  };

  let clientsBody: ReactNode;
  if (clients.page === undefined) {
    clientsBody = <Loader label="Chargement des clients…" />;
  } else if (clients.page === null) {
    clientsBody = (
      <DirectoryUnavailable
        title="Annuaire des clients indisponible"
        state={session.capabilities.adminDirectory}
        onRetry={clients.retry}
        fallbackLabel={`Afficher les ${boundedLabel}`}
        fallbackShown={showBounded}
        onFallback={() => setShowBounded(true)}
      />
    );
  } else if (!clients.rows.length) {
    clientsBody = (
      <DirectoryEmpty
        directory={clients}
        filtering={Boolean(clients.filters.q || clients.filters.role)}
        icon="person"
        texts={{
          gone: "Cette page ne contient plus de client",
          noMatch: "Aucun client ne correspond",
          none: "Aucun client inscrit",
          noneText: "Les comptes clients apparaîtront ici.",
        }}
      />
    );
  } else {
    clientsBody = (
      <DataTable
        caption="Annuaire des clients"
        rows={clients.rows}
        keyOf={(c) => c.id}
        columns={[
          { key: "name", label: "Client", wide: true, render: (c) => <Person name={c.full_name} sub={c.phone || undefined} /> },
          { key: "kind", label: "Type", render: (c) => clientKind(c.role) },
          { key: "created", label: "Inscription", render: (c) => date(c.created_at) },
          {
            key: "actions",
            label: "Actions",
            render: (c) => (
              <button type="button" className={styles.rowAction} aria-pressed={ownerId === c.id} onClick={() => filterByOwner(c)}>
                <Icon name="building" size={15} />
                Organisations dont il est propriétaire
              </button>
            ),
          },
        ]}
        empty={null}
      />
    );
  }

  let organizationsBody: ReactNode;
  if (organizations.page === undefined) {
    organizationsBody = <Loader label="Chargement des organisations…" />;
  } else if (organizations.page === null) {
    organizationsBody = (
      <DirectoryUnavailable
        title="Annuaire des organisations indisponible"
        state={session.capabilities.adminDirectory}
        onRetry={organizations.retry}
        fallbackLabel={`Afficher les ${boundedLabel}`}
        fallbackShown={showBounded}
        onFallback={() => setShowBounded(true)}
      />
    );
  } else if (!organizations.rows.length) {
    organizationsBody = (
      <DirectoryEmpty
        directory={{ position: organizations.position, reset: resetOrganizations }}
        filtering={Boolean(organizations.filters.q || ownerId)}
        icon="building"
        texts={{
          gone: "Cette page ne contient plus d’organisation",
          noMatch: ownerId ? "Aucune organisation pour ce propriétaire" : "Aucune organisation ne correspond",
          none: "Aucune organisation",
          noneText: "Les organisations clientes (syndics, restauration, bureaux, ERP) apparaîtront ici.",
        }}
      />
    );
  } else {
    organizationsBody = (
      <DataTable
        caption="Annuaire des organisations"
        rows={organizations.rows}
        keyOf={(o) => o.id}
        columns={[
          { key: "name", label: "Organisation", wide: true, render: (o) => <strong>{o.name}</strong> },
          {
            key: "owner",
            label: "Propriétaire",
            render: (o) => {
              const name = ownerName(o.owner_id);
              return name ? (
                <span className={styles.cellStack}>
                  {name}
                  <small className={styles.mono}>{shortUser(o.owner_id)}</small>
                </span>
              ) : (
                <span className={styles.mono}>{shortUser(o.owner_id)}</span>
              );
            },
          },
          { key: "created", label: "Création", render: (o) => date(o.created_at) },
        ]}
        empty={null}
      />
    );
  }

  return (
    <>
      <Panel title="Clients" count={clients.page?.page.total}>
        <form className={styles.filters} onSubmit={clients.submitSearch} noValidate>
          <DirectorySearch id="admin-client-search" label="Recherche (nom ou identifiant complet)" placeholder="Nom du client" directory={clients} />
          <Segments
            label="Type de client"
            value={role}
            options={[
              ["", "Tous"],
              ["client", "Particuliers"],
              ["manager", "Entreprises clientes"],
            ]}
            onChange={(v) => clients.restart({ role: v || undefined })}
          />
          <PageSizeSelect label="Clients par page" directory={clients} />
          <button type="button" className={styles.link} onClick={clients.reset}>
            <Icon name="refresh" size={15} />
            Réinitialiser
          </button>
          <DirectorySearchHelp id="admin-client-search" directory={clients} />
        </form>
        {clientsBody}
        <DirectoryPager directory={clients} noun={{ one: "client", many: "clients" }} />
        <Basis>{DIRECTORY_TOTAL_NOTE}</Basis>
        <div className={styles.panelBody}>
          <Unavailable
            title="Fiche client détaillée non disponible"
            reason="Coordonnées complètes, historique des dossiers et sites ne sont pas transmis à l’administration ; seuls le nom, le téléphone, le type et la date d’inscription le sont."
            blocker="ADM-04"
          />
        </div>
      </Panel>
      <div ref={organizationsPanel} tabIndex={-1}>
        <Panel title="Organisations" count={organizations.page?.page.total}>
          <form className={styles.filters} onSubmit={organizations.submitSearch} noValidate>
            <DirectorySearch id="admin-organization-search" label="Recherche (nom ou identifiant complet)" placeholder="Nom de l’organisation" directory={organizations} />
            <PageSizeSelect label="Organisations par page" directory={organizations} />
            <button type="button" className={styles.link} onClick={resetOrganizations}>
              <Icon name="refresh" size={15} />
              Réinitialiser
            </button>
            {ownerId && (
              <div className={styles.activeFilter} role="status">
                <span className={styles.chip}>
                  <Icon name="person" size={16} />
                  Propriétaire : {owner?.name || ownerName(ownerId) || shortUser(ownerId)}
                </span>
                <button type="button" className={styles.link} onClick={clearOwner}>
                  <Icon name="close" size={15} />
                  Retirer ce filtre
                </button>
              </div>
            )}
            <DirectorySearchHelp id="admin-organization-search" directory={organizations} />
          </form>
          {organizationsBody}
          <DirectoryPager directory={organizations} noun={{ one: "organisation", many: "organisations" }} />
          <Basis>
            {DIRECTORY_TOTAL_NOTE} Le propriétaire est nommé lorsqu’il figure dans la page de clients chargée ; sinon seul son identifiant abrégé est affiché. Les membres et sites des organisations ne sont pas transmis.
          </Basis>
        </Panel>
      </div>
      {showBounded && (
        <BoundedClientsView
          overview={overview}
          overviewFailed={overviewFailed}
          overviewState={session.capabilities.adminOverview}
          limitNote={limitNote}
          label={boundedLabel}
          onHide={() => setShowBounded(false)}
          onReload={onReloadOverview}
          reloading={reloadingOverview}
        />
      )}
    </>
  );
}

// Fallback when the directories are unavailable: the bounded overview lists, filtered in the
// browser and labelled as such. Never presented as the complete directory, never with a total.
function BoundedClientsView({
  overview,
  overviewFailed,
  overviewState,
  limitNote,
  label,
  onHide,
  onReload,
  reloading,
}: {
  overview: AdminOverview | null;
  overviewFailed: boolean;
  overviewState: Session["capabilities"]["adminOverview"];
  limitNote: string;
  label: string;
  onHide: () => void;
  onReload: () => void;
  reloading: boolean;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  return (
    <BoundedPanel
      label={label}
      overview={overview}
      overviewFailed={overviewFailed}
      overviewState={overviewState}
      onHide={onHide}
      onReload={onReload}
      reloading={reloading}
      count={(o) => o.clients.length + o.organizations.length}
      intro={(o) => `Liste de secours : les ${o.capabilities.list_limit} derniers clients et organisations chargés au plus, filtrés dans le navigateur. Elle n’est pas exhaustive et n’affiche aucun total.`}
    >
      {(o) => {
        const clients = o.clients
          .filter((c) => !q || c.full_name.toLowerCase().includes(q))
          .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""));
        const organizations = o.organizations.filter((x) => !q || x.name.toLowerCase().includes(q));
        return (
          <>
            <div className={styles.filters}>
              <label className={styles.filter}>
                Recherche (nom du client ou de l’organisation)
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom" maxLength={100} />
              </label>
            </div>
            <div className={styles.panelBody}>
              <h3 className={styles.subheading}>Clients chargés ({clients.length})</h3>
            </div>
            <DataTable
              caption={`${label} : clients`}
              rows={clients}
              keyOf={(c) => c.id}
              columns={[
                { key: "name", label: "Client", wide: true, render: (c) => <Person name={c.full_name} /> },
                { key: "kind", label: "Type", render: (c) => clientKind(c.role) },
                { key: "created", label: "Inscription", render: (c) => (c.created_at ? date(c.created_at) : "—") },
              ]}
              empty={
                <Empty icon="search" title="Aucun client chargé ne correspond">
                  Seuls les derniers clients chargés sont parcourus.
                </Empty>
              }
            />
            <div className={styles.panelBody}>
              <h3 className={styles.subheading}>Organisations chargées ({organizations.length})</h3>
            </div>
            <DataTable
              caption={`${label} : organisations`}
              rows={organizations}
              keyOf={(x) => x.id}
              columns={[
                { key: "name", label: "Organisation", wide: true, render: (x) => <strong>{x.name}</strong> },
                { key: "type", label: "Type", render: (x) => (x.type ? SITE_TYPES[x.type] || x.type : "—") },
                { key: "owner", label: "Propriétaire", render: (x) => <span className={styles.mono}>{shortUser(x.owner_id)}</span> },
              ]}
              empty={
                <Empty icon="building" title="Aucune organisation chargée ne correspond">
                  Seules les dernières organisations chargées sont parcourues.
                </Empty>
              }
            />
            <Basis>{limitNote} La date de création des organisations n’est pas transmise par la vue d’ensemble.</Basis>
          </>
        );
      }}
    </BoundedPanel>
  );
}

// ---- Dossier (admin reading of an intervention) --------------------------------------------
function DossierView({
  id,
  session,
  overview,
  overviewFailed,
  onBack,
  artisanName,
}: {
  id: string;
  session: Session;
  overview: AdminOverview | null;
  overviewFailed: boolean;
  onBack: () => void;
  artisanName: (id: string | null | undefined) => string | undefined;
}) {
  const demo = session.mode === "demo";
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // Server detail first (any dossier, not only the bounded lists); overview/workspace otherwise.
  // undefined = loading, null = unavailable. A failed re-read keeps the previous detail, flagged.
  const [detail, setDetail] = useState<AdminInterventionDetail | null | undefined>(undefined);
  const [detailStale, setDetailStale] = useState(false);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const lastDetail = useRef<AdminInterventionDetail | null>(null);
  useEffect(() => {
    let active = true;
    void sessionRef.current.loadAdminIntervention(id).then((result) => {
      if (!active) return;
      if (result) {
        lastDetail.current = result;
        setDetail(result);
        setDetailStale(false);
      } else if (lastDetail.current) {
        setDetailStale(true);
      } else {
        setDetail(null);
      }
    });
    return () => {
      active = false;
    };
  }, [id, detailAttempt, session.data]);
  const intervention =
    detail?.intervention ||
    overview?.interventions.find((i) => i.id === id) ||
    session.data.interventions.find((i) => i.id === id);
  const [operations, setOperations] = useState<Operations | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setOperationsLoading(true);
    void sessionRef.current.loadOperations(id).then((result) => {
      if (!active) return;
      setOperations(result);
      setOperationsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id, session.data]);

  const back = (
    <button type="button" className={styles.backLink} onClick={onBack}>
      <Icon name="back" size={16} />
      Retour aux interventions
    </button>
  );
  if (!intervention) {
    if (detail === undefined)
      return (
        <>
          {back}
          <Loader label="Chargement du dossier…" />
        </>
      );
    const state = session.capabilities.adminLists;
    return (
      <>
        {back}
        <Unavailable
          title="Dossier indisponible"
          state={state}
          reason={
            state === "available"
              ? "Ce dossier n’a pas pu être lu : il est introuvable ou n’est plus accessible avec vos droits."
              : undefined
          }
        >
          <div className={styles.actions} style={{ marginTop: 12 }}>
            <button type="button" className="button outline" onClick={() => setDetailAttempt((n) => n + 1)}>
              <Icon name="refresh" size={16} />
              Réessayer
            </button>
          </div>
        </Unavailable>
      </>
    );
  }
  const c = category(intervention.category);
  // Server quotes when the detail is available (bounded to quotes_limit), workspace otherwise.
  const quotes = [...(detail ? detail.quotes : quoteVersions(session.data.quotes, id))].sort(byNewest);
  const messages = session.data.messages.filter((m) => m.intervention_id === id).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const reached = STEP_ORDER.indexOf(intervention.status);
  const caps = overview?.capabilities;
  const approvedArtisans = (overview?.artisans || []).filter(isApprovedArtisan);
  return (
    <>
      {back}
      <div className={styles.detailGrid}>
        <div>
          <section className={styles.panel}>
            <div className={styles.summaryTop}>
              <span className={`service-icon ${intervention.category}`}>
                <Icon name={c.icon} size={24} />
              </span>
              <div>
                <h2>{c.label}</h2>
                <span>
                  {shortId(intervention.id)} · {intervention.urgency === "urgent" ? "Demande urgente" : "Intervention à planifier"}
                </span>
              </div>
              <span className={styles.badges}>
                <Badge status={intervention.status} />
                {intervention.travel_stage && ["accepted", "in_progress"].includes(intervention.status) && (
                  <Tag tone="blue">{TRAVEL_STAGE[intervention.travel_stage]}</Tag>
                )}
              </span>
            </div>
            <p className={styles.description}>{intervention.description}</p>
            <div className={styles.facts}>
              <div>
                <small>Adresse</small>
                <strong>
                  {intervention.address}, {intervention.postal_code} {intervention.city}
                </strong>
              </div>
              <div>
                <small>Estimation indicative</small>
                <strong>
                  {money(intervention.estimate_min_cents)} – {money(intervention.estimate_max_cents)}
                </strong>
              </div>
              <div>
                <small>Artisan</small>
                <strong>{intervention.artisan_id ? artisanName(intervention.artisan_id) || "Attribué" : "Non attribué"}</strong>
              </div>
              <div>
                <small>Client</small>
                <strong className={styles.mono}>{shortUser(intervention.client_id)}</strong>
              </div>
              <div>
                <small>Créée</small>
                <strong>{dateTime(intervention.created_at)}</strong>
              </div>
              {intervention.updated_at && (
                <div>
                  <small>Dernière mise à jour</small>
                  <strong>{dateTime(intervention.updated_at)}</strong>
                </div>
              )}
              {intervention.completed_at && (
                <div>
                  <small>Terminée</small>
                  <strong>{dateTime(intervention.completed_at)}</strong>
                </div>
              )}
              {intervention.paid_at && (
                <div>
                  <small>Réglée</small>
                  <strong>{dateTime(intervention.paid_at)}</strong>
                </div>
              )}
              {intervention.site_id && (
                <div>
                  <small>Site professionnel</small>
                  <strong className={styles.mono}>{session.data.sites.find((s) => s.id === intervention.site_id)?.name || shortUser(intervention.site_id)}</strong>
                </div>
              )}
            </div>
          </section>

          <Panel title="Parcours du dossier">
            {intervention.status === "cancelled" ? (
              <div className={styles.panelBody}>
                <p>
                  <Tag tone="red">Annulée</Tag> Le dossier a été annulé avant son règlement ; aucune étape ultérieure ne sera atteinte.
                </p>
              </div>
            ) : (
              <ol className={styles.steps}>
                {STEP_ORDER.map((s, index) => (
                  <li key={s} className={`${index <= reached ? styles.reached : ""} ${index === reached ? styles.current : ""}`}>
                    <span aria-hidden="true">{index <= reached ? <Icon name="check" size={12} /> : index + 1}</span>
                    {STATUS[s]}
                    {index === reached && <span className="sr-only">(étape actuelle)</span>}
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel
            title="Devis"
            count={detail === undefined ? undefined : quotes.length}
            intro="Versions successives transmises par l’artisan, de la plus récente à la plus ancienne. L’acceptation reste une action du client."
          >
            {detail === undefined ? (
              <Loader label="Lecture des devis du dossier…" />
            ) : (
              <>
                <QuoteList quotes={quotes} />
                <Basis>
                  {detail
                    ? detail.quotes_limited
                      ? `${detail.quotes_limit} derniers devis affichés ; les versions plus anciennes ne sont pas transmises.`
                      : `Devis lus directement sur le dossier : ${quotes.length} au total.`
                    : "Devis présents dans l’espace de travail chargé ; la lecture complète du dossier est indisponible."}
                  {detailStale ? " La dernière lecture a échoué : devis issus de la lecture précédente." : ""}
                </Basis>
              </>
            )}
          </Panel>

          <Panel title="Opérations">
            {operationsLoading ? (
              <Loader label="Lecture des opérations…" />
            ) : !operations ? (
              <div className={styles.panelBody}>
                <Unavailable title="Opérations indisponibles" state={session.capabilities.operations} />
              </div>
            ) : (
              <>
                <dl className={styles.definitions}>
                  <dt>Participants</dt>
                  <dd>
                    {operations.participants.length
                      ? operations.participants.map((p) => (
                          <div key={p.id}>
                            {p.full_name} — {ROLE_NAMES[p.role as Role] || p.role}
                            {p.phone ? ` — ${p.phone}` : ""}
                          </div>
                        ))
                      : "Aucun participant identifié (artisan non attribué)."}
                  </dd>
                  <dt>Rendez-vous</dt>
                  <dd>
                    {operations.appointment
                      ? `${dateTime(operations.appointment.starts_at)} – ${dateTime(operations.appointment.ends_at)}${operations.appointment.note ? ` · ${operations.appointment.note}` : ""}`
                      : "Aucun rendez-vous enregistré."}
                  </dd>
                  <dt>Déplacement</dt>
                  <dd>{TRAVEL_STAGE[operations.travel_stage]}</dd>
                  <dt>Compte rendu</dt>
                  <dd>
                    {operations.report ? (
                      <>
                        {operations.report.summary}
                        {operations.report.checks.length > 0 && (
                          <ul className={styles.checks}>
                            {operations.report.checks.map((check, index) => (
                              <li key={`${check.label}-${index}`}>
                                <span>{check.label}</span>
                                <span>{CHECK_RESULT[check.result]}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <small className={styles.muted}>
                          Signé « {operations.report.signature_name} »{operations.report.updated_at ? ` le ${dateTime(operations.report.updated_at)}` : ""}
                        </small>
                      </>
                    ) : (
                      "Aucun compte rendu enregistré."
                    )}
                  </dd>
                  <dt>Historique</dt>
                  <dd>
                    {operations.history.length ? (
                      <ul className={styles.checks}>
                        {operations.history.map((event) => (
                          <li key={String(event.id)}>
                            <span>
                              {event.kind === "appointment" ? "Rendez-vous" : "Compte rendu"} · {shortUser(event.actor_id)}
                            </span>
                            <span>{dateTime(event.created_at)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "Aucun événement enregistré."
                    )}
                    <small className={styles.muted}>Les {operations.history_limit} derniers événements au plus sont transmis.</small>
                  </dd>
                </dl>
              </>
            )}
          </Panel>

          <Panel title="Messages du dossier" count={messages.length} intro="Lecture seule des échanges entre le client et l’artisan.">
            {messages.length ? (
              <div className={styles.messages}>
                {messages.map((m) => (
                  <article className={styles.message} key={m.id}>
                    <header>
                      <strong>{authorLabel(m, intervention, session.profileId)}</strong>
                      <span>{dateTime(m.created_at)}</span>
                    </header>
                    <p>{m.body}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.panelBody}>
                <p className={styles.muted}>Aucun message chargé pour ce dossier.</p>
              </div>
            )}
            <div className={styles.panelBody}>
              <Unavailable title="Réponse de l’exploitant dans le fil" reason="Pas encore activé pour l’administration : le fil est en lecture seule." blocker="ADM-07" />
            </div>
          </Panel>

          <WarrantyPanel interventionId={id} demo={demo} role="admin" />
        </div>
        <aside>
          <ReassignPanel
            session={session}
            intervention={intervention}
            artisans={approvedArtisans}
            capability={caps ? caps.dispatch_before_quote_acceptance : null}
            overviewFailed={overviewFailed}
            artisanName={artisanName}
          />
        </aside>
      </div>
    </>
  );
}

// Quotes of a dossier, each expandable to its lines. Reference = quoteRef, full id in the detail.
function QuoteList({ quotes }: { quotes: Quote[] }) {
  if (!quotes.length)
    return (
      <div className={styles.panelBody}>
        <p className={styles.muted}>Aucun devis transmis pour ce dossier.</p>
      </div>
    );
  return (
    <ul className={styles.quoteList}>
      {quotes.map((q) => {
        const s = QUOTE_STATUS[q.status];
        return (
          <li key={q.id}>
            <details className={styles.quote}>
              <summary>
                <span className={styles.mono}>{quoteRef(q.id)}</span>
                <span>{dateTime(q.created_at)}</span>
                <Tag tone={s?.tone || "neutral"}>{s?.label || q.status}</Tag>
                <strong className={styles.mono}>{money(q.total_cents)} TTC</strong>
                <span className={styles.quoteToggle} aria-hidden="true" />
              </summary>
              <div className={styles.quoteBody}>
                {q.lines.length ? (
                  <div className={styles.quoteLinesWrap}>
                    <table className={styles.quoteLines}>
                      <caption className="sr-only">Lignes du devis {quoteRef(q.id)}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Désignation</th>
                          <th scope="col">Quantité</th>
                          <th scope="col">Prix unitaire HT</th>
                          <th scope="col">Total ligne HT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {q.lines.map((line, index) => (
                          <tr key={`${line.label}-${index}`}>
                            <td>{line.label}</td>
                            <td className={styles.mono}>{line.quantity}</td>
                            <td className={styles.mono}>{money(line.unit_price_cents)}</td>
                            <td className={styles.mono}>{money(line.quantity * line.unit_price_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={styles.muted}>Aucune ligne transmise pour ce devis.</p>
                )}
                <dl className={styles.quoteTotals}>
                  <dt>Total HT</dt>
                  <dd className={styles.mono}>{money(q.subtotal_cents)}</dd>
                  <dt>TVA ({String(q.tax_rate).replace(".", ",")} %)</dt>
                  <dd className={styles.mono}>{money(q.tax_cents)}</dd>
                  <dt>Total TTC</dt>
                  <dd className={styles.mono}>
                    <strong>{money(q.total_cents)}</strong>
                  </dd>
                  {q.accepted_at && (
                    <>
                      <dt>Accepté le</dt>
                      <dd>{dateTime(q.accepted_at)}</dd>
                    </>
                  )}
                </dl>
                <p className={styles.quoteId}>
                  Identifiant complet : <span className={styles.mono}>{q.id}</span>
                </p>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function ReassignPanel({
  session,
  intervention,
  artisans,
  capability,
  overviewFailed,
  artisanName,
}: {
  session: Session;
  intervention: Intervention;
  artisans: OverviewArtisan[];
  capability: boolean | null;
  overviewFailed: boolean;
  artisanName: (id: string | null | undefined) => string | undefined;
}) {
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const eligible = REASSIGNABLE.includes(intervention.status);
  const reasonError = reason.trim().length < 10 ? "Indiquez un motif d’au moins 10 caractères ; il sera partagé avec les participants." : "";
  const sameArtisan = target && target === intervention.artisan_id ? "Cet artisan est déjà attribué au dossier." : "";
  const noChange = !target && !intervention.artisan_id ? "Le dossier est déjà en attente d’attribution." : "";
  const error = reasonError || sameArtisan || noChange;
  const targetName = target ? artisans.find((a) => a.id === target)?.full_name || "l’artisan choisi" : null;

  let body: ReactNode;
  if (capability === null) {
    body = overviewFailed ? (
      <Unavailable title="Réaffectation" state={session.capabilities.adminOverview} reason="La vue d’ensemble n’a pas pu être chargée ; actualisez les données pour savoir si la réaffectation est possible." />
    ) : (
      <Loader label="Lecture des capacités…" />
    );
  } else if (!capability) {
    body = <Unavailable title="Réaffectation" reason="La réaffectation avant acceptation du devis n’est pas activée sur ce service." />;
  } else if (!eligible) {
    body = (
      <Unavailable
        title="Réaffectation impossible à ce stade"
        reason={`Possible uniquement avant l’acceptation du devis (statuts « ${STATUS.requested} », « ${STATUS.assigned} », « ${STATUS.quoted} »). Statut actuel : ${STATUS[intervention.status]}.`}
      />
    );
  } else {
    body = (
      <>
        <p>
          Artisan actuel : <strong>{intervention.artisan_id ? artisanName(intervention.artisan_id) || "attribué" : "aucun"}</strong>
        </p>
        <Field label="Nouvel artisan" hint="Seuls les artisans approuvés avec un dossier approuvé sont proposés.">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Remettre en attente d’attribution</option>
            {artisans.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
                {a.company_name ? ` — ${a.company_name}` : ""}
              </option>
            ))}
          </select>
        </Field>
        {!artisans.length && <p className={styles.formNote}>Aucun artisan approuvé parmi les artisans chargés : seule la remise en attente est possible.</p>}
        <Field label="Motif (obligatoire)" error={touched ? error : undefined}>
          <textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Raison de la réaffectation, partagée avec le client et les artisans concernés" />
        </Field>
        <ul className={styles.effects}>
          <li>Les devis envoyés et non acceptés sont refusés.</li>
          <li>Le rendez-vous éventuel est supprimé.</li>
          <li>Le motif est partagé avec les participants du dossier.</li>
          <li>{target ? "Le dossier passe au statut « Artisan affecté »." : "Le dossier repasse en recherche d’un artisan."}</li>
        </ul>
        {!error ? (
          <ConfirmAction
            label={target ? "Réaffecter" : "Remettre en attente"}
            className="button primary"
            message={
              target
                ? `Réaffecter ce dossier à ${targetName} ? Les devis envoyés seront refusés et le rendez-vous supprimé.`
                : "Remettre ce dossier en attente d’attribution ? Les devis envoyés seront refusés et le rendez-vous supprimé."
            }
            confirmLabel="Confirmer la réaffectation"
            busy={session.busy}
            onConfirm={async () => {
              const saved = await session.operate(intervention.id, { action: "reassign", artisan_id: target || null, reason: reason.trim() });
              if (saved) {
                setReason("");
                setTouched(false);
              }
            }}
          />
        ) : (
          <button type="button" className="button primary" disabled={session.busy} onClick={() => setTouched(true)}>
            {target ? "Réaffecter" : "Remettre en attente"}
          </button>
        )}
      </>
    );
  }
  return (
    <Panel title="Réaffectation">
      <div className={styles.panelBody}>{body}</div>
    </Panel>
  );
}

// ---- Assistance (contract WEB-PWA-SUPPORT-001) ---------------------------------------------
// Private persistent tickets handled by the platform administration. The contract transmits
// no name or email of the creator: a user is shown as "Utilisateur" plus a shortened identifier.
const SUPPORT_STATUS: Record<SupportStatus, { label: string; tone: Tone }> = {
  open: { label: "Ouverte", tone: "blue" },
  in_progress: { label: "En cours", tone: "amber" },
  awaiting_user: { label: "Réponse attendue de l’utilisateur", tone: "violet" },
  resolved: { label: "Résolue", tone: "green" },
};
// Transitions the contract allows from each state; the server refuses anything else.
const SUPPORT_TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  open: ["in_progress", "awaiting_user", "resolved"],
  in_progress: ["awaiting_user", "resolved"],
  awaiting_user: ["in_progress", "resolved"],
  resolved: ["in_progress"],
};
const SUPPORT_SEARCH_HELP =
  "Recherche littérale sur le sujet : 2 à 80 caractères, lettres, chiffres, espaces, tirets et apostrophes.";
const SUPPORT_BODY_MAX = 4000;
const SUPPORT_HISTORY_LIMIT = 50;
type SupportFilters = { status: "" | SupportStatus; q: string };
const NO_SUPPORT_FILTERS: SupportFilters = { status: "", q: "" };

const mergeById = <T extends { id: string }>(current: T[], added: T[]) => {
  const seen = new Set(current.map((x) => x.id));
  return [...current, ...added.filter((x) => !seen.has(x.id))];
};
function SupportStatusTag({ status }: { status: SupportStatus }) {
  const s = SUPPORT_STATUS[status];
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

// Server-paginated list of every ticket of the platform (scope all), on the directory model:
// a filter change restarts from the first page (the cursor is bound to the filters), "Précédent"
// replays the cursors kept client-side, the total is the server count.
// undefined = loading, null = unavailable (capabilities.support tells why).
function useSupportList(session: Session, ticketId: string) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [filters, setFilters] = useState<SupportFilters>(NO_SUPPORT_FILTERS);
  const [limit, setLimit] = useState<PageSize>(25);
  const [position, setPosition] = useState<PagePosition>(FIRST_PAGE);
  const [previous, setPrevious] = useState<PagePosition[]>([]);
  const [search, setSearchText] = useState("");
  const [searchError, setSearchError] = useState("");
  const [page, setPage] = useState<SupportListPage | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const wasOnTicket = useRef(false);

  useEffect(() => {
    const my = ++requestId.current;
    setPage(undefined);
    void sessionRef.current
      .loadSupportTickets({
        scope: "all",
        status: filters.status || undefined,
        q: filters.q || undefined,
        limit,
        cursor: position.cursor,
      })
      .then((result) => {
        if (my === requestId.current) setPage(result);
      });
  }, [filters, limit, position, attempt, session.refreshedAt, session.mode]);
  // Coming back from a ticket: its replies and state changes must appear in the list.
  useEffect(() => {
    if (ticketId) {
      wasOnTicket.current = true;
    } else if (wasOnTicket.current) {
      wasOnTicket.current = false;
      setAttempt((n) => n + 1);
    }
  }, [ticketId]);

  const restart = (next: Partial<SupportFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setPosition(FIRST_PAGE);
    setPrevious([]);
  };
  const changeLimit = (next: PageSize) => {
    setLimit(next);
    setPosition(FIRST_PAGE);
    setPrevious([]);
  };
  const reset = () => {
    setSearchText("");
    setSearchError("");
    setLimit(25);
    restart(NO_SUPPORT_FILTERS);
  };
  const setSearch = (value: string) => {
    setSearchText(value);
    if (searchError) setSearchError("");
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const check = checkSearch(search);
    if (!check.ok) {
      setSearchError(check.error);
      return;
    }
    setSearchError("");
    setSearchText(check.value);
    if (check.value !== filters.q) restart({ q: check.value });
  };
  const goNext = () => {
    if (!page?.page.next_cursor) return;
    setPrevious((stack) => [...stack, position]);
    setPosition({ cursor: page.page.next_cursor, offset: position.offset + page.tickets.length });
  };
  const goPrevious = () => {
    const last = previous[previous.length - 1];
    if (!last) return;
    setPrevious((stack) => stack.slice(0, -1));
    setPosition(last);
  };
  return {
    page,
    rows: page?.tickets ?? [],
    filters,
    limit,
    position,
    hasPrevious: previous.length > 0,
    search,
    searchError,
    setSearch,
    submitSearch,
    restart,
    changeLimit,
    reset,
    retry: () => setAttempt((n) => n + 1),
    goNext,
    goPrevious,
  };
}

function AssistanceCentre({
  session,
  ticketId,
  onOpenTicket,
  onBack,
  onOpenDossier,
}: {
  session: Session;
  ticketId: string;
  onOpenTicket: (id: string) => void;
  onBack: () => void;
  onOpenDossier: (id: string) => void;
}) {
  const list = useSupportList(session, ticketId);
  if (ticketId) return <SupportTicketView session={session} id={ticketId} onBack={onBack} onOpenDossier={onOpenDossier} />;

  const { page, rows, filters } = list;
  const filtering = Boolean(filters.status || filters.q);
  let body: ReactNode;
  if (page === undefined) {
    body = <Loader label="Chargement des demandes d’assistance…" />;
  } else if (page === null) {
    const state = session.capabilities.support;
    body = (
      <div className={styles.panelBody}>
        <Unavailable
          title="Centre d’assistance indisponible"
          state={state}
          reason={
            state === "available"
              ? "La liste des demandes n’a pas pu être chargée. Vérifiez les filtres ou réessayez dans un instant."
              : "L’assistance n’est pas encore activée sur ce service. Les messages des dossiers restent lisibles ci-dessous."
          }
        >
          <div className={styles.actions} style={{ marginTop: 12 }}>
            <button type="button" className="button outline" onClick={list.retry}>
              <Icon name="refresh" size={16} />
              Réessayer
            </button>
          </div>
        </Unavailable>
      </div>
    );
  } else if (!rows.length) {
    body = (
      <DirectoryEmpty
        directory={list}
        filtering={filtering}
        icon="message"
        texts={{
          gone: "Cette page ne contient plus de demande",
          noMatch: "Aucune demande ne correspond",
          none: "Aucune demande d’assistance",
          noneText: "Les demandes envoyées par les utilisateurs depuis leur espace apparaîtront ici.",
        }}
      />
    );
  } else {
    body = (
      <DataTable
        caption="Demandes d’assistance"
        rows={rows}
        keyOf={(t) => t.id}
        columns={[
          {
            key: "subject",
            label: "Sujet",
            wide: true,
            render: (t) => (
              <button type="button" className={`${styles.link} ${styles.subjectLink}`} onClick={() => onOpenTicket(t.id)}>
                {t.subject}
              </button>
            ),
          },
          { key: "status", label: "État", render: (t) => <SupportStatusTag status={t.status} /> },
          {
            key: "creator",
            label: "Demandeur",
            render: (t) => (
              <span className={styles.cellStack}>
                Utilisateur
                <small className={styles.mono}>{shortUser(t.creator_id)}</small>
              </span>
            ),
          },
          {
            key: "dossier",
            label: "Dossier lié",
            render: (t) =>
              t.intervention_id ? (
                <button type="button" className={`${styles.link} ${styles.mono}`} onClick={() => onOpenDossier(t.intervention_id as string)}>
                  {shortId(t.intervention_id)}
                </button>
              ) : (
                <span className={styles.muted}>Aucun</span>
              ),
          },
          { key: "activity", label: "Dernière activité", render: (t) => dateTime(t.last_message_at) },
        ]}
        empty={null}
      />
    );
  }

  return (
    <Panel
      title="Demandes d’assistance"
      count={page?.page.total}
      intro="Demandes privées envoyées par les utilisateurs depuis leur espace, traitées par l’administration. Les réponses se lisent en actualisant : aucun appel, e-mail ou notification n’est envoyé."
    >
      <form className={styles.filters} onSubmit={list.submitSearch} noValidate>
        <DirectorySearch id="admin-support-search" label="Recherche sur le sujet" placeholder="Mot du sujet" directory={list} />
        <Segments
          label="État"
          value={filters.status}
          options={[
            ["", "Toutes"],
            ["open", "Ouvertes"],
            ["in_progress", "En cours"],
            ["awaiting_user", "Réponse attendue de l’utilisateur"],
            ["resolved", "Résolues"],
          ]}
          onChange={(status) => list.restart({ status })}
        />
        <PageSizeSelect label="Demandes par page" directory={list} />
        <button type="button" className={styles.link} onClick={list.reset}>
          <Icon name="refresh" size={15} />
          Réinitialiser
        </button>
        <p
          id="admin-support-search-help"
          className={styles.searchHelp}
          data-error={list.searchError ? "true" : undefined}
          role={list.searchError ? "alert" : undefined}
        >
          {list.searchError || SUPPORT_SEARCH_HELP}
        </p>
      </form>
      {body}
      <DirectoryPager directory={list} noun={{ one: "demande", many: "demandes" }} />
      {page && <Basis>{DIRECTORY_TOTAL_NOTE}</Basis>}
    </Panel>
  );
}

// One ticket: header, immutable timeline (events ascending, one per version), reply and state
// change with the exact expected version. A 409 keeps the typed text and asks for a re-read.
type SupportThread = { detail: SupportDetail; events: SupportEvent[]; messages: SupportMessage[] };
function SupportTicketView({
  session,
  id,
  onBack,
  onOpenDossier,
}: {
  session: Session;
  id: string;
  onBack: () => void;
  onOpenDossier: (id: string) => void;
}) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // undefined = loading, null = unknown / unreadable / unavailable.
  const [thread, setThread] = useState<SupportThread | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [body, setBody] = useState("");
  const [bodyError, setBodyError] = useState("");
  const [sending, setSending] = useState(false);
  const [conflict, setConflict] = useState("");
  const [failure, setFailure] = useState("");
  const [target, setTarget] = useState<"" | SupportStatus>("");
  const requestId = useRef(0);

  useEffect(() => {
    const my = ++requestId.current;
    setThread(undefined);
    setConflict("");
    setFailure("");
    void sessionRef.current.loadSupportTicket(id, { limit: SUPPORT_HISTORY_LIMIT }).then((result) => {
      if (my !== requestId.current) return;
      setThread(result ? { detail: result, events: result.events, messages: result.messages } : null);
    });
  }, [id, attempt]);
  // The typed text survives a re-read after a conflict, not a change of ticket.
  useEffect(() => {
    setBody("");
    setBodyError("");
    setTarget("");
  }, [id]);

  const reread = () => setAttempt((n) => n + 1);

  const loadMore = async () => {
    if (!thread || thread.detail.page.next_after_version === null) return;
    setLoadingMore(true);
    const more = await sessionRef.current.loadSupportTicket(id, {
      limit: SUPPORT_HISTORY_LIMIT,
      after_version: thread.detail.page.next_after_version,
    });
    setLoadingMore(false);
    if (!more) {
      setFailure("La suite de l’historique n’a pas pu être chargée. Réessayez dans un instant.");
      return;
    }
    setFailure("");
    setThread((t) =>
      t ? { detail: more, events: mergeById(t.events, more.events), messages: mergeById(t.messages, more.messages) } : t,
    );
  };

  // Applies a server result: new version and appended message/event, or the conflict to show.
  const runCommand = async (command: SupportCommand) => {
    const result = await sessionRef.current.supportCommand(id, command);
    if (result.ok) {
      setConflict("");
      setFailure("");
      setThread((t) =>
        t
          ? {
              detail: {
                ...t.detail,
                ticket: result.ticket,
                page: {
                  ...t.detail.page,
                  total_events: t.detail.page.total_events + 1,
                  total_messages: t.detail.page.total_messages + (result.message ? 1 : 0),
                },
              },
              events: mergeById(t.events, [result.event]),
              messages: result.message ? mergeById(t.messages, [result.message]) : t.messages,
            }
          : t,
      );
      return true;
    }
    if (result.conflict) setConflict(result.message);
    else setFailure(result.message);
    return false;
  };

  const submitReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!thread) return;
    const text = body.trim();
    if (!text) {
      setBodyError("Saisissez votre réponse avant d’envoyer.");
      return;
    }
    if (text.length > SUPPORT_BODY_MAX) {
      setBodyError(`La réponse est limitée à ${SUPPORT_BODY_MAX} caractères.`);
      return;
    }
    setBodyError("");
    setSending(true);
    const ok = await runCommand({ action: "reply", expected_version: thread.detail.ticket.version, body: text });
    setSending(false);
    if (ok) setBody("");
  };

  const back = (
    <button type="button" className={styles.backLink} onClick={onBack}>
      <Icon name="back" size={16} />
      Retour aux demandes
    </button>
  );
  if (thread === undefined)
    return (
      <>
        {back}
        <Loader label="Chargement de la demande…" />
      </>
    );
  if (thread === null) {
    const state = session.capabilities.support;
    return (
      <>
        {back}
        <Panel title="Demande d’assistance">
          <div className={styles.panelBody}>
            <Unavailable
              title="Demande indisponible"
              state={state}
              reason={
                state === "available"
                  ? "Cette demande est introuvable ou n’a pas pu être chargée."
                  : "L’assistance n’est pas encore activée sur ce service."
              }
            >
              <div className={styles.actions} style={{ marginTop: 12 }}>
                <button type="button" className="button outline" onClick={reread}>
                  <Icon name="refresh" size={16} />
                  Réessayer
                </button>
              </div>
            </Unavailable>
          </div>
        </Panel>
      </>
    );
  }

  const { ticket, permissions, page } = thread.detail;
  const events = [...thread.events].sort((a, b) => a.version - b.version);
  const messageById = new Map(thread.messages.map((m) => [m.id, m]));
  const me = session.profileId;
  const authorOf = (m: SupportMessage) =>
    m.author_kind === "admin" ? (m.author_id === me ? "Assistance (vous)" : "Assistance") : "Utilisateur";
  const actorOf = (actorId: string) => (actorId === me ? "par vous" : "par l’assistance");
  const targets = SUPPORT_TRANSITIONS[ticket.status];
  const chosen = target && targets.includes(target) ? target : "";
  const resolved = ticket.status === "resolved";
  const busy = session.busy || sending;
  const remaining = SUPPORT_BODY_MAX - body.trim().length;

  const statusControl = permissions.can_set_status && (
    <div className={styles.statusControl}>
      <Field
        label="Nouvel état"
        hint={`État actuel : ${SUPPORT_STATUS[ticket.status].label}. Seuls les passages autorisés depuis cet état sont proposés.`}
      >
        <select value={chosen} onChange={(e) => setTarget(e.target.value as "" | SupportStatus)} disabled={busy}>
          <option value="">Choisir un état</option>
          {targets.map((s) => (
            <option key={s} value={s}>
              {SUPPORT_STATUS[s].label}
            </option>
          ))}
        </select>
      </Field>
      <ConfirmAction
        label="Changer l’état"
        message={
          chosen
            ? `Passer la demande de « ${SUPPORT_STATUS[ticket.status].label} » à « ${SUPPORT_STATUS[chosen].label} ». Le changement est inscrit dans l’historique visible par l’utilisateur.`
            : ""
        }
        confirmLabel="Confirmer"
        busy={busy || !chosen}
        onConfirm={async () => {
          if (!chosen) return;
          const ok = await runCommand({ action: "set_status", expected_version: ticket.version, status: chosen });
          if (ok) setTarget("");
        }}
      />
    </div>
  );

  return (
    <>
      {back}
      <section className={styles.panel}>
        <div className={styles.ticketHead}>
          <div>
            <h2>{ticket.subject}</h2>
            <p>
              Utilisateur <span className={styles.mono}>{shortUser(ticket.creator_id)}</span> · créée le {dateTime(ticket.created_at)} · dernière
              activité {dateTime(ticket.last_message_at)}
            </p>
          </div>
          <SupportStatusTag status={ticket.status} />
        </div>
        <dl className={styles.definitions}>
          <dt>Dossier lié</dt>
          <dd>
            {ticket.intervention_id ? (
              <button type="button" className={`${styles.link} ${styles.inlineLink}`} onClick={() => onOpenDossier(ticket.intervention_id as string)}>
                Ouvrir le dossier <span className={styles.mono}>{shortId(ticket.intervention_id)}</span>
              </button>
            ) : (
              "Aucun dossier lié"
            )}
          </dd>
          <dt>Référence</dt>
          <dd className={styles.mono}>{shortId(ticket.id)}</dd>
          <dt>Historique</dt>
          <dd>
            {page.total_events} {page.total_events === 1 ? "événement" : "événements"} · {page.total_messages}{" "}
            {page.total_messages === 1 ? "message" : "messages"} · version {ticket.version}
          </dd>
        </dl>
      </section>

      <Panel title="Historique" count={events.length} intro="Du plus ancien au plus récent. Chaque réponse et chaque changement d’état y sont inscrits ; rien n’est modifié a posteriori.">
        <ol className={styles.timeline}>
          {events.map((ev) => {
            const msg = ev.message_id ? messageById.get(ev.message_id) : undefined;
            if (ev.kind === "status_changed")
              return (
                <li key={ev.id} className={styles.timelineEvent}>
                  <span>
                    État passé de « {ev.from_status ? SUPPORT_STATUS[ev.from_status].label : "—"} » à « {SUPPORT_STATUS[ev.to_status].label} »
                  </span>
                  <small>
                    {actorOf(ev.actor_id)} · {dateTime(ev.created_at)}
                  </small>
                </li>
              );
            const fromAdmin = msg ? msg.author_kind === "admin" : false;
            return (
              <li key={ev.id} className={`${styles.message} ${fromAdmin ? styles.fromAdmin : ""}`}>
                <header>
                  <strong>{msg ? authorOf(msg) : ev.kind === "ticket_created" ? "Utilisateur" : "Réponse"}</strong>
                  <span>
                    {ev.kind === "ticket_created" ? "Demande créée · " : ""}
                    {dateTime(ev.created_at)}
                  </span>
                </header>
                {msg ? <p>{msg.body}</p> : <p className={styles.muted}>Message non chargé dans cette page de l’historique.</p>}
              </li>
            );
          })}
        </ol>
        {page.has_more && page.next_after_version !== null && (
          <div className={styles.timelineMore}>
            <button type="button" className="button outline" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? "Chargement…" : "Charger la suite"}
            </button>
            <span className={styles.muted}>
              {events.length} sur {page.total_events} {page.total_events === 1 ? "événement" : "événements"} affichés
            </span>
          </div>
        )}
      </Panel>

      <Panel title="Traitement">
        <div className={styles.panelBody}>
          {conflict && (
            <div className={styles.conflict} role="alert">
              <Icon name="warning" size={16} />
              <div>
                <strong>La demande a changé depuis votre lecture.</strong>
                <p>{conflict} Votre texte est conservé : relisez la demande, puis renvoyez-le si nécessaire.</p>
                <button type="button" className="button outline" onClick={reread}>
                  <Icon name="refresh" size={16} />
                  Relire la demande
                </button>
              </div>
            </div>
          )}
          {failure && (
            <p className={styles.inlineError} role="alert">
              {failure}
            </p>
          )}
          {permissions.can_reply ? (
            <form onSubmit={(e) => void submitReply(e)} noValidate>
              <Field
                label="Votre réponse"
                hint={`Visible par l’utilisateur dans son espace. ${remaining >= 0 ? `${remaining} caractères restants.` : ""}`}
                error={bodyError}
              >
                <textarea
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    if (bodyError) setBodyError("");
                  }}
                  rows={5}
                  maxLength={SUPPORT_BODY_MAX + 200}
                  disabled={busy}
                  placeholder="Réponse de l’assistance"
                />
              </Field>
              {resolved ? (
                <p className={styles.formNote}>
                  Cette demande est résolue : rouvrez-la (état « {SUPPORT_STATUS.in_progress.label} ») avant d’envoyer une réponse. Votre texte est conservé.
                </p>
              ) : (
                <div className={styles.actions}>
                  <button type="submit" className="button primary" disabled={busy || Boolean(conflict)}>
                    <Icon name="send" size={16} />
                    {sending ? "Envoi…" : "Envoyer la réponse"}
                  </button>
                </div>
              )}
              {conflict && !resolved && <p className={styles.formNote}>Relisez la demande avant de renvoyer votre réponse.</p>}
            </form>
          ) : (
            <p className={styles.formNote}>Vous ne pouvez pas répondre à cette demande.</p>
          )}
          {statusControl}
          {!permissions.can_reply && !permissions.can_set_status && (
            <p className={styles.formNote}>Aucune action n’est possible sur cette demande avec vos droits actuels.</p>
          )}
        </div>
      </Panel>
    </>
  );
}
