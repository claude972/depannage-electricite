"use client";
import { DemoBanner } from "../app/demo-banner";
// Espace particulier (rôle "client"). Présentation uniquement : chaque mutation passe par
// `session.*`. Références : M61 (accueil mobile), V8-C07 (détail d’intervention), V8-C06
// (devis), M7 (suivi). Mobile < 1024 px : navigation basse ; desktop : barre latérale.
import { realName } from "../app/display-name";
import { parseOrderReference } from "../../shared/order-reference";
import { reportDeclarant } from "../app/report-declarant";
import { ReportEvidenceSummary, ReportReceiptForm, canSignReport, dossierPhotos } from "../app/report-evidence";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import type { Session } from "../app/session-types";
import {
  CATEGORIES,
  ROLE_NAMES,
  STATUS,
  TRAVEL_STAGE,
  category,
  date,
  dateTime,
  download,
  initials,
  money,
  quoteRef,
  shortId,
} from "../app/format";
import { canAccess, pickQuote, quoteVersions } from "../app/session";
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
import {
  DocumentManager,
  MessageCenter,
  ProfileForm,
  RequestForm,
  ReviewForm,
  WarrantyPanel,
} from "../app/forms";
import type {
  Category,
  Intervention,
  Operations,
  Quote,
  Role,
  Status,
  View,
} from "../app/types";
import { BookingConfirm } from "./booking-confirm";
import { CardReturnPanel } from "./card-return-panel";
import { BookingSettlement } from "./booking-settlement";
import { OnsiteSettlement } from "./onsite-settlement";
import { createOptionsApi } from "./booking-options";
import { bookingPaymentText, fetchBookingStatus, isDeclaredOnSite, type BookingStatus } from "../app/booking-status";
import styles from "./client.module.css";
import theme from "./client-theme.module.css";
import { ThemeSurface } from "../app/theme-provider";
import { PublicContactActions } from "./public-contact-actions";
import { CLIENT_STEPS, currentStepIndex, detailHistory, requestAmount, quoteDecisionState, quoteLineCells } from "./client-lists";
import { HeaderBell, NotificationsPage } from "./notifications-anchor";
import { PreferencesPanel } from "../features/notifications/notification-center";
import { FeatureUnavailable, useProbeWhenUnknown } from "./feature-unavailable";
import { demoPreferences } from "../../lib/features/notifications/demo";
import { QuoteDocumentsAnchor } from "./quote-documents-anchor";
import { TrackingAnchor } from "./tracking-anchor";
import { DossierMapPanel } from "../features/dossier-map/dossier-map-panel";
import { BookingLocationRows } from "./booking-location-rows";
import { useDetailPresence } from "./use-detail-presence";
import { PointReadState } from "./detail-read-view";
import { PlatformPage } from "./platform-anchor";
import { platformEntries } from "./anchors";
import { UploadQueuePanel } from "../app/upload-queue";
import { DossierHelpLink, SupportCenter } from "./support-tickets";
import { AccountDataPanel } from "../features/account-data/account-data-panel";
import { AccountSessionsPanel } from "../features/account-sessions/account-sessions-panel";
import { SEARCH_COPY, rowsSignal, toListRows, useRequestsSearch } from "../features/requests-search/use-requests-search";
import { QUOTES_COPY, useRecipientQuote, useRecipientQuotes, type QuoteFilter } from "../features/recipient-quotes/use-recipient-quotes";
import { ClientAddressesPanel, usePreferredAddress } from "../features/client-addresses/client-addresses-panel";
import { CustomerInvoicesPanel } from "../features/customer-invoices/customer-invoices-panel";
import { AppointmentReminderPanel } from "../features/appointment-reminders/appointment-reminder-panel";
import { ProviderTeamsPanel } from "../features/provider-teams/provider-teams-panel";
import { ContractSourceLine } from "../features/quote-grid/quote-grid";
import { PlatformPayAction } from "../app/platform-pay";
import { SavedPaymentMethodsPanel } from "../features/saved-payment-methods/saved-payment-methods-panel";
import { PhotoReviewPanel } from "../features/photo-review/photo-review-panel";
import { reviewImage } from "../features/photo-review/model";
import { SubscriptionsPanel } from "../features/subscriptions/subscriptions-panel";

const CLIENT_VIEWS: readonly View[] = [
  "overview",
  "requests",
  "new",
  "detail",
  "quote",
  "messages",
  "notifications",
  "platform-operators",
  "platform-finance",
  "platform-moderation",
  "platform-audit",
  "support-queue",
  "documents",
  "profile",
  "help",
  "support",
];
const VIEW_NAMES: Partial<Record<View, string>> = {
  requests: "Mes demandes",
  new: "Nouvelle demande",
  detail: "Intervention",
  quote: "Devis",
  messages: "Messages",
  notifications: "Notifications",
  "platform-operators": "Opérateurs de plateforme",
  "platform-finance": "Finance plateforme",
  "platform-moderation": "Modération des avis",
  "platform-audit": "Journal d’audit",
  "support-queue": "File d’assistance",
  documents: "Documents",
  profile: "Mon profil",
  help: "Aide",
  support: "Assistance",
};
// A client's space opens on the profile: contact details, addresses, requests. No other dashboard.
const SIDE_NAV: { id: View; label: string; icon: string }[] = [
  { id: "profile", label: "Mon profil", icon: "person" },
  { id: "requests", label: "Mes demandes", icon: "list" },
  { id: "messages", label: "Messages", icon: "message" },
  { id: "documents", label: "Documents", icon: "document" },
];
const BOTTOM_NAV: { id: View; label: string; icon: string; also: View[] }[] = [
  { id: "profile", label: "Profil", icon: "person", also: ["documents"] },
  { id: "requests", label: "Demandes", icon: "list", also: ["new", "detail", "quote"] },
  { id: "messages", label: "Messages", icon: "message", also: [] },
  { id: "help", label: "Aide", icon: "help", also: ["support"] },
];
const FAQ: [string, string][] = [
  [
    "Quelle différence entre estimation et devis ?",
    "L’estimation donne une fourchette indicative. Le devis est établi par l’artisan à partir de votre besoin et détaille les prestations, les taxes et le montant proposé. Vous le validez avant le début des travaux.",
  ],
  [
    "Quand dois-je régler l’intervention ?",
    "Le paiement intervient une fois l’intervention terminée, sur la base du devis accepté (avenants acceptés compris), et toujours sur la plateforme : par carte depuis le suivi du dossier. Ne payez jamais l’artisan directement. Une redirection de paiement ne suffit pas à confirmer un encaissement ; les anciennes déclarations « reçu sur place » restent affichées comme des déclarations, pas comme des paiements bancaires.",
  ],
  [
    "Comment suivre ma demande ?",
    "Dans « Mes demandes », ouvrez une intervention pour consulter son état, son devis et les échanges associés.",
  ],
  [
    "Comment sont attribuées les missions ?",
    "Un artisan éligible accepte une demande disponible. L’attribution est contrôlée pour qu’une même mission ne soit pas acceptée par plusieurs artisans. Aucun délai n’est garanti à ce stade.",
  ],
  [
    "Que couvre la garantie ?",
    "Les conditions de garantie de la plateforme figurent dans l’aide publique, section « Garantie », après publication par l’exploitant.",
  ],
  [
    "Puis-je gérer plusieurs établissements ?",
    "L’espace professionnel regroupe les sites et leurs interventions. Il distingue copropriétés, restauration, bureaux et établissements recevant du public.",
  ],
  [
    "Puis-je tester sans transmettre mes informations ?",
    "Oui. La démonstration utilise des exemples et conserve ses modifications dans ce navigateur. Elle n’envoie aucune demande à un artisan et ne réalise aucun débit bancaire.",
  ],
];

const isCategory = (value: string): value is Category =>
  CATEGORIES.some((c) => c.id === value);
