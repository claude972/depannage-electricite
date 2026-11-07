"use client";
// Available missions (artisan): anonymized eligible offers from GET /api/artisan/missions, oldest
// first, 50 per page with the opaque cursor sent unchanged (« Afficher plus »), deduplicated, no
// total count claimed. An offer opens its anonymized summary (?id=) — never the private dossier
// route; acceptance goes through the existing locked action (onAccept), then onOpenAccepted opens
// the private dossier. Logic in ./available-missions-model. Mount keyed by uid|generation|demo.
import { useEffect, useRef, useState } from "react";
import { category, date, dateTime, money } from "../../app/format";
import {
  DEFAULT_MISSIONS_CONTEXT,
  MISSIONS_COPY,
  MISSIONS_INITIAL,
  createMissionsApi,
  createMissionsController,
  shownCount,
  type MissionOffer,
  type MissionsApi,
  type MissionsContext,
  type MissionsState,
} from "./available-missions-model";
import styles from "./available-missions.module.css";

export type AvailableMissionsProps = {
  api?: MissionsApi;
  context?: MissionsContext;
  /** Demo: the current demo offers, rendered locally; no route is ever called. */
  demo?: boolean;
  demoItems?: MissionOffer[];
  /** Existing locked accept action; resolves true only when the server accepted. */
  onAccept(id: string): Promise<boolean>;
  /** Opens the PRIVATE dossier, only after a successful accept (and refresh). */
  onOpenAccepted(id: string): void;
  /** Tests only. */
  initial?: MissionsState;
};

