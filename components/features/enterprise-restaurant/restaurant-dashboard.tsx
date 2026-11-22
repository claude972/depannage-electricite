"use client";
// ENT-06 — restaurant view of a site of type « Restauration » and the target deadline of a ticket.
// Read-only: one GET /api/enterprise/ticket-deadlines (server-computed, caller's own rights). Nothing
// is recomputed in the browser; a failed read is an error, never an empty dashboard.
import { useEffect, useRef, useState } from "react";
import type { Ticket, TicketDeadline, TicketDeadlinesReport } from "../../../lib/features/enterprise-ticket-deadlines/model";
import { CRITICALITY, EQUIPMENT_CATEGORY, EQUIPMENT_STATUS, NOT_MEASURABLE, dateTime, minutes } from "../../../lib/features/site-operations/labels";
import styles from "./restaurant-dashboard.module.css";

type Context = { generation(): number; userId(): string | null };
type View = { phase: "loading" } | { phase: "error"; text: string; denied: boolean } | { phase: "ready"; report: TicketDeadlinesReport };
const TIMEOUT_MS = 15_000;

export const DEADLINE_RULE =
  "Règle de calcul : l’échéance d’un ticket vient de la règle de délai active du site pour son urgence (une règle propre à cette urgence passe avant une règle « toutes urgences », puis la plus récente). Le délai court à partir de la création de la demande, sur les plages du calendrier de la règle. La réponse est la première prise en charge enregistrée au journal du dossier ; la résolution est la fin de l’intervention. Si un dossier de délai du site est relié au ticket, ses dates constatées et ses pauses priment.";
export const NO_COMMITMENT = "Pas d’engagement de délai défini";
const PARTIAL: Record<string, string> = {
  equipment_limited: "plus de 300 équipements : seuls les plus récents sont pris en compte",
  rules_limited: "plus de 100 règles de délai : seules les plus récentes sont prises en compte",
  cases_limited: "plus de 300 dossiers de délai : seuls les plus récents sont pris en compte",
  tickets_limited: "plus de 200 tickets : seuls les 200 plus récents sont affichés",
  links_limited: "liens tickets-équipements trop nombreux : certains liens ne sont pas chargés",
  equipment_links_limited: "plus de 40 équipements critiques ou élevés : les liens des suivants ne sont pas chargés",
};

