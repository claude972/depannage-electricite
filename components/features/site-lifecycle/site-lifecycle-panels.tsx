"use client";
// Enterprise site lifecycle: settings of ONE site (name, address, access notes, opening hours,
// one-way archive) and the organisation portfolio (active / archived, « after » paging).
// Writes only when the server says can_write; versioned commands persisted before the POST.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  DAYS,
  DEFAULT_SL_CONTEXT,
  LIST_INITIAL,
  SETTINGS_INITIAL,
  SL_COPY,
  canEdit,
  createListController,
  createSettingsController,
  createSlApi,
  formFromSite,
  tabStore,
  type FormErrors,
  type ListState,
  type SettingsState,
  type SiteForm,
  type SiteRecord,
  type SiteState,
  type SlApi,
  type SlContext,
  type SlStore,
} from "./site-lifecycle-model";
import styles from "./site-lifecycle.module.css";

const TYPE_LABEL: Record<SiteRecord["type"], string> = { syndic: "Copropriété (syndic)", restaurant: "Restauration", office: "Bureaux", erp: "ERP" };
const hoursText = (s: SiteRecord) =>
  s.opening_hours.length ? s.opening_hours.map((h) => `${DAYS[h.day - 1]} ${h.opens}–${h.closes}`).join(" · ") : "Aucun horaire renseigné";

// ---- Settings ------------------------------------------------------------------------------------
export type SiteSettingsPanelProps = {
  siteId: string;
  api?: SlApi;
  context?: SlContext;
  demo?: boolean;
  /** Called after a confirmed save / archive (e.g. refresh the workspace). */
  onChanged?: (site: SiteRecord) => void;
  /** Tests / injection only. */
  store?: SlStore;
  newId?: () => string | null;
  initial?: SettingsState;
};
export function SiteSettingsPanel(props: SiteSettingsPanelProps) {
  const ctx = props.context ?? DEFAULT_SL_CONTEXT;
  return <SettingsInner key={`${ctx.userId() ?? "-"}|${ctx.generation()}|${props.demo ? "demo" : "live"}|${props.siteId}`} {...props} />;
}

