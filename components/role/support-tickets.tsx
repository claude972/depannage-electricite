"use client";
// Assistance privée persistante (contrat WEB-PWA-SUPPORT-001), partagée par les espaces
// particulier, artisan et entreprise. Tout passe par session.loadSupportTickets /
// loadSupportTicket / createSupportTicket / supportCommand ; aucun état n'est imposé par
// l'utilisateur, aucune promesse de délai ni de canal (appel, email, SMS) n'est affichée.
import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "../app/session-types";
import type {
  ContractState,
  Intervention,
  SupportDetail,
  SupportEvent,
  SupportListPage,
  SupportMessage,
  SupportStatus,
  SupportTicket,
  View,
} from "../app/types";
import { Icon } from "../app/icons";
import { ConfirmAction, Empty, Field, Loader, PageTitle, Tag, Unavailable } from "../app/ui";
import { category, date, dateTime, shortId, uid } from "../app/format";
import { authorLabel, QUEUE_READ_ONLY, runStatusCommand, statusTargets, supportListView, ticketAuthorityKey, type SupportQueue } from "./support-lists";
import styles from "./support-tickets.module.css";

type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "violet";
const STATUS_META: Record<SupportStatus, { label: string; tone: Tone }> = {
  open: { label: "Ouverte", tone: "blue" },
  in_progress: { label: "En cours de traitement", tone: "violet" },
  awaiting_user: { label: "Réponse attendue de votre part", tone: "amber" },
  resolved: { label: "Résolue", tone: "green" },
};
const STATUS_OPTIONS: SupportStatus[] = ["open", "in_progress", "awaiting_user", "resolved"];
// Same literal rule as the server (letters incl. accents, digits, spaces, hyphens, apostrophes).
const SEARCH_RE = new RegExp("^[\\p{L}\\p{M}\\p{N} '’-]+$", "u");
const PAGE_SIZES = [25, 50] as const;
const DETAIL_PAGE = 50;
const HONEST_NOTE =
  "Aucun appel, email ni SMS : les réponses apparaissent ici. Aucun délai n’est garanti.";
const NOT_ENABLED = "L’assistance en ligne n’est pas encore activée sur ce service.";
const NEW_PREFIX = "new-";

const sortByVersion = <T extends { version: number }>(rows: T[]) =>
  [...rows].sort((a, b) => a.version - b.version);
const mergeById = <T extends { id: string; version: number }>(prev: T[], next: T[]) => {
  const seen = new Set(prev.map((r) => r.id));
  return sortByVersion([...prev, ...next.filter((r) => !seen.has(r.id))]);
};
const dossierLabel = (i: Intervention) =>
  `${shortId(i.id)} · ${category(i.category).label} · ${date(i.created_at)}`;
const unavailableReason = (state: ContractState) =>
  state === "unavailable"
    ? "L’assistance en ligne est momentanément indisponible. Réessayez dans quelques instants."
    : NOT_ENABLED;

/**
 * Vue "support" d'un espace. `session.param` vaut : "" (liste), "new" ou "new-<dossier>"
 * (nouvelle demande, dossier présélectionné), sinon l'identifiant d'une demande.
 * `interventions` : dossiers lisibles par l'utilisateur dans son espace (jamais ceux d'un autre rôle).
 */
export function SupportCenter({
  session,
  interventions,
  backView,
  queue = "mine",
}: {
  session: Session;
  interventions: Intervention[];
  backView: View;
  /** "mine" = the requester's own tickets; "all" = the operator queue (server capability `support`). */
  queue?: SupportQueue;
}) {
  const param = session.param;
  if (queue === "mine" && (param === "new" || param.startsWith(NEW_PREFIX)))
    return (
      <NewTicket
        key={param}
        session={session}
        interventions={interventions}
        presetId={param.startsWith(NEW_PREFIX) ? param.slice(NEW_PREFIX.length) : ""}
      />
    );
  if (param)
    return (
      <TicketDetail
        key={ticketAuthorityKey(param, queue, session.platformAccess?.capabilities)}
        session={session}
        interventions={interventions}
        id={param}
        backView={backView}
        queue={queue}
      />
    );
  return <TicketList session={session} queue={queue} />;
}

