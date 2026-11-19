"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, ApiRequestError } from "../../app/api";
import { reviewContestation, reviewContestationHistory, type ReviewContestationHistory } from "../../../shared/review-contestation";

type Context = { generation(): number; userId(): string | null };
type Props = { reviewId: string; context: Context; demo?: boolean };
export function ReviewContestationPanel(props: Props) {
  return <Inner key={`${props.context.userId()}|${props.context.generation()}|${props.reviewId}`} {...props} />;
}
function Inner({ reviewId, context, demo }: Props) {
  const label = useId();
  const owner = useRef({ user: context.userId(), generation: context.generation() }).current;
  const mounted = useRef(false), lock = useRef(false);
  const pending = useRef<{ request_id: string; reason: string } | null>(null);
  const [history, setHistory] = useState<ReviewContestationHistory | null>(null);
  const [error, setError] = useState(""), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const path = `/api/platform-operations/reviews/${encodeURIComponent(reviewId)}`;
  const alive = () => mounted.current && owner.user !== null && context.userId() === owner.user && context.generation() === owner.generation;
  useEffect(() => {
    mounted.current = true;
    let current = true;
    if (!demo && alive()) {
      setHistory(null); setError("");
      void api<unknown>(path).then(raw => {
        if (!current || !alive()) return;
        const parsed = reviewContestationHistory.safeParse(raw);
        if (!parsed.success || parsed.data.review.id !== reviewId) throw Error("L’historique de cet avis n’a pas pu être vérifié.");
        setHistory(parsed.data);
      }).catch(issue => { if (current && alive()) setError(issue instanceof Error ? issue.message : "Lecture indisponible."); });
    }
    return () => { current = false; mounted.current = false; };
    // Inner is keyed by actor, generation and review. A retry starts a fresh guarded read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, attempt, demo]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (demo || lock.current || !alive() || !history) return;
    const value = reason.trim();
    if (!pending.current && (value.length < 10 || value.length > 2000 || value.includes("\u0000"))) { setError("Expliquez votre contestation en 10 à 2 000 caractères."); return; }
    if (!pending.current) pending.current = { request_id: crypto.randomUUID(), reason: value };
    const command = pending.current;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const raw = await api<{ contestation: unknown }>(path, { action: "contest", ...command });
      if (!alive()) return;
      const parsed = reviewContestation.safeParse(raw.contestation);
      if (!parsed.success || parsed.data.review_id !== reviewId || parsed.data.request_id !== command.request_id || parsed.data.reason !== command.reason)
        throw Error("L’envoi n’a pas pu être confirmé. Réessayez pour vérifier cette même contestation.");
      pending.current = null; setReason("");
      setHistory(previous => previous && ({ ...previous, contestations: [parsed.data, ...previous.contestations.filter(item => item.id !== parsed.data.id)] }));
      setNotice("Votre contestation a été enregistrée. Elle sera examinée par la plateforme.");
    } catch (issue) {
      if (alive()) {
        if (issue instanceof ApiRequestError && [400, 422].includes(issue.status)) pending.current = null;
        setError(issue instanceof Error ? issue.message : "L’envoi n’a pas pu être confirmé.");
      }
    } finally { lock.current = false; if (alive()) setBusy(false); }
  }
  const open = history?.contestations.some(item => item.status === "open");
  return <section className="panel" aria-labelledby={label}>
    <h2 id={label}>Avis du client</h2>
    {demo ? <p>La contestation d’avis n’est pas simulée dans cette démonstration.</p> : <>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!history ? error ? <button type="button" className="button outline" onClick={() => setAttempt(n => n + 1)}>Recharger l’avis</button> : <p role="status">Chargement de l’avis…</p> : <>
        <p><strong>{history.review.rating} / 5</strong> · {history.review.body || "Sans commentaire."}</p>
        {history.contestations.length > 0 && <ul>{history.contestations.map(item => <li key={item.id}>
          <strong>Contestation {{ open: "ouverte", upheld: "retenue", dismissed: "rejetée" }[item.status]}</strong> : {item.reason}
          {item.decision_note && <p>Décision : {item.decision_note}</p>}
        </li>)}</ul>}
        <button type="button" className="button outline" disabled={busy} onClick={() => setAttempt(n => n + 1)}>Actualiser la décision</button>
        {history.limited && <p>Seules les 50 contestations les plus récentes sont affichées.</p>}
        {open ? <p>Une contestation est déjà ouverte pour cet avis.</p> : <form onSubmit={event => void submit(event)}>
          <label htmlFor={`${label}-reason`}>Motif de la contestation</label>
          <textarea id={`${label}-reason`} value={reason} maxLength={2000} disabled={busy || Boolean(pending.current)} onChange={event => setReason(event.target.value)} aria-describedby={`${label}-help`} />
          <p id={`${label}-help`}>De 10 à 2 000 caractères. La plateforme examine votre demande ; l’avis n’est pas masqué automatiquement.</p>
          {pending.current && <p>Une tentative reste à confirmer. Le bouton reprend le même envoi sans créer de doublon.</p>}
          <button className="button primary" disabled={busy} type="submit">{busy ? "Envoi en cours…" : pending.current ? "Vérifier et reprendre l’envoi" : "Contester cet avis"}</button>
        </form>}
      </>}
    </>}
  </section>;
}
