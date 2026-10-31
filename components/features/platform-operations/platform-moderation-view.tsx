"use client";
// Review moderation (contract §7, A2.3): hide/restore with audited notes, decide contestations. Reviews are never deleted.
import { useCallback, useState } from "react";
import type { ContractState, ModeratedReview, PlatformAccess, PlatformClient, PlatformViewScope } from "../../../lib/features/platform-operations/types";
import { moderationAction, validateModeration, validateText } from "../../../lib/features/platform-operations/state-machines";
import type { PlatformDemo } from "../../../lib/features/platform-operations/demo";
import { EmptyState, ErrorBox, Field, Gate, Loading, Pager, Panel, ReadOnly, dateTime, errorText, scopeKey, shortId, useLoad } from "./shared";
import styles from "./platform-operations.module.css";

export type PlatformModerationViewProps = { state: ContractState; unavailableMessage: string; scope: PlatformViewScope; client: PlatformClient; demo?: PlatformDemo; onNavigate?: (view: string, param?: string) => void };
const DEMO_NOTE = "Mode démonstration : aucune action n’est envoyée.";

export function PlatformModerationView(props: PlatformModerationViewProps) {
  return <Gate state={props.state} unavailableMessage={props.unavailableMessage} title="Modération des avis"><Inner key={scopeKey(props.scope)} {...props} /></Gate>;
}
function Inner({ scope, client, demo, onNavigate }: PlatformModerationViewProps) {
  const [filter, setFilter] = useState<"" | "hidden" | "contested">("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const me = useLoad<PlatformAccess>(() => (demo ? Promise.resolve(demo.access) : client.load.me()), [demo]);
  const list = useLoad(() => (demo ? Promise.resolve({ reviews: demo.reviews, page: { limit: 25, total: demo.reviews.length, has_more: false, next_cursor: null } }) : client.load.reviews({ state: filter === "hidden" ? "hidden" : null, contested: filter === "contested" ? "open" : null, cursor, limit: 25 })), [demo, filter, cursor]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ review: string; kind: "moderate" | "decide"; contestation?: string; decision: "upheld" | "dismissed"; note: string; error: string } | null>(null);
  const act = useCallback(async (work: () => Promise<unknown | null>, done: string) => {
    if (busy) return;
    if (demo) { setMessage({ kind: "error", text: DEMO_NOTE }); return; }
    setBusy(true); setMessage(null);
    try { const result = await work(); if (result !== null) { setMessage({ kind: "ok", text: done }); setDraft(null); list.reload(); } }
    catch (e) { setMessage({ kind: "error", text: errorText(e) }); } finally { setBusy(false); }
  }, [busy, demo, list]);
  if (me.loading && !me.data) return <Loading label="Chargement des droits…" />;
  if (me.error && !me.data) return <ErrorBox message={me.error} onRetry={me.reload} />;
  if (!me.data?.capabilities.reviews_moderation) return <div className="forbidden"><strong>Cet espace nécessite le scope de modération des avis.</strong><p>Demandez l’habilitation à un super administrateur.</p></div>;
  const canWrite = scope.authority.canWrite && !demo;
  return (
    <div className={styles.view}>
      <div className={styles.head}><div><h2>Modération des avis</h2><p>Un avis masqué reste conservé et audité ; il disparaît des lectures tierces et des moyennes. L’artisan noté peut contester, la décision est tracée.</p></div></div>
      {!scope.authority.canWrite && <ReadOnly reason={scope.authority.reason} />}
      {demo && <p className={styles.alert}>{DEMO_NOTE}</p>}
      {message && <p className={message.kind === "ok" ? styles.success : styles.error} role={message.kind === "ok" ? "status" : "alert"}>{message.text}</p>}
      <Panel title="Avis" action={<div className={styles.toolbar}><label>Filtre<select value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setCursors([null]); }}><option value="">Tous</option><option value="hidden">Masqués</option><option value="contested">Contestation ouverte</option></select></label></div>}>
        {list.loading && !list.data ? <Loading /> : list.error && !list.data ? <ErrorBox message={list.error} onRetry={list.reload} /> : !list.data?.reviews.length ? <EmptyState title="Aucun avis pour ce filtre" /> : (
          <ul className={styles.list}>{list.data.reviews.map((r) => <ReviewCard key={r.id} review={r} canWrite={canWrite} busy={busy} draft={draft?.review === r.id ? draft : null} setDraft={setDraft} onNavigate={onNavigate}
            onModerate={(review, note) => act(() => client.command.moderateReview(review.id, { action: moderationAction(review.moderation?.state ?? null), expected_version: review.moderation?.version ?? null, note }), review.moderation?.state === "hidden" ? "Avis rétabli." : "Avis masqué ; il reste conservé.")}
            onDecide={(review, contestation, decision, note) => act(() => client.command.decideContestation(review.id, { contestation_id: contestation.id, decision, expected_version: contestation.version, note }), decision === "upheld" ? "Contestation retenue : l’avis est masqué." : "Contestation rejetée.")} />)}</ul>
        )}
        {list.data && <Pager page={list.data.page} canPrev={cursors.length > 1} onPrev={() => setCursors((c) => c.slice(0, -1))} onNext={() => list.data?.page.next_cursor && setCursors((c) => [...c, list.data!.page.next_cursor])} />}
      </Panel>
    </div>
  );
}
type Draft = { review: string; kind: "moderate" | "decide"; contestation?: string; decision: "upheld" | "dismissed"; note: string; error: string };
function ReviewCard({ review, canWrite, busy, draft, setDraft, onModerate, onDecide, onNavigate }: { review: ModeratedReview; canWrite: boolean; busy: boolean; draft: Draft | null; setDraft: (d: Draft | null) => void; onModerate: (review: ModeratedReview, note: string) => void; onDecide: (review: ModeratedReview, contestation: ModeratedReview["contestations"][number], decision: "upheld" | "dismissed", note: string) => void; onNavigate?: (view: string, param?: string) => void }) {
  const hidden = review.moderation?.state === "hidden";
  const open = review.contestations.find((c) => c.status === "open");
  return (
    <li className={styles.card}>
      <div className={styles.panelHead}>
        <strong>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)} <span className={styles.srOnly}>{review.rating} sur 5</span> · {dateTime(review.created_at)}</strong>
        <span className={styles.actions}><span className={`tag ${hidden ? "tag-amber" : "tag-green"}`}>{hidden ? "Masqué" : "Visible"}</span>{open && <span className="tag tag-red">Contestation ouverte</span>}</span>
      </div>
      <p>{review.body || <em className={styles.hint}>Sans commentaire.</em>}</p>
      <dl className={styles.kv}><dt>Dossier</dt><dd>{onNavigate ? <button type="button" className="text-button" onClick={() => onNavigate("intervention", review.intervention_id)}>{shortId(review.intervention_id)}</button> : shortId(review.intervention_id)}</dd><dt>Auteur</dt><dd className={styles.mono}>{shortId(review.author_id)}</dd>{review.moderation && <><dt>Modération</dt><dd>version {review.moderation.version} · {dateTime(review.moderation.updated_at)}{review.moderation.note && ` — ${review.moderation.note}`}</dd></>}</dl>
      {review.contestations.length > 0 && <ul className={styles.list}>{review.contestations.map((c) => <li key={c.id} className={styles.details}><span><strong>Contestation</strong> · {{ open: "ouverte", upheld: "retenue", dismissed: "rejetée" }[c.status]} · {dateTime(c.created_at)}</span><span>{c.reason}</span>{c.decided_at && <span>Décision {dateTime(c.decided_at)} — {c.decision_note}</span>}</li>)}</ul>}
      {canWrite && (draft
        ? <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); if (draft.kind === "moderate") { const err = validateModeration({ action: moderationAction(review.moderation?.state ?? null), note: draft.note }); if (err) { setDraft({ ...draft, error: err }); return; } onModerate(review, draft.note.trim()); } else if (open) { const err = validateText(draft.note, 10, 1000, "Note"); if (err) { setDraft({ ...draft, error: err }); return; } onDecide(review, open, draft.decision, draft.note.trim()); } }}>
          {draft.kind === "decide" && <Field label="Décision"><select value={draft.decision} onChange={(e) => setDraft({ ...draft, decision: e.target.value as Draft["decision"] })}><option value="upheld">Retenir (masque l’avis)</option><option value="dismissed">Rejeter (l’avis reste visible)</option></select></Field>}
          <Field label={draft.kind === "moderate" ? (hidden ? "Note de rétablissement (facultative)" : "Motif du masquage") : "Note de décision"} error={draft.error} full><textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} maxLength={1000} /></Field>
          <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>Confirmer</button><button type="button" className={styles.button} onClick={() => setDraft(null)}>Annuler</button></div>
        </form>
        : <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={busy} onClick={() => setDraft({ review: review.id, kind: "moderate", decision: "upheld", note: "", error: "" })}>{hidden ? "Rétablir" : "Masquer"}</button>
          {open && <button type="button" className={styles.button} disabled={busy} onClick={() => setDraft({ review: review.id, kind: "decide", contestation: open.id, decision: "upheld", note: "", error: "" })}>Trancher la contestation</button>}
        </div>)}
    </li>
  );
}
