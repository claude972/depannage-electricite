"use client";
// Leaf component: persistent notification centre of the connected account (contract
// ADV-PLANNING-NOTIFICATIONS-001, amendment A1). Lists, marks read/unread and edits preferences
// through the injected client only. External channels are shown unavailable, never simulated.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Empty, Loader, Tag, Unavailable } from "../../app/ui";
import { Icon } from "../../app/icons";
import { NOTIFICATION_COPY, applyMark, reducePage, scopeKey, type ContractState, type LeafScope, type ListState, type NotificationsClient } from "../../../lib/features/notifications/leaf";
import { KIND_ICONS, KIND_LABELS } from "../../../lib/features/notifications/kinds";
import { CHANNEL_LABELS, type ExternalChannel } from "../../../lib/features/notifications/channels";
import type { Notification, NotificationKind, NotificationMarkCommand, NotificationPage, PreferencesView } from "../../../lib/features/notifications/types";
import styles from "./notifications.module.css";
import { WebPushPanel } from "../web-push/web-push-panel";
import { TAG_LABEL, type PushTag } from "../web-push/model";

export type NotificationCenterProps = {
  state: ContractState;
  unavailableMessage: string;
  scope: LeafScope;
  client: NotificationsClient;
  demo?: { page: NotificationPage; preferences: PreferencesView };
  onNavigate?: (view: string, param?: string) => void;
  /** Session mutation context (uid + generation): identity fence of the web push enrollment. */
  context?: { generation(): number; userId(): string | null };
};
const PAGE_SIZE = 25;
const when = (value: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "America/Martinique", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));

