"use client";
// Assistance privée persistante (contrat WEB-PWA-SUPPORT-001), partagée par les espaces
// particulier, artisan et entreprise. Tout passe par session.loadSupportTickets /
// loadSupportTicket / createSupportTicket / supportCommand ; aucun état n'est imposé par
// l'utilisateur, aucune promesse de délai ni de canal (appel, email, SMS) n'est affichée.
import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { RECOVERY_COPY, clearSnapshot, freeze, readDraft, readSnapshot, sameSnapshot, readLegacy, dropLegacy, dropLegacyIfSame, tabStore, validate, writeDraft, writeSnapshot, type Draft, type Snapshot, type Store } from "./support-snapshot";
import { UNVERIFIED_RECEIPT, validSupportReceipt } from "../app/support-receipt";
import { SupportTriagePanel, SupportTriageQueues } from "../features/support-triage/triage-panel";

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
/** The operator queue is embedded under the platform shell's own h1: its titles start at h2. */
const titleLevel = (queue: SupportQueue): 1 | 2 => (queue === "all" ? 2 : 1);

function TicketList({ session, queue }: { session: Session; queue: SupportQueue }) {
  const listView = supportListView(queue);
  const level = titleLevel(queue);
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
        level={level}
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
      {/* ADM-07: operator queue only — never in a requester view. */}
      {queue === "all" && (
        <SupportTriageQueues
          key={`triage-queues|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}`}
          demo={session.mode === "demo"}
          context={session.mutationContext}
          onOpen={(ticketId) => session.go(listView, ticketId)}
        />
      )}

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
            level={level === 1 ? 2 : 3}
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
          <Empty level={level === 1 ? 2 : 3} icon="help" title="Aucune demande d’assistance" action={newButton}>
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
// The panel is remounted per identity (uid + generation): nothing of another account survives.
function NewTicket(props: { session: Session; interventions: Intervention[]; presetId: string; store?: () => Store | null }) {
  const ctx = props.session.mutationContext;
  return <NewTicketForm key={`${ctx.userId() ?? "-"}|${ctx.generation()}`} {...props} />;
}
function NewTicketForm({
  session,
  interventions,
  presetId,
  store = tabStore,
}: {
  session: Session;
  interventions: Intervention[];
  presetId: string;
  store?: () => Store | null;
}) {
  // Account at mount: storage keys are bound to mode + uid (found again after a reload); the
  // generation is kept for the reply fence only.
  const [me] = useState(() => ({ mode: session.mode, uid: session.mutationContext.userId() ?? "", gen: session.mutationContext.generation() }));
  const presetKnown = Boolean(presetId) && interventions.some((i) => i.id === presetId);
  // IMMUTABLE submitted snapshot, or a provable legacy tuple promoted to it (never sent by itself).
  // Boot is READ-ONLY (StrictMode may run it twice); the legacy promotion happens in an effect.
  const [boot] = useState(() => {
    if (!me.uid) return { snapshot: null as Snapshot | null, unproven: false, promote: false };
    const st = store();
    const stored = readSnapshot(st, me.mode, me.uid);
    if (stored) return { snapshot: stored, unproven: false, promote: false };
    const legacy = readLegacy(st, session.profileId, me.mode, me.uid);
    if (legacy?.kind === "tuple") return { snapshot: legacy.snapshot, unproven: false, promote: true };
    return { snapshot: null, unproven: legacy?.kind === "unproven", promote: false };
  });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(boot.snapshot);
  const [unproven, setUnproven] = useState(boot.unproven);
  useEffect(() => {
    // Idempotent promotion of the exact legacy tuple (same request_id + content): checks the CURRENT
    // storage, writes + reads back the private snapshot, then drops the old record only if it is
    // still exactly that tuple. Safe to run twice; never touches a different record or draft.
    if (!boot.promote || !boot.snapshot) return;
    const st = store();
    const current = readSnapshot(st, me.mode, me.uid);
    if (current && !sameSnapshot(current, boot.snapshot)) return; // another command is pending
    if (!current && !writeSnapshot(st, boot.snapshot)) {
      setSnapshot(null);
      setUnproven(true);
      return;
    }
    dropLegacyIfSame(st, session.profileId, boot.snapshot);
  }, [boot, me, store, session.profileId]);
  // EDITABLE draft (never the snapshot).
  const [draft, setDraft] = useState<Draft>(
    () => (me.uid ? readDraft(store(), me.mode, me.uid) : null) ?? { subject: "", body: "", intervention_id: presetKnown ? presetId : "" },
  );
  // Latest draft, never a stale closure: the post-send decision reads it after the await.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (me.uid) writeDraft(store(), me.mode, me.uid, draft);
  }, [draft, me, store]);
  const [errors, setErrors] = useState<{ subject?: string; body?: string }>({});
  const [problem, setProblem] = useState("");
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = session.busy || sending;
  const dossiers = [...interventions].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const sameIdentity = () => session.mutationContext.userId() === me.uid && session.mutationContext.generation() === me.gen;

  /** Sends EXACTLY `snap` (already frozen); the stored copy is re-read first, else 0 POST. */
  async function send(snap: Snapshot) {
    if (inFlight.current || !me.uid || !sameIdentity()) return; // one POST at a time, same identity
    const stored = readSnapshot(store(), me.mode, me.uid);
    if (!stored || !sameSnapshot(stored, snap)) {
      setProblem(RECOVERY_COPY.storage);
      return;
    }
    inFlight.current = true;
    setSending(true);
    setProblem("");
    const command = { request_id: snap.request_id, subject: snap.subject, body: snap.body, intervention_id: snap.intervention_id };
    const result = await session.createSupportTicket(command);
    inFlight.current = false;
    // A late reply after an identity change or an unmount is ignored (nothing cleared, no navigation).
    if (!mounted.current || !sameIdentity()) return;
    setSending(false);
    // null or a receipt that is not exactly this command = uncertain: the snapshot is kept as is.
    if (!result || !validSupportReceipt(result, command, me.uid)) {
      setProblem(result ? UNVERIFIED_RECEIPT : RECOVERY_COPY.uncertain);
      return;
    }
    // Confirmed. The editable draft is cleared only if it IS the confirmed command (persisted first).
    const latest = draftRef.current; // what the user typed up to the receipt, not the draft at send time
    const matches =
      latest.subject.trim() === snap.subject && latest.body.trim() === snap.body && (latest.intervention_id || null) === snap.intervention_id;
    const nextDraft = matches ? { subject: "", body: "", intervention_id: "" } : latest;
    writeDraft(store(), me.mode, me.uid, nextDraft);
    clearSnapshot(store(), me.mode, me.uid);
    dropLegacyIfSame(store(), session.profileId, snap); // a matching old copy never comes back
    setDraft(nextDraft);
    setSnapshot(null);
    session.go("support", result.ticket.id);
    session.setNotice(
      result.replayed
        ? "Cette demande avait déjà été enregistrée ; aucun doublon créé."
        : "Demande d’assistance enregistrée. Les réponses s’afficheront ici à l’actualisation.",
    );
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current || !me.uid) return;
    // A pending snapshot is never replaced: resend it (or abandon it) first.
    const pending = readSnapshot(store(), me.mode, me.uid);
    if (snapshot || pending || unproven) {
      if (pending && !snapshot) setSnapshot(pending);
      setProblem(RECOVERY_COPY.blocked);
      return;
    }
    const next = validate(draft);
    if (next.subject || next.body) {
      setErrors(next);
      return;
    }
    setErrors({});
    // First real send of this content: freeze it with a fresh id, store, read back, then POST.
    const snap = freeze(draft, me.mode, me.uid, uid());
    if (!writeSnapshot(store(), snap)) {
      clearSnapshot(store(), me.mode, me.uid);
      setProblem(RECOVERY_COPY.storage);
      return;
    }
    setSnapshot(snap);
    await send(snap);
  }

  return (
    <>
      <PageTitle
        back={{ label: "Assistance", onClick: () => session.go("support") }}
        title="Nouvelle demande d’assistance"
        subtitle="Décrivez votre question à l’équipe de la plateforme."
      />
      {snapshot && (
        <section className="panel" aria-labelledby="support-pending-title" data-support-pending={snapshot.request_id}>
          <h2 id="support-pending-title" style={{ fontSize: 17, marginBottom: 8 }}>
            {RECOVERY_COPY.pendingTitle}
          </h2>
          <p className={styles.note}>{snapshot.origin === "legacy" ? RECOVERY_COPY.legacyPending : RECOVERY_COPY.pending}</p>
          <p>
            <strong>{snapshot.subject}</strong>
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>{snapshot.body}</p>
          {snapshot.intervention_id && <p className={styles.note}>Dossier {shortId(snapshot.intervention_id)}</p>}
          <div className={styles.actions}>
            <button type="button" className="button primary" disabled={busy} onClick={() => void send(snapshot)} data-support-resend="">
              <Icon name="send" size={17} />
              {busy ? "Envoi…" : RECOVERY_COPY.resend}
            </button>
            {!confirmAbandon ? (
              <button type="button" className="button outline" disabled={busy} onClick={() => setConfirmAbandon(true)}>
                {RECOVERY_COPY.abandon}
              </button>
            ) : (
              <>
                <p role="alert" className={styles.note}>{RECOVERY_COPY.abandonConfirm}</p>
                <button
                  type="button"
                  className="button outline"
                  disabled={busy}
                  data-support-abandon=""
                  onClick={() => {
                    clearSnapshot(store(), me.mode, me.uid);
                    setSnapshot(null);
                    setConfirmAbandon(false);
                    setProblem("");
                  }}
                >
                  Confirmer l’abandon
                </button>
                <button type="button" className="button outline" onClick={() => setConfirmAbandon(false)}>
                  Garder l’envoi précédent
                </button>
                <button type="button" className="button outline" onClick={() => session.go("support")}>
                  Consulter mes demandes
                </button>
              </>
            )}
          </div>
        </section>
      )}
      <section className="panel" aria-labelledby="support-new-title">
        <h2 id="support-new-title" style={{ fontSize: 17, marginBottom: 12 }}>
          Votre demande
        </h2>
        {unproven && !snapshot && (
          <div className={styles.note} role="alert" data-support-unproven="">
            <strong>{RECOVERY_COPY.unprovenTitle}</strong>
            <p>{RECOVERY_COPY.unproven}</p>
            <div className={styles.actions}>
              <button type="button" className="button outline" onClick={() => session.go("support")}>
                {RECOVERY_COPY.review}
              </button>
              <button
                type="button"
                className="button outline"
                data-support-abandon-unproven=""
                onClick={() => {
                  dropLegacy(store(), session.profileId);
                  setUnproven(false);
                  setProblem("");
                }}
              >
                {RECOVERY_COPY.abandonUnproven}
              </button>
            </div>
          </div>
        )}
        {problem && <p className="field-error" role="alert" data-support-problem="">{problem}</p>}
        {snapshot && <p className={styles.note}>{RECOVERY_COPY.editNote}</p>}
        <form className={styles.form} onSubmit={submit} noValidate>
          <Field label="Sujet" hint="4 à 160 caractères" error={errors.subject}>
            <input
              type="text"
              value={draft.subject}
              maxLength={160}
              autoComplete="off"
              required
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
          </Field>
          <span className={`${styles.counter} ${draft.subject.length > 160 ? styles.counterOver : ""}`} aria-hidden="true">
            {draft.subject.length}/160
          </span>
          <Field label="Message" hint="10 à 4000 caractères" error={errors.body}>
            <textarea
              value={draft.body}
              maxLength={4000}
              required
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </Field>
          <span className={`${styles.counter} ${draft.body.length > 4000 ? styles.counterOver : ""}`} aria-hidden="true">
            {draft.body.length}/4000
          </span>
          <Field
            label="Dossier concerné (facultatif)"
            hint={
              presetId && !presetKnown
                ? "Le dossier indiqué n’est pas parmi vos dossiers chargés : choisissez-le dans la liste ou laissez vide."
                : "Seuls les dossiers accessibles depuis votre espace peuvent être liés."
            }
          >
            <select value={draft.intervention_id} onChange={(e) => setDraft({ ...draft, intervention_id: e.target.value })}>
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
            <button type="submit" className="button primary" disabled={busy || Boolean(snapshot) || unproven} data-support-send="">
              <Icon name="send" size={17} />
              {busy && !snapshot ? "Envoi…" : "Envoyer la demande"}
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
          {snapshot && <p className={styles.note}>{RECOVERY_COPY.blocked}</p>}
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
  const level = titleLevel(queue);
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
      // The per-ticket permissions depend on the new status (e.g. no operator reply on a resolved
      // ticket, reply possible again after reopening): re-read the ticket and its permissions from
      // the server instead of deriving them locally.
      setTarget("");
      setBody("");
      reread();
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
        <PageTitle level={level} back={{ label: "Assistance", onClick: () => session.go(listView) }} title="Demande d’assistance" />
        {state === "available" ? (
          <Empty
            level={level === 1 ? 2 : 3}
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
        level={level}
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

      {/* ADM-07: internal triage, operator queue only (server can_manage decides the writes). */}
      {queue === "all" && (
        <SupportTriagePanel
          key={`triage|${session.mutationContext.userId() ?? "-"}|${session.mutationContext.generation()}|${ticket.id}`}
          ticketId={ticket.id}
          resolved={ticket.status === "resolved"}
          demo={session.mode === "demo"}
          context={session.mutationContext}
        />
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
