"use client";
// Super back-office — explicit operator scopes and super administrators (contract A1.2). Rights come from /me only.
import { useCallback, useMemo, useState } from "react";
import type { ContractState, OperatorGrant, PlatformAccess, PlatformClient, PlatformScopeKey, PlatformViewScope } from "../../../lib/features/platform-operations/types";
import { PLATFORM_SCOPES } from "../../../lib/features/platform-operations/types";
import { UUID_RE } from "../../../lib/features/platform-operations/state-machines";
import type { PlatformDemo } from "../../../lib/features/platform-operations/demo";
import { EmptyState, ErrorBox, Field, Gate, Loading, Pager, Panel, ReadOnly, dateTime, errorText, scopeKey, shortId, useLoad } from "./shared";
import styles from "./platform-operations.module.css";

export type PlatformOperatorsViewProps = { state: ContractState; unavailableMessage: string; scope: PlatformViewScope; client: PlatformClient; demo?: PlatformDemo; onNavigate?: (view: string, param?: string) => void };
const SCOPE_LABELS: Record<PlatformScopeKey, string> = { finance_read: "Finance — lecture", finance_write: "Finance — écriture", reviews_moderate: "Modération des avis", audit_read: "Journal plateforme" };
const DEMO_NOTE = "Mode démonstration : aucune action n’est envoyée.";

