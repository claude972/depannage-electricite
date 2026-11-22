"use client";
// CLI-09 client saved addresses (profile). Private, versioned addresses of the signed-in client:
// list, create, edit, explicit preferred address, archive. Every write carries a stable record id
// and a stable operation id (command_id) generated once per operation; a 409 is an honest conflict
// (reload, typed values kept), a 503 / timeout keeps the exact command for « Réessayer », nothing
// is retried automatically. The declared position is shown as declared, never as verified.
// Demo: read-only note, no route call. Logic in ./client-addresses-model.
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ADDRESS_COPY,
  ADDRESS_INITIAL,
  ADDRESS_LIMIT,
  DEFAULT_ADDRESS_CONTEXT,
  GEO_SOURCE_LABEL,
  createAddressApi,
  createAddressController,
  editForm,
  formToValues,
  devicePosition,
  geoErrorMessage,
  GEO_TIMEOUT_MS,
  newForm,
  parseAddressList,
  type AddressApi,
  type AddressContext,
  type AddressForm,
  type AddressState,
  type ClientAddress,
  type FormErrors,
} from "./client-addresses-model";
import styles from "./client-addresses.module.css";

/** A stable id is mandatory for idempotent writes: no constant fallback, null when unavailable. */
export const addressUuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

type PanelProps = {
  demo: boolean;
  api?: AddressApi;
  context?: AddressContext;
  /** Tests only. */
  initial?: AddressState;
  newId?: () => string | null;
};
export function ClientAddressesPanel(props: PanelProps) {
  if (props.demo)
    return (
      <section className={styles.panel} aria-labelledby="client-addresses-title" data-client-addresses="demo">
        <div className={styles.head}>
          <h2 id="client-addresses-title">Adresses enregistrées</h2>
        </div>
        <p className={styles.note}>{ADDRESS_COPY.demo}</p>
      </section>
    );
  return <LivePanel {...props} />;
}