function SettingsInner({ siteId, api, context = DEFAULT_SL_CONTEXT, demo = false, onChanged, store, newId, initial }: SiteSettingsPanelProps) {
  const uid = useId();
  const [state, setRaw] = useState<SettingsState>(initial ?? (demo ? { ...SETTINGS_INITIAL, phase: "demo" } : SETTINGS_INITIAL));
  const ref = useRef(state);
  const set = (next: SettingsState) => {
    ref.current = next;
    setRaw(next);
  };
  const latest = useRef({ api, store, onChanged });
  latest.current = { api, store, onChanged };
  const controller = useRef<ReturnType<typeof createSettingsController> | null>(null);
  useEffect(() => {
    let client: SlApi | null = null;
    let tab: SlStore | null = null;
    const c = createSettingsController({
      api: () => (client ??= latest.current.api ?? createSlApi()),
      store: () => (tab ??= latest.current.store ?? tabStore()),
      siteId,
      context,
      newId,
      demo,
      get: () => ref.current,
      set,
      onChanged: (site) => latest.current.onChanged?.(site),
    });
    controller.current = c;
    if (!initial) void c.load();
    return () => {
      c.detach();
      if (controller.current === c) controller.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [form, setForm] = useState<SiteForm | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (state.phase === "demo") return <p className={styles.note} role="note" data-sl="demo">{SL_COPY.demo}</p>;
  if (state.phase === "loading") return <p className={styles.muted} role="status" data-sl="loading">{SL_COPY.loading}</p>;
  if (state.phase === "unavailable") return <p className={styles.muted} role="status" data-sl="unavailable">{state.error}</p>;
  if (state.phase === "error" || !state.site)
    return (
      <div data-sl="error">
        <p className={styles.error} role="alert">{state.error || SL_COPY.loadFailed}</p>
        <button type="button" className={styles.button} onClick={() => void controller.current?.load()} data-sl-reload="">Réessayer</button>
      </div>
    );

  const site = state.site;
  const editable = canEdit(demo, state);
  const f = form ?? formFromSite(site);
  const update = (patch: Partial<SiteForm>) => setForm({ ...f, ...patch });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const out = await controller.current?.save(f);
    if (out && typeof out === "object") return setErrors(out.errors);
    setErrors({});
    if (out === true) setForm(null);
  };
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-title`} data-sl="ready" data-sl-archived={site.archived_at ? "" : undefined}>
      <div className={styles.head}>
        <h3 id={`${uid}-title`} className={styles.title}>Paramètres du site</h3>
        <span className={styles.meta}>{TYPE_LABEL[site.type]} · version {site.settings_version}</span>
      </div>
      {site.archived_at ? (
        <p className={styles.note} data-sl-archived-note="">{SL_COPY.archived}</p>
      ) : (
        !state.canWrite && <p className={styles.muted} data-sl-readonly="">{SL_COPY.readOnly}</p>
      )}
      {state.notice && <p className={styles.note} role="status" data-sl-notice="">{state.notice}</p>}
      {state.conflict && (
        <div role="alert" data-sl-conflict="">
          <p className={styles.error}>{state.conflict}</p>
          <button type="button" className={styles.button} onClick={() => void controller.current?.refresh()} data-sl-refresh="">Actualiser</button>
        </div>
      )}
      {state.writeError && (
        <div role="alert" data-sl-write-error="">
          <p className={styles.error}>{state.writeError}</p>
          {state.pending ? (
            <button type="button" className={styles.button} disabled={state.busy} onClick={() => void controller.current?.retry()} data-sl-retry="">
              {state.busy ? "Envoi…" : "Réessayer la même commande"}
            </button>
          ) : (
            <button type="button" className={styles.button} onClick={() => void controller.current?.refresh()} data-sl-refresh="">Actualiser</button>
          )}
        </div>
      )}
      {editable ? (
        <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate data-sl-form="">
          <label className={styles.label} htmlFor={`${uid}-name`}>Nom du site</label>
          <input id={`${uid}-name`} className={styles.input} value={f.name} maxLength={160} onChange={(e) => update({ name: e.target.value })} aria-invalid={errors.name ? true : undefined} />
          {errors.name && <small className={styles.fieldError}>{errors.name}</small>}
          <label className={styles.label} htmlFor={`${uid}-address`}>Adresse</label>
          <input id={`${uid}-address`} className={styles.input} value={f.address} maxLength={500} onChange={(e) => update({ address: e.target.value })} aria-invalid={errors.address ? true : undefined} />
          {errors.address && <small className={styles.fieldError}>{errors.address}</small>}
          <label className={styles.label} htmlFor={`${uid}-notes`}>Consignes d’accès</label>
          <textarea id={`${uid}-notes`} className={styles.textarea} rows={3} maxLength={2000} value={f.access_notes} onChange={(e) => update({ access_notes: e.target.value })} aria-invalid={errors.access_notes ? true : undefined} />
          {errors.access_notes && <small className={styles.fieldError}>{errors.access_notes}</small>}
          <fieldset className={styles.fieldset}>
            <legend>Horaires d’ouverture</legend>
            {f.opening_hours.length === 0 && <p className={styles.muted}>Aucun horaire renseigné.</p>}
            {f.opening_hours.map((slot, i) => (
              <div key={i} className={styles.slot} data-sl-slot={i}>
                <select className={styles.input} aria-label={`Jour du créneau ${i + 1}`} value={slot.day} onChange={(e) => update({ opening_hours: f.opening_hours.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)) })}>
                  {DAYS.map((d, k) => (
                    <option key={d} value={k + 1}>{d}</option>
                  ))}
                </select>
                <input type="time" className={styles.input} aria-label={`Ouverture du créneau ${i + 1}`} value={slot.opens} onChange={(e) => update({ opening_hours: f.opening_hours.map((x, j) => (j === i ? { ...x, opens: e.target.value } : x)) })} />
                <input type="time" className={styles.input} aria-label={`Fermeture du créneau ${i + 1}`} value={slot.closes} onChange={(e) => update({ opening_hours: f.opening_hours.map((x, j) => (j === i ? { ...x, closes: e.target.value } : x)) })} />
                <button type="button" className={styles.button} onClick={() => update({ opening_hours: f.opening_hours.filter((_, j) => j !== i) })}>Retirer</button>
              </div>
            ))}
            <button type="button" className={styles.button} disabled={f.opening_hours.length >= 28} onClick={() => update({ opening_hours: [...f.opening_hours, { day: 1, opens: "08:00", closes: "18:00" }] })}>
              Ajouter un créneau
            </button>
            {errors.opening_hours && <small className={styles.fieldError}>{errors.opening_hours}</small>}
          </fieldset>
          <div className={styles.actions}>
            <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={state.busy} data-sl-save="">{state.busy ? "Enregistrement…" : "Enregistrer"}</button>
            {!confirmArchive && (
              <button type="button" className={styles.button} disabled={state.busy} onClick={() => setConfirmArchive(true)} data-sl-archive="">Archiver le site…</button>
            )}
          </div>
          {confirmArchive && (
            <div className={styles.confirm} role="alertdialog" aria-labelledby={`${uid}-archive`} data-sl-archive-confirm="">
              <p id={`${uid}-archive`}>{SL_COPY.archiveConfirm}</p>
              <div className={styles.actions}>
                <button type="button" className={`${styles.button} ${styles.danger}`} disabled={state.busy} onClick={() => void controller.current?.archive().then(() => setConfirmArchive(false))} data-sl-archive-execute="">
                  Confirmer l’archivage
                </button>
                <button type="button" className={styles.button} disabled={state.busy} onClick={() => setConfirmArchive(false)}>Annuler</button>
              </div>
            </div>
          )}
        </form>
      ) : (
        <dl className={styles.kv} data-sl-view="">
          <dt>Nom</dt>
          <dd>{site.name}</dd>
          <dt>Adresse</dt>
          <dd>{site.address}</dd>
          <dt>Consignes d’accès</dt>
          <dd>{site.access_notes || "Aucune consigne"}</dd>
          <dt>Horaires</dt>
          <dd>{hoursText(site)}</dd>
        </dl>
      )}
    </section>
  );
}

// ---- Portfolio list ------------------------------------------------------------------------------
export type OrganizationSitesListProps = {
  organizationId: string;
  api?: SlApi;
  context?: SlContext;
  demo?: boolean;
  /** Opens a site (e.g. the site sheet). */
  onOpen?: (siteId: string) => void;
  initialState?: SiteState;
  /** Tests only. */
  initial?: ListState;
};
export function OrganizationSitesList(props: OrganizationSitesListProps) {
  const ctx = props.context ?? DEFAULT_SL_CONTEXT;
  return <ListInner key={`${ctx.userId() ?? "-"}|${ctx.generation()}|${props.demo ? "demo" : "live"}|${props.organizationId}`} {...props} />;
}
function ListInner({ organizationId, api, context = DEFAULT_SL_CONTEXT, demo = false, onOpen, initialState = "active", initial }: OrganizationSitesListProps) {
  const uid = useId();
  const [state, setRaw] = useState<ListState>(initial ?? (demo ? { ...LIST_INITIAL, state: initialState, phase: "demo" } : { ...LIST_INITIAL, state: initialState }));
  const ref = useRef(state);
  const set = (next: ListState) => {
    ref.current = next;
    setRaw(next);
  };
  const latest = useRef({ api });
  latest.current = { api };
  const controller = useRef<ReturnType<typeof createListController> | null>(null);
  useEffect(() => {
    let client: SlApi | null = null;
    const c = createListController({ api: () => (client ??= latest.current.api ?? createSlApi()), organizationId, context, demo, get: () => ref.current, set });
    controller.current = c;
    if (!initial) void c.load(ref.current.state);
    return () => {
      c.detach();
      if (controller.current === c) controller.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const tabs: [SiteState, string][] = [["active", "Sites actifs"], ["archived", "Sites archivés"]];
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-title`} data-sl-list={state.phase}>
      <h3 id={`${uid}-title`} className={styles.title}>Portefeuille de sites</h3>
      <div className={styles.tabs} role="tablist" aria-label="État des sites">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={state.state === key} className={`${styles.tab} ${state.state === key ? styles.tabActive : ""}`} onClick={() => state.state !== key && void controller.current?.load(key)} data-sl-tab={key}>
            {label}
          </button>
        ))}
      </div>
      {state.phase === "demo" && <p className={styles.note} role="note">{SL_COPY.listDemo}</p>}
      {state.phase === "loading" && <p className={styles.muted} role="status">{SL_COPY.listLoading}</p>}
      {state.phase === "unavailable" && <p className={styles.muted} role="status">{state.error}</p>}
      {state.phase === "error" && (
        <div>
          <p className={styles.error} role="alert">{state.error}</p>
          <button type="button" className={styles.button} onClick={() => void controller.current?.load()} data-sl-list-reload="">Réessayer</button>
        </div>
      )}
      {state.phase === "ready" && state.sites.length === 0 && <p className={styles.muted} data-sl-empty="">{state.state === "active" ? SL_COPY.emptyActive : SL_COPY.emptyArchived}</p>}
      {state.phase === "ready" && state.sites.length > 0 && (
        <>
          <ul className={styles.list}>
            {state.sites.map((s) => (
              <li key={s.id} className={styles.item} data-sl-site={s.id}>
                <div>
                  <strong>{s.name}</strong>
                  <span className={styles.meta}>{TYPE_LABEL[s.type]} · {s.address}</span>
                </div>
                {onOpen && <button type="button" className={styles.button} onClick={() => onOpen(s.id)}>Ouvrir</button>}
              </li>
            ))}
          </ul>
          <p className={styles.muted} data-sl-shown="">{SL_COPY.shown(state.sites.length)}{state.nextAfter ? ` ${SL_COPY.more}` : ""}</p>
          {state.nextAfter && (
            <button type="button" className={styles.button} disabled={state.loadingMore} onClick={() => void controller.current?.more()} data-sl-more="">
              {state.loadingMore ? "Chargement…" : "Afficher la suite"}
            </button>
          )}
          {state.error && <p className={styles.error} role="alert">{state.error}</p>}
        </>
      )}
    </section>
  );
}