/** Lien discret depuis la fiche d'un dossier : ouvre une nouvelle demande déjà liée à ce dossier. */
export function DossierHelpLink({ session, interventionId }: { session: Session; interventionId: string }) {
  return (
    <p className={styles.inlineHelp}>
      <Icon name="help" size={16} />
      <span>Besoin d’aide sur ce dossier ?</span>
      <button
        type="button"
        className="text-button"
        onClick={() => session.go("support", `${NEW_PREFIX}${interventionId}`)}
      >
        Écrire à l’assistance
      </button>
    </p>
  );
}

// ---- Liste ------------------------------------------------------------------------------
function TicketList({ session, queue }: { session: Session; queue: SupportQueue }) {
  const listView = supportListView(queue);
  const [status, setStatus] = useState<"" | SupportStatus>("");
  const [search, setSearch] = useState("");
  const [searchError, setSearchError] = useState("");
  const [applied, setApplied] = useState("");
  const [limit, setLimit] = useState<(typeof PAGE_SIZES)[number]>(25);
  // Pile des curseurs visités : le dernier est la page courante, « Précédent » dépile.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState<SupportListPage | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const cursor = cursors[cursors.length - 1] ?? null;
  const filtered = Boolean(status || applied);

  useEffect(() => {
    let active = true;
    setRefreshing(true);
    void session
      .loadSupportTickets({
        scope: queue,
        status: status || undefined,
        q: applied || undefined,
        limit,
        cursor,
      })
      .then((result) => {
        if (!active) return;
        setPage(result);
        setRefreshing(false);
      });
    return () => {
      active = false;
    };
    // Relecture sur changement de filtre/page, actualisation manuelle ou relecture du workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, applied, limit, cursor, reloadKey, session.refreshedAt]);

  const resetPaging = () => setCursors([null]);
  function applySearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = search.trim();
    if (!value) {
      setSearchError("");
      if (applied) {
        setApplied("");
        resetPaging();
      }
      return;
    }
    if (value.length < 2 || value.length > 80) {
      setSearchError("Entre 2 et 80 caractères.");
      return;
    }
    if (!SEARCH_RE.test(value)) {
      setSearchError("Lettres, chiffres, espaces, tirets et apostrophes uniquement.");
      return;
    }
    setSearchError("");
    if (value !== applied) {
      setApplied(value);
      resetPaging();
    }
  }
  function clearFilters() {
    setStatus("");
    setSearch("");
    setApplied("");
    setSearchError("");
    resetPaging();
  }

  const newButton = queue === "all" ? null : (
    <button type="button" className="button primary" onClick={() => session.go("support", "new")}>
      <Icon name="plus" size={17} />
      Nouvelle demande
    </button>
  );

  return (
    <>
      <PageTitle
        title="Assistance"
        subtitle="Vos demandes à l’équipe de la plateforme et leur historique."
        action={
          <div className={styles.actions}>
            <button
              type="button"
              className="button outline"
              disabled={refreshing}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <Icon name="refresh" size={17} />
              {refreshing ? "Actualisation…" : "Actualiser"}
            </button>
            {page !== null && newButton}
          </div>
        }
      />
      <p className={styles.note}>{HONEST_NOTE}</p>

      {page !== null && (
        <div className={styles.toolbar}>
          <form onSubmit={applySearch} role="search" aria-label="Filtres des demandes">
            <Field label="Rechercher dans les sujets" hint="2 à 80 caractères" error={searchError}>
              <input
                type="search"
                value={search}
                maxLength={80}
                autoComplete="off"
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            <Field label="État">
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as "" | SupportStatus);
                  resetPaging();
                }}
              >
                <option value="">Tous les états</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Par page">
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value) as (typeof PAGE_SIZES)[number]);
                  resetPaging();
                }}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <button type="submit" className={`button outline ${styles.toolbarButton}`}>
              <Icon name="search" size={17} />
              Rechercher
            </button>
          </form>
        </div>
      )}

      {page === undefined ? (
        <Loader label="Chargement des demandes…" />
      ) : page === null ? (
        <Unavailable
          title="Assistance en ligne"
          reason={unavailableReason(session.capabilities.support)}
          state={session.capabilities.support}
          blocker="SUPPORT-001"
        >
          {session.capabilities.support === "unavailable" && (
            <div className={styles.actions}>
              <button type="button" className="button outline" onClick={() => setReloadKey((k) => k + 1)}>
                <Icon name="refresh" size={17} />
                Réessayer
              </button>
            </div>
          )}
        </Unavailable>
      ) : page.tickets.length === 0 ? (
        filtered ? (
          <Empty
            icon="search"
            title="Aucune demande ne correspond à ces filtres"
            action={
              <button type="button" className="button outline" onClick={clearFilters}>
                Effacer les filtres
              </button>
            }
          >
            {`${page.page.total} demande(s) au total ; modifiez l’état ou la recherche.`}
          </Empty>
        ) : (
          <Empty icon="help" title="Aucune demande d’assistance" action={newButton}>
            Décrivez votre question ; l’équipe de la plateforme vous répond ici.
          </Empty>
        )
      ) : (
        <>
          <p className={styles.summary}>
            <span>
              {page.page.total} demande{page.page.total > 1 ? "s" : ""}
              {filtered ? " pour ces filtres" : ""} · page {cursors.length}
            </span>
            {refreshing && <span role="status">Actualisation…</span>}
          </p>
          <ul className={styles.list} aria-label="Demandes d’assistance">
            {page.tickets.map((t) => (
              <li key={t.id}>
                <TicketRow ticket={t} queue={queue} onOpen={() => session.go(listView, t.id)} />
              </li>
            ))}
          </ul>
          <nav className={styles.pagination} aria-label="Pagination des demandes">
            <span>
              {page.tickets.length} affichée{page.tickets.length > 1 ? "s" : ""} sur {page.page.total}
            </span>
            <div>
              <button
                type="button"
                className="button outline"
                disabled={cursors.length <= 1 || refreshing}
                onClick={() => setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c))}
              >
                Précédent
              </button>
              <button
                type="button"
                className="button outline"
                disabled={!page.page.has_more || !page.page.next_cursor || refreshing}
                onClick={() => {
                  const next = page.page.next_cursor;
                  if (next) setCursors((c) => [...c, next]);
                }}
              >
                Suivant
              </button>
            </div>
          </nav>
        </>
      )}
    </>
  );
}

