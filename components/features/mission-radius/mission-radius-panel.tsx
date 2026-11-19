"use client";
// Artisan mission radius (Missions › Disponibles). Reference commune chosen from the server's list +
// radius 1–200 km, or « Effacer » (both null). Approximation between commune centres, unknown postal
// codes matched by postal code only, data source + retrieval date — all as returned by the server.
// No geolocation, no client-side filtering: every CONFIRMED preference (GET, 409 re-read, « Relire
// le réglage », save) is reported through onConfirmed so the host can restart
// the offers at page 1. Command fenced under courant-private-mission-radius:. Demo: note, zero calls.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { RADIUS_MAX, RADIUS_MIN } from "./contract";
import { COPY, VIEW_INITIAL, createRadiusApi, createRadiusController, retrievedLabel, tabStore, type Context, type ConfirmedRadius, type RadiusApi, type Store, type View } from "./model";
import styles from "./mission-radius.module.css";

export type MissionRadiusPanelProps = {
  demo: boolean;
  context: Context;
  /** Called with every preference the server CONFIRMED (never local edits): the host restarts the
   *  offers when the version changes and only offers « Plus proches d’abord » when active. */
  onConfirmed: (p: ConfirmedRadius) => void;
  /** Bumped by the host to re-read the preference (GET), e.g. offers ranked with another version. */
  recheck?: number;
  /** Reveal a collapsed parent when a read or save needs user attention. */
  onAttention?: () => void;
  api?: RadiusApi;
  store?: () => Store | null;
};

export function MissionRadiusPanel(props: MissionRadiusPanelProps) {
  if (props.demo)
    return (
      <section className={styles.panel} aria-labelledby="mission-radius-title" data-mission-radius="demo">
        <h2 id="mission-radius-title">{COPY.title}</h2>
        <p className={styles.note}>{COPY.demo}</p>
      </section>
    );
  return <Live key={`${props.context.userId() ?? "-"}|${props.context.generation()}`} {...props} />;
}

function useWait(seconds: number | null, key: unknown) {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!seconds) return setWaiting(false);
    setWaiting(true);
    const t = setTimeout(() => setWaiting(false), seconds * 1000);
    return () => clearTimeout(t);
  }, [seconds, key]);
  return waiting;
}

function Live({ context, onConfirmed, onAttention, api, store = tabStore, recheck = 0 }: MissionRadiusPanelProps) {
  const [view, setRaw] = useState<View>(VIEW_INITIAL);
  useEffect(() => {
    if (view.error) onAttention?.();
  }, [view.error, onAttention]);
  const ref = useRef(view);
  const set = (v: View) => {
    ref.current = v;
    setRaw(v);
  };
  const latest = useRef({ api, store, context, onConfirmed });
  latest.current = { api, store, context, onConfirmed };
  const ctrl = useRef<ReturnType<typeof createRadiusController> | null>(null);
  if (!ctrl.current) {
    let client: RadiusApi | null = null;
    ctrl.current = createRadiusController({
      api: () => (client ??= latest.current.api ?? createRadiusApi()),
      store: () => latest.current.store(),
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
      onConfirmed: (p) => latest.current.onConfirmed(p),
    });
  }
  const c = ctrl.current;
  useEffect(() => {
    c.restorePending();
    void c.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const firstCheck = useRef(recheck);
  useEffect(() => {
    if (recheck !== firstCheck.current) void c.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recheck]);
  const [code, setCode] = useState<string | null>(null);
  const [radius, setRadius] = useState<string | null>(null);
  const wait = useWait(view.pending ? view.waitS : null, view.error);
  const d = view.data;
  const pref = d?.preference;
  const shownCode = code ?? pref?.reference_code ?? "";
  const shownRadius = radius ?? (pref?.radius_km != null ? String(pref.radius_km) : "");
  const blocked = view.busy || Boolean(view.pending);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (await c.save(shownCode, shownRadius)) {
      setCode(null);
      setRadius(null);
    }
  };
  const currentName = pref?.reference_code ? d?.options.find((o) => o.code === pref.reference_code)?.name ?? pref.reference_code : null;

  return (
    <section className={styles.panel} aria-labelledby="mission-radius-title" data-mission-radius={view.phase} aria-busy={view.busy || undefined}>
      <h2 id="mission-radius-title">{COPY.title}</h2>
      {view.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {view.phase === "forbidden" && <p className={styles.note} role="alert">{view.error}</p>}
      {view.phase === "error" && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{view.error}</p>
          <button type="button" className={styles.secondary} onClick={() => void c.load()}>Réessayer</button>
        </div>
      )}
      {d && view.phase === "ready" && pref && (
        <>
          <p className={styles.hint}>{COPY.intro}</p>
          <p className={styles.line} data-mission-radius-current={pref.radius_km ?? "none"}>
            <strong>{pref.radius_km !== null && currentName ? COPY.current(currentName, pref.radius_km) : COPY.none}</strong>
          </p>
          <ul className={styles.facts}>
            <li data-mission-radius-basis={d.basis}>{COPY.basis}</li>
            <li data-mission-radius-policy={d.unknown_postal_policy}>{COPY.unknownPostal}</li>
            <li>
              Source des centres de communes :{" "}
              <a href={d.source.url} target="_blank" rel="noreferrer noopener" className={styles.link}>{new URL(d.source.url).host}</a>, données récupérées le {retrievedLabel(d.source.retrieved_at)}.
            </li>
          </ul>
          {d.options.length === 0 ? (
            <p className={styles.note} data-mission-radius-empty="">{COPY.noOptions}</p>
          ) : (
            <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
              <div className={styles.row}>
                <label className={styles.field}>
                  Commune de référence
                  <select value={shownCode} onChange={(e) => setCode(e.target.value)} disabled={blocked}>
                    <option value="">Choisir…</option>
                    {d.options.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  Rayon (km, {RADIUS_MIN} à {RADIUS_MAX})
                  <input type="number" inputMode="numeric" min={RADIUS_MIN} max={RADIUS_MAX} step={1} value={shownRadius} onChange={(e) => setRadius(e.target.value)} disabled={blocked} />
                </label>
              </div>
              <div className={styles.actions}>
                <button type="submit" className={styles.primary} disabled={blocked}>Enregistrer le rayon</button>
                {pref.radius_km !== null && (
                  <button type="button" className={styles.secondary} disabled={blocked} onClick={async () => { if (await c.clear()) { setCode(null); setRadius(null); } }}>Effacer</button>
                )}
              </div>
            </form>
          )}
        </>
      )}
      {view.busy && <p className={styles.hint} role="status">Enregistrement…</p>}
      {view.notice && <p className={styles.ok} role="status" data-mission-radius-notice="">{view.notice}</p>}
      {view.phase === "ready" && view.error && (
        <div className={styles.note} role="alert" data-mission-radius-error="">
          <p className={styles.error}>{view.error}</p>
          {view.pending && (
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => void c.retry()} disabled={view.busy || wait}>Réessayer</button>
              <button type="button" className={styles.secondary} onClick={() => void c.reread()} disabled={view.busy}>Relire le réglage</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
