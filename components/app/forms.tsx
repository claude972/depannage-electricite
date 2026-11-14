"use client";
import { RequestProgress } from "./request-progress";
import { BookingLocationField } from "./booking-location";
import { REQUEST_DESCRIPTION_LABEL } from "../../shared/request-details";
// Operational forms extracted from the original monolith; behaviour preserved, shared by the
// role spaces. Styling classes live in app/globals.css.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiRequestError, PHOTO_TYPES, validateUpload } from "./api";
import { classifyRefusal } from "./refusal";
import { AddressField, createAddressApi } from "./address-field";
import { normalizePhone } from "./booking-draft";
import { ACCOUNT_PHONE_MESSAGE, normalizeAccountPhone } from "../../shared/booking-contact";
import {
  applyOutcome,
  fetchHistoryPage,
  historyKey,
  initialHistory,
  mergeMessages,
  clearSentDraft,
  draftText,
  offersOlder,
  openThread,
  type ComposeDraft,
  type HistoryFetch,
  type HistoryState,
  visibleHistoryMessages,
} from "./message-history";
import {
  applyDocumentOutcome,
  documentHistoryKey,
  fetchDocumentPage,
  initialDocumentHistory,
  mergeDocuments,
  offersOlderDocuments,
  olderDocumentsUsable,
  type DocumentFetch,
  type DocumentHistoryState,
} from "./document-history";
import { Icon } from "./icons";
import { PHOTO_CAPTION_MAX, PHOTO_COPY, newSendId, openPhoto, sendPhotoMessage, uploadPhoto, type PhotoCommand, type PhotoFetch } from "./message-photo";
import { TAX_RATE_HINT, TAX_RATE_OPTIONS, TAX_RATE_PLACEHOLDER, TAX_RATE_REQUIRED, parseTaxRateInput, type TaxRate } from "./tax-rate";
import { Empty, Field, ConfirmAction, Unavailable } from "./ui";
import { ReviewEstimate } from "../features/indicative-prices/indicative-range";
import { useMessageReadState } from "../features/message-read/use-message-read-state";
import { MessageReadBadge, MessageReadControl } from "../features/message-read/message-read-control";
import { useWarrantyHistory } from "../features/warranty-corrective/use-warranty-history";
import { RecordedTerms } from "../features/warranty-policy/recorded-terms";
import { HISTORY_COPY as WARRANTY_COPY, claimAllowed } from "../features/warranty-corrective/warranty-history";
import { EnterpriseContractsPanel, type EnterpriseContractsContext, NO_CONTRACTS_CONTEXT } from "../features/enterprise-contracts/enterprise-contracts-panel";
import {
  CATEGORIES,
  ROLE_NAMES,
  category,
  csv,
  date,
  dateTime,
  download,
  money,
  shortId,
  uid,
} from "./format";
import type {
  ApprovalRule,
  Approval,
  Category,
  Contract,
  ComplianceRecord,
  Intervention,
  Line,
  Message,
  Operations,
  Profile,
  ProfessionalData,
  Quote,
  RequestValues,
  Review,
  Role,
  Site,
  StoredDocument,
  WarrantyCase,
} from "./types";

// Address suggestions (IGN / BAN via /api/addresses/*): strings only, never coordinates in drafts
// or payloads. Demo stays offline (no suggestions, no geolocation).
const addressApi = createAddressApi();

/** Keeps the focused step title clear of a sticky header when scrolled into view. */
const STEP_TITLE_STYLE = { scrollMarginTop: 88 } as const;

/** CLI-09: the client's saved preferred address, offered as an explicit, visible preselection. */
export type PreferredAddress = { label: string; address: string; postal_code: string; city: string };
/**
 * Preselection rule: only a FRESH draft (no restored/typed draft) whose three address fields are
 * still empty is prefilled; anything the user typed or restored is never overwritten. Pure.
 */
export function preferredPrefill(values: RequestValues, restored: RequestValues | null, preferred: PreferredAddress | null | undefined): RequestValues | null {
  if (!preferred || restored) return null;
  if (values.address.trim() || values.postal_code.trim() || values.city.trim()) return null;
  return { ...values, address: preferred.address, postal_code: preferred.postal_code, city: preferred.city };
}
/** The prefilled address is « préselectionnée » only while the fields still equal it. */
export const isPreferredSelection = (values: RequestValues, preferred: PreferredAddress | null) =>
  !!preferred && values.address === preferred.address && values.postal_code === preferred.postal_code && values.city === preferred.city;
export function PreferredAddressNote({ preferred, onClear }: { preferred: PreferredAddress; onClear: () => void }) {
  return (
    <p className="inline-note" role="status" data-preferred-address="">
      Adresse préférée « {preferred.label} » présélectionnée : vous pouvez la modifier ci-dessous.{" "}
      <button type="button" className="text-button" onClick={onClear} data-preferred-address-clear="">
        Ne pas l’utiliser
      </button>
    </p>
  );
}

