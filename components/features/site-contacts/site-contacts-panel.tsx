"use client";
// ENT-04 site contacts & instructions panel: people to reach on site (name, role, phone / email
// exactly as the server returns them) and access instructions. Create / edit / archive only when
// the server says can_write; versioned commands with a stable contact id and an operation
// command_id (replayed unchanged after a lost reply). No invitation, SMS or email is sent.
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CONTACTS_COPY,
  CONTACTS_INITIAL,
  DEFAULT_CONTACTS_CONTEXT,
  contactFormToCommand,
  contactUuid,
  createContactsApi,
  createContactsController,
  editContactForm,
  newContactForm,
  type ContactErrors,
  type ContactForm,
  type ContactsApi,
  type ContactsContext,
  type ContactsState,
  type SiteContact,
} from "./contacts-model";
import styles from "./site-contacts.module.css";

type PanelProps = { siteId: string; readOnly?: boolean; api?: ContactsApi; context?: ContactsContext; /** Tests only. */ initial?: ContactsState; newId?: () => string | null };
/** Keyed by site: another site is a fresh panel (no list, cursor or form carried over). */
export function SiteContactsPanel(props: PanelProps) {
  return <SitePanel key={`${props.siteId}|${Boolean(props.readOnly)}`} {...props} />;
}
function SitePanel({ siteId, api, context = DEFAULT_CONTACTS_CONTEXT, initial, readOnly = false, newId = contactUuid }: PanelProps) {
  const [state, setStateRaw] = useState<ContactsState>(() => { const value = initial ?? CONTACTS_INITIAL; return readOnly ? { ...value, canWrite: false, pending: null } : value; });
  const ref = useRef(state);
  const set = (next: ContactsState) => {
    if (readOnly) next = { ...next, canWrite: false, pending: null };
    ref.current = next;
    setStateRaw(next);
  };
  const latest = useRef({ api, context });
  latest.current = { api, context };
  const controller = useRef<ReturnType<typeof createContactsController> | null>(null);
  if (!controller.current) {
    let client: ContactsApi | null = null;
    controller.current = createContactsController({
      api: () => (client ??= latest.current.api ?? createContactsApi()),
      siteId,
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

  const [form, setForm] = useState<ContactForm | null>(null);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [archiving, setArchiving] = useState<SiteContact | null>(null);
  const [noId, setNoId] = useState(false);

  const open = (f: ContactForm | null) => {
    setErrors({});
    setForm(f);
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form) return;
    const commandId = newId();
    if (!commandId) return setNoId(true);
    setNoId(false);
    const out = contactFormToCommand(form, commandId);
    if ("errors" in out) return setErrors(out.errors);
    setErrors({});
    await ctrl.save(out.command);
    const s = ref.current;
    if (!s.writeError && !s.pending && s.saved) setForm(null); // 409 / 422 / 503 keep the values
  };
  const confirmArchive = async (r: SiteContact) => {
    const commandId = newId();
    if (!commandId) return setNoId(true);
    setNoId(false);
    await ctrl.archive(r, commandId);
    setArchiving(null);
  };
  const writeError = state.writeError && (
    <div className={styles.error} role="alert">
      {state.writeError}{" "}
      {state.pending ? (
        <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.retry()} data-contacts-retry="">Réessayer</button>
      ) : (
        <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.load()} data-contacts-reload="">Actualiser la liste</button>
      )}
    </div>
  );

  return (
    <section className={styles.panel} aria-labelledby={`contacts-${siteId}`} data-contacts-panel={state.phase} aria-busy={state.busy || state.phase === "loading" || undefined}>
      <div className={styles.head}>
        <h2 id={`contacts-${siteId}`}>Contacts et consignes du site</h2>
        {state.canWrite && state.phase === "ready" && !form && (
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              const id = newId();
              if (!id) return setNoId(true);
              setNoId(false);
              open(newContactForm(id));
            }}
            data-contacts-add=""
          >
            Ajouter un contact
          </button>
        )}
      </div>
      <p className={styles.hint}>Personnes à joindre sur place et consignes d’accès. Aucune invitation ni message n’est envoyé.</p>
      {noId && <p className={styles.error} role="alert" data-contacts-noid="">{CONTACTS_COPY.noId}</p>}
      {state.phase === "ready" && !state.canWrite && <p className={styles.note} data-contacts-readonly="">{CONTACTS_COPY.readOnly}</p>}
      {state.saved && <p className={styles.ok} role="status">{state.saved}</p>}
      {!form && writeError}

      {form && state.canWrite && (
        <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate data-contacts-form={form.expected_version === null ? "create" : "edit"}>
          <h3>{form.expected_version === null ? "Nouveau contact" : `Modifier le contact (version ${form.expected_version})`}</h3>
          <div className={styles.grid}>
            <Field label="Prénom" error={errors.first_name}><input value={form.first_name} maxLength={100} autoComplete="off" onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></Field>
            <Field label="Nom" error={errors.last_name}><input value={form.last_name} maxLength={100} autoComplete="off" onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></Field>
          </div>
          <Field label="Fonction ou rôle sur le site" error={errors.role_label}><input value={form.role_label} maxLength={160} onChange={(e) => setForm({ ...form, role_label: e.target.value })} /></Field>
          <div className={styles.grid}>
            <Field label="Téléphone" error={errors.phone}><input type="tel" inputMode="tel" value={form.phone} maxLength={31} autoComplete="off" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Adresse email" error={errors.email}><input type="email" inputMode="email" value={form.email} maxLength={254} autoComplete="off" onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          </div>
          {errors.reach && <p className={styles.error} role="alert">{errors.reach}</p>}
          <Field label="Consignes (accès, horaires, précautions)" error={errors.note}><textarea value={form.note} maxLength={2000} rows={3} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <label className={styles.check}>
            <input type="checkbox" checked={form.is_primary} onChange={(e) => setForm({ ...form, is_primary: e.target.checked })} />
            Contact principal du site
          </label>
          {writeError}
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={state.busy} data-contacts-save="">{state.busy ? "Enregistrement…" : "Enregistrer"}</button>
            <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => open(null)}>Annuler</button>
          </div>
        </form>
      )}

      {state.phase === "loading" && <p className={styles.hint} role="status">Chargement des contacts…</p>}
      {(state.phase === "error" || state.phase === "unavailable") && (
        <div className={styles.error} role="alert" data-contacts-error="">
          {state.error}{" "}
          {state.phase === "error" && <button type="button" className={styles.secondary} onClick={() => void ctrl.load()}>Réessayer</button>}
        </div>
      )}
      {state.phase === "ready" && !state.records.length && <p className={styles.hint} data-contacts-empty="">{CONTACTS_COPY.empty}</p>}
      {state.phase === "ready" && state.total !== null && state.page?.has_more && <p className={styles.hint}>{CONTACTS_COPY.partial(state.records.length, state.total)}</p>}
      {state.phase === "ready" && state.records.length > 0 && (
        <ul className={styles.list}>
          {state.records.map((r) => (
            <li key={r.id} className={styles.row} data-contact-id={r.id}>
              <div className={styles.rowHead}>
                <strong>{r.first_name} {r.last_name}</strong>
                <span>{r.role_label}{r.is_primary && <> · <span className={styles.tag}>Contact principal</span></>}</span>
              </div>
              <dl className={styles.kv}>
                {r.phone !== null && <div><dt>Téléphone</dt><dd>{r.phone}</dd></div>}
                {r.email !== null && <div><dt>Email</dt><dd>{r.email}</dd></div>}
                <div><dt>Version</dt><dd>{r.version}</dd></div>
              </dl>
              {r.note && <p className={styles.hint}>{r.note}</p>}
              {state.canWrite && (
                archiving?.id === r.id ? (
                  <div className={styles.confirm} role="alertdialog" aria-label="Confirmer l’archivage du contact" data-contacts-archive-confirm="">
                    <p>Archiver le contact « {r.first_name} {r.last_name} » (version {r.version}) ? Il ne sera plus affiché pour ce site.</p>
                    <div className={styles.actions}>
                      <button type="button" className={styles.danger} disabled={state.busy} onClick={() => void confirmArchive(r)}>Confirmer l’archivage</button>
                      <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => setArchiving(null)}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.actions}>
                    <button type="button" className={styles.secondary} disabled={state.busy || Boolean(form)} onClick={() => open(editContactForm(r))}>Modifier</button>
                    <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => setArchiving(r)}>Archiver</button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {state.phase === "ready" && state.page?.has_more && (
        <button type="button" className={styles.secondary} disabled={state.loadingMore || state.busy} onClick={() => void ctrl.more()} data-contacts-more="">
          {state.loadingMore ? "Chargement…" : "Afficher plus"}
        </button>
      )}
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactElement }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {error && <small className={styles.error} role="alert">{error}</small>}
    </label>
  );
}
