"use client";
// Equipment / zones explicitly linked to ONE intervention of a site (ENT-07/08). Writes only with the
// server's can_write, never on an archived site, never automatically. Asset labels come from the
// caller's existing APIs (areas, site operations); an unknown label is said, not invented.
import { useEffect, useId, useRef, useState } from "react";
import {
  AL_COPY,
  AL_INITIAL,
  DEFAULT_AL_CONTEXT,
  KIND_LABEL,
  canModify,
  createAlApi,
  createAlController,
  rowsByAsset,
  tabStore,
  type AlApi,
  type AlContext,
  type AlState,
  type AlStore,
  type AssetOption,
  type AssetSource,
} from "./asset-links-model";
import styles from "./site-asset-links.module.css";

export type SiteAssetLinksPanelProps = {
  siteId: string;
  interventionId: string;
  /** Existing-API asset list (labels + choices). Without it, links show ids only and no new link. */
  assets?: AssetSource;
  api?: AlApi;
  context?: AlContext;
  demo?: boolean;
  /** Caller-side read-only (e.g. no write authority on the site). */
  readOnly?: boolean;
  /** Tests / injection only. */
  store?: AlStore;
  newId?: () => string | null;
  initial?: AlState;
  initialAssets?: { assets: AssetOption[]; complete: boolean } | null;
};

const when = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" }).format(new Date(iso));

export function SiteAssetLinksPanel(props: SiteAssetLinksPanelProps) {
  const ctx = props.context ?? DEFAULT_AL_CONTEXT;
  return <Inner key={`${ctx.userId() ?? "-"}|${ctx.generation()}|${props.demo ? "demo" : "live"}|${props.siteId}|${props.interventionId}|${props.readOnly ? "ro" : "rw"}`} {...props} />;
}