function LivePanel({ api, context = DEFAULT_ADDRESS_CONTEXT, initial, newId = addressUuid }: PanelProps) {
  const [state, setStateRaw] = useState<AddressState>(initial ?? ADDRESS_INITIAL);
  const ref = useRef(state);
  const set = (next: AddressState) => {
    ref.current = next;
    setStateRaw(next);
  };
  const latest = useRef({ api, context });
  latest.current = { api, context };
  const controller = useRef<ReturnType<typeof createAddressController> | null>(null);
  if (!controller.current) {
    let client: AddressApi | null = null;
    controller.current = createAddressController({
      api: () => (client ??= latest.current.api ?? createAddressApi()),
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
    });
  }
  const ctrl = controller.current;
  useEffect(() => {
    ctrl.attach();
    if (!initial) void ctrl.load();
    return () => ctrl.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl]);

  const [form, setForm] = useState<AddressForm | null>(null);
  /** E12: the record the open edit form is based on; a re-read with another version reloads the
   *  untouched fields, keeps the typed ones, moves expected_version and flags the conflict. */
  const [formBase, setFormBase] = useState<AddressForm | null>(null);
  const [formConflict, setFormConflict] = useState(false);
  /** command_id of the form's save: one per operation, kept across retries of the SAME values. */
  const [formCommandId, setFormCommandId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [archiving, setArchiving] = useState<ClientAddress | null>(null);
  const [noId, setNoId] = useState(false);
  // Read after mount so server and first client render match; null = no geolocation offered.
  const [geolocation, setGeolocation] = useState<Geolocation | null>(null);
  useEffect(() => {
    setGeolocation(typeof navigator !== "undefined" && navigator.geolocation ? navigator.geolocation : null);
  }, []);
  const [locating, setLocating] = useState(false);
  const [geoNote, setGeoNote] = useState("");
  const locate = () => {
    if (!geolocation || !form || locating) return;
    setLocating(true);
    setGeoNote("");
    const formId = form.id;
    geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const p = devicePosition(pos.coords.latitude, pos.coords.longitude);
        if (!p) return setGeoNote(geoErrorMessage(2));
        setForm((f) => (f && f.id === formId ? { ...f, ...p } : f));
      },
      (err) => {
        setLocating(false);
        setGeoNote(geoErrorMessage(typeof err?.code === "number" ? err.code : null));
      },
      { enableHighAccuracy: false, timeout: GEO_TIMEOUT_MS, maximumAge: 60_000 },
    );
  };

  const ids = (count: number): string[] | null => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = newId();
      if (!id) {
        setNoId(true);
        return null;
      }
      out.push(id);
    }
    setNoId(false);
    return out;
  };
  const preferred = state.records.find((r) => r.is_preferred) ?? null;
  const full = state.records.length >= ADDRESS_LIMIT;

  const openCreate = () => {
    const got = ids(1);
    if (!got) return;
    setErrors({});
    setGeoNote("");
    setFormCommandId(null);
    setForm(newForm(got[0], state.records.length === 0));
  };
  const submitForm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form) return;
    const out = formToValues(form);
    if ("errors" in out) return setErrors(out.errors);
    setErrors({});
    // Same operation id while the pending command is this exact one (retry); a new one otherwise.
    const pending = ref.current.pending;
    const samePending =
      pending && pending.action === "save" && pending.id === form.id && pending.expected_version === form.expected_version && JSON.stringify(pending.values) === JSON.stringify(out.values);
    let commandId = samePending ? pending.command_id : null;
    if (!commandId) {
      const got = ids(1);
      if (!got) return;
      commandId = got[0];
    }
    setFormCommandId(commandId);
    await ctrl.save({ action: "save", id: form.id, command_id: commandId, expected_version: form.expected_version, values: out.values });
    const s = ref.current;
    if (!s.writeError && !s.pending && s.saved) {
      setForm(null);
      setFormBase(null);
      setFormConflict(false);
      setFormCommandId(null);
      return;
    }
    // P1 (E12): a refusal without a pending replay (409 version, rights) re-reads the list at once;
    // the open form is then rebased on the current version below.
    if (!s.pending && s.writeError && form.expected_version !== null) void ctrl.load();
  };
  const fresh = form && form.expected_version !== null ? state.records.find((r) => r.id === form.id) ?? null : null;
  useEffect(() => {
    if (!form || !formBase || !fresh || fresh.version === formBase.expected_version) return;
    const next = editForm(fresh);
    setForm((f) => {
      if (!f || f.id !== next.id) return f;
      const merged = { ...next } as AddressForm;
      for (const k of Object.keys(next) as (keyof AddressForm)[]) {
        if (k === "id" || k === "expected_version") continue;
        if (f[k] !== formBase[k]) (merged as Record<string, unknown>)[k] = f[k]; // typed by the user: kept
      }
      return merged;
    });
    setFormBase(next);
    setFormConflict(true);
    setFormCommandId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh?.version]);
  const quick = (run: (commandId: string) => Promise<boolean>) => {
    const got = ids(1);
    if (got) void run(got[0]);
  };

  return (
    <section className={styles.panel} aria-labelledby="client-addresses-title" data-client-addresses={state.phase} aria-busy={state.busy || state.phase === "loading" || undefined}>
      <div className={styles.head}>
        <h2 id="client-addresses-title">Adresses enregistrées</h2>
        {state.canWrite && state.phase === "ready" && !form && !full && (
          <button type="button" className={styles.primary} onClick={openCreate} data-address-add="">
            Ajouter une adresse
          </button>
        )}
      </div>
      <p className={styles.hint}>Vos adresses restent privées. Une demande d’intervention n’est jamais modifiée sans votre choix.</p>
      {noId && <p className={styles.error} role="alert" data-address-no-uuid="">{ADDRESS_COPY.noUuid}</p>}
      {state.phase === "ready" && !state.canWrite && <p className={styles.note} data-address-readonly="">{ADDRESS_COPY.readOnly}</p>}
      {state.phase === "ready" && state.canWrite && full && <p className={styles.note} data-address-full="">Vous avez enregistré {ADDRESS_LIMIT} adresses, le maximum : archivez-en une pour en ajouter une autre.</p>}
      {state.saved && <p className={styles.ok} role="status">{state.saved}</p>}
      {state.writeError && !form && (
        <div className={styles.error} role="alert" data-address-write-error="">
          {state.writeError}{" "}
          {state.pending && <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.retry()} data-address-retry="">Réessayer</button>}
          <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.load()} data-address-reload="">Actualiser</button>
        </div>
      )}

      {form && state.canWrite && (
        <form className={styles.form} onSubmit={(e) => void submitForm(e)} noValidate data-address-form={form.expected_version === null ? "create" : "edit"} data-command-id={formCommandId ?? undefined}>
          <h3>{form.expected_version === null ? "Nouvelle adresse" : `Modifier « ${form.label} » (version ${form.expected_version})`}</h3>
          <Field label="Nom de l’adresse" hint="Ex. Domicile, Bureau" error={errors.label}><input value={form.label} maxLength={100} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <div className={styles.grid}>
            <Field label="Prénom" error={errors.first_name}><input value={form.first_name} maxLength={100} autoComplete="given-name" onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></Field>
            <Field label="Nom" error={errors.last_name}><input value={form.last_name} maxLength={100} autoComplete="family-name" onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></Field>
          </div>
          <Field label="Adresse complète" hint="Numéro et voie" error={errors.address}><input value={form.address} maxLength={500} autoComplete="street-address" onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <div className={styles.grid}>
            <Field label="Code postal" error={errors.postal_code}><input value={form.postal_code} maxLength={5} inputMode="numeric" pattern="[0-9]{5}" autoComplete="postal-code" onChange={(e) => setForm({ ...form, postal_code: e.target.value })} /></Field>
            <Field label="Ville" error={errors.city}><input value={form.city} maxLength={160} autoComplete="address-level2" onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            <Field label="Pays (code à 2 lettres)" error={errors.country_code}><input value={form.country_code} maxLength={2} autoComplete="country" onChange={(e) => setForm({ ...form, country_code: e.target.value })} /></Field>
          </div>
          {form.geo_source && form.latitude !== null && form.longitude !== null ? (
            <div className={styles.note} data-address-geo="">
              <p>
                Position déclarée ({GEO_SOURCE_LABEL[form.geo_source]}) : {form.latitude}, {form.longitude}. {ADDRESS_COPY.declared}
              </p>
              <button type="button" className={styles.secondary} onClick={() => setForm({ ...form, latitude: null, longitude: null, geo_source: null })}>
                Retirer la position
              </button>
            </div>
          ) : geolocation ? (
            <div className={styles.note} data-address-geo-offer="">
              <p>Facultatif : joindre la position actuelle de votre appareil, si vous êtes à cette adresse. {ADDRESS_COPY.declared}</p>
              <button type="button" className={styles.secondary} disabled={locating || state.busy} onClick={locate} data-address-locate="">
                {locating ? "Localisation…" : "Joindre ma position actuelle"}
              </button>
            </div>
          ) : null}
          {geoNote && <p className={styles.hint} role="status" data-address-geo-note="">{geoNote}</p>}
          {errors.geo && <p className={styles.error} role="alert">{errors.geo}</p>}
          <label className={styles.choices}>
            <input
              type="checkbox"
              checked={form.is_preferred}
              disabled={Boolean(preferred && preferred.id !== form.id && !form.is_preferred)}
              onChange={(e) => setForm({ ...form, is_preferred: e.target.checked })}
            />
            Adresse préférée
          </label>
          {preferred && preferred.id !== form.id && <p className={styles.hint}>{ADDRESS_COPY.otherPreferred(preferred.label)}</p>}
          {formConflict && <p className={styles.error} role="alert" data-address-conflict="">Cette adresse a été modifiée entre-temps : sa version actuelle est rechargée ; vos modifications sont conservées. Vérifiez avant d’enregistrer.</p>}
          {state.writeError && (
            <p className={styles.error} role="alert" data-address-write-error="">
              {state.writeError}{" "}
              {state.pending && <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.retry()} data-address-retry="">Réessayer</button>}
              {!state.pending && <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.load()} data-address-reload="">Actualiser la liste</button>}
            </p>
          )}
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={state.busy} data-address-save="">{state.busy ? "Enregistrement…" : "Enregistrer"}</button>
            <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => { setForm(null); setErrors({}); setFormCommandId(null); }}>Annuler</button>
          </div>
        </form>
      )}

      {state.phase === "loading" && <p className={styles.hint} role="status">Chargement de vos adresses…</p>}
      {state.phase === "error" && (
        <div className={styles.error} role="alert" data-address-error="">
          {state.error}{" "}
          <button type="button" className={styles.secondary} onClick={() => void ctrl.load()}>Réessayer</button>
        </div>
      )}
      {state.phase === "ready" && !state.records.length && <p className={styles.hint} data-address-empty="">{ADDRESS_COPY.empty}</p>}
      {state.phase === "ready" && state.records.length > 0 && (
        <ul className={styles.list}>
          {state.records.map((r) => (
            <li key={r.id} className={styles.row} data-address-id={r.id} data-address-preferred={r.is_preferred || undefined}>
              <div className={styles.rowHead}>
                <strong>{r.label}</strong>
                {r.is_preferred && <span>Adresse préférée</span>}
              </div>
              <dl className={styles.kv}>
                <div><dt>Contact</dt><dd>{r.first_name} {r.last_name}</dd></div>
                <div><dt>Adresse</dt><dd>{r.address}, {r.postal_code} {r.city} ({r.country_code})</dd></div>
                {r.geo_source && r.latitude !== null && r.longitude !== null && (
                  <div><dt>Position déclarée</dt><dd>{GEO_SOURCE_LABEL[r.geo_source]}, non vérifiée</dd></div>
                )}
              </dl>
              {state.canWrite &&
                (archiving?.id === r.id ? (
                  <div className={styles.confirm} role="alertdialog" aria-label="Confirmer l’archivage" data-address-archive-confirm="">
                    <p>Archiver l’adresse « {r.label} » (version {r.version}) ? Elle ne sera plus proposée.</p>
                    <div className={styles.actions}>
                      <button type="button" className={styles.danger} disabled={state.busy} onClick={() => quick((c) => ctrl.archive(r, c).then((ok) => (setArchiving(null), ok)))}>Confirmer l’archivage</button>
                      <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => setArchiving(null)}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.actions}>
                    <button type="button" className={styles.secondary} disabled={state.busy || Boolean(form)} onClick={() => { setErrors({}); setGeoNote(""); setFormCommandId(null); setForm(editForm(r)); setFormBase(editForm(r)); setFormConflict(false); }}>Modifier</button>
                    {r.is_preferred ? (
                      <button type="button" className={styles.secondary} disabled={state.busy || Boolean(form)} onClick={() => quick((c) => ctrl.setPreferred(r, false, c))} data-address-unprefer="">Retirer la préférence</button>
                    ) : (
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={state.busy || Boolean(form) || Boolean(preferred)}
                        title={preferred ? ADDRESS_COPY.otherPreferred(preferred.label) : undefined}
                        onClick={() => quick((c) => ctrl.setPreferred(r, true, c))}
                        data-address-prefer=""
                      >
                        Définir comme préférée
                      </button>
                    )}
                    <button type="button" className={styles.secondary} disabled={state.busy || Boolean(form) || r.is_preferred} onClick={() => setArchiving(r)} data-address-archive="">Archiver</button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
      {state.phase === "ready" && preferred === null && state.records.length > 0 && <p className={styles.hint}>Aucune adresse préférée : choisissez-en une pour la retrouver en premier.</p>}
      {state.phase === "ready" && preferred && state.records.some((r) => !r.is_preferred) && state.canWrite && <p className={styles.hint}>{ADDRESS_COPY.otherPreferred(preferred.label)}</p>}
    </section>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactElement }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {hint && <small className={styles.hint}>{hint}</small>}
      {error && <small className={styles.error} role="alert">{error}</small>}
    </label>
  );
}

/** Preferred saved address for the request form's explicit preselection (live only, once per
 *  identity). Any failure or off-contract reply ⇒ null: the form simply starts empty. */
export function usePreferredAddress({ enabled, context, api }: { enabled: boolean; context: AddressContext; api?: AddressApi }): PreferredAddressValue | null {
  const [value, setValue] = useState<{ key: string; address: PreferredAddressValue | null } | null>(null);
  const uid = context.userId();
  const gen = context.generation();
  const key = `${uid ?? ""}:${gen}`;
  useEffect(() => {
    // Leaving the new-request view (or no identity) clears the cached choice: a later visit never
    // shows an old preferred address before its own fresh reply (ROOT review of 18e44ff).
    setValue(null);
    if (!enabled || !uid) return;
    let alive = true;
    void (api ?? createAddressApi())
      .list()
      .then((r) => {
        if (!alive || context.userId() !== uid || context.generation() !== gen) return;
        const list = r.status === 200 ? parseAddressList(r.body, uid) : null;
        const p = list?.records.find((x) => x.is_preferred) ?? null;
        setValue({ key, address: p ? { label: p.label, address: p.address, postal_code: p.postal_code, city: p.city } : null });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  return enabled && value?.key === key ? value.address : null;
}
export type PreferredAddressValue = { label: string; address: string; postal_code: string; city: string };
