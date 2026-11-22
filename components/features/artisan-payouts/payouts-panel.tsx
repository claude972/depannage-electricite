"use client";
// FIN-06 — « Versements vers votre compte bancaire » for the artisan: what Stripe reports for their
// own settlement account. Aggregated payouts (never per dossier); « versé » is Stripe's status.
import { useCallback, useEffect, useState } from "react";
import { PAYOUT_STATUS_LABEL, payoutsReport, type PayoutsReport } from "../../../lib/features/artisan-payouts/model";

type View = { phase: "loading" } | { phase: "error" } | { phase: "ready"; report: PayoutsReport };
const euros = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export function ArtisanPayoutsPanel({ identity, fetcher }: { /** Account + session generation. */ identity: string; /** Tests only. */ fetcher?: typeof fetch }) {
  const [view, setView] = useState<{ key: string; value: View }>({ key: identity, value: { phase: "loading" } });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setView({ key: identity, value: { phase: "loading" } });
    void (async () => {
      try {
        const r = await (fetcher ?? fetch)("/api/artisan/payouts", { credentials: "same-origin", cache: "no-store" });
        const parsed = r.status === 200 ? payoutsReport.safeParse(await r.json()) : null;
        if (active) setView({ key: identity, value: parsed?.success ? { phase: "ready", report: parsed.data } : { phase: "error" } });
      } catch {
        if (active) setView({ key: identity, value: { phase: "error" } });
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const v: View = view.key === identity ? view.value : { phase: "loading" };
  return (
    <section className="panel" aria-labelledby="artisan-payouts-title" data-artisan-payouts={v.phase === "ready" ? v.report.state : v.phase}>
      <h2 id="artisan-payouts-title" style={{ fontSize: 17, marginBottom: 8 }}>Versements vers votre compte bancaire</h2>
      <p style={{ marginBottom: 8 }}>
        Versements regroupés émis par Stripe depuis votre compte de règlement, relus chez Stripe à l’ouverture de cette page. Un versement regroupe plusieurs règlements : il n’est pas rattaché à un dossier. « Versé » est l’état indiqué par Stripe, pas un accusé de réception de votre banque.
      </p>
      {v.phase === "loading" && <p role="status">Lecture des versements…</p>}
      {v.phase === "error" && (
        <p role="alert">Les versements n’ont pas pu être lus pour le moment. <button type="button" className="text-button" onClick={retry}>Réessayer</button></p>
      )}
      {v.phase === "ready" && v.report.state === "no_account" && <p>Aucun compte de règlement Stripe n’est relié à votre profil : aucun versement ne peut être émis. La configuration se fait depuis votre profil.</p>}
      {v.phase === "ready" && v.report.state === "provider_unavailable" && <p role="status">Le prestataire de paiement n’est pas joignable depuis ce service pour le moment : les versements ne peuvent pas être affichés. Cela ne signifie pas qu’aucun versement n’existe.</p>}
      {v.phase === "ready" && v.report.state === "available" && (v.report.payouts.length === 0 ? (
        <p>Stripe n’indique encore aucun versement pour votre compte de règlement.</p>
      ) : (
        <>
          {v.report.livemode === false && <p><span className="tag">Mode test</span> Versements du mode test de Stripe : aucun mouvement bancaire réel.</p>}
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {v.report.payouts.map((p) => (
              <li key={p.id} data-payout-status={p.status} style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between", borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 8 }}>
                <span><strong>{euros(p.amount_cents)}</strong> — {PAYOUT_STATUS_LABEL[p.status]}</span>
                <span>émis le {day(p.created_at)}{p.arrival_date ? ` · arrivée prévue ou indiquée le ${day(p.arrival_date)}` : ""}{p.automatic ? "" : " · versement manuel"}</span>
              </li>
            ))}
          </ul>
          {v.report.has_more && <p>Seuls les 20 versements les plus récents sont affichés ; l’historique complet figure dans votre espace Stripe.</p>}
        </>
      ))}
    </section>
  );
}