function Inner({ siteId, interventionId, assets, api, context = DEFAULT_AL_CONTEXT, demo = false, readOnly = false, store, newId, initial, initialAssets }: SiteAssetLinksPanelProps) {
  const uid = useId();
  const [state, setRaw] = useState<AlState>(initial ?? (demo ? { ...AL_INITIAL, phase: "demo" } : AL_INITIAL));
  const ref = useRef(state);
  const set = (next: AlState) => {
    ref.current = next;
    setRaw(next);
  };
  const [catalog, setCatalog] = useState<{ assets: AssetOption[]; complete: boolean } | null | undefined>(initialAssets === undefined ? undefined : initialAssets);
  const latest = useRef({ api, store, assets });
  latest.current = { api, store, assets };
  const controller = useRef<ReturnType<typeof createAlController> | null>(null);
  useEffect(() => {
    let client: AlApi | null = null;
    let tab: AlStore | null = null;
    const c = createAlController({
      api: () => (client ??= latest.current.api ?? createAlApi()),
      store: () => (tab ??= latest.current.store ?? tabStore()),
      siteId,
      interventionId,
      context,
      newId,
      demo,
      readOnly,
      get: () => ref.current,
      set,
    });
    controller.current = c;
    let active = true;
    if (!initial) void c.load();
    if (!demo && initialAssets === undefined && latest.current.assets) {
      const gen = context.generation(), who = context.userId();
      void latest.current.assets().then(
        (out) => active && context.generation() === gen && context.userId() === who && setCatalog(out),
        () => active && setCatalog(null),
      );
    }
    return () => {
      active = false;
      c.detach();
      if (controller.current === c) controller.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [choice, setChoice] = useState("");

  if (state.phase === "demo") return <p className={styles.note} role="note" data-al="demo">{AL_COPY.demo}</p>;
  if (state.phase === "loading") return <p className={styles.muted} role="status" data-al="loading">{AL_COPY.loading}</p>;
  if (state.phase === "unavailable") return <p className={styles.muted} role="status" data-al="unavailable">{state.error}</p>;
  if (state.phase === "error")
    return (
      <div data-al="error">
        <p className={styles.error} role="alert">{state.error || AL_COPY.loadFailed}</p>
        <button type="button" className={styles.button} onClick={() => void controller.current?.load()} data-al-reload="">Réessayer</button>
      </div>
    );

  const editable = canModify(demo, readOnly, state);
  const rows = rowsByAsset(state.records);
  const label = (kind: string, assetId: string) => catalog?.assets.find((a) => a.kind === kind && a.id.toLowerCase() === assetId.toLowerCase())?.label ?? `${KIND_LABEL[kind as "area"]} ${assetId.slice(0, 8)} (${AL_COPY.unknownAsset})`;
  const linked = new Set(rows.map((r) => `${r.kind}:${r.asset_id.toLowerCase()}`));
  const choices = (catalog?.assets ?? []).filter((a) => !a.archived && !linked.has(`${a.kind}:${a.id.toLowerCase()}`));
  const active = rows.filter((r) => r.active);
  const detached = rows.filter((r) => !r.active);
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-title`} data-al="ready">
      <h3 id={`${uid}-title`} className={styles.title}>{AL_COPY.title}</h3>
      {state.siteArchived ? <p className={styles.muted} data-al-archived="">{AL_COPY.archived}</p> : (!state.canWrite || readOnly) && <p className={styles.muted} data-al-readonly="">{AL_COPY.readOnly}</p>}
      {state.notice && <p className={styles.note} role="status">{state.notice}</p>}
      {state.conflict && (
        <div role="alert" data-al-conflict="">
          <p className={styles.error}>{state.conflict}</p>
          <button type="button" className={styles.button} onClick={() => void controller.current?.refresh()} data-al-refresh="">Actualiser</button>
        </div>
      )}
      {state.writeError && (
        <div role="alert" data-al-write-error="">
          <p className={styles.error}>{state.writeError}</p>
          {state.pending ? (
            <button type="button" className={styles.button} disabled={state.busy} onClick={() => void controller.current?.retry()} data-al-retry="">
              {state.busy ? "Envoi…" : "Réessayer la même commande"}
            </button>
          ) : (
            <button type="button" className={styles.button} onClick={() => void controller.current?.refresh()} data-al-refresh="">Actualiser</button>
          )}
        </div>
      )}
      {active.length === 0 && <p className={styles.muted} data-al-empty="">{AL_COPY.empty}</p>}
      {active.length > 0 && (
        <ul className={styles.list}>
          {active.map((r) => (
            <li key={r.id} className={styles.item} data-al-link={r.asset_id}>
              <div>
                <strong>{label(r.kind, r.asset_id)}</strong>
                <span className={styles.meta}>{KIND_LABEL[r.kind]} · lié le {when(r.updated_at)}{r.asset_archived ? " · actif archivé" : ""}</span>
              </div>
              {editable && (
                <button type="button" className={styles.button} onClick={() => void controller.current?.unlink(r)} data-al-unlink={r.asset_id}>Détacher</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {detached.length > 0 && (
        <details className={styles.history}>
          <summary>Liens détachés ({detached.length} affiché{detached.length > 1 ? "s" : ""})</summary>
          <ul className={styles.list}>
            {detached.map((r) => (
              <li key={r.id} className={styles.item} data-al-detached={r.asset_id}>
                <div>
                  <strong>{label(r.kind, r.asset_id)}</strong>
                  <span className={styles.meta}>{KIND_LABEL[r.kind]} · détaché le {when(r.detached_at!)}{r.asset_archived ? " · actif archivé" : ""}</span>
                </div>
                {editable && !r.asset_archived && (
                  <button type="button" className={styles.button} onClick={() => void controller.current?.link(r.kind, r.asset_id, r.version)} data-al-relink={r.asset_id}>Rattacher</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {state.cursor && (
        <button type="button" className={styles.button} disabled={state.loadingMore} onClick={() => void controller.current?.more()} data-al-more="">
          {state.loadingMore ? "Chargement…" : AL_COPY.more}
        </button>
      )}
      {editable && catalog && choices.length > 0 && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            const a = choices.find((x) => `${x.kind}:${x.id}` === choice);
            if (a) void controller.current?.link(a.kind, a.id, null).then(() => setChoice(""));
          }}
          data-al-form=""
        >
          <label className={styles.label} htmlFor={`${uid}-asset`}>Rattacher un équipement ou une zone</label>
          <select id={`${uid}-asset`} className={styles.input} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Choisir…</option>
            {choices.map((a) => (
              <option key={`${a.kind}:${a.id}`} value={`${a.kind}:${a.id}`}>{KIND_LABEL[a.kind]} · {a.label}</option>
            ))}
          </select>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={!choice || state.busy} data-al-link-submit="">Rattacher</button>
        </form>
      )}
      {catalog && !catalog.complete && <p className={styles.muted}>{AL_COPY.partialAssets}</p>}
      <p className={styles.muted}>{AL_COPY.explicit}</p>
    </section>
  );
}