const isOpen = (s: Status) => !["paid", "cancelled"].includes(s);
// Dossiers du particulier connecté uniquement (jamais ceux d’un autre rôle de la démo).
function mine(session: Session): Intervention[] {
  return session.data.interventions
    .filter((i) => !i.client_id || i.client_id === session.profileId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
function toLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function quoteStatusLabel(q: Quote) {
  return q.status === "accepted"
    ? "Accepté"
    : q.status === "rejected"
      ? "Refusé ou remplacé"
      : q.status === "sent"
        ? "Envoyé, à valider"
        : q.status;
}
function recapText(q: Quote, i: Pick<Intervention, "id" | "category"> | undefined, demo: boolean) {
  return [
    demo ? "DÉMONSTRATION — AUCUNE VALEUR CONTRACTUELLE" : "",
    `RÉCAPITULATIF DU DEVIS ${quoteRef(q.id)} (texte, pas une facture)`,
    i ? `${category(i.category).label} — ${shortId(i.id)}` : "",
    `Reçu le ${dateTime(q.created_at)}`,
    "",
    ...q.lines.map(
      (l) =>
        `${l.label} : ${l.quantity} x ${money(l.unit_price_cents)} HT = ${money(Math.round(l.quantity * l.unit_price_cents))}`,
    ),
    "",
    `Sous-total HT : ${money(q.subtotal_cents)}`,
    `TVA (${taxRateLabel(q.tax_rate)}) : ${money(q.tax_cents)}`,
    `Total TTC : ${money(q.total_cents)}`,
    `Statut : ${quoteStatusLabel(q)}`,
    q.accepted_at ? `Accepté le ${dateTime(q.accepted_at)}` : "",
  ]
    .filter((line, index) => line !== "" || index > 0)
    .join("\n");
}

export function ClientSpace({ session }: { session: Session }) {
  // An old « #overview » link opens the profile: the client space has no separate dashboard.
  const view = session.view === "overview" ? "profile" : session.view;
  const inSpace = CLIENT_VIEWS.includes(view);
  const demo = session.mode === "demo";
  // CLI-09: the preferred saved address is only read for the request form (explicit preselection).
  const preferredAddress = usePreferredAddress({ enabled: !demo && view === "new", context: session.mutationContext });
  const rows = mine(session);
  const activeCount = demo ? rows.filter((i) => isOpen(i.status)).length : session.data.client_counts?.active_interventions ?? 0;
  const demoIds = demo ? new Set(rows.map((i) => i.id)) : null;
  const received = demoIds
    ? session.data.messages.filter((m) => demoIds.has(m.intervention_id) && m.author_id !== session.profileId).length
    : session.data.client_counts?.received_messages ?? 0;
  const goMessages = () => session.go("messages");
  // « Modifier » on the booking confirmation opens the regular form prefilled with the same draft.
  const [editBooking, setEditBooking] = useState(false);
  // Card availability comes from the server options only (never assumed).
  const [cardAvailable, setCardAvailable] = useState(false);
  useEffect(() => {
    if (!session.booking || session.mode !== "live") return;
    let active = true;
    void createOptionsApi()().then((o) => {
      if (active) setCardAvailable(Boolean(o?.payment_methods.find((m) => m.id === "card_hold")?.available));
    });
    return () => {
      active = false;
    };
  }, [session.booking, session.mode]);

  function content() {
    if (session.loading) return <Loader label="Chargement de votre espace…" />;
    if (!inSpace) return <Forbidden onHome={() => session.go("profile")} />;
    switch (view) {
      case "requests":
        return <RequestsView session={session} rows={rows} />;
      case "new":
        if (session.booking && session.pendingDraft && !editBooking)
          return (
            <BookingConfirm
              draft={session.pendingDraft}
              booking={session.booking}
              busy={session.busy}
              profileId={session.profileId}
              confirmBooking={session.confirmBooking}
              onEdit={() => setEditBooking(true)}
              onContactChange={session.updateBookingContact}
              onPaymentChange={session.updateBookingPayment}
              cardAvailable={cardAvailable}
              verifyCardHold={session.finalizeBooking}
              cancelCardHold={session.cancelBooking}
              demo={session.mode === "demo"}
            />
          );
        return (
          <RequestForm
            key={session.param}
            initialCategory={session.pendingDraft?.category ?? (isCategory(session.param) ? session.param : "panel")}
            categoryPreselected={Boolean(session.pendingDraft) || isCategory(session.param)}
            initialValues={session.pendingDraft}
            preferredAddress={preferredAddress}
            contactPhone={session.booking?.contact.phone ?? session.pendingDraft?.contact_phone ?? session.profile?.phone ?? ""}
            initialPhotos={session.pendingDraft ? session.bookingPhotos() : undefined}
            finalStep={
              editBooking && session.booking
                ? { label: "Revenir à la confirmation", note: "Vos modifications remplacent la demande en attente ; rien n’est envoyé avant votre confirmation finale." }
                : { label: "Continuer vers le règlement", note: "Rien n’est encore envoyé : vous choisirez ensuite le mode de règlement, puis vous confirmerez l’envoi de votre demande." }
            }
            sites={[]}
            mode={session.mode}
            busy={session.busy}
            onBack={() => session.go("requests")}
            onSubmit={async (values, photos) => {
              if (editBooking && session.booking) {
                // Editing a booking: replace the kept draft AND its in-memory photos, then return to
                // its confirmation (nothing sent).
                session.updatePendingDraft(values, photos);
                setEditBooking(false);
                return;
              }
              // The request goes through the booking confirmation (payment choice): live ⇒ idempotent
              // POST /api/bookings; demo ⇒ same step, local labelled creation (no POST).
              if (session.startBooking(values, photos)) return;
              if (session.mode === "demo") await session.createIntervention(values, photos);
            }}
            onDemo={() => {}}
          />
        );
      case "detail":
        return <DetailView session={session} rows={rows} id={session.selectedId || session.param} />;
      case "quote":
        return <QuoteView session={session} rows={rows} quoteId={session.param} />;
      case "messages":
        return (
          <>
            <PageTitle
              title="Messages"
              subtitle="Les échanges liés à vos interventions restent regroupés ici."
            />
            <MessageCenter
              live={session.mode === "live"}
              interventions={rows}
              messages={session.data.messages}
              role={session.role}
              profileId={session.profileId}
              selectedId={session.param || session.selectedId}
              busy={session.busy}
              onSubmit={(id, body, commandId) => session.sendMessage(id, body, commandId)}
              context={session.mutationContext}
          loadOperations={session.loadOperations}
            />
          </>
        );
      case "notifications":
        return <NotificationsPage session={session} />;
      case "platform-operators":
      case "platform-finance":
      case "platform-moderation":
      case "platform-audit":
      case "support-queue":
        return <PlatformPage session={session} view={view} />;
      case "documents":
        return <DocumentsView session={session} rows={rows} />;
      case "profile":
        return session.param === "parametres"
          ? <ProfileSettings session={session} />
          : <ProfileView session={session} rows={rows} activeCount={activeCount} />;
      case "help":
        return <HelpView session={session} />;
      case "support":
        return <SupportCenter session={session} interventions={rows} backView="profile" />;
      default:
        return <Forbidden onHome={() => session.go("profile")} />;
    }
  }

  return (
    <ThemeSurface className={theme.clientSkin}>
    <div className={styles.space}>
      <aside className={styles.sidebar}>
        <button
          type="button"
          className={styles.sidebarBrand}
          onClick={() => session.go("profile")}
          aria-label="Mon profil"
        >
          <Brand />
        </button>
        <div className={styles.workspaceBlock}>
          <span>
            <Icon name="person" size={18} />
          </span>
          <div>
            <strong>{ROLE_NAMES.client}</strong>
            <small>{demo ? "Espace de démonstration" : "Mon espace"}</small>
          </div>
        </div>
        <span className={styles.navCaption}>Mon espace</span>
        <nav className={styles.sideNav} aria-label="Navigation de l’espace">
          {SIDE_NAV.map((n) => {
            const current =
              view === n.id ||
              (n.id === "requests" && ["new", "detail", "quote"].includes(view));
            return (
              <button
                type="button"
                key={n.id}
                aria-current={current ? "page" : undefined}
                onClick={() => session.go(n.id)}
              >
                <Icon name={n.icon} size={18} />
                <span>{n.label}</span>
                {n.id === "requests" && activeCount > 0 && (
                  <span className={styles.sideCount}>
                    <span aria-hidden="true">{activeCount}</span>
                    <span className="sr-only">{`${activeCount} demandes en cours`}</span>
                  </span>
                )}
                {n.id === "messages" && received > 0 && (
                  <span className={styles.sideCount}>
                    <span aria-hidden="true">{received}</span>
                    <span className="sr-only">{`${received} message${received > 1 ? "s" : ""} reçu${received > 1 ? "s" : ""}`}</span>
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        {platformEntries(session.platformAccess, (v) => canAccess(v, session.role, session.mode)).length > 0 && (
          <>
            <span className={styles.navCaption}>Opérateur de plateforme</span>
            <nav className={styles.sideNav} aria-label="Back-office de la plateforme">
              {platformEntries(session.platformAccess, (v) => canAccess(v, session.role, session.mode)).map((n) => (
                <button
                  type="button"
                  key={n.view}
                  aria-current={view === n.view ? "page" : undefined}
                  onClick={() => session.go(n.view)}
                >
                  <Icon name={n.icon} size={18} />
                  <span>{n.label}</span>
                </button>
              ))}
            </nav>
          </>
        )}
        <div className={styles.sidebarBottom}>
          <button
            type="button"
            aria-current={view === "help" ? "page" : undefined}
            onClick={() => session.go("help")}
          >
            <Icon name="help" size={18} />
            Aide
          </button>
          <button
            type="button"
            aria-current={view === "support" ? "page" : undefined}
            onClick={() => session.go("support")}
          >
            <Icon name="shield" size={18} />
            Assistance
          </button>
          <button type="button" onClick={() => void session.logout()}>
            <Icon name="logout" size={18} />
            {demo ? "Quitter la démonstration" : "Se déconnecter"}
          </button>
        </div>
      </aside>

      <div className={styles.mainArea}>
        <header className={styles.header}>
          <span className={styles.breadcrumb}>
            Espace particulier
          </span>
          <div className={styles.headerTools}>
            {!demo && (
              <button
                type="button"
                className={`${styles.connection} ${session.connection === "SUBSCRIBED" ? styles.live : ""}`}
                onClick={() => void session.refresh()}
                title="Actualiser les données"
              >
                <span />
                Connexion temps réel : {session.connection === "SUBSCRIBED" ? "Connecté" : "non connectée"} · Actualiser
              </button>
            )}
            <button
              type="button"
              className={styles.bellButton}
              aria-label="Paramètres du compte"
              onClick={() => session.go("profile", "parametres")}
            >
              <Icon name="settings" size={20} />
            </button>

            <HeaderBell session={session} />
            <button
              type="button"
              className={styles.bellButton}
              aria-label={received ? `Messages (${received} reçus)` : "Messages"}
              onClick={goMessages}
            >
              <Icon name="message" size={20} />
              {received > 0 && <span className={styles.bellDot} aria-hidden="true" />}
            </button>
            <button
              type="button"
              className={styles.userChip}
              onClick={() => session.go("profile")}
            >
              <span className="avatar">{initials(session.displayName) || "?"}</span>
              <span>
                <strong>{session.displayName}</strong>
                <small>{ROLE_NAMES.client}</small>
              </span>
            </button>
          </div>
        </header>

        <header className={styles.mobileHeader}>
          <strong className={styles.mobileHeading}>
            Mon espace
          </strong>
          <div className={styles.mobileHeaderTools}>

            <HeaderBell session={session} />
          </div>
        </header>

        {demo && <DemoBanner session={session} />}

        <main id="main" className={styles.main}>
          <Alerts
            error={session.error}
            notice={session.notice}
            onClearError={() => session.setError("")}
            onClearNotice={() => session.setNotice("")}
          />
          {session.mode === "live" && (
            <CardReturnPanel
              cardReturn={session.cardReturn}
              pendingLookupFailed={session.pendingLookupFailed}
              busy={session.busy}
              onVerify={(id) => void session.finalizeBooking(id)}
              onCancel={(id) => void session.cancelBooking(id)}
              onRetryLookup={session.retryPendingLookup}
            />
          )}
          {content()}
        </main>
      </div>

      <PublicContactActions phoneHref={null} whatsappOnly />
      <nav className={styles.bottomNav} aria-label="Navigation principale">
        {BOTTOM_NAV.map((n) => {
          const current = view === n.id || n.also.includes(view);
          return (
            <button
              type="button"
              key={n.id}
              aria-current={current ? "page" : undefined}
              onClick={() => session.go(n.id)}
            >
              <Icon name={n.icon} size={22} />
              {n.label}
              {n.id === "messages" && received > 0 && (
                <span className={styles.navCount}>
                  <span aria-hidden="true">{received}</span>
                  <span className="sr-only">{`${received} message${received > 1 ? "s" : ""} reçu${received > 1 ? "s" : ""}`}</span>
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
    </ThemeSurface>
  );
}

function RequestList({ session, items }: { session: Session; items: Intervention[] }) {
  return (
    <div className="request-list">
      {items.map((i) => (
        <button
          type="button"
          className="request-row"
          key={i.id}
          onClick={() => session.openIntervention(i.id)}
        >
          <span className={`service-icon ${i.category}`}>
            <Icon name={category(i.category).icon} size={24} />
          </span>
          <span className="request-content">
            <span className="request-title">{category(i.category).label}</span>
            <span className="request-address">
              <Icon name="location" size={13} />
              {i.address ? `${i.address}, ` : ""}
              {i.city}
            </span>
            <span className="request-ref">
              {shortId(i.id)} <span>·</span> {date(i.created_at)}
            </span>
          </span>
          <span className="request-meta">
            <Badge status={i.status} />
            <span className="request-price">
              {i.urgency === "urgent" && <span className="urgent-text">Urgent</span>}
              <RequestAmountLabel value={requestAmount(i, session.data.quotes, session.data.payments, money)} />
            </span>
          </span>
          <Icon name="arrow" size={18} />
        </button>
      ))}
    </div>
  );
}

// ---- Mes demandes --------------------------------------------------------------------
function RequestAmountLabel({ value }: { value: string }) {
  const separator = value.indexOf(" : ");
  if (separator < 0) return <span>{value}</span>;
  return <span className={styles.requestAmount}><small>{value.slice(0, separator)} : </small><strong>{value.slice(separator + 3)}</strong></span>;
}

type RequestFilter = "active" | "all" | "past";
/** Exported for tests only (the live server search wiring). */
export function RequestsView({ session, rows }: { session: Session; rows: Intervention[] }) {
  const [filter, setFilter] = useState<RequestFilter>("active");
  const [search, setSearch] = useState("");
  // Live: server search over ALL the client's requests (not only the cached 100). Demo: local only, zero call.
  const live = session.mode === "live";
  const searchedReference = parseOrderReference(search);
  const searchValue = searchedReference ?? search;
  // Rows are bound to identity + filter + search AT RENDER (never an old frame). A real change of the
  // mounted workspace rows (realtime / focus refresh) triggers a bounded re-read of page 1.
  const remote = useRequestsSearch({ enabled: live, context: session.mutationContext, filter, search: searchValue, signal: live ? rowsSignal(rows) : "" });
  let items = rows.filter(
    (i) =>
      filter === "all" ||
      (filter === "active" && isOpen(i.status)) ||
      (filter === "past" && !isOpen(i.status)),
  );
  const needle = searchValue.trim().toLowerCase();
  if (needle)
    items = items.filter((i) =>
      `${category(i.category).label} ${i.address} ${i.city} ${i.postal_code} ${shortId(i.id)}`
        .toLowerCase()
        .includes(needle),
    );
  if (live) items = toListRows(remote.state.items);
  const settled = !live || remote.state.phase === "ready";
  return (
    <>
      <PageTitle
        title="Mes demandes"
        subtitle="Retrouvez vos interventions et leur avancement, par exemple avec le numéro de commande INT-…"
        action={
          <button type="button" className="button primary" onClick={() => session.go("new")}>
            <Icon name="plus" />
            Nouvelle demande
          </button>
        }
      />
      <div className={styles.listTools}>
        <Segments
          label="Filtrer les demandes"
          value={filter}
          options={[
            ["active", "En cours"],
            ["all", "Toutes"],
            ["past", "Terminées"],
          ]}
          onChange={setFilter}
        />
        <label className={styles.search}>
          <Icon name="search" size={18} />
          <span className="sr-only">Rechercher une intervention</span>
          <input
            type="search"
            placeholder="Rechercher une intervention"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (parseOrderReference(e.target.value)) setFilter("all");
            }}
          />
        </label>
      </div>
      <section className={`panel ${styles.listPanel}`} aria-busy={(live && remote.state.phase === "loading") || undefined} data-requests-search={live ? remote.state.phase : "demo"}>
        {live && (remote.state.phase === "ready" || remote.state.phase === "error") && (
          <button type="button" className="button" disabled={remote.state.refreshing || remote.state.loadingMore} onClick={() => remote.refresh()} data-requests-refresh="">
            {remote.state.refreshing ? "Actualisation…" : "Actualiser"}
          </button>
        )}
        {live && remote.state.phase === "loading" && <p className="muted" role="status">{SEARCH_COPY.loading}</p>}
        {live && remote.state.phase === "forbidden" && <p role="alert">{remote.state.error}</p>}
        {live && remote.state.phase === "error" && (
          <div role="alert">
            <p>{remote.state.error}</p>
            <button type="button" className="button" onClick={() => remote.retry()} data-requests-retry="">Réessayer</button>
          </div>
        )}
        {items.length ? (
          <RequestList session={session} items={items} />
        ) : settled ? (
          <Empty
            title="Aucune demande dans cette liste"
            action={
              <button
                type="button"
                className="button primary"
                onClick={() => session.go("new")}
              >
                Créer une demande
              </button>
            }
          >
            {needle
              ? "Aucune intervention ne correspond à votre recherche."
              : "Vous retrouverez ici les interventions correspondant à ce filtre."}
          </Empty>
        ) : null}
        {live && remote.state.failed === "more" && (
          <div role="alert">
            <p>{remote.state.error}</p>
            <button type="button" className="button" onClick={() => remote.retry()} data-requests-retry="">Réessayer</button>
          </div>
        )}
        {live && remote.state.phase === "ready" && remote.state.cursor && remote.state.failed !== "more" && (
          <button type="button" className="button" disabled={remote.state.loadingMore} onClick={() => remote.more()} data-requests-more="">
            {remote.state.loadingMore ? "Chargement…" : SEARCH_COPY.more}
          </button>
        )}
      </section>
    </>
  );
}

// ---- Détail d’intervention (V8-C07) -------------------------------------------------
function useOperations(session: Session, id: string, dependency: string) {
  const ref = useRef(session);
  ref.current = session;
  // E16 (P1/P6): every explicit refresh of the workspace re-reads the operations of this dossier too
  // (slot, participants), keeping the shown values until the reply.
  const refreshed = session.refreshedAt;
  const [ops, setOps] = useState<Operations | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  // An explicit re-read of the SAME dossier keeps the shown values (and any open form) until the
  // reply arrives; another dossier / dependency starts from the loader.
  const shown = useRef("");
  useEffect(() => {
    let active = true;
    const key = `${id}|${dependency}`;
    if (shown.current !== key) setOps(undefined);
    shown.current = key;
    if (!id) return;
    void ref.current.loadOperations(id).then((result) => {
      if (active) setOps(result);
    });
    return () => {
      active = false;
    };
  }, [id, dependency, version, refreshed]);
  return { ops, reload: () => setVersion((v) => v + 1) };
}

function DetailView({
  session,
  rows,
  id,
}: {
  session: Session;
  rows: Intervention[];
  id: string;
}) {
  const i = rows.find((x) => x.id === id);
  const demo = session.mode === "demo";
  const [keptDraft, setKeptDraft] = useState<string | null>(null);
  const { ops, reload } = useOperations(
    session,
    i?.id || "",
    `${i?.status || ""}|${i?.updated_at || ""}|${i?.travel_stage || ""}|${session.mode}`,
  );
  // Deep link to a dossier absent from the cached workspace: one causal refresh before « introuvable ».
  const presence = useDetailPresence(session, "client-detail", id, Boolean(i));
  // Booking dossier (POST /api/bookings): its payment mode comes from the server status; the
  // legacy Stripe checkout is offered only for a proven legacy dossier (404). Hooks stay BEFORE any
  // early return (deep link: absent → present must not change the hook order). Keyed by job + UID:
  // reset to null at once on any change, a late reply for another key is ignored.
  const statusKey = i && !demo ? `${session.profileId}|${i.id}` : "";
  const [bookingStatus, setBookingStatus] = useState<{ key: string; value: BookingStatus } | null>(null);
  useEffect(() => {
    if (!statusKey) return;
    let active = true;
    const jobId = statusKey.slice(statusKey.indexOf("|") + 1);
    void fetchBookingStatus(jobId).then((value) => {
      if (active) setBookingStatus({ key: statusKey, value });
    });
    return () => {
      active = false;
    };
  }, [statusKey]);
  const currentBookingStatus = bookingStatus && bookingStatus.key === statusKey ? bookingStatus.value : null;
  if (!i) {
    if (presence.decision === "loading") return <Loader label="Recherche du dossier…" />;
    if (presence.decision === "detail" || presence.decision === "detail_loading" || presence.decision === "detail_error")
      return (
        <>
          <PointReadState presence={presence} backLabel="Mes demandes" onBack={() => session.go("requests")} bookingLocationContext={session.refreshContext} />
          {/* PUB-06: warranty follow-up of an authorized out-of-cache paid dossier (exact id). */}
          {presence.decision === "detail" && presence.detail?.intervention.status === "paid" && (
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
  if (!i)
    return (
      <Empty
        level={1}
        title={presence.openAnyway ? "Dossier absent de vos demandes récentes" : "Intervention introuvable"}
        action={
          <>
            <button type="button" className="button primary" onClick={() => session.go("requests")}>
              Voir mes demandes
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
          ? "Ce dossier n’apparaît pas parmi vos demandes chargées. Vous pouvez essayer de l’ouvrir directement."
          : "Ce dossier n’existe pas dans votre espace ou son lien n’est plus valide."}
      </Empty>
    );
  const quotes = session.data.quotes;
  const shown = pickQuote(quotes, i.id, session.selectedQuoteId || undefined) || pickQuote(quotes, i.id);
  const versions = quoteVersions(quotes, i.id);
  const accepted = versions.find((q) => q.status === "accepted");
  const payment = accepted
    ? session.data.payments.find((p) => p.quote_id === accepted.id)
    : undefined;
  const participants = ops?.participants || [];
  const artisan = participants.find((p) => p.role === "artisan");
  const photos = session.data.documents.filter(
    (d) => d.intervention_id === i.id && d.mime_type.startsWith("image/"),
  );
  const reviewPhotos = photos.filter((d) => reviewImage(d.mime_type));
  const stepIndex = currentStepIndex(i.status, i.paid_at);
  const canSchedule = ["assigned", "quoted", "accepted"].includes(i.status);
  const travelStage = ops?.travel_stage || i.travel_stage || "planned";
  const opsState = session.capabilities.operations;

  const history = detailHistory(
    i,
    { quoteReceivedAt: shown?.created_at, quoteAcceptedAt: accepted?.accepted_at, appointmentStartsAt: ops?.appointment?.starts_at },
    dateTime,
  );

  const primary = (() => {
    if (i.status === "quoted" && shown)
      return (
        <button
          type="button"
          className="button primary"
          onClick={() => session.go("quote", shown.id)}
        >
          <Icon name="document" />
          Consulter le devis
        </button>
      );
    if (i.status === "completed" && !demo && currentBookingStatus?.kind !== "legacy") {
      // The legacy Stripe checkout is offered ONLY for a proven legacy dossier (status 404).
      // Booking dossier, status loading, 503 or malformed ⇒ never the old checkout.
      if (currentBookingStatus?.kind === "unavailable")
        return (
          <Unavailable
            title="Statut de règlement momentanément indisponible"
            reason="Nous n’avons pas pu vérifier le mode de règlement de ce dossier. Aucun paiement n’est proposé tant que ce n’est pas vérifié ; réessayez dans un instant."
          />
        );
      return null;
    }
    if (i.status === "completed") {
      if (!accepted)
        return (
          <Unavailable
            title="Règlement impossible"
            reason="Aucun devis accepté n’est rattaché à cette intervention ; le montant à régler n’est pas déterminé."
          />
        );
      return (
        <PlatformPayAction
          demo={demo}
          busy={session.busy}
          busyLabel="Veuillez patienter…"
          onPay={() => (demo ? void session.action(i.id, "simulate_payment") : void session.checkout(accepted.id))}
          reminder={demo ? undefined : { quoteId: accepted.id, context: session.mutationContext }}
        />
      );
    }
    return null;
  })();

  return (
    <>
      <PageTitle
        title="Détail de l’intervention"
        subtitle={`${category(i.category).label} — créée le ${date(i.created_at)}`}
        back={{ label: "Retour aux demandes", onClick: () => session.go("requests") }}
      />

      <section className={styles.statusCard} aria-labelledby="status-title">
        <div className={styles.statusMain}>
          <span>
            <Icon name="list" size={24} />
          </span>
          <div>
            <small>Statut</small>
            <strong id="status-title">{STATUS[i.status]}</strong>
            <span>Numéro de commande · {shortId(i.id)}</span>
          </div>
        </div>
        {i.status === "cancelled" ? (
          <p className={styles.description}>Cette demande a été annulée. Aucune étape n’est à venir.</p>
        ) : (
          <ol className={styles.stepper} aria-label="Avancement">
            {CLIENT_STEPS.map((step, index) => {
              const state = index < stepIndex ? "done" : index === stepIndex ? "current" : "";
              return (
                <li key={step.label} className={state ? styles[state] : ""}>
                  <span aria-hidden="true">
                    {state === "done" ? <Icon name="check" size={15} /> : index + 1}
                  </span>
                  {step.label}
                  {state === "current" && <span className="sr-only"> (étape actuelle)</span>}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {primary && <div className={styles.actionBar}>{primary}</div>}
      {/* On-site booking, completed or paid: the cash widget carries the state (planned / declared);
          the generic « aucun encaissement » line would contradict a declaration, so it is not shown. */}
      {currentBookingStatus?.kind === "booking" && currentBookingStatus.payment.method === "on_site" && (i.status === "completed" || i.status === "paid") && (
        <OnsiteSettlement
          key={`${session.profileId}|${i.id}`}
          interventionId={i.id}
          viewer="client"
          context={session.mutationContext}
          onSettled={i.status === "paid" ? undefined : () => void session.refresh()}
          onPay={!demo && accepted && i.status === "completed" ? () => void session.checkout(accepted.id) : undefined}
          busy={session.busy}
        />
      )}
      {currentBookingStatus?.kind === "booking" && !(currentBookingStatus.payment.method === "on_site" && (i.status === "completed" || i.status === "paid")) && (
        <p className={styles.paymentLine} role="status" data-booking-payment-status={currentBookingStatus.payment.method}>
          <Icon name={currentBookingStatus.payment.method === "on_site" ? "clock" : "lock"} size={16} />
          <span>{bookingPaymentText(currentBookingStatus.payment, dateTime)}</span>
        </p>
      )}
      {/* Final settlement of a card hold: only a completed booking dossier with an accepted quote.
          The amount, ledger and proofs are the server's; never the legacy Checkout for a hold. */}
      {currentBookingStatus?.kind === "booking" && currentBookingStatus.payment.method === "card_hold" && (i.status === "completed" || i.status === "paid") && accepted && (
        <BookingSettlement
          key={`${session.profileId}|${i.id}`}
          interventionId={i.id}
          context={session.mutationContext}
          // Re-read the workspace (fresh barrier) once the server reports « paid »; only while the
          // dossier itself is not « paid » yet (no loop, stale dossier corrected).
          onSettled={i.status === "paid" ? undefined : () => void session.refresh()}
        />
      )}
      {accepted && payment && (
        <p
          className={`${styles.paymentLine} ${payment.status === "paid" ? styles.ok : payment.status === "failed" ? styles.ko : ""}`}
          role="status"
        >
          <Icon name={payment.status === "paid" ? "check" : payment.status === "failed" ? "warning" : "clock"} size={16} />
          <span>
            {payment.status === "paid" && isDeclaredOnSite(payment)
              ? `Règlement de ${money(payment.total_cents)} déclaré reçu sur place par l’artisan${payment.paid_at ? ` le ${dateTime(payment.paid_at)}` : ""}. Ce n’est pas une confirmation bancaire.`
              : payment.status === "paid"
              ? `Règlement de ${money(payment.total_cents)} confirmé par la plateforme${payment.paid_at ? ` le ${dateTime(payment.paid_at)}` : ""}.`
              : payment.status === "failed"
                ? "Le paiement n’a pas abouti selon Stripe. Le règlement reste à effectuer ; vérifiez auprès de votre banque avant de recommencer."
                : "Paiement en attente de confirmation Stripe. Rien n’est considéré comme réglé tant que la plateforme ne l’a pas confirmé."}
          </span>
        </p>
      )}

      <div className={styles.cardHead}>
        <h2>
          <Icon name="person" size={20} />
          Artisan assigné
        </h2>
        <button type="button" className="button outline" onClick={() => session.go("messages")}>
          <Icon name="message" size={17} />
          Contacter
        </button>
      </div>
      <section className={styles.card}>
        {ops === undefined && i.artisan_id ? (
          <Loader label="Chargement des coordonnées…" />
        ) : artisan ? (
          <div className={styles.artisanRow}>
            <span aria-hidden="true">{initials(artisan.full_name) || "A"}</span>
            <div>
              <strong>{artisan.full_name}</strong>
              {artisan.phone ? (
                <a href={`tel:${artisan.phone.replace(/[^+\d]/g, "")}`}>
                  <Icon name="phone" size={16} />
                  {artisan.phone}
                </a>
              ) : (
                <span className="subtle">Téléphone non communiqué</span>
              )}
              {demo && <DemoNote>Artisan de démonstration, coordonnées fictives.</DemoNote>}
            </div>
          </div>
        ) : !i.artisan_id ? (
          <p className={styles.description}>
            Coordonnées disponibles après attribution. Votre demande attend qu’un artisan
            éligible l’accepte ; aucun délai n’est garanti.
          </p>
        ) : ops === null ? (
          <Unavailable
            title="Coordonnées de l’artisan indisponibles"
            state={opsState}
            blocker="API operations (participants)"
          />
        ) : (
          <p className={styles.description}>Coordonnées disponibles après attribution.</p>
        )}
      </section>

      <div className={styles.cardHead}>
        <h2>
          <Icon name="location" size={20} />
          Adresse de l’intervention
        </h2>
      </div>
      <section className={`${styles.card} ${styles.addressCard}`}>
        <address>
          {i.address}
          <br />
          {i.postal_code} {i.city}
        </address>
        {!demo && i.client_id === session.profileId && (
          <dl>
            <BookingLocationRows key={`${session.refreshContext}|${i.id}|${i.updated_at}`} interventionId={i.id} />
          </dl>
        )}
        <DossierMapPanel
          key={`${i.id}:${session.mode}:${session.profileId}`}
          address={{ address: i.address, postal_code: i.postal_code, city: i.city }}
          // The « Suivi de l’artisan » card below renders the map for accepted / in_progress dossiers
          // (same condition as its TrackingAnchor): no second map and no second tracking read here.
          trackingCardShown={["accepted", "in_progress"].includes(i.status)}
          tracking={null}
          trackingState={session.capabilities.tracking}
        />
      </section>

      <div className={styles.cardHead}>
        <h2>
          <Icon name="document" size={20} />
          Description du problème
        </h2>
      </div>
      <section className={styles.card}>
        <p className={styles.description}>{i.description}</p>
        <div className={styles.tagRow}>
          <Tag tone="blue">Catégorie : {category(i.category).label}</Tag>
          <Tag tone={i.urgency === "urgent" ? "amber" : "neutral"}>
            {i.urgency === "urgent" ? "Demande urgente" : "Intervention à planifier"}
          </Tag>
          <Tag>
            Estimation indicative : {money(i.estimate_min_cents)} – {money(i.estimate_max_cents)}
          </Tag>
        </div>
      </section>
      <DossierHelpLink session={session} interventionId={i.id} />

      <div className={styles.cardHead}>
        <h2>
          <Icon name="camera" size={20} />
          Photos {photos.length ? `(${photos.length})` : ""}
        </h2>
        <button type="button" className="text-button" onClick={() => session.go("documents")}>
          Gérer les pièces <Icon name="arrow" size={15} />
        </button>
      </div>
      <section className={styles.card}>
        {photos.length ? (
          <ul className={styles.fileList}>
            {photos.map((d) => (
              <li key={d.id}>
                <Icon name="camera" size={18} />
                <span>
                  {d.name} <span className="subtle">— {date(d.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.description}>Aucune photo jointe.</p>
        )}
        <p className="form-note">
          Le téléchargement sécurisé des pièces se fait depuis la page Documents.
        </p>
        {/* SYS-10: photo review (consent, request / withdraw; result only after the artisan's validation). */}
        {reviewPhotos.length > 0 && i.artisan_id && !i.site_id && i.status !== "cancelled" && (
          <PhotoReviewPanel key={`${i.id}|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}`} interventionId={i.id} role="client" photos={reviewPhotos.map((d) => ({ id: d.id, name: d.name }))} context={session.mutationContext} demo={session.mode === "demo"} />
        )}
        {photos.length > 0 && i.artisan_id && i.status !== "cancelled" && (
          <button type="button" className="button outline" onClick={() => session.go("messages", i.id)}>
            <Icon name="message" />
            Parler des photos avec mon artisan
          </button>
        )}
      </section>

      <div className={styles.cardHead}>
        <h2>
          <Icon name="euro" size={20} />
          Devis &amp; résumé
        </h2>
      </div>
      <section className={styles.card}>
        {shown ? (
          <>
            <div className={styles.lines}>
              {shown.lines.map((l, index) => (
                <div key={index}>
                  <span>
                    {l.label}
                    <small>
                      {l.quantity} × {money(l.unit_price_cents)} HT
                    </small>
                  </span>
                  <span>{money(Math.round(l.quantity * l.unit_price_cents))}</span>
                </div>
              ))}
            </div>
            <div className={styles.totals}>
              <div>
                <span>Sous-total HT</span>
                <span>{money(shown.subtotal_cents)}</span>
              </div>
              <div>
                <span>TVA ({taxRateLabel(shown.tax_rate)})</span>
                <span>{money(shown.tax_cents)}</span>
              </div>
              <div className={styles.grand}>
                <span>Total TTC</span>
                <strong>{money(shown.total_cents)}</strong>
              </div>
            </div>
            <div className={styles.quoteFoot}>
              <p>
                <Icon name="info" size={15} />
                {shown.status === "accepted" && shown.accepted_at
                  ? `Devis accepté le ${dateTime(shown.accepted_at)}`
                  : shown.status === "sent"
                    ? `Devis reçu le ${dateTime(shown.created_at)}, en attente de votre décision`
                    : `Version du ${dateTime(shown.created_at)} — ${quoteStatusLabel(shown)}`}
              </p>
              <button
                type="button"
                className="button outline"
                onClick={() => session.go("quote", shown.id)}
              >
                <Icon name="document" size={17} />
                Voir le devis
              </button>
            </div>
            {versions.length > 1 && (
              <label className={styles.inlineSelect}>
                Version affichée
                <select
                  value={shown.id}
                  onChange={(e) => session.openIntervention(i.id, e.target.value)}
                >
                  {versions.map((q, index) => (
                    <option key={q.id} value={q.id}>
                      Version {index + 1} — {dateTime(q.created_at)} — {quoteStatusLabel(q)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {demo && <DemoNote>Montants et taux de TVA de démonstration.</DemoNote>}
          </>
        ) : (
          <p className={styles.description}>
            {["requested", "assigned"].includes(i.status)
              ? "Aucun devis pour le moment. L’artisan le prépare après attribution ; vous le validerez avant toute intervention."
              : "Aucun devis rattaché à ce dossier."}
          </p>
        )}
      </section>

      <div className={styles.cardHead}>
        <h2>
          <Icon name="calendar" size={20} />
          Rendez-vous
        </h2>
      </div>
      <section className={styles.card}>
        {ops === undefined ? (
          <Loader label="Chargement du rendez-vous…" />
        ) : ops === null ? (
          <Unavailable
            title="Rendez-vous indisponible"
            state={opsState}
            blocker="API operations (appointment)"
          />
        ) : (
          <>
            {ops.appointment ? (
              <div className={styles.appointment}>
                <strong>
                  {dateTime(ops.appointment.starts_at)} – {dateTime(ops.appointment.ends_at)}
                </strong>
                {ops.appointment.note && <span>{ops.appointment.note}</span>}
                {ops.appointment.updated_at && (
                  <span className="subtle">
                    Mis à jour le {dateTime(ops.appointment.updated_at)}
                  </span>
                )}
              </div>
            ) : (
              <p className={styles.description}>Aucun créneau proposé pour le moment.</p>
            )}
            {/* E16: a refresh or a new slot revision remounts the reminder ⇒ it is re-read. */}
            <Fragment key={`${session.refreshedAt}|${ops.appointment?.reminder_version ?? 0}`}>
            <AppointmentReminderPanel
              key={`${i.id}|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}`}
              interventionId={i.id}
              role="client"
              context={session.mutationContext}
              demo={session.mode === "demo"}
            />
            </Fragment>
            {canSchedule ? (
              <AppointmentForm
                key={keptDraft ?? (ops.appointment?.updated_at || "new")}
                initial={ops.appointment}
                version={slotVersion(ops.appointment)}
                busy={session.busy}
                onSubmit={async (starts_at, ends_at, note) => {
                  const formKey = ops.appointment?.updated_at || "new";
                  const saved = await session.operate(i.id, {
                    action: "save_appointment",
                    expected_version: slotVersion(ops.appointment),
                    starts_at,
                    ends_at,
                    note,
                  });
                  // Refused (409 version, rights…): re-read the slot, keep the typed form (E15).
                  setKeptDraft(saved ? null : formKey);
                  reload();
                  return saved;
                }}
              />
            ) : (
              <p className="form-note">
                {["requested"].includes(i.status)
                  ? "Le créneau se fixe une fois un artisan attribué."
                  : "Le créneau ne peut plus être modifié : l’intervention a démarré ou est clôturée."}
              </p>
            )}
          </>
        )}
      </section>

      {["accepted", "in_progress"].includes(i.status) && (
        <>
          <div className={styles.cardHead}>
            <h2>
              <Icon name="truck" size={20} />
              Déplacement
            </h2>
          </div>
          <section className={styles.card}>
            <p className={styles.travelLine}>
              <Icon name="navigate" size={18} />
              {TRAVEL_STAGE[travelStage]}
            </p>
            <p className="form-note">
              {session.capabilities.tracking === "available"
                ? "Étape déclarée par l’artisan. La position n’apparaît que s’il la partage ; l’heure d’arrivée reste indicative."
                : "Étape déclarée par l’artisan. Aucune géolocalisation ni heure d’arrivée estimée n’est disponible."}
            </p>
          </section>
          <div id="client-dossier-tracking" tabIndex={-1}>
            <TrackingAnchor session={session} variant="viewer" interventionId={i.id} authority={{ canWrite: true }} />
          </div>
        </>
      )}

      {ops?.report && (
        <>
          <div className={styles.cardHead}>
            <h2>
              <Icon name="receipt" size={20} />
              Compte rendu
            </h2>
          </div>
          <section className={styles.card}>
            <p className={styles.description}>{ops.report.summary}</p>
            {ops.report.checks.length > 0 && (
              <ul className={styles.checks}>
                {ops.report.checks.map((c, index) => (
                  <li key={index}>
                    <span>{c.label}</span>
                    <Tag
                      tone={
                        c.result === "pass" ? "green" : c.result === "issue" ? "amber" : "neutral"
                      }
                    >
                      {c.result === "pass"
                        ? "Conforme"
                        : c.result === "issue"
                          ? "Point à traiter"
                          : "Sans objet"}
                    </Tag>
                  </li>
                ))}
              </ul>
            )}
            <p className="form-note">
              {reportDeclarant(ops.report.signature_name, ops.report.updated_at ? dateTime(ops.report.updated_at) : undefined)}
            </p>
            {/* E59/E60: before/after photos and the requester's acknowledgement of this revision. */}
            <ReportEvidenceSummary ops={ops} report={ops.report} photos={dossierPhotos(session.data.documents, i.id, i.artisan_id)} declarant={false} receiptVisible={i.client_id === session.profileId} openContext={demo ? undefined : session.mutationContext} />
            {!demo && canSignReport(ops, i.status, i.client_id === session.profileId) && (
              <ReportReceiptForm
                key={`${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${i.id}|${ops.report.report_revision}`}
                scope={`${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${i.id}`}
                revision={ops.report.report_revision}
                busy={session.busy}
                onSign={async (values) => {
                  const ok = await session.operate(i.id, { action: "sign_report", ...values });
                  // Success or refusal (409 revision changed, rights…): the dossier is re-read.
                  reload();
                  return ok;
                }}
              />
            )}
          </section>
        </>
      )}

      <div className={styles.cardHead}>
        <h2>
          <Icon name="clock" size={20} />
          Historique &amp; avancement
        </h2>
      </div>
      <section className={styles.card}>
        <ol className={styles.history}>
          {history.map((h) => (
            <li key={h.label} className={h.state !== "upcoming" ? styles[h.state] : ""}>
              <span aria-hidden="true">
                {h.state === "done" ? (
                  <Icon name="check" size={14} />
                ) : (
                  <Icon name={h.state === "current" ? "clock" : "dots"} size={14} />
                )}
              </span>
              <div>
                <strong>{h.label}</strong>
                <small>{h.when}</small>
              </div>
              <span>
                {h.state === "done" ? "Terminé" : h.state === "current" ? i.status === "accepted" ? "À préparer" : i.status === "completed" ? "À régler" : "En cours" : "À venir"}
              </span>
            </li>
          ))}
        </ol>
        <p className="form-note">
          Seules les dates enregistrées sur la plateforme sont affichées ; « — » signifie qu’aucun
          horodatage n’existe pour cette étape.
        </p>
      </section>

      {/* Invoices / credit notes issued for THIS dossier (customer routes only; issuing ≠ payment). */}
      {(i.status === "completed" || i.status === "paid") && (
        <CustomerInvoicesPanel title="Factures et avoirs de ce dossier" filters={{ intervention_id: i.id, basis: "service" }} context={session.mutationContext} demo={demo} />
      )}

      <div className={styles.actionBar}>
        {["requested", "assigned", "quoted"].includes(i.status) ? (
          <ConfirmAction
            label="Annuler la demande"
            message="Annuler cette demande ? Cette action ne peut pas être annulée."
            confirmLabel="Confirmer l’annulation"
            busy={session.busy}
            danger
            className={`button outline ${styles.cancelButton}`}
            onConfirm={() => session.action(i.id, "cancel")}
          />
        ) : (
          <span />
        )}
      </div>

      {i.status === "paid" && (
        <>
          <ReviewForm
            existing={session.data.reviews.find((r) => r.intervention_id === i.id)}
            enabled
            busy={session.busy}
            onSubmit={async (values) => {
              await session.submitReview(i.id, values);
            }}
          />
          <WarrantyPanel interventionId={i.id} demo={demo} role={session.role} context={session.mutationContext} ownerId={i.client_id} />
        </>
      )}
      <UploadQueuePanel session={session} interventionId={i.id} />
    </>
  );
}

/** Expected version of the next slot save: the server revision read, 0 when no slot exists. */
const slotVersion = (a: Operations["appointment"]) => (a ? a.reminder_version ?? 0 : 0);
export const SLOT_CONFLICT =
  "Le créneau a été modifié entre-temps : la version actuelle est affichée ci-dessus. Votre saisie est conservée ; enregistrez à nouveau pour la confirmer.";

function AppointmentForm({
  initial,
  version,
  busy,
  onSubmit,
}: {
  initial: Operations["appointment"];
  version: number;
  busy: boolean;
  onSubmit: (starts_at: string, ends_at: string, note: string) => Promise<boolean>;
}) {
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  const initialDuration = initial
    ? Math.min(
        4,
        Math.max(
          1,
          Math.round((Date.parse(initial.ends_at) - Date.parse(initial.starts_at)) / 3600000) || 1,
        ),
      )
    : 2;
  const [start, setStart] = useState(initial ? toLocalInput(initial.starts_at) : "");
  const [duration, setDuration] = useState(initialDuration);
  const [note, setNote] = useState(initial?.note || "");
  const [error, setError] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const begins = new Date(start);
    if (!start || Number.isNaN(begins.getTime())) {
      setError("Indiquez la date et l’heure de début du créneau.");
      return;
    }
    if (begins.getTime() < Date.now() - 60000) {
      setError("Le créneau doit se situer dans le futur.");
      return;
    }
    setError("");
    const ends = new Date(begins.getTime() + duration * 3600000);
    const sentVersion = version;
    void onSubmit(begins.toISOString(), ends.toISOString(), note.trim()).then((ok) => setRefusedAt(ok ? null : sentVersion));
  }
  const conflict = refusedAt !== null && refusedAt !== version;
  return (
    <form className={styles.appointmentForm} onSubmit={submit} noValidate>
      <h3>{initial ? "Modifier le créneau" : "Proposer un créneau"}</h3>
      <div className={styles.formGrid}>
        <Field label="Début du créneau" error={error || undefined}>
          <input
            type="datetime-local"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Durée">
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[1, 2, 3, 4].map((h) => (
              <option key={h} value={h}>
                {h} h
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Précision (facultatif)" hint="Code d’accès, étage, disponibilité…">
        <input
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Par exemple : interphone au nom de Dupont, 3e étage"
        />
      </Field>
      {conflict && (
        <p className="form-note" role="alert" data-slot-conflict="">
          {SLOT_CONFLICT}
        </p>
      )}
      <button type="submit" className="button outline" disabled={busy}>
        <Icon name="calendar" size={17} />
        {busy ? "Enregistrement…" : initial ? "Enregistrer le nouveau créneau" : "Proposer ce créneau"}
      </button>
      <p className="form-note">
        Le créneau proposé doit être confirmé avec l’artisan ; il ne constitue pas un engagement
        d’horaire.
      </p>
    </form>
  );
}

// ---- Devis (V8-C06) -----------------------------------------------------------------
/** Exported for tests only (live exact quote read). */
/** E13: validity of this exact quote from the quote documents read. Live acceptance needs a
 *  CONFIRMED state: « valid » (valid or not specified, from a successful read of this quote). While
 *  the read runs it is « checking »; a refusal, failure or a reply without this quote is « unknown »;
 *  a passed validity is « expired ». Demo (quoteId "") is not gated: « valid ». */
type QuoteValidity = "checking" | "valid" | "expired" | "unknown";
function useQuoteValidity(session: Session, quoteId: string): { validity: QuoteValidity; retry: () => void } {
  const [state, setState] = useState<{ key: string; validity: QuoteValidity } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = quoteId ? `${session.profileId}|${session.mutationContext.generation()}|${quoteId}` : "";
  const client = useRef(session.features.quoteDocuments);
  client.current = session.features.quoteDocuments;
  useEffect(() => {
    if (!key) return;
    let active = true;
    setState({ key, validity: "checking" });
    void Promise.resolve()
      .then(() => client.current.load({ quoteId }))
      .then((overview) => {
        const q = overview?.quotes.find((x) => x.id === quoteId);
        const validity: QuoteValidity = !q ? "unknown" : q.terms?.validity === "expired" ? "expired" : "valid";
        if (active) setState({ key, validity });
      })
      .catch(() => {
        if (active) setState({ key, validity: "unknown" });
      });
    return () => {
      active = false;
    };
  }, [key, quoteId, attempt]);
  const validity: QuoteValidity = !key ? "valid" : state && state.key === key ? state.validity : "checking";
  return { validity, retry: () => setAttempt((n) => n + 1) };
}
export function QuoteView({
  session,
  rows,
  quoteId,
}: {
  session: Session;
  rows: Intervention[];
  quoteId: string;
}) {
  // Live (CLI-08): the EXACT quote by id from GET /api/quotes/<id> (deep link, old versions outside
  // the caches); no substitute, no cache fallback. Demo: cache path unchanged, zero call.
  const live = session.mode === "live";
  const point = useRecipientQuote({ enabled: live, context: session.mutationContext, quoteId, scope: null });
  const server = live && point.state.phase === "ready" ? point.state.data : null;
  const cachedQuote = session.data.quotes.find((q) => q.id === quoteId);
  const cachedI = cachedQuote ? rows.find((x) => x.id === cachedQuote.intervention_id) : undefined;
  const quote: Quote | undefined = live ? (server ? (server.quote as unknown as Quote) : undefined) : cachedQuote;
  const i: Pick<Intervention, "id" | "category" | "status" | "artisan_id"> | undefined = live
    ? server
      ? { id: server.intervention.id, category: server.intervention.category, status: server.intervention.status, artisan_id: server.quote.artisan_id }
      : undefined
    : cachedI;
  const demo = session.mode === "demo";
  const { ops } = useOperations(session, i?.id || "", `${i?.status || ""}|${session.mode}`);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const quoteValidity = useQuoteValidity(session, live ? quoteId : "");
  const expired = quoteValidity.validity === "expired";
  if (live && point.state.phase !== "ready")
    return (
      <section className="panel" data-quote-point={point.state.phase}>
        {point.state.phase === "loading" || point.state.phase === "idle" ? (
          <p className="muted" role="status">{QUOTES_COPY.loadingOne}</p>
        ) : point.state.phase === "forbidden" ? (
          <Empty
            icon="document"
            title="Devis introuvable"
            action={
              <button type="button" className="button primary" onClick={() => session.go("documents")}>
                Voir mes documents
              </button>
            }
          >
            {point.state.error}
          </Empty>
        ) : (
          <div role="alert">
            <p>{point.state.error}</p>
            <button type="button" className="button outline" onClick={() => point.retry()}>Réessayer</button>
          </div>
        )}
      </section>
    );
  if (!quote || !i)
    return (
      <Empty
        icon="document"
        title="Devis introuvable"
        action={
          <button type="button" className="button primary" onClick={() => session.go("documents")}>
            Voir mes documents
          </button>
        }
      >
        Ce devis n’existe pas dans votre espace ou son lien n’est plus valide.
      </Empty>
    );
  // Live: the EXISTING rule (quoteDecisionState) applied to the exact point read. Decidable only when
  // ALL hold: client role, exact quote « sent », is_current AND current_quote_id === quote.id, exact
  // dossier « quoted », and the read belongs to this render's key (identity + quote). is_current alone
  // is never enough; the server stays the guard for validity and races.
  const current = live ? undefined : pickQuote(session.data.quotes, i.id);
  const exactCurrent =
    server && server.version.is_current && server.version.current_quote_id === server.quote.id ? { id: server.version.current_quote_id, status: server.quote.status } : undefined;
  const liveDecidable =
    !!server && session.role === "client" && point.state.phase === "ready" && server.quote.id === quoteId && server.quote.status === "sent" && !!exactCurrent && server.intervention.status === "quoted";
  const decision = live
    ? liveDecidable
      ? quoteDecisionState(server!.quote, exactCurrent, server!.intervention.status)
      : quote.status === "accepted"
        ? "accepted"
        : quote.status === "rejected" || !server!.version.is_current
          ? "superseded"
          : "closed"
    : quoteDecisionState(quote, current, i.status);
  // E13: a quote whose recorded validity has passed is never offered for acceptance (the server
  // refuses it with 409 anyway); the documents read is the source of the validity.
  const isActive = decision === "active" && quoteValidity.validity === "valid";
  const superseded = decision === "superseded";
  const currentId = live ? server!.version.current_quote_id : current?.id ?? null;
  const refreshAfter = () => {
    // Server-confirmed action: re-read the exact quote (no local patch).
    if (live) point.refresh();
  };
  const artisan = ops?.participants.find((p) => p.role === "artisan");

  return (
    <>
      <PageTitle
        title={`Devis ${quoteRef(quote.id)}`}
        subtitle={`Reçu le ${dateTime(quote.created_at)} — ${category(i.category).label}, ${shortId(i.id)}`}
        back={{ label: "Retour au dossier", onClick: () => session.openIntervention(i.id, quote.id) }}
      />
      {/* ENT-13: contract source only when the server states it. */}
      <ContractSourceLine key={quote.id} quoteId={quote.id} demo={session.mode === "demo"} />
      <div className={styles.quoteNote}>
        <Icon name="shield" size={26} />
        <div>
          <strong>Vérifiez avant d’accepter</strong>
          <p>
            Prenez le temps de vérifier les prestations et le montant avant d’accepter. Le devis
            accepté devient la base du règlement, après intervention.
          </p>
        </div>
      </div>

      {superseded && (
        <div className="alert warning" role="status">
          <Icon name="info" />
          <span>
            Cette version n’est plus active.{" "}
            {currentId && currentId !== quote.id ? (
              <button
                type="button"
                className="text-button"
                onClick={() => session.go("quote", currentId)}
                data-quote-current={currentId}
              >
                Voir la version actuelle
              </button>
            ) : (
              "Aucune autre version n’est disponible pour ce dossier."
            )}
          </span>
        </div>
      )}

      <div className={styles.cardHead}>
        <h2>
          <Icon name="document" size={20} />
          Détail du devis
        </h2>
        <button
          type="button"
          className={`text-button ${styles.linkTarget}`}
          onClick={() =>
            document.getElementById("quote-documents")?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        >
          <Icon name="download" size={16} />
          Télécharger le devis (PDF)
        </button>
      </div>
      <table className={styles.quoteTable}>
        <caption className="sr-only">Détail du devis {quoteRef(quote.id)}</caption>
        <thead>
          <tr>
            <th scope="col">Prestation</th>
            <th scope="col">Quantité × PU HT</th>
            <th scope="col">Prix</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((l, index) => {
            const cells = quoteLineCells(l, money);
            return (
              <tr key={index}>
                <td>{l.label}</td>
                <td>{cells.unit}</td>
                <td>{money(cells.total_cents)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Sous-total HT</td>
            <td>{money(quote.subtotal_cents)}</td>
          </tr>
          <tr>
            <td colSpan={2}>TVA ({taxRateLabel(quote.tax_rate)})</td>
            <td>{money(quote.tax_cents)}</td>
          </tr>
          <tr className={styles.grand}>
            <td colSpan={2}>Total TTC</td>
            <td>{money(quote.total_cents)}</td>
          </tr>
        </tfoot>
      </table>
      {demo && <DemoNote>Montants et taux de TVA de démonstration, sans valeur contractuelle.</DemoNote>}

      <div className={styles.cardHead}>
        <h2>
          <Icon name="person" size={20} />
          Artisan
        </h2>
      </div>
      <section className={styles.card}>
        <div className={styles.artisanRow}>
          <span aria-hidden="true">{artisan ? initials(artisan.full_name) || "A" : "A"}</span>
          <div>
            <strong>{artisan ? artisan.full_name : "Artisan attribué"}</strong>
            <span className="subtle">
              {artisan
                ? "Artisan électricien ayant établi ce devis"
                : i.artisan_id
                  ? "Nom disponible une fois les coordonnées chargées"
                  : "Attribution en attente"}
            </span>
          </div>
          <button
            type="button"
            className="button outline"
            style={{ marginLeft: "auto" }}
            onClick={() => session.go("messages")}
          >
            <Icon name="message" size={17} />
            Contacter
          </button>
        </div>
      </section>

      {isActive ? (
        <div className={styles.quoteActions}>
          <button
            type="button"
            className="button primary large"
            disabled={session.busy}
            onClick={() => void session.action(i.id, "accept_quote", { quote_id: quote.id }).then(refreshAfter)}
          >
            <Icon name="check" />
            {session.busy ? "Enregistrement…" : "Accepter le devis"}
          </button>
          <button
            type="button"
            className="button outline large"
            disabled={session.busy}
            aria-expanded={rejecting}
            aria-controls="reject-quote"
            onClick={() => setRejecting(!rejecting)}
          >
            <Icon name="close" />
            Refuser
          </button>
        </div>
      ) : (
        <p className="form-note" style={{ marginTop: 14 }}>
          {quote.status === "accepted"
            ? `Devis accepté${quote.accepted_at ? ` le ${dateTime(quote.accepted_at)}` : ""}. Il sert de base au règlement après intervention.`
            : superseded
              ? live
                ? QUOTES_COPY.readOnly
                : "Ce devis ne peut plus être accepté ni refusé."
              : expired && decision === "active"
                ? "Ce devis ne peut plus être accepté : sa validité est dépassée. L’artisan peut en envoyer une nouvelle version."
                : quoteValidity.validity === "checking" && decision === "active"
                  ? "Vérification de la validité du devis…"
                  : quoteValidity.validity === "unknown" && decision === "active"
                    ? "La validité de ce devis n’a pas pu être vérifiée : aucune décision n’est possible pour le moment."
                    : "Ce devis n’attend plus de décision de votre part."}
          {quoteValidity.validity === "unknown" && decision === "active" && (
            <>
              {" "}
              <button type="button" className="text-button" onClick={quoteValidity.retry} data-quote-validity-retry="">
                Réessayer
              </button>
            </>
          )}
        </p>
      )}
      {rejecting && isActive && (
        <form
          id="reject-quote"
          className={styles.rejectForm}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length < 5) {
              setReasonError("Indiquez le motif du refus (au moins 5 caractères).");
              return;
            }
            setReasonError("");
            void session
              .operate(i.id, { action: "reject_quote", quote_id: quote.id, reason: reason.trim() })
              .finally(refreshAfter)
              .then((saved) => {
                if (saved) {
                  setRejecting(false);
                  setReason("");
                }
              });
          }}
        >
          <Field
            label="Motif du refus"
            hint="Transmis à l’artisan pour lui permettre de proposer une nouvelle version."
            error={reasonError || undefined}
          >
            <textarea
              required
              minLength={5}
              maxLength={1000}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className={styles.rejectActions}>
            <button type="submit" className="button destructive-button" disabled={session.busy}>
              {session.busy ? "Enregistrement…" : "Confirmer le refus"}
            </button>
            <button
              type="button"
              className="button outline"
              disabled={session.busy}
              onClick={() => setRejecting(false)}
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      <section id="quote-documents" className={styles.documentsSection} aria-label="Documents du devis et avenants">
        <QuoteDocumentsAnchor
          session={session}
          variant="client"
          target={{ quoteId: quote.id }}
          authority={{ canWrite: true }}
        />
      </section>

      <div className={styles.docActions}>
        <button
          type="button"
          className="button outline"
          onClick={() =>
            download(`recapitulatif-${quoteRef(quote.id)}.txt`, recapText(quote, i, demo))
          }
        >
          <Icon name="download" />
          Télécharger le récapitulatif (texte)
        </button>
      </div>
      <p className="form-note">
        Le PDF du devis est proposé dans la section « Documents du devis » ci-dessus ; le récapitulatif
        texte n’est pas une facture et n’a pas de valeur comptable.
      </p>
    </>
  );
}

// ---- Documents ------------------------------------------------------------------------
/** Exported for tests only (live quotes list). */
export function DocumentsView({ session, rows }: { session: Session; rows: Intervention[] }) {
  // Live (CLI-08): the quotes list comes from GET /api/quotes (every quote of this client, paginated,
  // status filter), not from the loaded window. Demo: cache list unchanged, zero call.
  const live = session.mode === "live";
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>("all");
  const server = useRecipientQuotes({ enabled: live, context: session.mutationContext, status: quoteFilter });
  const ids = new Set(rows.map((i) => i.id));
  const quotes = session.data.quotes
    .filter((q) => ids.has(q.intervention_id))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return (
    <>
      <PageTitle
        title="Documents"
        subtitle="Les devis de vos interventions et vos pièces privées, réunis dans votre espace."
      />
      <section className={`panel ${styles.listPanel}`}>
        <div className="section-heading" style={{ padding: "18px 16px 8px" }}>
          <h2>Devis</h2>
        </div>
        {live ? (
          <div data-client-quotes={server.state.phase}>
            <div style={{ padding: "0 16px 8px" }}>
              <Segments
                label="Filtrer les devis"
                value={quoteFilter}
                options={[
                  ["all", "Tous"],
                  ["sent", "En attente"],
                  ["accepted", "Acceptés"],
                  ["rejected", "Refusés"],
                ]}
                onChange={setQuoteFilter}
              />
            </div>
            {server.state.phase === "loading" || server.state.phase === "idle" ? (
              <p className="muted" role="status" style={{ padding: "0 16px 16px" }}>{QUOTES_COPY.loading}</p>
            ) : server.state.phase === "forbidden" ? (
              <p className="muted" role="alert" style={{ padding: "0 16px 16px" }}>{server.state.error}</p>
            ) : server.state.phase === "error" ? (
              <div role="alert" style={{ padding: "0 16px 16px" }}>
                <p>{server.state.error}</p>
                <button type="button" className="button outline" onClick={() => server.retry()}>Réessayer</button>
              </div>
            ) : server.state.items.length ? (
              server.state.items.map((q) => (
                <div className={styles.docRow} key={q.id} data-client-quote={q.id}>
                  <span className="service-icon">
                    <Icon name="document" size={24} />
                  </span>
                  <section>
                    <h3>
                      {quoteRef(q.id)} — {category(q.intervention.category).label}
                    </h3>
                    <p>
                      {dateTime(q.created_at)} · {money(q.total_cents)} TTC · {q.status === "accepted" ? "Accepté" : q.status === "rejected" ? "Refusé" : "En attente de décision"} · {shortId(q.intervention_id)}
                    </p>
                  </section>
                  <div>
                    <button type="button" className="button outline" onClick={() => session.go("quote", q.id)}>
                      Voir le devis
                    </button>
                    <button type="button" className="button outline" onClick={() => session.openIntervention(q.intervention_id)}>
                      Consulter le dossier
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <Empty icon="document" title={quoteFilter === "all" ? "Aucun devis pour le moment" : "Aucun devis pour ce filtre"}>
                Les devis apparaîtront ici après leur envoi par votre artisan.
              </Empty>
            )}
            {server.state.failed === "more" && (
              <div role="alert" style={{ padding: "0 16px 16px" }}>
                <p>{server.state.error}</p>
                <button type="button" className="button outline" onClick={() => server.retry()}>Réessayer</button>
              </div>
            )}
            {server.state.phase === "ready" && server.state.next && server.state.failed !== "more" && (
              <div style={{ padding: "0 16px 16px" }}>
                <button type="button" className="button outline" disabled={server.state.loadingMore} onClick={() => server.more()} data-client-quotes-more="">
                  {server.state.loadingMore ? "Chargement…" : QUOTES_COPY.more}
                </button>
              </div>
            )}
          </div>
        ) : quotes.length ? (
          quotes.map((q) => {
            const i = rows.find((x) => x.id === q.intervention_id);
            return (
              <div className={styles.docRow} key={q.id}>
                <span className="service-icon">
                  <Icon name="document" size={24} />
                </span>
                <section>
                  <h3>
                    {quoteRef(q.id)} — {i ? category(i.category).label : "Intervention"}
                  </h3>
                  <p>
                    {dateTime(q.created_at)} · {money(q.total_cents)} TTC · {quoteStatusLabel(q)}
                    {i ? ` · ${shortId(i.id)}` : ""}
                  </p>
                </section>
                <div>
                  <button
                    type="button"
                    className="button outline"
                    onClick={() => session.go("quote", q.id)}
                  >
                    Voir le devis
                  </button>
                  <button
                    type="button"
                    className="button outline"
                    onClick={() => session.openIntervention(q.intervention_id, q.id)}
                  >
                    Consulter le dossier
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <Empty icon="document" title="Aucun devis pour le moment">
            Les devis apparaîtront ici après leur envoi par votre artisan.
          </Empty>
        )}
      </section>
      <DocumentManager
        live={session.mode === "live"}
        profileId={session.profileId}
        documents={session.data.documents}
        interventions={rows}
        demo={session.mode === "demo"}
        onRefresh={session.refresh}
      />
      {/* FIN-05: service invoices and credit notes issued to this account (read-only, private PDFs). */}
      <CustomerInvoicesPanel filters={{ basis: "service" }} context={session.mutationContext} demo={session.mode === "demo"} />
      <div className="inline-note">
        <Icon name="lock" />
        <p>
          Les documents et justificatifs sont privés. Les liens de téléchargement sont
          temporaires et accessibles uniquement aux personnes autorisées.
        </p>
      </div>
    </>
  );
}

// ---- Profil ----------------------------------------------------------------------------
// CLI-09: the notification preferences are stored by /api/notifications/preferences. The profile
// mounts the SAME panel as the notification centre (load/save/version conflict/channel states come
// from the server; an external channel is only « Actif » when the server reports it available).
export function ProfileNotificationPreferences({ session }: { session: Session }) {
  const demo = session.mode === "demo";
  const state = session.capabilities.notifications;
  useProbeWhenUnknown(session, "notifications", undefined, !demo);
  if (!demo && state !== "available") {
    if (state === "unknown") return <Loader label="Vérification des préférences de notification…" />;
    return <FeatureUnavailable session={session} featureKey="notifications" title="Préférences de notification indisponibles" />;
  }
  return (
    <PreferencesPanel
      key={`${session.mode}:${session.profileId}`}
      client={session.features.notifications}
      demo={demo ? demoPreferences() : undefined}
      writable={!demo}
      context={session.mutationContext}
    />
  );
}

/** How many requests of each group the profile lists before sending to « Mes demandes ». */
const PROFILE_REQUESTS = 5;
/** Profile section: the client's current and past requests, from the files loaded in the space. */
function ProfileRequests({ session, rows, activeCount }: { session: Session; rows: Intervention[]; activeCount: number }) {
  const current = rows.filter((i) => isOpen(i.status));
  const past = rows.filter((i) => !isOpen(i.status));
  const all = (
    <button type="button" className="text-button" onClick={() => session.go("requests")}>
      Toutes mes demandes <Icon name="arrow" size={15} />
    </button>
  );
  return (
    <>
      <section className="panel" aria-labelledby="profile-current" data-profile-requests="current">
        <div className="section-heading">
          <h2 id="profile-current">Demandes en cours{Math.max(activeCount, current.length) > 0 ? ` (${Math.max(activeCount, current.length)})` : ""}</h2>
          {current.length > 0 && all}
        </div>
        {current.length ? (
          <RequestList session={session} items={current.slice(0, PROFILE_REQUESTS)} />
        ) : (
          <Empty
            title="Aucune demande en cours"
            action={
              <button type="button" className="button primary" onClick={() => session.go("new")}>
                Créer une demande
              </button>
            }
          >
            Une demande apparaît ici dès son envoi, avec son état et son devis.
          </Empty>
        )}
        {current.length > PROFILE_REQUESTS && (
          <p className="form-note">Les {PROFILE_REQUESTS} plus récentes sont affichées. Ouvrez « Toutes mes demandes » pour les autres.</p>
        )}
      </section>
      <section className="panel" aria-labelledby="profile-past" data-profile-requests="past">
        <div className="section-heading">
          <h2 id="profile-past">Demandes passées</h2>
          {past.length > 0 && all}
        </div>
        {past.length ? (
          <RequestList session={session} items={past.slice(0, PROFILE_REQUESTS)} />
        ) : (
          <Empty title="Aucune demande passée">Les demandes réglées ou annulées sont rangées ici.</Empty>
        )}
        {past.length > PROFILE_REQUESTS && (
          <p className="form-note">Les {PROFILE_REQUESTS} plus récentes sont affichées. Ouvrez « Toutes mes demandes » pour les autres.</p>
        )}
      </section>
    </>
  );
}

function ProfileView({ session, rows, activeCount }: { session: Session; rows: Intervention[]; activeCount: number }) {
  const demo = session.mode === "demo";
  return (
    <>
      <PageTitle title="Mon profil" subtitle="Vos coordonnées, vos adresses et vos demandes." />
      <div className={styles.profileDetails}>
        <ProfileForm
          name={demo ? session.displayName : realName(session.profile?.full_name) ?? ""}
          phone={session.profile?.phone || ""}
          role={session.role}
          demo={demo}
          busy={session.busy}
          email={!demo && session.accountEmail ? session.accountEmail : undefined}
          phoneRequired={!demo}
          structuredName={demo ? undefined : { first_name: session.profile?.first_name ?? null, last_name: session.profile?.last_name ?? null }}
          onSubmit={async (values) => {
            await session.updateProfile(values);
          }}
        />
        <ClientAddressesPanel key={`${session.mode}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`} demo={demo} context={session.mutationContext} />
      </div>
      <ProfileRequests session={session} rows={rows} activeCount={activeCount} />
    </>
  );
}

function ProfileSettings({ session }: { session: Session }) {
  const demo = session.mode === "demo";
  return (
    <>
      <PageTitle title="Paramètres du compte" />
      <div className={styles.twoColumns}>
        <div>
          {/* ART-12: shown only when the server returns a team invitation or membership for this account. */}
          <ProviderTeamsPanel key={`teams|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}`} audience="member" context={session.mutationContext} demo={demo} />
          <ProfileNotificationPreferences session={session} />
          <InstallPanel />
          <AccountSessionsPanel key={`sessions:${session.mode}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`} demo={demo} context={session.mutationContext} />
          <AccountDataPanel
            key={`${session.mode}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`}
            demo={demo}
            context={session.mutationContext}
            onOpenTicket={(id) => session.go("support", id)}
            erasureRequests
          />
          <SavedPaymentMethodsPanel key={`${session.mode}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`} demo={demo} context={session.mutationContext} />
          <SubscriptionsPanel key={`${session.mode}:${session.mutationContext.userId() ?? "anon"}:${session.mutationContext.generation()}`} role="client" demo={demo} context={session.mutationContext} />
        </div>
        <aside className={styles.aside}>
          <section className={styles.asideCard}>
            <Icon name="shield" size={26} />
            <h2>Un accès adapté à votre rôle</h2>
            <p>
              Votre espace : {ROLE_NAMES[session.role]}. Les droits sont vérifiés à chaque action ;
              vous ne voyez que vos propres dossiers.
            </p>
          </section>
          <section className={styles.asideCard}>
            <Icon name="document" size={26} />
            <h3>Mes documents</h3>
            <p>Devis et pièces privées liés à vos interventions.</p>
            <button
              type="button"
              className="button outline full"
              onClick={() => session.go("documents")}
            >
              Ouvrir mes documents
            </button>
          </section>
          <section className={styles.asideCard}>
            <Icon name="shield" size={26} />
            <h3>Assistance</h3>
            <p>Vos demandes à l’équipe de la plateforme et leurs réponses, consultables ici.</p>
            <button
              type="button"
              className="button outline full"
              onClick={() => session.go("support")}
            >
              Ouvrir l’assistance
            </button>
          </section>
          <section className={styles.asideCard}>
            <Icon name="help" size={26} />
            <h3>Aide</h3>
            <p>Comprendre les étapes : estimation, devis, intervention, règlement.</p>
            <button
              type="button"
              className="button outline full"
              onClick={() => session.go("help")}
            >
              Consulter l’aide
            </button>
          </section>
          {/* Opérateur limité : accès au back-office aussi sur mobile (barre latérale masquée < 1024 px),
              même garde fail-closed que la barre latérale ; aucune entrée sans réponse serveur. */}
          {platformEntries(session.platformAccess, (v) => canAccess(v, session.role, session.mode)).length > 0 && (
            <section className={styles.asideCard} aria-labelledby="profile-platform">
              <Icon name="settings" size={26} />
              <h3 id="profile-platform">Opérateur de plateforme</h3>
              <p>Sections du back-office ouvertes par la plateforme pour votre compte.</p>
              <div className={styles.asideLinks}>
                {platformEntries(session.platformAccess, (v) => canAccess(v, session.role, session.mode)).map((n) => (
                  <button key={n.view} type="button" className="button outline full" onClick={() => session.go(n.view)}>
                    <Icon name={n.icon} size={17} />
                    {n.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          <button
            type="button"
            className="button outline full"
            onClick={() => void session.logout()}
          >
            <Icon name="logout" />
            {demo ? "Quitter la démonstration" : "Se déconnecter"}
          </button>
        </aside>
      </div>
    </>
  );
}

// ---- Aide ------------------------------------------------------------------------------
function HelpView({ session }: { session: Session }) {
  return (
    <>
      <PageTitle
        title="Un dépannage, étape par étape."
        subtitle="Comprendre votre demande, votre devis et votre paiement."
      />
      <div className={styles.twoColumns}>
        <section className={`panel ${styles.faq}`}>
          <h2 style={{ marginBottom: 8 }}>Questions fréquentes</h2>
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
        <aside className={styles.aside}>
          <section className={styles.helpPanel}>
            <span>
              <Icon name="help" size={24} />
            </span>
            <h2>Besoin d’une intervention ?</h2>
            <p>Commencez par décrire le problème. Vous préciserez ensuite le lieu et votre besoin.</p>
            <button
              type="button"
              className="button primary full"
              onClick={() => session.go("new")}
            >
              Créer une demande
            </button>
          </section>
          <section className={styles.asideCard}>
            <Icon name="shield" size={26} />
            <h3>Une question que l’aide ne couvre pas ?</h3>
            <p>
              Écrivez à l’équipe de la plateforme : les réponses apparaissent dans votre espace, sans
              appel ni email, et aucun délai n’est garanti.
            </p>
            <button
              type="button"
              className="button outline full"
              onClick={() => session.go("support")}
            >
              Ouvrir l’assistance
            </button>
          </section>
          <section className={styles.asideCard}>
            <h3>Contact et informations légales</h3>
            <p>
              Les coordonnées de l’exploitant seront publiées avant l’ouverture commerciale.
              Cette version ne fournit pas de ligne d’urgence.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