async function read(siteId: string, interventionId?: string): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`/api/enterprise/ticket-deadlines?site_id=${encodeURIComponent(siteId)}${interventionId ? `&intervention_id=${encodeURIComponent(interventionId)}` : ""}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}
function isReport(body: unknown): body is TicketDeadlinesReport {
  const b = body as TicketDeadlinesReport | null;
  return !!b && typeof b === "object" && Array.isArray(b.tickets) && Array.isArray(b.critical_equipment) && !!b.summary && !!b.site && Array.isArray(b.partial);
}
function useDeadlines(siteId: string, context: Context, interventionId?: string) {
  const [view, setView] = useState<View>({ phase: "loading" });
  const seq = useRef(0);
  const ctx = useRef(context);
  ctx.current = context;
  const load = async () => {
    const my = ++seq.current;
    const gen = ctx.current.generation(), uid = ctx.current.userId();
    setView({ phase: "loading" });
    const r = await read(siteId, interventionId);
    if (my !== seq.current || ctx.current.generation() !== gen || ctx.current.userId() !== uid) return;
    if (r.status === 200 && isReport(r.body)) setView({ phase: "ready", report: r.body });
    else if ([401, 403, 404].includes(r.status)) setView({ phase: "error", denied: true, text: "Vous n’avez pas accès aux délais de ce site." });
    else setView({ phase: "error", denied: false, text: "Les délais des tickets n’ont pas pu être vérifiés. Réessayez." });
  };
  useEffect(() => {
    void load();
    return () => {
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, interventionId]);
  return { view, reload: () => void load() };
}

const STATE_LABEL: Record<TicketDeadline["state"], string> = {
  overdue: "En retard",
  pending: "Dans les délais",
  paused: "Délai en pause",
  met: "Délai tenu",
  missed: "Délai dépassé",
  not_measurable: "Délai non calculable",
  none: NO_COMMITMENT,
  cancelled: "Ticket annulé : aucun délai suivi",
};
const stateTone = (s: TicketDeadline["state"]) => (s === "overdue" || s === "missed" ? "red" : s === "pending" || s === "met" ? "green" : s === "paused" ? "amber" : "neutral");

/** Wording of ONE ticket deadline (shared by the dashboard rows and the dossier line). */
export function DeadlineText({ deadline }: { deadline: TicketDeadline }) {
  const d = deadline;
  if (d.basis === "cancelled") return <span data-ticket-deadline="cancelled">{STATE_LABEL.cancelled}</span>;
  if (d.basis === "none")
    return (
      <span data-ticket-deadline="none">
        <span className={`tag tag-neutral`}>{NO_COMMITMENT}</span> <small>Aucune règle de délai active du site ne couvre cette urgence.</small>
      </span>
    );
  const track = (label: string, t: TicketDeadline["response"], fact: string | null, factLabel: string) =>
    t && t.target_minutes !== null ? (
      <small data-ticket-track={label}>
        {label} : cible {minutes(t.target_minutes)}
        {t.deadline_at ? ` · échéance ${dateTime(t.deadline_at)}` : ""}
        {t.status === "not_measurable" ? ` · non calculable (${t.reason ? NOT_MEASURABLE[t.reason] : "donnée manquante"})` : fact ? ` · ${factLabel} ${dateTime(fact)} — ${t.status === "met" ? "tenu" : "dépassé"}` : t.status === "breached" ? " — dépassée" : t.remaining_minutes !== null ? ` · reste ${minutes(t.remaining_minutes)} ouvrées` : ""}
      </small>
    ) : null;
  return (
    <span data-ticket-deadline={d.state} data-ticket-due={d.due_at ?? ""}>
      <span className={`tag tag-${stateTone(d.state)}`}>{STATE_LABEL[d.state]}</span>{" "}
      {d.due_at && (
        <strong className={styles.due}>
          {d.resolved_at ? "Échéance" : d.due_kind === "response" ? "Réponse attendue avant le" : "Résolution attendue avant le"} {dateTime(d.due_at)}
        </strong>
      )}
      {track("Réponse", d.response, d.responded_at, "prise en charge le")}
      {track("Résolution", d.resolution, d.resolved_at, "terminé le")}
      <small>
        {d.basis === "linked_case" ? `Dossier de délai relié${d.case_reference ? ` « ${d.case_reference} »` : ""} · ` : ""}
        Règle « {d.rule?.name} »{d.rule?.calendar_name ? ` · calendrier « ${d.rule.calendar_name} »` : " · aucun calendrier"}
      </small>
    </span>
  );
}

export type RestaurantDashboardProps = {
  siteId: string;
  context: Context;
  reference: (id: string) => string;
  categoryLabel: (category: string) => string;
  statusLabel: (status: string) => string;
  onOpen: (interventionId: string) => void;
};

/** Dashboard of a restaurant site: open tickets (critical equipment first) with status and deadline. */
export function RestaurantDashboard(props: RestaurantDashboardProps) {
  return <Dashboard key={`${props.context.userId() ?? "-"}|${props.context.generation()}|${props.siteId}`} {...props} />;
}
function Dashboard({ siteId, context, reference, categoryLabel, statusLabel, onOpen }: RestaurantDashboardProps) {
  const { view, reload } = useDeadlines(siteId, context);
  const [showClosed, setShowClosed] = useState(false);
  return (
    <section className={`panel ${styles.panel}`} aria-labelledby="restaurant-dashboard" data-restaurant-dashboard={view.phase} aria-busy={view.phase === "loading" || undefined}>
      <div className={styles.head}>
        <h2 id="restaurant-dashboard">Tableau de bord restauration</h2>
        {view.phase === "ready" && (
          <button type="button" className="button outline" onClick={reload}>
            Actualiser
          </button>
        )}
      </div>
      <p className={styles.muted}>Tickets ouverts du site, équipements critiques d’abord, avec leur statut et leur échéance cible. Consultation seule : les équipements, règles et calendriers se gèrent dans « Opérations du site ».</p>
      {view.phase === "loading" && <p className={styles.muted} role="status">Chargement des tickets et des délais…</p>}
      {view.phase === "error" && (
        <div role="alert">
          <p>{view.text}</p>
          {!view.denied && (
            <button type="button" className="button outline" onClick={reload}>
              Réessayer
            </button>
          )}
        </div>
      )}
      {view.phase === "ready" && (() => {
        const r = view.report;
        const open = r.tickets.filter((t) => t.open);
        const closed = r.tickets.filter((t) => !t.open && t.status !== "cancelled");
        const row = (t: Ticket) => (
          <li key={t.id} className={styles.row} data-restaurant-ticket={t.id} data-critical={t.critical ? "1" : "0"}>
            <div className={styles.rowMain}>
              <strong>
                {categoryLabel(t.category)} <span className={styles.ref}>{reference(t.id)}</span>
              </strong>
              <small>
                {statusLabel(t.status)} · {t.urgency === "urgent" ? "Urgent" : "Planifié"} · demandé le {dateTime(t.created_at)}
              </small>
              <small>
                {t.equipment.length
                  ? t.equipment.map((e) => `${e.name} (criticité ${CRITICALITY[e.criticality].toLowerCase()}, ${EQUIPMENT_STATUS[e.status].toLowerCase()})`).join(" · ")
                  : "Aucun équipement critique ou élevé relié"}
              </small>
              <div className={styles.deadline}>
                <DeadlineText deadline={t.deadline} />
              </div>
            </div>
            <div className={styles.rowSide}>
              {t.critical && <span className="tag tag-red">Équipement critique</span>}
              <button type="button" className="button outline" onClick={() => onOpen(t.id)} aria-label={`Ouvrir le dossier ${reference(t.id)}`}>
                Ouvrir le dossier
              </button>
            </div>
          </li>
        );
        return (
          <>
            <div className={styles.figures}>
              <Figure n={r.summary.open} label="tickets ouverts" name="open" />
              <Figure n={r.summary.open_critical} label="sur équipement critique" name="open_critical" />
              <Figure n={r.summary.overdue} label="en retard sur leur échéance" name="overdue" alert={r.summary.overdue > 0} />
              <Figure n={r.summary.without_commitment} label="sans engagement de délai" name="without_commitment" />
              <Figure n={r.summary.critical_equipment_not_in_service} label={`équipement(s) critique(s) dégradé(s) ou hors service sur ${r.summary.critical_equipment}`} name="critical_down" alert={r.summary.critical_equipment_not_in_service > 0} />
            </div>
            {r.partial.length > 0 && (
              <ul className={styles.partial} role="note" data-restaurant-partial="">
                {r.partial.map((p) => (
                  <li key={p}>Vue partielle : {PARTIAL[p] ?? p}.</li>
                ))}
              </ul>
            )}
            <h3 className={styles.sub}>Tickets ouverts</h3>
            {open.length ? <ul className={styles.list} data-restaurant-open="">{open.map(row)}</ul> : <p className={styles.muted} data-restaurant-open-empty="">Aucun ticket ouvert sur ce site.</p>}
            {r.rules.active === 0 && <p className={styles.muted} data-restaurant-no-rule="">Aucune règle de délai active sur ce site : aucun ticket n’a d’échéance. Une règle se crée dans « Opérations du site », onglet des délais.</p>}

            <h3 className={styles.sub}>Équipements critiques et de criticité élevée</h3>
            {r.critical_equipment.length ? (
              <ul className={styles.list} data-restaurant-equipment="">
                {r.critical_equipment.map((e) => (
                  <li key={e.id} className={styles.row} data-restaurant-equipment-row={e.id}>
                    <div className={styles.rowMain}>
                      <strong>{e.name}</strong>
                      <small>
                        {EQUIPMENT_CATEGORY[e.category]} · criticité {CRITICALITY[e.criticality].toLowerCase()}
                        {e.location ? ` · ${e.location}` : ""}
                      </small>
                      <small>
                        {e.open_tickets} ticket{e.open_tickets > 1 ? "s" : ""} ouvert{e.open_tickets > 1 ? "s" : ""} · {e.tickets} ticket{e.tickets > 1 ? "s" : ""} relié{e.tickets > 1 ? "s" : ""} au total
                      </small>
                    </div>
                    <div className={styles.rowSide}>
                      <span className={`tag tag-${e.status === "in_service" ? "green" : e.status === "degraded" ? "amber" : "red"}`}>État déclaré : {EQUIPMENT_STATUS[e.status]}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>Aucun équipement de criticité critique ou élevée n’est déclaré sur ce site.</p>
            )}
            <p className={styles.note}>L’état des équipements est celui déclaré par votre organisation : aucune télémesure ni alerte automatique n’est raccordée.</p>

            {closed.length > 0 && (
              <>
                <button type="button" className="button outline" aria-expanded={showClosed} onClick={() => setShowClosed((v) => !v)} data-restaurant-closed-toggle="">
                  {showClosed ? "Masquer" : "Afficher"} les tickets terminés ({closed.length})
                </button>
                {showClosed && <ul className={styles.list} data-restaurant-closed="">{closed.map(row)}</ul>}
              </>
            )}
            <p className={styles.note} data-restaurant-rule="">{DEADLINE_RULE}</p>
            <p className={styles.note}>Ces échéances sont des objectifs internes fixés par votre organisation ; elles n’engagent ni l’artisan ni la plateforme. Calculé le {dateTime(r.computed_at)}.</p>
          </>
        );
      })()}
    </section>
  );
}
function Figure({ n, label, name, alert = false }: { n: number; label: string; name: string; alert?: boolean }) {
  return (
    <div className={`${styles.figure} ${alert ? styles.figureAlert : ""}`} data-restaurant-figure={name}>
      <strong>{n}</strong>
      <span>{label}</span>
    </div>
  );
}

/** Dossier line: the target deadline of ONE ticket of a site (same server computation). */
export function TicketDeadlineLine({ siteId, interventionId, context }: { siteId: string; interventionId: string; context: Context }) {
  return <Line key={`${context.userId() ?? "-"}|${context.generation()}|${siteId}|${interventionId}`} siteId={siteId} interventionId={interventionId} context={context} />;
}
function Line({ siteId, interventionId, context }: { siteId: string; interventionId: string; context: Context }) {
  const { view, reload } = useDeadlines(siteId, context, interventionId);
  const [open, setOpen] = useState(false);
  // No access to the site's delays (e.g. dossier outside the member's sites): nothing is claimed.
  if (view.phase === "error" && view.denied) return null;
  return (
    <div className={styles.line} data-ticket-deadline-line={view.phase}>
      <span className={styles.lineLabel}>Échéance cible</span>
      {view.phase === "loading" && <span className={styles.muted} role="status">Calcul de l’échéance…</span>}
      {view.phase === "error" && (
        <span role="alert">
          {view.text}{" "}
          <button type="button" className="button outline" onClick={reload}>
            Réessayer
          </button>
        </span>
      )}
      {view.phase === "ready" && view.report.tickets[0] && (
        <>
          <div className={styles.deadline}>
            <DeadlineText deadline={view.report.tickets[0].deadline} />
          </div>
          <button type="button" className={styles.linkButton} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Masquer la règle de calcul" : "Comment est-elle calculée ?"}
          </button>
          {open && <p className={styles.note}>{DEADLINE_RULE}</p>}
        </>
      )}
    </div>
  );
}