export function PlatformOperatorsView(props: PlatformOperatorsViewProps) {
  return <Gate state={props.state} unavailableMessage={props.unavailableMessage} title="Opérateurs de plateforme"><Inner key={scopeKey(props.scope)} {...props} /></Gate>;
}
function Inner({ scope, client, demo }: PlatformOperatorsViewProps) {
  const [status, setStatus] = useState<"" | "active" | "revoked">("active");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const me = useLoad<PlatformAccess>(() => (demo ? Promise.resolve(demo.access) : client.load.me()), [demo]);
  const list = useLoad(() => (demo ? Promise.resolve({ grants: demo.grants.filter((g) => !status || g.status === status), page: { limit: 25, total: demo.grants.length, has_more: false, next_cursor: null } }) : client.load.operators({ status: status || null, cursor, limit: 25 })), [demo, status, cursor]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = scope.authority.canWrite && me.data?.super_admin === true && !demo;
  const act = useCallback(async (work: () => Promise<unknown | null>, done: string) => {
    if (busy) return;
    if (demo) { setMessage({ kind: "error", text: DEMO_NOTE }); return; }
    setBusy(true); setMessage(null);
    try { const result = await work(); if (result !== null) { setMessage({ kind: "ok", text: done }); list.reload(); me.reload(); } }
    catch (e) { setMessage({ kind: "error", text: errorText(e) }); } finally { setBusy(false); }
  }, [busy, demo, list, me]);
  if (me.loading && !me.data) return <Loading label="Chargement des droits…" />;
  if (me.error && !me.data) return <ErrorBox message={me.error} onRetry={me.reload} />;
  if (!me.data?.super_admin) return <div className="forbidden"><strong>Gestion des opérateurs réservée aux super administrateurs.</strong><p>Vos droits actuels : {me.data?.scopes.length ? me.data.scopes.map((s) => SCOPE_LABELS[s]).join(", ") : "aucun scope plateforme"}.</p></div>;
  return (
    <div className={styles.view}>
      <div className={styles.head}><div><h2>Opérateurs de plateforme</h2><p>Chaque droit est un scope explicite accordé côté serveur, distinct du rôle super administrateur et des organisations clientes. La visibilité d’un menu ne confère aucun droit.</p></div></div>
      {!scope.authority.canWrite && <ReadOnly reason={scope.authority.reason} />}
      {demo && <p className={styles.alert}>{DEMO_NOTE}</p>}
      {message && <p className={message.kind === "ok" ? styles.success : styles.error} role={message.kind === "ok" ? "status" : "alert"}>{message.text}</p>}
      <Panel title="Scopes accordés" intro={`Super administrateurs actifs : ${me.data.super_admin_count ?? "—"}. Un super administrateur détient tout implicitement et ne reçoit aucun scope.`}
        action={<div className={styles.toolbar}><label>Statut<select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setCursors([null]); }}><option value="">Tous</option><option value="active">Actifs</option><option value="revoked">Révoqués</option></select></label></div>}>
        <GrantTable list={list} canWrite={canWrite} busy={busy} onRevoke={(grant) => act(() => client.command.revoke({ grant_id: grant.id, note: "" }), "Scope révoqué ; l’historique est conservé.")} />
        {list.data && <Pager page={list.data.page} canPrev={cursors.length > 1} onPrev={() => setCursors((c) => c.slice(0, -1))} onNext={() => list.data?.page.next_cursor && setCursors((c) => [...c, list.data!.page.next_cursor])} />}
      </Panel>
      {canWrite && <GrantForm busy={busy} onSubmit={(input) => act(() => client.command.grant(input), "Scope accordé et audité.")} />}
      {canWrite && <SuperAdminForm busy={busy} selfId={scope.userId} onSubmit={(input) => act(() => client.command.setSuperAdmin(input), input.enabled ? "Compte promu super administrateur ; ses scopes ont été révoqués." : "Statut super administrateur retiré.")} />}
    </div>
  );
}
function GrantTable({ list, canWrite, busy, onRevoke }: { list: ReturnType<typeof useLoad<{ grants: OperatorGrant[]; page: { limit: number; total: number; has_more: boolean; next_cursor: string | null } }>>; canWrite: boolean; busy: boolean; onRevoke: (grant: OperatorGrant) => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  if (list.loading && !list.data) return <Loading />;
  if (list.error && !list.data) return <ErrorBox message={list.error} onRetry={list.reload} />;
  if (!list.data?.grants.length) return <EmptyState title="Aucun scope pour ce filtre">Accordez un scope ci-dessous pour habiliter un opérateur sans lui donner le rôle super administrateur.</EmptyState>;
  return (
    <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>Scopes des opérateurs</caption>
      <thead><tr><th>Compte</th><th>Scope</th><th>Statut</th><th>Accordé</th><th>Révoqué</th>{canWrite && <th>Action</th>}</tr></thead>
      <tbody>{list.data.grants.map((g) => (
        <tr key={g.id}>
          <td>{g.full_name || "Compte"} <span className={styles.mono}>{shortId(g.user_id)}</span>{g.note && <div className={styles.hint}>{g.note}</div>}</td>
          <td>{SCOPE_LABELS[g.scope]}</td>
          <td><span className={`tag ${g.status === "active" ? "tag-green" : "tag-amber"}`}>{g.status === "active" ? "Actif" : "Révoqué"}</span></td>
          <td>{dateTime(g.granted_at)}</td>
          <td>{g.revoked_at ? <>{dateTime(g.revoked_at)}{g.revoke_note && <div className={styles.hint}>{g.revoke_note}</div>}</> : "—"}</td>
          {canWrite && <td>{g.status === "active" && (confirm === g.id
            ? <span className={styles.actions}><button type="button" className={`${styles.button} ${styles.destructive}`} disabled={busy} onClick={() => { setConfirm(null); onRevoke(g); }}>Confirmer la révocation</button><button type="button" className={styles.button} onClick={() => setConfirm(null)}>Annuler</button></span>
            : <button type="button" className={styles.button} disabled={busy} onClick={() => setConfirm(g.id)}>Révoquer</button>)}</td>}
        </tr>))}</tbody></table></div>
  );
}
function GrantForm({ busy, onSubmit }: { busy: boolean; onSubmit: (input: { user_id: string; scope: PlatformScopeKey; note: string }) => void }) {
  const [userId, setUserId] = useState(""); const [scopeKey_, setScope] = useState<PlatformScopeKey>("finance_read"); const [note, setNote] = useState(""); const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Panel title="Accorder un scope" intro="Le compte reste dans son rôle actuel ; seul le scope choisi est ajouté. Un super administrateur ne peut pas recevoir de scope.">
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); const next: Record<string, string> = {}; if (!UUID_RE.test(userId.trim())) next.userId = "Identifiant de compte invalide."; if (note.length > 500) next.note = "500 caractères au plus."; setErrors(next); if (!Object.keys(next).length) onSubmit({ user_id: userId.trim().toLowerCase(), scope: scopeKey_, note: note.trim() }); }}>
        <Field label="Identifiant du compte" hint="UUID du profil, tel qu’affiché dans l’annuaire." error={errors.userId}><input value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="off" aria-invalid={Boolean(errors.userId)} /></Field>
        <Field label="Scope"><select value={scopeKey_} onChange={(e) => setScope(e.target.value as PlatformScopeKey)}>{PLATFORM_SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABELS[s]}</option>)}</select></Field>
        <Field label="Note (facultative)" error={errors.note} full><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
        <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${styles.primary}`} disabled={busy}>Accorder</button></div>
      </form>
    </Panel>
  );
}
function SuperAdminForm({ busy, selfId, onSubmit }: { busy: boolean; selfId: string; onSubmit: (input: { user_id: string; enabled: boolean; restore_role?: "client" | "manager"; note: string }) => void }) {
  const [userId, setUserId] = useState(""); const [enabled, setEnabled] = useState(true); const [restore, setRestore] = useState<"client" | "manager">("client"); const [note, setNote] = useState(""); const [error, setError] = useState(""); const [confirm, setConfirm] = useState(false);
  const valid = useMemo(() => UUID_RE.test(userId.trim()) && userId.trim().toLowerCase() !== selfId.toLowerCase(), [userId, selfId]);
  return (
    <Panel title="Super administrateurs" intro="Action explicite et auditée. Le dernier super administrateur ne peut être ni retiré ni rétrogradé ; vous ne pouvez pas modifier votre propre statut.">
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); if (!valid) { setError(userId.trim().toLowerCase() === selfId.toLowerCase() ? "Votre propre statut ne se modifie pas ici." : "Identifiant de compte invalide."); return; } setError(""); if (!confirm) { setConfirm(true); return; } setConfirm(false); onSubmit({ user_id: userId.trim().toLowerCase(), enabled, restore_role: enabled ? undefined : restore, note: note.trim() }); }}>
        <Field label="Identifiant du compte" error={error}><input value={userId} onChange={(e) => { setUserId(e.target.value); setConfirm(false); }} autoComplete="off" aria-invalid={Boolean(error)} /></Field>
        <Field label="Décision"><select value={enabled ? "grant" : "revoke"} onChange={(e) => { setEnabled(e.target.value === "grant"); setConfirm(false); }}><option value="grant">Promouvoir super administrateur</option><option value="revoke">Retirer le statut</option></select></Field>
        {!enabled && <Field label="Rôle restitué"><select value={restore} onChange={(e) => setRestore(e.target.value as "client" | "manager")}><option value="client">Particulier</option><option value="manager">Gestionnaire</option></select></Field>}
        <Field label="Note (facultative)" full><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
        {confirm && <p className={`${styles.alert} ${styles.full}`} role="status">Confirmez : {enabled ? "ce compte obtiendra tous les droits de la plateforme et ses scopes seront révoqués." : "ce compte perdra tous les droits de super administrateur."}</p>}
        <div className={`${styles.actions} ${styles.full}`}><button type="submit" className={`${styles.button} ${confirm ? styles.destructive : ""}`} disabled={busy}>{confirm ? "Confirmer" : "Continuer"}</button>{confirm && <button type="button" className={styles.button} onClick={() => setConfirm(false)}>Annuler</button>}</div>
      </form>
    </Panel>
  );
}