export function NotificationCenter(props: NotificationCenterProps) {
  return <CenterBody key={scopeKey(props.scope)} {...props} />;
}
function CenterBody({ state, unavailableMessage, scope, client, demo, onNavigate, context }: NotificationCenterProps) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [list, setList] = useState<ListState>(demo ? reducePage({ status: "loading", items: [] }, demo.page, false) : { status: "loading", items: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [itemError, setItemError] = useState<{ id: string; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [showPreferences, setShowPreferences] = useState(false);
  const available = state === "available";
  const writable = scope.authority.canWrite && !demo;
  // Fence of every list read: a filter switch, a reload or an unmount bumps `gen`; a reply (and its
  // catch / finally) from an older generation, filter or identity never touches rows, cursor,
  // loading or error. The cursor and the filter live in refs, reset synchronously on a switch.
  const gen = useRef(0);
  const filter = useRef(unreadOnly);
  const cursor = useRef<string | null>(demo ? demo.page.page.next_cursor : null);
  const moreBusy = useRef(false);
  const alive = useRef(true);
  const identity = () => (context ? `${context.userId() ?? "-"}|${context.generation()}` : "");
  const fence = () => {
    const g = gen.current, f = filter.current, who = identity();
    return () => alive.current && gen.current === g && filter.current === f && identity() === who;
  };
  const restart = () => {
    gen.current++;
    if (!demo) cursor.current = null; // the demo list is never re-read: its cursor stays
    moreBusy.current = false;
    setLoadingMore(false);
    setItemError((e) => (e?.id === "more" ? null : e));
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      gen.current++;
    };
  }, []);

  useEffect(() => {
    if (demo || !available) return;
    restart();
    const fresh = fence();
    setList({ status: "loading", items: [] });
    client.list({ limit: PAGE_SIZE, unread: filter.current, cursor: null })
      .then((answer) => {
        if (!fresh()) return;
        if (answer) cursor.current = answer.page.next_cursor;
        setList((previous) => reducePage(previous, answer, false));
      })
      .catch((error: unknown) => { if (fresh()) setList({ status: "error", message: error instanceof Error && error.message ? error.message : NOTIFICATION_COPY.loadError, items: [] }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, demo, available, unreadOnly, reloadKey]);

  if (!available) return <Unavailable title="Notifications" reason={unavailableMessage} state={state} blocker="capability:notifications" />;
  const page = list.status === "ready" ? list.page : null;
  const unread = list.status === "ready" ? list.unread : null;
  const switchFilter = (next: boolean) => {
    if (filter.current === next) return;
    filter.current = next; // synchronous: no old cursor or filter can be used in this tick
    restart();
    setUnreadOnly(next);
  };
  const loadMore = async () => {
    const from = cursor.current;
    if (!from || moreBusy.current) return; // one continuation in flight
    moreBusy.current = true;
    const fresh = fence();
    setLoadingMore(true);
    setItemError((e) => (e?.id === "more" ? null : e));
    try {
      const answer = await client.list({ limit: PAGE_SIZE, unread: filter.current, cursor: from });
      if (!fresh()) return;
      if (answer) cursor.current = answer.page.next_cursor;
      setList((previous) => reducePage(previous, answer, true));
    } catch (error) {
      if (fresh()) setItemError({ id: "more", message: error instanceof Error && error.message ? error.message : NOTIFICATION_COPY.loadError });
    } finally {
      if (fresh()) {
        moreBusy.current = false;
        setLoadingMore(false);
      }
    }
  };
  const mark = async (command: NotificationMarkCommand, key: string) => {
    const who = identity();
    const same = () => alive.current && identity() === who;
    setPending(key); setItemError(null);
    try {
      const answer = await client.mark(command);
      if (!same() || answer === null) return;
      if (!answer.ok) { setItemError({ id: key, message: answer.message }); return; }
      const now = new Date().toISOString();
      // Confirmed: applied to the CURRENT rows (never to the list captured before the network).
      setList((previous) => {
        if (previous.status !== "ready") return previous;
        const applied = applyMark(previous.items, command, answer, now);
        return { ...previous, items: filter.current ? applied.items.filter((n) => !n.read_at) : applied.items, unread: applied.unread ?? previous.unread };
      });
      if (command.action === "mark_all_read") setNotice(answer.result.unread_count === 0 ? "Toutes les notifications sont marquées comme lues." : "Notifications marquées comme lues.");
    } catch (error) { if (same()) setItemError({ id: key, message: error instanceof Error && error.message ? error.message : "Le marquage n’a pas pu être effectué." }); }
    finally { if (same()) setPending(null); }
  };
  return (
    <div className={styles.root} data-scope={scope.userId}>
      {demo && <p className={styles.demoNote}>{NOTIFICATION_COPY.demo}</p>}
      {!scope.authority.canWrite && <p className={styles.readOnly} role="note"><strong>Lecture seule.</strong> {scope.authority.reason ?? "Les notifications ne peuvent pas être modifiées depuis ce compte."}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filtre">
          <button type="button" className={`button ${unreadOnly ? "outline" : "primary"}`} aria-pressed={!unreadOnly} onClick={() => switchFilter(false)}>Toutes</button>
          <button type="button" className={`button ${unreadOnly ? "primary" : "outline"}`} aria-pressed={unreadOnly} onClick={() => switchFilter(true)}>Non lues{unread !== null ? ` (${unread})` : ""}</button>
        </div>
        <div className={styles.filters}>
          {writable && unread !== null && unread > 0 && <button type="button" className="button outline" disabled={pending === "all"} onClick={() => mark({ action: "mark_all_read", before: list.items[0]?.created_at }, "all")}>{pending === "all" ? "Marquage…" : "Tout marquer lu"}</button>}
          <button type="button" className="button outline" aria-expanded={showPreferences} onClick={() => setShowPreferences((v) => !v)}><Icon name="settings" size={16} />Préférences</button>
          {!demo && <button type="button" className="button outline" aria-label="Recharger les notifications" onClick={() => setReloadKey((k) => k + 1)}><Icon name="refresh" size={18} /></button>}
        </div>
      </div>
      <p className={styles.summary}>Aucun e-mail, SMS ni notification push n’est envoyé : les notifications se consultent dans cet espace.</p>
      {showPreferences && <PreferencesPanel client={client} demo={demo?.preferences} writable={writable} context={context} onClose={() => setShowPreferences(false)} />}
      {list.status === "loading" && list.items.length === 0 && <Loader label="Chargement des notifications…" />}
      {list.status === "error" && (
        <div className="alert" role="alert">
          <p className={styles.error}>{list.message}</p>
          <button type="button" className="button outline" onClick={() => setReloadKey((k) => k + 1)}>Réessayer</button>
        </div>
      )}
      {list.status === "ready" && list.items.length === 0 && <Empty level={2} icon="bell" title={unreadOnly ? NOTIFICATION_COPY.emptyUnread : NOTIFICATION_COPY.empty}>Les événements de vos dossiers apparaîtront ici. Aucun e-mail ni SMS n’est envoyé.</Empty>}
      {list.items.length > 0 && (
        <>
          {page && <p className={styles.summary}>{page.total} notification{page.total > 1 ? "s" : ""}{unreadOnly ? " non lue" + (page.total > 1 ? "s" : "") : ""} · {list.items.length} affichée{list.items.length > 1 ? "s" : ""}</p>}
          {/* Section heading under the page h1 so each notification title (h3) never skips a level. */}
          <h2 className="sr-only">Notifications reçues</h2>
          <ul className={styles.list}>
            {list.items.map((n) => (
              <li key={n.id}>
                <NotificationItem notification={n} pending={pending === n.id} writable={writable} error={itemError?.id === n.id ? itemError.message : null} onMark={(action) => mark({ action, ids: [n.id] }, n.id)} onOpen={onNavigate && n.intervention_id ? () => onNavigate("intervention", n.intervention_id!) : undefined} />
              </li>
            ))}
          </ul>
          {itemError?.id === "all" && <p className={styles.error} role="alert">{itemError.message}</p>}
          {page?.has_more && (
            <div className={styles.more}>
              <button type="button" className="button outline" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Chargement…" : "Afficher les suivantes"}</button>
            </div>
          )}
          {itemError?.id === "more" && <p className={styles.error} role="alert">{itemError.message}</p>}
        </>
      )}
    </div>
  );
}
function NotificationItem({ notification: n, pending, writable, error, onMark, onOpen }: { notification: Notification; pending: boolean; writable: boolean; error: string | null; onMark: (action: "mark_read" | "mark_unread") => void; onOpen?: () => void }) {
  const unread = !n.read_at;
  return (
    <article className={`${styles.item} ${unread ? styles.itemUnread : ""}`} aria-label={`${n.title}${unread ? ", non lue" : ""}`}>
      <span className={styles.itemIcon} aria-hidden="true"><Icon name={KIND_ICONS[n.kind] ?? "bell"} size={18} /></span>
      <h3 className={styles.itemTitle}>{n.title}{unread && <Tag tone="blue">Non lue</Tag>}</h3>
      <p className={styles.itemBody}>{n.body}</p>
      <div className={styles.itemMeta}>
        <time dateTime={n.created_at}>{when(n.created_at)}</time>
        <span>{KIND_LABELS[n.kind] ?? "Notification"}</span>
        {onOpen && <button type="button" className="text-button" onClick={onOpen}>Ouvrir le dossier</button>}
        {writable && <button type="button" className="text-button" disabled={pending} onClick={() => onMark(unread ? "mark_read" : "mark_unread")}>{pending ? "Marquage…" : unread ? "Marquer comme lue" : "Marquer comme non lue"}</button>}
      </div>
      {error && <p className={styles.itemError} role="alert">{error}</p>}
    </article>
  );
}
/** Also mounted on its own (client profile, CLI-09): same load/save contract, no copy of the form. */
export function PreferencesPanel({ client, demo, writable, onClose, context }: { client: NotificationsClient; demo?: PreferencesView; writable: boolean; onClose?: () => void; context?: { generation(): number; userId(): string | null } }) {
  const id = useId();
  const [view, setView] = useState<PreferencesView | null | undefined>(demo ?? undefined);
  const [loadError, setLoadError] = useState("");
  const [muted, setMuted] = useState<Set<NotificationKind>>(new Set(demo?.preferences.muted_kinds ?? []));
  const [channels, setChannels] = useState({ email: demo?.preferences.email_enabled ?? false, sms: demo?.preferences.sms_enabled ?? false, push: demo?.preferences.push_enabled ?? false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pushTagState, setPushTag] = useState<PushTag>(null);
  useEffect(() => {
    if (demo) return;
    let active = true;
    client.loadPreferences()
      .then((answer) => { if (!active || answer === null) return; setView(answer); setMuted(new Set(answer.preferences.muted_kinds)); setChannels({ email: answer.preferences.email_enabled, sms: answer.preferences.sms_enabled, push: answer.preferences.push_enabled }); })
      .catch((e: unknown) => { if (active) setLoadError(e instanceof Error && e.message ? e.message : "Les préférences n’ont pas pu être chargées."); });
    return () => { active = false; };
  }, [client, demo]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!view) return;
    setBusy(true); setError(""); setSaved("");
    try {
      const answer = await client.savePreferences({ muted_kinds: [...muted], email_enabled: channels.email, sms_enabled: channels.sms, push_enabled: channels.push, expected_version: view.preferences.version });
      if (answer === null) return;
      if (!answer.ok) { setError(answer.conflict ? `${answer.message} Rechargez les préférences avant de réessayer.` : answer.message); return; }
      setView(answer.view); setSaved("Préférences enregistrées.");
    } catch (e) { setError(e instanceof Error && e.message ? e.message : "Les préférences n’ont pas pu être enregistrées."); }
    finally { setBusy(false); }
  };
  if (loadError) return <div className="alert" role="alert"><p className={styles.error}>{loadError}</p></div>;
  if (view === undefined) return <Loader label="Chargement des préférences…" />;
  if (!view) return null;
  return (
    <form className={styles.prefs} onSubmit={submit} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Préférences de notification</h2>
      <fieldset className={styles.prefsGroup} disabled={!writable}>
        <legend>Événements affichés dans cet espace</legend>
        {view.kinds.map(({ kind, label }) => (
          <label key={kind} className={styles.prefsOption}>
            <input type="checkbox" checked={!muted.has(kind)} onChange={(e) => setMuted((prev) => { const next = new Set(prev); if (e.target.checked) next.delete(kind); else next.add(kind); return next; })} />
            {label}
          </label>
        ))}
      </fieldset>
      <fieldset className={styles.prefsGroup} disabled={!writable}>
        <legend>Canaux externes</legend>
        {(["email", "sms", "push"] as ExternalChannel[]).map((channel) => (
          <label key={channel} className={styles.prefsOption}>
            <input type="checkbox" checked={channels[channel]} onChange={(e) => setChannels((prev) => ({ ...prev, [channel]: e.target.checked }))} />
            {CHANNEL_LABELS[channel]}
            {channel === "push" && pushTagState ? (
              <Tag tone="green">{TAG_LABEL[pushTagState]}</Tag>
            ) : channel === "push" ? (
              <Tag tone="amber">{view.channels.push === "available" ? "Non activé sur ce navigateur" : NOTIFICATION_COPY.channelsUnavailable}</Tag>
            ) : (
              <Tag tone={view.channels[channel] === "available" ? "green" : "amber"}>{view.channels[channel] === "available" ? "Actif" : NOTIFICATION_COPY.channelsUnavailable}</Tag>
            )}
          </label>
        ))}
        <small className={styles.demoNote}>{view.channels_note}</small>
      </fieldset>
      {(demo || (context && writable)) && <WebPushPanel demo={Boolean(demo)} pushSaved={view.preferences.push_enabled} context={context ?? { generation: () => 0, userId: () => null }} onTag={setPushTag} />}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {saved && <p className={styles.notice} role="status">{saved}</p>}
      <div className={styles.prefsActions}>
        {writable && <button type="submit" className="button primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</button>}
        {onClose && <button type="button" className="text-button" onClick={onClose}>Fermer</button>}
      </div>
    </form>
  );
}