function TicketRow({ ticket: t, queue, onOpen }: { ticket: SupportTicket; queue: SupportQueue; onOpen: () => void }) {
  const meta = STATUS_META[t.status];
  return (
    <button type="button" className={styles.row} onClick={onOpen}>
      <span className={styles.rowTitle}>{t.subject}</span>
      <span className={styles.rowArrow} aria-hidden="true">
        <Icon name="arrow" size={16} />
      </span>
      <span className={styles.rowMeta}>
        <Tag tone={meta.tone}>{meta.label}</Tag>
        {queue === "all" && <span>Demandeur {shortId(t.creator_id)}</span>}
        {t.intervention_id && <span>Dossier {shortId(t.intervention_id)}</span>}
        <span>Dernière activité : {dateTime(t.last_message_at)}</span>
      </span>
    </button>
  );
}

// ---- Nouvelle demande -----------------------------------------------------------------
function NewTicket({
  session,
  interventions,
  presetId,
}: {
  session: Session;
  interventions: Intervention[];
  presetId: string;
}) {
  // Clé d'idempotence générée une fois à l'ouverture du formulaire et conservée tant que la
  // création n'a pas abouti : une nouvelle tentative ne crée jamais de doublon.
  // The idempotency key and the content it covers survive a remount (navigation, identity
  // refresh): a retry after an uncertain outcome re-sends the SAME key with the SAME content,
  // which the platform replays instead of duplicating. Cleared only after success.
  const PENDING_KEY = `courant-support-pending-${session.profileId}`;
  const [requestId, setRequestId] = useState<string>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null") as { request_id?: string } | null;
      if (saved?.request_id && /^[0-9a-f-]{36}$/i.test(saved.request_id)) return saved.request_id;
    } catch {}
    return uid();
  });
  const presetKnown = Boolean(presetId) && interventions.some((i) => i.id === presetId);
  const pendingSaved = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null") as
        | { request_id?: string; subject?: string; body?: string; intervention_id?: string }
        | null;
    } catch {
      return null;
    }
  })();
  const [subject, setSubject] = useState(pendingSaved?.subject ?? "");
  const [body, setBody] = useState(pendingSaved?.body ?? "");
  const [interventionId, setInterventionId] = useState(
    pendingSaved?.intervention_id ?? (presetKnown ? presetId : ""),
  );
  // Keep key + content together: a replay must carry exactly the same content.
  useEffect(() => {
    try {
      if (subject || body)
        sessionStorage.setItem(
          PENDING_KEY,
          JSON.stringify({ request_id: requestId, subject, body, intervention_id: interventionId }),
        );
    } catch {}
  }, [PENDING_KEY, requestId, subject, body, interventionId]);
  const [errors, setErrors] = useState<{ subject?: string; body?: string }>({});
  const [sending, setSending] = useState(false);
  const busy = session.busy || sending;
  const dossiers = [...interventions].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const s = subject.trim();
    const b = body.trim();
    const next: { subject?: string; body?: string } = {};
    if (s.length < 4 || s.length > 160) next.subject = "Le sujet doit faire entre 4 et 160 caractères.";
    if (b.length < 10 || b.length > 4000) next.body = "Le message doit faire entre 10 et 4000 caractères.";
    if (next.subject || next.body) {
      setErrors(next);
      return;
    }
    setErrors({});
    setSending(true);
    const result = await session.createSupportTicket({
      request_id: requestId,
      subject: s,
      body: b,
      intervention_id: interventionId || null,
    });
    setSending(false);
    // Échec : session.error l'affiche en haut ; le texte et la clé sont conservés pour réessayer.
    if (!result) return;
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch {}
    setRequestId(uid());
    session.go("support", result.ticket.id);
    session.setNotice(
      result.replayed
        ? "Cette demande avait déjà été enregistrée ; aucun doublon créé."
        : "Demande d’assistance enregistrée. Les réponses s’afficheront ici à l’actualisation.",
    );
  }

  return (
    <>
      <PageTitle
        back={{ label: "Assistance", onClick: () => session.go("support") }}
        title="Nouvelle demande d’assistance"
        subtitle="Décrivez votre question à l’équipe de la plateforme."
      />
      <section className="panel" aria-labelledby="support-new-title">
        <h2 id="support-new-title" style={{ fontSize: 17, marginBottom: 12 }}>
          Votre demande
        </h2>
        <form className={styles.form} onSubmit={submit} noValidate>
          <Field label="Sujet" hint="4 à 160 caractères" error={errors.subject}>
            <input
              type="text"
              value={subject}
              maxLength={160}
              autoComplete="off"
              required
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>
          <span className={`${styles.counter} ${subject.length > 160 ? styles.counterOver : ""}`} aria-hidden="true">
            {subject.length}/160
          </span>
          <Field label="Message" hint="10 à 4000 caractères" error={errors.body}>
            <textarea
              value={body}
              maxLength={4000}
              required
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <span className={`${styles.counter} ${body.length > 4000 ? styles.counterOver : ""}`} aria-hidden="true">
            {body.length}/4000
          </span>
          <Field
            label="Dossier concerné (facultatif)"
            hint={
              presetId && !presetKnown
                ? "Le dossier indiqué n’est pas parmi vos dossiers chargés : choisissez-le dans la liste ou laissez vide."
                : "Seuls les dossiers accessibles depuis votre espace peuvent être liés."
            }
          >
            <select value={interventionId} onChange={(e) => setInterventionId(e.target.value)}>
              <option value="">Aucun dossier</option>
              {dossiers.map((i) => (
                <option key={i.id} value={i.id}>
                  {dossierLabel(i)}
                </option>
              ))}
            </select>
          </Field>
          <p className={styles.note}>
            {HONEST_NOTE} Une demande liée à un dossier reste lisible tant que vous avez accès à ce
            dossier.
          </p>
          <div className={styles.actions}>
            <button type="submit" className="button primary" disabled={busy}>
              <Icon name="send" size={17} />
              {busy ? "Envoi…" : "Envoyer la demande"}
            </button>
            <button
              type="button"
              className="button outline"
              disabled={busy}
              onClick={() => session.go("support")}
            >
              Annuler
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

// ---- Détail -----------------------------------------------------------------------------
function TicketDetail({
  session,
  interventions,
  id,
  backView,
  queue,
}: {
  session: Session;
  interventions: Intervention[];
  id: string;
  backView: View;
  queue: SupportQueue;
}) {
  const listView = supportListView(queue);
  const [detail, setDetail] = useState<SupportDetail | null | undefined>(undefined);
  const [events, setEvents] = useState<SupportEvent[]>([]);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [body, setBody] = useState("");
  const [bodyError, setBodyError] = useState("");
  const [conflict, setConflict] = useState("");
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState<"" | SupportStatus>("");
  const [statusError, setStatusError] = useState("");

  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setMoreError("");
    void session.loadSupportTicket(id, { limit: DETAIL_PAGE, after_version: 0 }).then((result) => {
      if (!active) return;
      setDetail(result);
      setEvents(result ? sortByVersion(result.events) : []);
      setMessages(result ? sortByVersion(result.messages) : []);
    });
    return () => {
      active = false;
    };
    // Relecture sur changement de demande ou à la demande (Actualiser / Relire la demande).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reloadKey]);

  const reread = () => {
    setConflict("");
    setReloadKey((k) => k + 1);
  };

  async function loadMore() {
    if (!detail || detail.page.next_after_version === null) return;
    setLoadingMore(true);
    setMoreError("");
    const result = await session.loadSupportTicket(id, {
      limit: DETAIL_PAGE,
      after_version: detail.page.next_after_version,
    });
    setLoadingMore(false);
    if (!result) {
      setMoreError("La suite de l’historique n’a pas pu être chargée. Réessayez.");
      return;
    }
    setDetail(result);
    setEvents((prev) => mergeById(prev, result.events));
    setMessages((prev) => mergeById(prev, result.messages));
  }

  async function reply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!detail) return;
    const text = body.trim();
    if (!text) {
      setBodyError("Écrivez votre réponse avant d’envoyer.");
      return;
    }
    if (text.length > 4000) {
      setBodyError("4000 caractères maximum.");
      return;
    }
    setBodyError("");
    setConflict("");
    setSending(true);
    const result = await session.supportCommand(id, {
      action: "reply",
      expected_version: detail.ticket.version,
      body: text,
    });
    setSending(false);
    if (result.ok) {
      const { ticket, event, message } = result;
      setDetail((d) =>
        d
          ? {
              ...d,
              ticket,
              page: {
                ...d.page,
                total_events: d.page.total_events + 1,
                total_messages: d.page.total_messages + (message ? 1 : 0),
              },
            }
          : d,
      );
      setEvents((prev) => mergeById(prev, [event]));
      if (message) setMessages((prev) => mergeById(prev, [message]));
      setBody("");
      return;
    }
    // Conflit de version : le texte reste dans le champ, rien n'est renvoyé automatiquement.
    if (result.conflict) setConflict(result.message);
    else setBodyError(result.message);
  }

  // A5: status change by an operator holding read+status (server permission per ticket, CAS on version).
  async function changeStatus(next: SupportStatus) {
    if (!detail || sending) return;
    setStatusError("");
    setConflict("");
    setSending(true);
    const result = await runStatusCommand((c) => session.supportCommand(id, c), detail.ticket, detail.permissions.can_set_status, next);
    setSending(false);
    if (result.kind === "ok") {
      const { ticket, event } = result;
      setDetail((d) => (d ? { ...d, ticket, page: { ...d.page, total_events: d.page.total_events + 1 } } : d));
      setEvents((prev) => mergeById(prev, [event]));
      setTarget("");
      return;
    }
    // 409: the choice is kept, nothing is resent; any other refusal is shown as the server wrote it.
    if (result.kind === "conflict") setConflict(result.message);
    else setStatusError(result.message);
  }

  if (detail === undefined) return <Loader label="Chargement de la demande…" />;
  if (detail === null) {
    const state = session.capabilities.support;
    return (
      <>
        <PageTitle back={{ label: "Assistance", onClick: () => session.go(listView) }} title="Demande d’assistance" />
        {state === "available" ? (
          <Empty
            icon="search"
            title="Demande introuvable"
            action={
              <div className={styles.actions}>
                <button type="button" className="button outline" onClick={reread}>
                  <Icon name="refresh" size={17} />
                  Réessayer
                </button>
                <button type="button" className="button primary" onClick={() => session.go(backView)}>
                  Revenir à mon espace
                </button>
              </div>
            }
          >
            Cette demande n’existe pas ou n’est plus accessible depuis votre compte (par exemple si
            l’accès au dossier lié a été retiré).
          </Empty>
        ) : (
          <Unavailable
            title="Assistance en ligne"
            reason={unavailableReason(state)}
            state={state}
            blocker="SUPPORT-001"
          />
        )}
      </>
    );
  }

  const { ticket, permissions, page } = detail;
  const meta = STATUS_META[ticket.status];
  const linked = ticket.intervention_id
    ? interventions.find((i) => i.id === ticket.intervention_id) || null
    : null;
  const byId = new Map(messages.map((m) => [m.id, m]));
  const byVersion = new Map(messages.map((m) => [m.version, m]));
  const reopens = ticket.status === "awaiting_user" || ticket.status === "resolved";
  const busy = session.busy || sending;

  return (
    <>
      <PageTitle
        back={{ label: "Assistance", onClick: () => session.go(listView) }}
        title={ticket.subject}
        subtitle={`Créée le ${dateTime(ticket.created_at)} · dernière activité le ${dateTime(ticket.last_message_at)}`}
        action={
          <div className={styles.actions}>
            <Tag tone={meta.tone}>{meta.label}</Tag>
            <button type="button" className="button outline" disabled={busy} onClick={reread}>
              <Icon name="refresh" size={17} />
              Actualiser
            </button>
          </div>
        }
      />
      <div className={styles.headerMeta}>
        {ticket.intervention_id ? (
          linked ? (
            <button
              type="button"
              className="text-button"
              onClick={() => session.openIntervention(linked.id)}
            >
              <Icon name="document" size={15} />
              Dossier lié : {dossierLabel(linked)}
            </button>
          ) : (
            <span>Dossier lié : {shortId(ticket.intervention_id)} (hors de vos dossiers chargés)</span>
          )
        ) : (
          <span>Aucun dossier lié</span>
        )}
        <span>{HONEST_NOTE}</span>
      </div>

      <section className="panel" aria-labelledby="support-history-title">
        <h2 id="support-history-title" style={{ fontSize: 17, marginBottom: 12 }}>
          Historique
        </h2>
        <ol className={styles.timeline} aria-label="Historique de la demande">
          {events.map((ev) => (
            <EventItem
              key={ev.id}
              event={ev}
              message={(ev.message_id && byId.get(ev.message_id)) || byVersion.get(ev.version) || null}
              viewerId={session.profileId}
              queue={queue}
            />
          ))}
        </ol>
        <div className={styles.more}>
          <span>
            {events.length} sur {page.total_events} événement{page.total_events > 1 ? "s" : ""} ·{" "}
            {messages.length} sur {page.total_messages} message{page.total_messages > 1 ? "s" : ""}
          </span>
          {page.has_more && page.next_after_version !== null && (
            <button type="button" className="button outline" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "Chargement…" : "Charger la suite"}
            </button>
          )}
        </div>
        {loadingMore && <span className="sr-only" role="status">Chargement de la suite de l’historique</span>}
        {moreError && (
          <p className="field-error" role="alert" style={{ marginTop: 8 }}>
            {moreError}
          </p>
        )}
      </section>

      {statusTargets(detail.ticket.status, permissions.can_set_status).length > 0 && (
        <section className="panel" aria-labelledby="support-status-title">
          <h2 id="support-status-title" style={{ fontSize: 17, marginBottom: 12 }}>
            État de la demande
          </h2>
          {conflict && (
            <div className={styles.conflict} role="alert">
              <p>{conflict}</p>
              <button type="button" className="button outline" disabled={sending} onClick={reread}>
                <Icon name="refresh" size={17} />
                Relire la demande
              </button>
            </div>
          )}
          <Field
            label="Nouvel état"
            hint={`État actuel : ${STATUS_META[detail.ticket.status].label}. Seuls les passages autorisés depuis cet état sont proposés.`}
            error={statusError}
          >
            <select value={target} onChange={(e) => setTarget(e.target.value as "" | SupportStatus)} disabled={sending}>
              <option value="">Choisir un état</option>
              {statusTargets(detail.ticket.status, permissions.can_set_status).map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </Field>
          <ConfirmAction
            label="Changer l’état"
            message={
              target
                ? `Passer la demande de « ${STATUS_META[detail.ticket.status].label} » à « ${STATUS_META[target].label} ». Le changement est inscrit dans l’historique visible par le demandeur.`
                : ""
            }
            confirmLabel="Confirmer"
            busy={sending || !target}
            onConfirm={async () => {
              if (target) await changeStatus(target);
            }}
          />
        </section>
      )}

      <section className={`panel ${styles.reply}`} aria-labelledby="support-reply-title">
        <h2 id="support-reply-title" style={{ fontSize: 17, marginBottom: 12 }}>
          Répondre
        </h2>
        {permissions.can_reply ? (
          <form className={styles.form} onSubmit={reply} noValidate>
            {conflict && (
              <div className={styles.conflict} role="alert">
                <p>{conflict}</p>
                <button type="button" className="button outline" disabled={busy} onClick={reread}>
                  <Icon name="refresh" size={17} />
                  Relire la demande
                </button>
              </div>
            )}
            <Field
              label="Votre réponse"
              hint={
                reopens
                  ? `Répondre rouvre la demande : son état « ${meta.label} » repasse à « Ouverte ».`
                  : "1 à 4000 caractères."
              }
              error={bodyError}
            >
              <textarea
                value={body}
                maxLength={4000}
                required
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
            <span className={`${styles.counter} ${body.length > 4000 ? styles.counterOver : ""}`} aria-hidden="true">
              {body.length}/4000
            </span>
            <div className={styles.actions}>
              <button type="submit" className="button primary" disabled={busy || Boolean(conflict)}>
                <Icon name="send" size={17} />
                {sending ? "Envoi…" : reopens ? "Répondre et rouvrir" : "Envoyer la réponse"}
              </button>
            </div>
            <p className={styles.note}>
              L’état de la demande est géré par l’équipe de la plateforme ; chaque changement apparaît
              dans l’historique.
            </p>
          </form>
        ) : (
          <p className={styles.closedNote}>
            {queue === "all" && !permissions.can_set_status
              ? QUEUE_READ_ONLY
              : "Vous ne pouvez plus répondre à cette demande depuis votre compte. Son historique reste consultable ci-dessus."}
          </p>
        )}
      </section>
    </>
  );
}