export function RequestForm({
  initialCategory,
  categoryPreselected = true,
  initialValues,
  sites,
  mode,
  busy,
  onBack,
  onSubmit,
  onDemo,
  preferredAddress = null,
  finalStep,
  initialPhotos,
  addressFirst = false,
  initialDescription = "",
  initialUrgency = "scheduled",
  contactPhone,
}: {
  initialCategory: Category;
  /** False for a generic entry: the internal fallback is not a user selection. */
  categoryPreselected?: boolean;
  initialValues: RequestValues | null;
  sites: Site[];
  mode: string;
  busy: boolean;
  onBack: () => void;
  onSubmit: (values: RequestValues, photos: File[]) => Promise<void>;
  onDemo: () => void;
  /** Saved preferred address (client space only); never applied over a restored or typed draft. */
  preferredAddress?: PreferredAddress | null;
  /** Booking path (signed-in client): after the validated ADDRESS step the form hands over to the
   *  payment choice and the single final recap/confirmation (BookingConfirm). The form's own recap
   *  step is skipped and nothing is sent here, so it never reads like « Enregistrer ». */
  finalStep?: { label: string; note: string };
  /** Photos already chosen for a kept booking (edit): shown and editable, same 6-photo cap. */
  initialPhotos?: File[];
  /** Home address shortcut uses the same draft fields before the problem step. */
  addressFirst?: boolean;
  initialDescription?: RequestValues["description"];
  initialUrgency?: RequestValues["urgency"];
  /** Defined for client forms, with an optional value to prefill from the profile or booking. */
  contactPhone?: string;
}) {
  const [step, setStep] = useState(1);
  const [categoryChosen, setCategoryChosen] = useState(Boolean(initialValues) || categoryPreselected);
  const [categoryError, setCategoryError] = useState("");
  const categoryChoices = useRef<HTMLDivElement>(null);
  const phase = addressFirst && step < 3 ? 3 - step : step;
  const labels = addressFirst ? ["Le lieu et le besoin", "Le problème"] : ["Le problème", "Le lieu et le besoin"];
  // On each step change (not on first render) move focus AND the viewport to the new step title,
  // so mobile users never land at the bottom after « Continuer » and screen readers announce it.
  const stepTitle = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const el = stepTitle.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [step]);
  // Read after mount: the geolocation button never differs between server and client renders.
  const [geolocation, setGeolocation] = useState<Geolocation | null>(null);
  useEffect(() => {
    setGeolocation(typeof navigator !== "undefined" && navigator.geolocation ? navigator.geolocation : null);
  }, []);
  const [photos, setPhotos] = useState<File[]>(() => (initialPhotos ?? []).slice(0, 6));
  const [photoError, setPhotoError] = useState("");
  function addPhotos(list: FileList | null) {
    if (!list) return;
    const next = [...photos];
    const problems: string[] = [];
    for (const file of Array.from(list)) {
      if (next.length >= 6) {
        problems.push("Six photos au maximum.");
        break;
      }
      const invalid = validateUpload(file, PHOTO_TYPES);
      if (invalid) problems.push(`${file.name} : ${invalid}`);
      else if (!next.some((f) => f.name === file.name && f.size === file.size)) next.push(file);
    }
    setPhotos(next);
    setPhotoError(problems.join(" "));
  }
  const [values, setValues] = useState<RequestValues>(() => {
    const fresh: RequestValues = initialValues || { category: initialCategory, description: initialDescription, address: "", postal_code: "", city: "", urgency: initialUrgency };
    return preferredPrefill(fresh, initialValues, preferredAddress) ?? fresh;
  });
  // The preferred address may arrive after mount: same rule, applied once, never over typed text.
  const [preselected, setPreselected] = useState<PreferredAddress | null>(() => (preferredPrefill({ category: initialCategory, description: "", address: "", postal_code: "", city: "", urgency: "scheduled" }, initialValues, preferredAddress) ? preferredAddress : null));
  const prefillTried = useRef(preselected !== null);
  useEffect(() => {
    if (prefillTried.current || !preferredAddress) return;
    prefillTried.current = true;
    setValues((current) => {
      const next = preferredPrefill(current, initialValues, preferredAddress);
      if (next) setPreselected(preferredAddress);
      return next ?? current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredAddress]);
  const [phone, setPhone] = useState(contactPhone ?? "");
  const [phoneError, setPhoneError] = useState("");
  const c = category(values.category);
  function next(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase === 1 && !categoryChosen) {
      setCategoryError("Choisissez le problème qui correspond à votre demande.");
      categoryChoices.current?.querySelector("button")?.focus();
      return;
    }
    const normalizedPhone = contactPhone === undefined ? null : normalizePhone(phone);
    if (phase === 2 && contactPhone !== undefined && !normalizedPhone) {
      setPhoneError("Saisissez un numéro de téléphone valide (ex. +596 ou +590).");
      return;
    }
    const submitted = normalizedPhone ? { ...values, contact_phone: normalizedPhone } : values;
    // Booking hand-off: the address step (native validation passed) goes straight to the payment
    // choice; the form's recap would duplicate the final confirmation.
    if (finalStep && step === 2) {
      void onSubmit(submitted, photos);
      return;
    }
    if (step < 3) setStep(step + 1);
    else void onSubmit(submitted, photos);
  }
  return (
    <div className="form-page">
      <button className="back-link" onClick={onBack}>
        <Icon name="back" size={17} />
        Retour
      </button>
      <div className="form-heading">
        <h1>Créons votre demande.</h1>
        <p>Le bon point de départ pour résoudre votre problème électrique.</p>
      </div>
      <RequestProgress step={step} labels={[...labels, finalStep ? "Règlement et confirmation" : "Le récapitulatif"]} />
      <form className="panel request-form" onSubmit={next}>
        {phase === 1 ? (
          <>
            <h2 ref={stepTitle} tabIndex={-1} style={STEP_TITLE_STYLE}>Que se passe-t-il ?</h2>
            <div className="category-grid" ref={categoryChoices} role="group" aria-label="Choisir le problème" aria-describedby={categoryError ? "request-category-error" : undefined}>
              {CATEGORIES.map((cat) => (
                <button
                  type="button"
                  className={categoryChosen && values.category === cat.id ? "selected" : ""}
                  aria-pressed={categoryChosen && values.category === cat.id}
                  key={cat.id}
                  onClick={() => { setValues({ ...values, category: cat.id }); setCategoryChosen(true); setCategoryError(""); }}
                >
                  <Icon name={cat.icon} size={25} />
                  <span>
                    <strong>{cat.label}</strong>
                    <small>{cat.description}</small>
                  </span>
                  <span className="radio-dot" />
                </button>
              ))}
            </div>
            {categoryError && <p id="request-category-error" className="field-error" role="alert">{categoryError}</p>}
            <Field
              label={REQUEST_DESCRIPTION_LABEL}
              hint="Ce que vous constatez, les pièces concernées et depuis quand."
            >
              <textarea
                value={values.description}
                maxLength={2000}
                rows={4}
                placeholder="Par exemple : le disjoncteur se déclenche depuis ce matin lorsque j’allume le four…"
                onChange={(e) =>
                  setValues({ ...values, description: e.target.value })
                }
              />
            </Field>
            <Field
              label="Ajouter des photos (facultatif)"
              hint={
                mode === "live"
                  ? "JPEG, PNG ou WebP, 4 Mo par photo, six au plus. Elles sont envoyées dans votre espace privé juste après l’enregistrement de la demande."
                  : mode === "demo"
                    ? "La démonstration n’envoie aucun fichier : la sélection sert seulement à visualiser l’étape."
                    : "Gardez cet onglet ouvert. En cas de rechargement, vous pourrez ajouter les photos depuis le dossier."
              }
              error={photoError || undefined}
            >
              <input
                key="request-photos"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => {
                  addPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </Field>
            {photos.length > 0 && (
              <ul className="photo-list" aria-label="Photos sélectionnées">
                {photos.map((f, index) => (
                  <li key={`${f.name}-${f.size}`}>
                    <Icon name="camera" size={16} />
                    <span>
                      {f.name} · {Math.max(1, Math.round(f.size / 1024))} Ko
                    </span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Retirer ${f.name}`}
                      onClick={() => setPhotos(photos.filter((_, j) => j !== index))}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="inline-note">
              <Icon name="shield" />
              <p>
                Ne manipulez pas une installation qui présente un danger. Cette
                application ne fournit pas de diagnostic d’urgence.
              </p>
            </div>
          </>
        ) : phase === 2 ? (
          <>
            <h2 ref={stepTitle} tabIndex={-1} style={STEP_TITLE_STYLE}>Où faut-il intervenir ?</h2>
            {sites.length > 0 && (
              <Field label="Site professionnel (facultatif)">
                <select
                  value={values.site_id || ""}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      site_id: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">Adresse personnelle ou autre lieu</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {preselected && isPreferredSelection(values, preselected) && (
              <PreferredAddressNote
                preferred={preselected}
                onClear={() => {
                  setPreselected(null);
                  setValues((current) => { const { location: _location, ...rest } = current; return { ...rest, address: "", postal_code: "", city: "" }; });
                }}
              />
            )}
            {(mode === "public" || finalStep) ? <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><BookingLocationField
              value={{ address: values.address, postal_code: values.postal_code, city: values.city }}
              location={values.location}
              onChange={(next, location) => setValues((current) => ({ ...current, ...next, location }))}
              geolocation={mode === "demo" ? null : geolocation}
            /></fieldset> : <AddressField
              value={{ address: values.address, postal_code: values.postal_code, city: values.city }}
              onChange={(next) => setValues((current) => ({ ...current, ...next }))}
              disabled={busy}
              search={mode === "demo" ? undefined : addressApi.search}
              reverse={mode === "demo" ? undefined : addressApi.reverse}
              geolocation={mode === "demo" ? null : geolocation}
            />}
            {contactPhone !== undefined && (
              <Field label="Téléphone de contact (obligatoire)" error={phoneError || undefined}>
                <input key="request-phone" type="tel" autoComplete="tel" maxLength={30} required value={phone} onChange={(e) => { setPhone(e.target.value); setPhoneError(""); }} />
              </Field>
            )}
            <fieldset className="urgency-options">
              <legend>Quel est votre besoin ?</legend>
              {[
                [
                  "scheduled",
                  "Intervention à planifier",
                  "Le problème peut attendre un rendez-vous.",
                ],
                [
                  "urgent",
                  "Demande urgente",
                  "Le problème nécessite une prise en charge prioritaire.",
                ],
              ].map(([id, label, desc]) => (
                <label
                  key={id}
                  className={values.urgency === id ? "selected" : ""}
                >
                  <input
                    type="radio"
                    name="urgency"
                    value={id}
                    checked={values.urgency === id}
                    onChange={() =>
                      setValues({
                        ...values,
                        urgency: id as "urgent" | "scheduled",
                      })
                    }
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{desc}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="form-note">
              La disponibilité et les délais seront précisés après prise en
              charge. Aucune affectation immédiate n’est garantie.
            </p>
            {finalStep && (
              <p className="muted" data-request-final-note="">
                {finalStep.note}
              </p>
            )}
          </>
        ) : (
          <>
            <h2 ref={stepTitle} tabIndex={-1} style={STEP_TITLE_STYLE}>Votre demande, en clair.</h2>

            <div className="recap-service">
              <span className="service-icon">
                <Icon name={c.icon} size={27} />
              </span>
              <div>
                <strong>{c.label}</strong>
                <span>
                  {values.urgency === "urgent"
                    ? "Demande urgente"
                    : "Intervention à planifier"}
                </span>
              </div>
            </div>
            <p>{values.description}</p>
            {photos.length > 0 && (
              <p className="form-note">
                {photos.length} photo{photos.length > 1 ? "s" : ""} sélectionnée
                {photos.length > 1 ? "s" : ""}
                {mode === "live"
                  ? ", envoyée(s) après l’enregistrement."
                  : mode === "demo"
                    ? " (non envoyée(s) en démonstration)."
                    : " (à rajouter une fois connecté)."}
              </p>
            )}
            <div className="recap-address">
              <Icon name="location" />
              <span>
                {values.address}
                <br />
                {values.postal_code} {values.city}
              </span>
            </div>
            {contactPhone !== undefined && <p>Téléphone de contact · {phone}</p>}
            <div className="estimate-box">
              <span>Estimation indicative</span>
              {/* PUB-02: demo keeps the local V1 range; live shows the server's active version (or
                  « estimation non vérifiée »), never the static amount presented as current. */}
              {mode === "demo" ? (
                <strong>
                  {money(c.min)} – {money(c.max)}
                </strong>
              ) : (
                <ReviewEstimate category={values.category} scope="request-form" />
              )}
              <p>
                Ces montants sont des exemples de préparation du service. Le
                prix final et les taxes applicables seront précisés dans un
                devis à accepter avant intervention.
              </p>
            </div>
            {mode === "public" && (
              <div className="alert warning">
                <Icon name="lock" />
                <span>
                  Un compte est nécessaire pour enregistrer et suivre votre
                  demande. Vous pourrez aussi explorer une démonstration sans
                  envoyer de demande réelle.
                </span>
              </div>
            )}
            {mode === "demo" && (
              <div className="alert warning">
                <Icon name="help" />
                <span>
                  Cette demande restera dans la démonstration. Ne saisissez pas
                  de données personnelles réelles.
                </span>
              </div>
            )}
          </>
        )}
        <div className="form-actions">
          {step > 1 ? (
            <button
              type="button"
              className="button outline"
              onClick={() => setStep(step - 1)}
            >
              <Icon name="back" size={16} />
              Précédent
            </button>
          ) : (
            <span />
          )}
          <button type="submit" className="button primary" disabled={busy}>
            {busy
              ? finalStep
                ? "Veuillez patienter…"
                : "Enregistrement…"
              : finalStep && step === 2
                ? finalStep.label
                : step < 3
                ? "Continuer"
                : mode === "public"
                  ? "Créer mon compte et continuer"
                  : finalStep
                    ? finalStep.label
                    : "Enregistrer la demande"}
            {!busy && <Icon name="arrow" size={16} />}
          </button>
        </div>
        {mode === "public" && step === 3 && (
          <button type="button" className="text-button full" onClick={onDemo}>
            Essayer d’abord la démonstration
          </button>
        )}
      </form>
    </div>
  );
}
/** Legacy direct send (draft route unavailable): explicit supported rate required, never a default. */
export function validateQuoteEditor(lines: Line[], tax: TaxRate | null):
  | { ok: true; payload: { lines: Line[]; tax_rate: TaxRate } }
  | { ok: false; error: string; taxError?: string } {
  const subtotal = lines.reduce((n, l) => n + Math.round(l.quantity * l.unit_price_cents), 0);
  if (lines.some((l) => !l.label.trim() || !Number.isInteger(l.quantity) || l.quantity <= 0 || l.unit_price_cents < 0) || subtotal <= 0)
    return { ok: false, error: "Renseignez les prestations, les quantités et un montant total supérieur à zéro." };
  if (tax === null) return { ok: false, error: TAX_RATE_REQUIRED, taxError: TAX_RATE_REQUIRED };
  return { ok: true, payload: { lines, tax_rate: tax } };
}

export function QuoteEditor({
  busy,
  demo,
  onSubmit,
}: {
  busy: boolean;
  demo: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const [lines, setLines] = useState<Line[]>([
    { label: "Déplacement", quantity: 1, unit_price_cents: 0 },
    { label: "Main-d’œuvre", quantity: 1, unit_price_cents: 0 },
  ]);
  const [tax, setTax] = useState<TaxRate | null>(null);
  const [err, setErr] = useState("");
  const [taxErr, setTaxErr] = useState("");
  const subtotal = lines.reduce(
    (n, l) => n + Math.round(l.quantity * l.unit_price_cents),
    0,
  );
  return (
    <form
      className="panel quote-editor"
      onSubmit={(e) => {
        e.preventDefault();
        const checked = validateQuoteEditor(lines, tax);
        if (!checked.ok) {
          setErr(checked.error);
          setTaxErr(checked.taxError ?? "");
          return;
        }
        setErr("");
        setTaxErr("");
        onSubmit(checked.payload);
      }}
    >
      <h2>Établir le devis</h2>
      <p>Détaillez les prestations et vérifiez les taxes applicables.</p>
      {err && (
        <div className="alert error" role="alert">
          {err}
        </div>
      )}
      {lines.map((l, index) => (
        <div className="quote-editor-row" key={index}>
          <Field label={`Prestation ${index + 1}`}>
            <input
              required
              maxLength={150}
              value={l.label}
              onChange={(e) =>
                setLines(
                  lines.map((x, j) =>
                    j === index ? { ...x, label: e.target.value } : x,
                  ),
                )
              }
            />
          </Field>
          <Field label="Quantité">
            <input
              required
              type="number"
              min="1"
              max="1000"
              step="1"
              value={l.quantity}
              onChange={(e) =>
                setLines(
                  lines.map((x, j) =>
                    j === index
                      ? { ...x, quantity: Number(e.target.value) }
                      : x,
                  ),
                )
              }
            />
          </Field>
          <Field label="Prix unitaire HT (€)">
            <input
              required
              type="number"
              min="0"
              max="100000"
              step="0.01"
              value={l.unit_price_cents / 100}
              onChange={(e) =>
                setLines(
                  lines.map((x, j) =>
                    j === index
                      ? {
                          ...x,
                          unit_price_cents: Math.round(
                            Number(e.target.value) * 100,
                          ),
                        }
                      : x,
                  ),
                )
              }
            />
          </Field>
          <button
            className="icon-button"
            type="button"
            disabled={lines.length === 1}
            aria-label={`Supprimer la prestation ${index + 1}`}
            onClick={() => setLines(lines.filter((_, j) => j !== index))}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        onClick={() =>
          setLines([...lines, { label: "", quantity: 1, unit_price_cents: 0 }])
        }
      >
        <Icon name="plus" size={17} />
        Ajouter une ligne
      </button>
      <Field
        label="Taux de TVA (%)"
        hint={
          demo
            ? "Taux de démonstration, sans validation fiscale."
            : TAX_RATE_HINT
        }
        error={taxErr || undefined}
      >
        <select value={tax === null ? "" : String(tax)} onChange={(e) => { setTax(parseTaxRateInput(e.target.value)); setTaxErr(""); }} data-tax-rate="">
          <option value="">{TAX_RATE_PLACEHOLDER}</option>
          {TAX_RATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="quote-totals">
        <div>
          <span>Total HT</span>
          <strong>{money(subtotal)}</strong>
        </div>
        <div className="total">
          <span>Total TTC</span>
          <strong>
            {tax === null ? "—" : money(subtotal + Math.round((subtotal * tax) / 100))}
          </strong>
        </div>
      </div>
      <button type="submit" className="button primary full" disabled={busy}>
        <Icon name="send" />
        {busy ? "Envoi…" : "Envoyer le devis"}
      </button>
    </form>
  );
}
// Paginated history of the open conversation (FASTSPLIT-MESSAGE-HISTORY-001). Live mode only:
// the newest page is read when the dossier opens, older pages on explicit request. State is keyed
// by identity + dossier: a change aborts the read in flight and starts empty; a late reply is
// ignored. Nothing is cached beyond the mounted view.
const browserFetch: HistoryFetch = (url, init) => fetch(url, init);
function useMessageHistory(live: boolean, profileId: string, interventionId: string, fetchImpl: HistoryFetch) {
  const key = historyKey(profileId, interventionId);
  const enabled = live && Boolean(profileId) && Boolean(interventionId);
  const [state, setState] = useState<HistoryState>(() => initialHistory(key));
  const stateRef = useRef(state);
  const flight = useRef<AbortController | null>(null);
  const update = useCallback((next: (s: HistoryState) => HistoryState) => {
    stateRef.current = next(stateRef.current);
    setState(stateRef.current);
  }, []);
  const load = useCallback(() => {
    const from = stateRef.current;
    if (!enabled || from.key !== key || from.status === "loading" || from.status === "not_found" || from.status === "signed_out") return;
    if (from.loaded && !from.hasMore) return;
    flight.current?.abort();
    const ctl = new AbortController();
    flight.current = ctl;
    update((s) => ({ ...s, status: "loading" }));
    void fetchHistoryPage(fetchImpl, interventionId, from.cursor, ctl.signal).then((outcome) => {
      if (flight.current !== ctl) return; // superseded by a dossier/identity change
      flight.current = null;
      update((s) => applyOutcome(s, key, outcome));
    });
  }, [enabled, key, interventionId, fetchImpl, update]);
  useEffect(() => {
    flight.current?.abort();
    flight.current = null;
    update(() => initialHistory(key));
    if (enabled) load();
    return () => {
      flight.current?.abort();
      flight.current = null;
    };
  }, [key, enabled, load, update]);
  /** P1 (E42): rights may have changed — restart from the newest page (a 404/401 then purges). */
  const reread = useCallback(() => {
    if (!enabled) return;
    flight.current?.abort();
    flight.current = null;
    update(() => initialHistory(key));
    load();
  }, [enabled, key, load, update]);
  return { state: state.key === key ? state : initialHistory(key), load, reread, enabled };
}
/** Who wrote a thread message, from the dossier's own participants. An author who is neither the
 *  dossier's client nor its artisan is never presented as the other party: on a private dossier it
 *  can only be the operator; on a site dossier it may also be a member of the client organisation. */
export function messageAuthorLabel(
  authorId: string,
  dossier: Pick<Intervention, "client_id" | "artisan_id" | "site_id"> | undefined,
  role: Role,
  profileId: string,
): string {
  if (authorId === profileId) return "Vous";
  if (dossier?.artisan_id && authorId === dossier.artisan_id) return "Artisan";
  if (dossier?.client_id && authorId === dossier.client_id) return "Client";
  if (!dossier?.client_id || (role !== "client" && !dossier.artisan_id)) return "Participant";
  if (dossier.site_id || role === "manager") return "Autre participant (équipe ou exploitant)";
  return "Exploitant";
}

export function MessageCenter({
  interventions,
  messages,
  role,
  profileId,
  selectedId,
  busy,
  onSubmit,
  live = false,
  fetchHistory = browserFetch,
  canSend,
  readOnlyReason,
  context,
  photoFetch = browserFetch,
  loadOperations,
}: {
  interventions: Intervention[];
  messages: Message[];
  role: Role;
  profileId: string;
  selectedId: string;
  busy: boolean;
  /** `commandId` (E41): one UUID per message intention, resent unchanged until confirmed. */
  onSubmit: (id: string, body: string, commandId: string) => Promise<boolean | undefined>;
  /** Live session: the paginated history is read from /api/messages. Demo/default: preview only, no call. */
  live?: boolean;
  /** Test seam for the history client. */
  fetchHistory?: HistoryFetch;
  /** Whether the viewer may write in this dossier (default: yes). The server still decides. */
  canSend?: (id: string) => boolean;
  /** Short reason shown instead of the compose box when canSend is false. */
  readOnlyReason?: string;
  /** Session mutation context (uid + generation): identity fence of the photo upload / send /
   *  opening. Without it (or outside live mode) no photo is uploaded, sent or opened. */
  context?: PhotoContext;
  /** Test seam for the photo requests (upload, send, open). */
  photoFetch?: PhotoFetch;
  /** CLI-06 / ART-06: the session's already-authorised operations read (contact + appointment). */
  loadOperations?: (id: string) => Promise<Operations | null>;
}) {
  const [picked, setId] = useState(selectedId || interventions[0]?.id || "");
  // The open dossier follows the selectedId prop (hash #messages/A → #messages/B in the same
  // document) and identity changes; a click in the thread list still selects explicitly.
  const [seen, setSeen] = useState({ selectedId, profileId });
  if (seen.selectedId !== selectedId || seen.profileId !== profileId) {
    const identityChanged = seen.profileId !== profileId;
    setSeen({ selectedId, profileId });
    if (selectedId) setId(selectedId);
    else if (identityChanged) setId(interventions[0]?.id || "");
  }
  // A dossier that left the list (scope switched, rights removed) is never kept open unless it is
  // the explicit target: its messages, history and draft must not show in the new scope.
  const id = openThread(picked, selectedId, interventions.map((i) => i.id));
  if (id !== picked) setId(id);
  const target = interventions.find((i) => i.id === id);
  const writable = !canSend || canSend(id);
  // The compose draft belongs to ONE identity + dossier: switching never carries A's text to B.
  const threadKey = historyKey(profileId, id);
  const [draft, setDraft] = useState<ComposeDraft>({ key: threadKey, text: "" });
  const sendIntent = useRef<{ thread: string; text: string; id: string } | null>(null);
  const body = draftText(draft, threadKey);
  const setBody = (text: string) => setDraft({ key: threadKey, text });
  const history = useMessageHistory(live, profileId, id, fetchHistory);
  const h = history.state;
  // E42: the open thread left the re-read list (reassignment, rights): re-read its history before
  // anything else is shown or sent; the server's refusal purges it.
  const listed = interventions.some((i) => i.id === id);
  const wasListed = useRef(listed);
  useEffect(() => {
    if (wasListed.current && !listed) history.reread();
    wasListed.current = listed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listed, id]);
  const notFound = history.enabled && h.status === "not_found";
  // P1 (E39): a 401 reported by the API purges the protected thread in this document (messages,
  // contact, compose) like a 404; only the reconnect message stays.
  const unavailable = notFound || (history.enabled && h.status === "signed_out");
  // Live: the preview never pre-fills older history (see visibleHistoryMessages). Demo: unchanged,
  // every workspace message of the dossier (no history exists there).
  // Photo messages confirmed by their 201 are merged at once (dedup by id), no manual reload.
  const [sentPhotos, setSentPhotos] = useState<{ key: string; message: Message }[]>([]);
  const photoCommands = useRef(new Map<string, PhotoDraft>());
  const photos = live && Boolean(context);
  const rows = unavailable
    ? []
    : mergeMessages(id, history.enabled ? visibleHistoryMessages(id, messages, h.pages) : messages.filter((m) => m.intervention_id === id), sentPhotos.filter((x) => x.key === threadKey).map((x) => x.message));
  const firstLoad = history.enabled && !h.loaded && (h.status === "idle" || h.status === "loading");
  // SYS-04 / M62: read confirmations of the open thread. The hook is always called; its ACTIVITY is
  // gated (live, mutation context, selected authorised thread, not « indisponible »); otherwise it is
  // disabled and makes no call. Labels come from the server state only.
  const readActive = live && Boolean(context) && Boolean(id) && Boolean(target) && !unavailable;
  const readState = useMessageReadState({ context: context ?? NO_READ_CONTEXT, interventionId: readActive ? id : null, messages: rows, demo: !readActive });
  return (
    <section className="panel messages-layout">
      <div className="message-threads">
        <h2>Interventions</h2>
        {interventions.map((i) => (
          <button
            key={i.id}
            className={id === i.id ? "selected" : ""}
            onClick={() => setId(i.id)}
          >
            <Icon name={category(i.category).icon} />
            <span>
              <strong>{category(i.category).label}</strong>
              <small>{shortId(i.id)}</small>
            </span>
            <Icon name="arrow" size={15} />
          </button>
        ))}
      </div>
      <div className="message-conversation">
        {!id ? (
          <Empty icon="message" title="Aucune conversation">
            Vos échanges seront disponibles une fois une demande créée.
          </Empty>
        ) : (
          <>
            <div className="conversation-header">
              {/* A target absent from the list gets a generic title, never an invented category. */}
              <h2>{target ? category(target.category).label : "Conversation"}</h2>
              <span>{target ? "Conversation liée à l’intervention" : `Dossier ${shortId(id)}`}</span>
            </div>
            {readActive && <MessageReadControl state={readState} />}
            {/* CLI-06 / ART-06: expected participant + recorded slot, on explicit open, live only. */}
            {live && context && loadOperations && target && !unavailable && (
              <ConversationContact
                key={`${context.userId() ?? "-"}|${context.generation()}|${target.id}|${target.artisan_id ?? "-"}|${target.client_id ?? "-"}|${target.status}`}
                intervention={target}
                role={role}
                context={context}
                load={loadOperations}
              />
            )}
            <div className="message-history" aria-live="polite" aria-busy={h.status === "loading"}>
              {history.enabled && offersOlder(h) && (
                <button
                  type="button"
                  className="button outline"
                  data-message-older
                  disabled={h.status === "loading"}
                  onClick={history.load}
                >
                  Charger les messages plus anciens
                </button>
              )}
              {history.enabled && h.status === "loading" && (
                <p role="status" data-message-history="loading">
                  Chargement des messages…
                </p>
              )}
              {history.enabled && h.status === "error" && (
                <div role="alert" data-message-history="error">
                  <p>
                    {h.loaded
                      ? "Les messages plus anciens n’ont pas pu être chargés. Les messages affichés restent valables."
                      : "L’historique des messages n’a pas pu être chargé. Les messages affichés restent valables."}
                  </p>
                  <button type="button" className="button outline" onClick={history.load}>
                    Réessayer
                  </button>
                </div>
              )}
              {history.enabled && h.status === "signed_out" && (
                <p role="alert" data-message-history="signed_out">
                  Votre session a expiré. Reconnectez-vous pour retrouver vos messages.
                </p>
              )}
              {unavailable ? (
                notFound && <div data-message-history="not_found">
                  <Empty icon="message" title="Conversation indisponible">
                    Cette conversation n’est pas accessible depuis votre compte.
                  </Empty>
                </div>
              ) : rows.length ? (
                rows.map((m) => (
                  <div
                    className={`message-bubble ${m.author_id === profileId ? "mine" : ""}`}
                    key={m.id}
                    data-message-id={m.id}
                  >
                    <span>
                      {messageAuthorLabel(m.author_id, target, role, profileId)}
                    </span>
                    {m.body && <p>{m.body}</p>}
                    {m.attachment_id && (photos && context ? <PhotoView key={`${threadKey}|${m.id}`} messageId={m.id} context={context} fetchImpl={photoFetch} /> : <p className="form-note">Photo jointe</p>)}
                    <small>{date(m.created_at)}</small>
                    <MessageReadBadge status={readState.statusOf(m.id)} own={m.author_id === profileId} />
                  </div>
                ))
              ) : firstLoad ? null : (
                <Empty icon="message" title="Commencez l’échange">
                  Posez une question sur cette intervention.
                </Empty>
              )}
            </div>
            {!unavailable && !writable && (
              <p className="inline-note" data-message-readonly>
                {readOnlyReason || "Lecture seule : vos droits sur ce dossier ne permettent pas d’envoyer de message."}
              </p>
            )}
            {!unavailable && writable && !(history.enabled && !listed && !h.loaded) && (
            <form
              className="message-compose"
              onSubmit={(e) => {
                e.preventDefault();
                if (body.trim()) {
                  const sentKey = threadKey;
                  const sentText = body; // snapshot of the draft as sent
                  const text = body.trim();
                  // E41: same thread + same text ⇒ same intention key until a confirmed send.
                  const known = sendIntent.current;
                  const commandId = known && known.thread === sentKey && known.text === text ? known.id : typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "";
                  if (!commandId) return;
                  sendIntent.current = { thread: sentKey, text, id: commandId };
                  void onSubmit(id, text, commandId).then((saved) => {
                    // Clear only the draft that was sent (same thread, unchanged since); text typed
                    // during the request is kept; on failure the draft stays as is.
                    if (saved) {
                      if (sendIntent.current?.id === commandId) sendIntent.current = null;
                      setDraft((d) => clearSentDraft(d, sentKey, sentText));
                    }
                  });
                }
              }}
            >
              <label className="sr-only" htmlFor="message-body">
                Votre message
              </label>
              <textarea
                id="message-body"
                required
                maxLength={2000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Écrivez votre message…"
                rows={2}
              />
              <button
                className="button primary"
                disabled={busy || !body.trim()}
                type="submit"
                aria-label="Envoyer le message"
              >
                <Icon name="send" />
              </button>
            </form>
            )}
            {!unavailable && writable && photos && context && (
              <PhotoCompose
                key={`${threadKey}|${context.generation()}`}
                interventionId={id}
                context={context}
                fetchImpl={photoFetch}
                store={photoCommands.current}
                storeKey={`${threadKey}|${context.generation()}`}
                onSent={(message) => setSentPhotos((list) => (list.some((x) => x.message.id === message.id) ? list : [...list, { key: threadKey, message }]))}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
// ---- Contact and appointment of the conversation (CLI-06 / ART-06 / M62) -----------------------
/** A phone number usable in a tel: link: E.164, or a 10-digit French national number. */
export function telHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const compact = raw.trim().replace(/[\s.()-]/g, "");
  if (/^\+[1-9]\d{6,14}$/.test(compact)) return `tel:${compact}`;
  if (/^0[1-9]\d{8}$/.test(compact)) return `tel:${compact}`;
  return null;
}
/**
 * The expected participant of THIS dossier (client / enterprise side: the participant whose id is the
 * dossier's exact artisan_id; artisan side: the one whose id is its exact client_id — never another)
 * and the recorded appointment, both from the already-authorised session.loadOperations(id), read
 * only when the block is opened. Keyed by the host on account + thread + assignment + status; late
 * replies are dropped (sequence + key). Nothing before assignment or for a cancelled dossier.
 */
function ConversationContact({ intervention, role, context, load }: { intervention: Intervention; role: Role; context: PhotoContext; load: (id: string) => Promise<Operations | null> }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ phase: "idle" | "loading" | "ready" | "error"; ops: Operations | null }>({ phase: "idle", ops: null });
  const seq = useRef(0);
  const mounted = useRef(true);
  const [me] = useState(() => ({ uid: context.userId(), gen: context.generation() }));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      seq.current++;
    };
  }, []);
  const eligible = Boolean(intervention.artisan_id) && intervention.status !== "cancelled" && intervention.status !== "requested";
  if (!eligible) return null;
  const read = () => {
    const my = ++seq.current;
    setState({ phase: "loading", ops: null });
    void load(intervention.id)
      .catch(() => null)
      .then((ops) => {
        if (!mounted.current || my !== seq.current || context.userId() !== me.uid || context.generation() !== me.gen) return; // late: dropped
        setState(ops ? { phase: "ready", ops } : { phase: "error", ops: null });
      });
  };
  const expectedId = role === "artisan" ? intervention.client_id : intervention.artisan_id;
  const ops = state.ops;
  const person = ops && expectedId ? ops.participants.find((p) => p.id === expectedId) ?? null : null;
  const appointment = ops?.appointment && ops.appointment.intervention_id === intervention.id ? ops.appointment : null;
  const tel = person ? telHref(person.phone) : null;
  return (
    <div className="conversation-contact" data-conversation-contact={open ? state.phase : "closed"}>
      <button type="button" className="button outline" aria-expanded={open} onClick={() => {
          const next = !open;
          setOpen(next);
          // P1 (E40): folding purges the contact; every opening re-reads it (rights may have changed).
          if (next) read();
          else { seq.current++; setState({ phase: "idle", ops: null }); }
        }} data-conversation-contact-toggle="">
        <Icon name="phone" size={16} />
        Contact et rendez-vous
      </button>
      {open && (
        <div aria-busy={state.phase === "loading" || undefined} style={{ marginTop: 8 }}>
          {state.phase === "loading" && <p className="form-note" role="status">Lecture du contact et du rendez-vous…</p>}
          {state.phase === "error" && (
            <div role="alert">
              <p className="form-note">Le contact et le rendez-vous n’ont pas pu être lus.</p>
              <button type="button" className="button outline" onClick={read} data-conversation-contact-retry="">Réessayer</button>
            </div>
          )}
          {state.phase === "ready" && (
            <dl className="conversation-contact-details">
              <dt>{role === "artisan" ? "Client du dossier" : "Artisan du dossier"}</dt>
              <dd data-conversation-contact-person={person ? person.id : ""}>
                {person ? person.full_name : "Coordonnées non transmises pour ce dossier."}
                {tel && (
                  <>
                    {" "}
                    <a className="button outline" href={tel} data-conversation-contact-call="">Appeler</a>
                  </>
                )}
              </dd>
              <dt>Rendez-vous enregistré</dt>
              <dd data-conversation-contact-appointment={appointment ? "" : "none"}>
                {appointment ? `${dateTime(appointment.starts_at)} – ${dateTime(appointment.ends_at)}${appointment.note ? ` · ${appointment.note}` : ""}` : "Aucun rendez-vous enregistré."}
              </dd>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Photo in a conversation (SYS-04 / M62) -------------------------------------------------
type PhotoContext = { generation(): number; userId(): string | null };
/** No identity: the read-state hook stays inactive. */
const NO_READ_CONTEXT: PhotoContext = { generation: () => 0, userId: () => null };
type PhotoPhase = "ready" | "uploading" | "upload_unknown" | "sending" | "send_retry" | "collision" | "refused" | "signed_out" | "unavailable" | "done";
/** One photo send of ONE identity + generation + dossier: the confirmed document and the frozen
 *  command are kept for an identical replay (same send id), in memory only. */
type PhotoDraft = { file: File | null; caption: string; sendId: string; documentId: string | null; command: PhotoCommand | null; phase: PhotoPhase; error: string };

/** E02: uploads in flight per draft store + key. A conversation switch unmounts the composer; the
 *  upload's outcome is still written to the (identity + dossier keyed) draft store, and a composer
 *  mounted again for the same key waits for it instead of staying stuck in « uploading ». */
const photoFlights = new WeakMap<Map<string, PhotoDraft>, Map<string, Promise<void>>>();
const flightsOf = (store: Map<string, PhotoDraft>) => {
  let m = photoFlights.get(store);
  if (!m) photoFlights.set(store, (m = new Map()));
  return m;
};

function PhotoCompose({ interventionId, context, fetchImpl, store, storeKey, onSent }: { interventionId: string; context: PhotoContext; fetchImpl: PhotoFetch; store: Map<string, PhotoDraft>; storeKey: string; onSent: (message: Message) => void }) {
  const [draft, setDraftState] = useState<PhotoDraft | null>(() => store.get(storeKey) ?? null);
  const [pickError, setPickError] = useState("");
  const draftRef = useRef(draft);
  const alive = useRef(false);
  const put = (next: PhotoDraft | null) => {
    draftRef.current = next;
    if (next && next.phase !== "done") store.set(storeKey, next);
    else store.delete(storeKey);
    if (alive.current) setDraftState(next);
  };
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    // E02: a draft left « uploading » by an unmounted composer: follow its flight, or — if none is
    // in flight any more — reread the store (its outcome was written there).
    const stored = store.get(storeKey) ?? null;
    if (stored?.phase === "uploading") {
      const flight = flightsOf(store).get(storeKey);
      const reread = () => {
        if (!alive.current) return;
        const now = store.get(storeKey) ?? null;
        draftRef.current = now;
        setDraftState(now?.phase === "uploading" ? { ...now, phase: "upload_unknown", error: PHOTO_COPY.uploadUnknown } : now);
      };
      if (flight) void flight.then(reread);
      else reread();
    }
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const pick = (file: File | undefined) => {
    if (!file) return;
    const invalid = validateUpload(file, PHOTO_TYPES);
    if (invalid) return setPickError(invalid);
    const sendId = newSendId();
    if (!sendId) return setPickError(PHOTO_COPY.noUuid);
    setPickError("");
    put({ file, caption: "", sendId, documentId: null, command: null, phase: "ready", error: "" });
  };
  const run = async () => {
    const d = draftRef.current;
    if (!d || inFlight.current) return;
    inFlight.current = true;
    // Identity + generation + dossier captured now, re-checked after every await.
    const uid = context.userId(), gen = context.generation();
    const same = () => alive.current && context.userId() === uid && context.generation() === gen;
    // E02: the store (keyed by identity + dossier) is updated as long as the IDENTITY is unchanged,
    // even if this composer was unmounted by a conversation switch.
    const sameIdentity = () => context.userId() === uid && context.generation() === gen;
    try {
      let documentId = d.documentId;
      if (!documentId) {
        if (!d.file) return;
        put({ ...d, phase: "uploading", error: "" });
        const flights = flightsOf(store);
        let settle!: () => void;
        flights.set(storeKey, new Promise<void>((r) => (settle = r)));
        let up: Awaited<ReturnType<typeof uploadPhoto>>;
        try {
          up = await uploadPhoto(d.file, interventionId, fetchImpl);
          if (!sameIdentity()) return; // another identity: nothing applied
          if (up.kind === "unknown") return put({ ...d, phase: "upload_unknown", error: up.message });
          if (up.kind === "failed") return put({ ...d, phase: "ready", error: up.message });
          documentId = up.documentId;
          // Receipt kept; when the composer is gone, stop here: the send is resumed explicitly on
          // the same dossier (no second upload, never on another thread).
          if (!same()) return put({ ...d, documentId, phase: "ready", error: "" });
        } finally {
          flights.delete(storeKey);
          settle();
        }
      }
      // The command is frozen once (stable id, confirmed document, caption): a replay is identical.
      const current = draftRef.current ?? d;
      const command: PhotoCommand = current.command ?? { id: current.sendId, intervention_id: interventionId, document_id: documentId, body: current.caption.trim().slice(0, PHOTO_CAPTION_MAX) };
      put({ ...current, documentId, command, phase: "sending", error: "" });
      const out = await sendPhotoMessage(fetchImpl, command);
      if (!same()) return;
      const after = draftRef.current ?? { ...current, documentId, command };
      if (out.kind === "ok") {
        onSent(out.message);
        return put({ ...after, phase: "done", error: "" });
      }
      if (out.kind === "retry") return put({ ...after, phase: "send_retry", error: PHOTO_COPY.sendRetry });
      if (out.kind === "collision") return put({ ...after, phase: "collision", error: PHOTO_COPY.collision });
      if (out.kind === "signed_out") return put({ ...after, phase: "signed_out", error: PHOTO_COPY.signedOut });
      if (out.kind === "unavailable") return put({ ...after, phase: "unavailable", error: PHOTO_COPY.unavailable });
      return put({ ...after, phase: "refused", error: out.message });
    } finally {
      inFlight.current = false;
    }
  };
  const busy = draft?.phase === "uploading" || draft?.phase === "sending";
  const frozen = Boolean(draft?.command);
  return (
    <div className="message-photo" data-message-photo={draft?.phase ?? "idle"}>
      {(!draft || draft.phase === "done") && (
        <>
          <label className="button outline">
            <Icon name="camera" />
            {PHOTO_COPY.attach}
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept={PHOTO_TYPES.join(",")}
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {draft?.phase === "done" && <p role="status" data-message-photo-done="">{PHOTO_COPY.done}</p>}
          {pickError && <p className="field-error" role="alert">{pickError}</p>}
        </>
      )}
      {draft && draft.phase !== "done" && (
        <div className="inline-note" role="group" aria-label="Photo à envoyer">
          <p>
            <strong>{draft.file?.name ?? "Photo"}</strong>
            {draft.documentId ? " · enregistrée" : ""}
          </p>
          <Field label={PHOTO_COPY.caption}>
            <textarea
              rows={2}
              maxLength={PHOTO_CAPTION_MAX}
              value={draft.command ? draft.command.body : draft.caption}
              disabled={frozen || busy}
              onChange={(e) => put({ ...draft, caption: e.target.value })}
            />
          </Field>
          {busy && <p role="status">{draft.phase === "uploading" ? PHOTO_COPY.uploading : PHOTO_COPY.sending}</p>}
          {draft.error && <p className="field-error" role="alert" data-message-photo-error={draft.phase}>{draft.error}</p>}
          <div className="form-actions">
            {draft.phase === "ready" && (
              <button type="button" className="button primary" onClick={() => void run()} disabled={busy}>
                {PHOTO_COPY.send}
              </button>
            )}
            {draft.phase === "upload_unknown" && (
              // Explicit action only: a new upload (the first one may exist).
              <button type="button" className="button primary" onClick={() => void run()}>
                {PHOTO_COPY.reupload}
              </button>
            )}
            {draft.phase === "send_retry" && (
              <button type="button" className="button primary" onClick={() => void run()}>
                {PHOTO_COPY.retrySend}
              </button>
            )}
            <button type="button" className="button outline" disabled={busy} onClick={() => put(null)}>
              {PHOTO_COPY.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Opens one photo on demand: a short-lived signed URL kept in memory while shown, never stored. */
function PhotoView({ messageId, context, fetchImpl }: { messageId: string; context: PhotoContext; fetchImpl: PhotoFetch }) {
  const [state, setState] = useState<{ phase: "idle" | "opening" | "open" | "error"; url: string; error: string }>({ phase: "idle", url: "", error: "" });
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const open = async () => {
    if (state.phase === "opening") return;
    const uid = context.userId(), gen = context.generation();
    setState({ phase: "opening", url: "", error: "" });
    const out = await openPhoto(fetchImpl, messageId);
    if (!alive.current || context.userId() !== uid || context.generation() !== gen) return;
    if (out.kind === "ok") return setState({ phase: "open", url: out.url, error: "" });
    setState({ phase: "error", url: "", error: out.kind === "gone" ? PHOTO_COPY.openGone : out.kind === "signed_out" ? PHOTO_COPY.signedOut : PHOTO_COPY.openFailed });
  };
  return (
    <div className="message-photo-view" data-message-photo-view={state.phase}>
      {state.phase === "open" ? (
        <>
          <img src={state.url} alt="Photo jointe au message" style={{ display: "block", maxWidth: "100%", height: "auto", borderRadius: 8 }} />
          <button type="button" className="text-button" onClick={() => setState({ phase: "idle", url: "", error: "" })}>
            {PHOTO_COPY.close}
          </button>
        </>
      ) : (
        <button type="button" className="text-button" onClick={() => void open()} disabled={state.phase === "opening"}>
          <Icon name="camera" size={16} />
          {state.phase === "opening" ? PHOTO_COPY.opening : PHOTO_COPY.open}
        </button>
      )}
      {state.phase === "error" && <p className="field-error" role="alert">{state.error}</p>}
    </div>
  );
}
export function SiteForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (values: {
    name: string;
    type: string;
    address: string;
    budget_cents: number;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState("syndic");
  const [budget, setBudget] = useState("");
  return (
    <section className="panel site-form">
      <div className="section-heading">
        <div>
          <h2>Ajouter un site</h2>
          <p>Un lieu et un budget de référence pour vos interventions.</p>
        </div>
        <button className="button outline" onClick={() => setOpen(!open)}>
          <Icon name={open ? "close" : "plus"} />
          {open ? "Fermer" : "Nouveau site"}
        </button>
      </div>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit({
              name,
              address,
              type,
              budget_cents: Math.round(Number(budget || 0) * 100),
            });
          }}
        >
          <div className="form-columns">
            <Field label="Nom du site">
              <input
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Type de site">
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="syndic">Syndic / copropriété</option>
                <option value="restaurant">Restauration</option>
                <option value="office">Bureaux</option>
                <option value="erp">ERP</option>
              </select>
            </Field>
          </div>
          <Field label="Adresse">
            <input
              required
              minLength={5}
              maxLength={250}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>
          <Field label="Budget de référence (€)">
            <input
              type="number"
              min="0"
              step="0.01"
              max="1000000"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </Field>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer le site"}
          </button>
        </form>
      )}
    </section>
  );
}
/** Structured account name (CLI-09 / PUB-07): 1–60 characters each, « Prénom Nom » ≤ 120. */
const NAME_PART_MAX = 60;
const FULL_NAME_MAX = 120;
function structuredNameError(first: string, last: string): string {
  const f = first.trim(), l = last.trim();
  if (!f || !l) return "Renseignez le prénom et le nom.";
  if (f.length > NAME_PART_MAX || l.length > NAME_PART_MAX) return `Prénom et nom : ${NAME_PART_MAX} caractères au plus chacun.`;
  if (`${f} ${l}`.length > FULL_NAME_MAX) return `Prénom et nom réunis : ${FULL_NAME_MAX} caractères au plus.`;
  return "";
}
const joinName = (first: string, last: string) => `${first.trim()} ${last.trim()}`.trim();
const initials = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("");

export function ProfileForm({
  name,
  phone,
  role,
  demo,
  busy,
  onSubmit,
  structuredName,
  email,
  phoneRequired = false,
}: {
  name: string;
  phone: string;
  role: Role;
  demo: boolean;
  busy: boolean;
  onSubmit: (values: { full_name: string; phone: string; first_name?: string; last_name?: string }) => Promise<void>;
  /** Opt-in (client profile): the stored first / last name. Both present ⇒ structured fields;
   *  otherwise the existing full name stays as is (never split) with an explicit action. */
  structuredName?: { first_name?: string | null; last_name?: string | null };
  /** Opt-in (client profile): the sign-in address, shown read-only (it is changed nowhere here). */
  email?: string;
  /** Opt-in (client profile): a +596, +590 or +33 number is required, as the server requires it. */
  phoneRequired?: boolean;
}) {
  const known = Boolean(structuredName?.first_name?.trim() && structuredName?.last_name?.trim());
  const [fullName, setFullName] = useState(name);
  const [number, setNumber] = useState(phone);
  // Structured fields: shown when both are known, or when the holder explicitly chooses to fill them.
  const [structured, setStructured] = useState(known);
  const [first, setFirst] = useState(known ? structuredName!.first_name!.trim() : "");
  const [last, setLast] = useState(known ? structuredName!.last_name!.trim() : "");
  const [edited, setEdited] = useState(false);
  const [nameError, setNameError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const shownName = structured && (edited || known) ? joinName(first, last) || name : fullName;
  return (
    <form
      className="panel profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        const phoneProblem = phoneRequired && !normalizeAccountPhone(number) ? ACCOUNT_PHONE_MESSAGE : "";
        setPhoneError(phoneProblem);
        if (phoneProblem) return;
        // Structured fields are sent only when filled or edited; a phone-only save sends neither.
        const filled = structured && (edited || (!known && (first.trim() || last.trim())));
        if (filled) {
          const error = structuredNameError(first, last);
          setNameError(error);
          if (error) return;
          void onSubmit({ full_name: joinName(first, last), phone: number, first_name: first.trim(), last_name: last.trim() });
          return;
        }
        setNameError("");
        void onSubmit({ full_name: structured && known ? name : fullName, phone: number });
      }}
    >
      <div className="profile-intro">
        <span className="avatar large-avatar">{initials(shownName)}</span>
        <div>
          <h2>{name}</h2>
          <p>
            {ROLE_NAMES[role]}
            {demo ? " — démonstration" : ""}
          </p>
        </div>
      </div>
      {structured ? (
        <>
          <Field label="Prénom" error={nameError || undefined}>
            <input
              required
              maxLength={NAME_PART_MAX}
              autoComplete="given-name"
              value={first}
              onChange={(e) => {
                setFirst(e.target.value);
                setEdited(true);
              }}
            />
          </Field>
          <Field label="Nom">
            <input
              required
              maxLength={NAME_PART_MAX}
              autoComplete="family-name"
              value={last}
              onChange={(e) => {
                setLast(e.target.value);
                setEdited(true);
              }}
            />
          </Field>
          {!known && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setStructured(false);
                setFirst("");
                setLast("");
                setEdited(false);
                setNameError("");
              }}
            >
              Garder le nom complet actuel
            </button>
          )}
        </>
      ) : (
        <>
          <Field label="Nom complet">
            <input
              required
              minLength={2}
              maxLength={100}
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </Field>
          {structuredName !== undefined && (
            <button type="button" className="text-button" onClick={() => setStructured(true)}>
              Renseigner prénom et nom
            </button>
          )}
        </>
      )}
      {email !== undefined && (
        <Field label="Adresse e-mail" hint="C’est l’adresse de connexion de votre compte.">
          <input type="email" value={email} readOnly autoComplete="email" data-profile-email="" />
        </Field>
      )}
      <Field
        label={phoneRequired ? "Téléphone" : "Téléphone (facultatif)"}
        hint={phoneRequired ? "Indicatif +596, +590 ou +33. Ex. 0696 12 34 56." : undefined}
        error={phoneError || undefined}
      >
        <input
          required={phoneRequired}
          type="tel"
          inputMode="tel"
          maxLength={30}
          autoComplete="tel"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder={phoneRequired ? undefined : "Votre numéro de téléphone"}
        />
      </Field>
      <p className="form-note">
        Votre rôle et l’approbation d’une candidature artisan ne peuvent pas
        être modifiés depuis ce formulaire.
      </p>
      <button className="button primary" disabled={busy} type="submit">
        {busy ? "Enregistrement…" : "Enregistrer les informations"}
      </button>
    </form>
  );
}
export function AuthForm({
  mode,
  onMode,
  busy,
  onSubmit,
  onDemo,
  initial,
  initialRole,
}: {
  mode: "login" | "signup" | "reset";
  onMode: (mode: "login" | "signup" | "reset") => void;
  busy: boolean;
  onSubmit: (values: {
    email: string;
    password: string;
    full_name: string;
    role: Role;
    /** Signup only: all three always sent there, with full_name = « Prénom Nom ». */
    first_name?: string;
    last_name?: string;
    phone?: string;
  }) => Promise<void>;
  onDemo: () => void;
  /** Prefill from the service booking flow (email, name and phone typed there); never a
   *  password, and a full name is never split into first / last name. */
  initial?: { email?: string; first_name?: string; last_name?: string; phone?: string };
  /** E65: profile preselected by the entry point (« Créer mon compte artisan »); default client. */
  initialRole?: Role;
}) {
  const [email, setEmail] = useState(initial?.email ?? "");
  const [password, setPassword] = useState("");
  const [first, setFirst] = useState(initial?.first_name?.trim().slice(0, NAME_PART_MAX) ?? "");
  const [last, setLast] = useState(initial?.last_name?.trim().slice(0, NAME_PART_MAX) ?? "");
  const [nameError, setNameError] = useState("");
  const [phone, setPhone] = useState(initial?.phone?.trim().slice(0, 30) ?? "");
  const [phoneError, setPhoneError] = useState("");
  const [role, setRole] = useState<Role>(initialRole ?? "client");
  return (
    <div className="auth-layout">
      <section className="auth-copy">
        <span className="auth-mark">
          <Icon name="bolt" size={52} />
        </span>
        <h1>
          Votre intervention,
          <br />
          en toute clarté.
        </h1>
        <p>
          Retrouvez vos demandes, vos devis et vos échanges dans un même espace.
        </p>
        <button className="text-button" onClick={onDemo}>
          Explorer sans créer de compte
          <Icon name="arrow" size={16} />
        </button>
      </section>
      <form
        className="panel auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "signup") {
            const error = structuredNameError(first, last);
            // Same rule as POST /api/auth/signup: +596, +590 or +33, stored in international form.
            const normalized = normalizeAccountPhone(phone);
            setNameError(error);
            setPhoneError(normalized ? "" : ACCOUNT_PHONE_MESSAGE);
            if (error || !normalized) return;
            void onSubmit({ email, password, role, full_name: joinName(first, last), first_name: first.trim(), last_name: last.trim(), phone: normalized });
            return;
          }
          // Login and reset keep their existing fields.
          void onSubmit({ email, password, full_name: "", role });
        }}
      >
        <h2>
          {mode === "login"
            ? "Connexion"
            : mode === "signup"
              ? "Créer un compte"
              : "Réinitialiser mon mot de passe"}
        </h2>
        <p>
          {mode === "login"
            ? "Ravi de vous retrouver."
            : mode === "signup"
              ? "Votre nom, votre adresse e-mail et votre téléphone sont nécessaires. Un lien envoyé par e-mail confirme le compte."
              : "Recevez un lien pour choisir un nouveau mot de passe."}
        </p>
        {mode === "signup" && (
          <>
            <Field label="Votre espace">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                <option value="client">Particulier</option>
                <option value="artisan">Artisan électricien</option>
                <option value="manager">Professionnel / syndic</option>
              </select>
            </Field>
            <Field label="Prénom" error={nameError || undefined}>
              <input
                required
                autoComplete="given-name"
                maxLength={NAME_PART_MAX}
                value={first}
                onChange={(e) => setFirst(e.target.value)}
              />
            </Field>
            <Field label="Nom">
              <input
                required
                autoComplete="family-name"
                maxLength={NAME_PART_MAX}
                value={last}
                onChange={(e) => setLast(e.target.value)}
              />
            </Field>
            {role === "artisan" && (
              <div className="inline-note">
                <Icon name="shield" />
                <p>
                  Votre candidature devra être approuvée avant que vous puissiez
                  accepter des missions.
                </p>
              </div>
            )}
          </>
        )}
        <Field label="Adresse e-mail">
          <input
            required
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {mode === "signup" && (
          <Field label="Téléphone" hint="Indicatif +596, +590 ou +33. Ex. 0696 12 34 56." error={phoneError || undefined}>
            <input
              required
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              maxLength={30}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              data-signup-phone=""
            />
          </Field>
        )}
        {mode !== "reset" && (
          <Field
            label="Mot de passe"
            hint={mode === "signup" ? "Au moins 10 caractères." : undefined}
          >
            <input
              required
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              minLength={mode === "signup" ? 10 : 1}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
        {mode === "login" && (
          <button
            type="button"
            className="forgot-link"
            onClick={() => onMode("reset")}
          >
            Mot de passe oublié ?
          </button>
        )}
        <button className="button primary full" type="submit" disabled={busy}>
          {busy
            ? "Veuillez patienter…"
            : mode === "login"
              ? "Se connecter"
              : mode === "signup"
                ? "Créer mon compte"
                : "Envoyer le lien"}
        </button>
        <p className="auth-switch">
          {mode === "login"
            ? "Pas encore de compte ?"
            : mode === "signup"
              ? "Déjà un compte ?"
              : "Vous vous souvenez du mot de passe ?"}{" "}
          <button
            type="button"
            onClick={() => onMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "Créer un compte" : "Se connecter"}
          </button>
        </p>
        <p className="form-note">
          Aucun paiement n’est demandé à l’inscription.
        </p>
      </form>
    </div>
  );
}

export function ReviewForm({
  existing,
  enabled,
  busy,
  onSubmit,
}: {
  existing?: Review;
  enabled: boolean;
  busy: boolean;
  onSubmit: (values: { rating: number; body: string }) => Promise<void>;
}) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  if (existing)
    return (
      <section className="panel review-panel">
        <h2>Votre avis</h2>
        <p className="review-stars" aria-label={`${existing.rating} sur 5`}>
          {"★".repeat(existing.rating)}
          {"☆".repeat(5 - existing.rating)}
        </p>
        <p>{existing.body || "Merci pour votre évaluation."}</p>
      </section>
    );
  if (!enabled) return null;
  return (
    <form
      className="panel review-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({ rating, body });
      }}
    >
      <h2>Comment s’est passée l’intervention ?</h2>
      <p>Votre retour porte sur cette intervention terminée et réglée.</p>
      <fieldset className="rating-options">
        <legend>Votre note sur cinq</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n}>
            <input
              type="radio"
              name="rating"
              value={n}
              checked={rating === n}
              onChange={() => setRating(n)}
            />
            <span>
              {n}
              <Icon name="star" size={15} />
            </span>
          </label>
        ))}
      </fieldset>
      <Field label="Votre commentaire (facultatif)">
        <textarea
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Ce qui vous a été utile, ce qui pourrait être amélioré…"
        />
      </Field>
      <button className="button primary" type="submit" disabled={busy}>
        Enregistrer mon avis
      </button>
    </form>
  );
}
// Paginated documents history (live only): newest page read on mount, older pages on explicit
// request. Keyed by identity + filter (the cursor scope); a change aborts the read in flight and
// starts empty, a late reply is ignored. 503 honours Retry-After before « Réessayer ». No cache.
const browserDocumentFetch: DocumentFetch = (url, init) => fetch(url, init);
function useDocumentHistory(live: boolean, profileId: string, filter: string, fetchImpl: DocumentFetch) {
  const key = documentHistoryKey(profileId, filter);
  const [state, setState] = useState<DocumentHistoryState>(() => initialDocumentHistory(key));
  const stateRef = useRef(state);
  const flight = useRef<AbortController | null>(null);
  const [, setTick] = useState(0);
  const update = useCallback((next: (s: DocumentHistoryState) => DocumentHistoryState) => {
    stateRef.current = next(stateRef.current);
    setState(stateRef.current);
  }, []);
  const load = useCallback(() => {
    const from = stateRef.current;
    if (!live || from.key !== key || from.status === "loading" || from.status === "not_found" || from.status === "signed_out") return;
    if (from.loaded && !from.hasMore) return;
    if (from.status === "error" && from.retryAt && Date.now() < from.retryAt) return; // Retry-After
    flight.current?.abort();
    const ctl = new AbortController();
    flight.current = ctl;
    update((s) => ({ ...s, status: "loading" }));
    void fetchDocumentPage(fetchImpl, filter, from.cursor, ctl.signal).then((outcome) => {
      if (flight.current !== ctl) return; // superseded by an identity/filter change
      flight.current = null;
      update((s) => applyDocumentOutcome(s, key, outcome, Date.now()));
    });
  }, [live, key, filter, fetchImpl, update]);
  useEffect(() => {
    flight.current?.abort();
    flight.current = null;
    update(() => initialDocumentHistory(key));
    if (live) load();
    return () => {
      flight.current?.abort();
      flight.current = null;
    };
  }, [key, live, load, update]);
  const current = state.key === key ? state : initialDocumentHistory(key);
  const waitMs = current.status === "error" && current.retryAt ? current.retryAt - Date.now() : 0;
  useEffect(() => {
    if (waitMs <= 0) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), waitMs + 20);
    return () => window.clearTimeout(t);
  }, [waitMs]);
  return { state: current, load, retryInS: waitMs > 0 ? Math.ceil(waitMs / 1000) : 0 };
}
export function DocumentManager({
  documents,
  interventions,
  demo,
  onRefresh,
  live = false,
  profileId = "",
  interventionId = "",
  fetchHistory = browserDocumentFetch,
  photoReview,
}: {
  documents: StoredDocument[];
  interventions: Intervention[];
  demo: boolean;
  onRefresh: () => Promise<void>;
  /** Live session: older documents are read from /api/documents/history. Default/demo: no call. */
  live?: boolean;
  /** Identity part of the history key (role spaces also remount on identity change). */
  profileId?: string;
  /** Optional dossier filter (cursor scope); "" = every document of the account. */
  interventionId?: string;
  /** Test seam for the history client. */
  fetchHistory?: DocumentFetch;
  /** Read-only photos of the exact dossier, guarded by the current live identity. */
  photoReview?: { userId(): string | null; generation(): number };
}) {
  const historyOn = live && !demo && (!photoReview || Boolean(interventionId));
  const history = useDocumentHistory(historyOn, profileId, interventionId, fetchHistory);
  const hs = history.state;
  const unavailable = historyOn && hs.status === "not_found";
  const scopedRows = unavailable ? [] : historyOn ? mergeDocuments(interventionId, documents, hs.pages) : documents;
  const rows = photoReview
    ? historyOn && !unavailable && hs.status !== "signed_out"
      ? hs.pages.filter((d) => d.intervention_id === interventionId && PHOTO_TYPES.includes(d.mime_type))
      : []
    : scopedRows;
  const firstLoad = historyOn && !hs.loaded && (hs.status === "idle" || hs.status === "loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const pendingPhoto = useRef<AbortController | null>(null);
  useEffect(() => () => pendingPhoto.current?.abort(), [interventionId, profileId]);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || demo) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (file.size > 4194304)
        throw new Error("Choisissez un document de moins de 4 Mo.");
      if (
        !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(
          file.type,
        )
      )
        throw new Error("Formats autorisés : PDF, JPEG, PNG et WebP.");
      const form = new FormData();
      form.append("file", file);
      if (selected) form.append("intervention_id", selected);
      const response = await fetch("/api/documents", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Le document n’a pas pu être enregistré.",
        );
      await onRefresh();
      setNotice("Document enregistré dans votre espace privé.");
      setFile(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openDocument(id: string) {
    if (pendingPhoto.current) return;
    const user = photoReview?.userId();
    const generation = photoReview?.generation();
    if (photoReview && (!user || user !== profileId)) return;
    const controller = photoReview ? new AbortController() : null;
    pendingPhoto.current = controller;
    const current = () => !photoReview || (!controller?.signal.aborted && user === photoReview.userId() && generation === photoReview.generation());
    setBusy(true);
    setError("");
    try {
      const result = await api<{ url: string }>(
        `/api/documents?id=${encodeURIComponent(id)}`,
        undefined,
        "GET",
        controller ? (path, init) => fetch(path, { ...init, signal: controller.signal }) : undefined,
      );
      if (!current()) return;
      if (typeof result.url !== "string" || !result.url.startsWith("https://"))
        throw new Error("Le lien de téléchargement est indisponible.");
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      if (pendingPhoto.current === controller) pendingPhoto.current = null;
      if (current()) setBusy(false);
    }
  }
  return (
    <section className="panel document-manager">
      <div className="section-heading">
        <h2>{photoReview ? "Photos du dossier" : "Pièces et justificatifs"}</h2>
        <Icon name="lock" />
      </div>
      {photoReview && !demo && <p className="form-note">Consultez les photos du dossier et échangez avec le client dans la conversation.</p>}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {historyOn && hs.status === "error" && (
        <div className="alert error" role="alert" data-document-history="error">
          <p>
            {hs.loaded
              ? "Les documents plus anciens n’ont pas pu être chargés. Les documents affichés restent valables."
              : "L’historique des documents n’a pas pu être chargé. Les documents affichés restent valables."}
          </p>
          <button type="button" className="button outline" disabled={history.retryInS > 0} onClick={history.load}>
            Réessayer{history.retryInS > 0 ? ` (${history.retryInS} s)` : ""}
          </button>
        </div>
      )}
      {historyOn && hs.status === "signed_out" && (
        <div className="alert error" role="alert" data-document-history="signed_out">
          Votre session a expiré. Reconnectez-vous pour retrouver vos documents.
        </div>
      )}
      {photoReview && demo ? null : unavailable ? (
        <p className="document-empty" data-document-history="not_found">
          Ces documents ne sont pas accessibles depuis votre compte.
        </p>
      ) : rows.length ? (
        <div className="document-list">
          {rows.map((d) => (
            <div key={d.id} data-document-id={d.id}>
              <Icon name="document" />
              <section>
                <h3>{d.name}</h3>
                <p>{date(d.created_at)}</p>
              </section>
              <button
                className="button outline"
                disabled={busy}
                aria-label={photoReview ? `Ouvrir la photo ${d.name}` : undefined}
                onClick={() => void openDocument(d.id)}
              >
                <Icon name="download" />
                {busy && photoReview ? "Ouverture…" : photoReview ? "Ouvrir la photo" : "Télécharger"}
              </button>
            </div>
          ))}
        </div>
      ) : firstLoad || (photoReview && ["signed_out", "error"].includes(hs.status)) ? null : (
        <p className="document-empty">{photoReview ? "Aucune photo dans les documents chargés." : "Aucune pièce jointe pour le moment."}</p>
      )}
      {historyOn && hs.status === "loading" && (
        <p role="status" data-document-history="loading">
          Chargement des documents…
        </p>
      )}
      {historyOn && offersOlderDocuments(hs) && (
        <button type="button" className="button outline" data-document-older disabled={!olderDocumentsUsable(hs, Date.now())} onClick={history.load}>
          Charger les documents plus anciens
        </button>
      )}
      {demo ? (
        <div className="inline-note">
          <Icon name="help" />
          <p>
            {photoReview ? "Les photos privées sont accessibles dans un dossier réel qui vous est attribué." : "Le dépôt de documents réels est désactivé dans la démonstration. Connectez-vous à un compte réel pour déposer une pièce dans le stockage privé."}
          </p>
        </div>
      ) : photoReview ? null : (
        <form onSubmit={upload}>
          <Field label="Dossier associé (facultatif)">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Justificatif personnel</option>
              {interventions.map((i) => (
                <option value={i.id} key={i.id}>
                  {shortId(i.id)} — {category(i.category).label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Document privé"
            hint="PDF, JPEG, PNG ou WebP, jusqu’à 4 Mo."
          >
            <input
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Field>
          <button
            className="button primary"
            type="submit"
            disabled={busy || !file}
          >
            <Icon name="plus" />
            {busy ? "Enregistrement…" : "Ajouter le document"}
          </button>
        </form>
      )}
    </section>
  );
}
// ---- Artisan applications (admin) ------------------------------------------------------------
// GET /api/admin/artisans → { artisans: [{ id, full_name, artisan_approved, created_at,
// application_status }], limit, truncated } (older servers / demo: no status, no limit). The status
// shown is the server's application_status only; when absent it says so, never inferred. Actions
// follow the status: approved ⇒ Suspendre, suspended ⇒ Réactiver, submitted ⇒ Approuver or
// Demander des corrections (E35); no approval for a draft, changes requested, unknown or missing
// status. Contract A (E34/E36): every decision POSTs { user_id, command_id, action, expected_version }
// after an explicit confirm — action approve | request_changes | suspend | reinstate (approval and
// reactivation are distinct), expected_version = application_version read, command_id stable for the
// same intention until it is confirmed.
export type ArtisanApplicationRow = {
  id: string;
  full_name: string;
  artisan_approved: boolean;
  created_at: string;
  application_status?: string | null;
  /** Dossier revision read (0 without dossier); the expected version of the next decision. */
  application_version?: number;
};
export type ArtisanDecision = "suspend" | "reactivate" | "approve" | "request_changes";
export const ARTISAN_STATUS_LABELS: Record<string, string> = {
  submitted: "Dossier soumis",
  approved: "Approuvé",
  suspended: "Suspendu",
  changes_requested: "Modifications demandées",
  draft: "Brouillon",
};
const DECISIONS: Record<ArtisanDecision, { label: string; message: string; confirmLabel: string; action: "approve" | "request_changes" | "suspend" | "reinstate"; approved: boolean }> = {
  suspend: {
    label: "Suspendre",
    message: "Suspendre l’accès aux nouvelles missions de cet artisan ?",
    confirmLabel: "Confirmer la suspension",
    action: "suspend",
    approved: false,
  },
  reactivate: {
    label: "Réactiver",
    message: "Réactiver cet artisan suspendu ? Il retrouvera l’accès aux nouvelles missions.",
    confirmLabel: "Confirmer la réactivation",
    action: "reinstate",
    approved: true,
  },
  approve: {
    label: "Approuver",
    message: "Confirmez-vous avoir vérifié la candidature et ses justificatifs ?",
    confirmLabel: "Confirmer l’approbation",
    action: "approve",
    approved: true,
  },
  request_changes: {
    label: "Demander des corrections",
    message: "Renvoyer la candidature à l’artisan pour corrections ? Il pourra la modifier puis la soumettre à nouveau.",
    confirmLabel: "Confirmer la demande de corrections",
    action: "request_changes",
    approved: false,
  },
};
/** Label, single allowed decision and honest note for one row (pure, exported for tests). */
export function artisanApplicationView(row: Pick<ArtisanApplicationRow, "artisan_approved" | "application_status">): {
  label: string;
  decision: ArtisanDecision | null;
  note: string | null;
  /** Second decision offered with the main one (submitted ⇒ request changes, E35). */
  secondary?: ArtisanDecision;
} {
  const status = row.application_status;
  if (status === undefined || status === null) {
    // Legacy shape: only the access flag is known. Open access can still be closed; nothing is approved.
    return {
      label: "Statut non disponible",
      decision: row.artisan_approved === true ? "suspend" : null,
      note: row.artisan_approved === true ? null : "Statut du dossier non transmis : aucune décision proposée.",
    };
  }
  const label = ARTISAN_STATUS_LABELS[status] ?? "Statut inconnu";
  if (status === "approved") return { label, decision: "suspend", note: null };
  if (status === "suspended") return { label, decision: "reactivate", note: null };
  if (status === "submitted") return { label, decision: "approve", note: null, secondary: "request_changes" };
  const note =
    status === "draft"
      ? "Dossier incomplet : en attente de l’artisan."
      : status === "changes_requested"
        ? "Modifications demandées : en attente de l’artisan."
        : "Statut inconnu : aucune décision proposée.";
  // Access still open on an unexpected status: closing it remains possible, approving does not.
  return { label, decision: row.artisan_approved === true ? "suspend" : null, note };
}
export const ARTISAN_LIST_INVALID = "Liste des artisans illisible : réponse du service invalide. Réessayez.";
/** Strict read of the GET reply (new or legacy shape). A missing / non-array `artisans` or ANY
 *  invalid row throws ARTISAN_LIST_INVALID: the list is never silently emptied or shortened. */
export function parseArtisanApplications(raw: unknown): { rows: ArtisanApplicationRow[]; truncated: boolean; limit: number | null } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(ARTISAN_LIST_INVALID);
  const v = raw as { artisans?: unknown; truncated?: unknown; limit?: unknown };
  if (!Array.isArray(v.artisans)) throw new Error(ARTISAN_LIST_INVALID);
  const rows: ArtisanApplicationRow[] = v.artisans.map((item) => {
    const r = item as Record<string, unknown> | null;
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error(ARTISAN_LIST_INVALID);
    const status = r.application_status;
    if (typeof r.id !== "string" || typeof r.full_name !== "string" || typeof r.artisan_approved !== "boolean" || typeof r.created_at !== "string")
      throw new Error(ARTISAN_LIST_INVALID);
    if (!(status === undefined || status === null || typeof status === "string")) throw new Error(ARTISAN_LIST_INVALID);
    const version = r.application_version;
    if (!(version === undefined || (typeof version === "number" && Number.isSafeInteger(version) && version >= 0))) throw new Error(ARTISAN_LIST_INVALID);
    return { id: r.id, full_name: r.full_name, artisan_approved: r.artisan_approved, created_at: r.created_at, application_status: typeof status === "string" ? status : null, ...(version === undefined ? {} : { application_version: version }) };
  });
  return { rows, truncated: v.truncated === true, limit: typeof v.limit === "number" && Number.isSafeInteger(v.limit) && v.limit > 0 ? v.limit : null };
}
const DEMO_ARTISANS: ArtisanApplicationRow[] = [
  { id: "demo-artisan", full_name: "Alex Martin", artisan_approved: true, created_at: "2026-10-30T09:00:00Z", application_status: "approved" },
  { id: "demo-artisan-2", full_name: "Sam Laurent", artisan_approved: false, created_at: "2026-10-30T10:00:00Z", application_status: "submitted" },
];
const DEMO_KEY = "courant-admin-demo-v1";

/** Stateless list (exported for SSR tests). */
export function ArtisanApplicationsList({
  rows,
  truncated,
  limit,
  busy,
  onDecide,
}: {
  rows: ArtisanApplicationRow[];
  truncated: boolean;
  limit: number | null;
  busy: boolean;
  onDecide(row: ArtisanApplicationRow, decision: ArtisanDecision): Promise<unknown>;
}) {
  if (!rows.length)
    return (
      <Empty icon="shield" title="Aucune candidature à vérifier">
        Les inscriptions artisans apparaîtront ici.
      </Empty>
    );
  return (
    <>
      {truncated && (
        <p className="inline-note" role="status" data-artisan-applications-truncated="">
          Affichage limité aux {limit ?? 100} premiers artisans.{" "}
          <a className="text-button" href="#admin-artisans">
            Ouvrir l’annuaire des artisans
          </a>
        </p>
      )}
      <div className="document-list">
        {rows.map((p) => {
          const view = artisanApplicationView(p);
          const decision = view.decision ? DECISIONS[view.decision] : null;
          return (
            <div key={p.id} data-artisan-application={p.id} data-application-status={p.application_status ?? "unknown"}>
              <span className="avatar">{p.full_name.slice(0, 2).toUpperCase()}</span>
              <section>
                <h3>{p.full_name}</h3>
                <p>
                  {view.label} — {date(p.created_at)}
                </p>
                {view.note && <p className="inline-note">{view.note}</p>}
              </section>
              {decision && view.decision && (
                <ConfirmAction
                  label={decision.label}
                  message={decision.message}
                  confirmLabel={decision.confirmLabel}
                  busy={busy}
                  onConfirm={() => onDecide(p, view.decision as ArtisanDecision)}
                />
              )}
              {view.secondary && (
                <ConfirmAction
                  label={DECISIONS[view.secondary].label}
                  message={DECISIONS[view.secondary].message}
                  confirmLabel={DECISIONS[view.secondary].confirmLabel}
                  busy={busy}
                  onConfirm={() => onDecide(p, view.secondary as ArtisanDecision)}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function ArtisanAdministration({ demo }: { demo: boolean }) {
  const [rows, setRows] = useState<ArtisanApplicationRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [limit, setLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      if (demo) {
        const stored = localStorage.getItem(DEMO_KEY);
        let parsed: unknown = null;
        try {
          parsed = stored ? JSON.parse(stored) : null;
        } catch {
          parsed = null;
        }
        const demoRows = parseArtisanApplications({ artisans: Array.isArray(parsed) ? parsed : DEMO_ARTISANS }).rows;
        setRows(demoRows);
        setTruncated(false);
        setLimit(null);
        return;
      }
      const result = parseArtisanApplications(await api<unknown>("/api/admin/artisans"));
      setRows(result.rows);
      setTruncated(result.truncated);
      setLimit(result.limit);
    } catch (e) {
      setRows([]);
      setTruncated(false);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** E36: one command id per intention (dossier + action + version read), kept until confirmed. */
  const intents = useRef(new Map<string, string>());
  async function decide(p: ArtisanApplicationRow, decision: ArtisanDecision) {
    const { approved, action } = DECISIONS[decision];
    setBusy(p.id);
    setError("");
    const expected_version = p.application_version ?? 0;
    const intent = `${p.id}|${action}|${expected_version}`;
    try {
      if (demo) {
        const status = action === "request_changes" ? "changes_requested" : approved ? "approved" : "suspended";
        const next = rows.map((row) => (row.id === p.id ? { ...row, artisan_approved: approved, application_status: status } : row));
        localStorage.setItem(DEMO_KEY, JSON.stringify(next));
        setRows(next);
      } else {
        let command_id = intents.current.get(intent);
        if (!command_id) {
          command_id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "";
          if (!command_id) throw new Error("Ce navigateur ne permet pas de créer un identifiant sécurisé : décision impossible ici.");
          intents.current.set(intent, command_id);
        }
        await api("/api/admin/artisans", { user_id: p.id, command_id, action, expected_version });
        intents.current.delete(intent);
        await load();
      }
    } catch (e) {
      const status = e instanceof ApiRequestError ? e.status : 0;
      const kind = classifyRefusal(status);
      // Definitive refusals end the intention; a lost reply keeps it for an exact replay (E36).
      if (kind !== "transient") intents.current.delete(intent);
      if (kind === "session") {
        setRows([]); // P1: 401 purges the protected list at once
        setError((e as Error).message);
        return;
      }
      const message = kind === "conflict" ? "Ce dossier a changé depuis son affichage : il a été relu, vérifiez son état avant de décider." : (e as Error).message;
      // 409 / 403 / 404 / uncertain reply: re-read the dossier before any new decision (E34, P1);
      // the refusal message stays visible over the re-read (load() clears its own error first).
      if (kind !== "invalid") await load();
      setError((prev) => prev || message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Candidatures artisans</h2>
        <button className="button outline" onClick={() => void load()} disabled={loading}>
          <Icon name="refresh" />
          Actualiser
        </button>
      </div>
      {error && (
        <div className="alert error" role="alert" data-artisan-applications-error="">
          <span>{error}</span>
          {!loading && !rows.length && (
            <button type="button" className="button outline" onClick={() => void load()}>
              Réessayer
            </button>
          )}
        </div>
      )}
      {loading ? (
        <div className="page-loader">
          <span className="spinner" />
          Chargement des candidatures…
        </div>
      ) : error && !rows.length ? null : (
        <ArtisanApplicationsList rows={rows} truncated={truncated} limit={limit} busy={Boolean(busy)} onDecide={decide} />
      )}
    </section>
  );
}

export function ProfessionalOperations({
  data,
  sites,
  organizations,
  quotes,
  demo,
  busy,
  onRefresh,
  onSave,
  canWriteOrganization = true,
  canWriteSite = () => true,
  readOnlyReason = null,
  contracts,
  initialTab = "approvals",
}: {
  data: ProfessionalData;
  sites: Site[];
  organizations: { id: string; name: string }[];
  quotes: Quote[];
  demo: boolean;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onSave: (values: Record<string, unknown>) => Promise<boolean | undefined>;
  /** Organisation-wide writes (contracts). Default true for callers without membership scopes. */
  canWriteOrganization?: boolean;
  /** Operational writes for a site (approval rules, compliance records, decisions). */
  canWriteSite?: (siteId: string) => boolean;
  /** Shown instead of a form when the member cannot write. */
  readOnlyReason?: string | null;
  /** ENT-13 live contracts: active organisation + identity fence. Absent (or no organisation) ⇒
   *  no live read and an honest « choisissez une organisation ». Ignored in demo. */
  contracts?: EnterpriseContractsContext;
  initialTab?: "approvals" | "contracts";
}) {
  const [tab, setTab] = useState<string>(initialTab);
  // ENT-13: bumped after each successful contract write ⇒ causal re-read (page 1 + open detail).
  const [contractsEpoch, setContractsEpoch] = useState(0);
  const liveContracts = !demo;
  const saveContract = async (values: Record<string, unknown>) => {
    const ok = await onSave(values);
    if (ok && liveContracts) setContractsEpoch((n) => n + 1);
    return ok;
  };
  // Live: the active organisation of the contracts context ONLY (no fallback); demo unchanged.
  const contractOrganizationId = liveContracts ? contracts?.organizationId || undefined : organizations[0]?.id;
  const [site, setSite] = useState("");
  const [threshold, setThreshold] = useState("200");
  const [requiredRole, setRequiredRole] = useState("manager");
  const [enabled, setEnabled] = useState(true);
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [terms, setTerms] = useState("");
  const [contractStatus, setContractStatus] = useState("draft");
  const [kind, setKind] = useState("maintenance");
  const [due, setDue] = useState("");
  const [recordStatus, setRecordStatus] = useState("pending");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  // Only sites the member may write on are offered in the forms.
  const writableSites = sites.filter((s) => canWriteSite(s.id));
  const selectedSite = site || writableSites[0]?.id || "";
  const readOnlyNote = (title: string) => (
    <Unavailable
      title={title}
      reason={readOnlyReason || "Vos droits ne permettent pas cette modification dans l’organisation active."}
      blocker="membership-authority"
    />
  );
  function siteField() {
    return (
      <Field label="Site concerné">
        <select
          required
          value={selectedSite}
          onChange={(e) => setSite(e.target.value)}
        >
          <option value="" disabled>
            Choisir un site
          </option>
          {writableSites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  async function report() {
    setError("");
    try {
      if (demo) {
        const rows = [
          ["Type", "Site", "Échéance", "Statut"],
          ...data.compliance_records.map((r) => [
            r.kind,
            sites.find((s) => s.id === r.site_id)?.name || "",
            r.due_on,
            r.status,
          ]),
        ];
        download(
          "suivi-demo.csv",
          "\uFEFF" +
            rows
              .map((row) =>
                row
                  .map(
                    (v) =>
                      `"${v.replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`,
                  )
                  .join(";"),
              )
              .join("\r\n"),
          "text/csv;charset=utf-8",
        );
        return;
      }
      const response = await fetch("/api/reports?format=csv", {
        cache: "no-store",
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Le rapport n’est pas disponible.");
      }
      download(
        "rapport.csv",
        await response.text(),
        "text/csv;charset=utf-8",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel professional-operations">
      <div className="section-heading">
        <div>
          <h2>Pilotage professionnel</h2>
          <p>Approbations, contrats et échéances de vos sites.</p>
        </div>
        <button className="button outline" onClick={() => void report()}>
          <Icon name="download" />
          Rapport
        </button>
      </div>
      <div
        className="tabs operations-tabs"
        role="group"
        aria-label="Pilotage professionnel"
      >
        {[
          ["approvals", "Approbations"],
          ["contracts", "Contrats cadres"],
          ["compliance", "Audits et maintenance"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
        {!demo && (
          <button
            className="refresh-operations"
            aria-label="Actualiser le pilotage professionnel"
            onClick={() => void onRefresh()}
          >
            <Icon name="refresh" size={17} />
          </button>
        )}
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {tab === "approvals" ? (
        <div className="operations-grid">
          <div>
            <h3>Décisions en attente</h3>
            {data.approvals.length ? (
              <div className="approval-list">
                {data.approvals.map((a) => {
                  const q = quotes.find((q) => q.id === a.quote_id);
                  return (
                    <div key={a.id}>
                      <section>
                        <strong>
                          {q ? money(q.total_cents) : "Devis à approuver"}
                        </strong>
                        <p>
                          {a.site_id
                            ? sites.find((s) => s.id === a.site_id)?.name
                            : "Site de l’intervention"}
                        </p>
                        <span
                          className={`badge ${a.status === "approved" ? "status-paid" : a.status === "rejected" ? "status-cancelled" : "status-quoted"}`}
                        >
                          {a.status === "approved"
                            ? "Approuvé"
                            : a.status === "rejected"
                              ? "Refusé"
                              : "En attente"}
                        </span>
                        {a.note && <p>{a.note}</p>}
                      </section>
                      {a.status === "pending" && canWriteSite(a.site_id || "") && (
                        <ApprovalDecision
                          busy={busy}
                          onDecision={(decision, note) =>
                            onSave({
                              action: "decide_approval",
                              approval_id: a.id,
                              decision,
                              note,
                            })
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="operation-empty">
                <Icon name="check" />
                <p>Aucun devis ne nécessite d’approbation pour le moment.</p>
              </div>
            )}
            <h3>Règles enregistrées</h3>
            {data.approval_rules.map((r) => (
              <div className="rule-row" key={r.site_id}>
                <Icon name="shield" />
                <span>
                  <strong>
                    {sites.find((s) => s.id === r.site_id)?.name || "Site"}
                  </strong>
                  <small>
                    Au-delà de {money(r.threshold_cents)} —{" "}
                    {r.required_role === "owner"
                      ? "propriétaire"
                      : "gestionnaire"}{" "}
                    — {r.enabled ? "active" : "désactivée"}
                  </small>
                </span>
              </div>
            ))}
          </div>
          {!writableSites.length ? (
            <div className="operations-form">{readOnlyNote("Configurer une approbation")}</div>
          ) : (
          <form
            className="operations-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedSite) return;
              void onSave({
                action: "set_approval_rule",
                site_id: selectedSite,
                threshold_cents: Math.round(Number(threshold) * 100),
                required_role: requiredRole,
                enabled,
              });
            }}
          >
            <h3>Configurer une approbation</h3>
            <p>
              Les nouveaux devis dépassant le seuil nécessiteront une décision
              avant acceptation.
            </p>
            {siteField()}
            <Field label="Seuil de validation TTC (€)">
              <input
                required
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </Field>
            <Field label="Responsable de validation">
              <select
                value={requiredRole}
                onChange={(e) => setRequiredRole(e.target.value)}
              >
                <option value="manager">Gestionnaire de l’organisation</option>
                <option value="owner">Propriétaire de l’organisation</option>
              </select>
            </Field>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Règle active
            </label>
            <button
              className="button primary full"
              type="submit"
              disabled={busy || !selectedSite}
            >
              Enregistrer la règle
            </button>
          </form>
          )}
        </div>
      ) : tab === "contracts" ? (
        <div className="operations-grid">
          <div>
            <h3>Contrats de l’organisation</h3>
            {liveContracts ? (
              <EnterpriseContractsPanel
                context={contracts?.context ?? NO_CONTRACTS_CONTEXT}
                organizationId={contracts?.organizationId ?? null}
                epoch={contractsEpoch}
                canWrite={canWriteOrganization}
                busy={busy}
                onSave={saveContract}
                fetcher={contracts?.fetcher}
              />
            ) : data.contracts.length ? (
              <div className="contract-list">
                {data.contracts.map((c) => (
                  <details key={c.id}>
                    <summary>
                      <span>
                        <strong>{c.title}</strong>
                        <small>
                          Réf. {c.reference} —{" "}
                          {c.status === "active"
                            ? "Actif"
                            : c.status === "archived"
                              ? "Archivé"
                              : "Brouillon"}
                        </small>
                      </span>
                      <Icon name="arrow" size={17} />
                    </summary>
                    <p>
                      Du {date(c.starts_on)}
                      {c.ends_on ? ` au ${date(c.ends_on)}` : ""}
                    </p>
                    <p>{c.terms}</p>
                    {canWriteOrganization && (
                    <button
                      className="button outline"
                      disabled={busy}
                      onClick={() =>
                        void onSave({
                          action: "save_contract",
                          id: c.id,
                          organization_id: c.organization_id,
                          title: c.title,
                          reference: c.reference,
                          starts_on: c.starts_on,
                          ends_on: c.ends_on || undefined,
                          terms: c.terms,
                          status:
                            c.status === "archived" ? "active" : "archived",
                        })
                      }
                    >
                      {c.status === "archived" ? "Réactiver" : "Archiver"}
                    </button>
                    )}
                  </details>
                ))}
              </div>
            ) : (
              <div className="operation-empty">
                <Icon name="document" />
                <p>Aucun contrat cadre enregistré.</p>
              </div>
            )}
          </div>
          {!canWriteOrganization ? (
            <div className="operations-form">{readOnlyNote("Enregistrer un contrat cadre")}</div>
          ) : (
          <form
            className="operations-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!contractOrganizationId) return;
              void saveContract({
                action: "save_contract",
                organization_id: contractOrganizationId,
                title,
                reference,
                starts_on: starts,
                ends_on: ends || undefined,
                terms,
                status: contractStatus,
              });
            }}
          >
            <h3>Enregistrer un contrat cadre</h3>
            <p>
              Archivage d’un accord existant. Ce formulaire ne constitue pas une
              signature électronique.
            </p>
            <Field label="Intitulé">
              <input
                required
                minLength={2}
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Référence">
              <input
                required
                minLength={2}
                maxLength={100}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
            <div className="form-columns">
              <Field label="Début">
                <input
                  required
                  type="date"
                  value={starts}
                  onChange={(e) => setStarts(e.target.value)}
                />
              </Field>
              <Field label="Fin (facultative)">
                <input
                  type="date"
                  min={starts || undefined}
                  value={ends}
                  onChange={(e) => setEnds(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Conditions et grille tarifaire">
              <textarea
                required
                minLength={5}
                maxLength={8000}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="Périmètre, prestations, conditions et tarifs convenus…"
              />
            </Field>
            <Field label="État du document">
              <select
                value={contractStatus}
                onChange={(e) => setContractStatus(e.target.value)}
              >
                <option value="draft">Brouillon</option>
                <option value="active">Actif</option>
                <option value="archived">Archivé</option>
              </select>
            </Field>
            {liveContracts ? (
              !contractOrganizationId && <p className="form-note" data-contract-create-choose="">Choisissez une organisation pour enregistrer un contrat cadre.</p>
            ) : (
              !organizations.length && (
              <p className="form-note">
                Ajoutez un premier site pour créer votre organisation.
              </p>
              )
            )}
            <button
              className="button primary full"
              type="submit"
              disabled={busy || (liveContracts ? !contractOrganizationId : !organizations.length)}
            >
              Enregistrer le contrat
            </button>
          </form>
          )}
        </div>
      ) : (
        <div className="operations-grid">
          <div>
            <h3>Échéances et signalements</h3>
            {data.compliance_records.length ? (
              <div className="compliance-list">
                {data.compliance_records.map((r) => (
                  <div key={r.id}>
                    <span className="record-icon">
                      <Icon
                        name={
                          r.kind === "safety"
                            ? "warning"
                            : r.kind === "audit"
                              ? "shield"
                              : "wrench"
                        }
                      />
                    </span>
                    <section>
                      <strong>{r.title}</strong>
                      <p>
                        {sites.find((s) => s.id === r.site_id)?.name || "Site"}{" "}
                        — {date(r.due_on)}
                      </p>
                      <span
                        className={`badge ${r.status === "completed" ? "status-paid" : "status-quoted"}`}
                      >
                        {r.status === "completed"
                          ? "Terminé"
                          : r.status === "scheduled"
                            ? "Planifié"
                            : "À traiter"}
                      </span>
                      {r.notes && <p>{r.notes}</p>}
                      {r.status !== "completed" && canWriteSite(r.site_id) && (
                        <button
                          className="button outline"
                          disabled={busy}
                          onClick={() =>
                            void onSave({
                              action: "save_compliance",
                              id: r.id,
                              site_id: r.site_id,
                              title: r.title,
                              kind: r.kind,
                              due_on: r.due_on,
                              status: "completed",
                              notes: r.notes,
                            })
                          }
                        >
                          Marquer terminé
                        </button>
                      )}
                    </section>
                  </div>
                ))}
              </div>
            ) : (
              <div className="operation-empty">
                <Icon name="calendar" />
                <p>Aucune échéance de maintenance ou d’audit enregistrée.</p>
              </div>
            )}
            <div className="inline-note">
              <Icon name="shield" />
              <p>
                Ces enregistrements organisent le suivi. Ils ne certifient pas
                la conformité d’une installation ou d’un ERP.
              </p>
            </div>
          </div>
          {!writableSites.length ? (
            <div className="operations-form">{readOnlyNote("Ajouter une échéance")}</div>
          ) : (
          <form
            className="operations-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedSite) return;
              void onSave({
                action: "save_compliance",
                site_id: selectedSite,
                title,
                kind,
                due_on: due,
                status: recordStatus,
                notes,
              });
            }}
          >
            <h3>Ajouter une échéance</h3>
            <p>
              Audit électrique, maintenance préventive ou signalement de
              sécurité.
            </p>
            {siteField()}
            <Field label="Intitulé">
              <input
                required
                minLength={2}
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Type de suivi">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="maintenance">Maintenance préventive</option>
                <option value="audit">Audit électrique</option>
                <option value="safety">Signalement de sécurité</option>
              </select>
            </Field>
            <Field label="Échéance">
              <input
                required
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </Field>
            <Field label="État">
              <select
                value={recordStatus}
                onChange={(e) => setRecordStatus(e.target.value)}
              >
                <option value="pending">À traiter</option>
                <option value="scheduled">Planifié</option>
                <option value="completed">Terminé</option>
              </select>
            </Field>
            <Field label="Notes et équipements concernés">
              <textarea
                maxLength={4000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Par exemple : armoire froide, circuit de cuisine, éclairage de sécurité…"
              />
            </Field>
            <button
              className="button primary full"
              type="submit"
              disabled={busy || !selectedSite}
            >
              Enregistrer l’échéance
            </button>
          </form>
          )}
        </div>
      )}
    </section>
  );
}

// Callers without an identity fence (none in the app today) keep a stable placeholder identity.
const WARRANTY_ANON = { generation: () => 0, userId: () => "anonymous" };

type WarrantyPanelProps = {
  interventionId?: string;
  demo: boolean;
  role: Role;
  /** ADM-10/PUB-06: identity fence of the live history (uid + generation). */
  context?: { generation(): number; userId(): string | null };
  /** Requester (client_id) of the dossier: only that account is offered the real claim form. */
  ownerId?: string | null;
  /** Tests only. */
  fetcher?: typeof fetch;
};
/**
 * Every draft, notice, error and in-flight mutation belongs to ONE identity + generation + dossier:
 * a scope change remounts the panel, so nothing typed or replied for dossier A ever shows on B.
 */
export function WarrantyPanel(props: WarrantyPanelProps) {
  const ctx = props.context ?? WARRANTY_ANON;
  return <WarrantyPanelBody key={`${ctx.userId() ?? "-"}|${ctx.generation()}|${props.interventionId ?? "*"}`} {...props} />;
}
function WarrantyPanelBody({ interventionId, demo, role, context, ownerId, fetcher }: WarrantyPanelProps) {
  // Live: paged GET /api/warranty (intervention_id filter, next_cursor, has_active proof).
  const history = useWarrantyHistory(context ?? WARRANTY_ANON, interventionId ?? null, !demo, fetcher);
  const hs = history.state;
  const [cases, setCases] = useState<WarrantyCase[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** E29: a decision refused on a stale version keeps its draft here, across the re-read. */
  const [conflicts, setConflicts] = useState<Record<string, { status: string; note: string }>>({});
  async function load() {
    if (!demo) return; // live reads go through useWarrantyHistory only
    setLoading(true);
    try {
      setCases(
        JSON.parse(localStorage.getItem("courant-warranty-demo-v1") || "[]"),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [demo, interventionId]);
  const visible: WarrantyCase[] = demo
    ? cases.filter((c) => !interventionId || c.intervention_id === interventionId)
    : hs.cases;
  const listLoading = demo ? loading : hs.phase === "loading";
  const claimRole = ["client", "manager"].includes(role);
  // The request RPC requires client_id = auth.uid: never offer the real form to another member.
  const me = (context ?? WARRANTY_ANON).userId();
  const isOwner = Boolean(ownerId && me && ownerId.toLowerCase() === me.toLowerCase());
  // Real form ONLY on server proof (enabled + has_active === false for THIS dossier); demo unchanged.
  const showClaim = demo
    ? Boolean(interventionId) && claimRole && !visible.some((c) => ["submitted", "reviewing"].includes(c.status))
    : claimRole && isOwner && claimAllowed(hs, interventionId);
  async function save(values: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (demo) {
        const next =
          values.action === "request"
            ? [
                ...cases,
                {
                  id: uid(),
                  intervention_id: interventionId!,
                  description,
                  status: "submitted" as const,
                  created_at: new Date().toISOString(),
                },
              ]
            : cases.map((c) =>
                c.id === values.case_id
                  ? {
                      ...c,
                      status: values.status as WarrantyCase["status"],
                      resolution: String(values.resolution),
                    }
                  : c,
              );
        localStorage.setItem("courant-warranty-demo-v1", JSON.stringify(next));
        setCases(next);
        setNotice(
          "Suivi enregistré dans la démonstration. Aucune demande réelle n’est transmise.",
        );
      } else {
        await api("/api/warranty", values);
        history.reload(); // causal re-read: page 1 + fresh has_active proof
        setNotice("Votre dossier a été enregistré.");
        if (values.action === "resolve") {
          const id = String(values.case_id);
          setConflicts(({ [id]: _done, ...rest }) => rest);
        }
      }
      setDescription("");
    } catch (e) {
      if (!demo && values.action === "resolve" && e instanceof ApiRequestError && e.status === 409) {
        // Stale decision: re-read the case, keep the draft, flag the conflict; never resent alone.
        setConflicts((m) => ({ ...m, [String(values.case_id)]: { status: String(values.status), note: String(values.resolution) } }));
        setError(WARRANTY_CONFLICT);
        history.reload();
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel warranty-panel">
      <div className="section-heading">
        <h2>Suivi après intervention</h2>
        <Icon name="shield" />
      </div>
      <p className="warranty-intro">
        Le projet prévoit une garantie d’un an. Le dépôt réel des demandes
        nécessite l’activation des conditions commerciales par l’exploitant.
        Aucun droit contractuel n’est attesté par cette démonstration.
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {!demo && hs.notice && (
        <div className="alert" role="status" data-warranty-notice="">
          {hs.notice}
        </div>
      )}
      {!demo && history.signedOut ? (
        <p className="document-empty" role="alert" data-warranty-history="refused">
          {WARRANTY_COPY.session}
        </p>
      ) : !demo && hs.phase === "refused" ? (
        <p className="document-empty" role="alert" data-warranty-history="refused">
          {hs.error}
        </p>
      ) : !demo && hs.phase === "error" ? (
        <div className="alert error" role="alert" data-warranty-history="error">
          {hs.error}{" "}
          <button type="button" className="button outline" onClick={history.reload}>
            Réessayer
          </button>
        </div>
      ) : listLoading ? (
        <p className="document-empty" data-warranty-history="loading">Chargement du suivi…</p>
      ) : visible.length ? (
        <div className="warranty-list" data-warranty-history="ready">
          {visible.map((c) => (
            <div key={c.id} data-warranty-case={c.id}>
              <div>
                <span
                  className={`badge ${c.status === "resolved" ? "status-paid" : c.status === "declined" ? "status-cancelled" : "status-quoted"}`}
                >
                  {
                    {
                      submitted: "Demande enregistrée",
                      reviewing: "En cours d’examen",
                      resolved: "Résolue",
                      declined: "Refusée",
                    }[c.status]
                  }
                </span>
                <small>{date(c.created_at)}</small>
              </div>
              <p>{c.description}</p>
              {/* PUB-06: recorded terms version, read on demand; keyed on identity + dossier + case + version. */}
              {!demo && (
                <RecordedTerms
                  key={`${(context ?? WARRANTY_ANON).userId() ?? "-"}|${(context ?? WARRANTY_ANON).generation()}|${interventionId ?? "*"}|${c.id}|${c.terms_version ?? "none"}`}
                  version={c.terms_version}
                  fetcher={fetcher}
                />
              )}
              {c.resolution && (
                <p>
                  <strong>Réponse : </strong>
                  {c.resolution}
                </p>
              )}
              {role === "admin" &&
                (["submitted", "reviewing"].includes(c.status) || Boolean(conflicts[c.id])) && (
                  <WarrantyResolution
                    busy={busy}
                    initialNote={conflicts[c.id]?.note ?? (c.resolution || "")}
                    initialStatus={conflicts[c.id]?.status}
                    conflict={conflicts[c.id] ? WARRANTY_CONFLICT : undefined}
                    onSave={(status, resolution) =>
                      save({
                        action: "resolve",
                        case_id: c.id,
                        ...(demo ? {} : { expected_version: c.updated_at }),
                        status,
                        resolution,
                      })
                    }
                  />
                )}
            </div>
          ))}
        </div>
      ) : (
        <p className="document-empty" data-warranty-history={demo ? undefined : "empty"}>Aucune demande de suivi enregistrée.</p>
      )}
      {!demo && hs.phase === "ready" && hs.moreError && (
        <p className="field-error" role="alert">{hs.moreError}</p>
      )}
      {!demo && hs.phase === "ready" && hs.next && (
        <button type="button" className="button outline" disabled={hs.loadingMore} onClick={history.more} data-warranty-more="">
          {hs.loadingMore ? "Chargement…" : WARRANTY_COPY.more}
        </button>
      )}
      {!demo && interventionId && claimRole && hs.phase === "ready" && !showClaim && (
        <p className="document-empty" data-warranty-claim-blocked={!isOwner ? "not-owner" : hs.hasActive ? "active" : "disabled"}>
          {!isOwner
            ? "Seul le demandeur du dossier peut ouvrir une demande de suivi. L’historique reste consultable."
            : hs.hasActive
              ? WARRANTY_COPY.active
              : WARRANTY_COPY.disabled}
        </p>
      )}
      {showClaim && interventionId && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save({
                action: "request",
                intervention_id: interventionId,
                description,
              });
            }}
          >
            <Field
              label="Signaler un problème après intervention"
              hint="Décrivez le problème et son lien avec l’intervention terminée."
            >
              <textarea
                required
                minLength={10}
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </Field>
            <button
              className="button outline full"
              type="submit"
              disabled={busy}
            >
              {busy
                ? "Enregistrement…"
                : demo
                  ? "Enregistrer un signalement de démonstration"
                  : "Déposer une demande de suivi"}
            </button>
          </form>
        )}
    </section>
  );
}

export function BudgetEditor({
  budgetCents,
  busy,
  onSave,
}: {
  budgetCents: number;
  busy: boolean;
  onSave: (cents: number) => Promise<boolean | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(budgetCents / 100));
  const [error, setError] = useState("");
  return (
    <div className="budget-editor">
      {!open ? (
        <button
          type="button"
          className="text-button budget-edit"
          disabled={busy}
          onClick={() => {
            setAmount(String(budgetCents / 100));
            setError("");
            setOpen(true);
          }}
        >
          Modifier le budget
        </button>
      ) : (
        <form
          className="inline-editor"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = Math.round(Number(amount.replace(",", ".")) * 100);
            if (
              !amount.trim() ||
              !Number.isSafeInteger(cents) ||
              cents < 0 ||
              cents > 100000000
            ) {
              setError("Renseignez un budget compris entre 0 et 1 000 000 €.");
              return;
            }
            setError("");
            void onSave(cents).then((saved) => {
              if (saved) setOpen(false);
            });
          }}
        >
          <Field label="Budget de référence du site (€)">
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              maxLength={15}
            />
          </Field>
          {error && (
            <p className="inline-validation" role="alert">
              {error}
            </p>
          )}
          <div className="inline-editor-actions">
            <button type="submit" className="button primary" disabled={busy}>
              Enregistrer le budget
            </button>
            <button
              type="button"
              className="button outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Annuler
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
export function ApprovalDecision({
  busy,
  onDecision,
}: {
  busy: boolean;
  onDecision: (
    decision: "approved" | "rejected",
    note: string,
  ) => Promise<boolean | undefined>;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="approval-decision">
      <Field label="Note de décision (obligatoire en cas de refus)">
        <textarea
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Votre note de validation ou le motif du refus…"
        />
      </Field>
      {error && (
        <p className="inline-validation" role="alert">
          {error}
        </p>
      )}
      <div className="approval-actions">
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => {
            setError("");
            void onDecision("approved", note.trim());
          }}
        >
          Approuver
        </button>
        <button
          type="button"
          className="button outline"
          disabled={busy}
          onClick={() => {
            if (!note.trim()) {
              setError(
                "Renseignez le motif du refus avant de confirmer votre décision.",
              );
              return;
            }
            setError("");
            void onDecision("rejected", note.trim());
          }}
        >
          Refuser
        </button>
      </div>
    </div>
  );
}
export const WARRANTY_CONFLICT =
  "Cette demande a été modifiée entre-temps : son état actuel est affiché. Votre brouillon est conservé ; vérifiez-le avant d’enregistrer à nouveau.";
export function WarrantyResolution({
  busy,
  initialNote,
  initialStatus,
  conflict,
  onSave,
}: {
  busy: boolean;
  initialNote: string;
  initialStatus?: string;
  /** E29: the last decision was refused on a stale version; the draft is the one kept. */
  conflict?: string;
  onSave: (status: string, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(initialNote);
  const [status, setStatus] = useState(initialStatus ?? "reviewing");
  return (
    <form
      className="warranty-resolution inline-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(status, note.trim());
      }}
    >
      {conflict && (
        <p className="field-error" role="alert" data-warranty-conflict="">
          {conflict}
        </p>
      )}
      <Field label="État du traitement">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="reviewing">En cours d’examen</option>
          <option value="resolved">Résolue</option>
          <option value="declined">Refusée</option>
        </select>
      </Field>
      <Field
        label="Note de traitement"
        hint="Au moins 10 caractères. Cette note sera visible dans le dossier."
      >
        <textarea
          required
          minLength={10}
          maxLength={4000}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <button
        type="submit"
        className="button primary"
        disabled={busy || note.trim().length < 10}
      >
        Enregistrer la décision
      </button>
    </form>
  );
}