export function AvailableMissionsPanel(props: AvailableMissionsProps) {
  const [state, setStateRaw] = useState<MissionsState>(() =>
    props.initial ?? (props.demo ? { ...MISSIONS_INITIAL, phase: "ready", eligible: true, items: props.demoItems ?? [], page: { limit: 50, has_more: false, next_cursor: null } } : MISSIONS_INITIAL),
  );
  const ref = useRef(state);
  const set = (next: MissionsState) => {
    ref.current = next;
    setStateRaw(next);
  };
  const latest = useRef(props);
  latest.current = props;
  const controller = useRef<ReturnType<typeof createMissionsController> | null>(null);
  if (!controller.current) {
    let client: MissionsApi | null = null;
    const demoApi: MissionsApi = {
      // Demo never reaches the network: a point read is answered from the local demo offers.
      list: async () => ({ status: 200, body: null, retryAfter: null }),
      point: async (id) => {
        const offer = (latest.current.demoItems ?? []).find((o) => o.id === id);
        return offer
          ? { status: 200, body: { items: [offer], eligible: true, captured_at: new Date().toISOString(), page: { limit: 50, has_more: false, next_cursor: null }, projection: "anonymized", order: "oldest_first", distance: "not_calculated" }, retryAfter: null }
          : { status: 404, body: null, retryAfter: null };
      },
    };
    controller.current = createMissionsController({
      api: () => (latest.current.demo ? demoApi : (client ??= latest.current.api ?? createMissionsApi())),
      context: {
        generation: () => (latest.current.context ?? DEFAULT_MISSIONS_CONTEXT).generation(),
        userId: () => (latest.current.context ?? DEFAULT_MISSIONS_CONTEXT).userId(),
      },
      get: () => ref.current,
      set,
    });
  }
  const ctrl = controller.current;
  useEffect(() => {
    ctrl.attach();
    if (!props.initial && !props.demo) void ctrl.load();
    return () => ctrl.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl]);

  const point = state.point;
  const accept = (id: string) => void ctrl.accept(id, (x) => latest.current.onAccept(x), (x) => latest.current.onOpenAccepted(x));

  return (
    <section className={styles.panel} aria-labelledby="available-missions-title" data-available-missions={state.phase} aria-busy={state.phase === "loading" || state.loadingMore || undefined}>
      <div className={styles.head}>
        <h2 id="available-missions-title">Offres disponibles</h2>
        {state.phase === "ready" && state.eligible && (
          <span className={styles.meta} data-available-count="">{shownCount(state.items.length, Boolean(state.page?.has_more))}</span>
        )}
      </div>
      <p className={styles.hint}>{MISSIONS_COPY.anonymized}</p>

      {state.phase === "loading" && <p className={styles.hint} role="status">{MISSIONS_COPY.loading}</p>}
      {state.phase === "error" && (
        <div className={styles.note} role="alert" data-available-error="">
          <p className={styles.error}>{state.error}</p>
          <button type="button" className={styles.secondary} onClick={() => void ctrl.load()}>Réessayer</button>
        </div>
      )}
      {state.phase === "ready" && !state.eligible && <p className={styles.note} data-available-ineligible="">{MISSIONS_COPY.ineligible}</p>}
      {state.phase === "ready" && state.eligible && !state.items.length && !point && <p className={styles.hint} data-available-empty="">{MISSIONS_COPY.empty}</p>}

      {point && (
        <div className={styles.summary} data-available-point={point.phase} role="region" aria-label="Résumé de l’offre">
          {point.phase === "loading" && <p className={styles.hint} role="status">Vérification de l’offre…</p>}
          {point.phase === "gone" && <p className={styles.error} role="alert">{MISSIONS_COPY.gone}</p>}
          {point.phase === "error" && (
            <p className={styles.error} role="alert">
              {MISSIONS_COPY.loadFailed}{" "}
              <button type="button" className={styles.secondary} onClick={() => (props.demo ? ctrl.openDemo(point.id, props.demoItems ?? []) : void ctrl.open(point.id))}>Réessayer</button>
            </p>
          )}
          {point.phase === "ready" && point.offer && (
            <>
              <h3>{category(point.offer.category).label}</h3>
              <dl className={styles.kv}>
                <div><dt>Ville</dt><dd>{point.offer.city}</dd></div>
                <div><dt>Code postal</dt><dd>{point.offer.postal_code}</dd></div>
                <div><dt>Besoin</dt><dd>{point.offer.urgency === "urgent" ? "Urgent" : "À planifier"}</dd></div>
                <div><dt>Estimation indicative</dt><dd>{money(point.offer.estimate_min_cents)} – {money(point.offer.estimate_max_cents)}</dd></div>
                <div><dt>Demande créée</dt><dd>{dateTime(point.offer.created_at)}</dd></div>
                <div><dt>Distance</dt><dd>non calculée</dd></div>
              </dl>
              <p className={styles.hint}>L’adresse exacte, le contact et la description sont transmis après acceptation.</p>
              {state.acceptError && <p className={styles.error} role="alert" data-available-accept-error="">{state.acceptError}</p>}
            </>
          )}
          <div className={styles.actions}>
            {point.phase === "ready" && point.offer && (
              <button type="button" className={styles.primary} disabled={state.accepting !== null} onClick={() => accept(point.id)} data-available-accept="">
                {state.accepting === point.id ? "Acceptation…" : "Accepter la mission"}
              </button>
            )}
            <button type="button" className={styles.secondary} disabled={state.accepting !== null} onClick={() => ctrl.close()}>Fermer</button>
          </div>
        </div>
      )}

      {state.phase === "ready" && state.eligible && state.items.length > 0 && (
        <ul className={styles.list}>
          {state.items.map((o) => (
            <li key={o.id}>
              <button type="button" className={styles.row} aria-current={point?.id === o.id ? "true" : undefined} onClick={() => (props.demo ? ctrl.openDemo(o.id, props.demoItems ?? []) : void ctrl.open(o.id))} data-available-offer={o.id}>
                <span className={styles.rowHead}>
                  <strong>{category(o.category).label}</strong>
                  <span className={o.urgency === "urgent" ? styles.urgent : styles.meta}>{o.urgency === "urgent" ? "Urgent" : "À planifier"}</span>
                </span>
                <span className={styles.meta}>
                  {o.city} ({o.postal_code}) · {money(o.estimate_min_cents)} – {money(o.estimate_max_cents)} · demandée le {date(o.created_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.phase === "ready" && state.captured.length > 0 && (
        <p className={styles.meta} data-available-captured="">
          {state.captured.length === 1 ? `Offres lues le ${dateTime(state.captured[0])}.` : `Pages lues : ${state.captured.map((c) => dateTime(c)).join(", ")}.`}
        </p>
      )}
      {state.moreError && (
        <p className={styles.error} role="alert" data-available-more-error="">{state.moreError}</p>
      )}
      {state.phase === "ready" && state.eligible && state.page?.has_more && (
        <button type="button" className={styles.secondary} disabled={state.loadingMore} onClick={() => void ctrl.more()} data-available-more="">
          {state.loadingMore ? "Chargement…" : "Afficher plus"}
        </button>
      )}
    </section>
  );
}