function EventItem({
  event: ev,
  message,
  viewerId,
  queue,
}: {
  event: SupportEvent;
  message: SupportMessage | null;
  viewerId: string;
  queue: SupportQueue;
}) {
  const author = authorLabel(message, { viewerId, queue });
  const reopened = ev.kind === "replied" && ev.from_status !== null && ev.from_status !== ev.to_status;
  if (ev.kind === "status_changed") {
    return (
      <li className={`${styles.event} ${styles.eventSystem}`}>
        <div className={styles.eventHead}>
          <strong>Assistance</strong>
          <span>{dateTime(ev.created_at)}</span>
        </div>
        <p className={styles.eventBody}>
          État modifié : {ev.from_status ? `« ${STATUS_META[ev.from_status].label} » devient ` : ""}«{" "}
          {STATUS_META[ev.to_status].label} ».
        </p>
      </li>
    );
  }
  return (
    <li className={`${styles.event} ${author === "Vous" ? styles.eventUser : ""}`}>
      <div className={styles.eventHead}>
        <strong>
          {author}
          {ev.kind === "ticket_created" ? " — demande créée" : ""}
        </strong>
        <span>
          {dateTime(ev.created_at)}
          {reopened ? ` · demande rouverte (« ${STATUS_META[ev.to_status].label} »)` : ""}
        </span>
      </div>
      <p className={styles.eventBody}>{message ? message.body : "Message non chargé pour cette version."}</p>
    </li>
  );
}
