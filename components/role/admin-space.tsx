"use client";
// Platform Super Admin space (reference M43). The operator of the platform, not the owner of a
// client organisation. Every figure comes from session.loadAdminOverview() (global counts,
// lists bounded to capabilities.list_limit) or from session.data; every mutation goes through
// session.* or the shared forms that already carry their own confirmation.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "../app/session-types";
import type {
  AdminOverview,
  ArtisanApplicationStatus,
  ArtisanDossier,
  CredentialKind,
  Intervention,
  Message,
  Operations,
  Role,
  Status,
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
import { quoteVersions } from "../app/session";
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
const ACTIVE_STATUSES: Status[] = ["requested", "assigned", "quoted", "accepted", "in_progress", "completed"];
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
const isPendingApplication = (a: OverviewArtisan) => a.application_status === "submitted";
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
type Column<T> = { key: string; label: string; render: (row: T) => ReactNode; wide?: boolean };
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
              <th scope="col" key={c.key}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={keyOf(row)}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} className={c.wide ? "wide" : undefined}>
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
          {shortId(intervention.id)} · Client ·{" "}
          {intervention.artisan_id ? artisanName || "Artisan attribué" : "Non attribué"} ·{" "}
          {intervention.city}
        </span>
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
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstNav = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    menuButton.current?.focus();
  }, []);
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
          title: artisanName(session.param) || "Dossier artisan",
          subtitle: "Examen d’une candidature artisan",
        };
      case "admin-interventions":
        return { title: "Interventions", subtitle: "Tous les dossiers de la plateforme" };
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
        return { title: "Messages", subtitle: "Support et échanges des dossiers" };
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
    const pending = o.artisans.filter(isPendingApplication).sort(byNewest as never);
    const active = o.interventions
      .filter((i) => ACTIVE_STATUSES.includes(i.status))
      .sort(byNewest)
      .slice(0, 6);
    return (
      <>
        <div className={styles.kpis}>
          <Kpi icon="list" tone="blue" label="Interventions" value={o.counts.interventions} note="Total plateforme, tous statuts confondus (compteur global)." />
          <Kpi icon="clock" tone="amber" label="Interventions en cours" value={o.counts.active_interventions} note="Dossiers non clos, décompte global de la plateforme." />
          <Kpi
            icon="euro"
            tone="green"
            label="Prestations payées TTC"
            value={money(o.financial.paid_service_cents)}
            note={
              <>
                {o.financial.note}
                <br />
                Revenu plateforme : non calculé.
              </>
            }
          />
          <Kpi icon="shield" tone="navy" label="Candidatures à examiner" value={o.counts.pending_applications} note="Dossiers artisans soumis, en attente d’une décision." />
        </div>
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
                { key: "name", label: "Artisan", wide: true, render: (a) => <Person name={a.full_name} /> },
                { key: "company", label: "Société", render: (a) => a.company_name || "—" },
                { key: "status", label: "Dossier", render: (a) => applicationTag(a.application_status) },
                { key: "date", label: "Date", render: (a) => (a.created_at ? date(a.created_at) : "—") },
                {
                  key: "actions",
                  label: "Actions",
                  render: (a) => (
                    <button type="button" className={styles.rowAction} onClick={() => go("admin-artisan", a.id)}>
                      <Icon name="eye" size={15} />
                      Examiner
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
            <Basis>Dossiers au statut « soumis » parmi les {o.capabilities.list_limit} derniers artisans ; le compteur est global.</Basis>
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
            <Basis>Six dossiers non clos les plus récents parmi les {o.capabilities.list_limit} derniers chargés. Les noms des clients ne sont pas transmis dans cette vue.</Basis>
          </Panel>
        </div>
      </>
    );
  };

  const renderArtisans = (o: AdminOverview) => (
    <ArtisansView overview={o} demo={demo} limitNote={limitNote} onOpen={(id) => go("admin-artisan", id)} onReload={() => void load()} reloading={reloading} />
  );

  const renderArtisan = (o: AdminOverview) => {
    const id = session.param;
    const artisan = o.artisans.find((a) => a.id === id);
    const back = (
      <button type="button" className={styles.backLink} onClick={() => go("admin-artisans")}>
        <Icon name="back" size={16} />
        Retour aux artisans
      </button>
    );
    if (!artisan)
      return (
        <>
          {back}
          <Empty icon="person" title="Artisan introuvable">
            Cet identifiant ne figure pas parmi les {o.capabilities.list_limit} derniers artisans chargés. Actualisez les données ou revenez à la liste.
          </Empty>
        </>
      );
    const missions = o.interventions.filter((i) => i.artisan_id === artisan.id).sort(byNewest);
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
                <dt>Inscription</dt>
                <dd>{artisan.created_at ? date(artisan.created_at) : "Date non transmise"}</dd>
                <dt>Identifiant</dt>
                <dd className={styles.mono}>{shortUser(artisan.id)}</dd>
              </dl>
            </Panel>
            <ArtisanDossierPanel session={session} userId={artisan.id} summary={artisan} />
            <Panel title="Règles d’approbation">
              <ul className={styles.rules}>
                <li>L’approbation exige un dossier soumis par l’artisan (société, SIRET, adresse, zone et compétences).</li>
                <li>Toute modification du dossier par l’artisan remet son approbation à zéro : le dossier repasse en brouillon.</li>
                <li>La suspension bloque l’accès aux nouvelles missions et les écritures terrain (étape de déplacement, compte rendu).</li>
              </ul>
            </Panel>
            <Panel title={`Interventions de ${artisan.full_name}`} count={missions.length}>
              {missions.length ? (
                <div className={styles.rowList}>
                  {missions.map((i) => (
                    <InterventionRow key={i.id} intervention={i} artisanName={artisan.full_name} onOpen={() => openDossier(i.id)} />
                  ))}
                </div>
              ) : (
                <Empty icon="list" title="Aucune intervention attribuée">
                  Aucun dossier parmi les {o.capabilities.list_limit} derniers chargés n’est attribué à cet artisan.
                </Empty>
              )}
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
  };

  const renderInterventions = (o: AdminOverview) => (
    <InterventionsView overview={o} limitNote={limitNote} artisanName={artisanName} onOpen={openDossier} />
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
                      <button type="button" className={styles.link} style={{ minHeight: 32 }} onClick={() => openDossier(q.intervention_id)}>
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
        <Unavailable
          title="Factures et avoirs"
          reason={
            caps?.invoices
              ? "Fonction annoncée mais pas encore activée dans cette interface : attendez son activation. En attendant, les règlements Stripe ci-dessus font foi."
              : "Pas encore activé sur ce service : aucune facture ni avoir n’est généré. Les règlements Stripe ci-dessus sont la seule pièce disponible."
          }
          blocker="FIN-05"
        />
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

  const renderClients = (o: AdminOverview) => <ClientsView overview={o} limitNote={limitNote} onOpen={openDossier} />;

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
                      <button type="button" className={styles.link} style={{ minHeight: 32 }} onClick={() => openDossier(r.intervention_id)}>
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
        <Unavailable
          title="Boîte de support"
          reason={
            caps?.support_tickets
              ? "Fonction annoncée mais pas encore activée dans cette interface : attendez son activation."
              : "Pas encore activé sur ce service : les demandes d’assistance ne transitent pas par cette interface. Les messages des dossiers restent lisibles ci-dessous."
          }
          blocker="ADM-07"
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
                    ["Réaffectation avant acceptation du devis", o.capabilities.dispatch_before_quote_acceptance],
                    ["Remboursements", o.capabilities.refunds],
                    ["Factures", o.capabilities.invoices],
                    ["Tickets support", o.capabilities.support_tickets],
                  ] as const
                ).map(([label, value]) => (
                  <tr key={label}>
                    <td data-label="Fonction">{label}</td>
                    <td data-label="Valeur">{value ? "Oui" : "Non"}</td>
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
        content = withOverview(renderArtisans);
        break;
      case "admin-artisan":
        content = withOverview(renderArtisan);
        break;
      case "admin-interventions":
        content = withOverview(renderInterventions);
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
        content = withOverview(renderClients);
        break;
      case "admin-reviews":
        content = renderReviews();
        break;
      case "admin-messages":
      case "messages":
        content = renderMessages();
        break;
      case "admin-settings":
        content = withOverview(renderSettings);
        break;
      case "admin-warranty":
        content = <WarrantyPanel demo={demo} role="admin" />;
        break;
      case "documents":
        content = (
          <DocumentManager documents={session.data.documents} interventions={session.data.interventions} demo={demo} onRefresh={session.refresh} />
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
    <div className={styles.space}>
      <aside
        id="admin-sidebar"
        className={`${styles.sidebar} ${menuOpen ? styles.open : ""}`}
        aria-label="Navigation Super Admin"
      >
        <div className={styles.sidebarTop}>
          <Brand compact />
          <button type="button" className={styles.closeButton} onClick={closeMenu} aria-label="Fermer le menu">
            <Icon name="close" size={18} />
          </button>
        </div>
        <nav className={styles.nav} aria-label="Sections de l’administration">
          {NAV.map((item, index) => (
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
                <span className={styles.navCount} aria-label={`${pendingCount} candidatures à examiner`}>
                  {pendingCount}
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
      <div className={styles.main}>
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
  summary: OverviewArtisan;
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
function ArtisansView({
  overview,
  demo,
  limitNote,
  onOpen,
  onReload,
  reloading,
}: {
  overview: AdminOverview;
  demo: boolean;
  limitNote: string;
  onOpen: (id: string) => void;
  onReload: () => void;
  reloading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "none" | ArtisanApplicationStatus>("all");
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return overview.artisans
      .filter((a) => {
        if (status === "none" && a.application_status) return false;
        if (status !== "all" && status !== "none" && a.application_status !== status) return false;
        if (!q) return true;
        return a.full_name.toLowerCase().includes(q) || (a.company_name || "").toLowerCase().includes(q);
      })
      .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""));
  }, [overview.artisans, search, status]);
  return (
    <>
      <Panel title="Artisans inscrits" count={overview.counts.artisans}>
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
        <DataTable
          caption="Artisans"
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
          empty={
            overview.artisans.length ? (
              <Empty icon="search" title="Aucun artisan ne correspond">
                Modifiez la recherche ou l’état du dossier.
              </Empty>
            ) : (
              <Empty icon="users" title="Aucun artisan inscrit">
                Les inscriptions artisans apparaîtront ici.
              </Empty>
            )
          }
        />
        <Basis>{limitNote}</Basis>
      </Panel>
      <Panel
        title="Décisions d’approbation et suspension"
        intro="Approuver ouvre l’accès aux missions après vérification du dossier ; suspendre ferme les nouvelles missions et les écritures terrain. Après une décision, actualisez les données pour mettre la liste ci-dessus à jour."
        action={
          <button type="button" className={styles.link} onClick={onReload} disabled={reloading}>
            <Icon name="refresh" size={15} />
            {reloading ? "Actualisation…" : "Actualiser la vue d’ensemble"}
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

// ---- Interventions -------------------------------------------------------------------------
function InterventionsView({
  overview,
  limitNote,
  artisanName,
  onOpen,
}: {
  overview: AdminOverview;
  limitNote: string;
  artisanName: (id: string | null | undefined) => string | undefined;
  onOpen: (id: string) => void;
}) {
  const [status, setStatus] = useState<"all" | Status>("all");
  const [urgency, setUrgency] = useState<"all" | Urgency>("all");
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return overview.interventions
      .filter((i) => (status === "all" || i.status === status) && (urgency === "all" || i.urgency === urgency))
      .filter((i) => !q || shortId(i.id).toLowerCase().includes(q) || i.city.toLowerCase().includes(q) || i.postal_code.includes(q))
      .sort(byNewest);
  }, [overview.interventions, status, urgency, search]);
  return (
    <Panel title="Interventions" count={overview.counts.interventions}>
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
      <DataTable
        caption="Interventions"
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
          { key: "artisan", label: "Artisan", render: (i) => (i.artisan_id ? artisanName(i.artisan_id) || "Attribué" : <span className={styles.muted}>Non attribué</span>) },
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
        empty={
          overview.interventions.length ? (
            <Empty icon="search" title="Aucune intervention ne correspond">
              Modifiez les filtres ou la recherche.
            </Empty>
          ) : (
            <Empty icon="list" title="Aucune intervention enregistrée">
              Les demandes des clients apparaîtront ici.
            </Empty>
          )
        }
      />
      <Basis>{limitNote}</Basis>
    </Panel>
  );
}

// ---- Clients -------------------------------------------------------------------------------
function ClientsView({
  overview,
  limitNote,
  onOpen,
}: {
  overview: AdminOverview;
  limitNote: string;
  onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const q = search.trim().toLowerCase();
  const clients = overview.clients
    .filter((c) => !q || c.full_name.toLowerCase().includes(q))
    .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""));
  const organizations = overview.organizations.filter((o) => !q || o.name.toLowerCase().includes(q));
  const dossiersOf = (clientId: string) => overview.interventions.filter((i) => i.client_id === clientId);
  const current = overview.clients.find((c) => c.id === selected);
  return (
    <>
      <Panel title="Clients" count={overview.counts.clients}>
        <div className={styles.filters}>
          <label className={styles.filter}>
            Recherche (nom du client ou de l’organisation)
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom" maxLength={100} />
          </label>
        </div>
        <DataTable
          caption="Clients"
          rows={clients}
          keyOf={(c) => c.id}
          columns={[
            { key: "name", label: "Client", wide: true, render: (c) => <Person name={c.full_name} /> },
            { key: "kind", label: "Type", render: (c) => clientKind(c.role) },
            { key: "created", label: "Inscription", render: (c) => (c.created_at ? date(c.created_at) : "—") },
            { key: "count", label: "Dossiers", render: (c) => <span className={styles.mono}>{dossiersOf(c.id).length}</span> },
            {
              key: "actions",
              label: "Actions",
              render: (c) => (
                <button type="button" className={styles.rowAction} aria-pressed={selected === c.id} onClick={() => setSelected(selected === c.id ? "" : c.id)}>
                  <Icon name="eye" size={15} />
                  {selected === c.id ? "Masquer" : "Voir"}
                </button>
              ),
            },
          ]}
          empty={
            overview.clients.length ? (
              <Empty icon="search" title="Aucun client ne correspond">
                Modifiez la recherche.
              </Empty>
            ) : (
              <Empty icon="person" title="Aucun client inscrit">
                Les comptes clients apparaîtront ici.
              </Empty>
            )
          }
        />
        <Basis>
          {limitNote} Le nombre de dossiers est compté sur les {overview.capabilities.list_limit} dernières interventions chargées.
        </Basis>
      </Panel>
      {current && (
        <Panel title={current.full_name} count={dossiersOf(current.id).length} intro={`${clientKind(current.role)}${current.created_at ? ` · inscrit le ${date(current.created_at)}` : ""}`}>
          {dossiersOf(current.id).length ? (
            <div className={styles.rowList}>
              {dossiersOf(current.id)
                .sort(byNewest)
                .map((i) => (
                  <InterventionRow key={i.id} intervention={i} onOpen={() => onOpen(i.id)} />
                ))}
            </div>
          ) : (
            <Empty icon="list" title="Aucun dossier chargé pour ce client">
              Aucune intervention parmi les {overview.capabilities.list_limit} dernières ne lui est rattachée.
            </Empty>
          )}
          <div className={styles.panelBody}>
            <Unavailable title="Fiche client détaillée non disponible" reason="Coordonnées, historique complet et sites ne sont pas transmis à l’administration ; seule la liste des interventions chargées est disponible." blocker="ADM-04" />
          </div>
        </Panel>
      )}
      <Panel title="Organisations" count={overview.counts.organizations}>
        <DataTable
          caption="Organisations"
          rows={organizations}
          keyOf={(o) => o.id}
          columns={[
            { key: "name", label: "Organisation", wide: true, render: (o) => <strong>{o.name}</strong> },
            { key: "type", label: "Type", render: (o) => (o.type ? SITE_TYPES[o.type] || o.type : "—") },
            { key: "owner", label: "Propriétaire", render: (o) => <span className={styles.mono}>{shortUser(o.owner_id)}</span> },
          ]}
          empty={
            <Empty icon="building" title="Aucune organisation">
              Les organisations clientes (syndics, restauration, bureaux, ERP) apparaîtront ici.
            </Empty>
          }
        />
        <Basis>La date de création des organisations n’est pas transmise par la vue d’ensemble.</Basis>
      </Panel>
    </>
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
  const intervention =
    overview?.interventions.find((i) => i.id === id) || session.data.interventions.find((i) => i.id === id);
  const sessionRef = useRef(session);
  sessionRef.current = session;
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
    if (!overview && !overviewFailed && !session.data.interventions.length)
      return (
        <>
          {back}
          <Loader label="Chargement du dossier…" />
        </>
      );
    return (
      <>
        {back}
        <Empty icon="list" title="Dossier introuvable">
          Cet identifiant ne figure ni dans la vue d’ensemble ni dans l’espace de travail chargé. Actualisez les données ou revenez à la liste.
        </Empty>
      </>
    );
  }
  const c = category(intervention.category);
  const quotes = quoteVersions(session.data.quotes, id);
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

          <Panel title="Devis" count={quotes.length} intro="Versions successives transmises par l’artisan. L’acceptation reste une action du client.">
            <DataTable
              caption="Versions du devis"
              rows={quotes}
              keyOf={(q) => q.id}
              columns={[
                { key: "ref", label: "Référence", render: (q) => <span className={styles.mono}>{quoteRef(q.id)}</span> },
                { key: "ht", label: "Total HT", render: (q) => <span className={styles.mono}>{money(q.subtotal_cents)}</span> },
                { key: "tax", label: "TVA", render: (q) => <span className={styles.mono}>{money(q.tax_cents)} ({String(q.tax_rate).replace(".", ",")} %)</span> },
                { key: "ttc", label: "Total TTC", render: (q) => <strong className={styles.mono}>{money(q.total_cents)}</strong> },
                {
                  key: "status",
                  label: "Statut",
                  render: (q) => {
                    const s = QUOTE_STATUS[q.status];
                    return <Tag tone={s?.tone || "neutral"}>{s?.label || q.status}</Tag>;
                  },
                },
                { key: "date", label: "Envoyé", render: (q) => dateTime(q.created_at) },
              ]}
              empty={
                <div className={styles.panelBody}>
                  <p className={styles.muted}>Devis non chargés dans cette vue : l’espace de travail administrateur ne contient aucun devis pour ce dossier.</p>
                </div>
              }
            />
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
