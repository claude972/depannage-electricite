"use client";
// Service booking wizard (FASTSPLIT-SERVICE-BOOKING-FLOW-001), opened in place on a service page.
// Five steps: urgency (or a wished slot: a wish, never a booked appointment), private contact
// details, intervention address, payment choice (on site, or a card authorisation that is NOT a
// charge), summary. Nothing is sent here: the last step stores the canonical public request draft +
// the booking extras (components/app/booking-draft.ts, payment included) in this tab, then the
// phone is verified inline (PhoneAccess, no account required); the request is sent only after that
// and an explicit confirmation. Contact details never enter the request description. The category
// comes from the service: never re-asked.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AddressField, createAddressApi, type AddressValue } from "../app/address-field";
import { BOOKING_DRAFT_KEY, CIVILITIES, PAYMENT_LABEL, SLOTS, SLOT_LABEL, bookingDescription, contactErrors, newRequestId, parseBooking, readBooking, saveBooking, type BookingContact, type BookingDraft, type Civility, type PaymentChoice, type Slot } from "../app/booking-draft";
import { PhoneAccess, phoneActionLabel, type PhoneApi, type PhoneState } from "./phone-access";
import { getDraftStorage } from "../app/request-draft-boot";
import { PUBLIC_DRAFT_KEY, parsePublicDraftValues, readPublicDraft, savePublicDraft } from "../../lib/shared/request-draft";
import { Field } from "../app/ui";
import type { ServiceEntry } from "./public-service-catalog";
import styles from "./public-booking.module.css";

// ---- State and pure rules ------------------------------------------------------------------------
export type BookingStep = 1 | 2 | 3 | 4 | 5;
export const LAST_STEP: BookingStep = 5;
export type BookingState = {
  step: BookingStep;
  urgent: boolean | null;
  slot: Slot | null;
  notes: string;
  contact: BookingContact;
  address: AddressValue;
  payment: PaymentChoice | null;
};
export const EMPTY_BOOKING: BookingState = {
  step: 1,
  urgent: null,
  slot: null,
  notes: "",
  contact: { civility: "", first_name: "", last_name: "", email: "", phone: "", company: false },
  address: { address: "", postal_code: "", city: "" },
  payment: null,
};
export const STEP_TITLES: Record<BookingStep, string> = { 1: "Urgence", 2: "Vos coordonnées", 3: "Adresse d’intervention", 4: "Paiement", 5: "Récapitulatif" };
export const STEP_ACTION: Record<BookingStep, string> = { 1: "Continuer", 2: "Continuer", 3: "Continuer", 4: "Continuer", 5: "Vérifier mon téléphone" };
/** Payment copy: honest, no « payé », no guarantee. */
export const PAYMENT_COPY: Record<PaymentChoice, { title: string; text: string }> = {
  on_site: { title: "Règlement sur place", text: "Vous réglez l’artisan après l’intervention. La demande reste non payée jusque-là." },
  card_hold: { title: "Empreinte bancaire", text: "Une autorisation sur votre carte, sans débit à la réservation. Seul le montant du devis accepté pourra être prélevé ensuite." },
};
export const CARD_UNAVAILABLE = "Bientôt disponible. En attendant, choisissez le règlement sur place.";
const CIVILITY_LABEL: Record<Civility, string> = { mme: "Madame", m: "Monsieur", "": "Non précisé" };
export const SAVE_FAILED_MESSAGE =
  "Votre demande n’a pas pu être conservée dans ce navigateur (stockage local refusé ou plein). Rien n’a été envoyé. Vos réponses restent affichées : autorisez le stockage pour ce site ou réessayez.";

export const ROLLBACK_FAILED_MESSAGE =
  "Votre demande n’a pas pu être conservée dans ce navigateur et l’état précédent n’a pas pu être vérifié. Rien n’a été envoyé ; votre saisie reste sur cette page.";

type Errors = Partial<Record<string, string>>;
export function urgencyErrors(s: Pick<BookingState, "urgent" | "slot">): Errors {
  if (s.urgent === null) return { urgent: "Indiquez si l’intervention est urgente." };
  if (s.urgent === false && !s.slot) return { slot: "Choisissez un créneau souhaité." };
  return {};
}
/** Same constraints as the request API (address 5+, postal code 5 digits, city 2+). */
export function addressErrors(a: AddressValue): Errors {
  const errors: Errors = {};
  if (a.address.trim().length < 5) errors.address = "Indiquez l’adresse (5 caractères minimum).";
  if (!/^\d{5}$/.test(a.postal_code.trim())) errors.postal_code = "Indiquez un code postal à 5 chiffres.";
  if (a.city.trim().length < 2) errors.city = "Indiquez la commune.";
  return errors;
}
export function paymentErrors(s: Pick<BookingState, "payment">, cardAvailable = false): Errors {
  if (!s.payment) return { payment: "Choisissez un mode de règlement." };
  if (s.payment === "card_hold" && !cardAvailable) return { payment: CARD_UNAVAILABLE };
  return {};
}
export function stepErrors(s: BookingState, cardAvailable = false): Errors {
  if (s.step === 1) return urgencyErrors(s);
  if (s.step === 2) return contactErrors(s.contact);
  if (s.step === 3) return addressErrors(s.address);
  if (s.step === 4) return paymentErrors(s, cardAvailable);
  return {};
}
export function urgencyLabel(s: Pick<BookingState, "urgent" | "slot">): string {
  if (s.urgent === true) return "Urgent";
  if (s.urgent === false && s.slot) return `${SLOT_LABEL[s.slot]} (créneau souhaité)`;
  return "À préciser";
}
/** One « Continuer » press: validate the active step; advance (1→5) or report the finish. Pure. */
export function advanceBooking(s: BookingState, cardAvailable = false): { state: BookingState; errors: Errors; finish: boolean } {
  const errors = stepErrors(s, cardAvailable);
  if (Object.keys(errors).length) return { state: s, errors, finish: false };
  if (s.step < LAST_STEP) return { state: { ...s, step: (s.step + 1) as BookingStep }, errors: {}, finish: false };
  return { state: s, errors: {}, finish: true };
}
export function toBooking(service: Pick<ServiceEntry, "slug">, s: BookingState): BookingDraft {
  const urgent = s.urgent === true;
  return { slug: service.slug, urgent, slot: urgent ? null : s.slot, notes: s.notes, contact: { ...s.contact, first_name: s.contact.first_name.trim(), last_name: s.contact.last_name.trim(), email: s.contact.email.trim(), phone: s.contact.phone.trim() }, ...(s.payment ? { payment: s.payment } : {}) };
}

/** Last step (BEFORE the phone check), all-or-nothing on the PAIR (public draft + booking extras): the two previous raw
 *  entries are read first; both new entries are written then proven by readback; on any failure
 *  the two previous raw values are restored (or removed when absent) and proven again. Navigation
 *  only when both new entries are proven; never a mixed pair announced as saved. */
export function finishBooking({ storage, service, state, onSaved = () => {}, now = Date.now() }: {
  storage: Storage | null;
  service: Pick<ServiceEntry, "slug" | "title" | "category">;
  state: BookingState;
  /** Called once both entries are proven (the wizard then opens the phone check). */
  onSaved?: () => void;
  now?: number;
}): { ok: true } | { ok: false; message: string } {
  if (!storage) return { ok: false, message: SAVE_FAILED_MESSAGE };
  // Idempotency key: generated ONCE per tab draft; going back and finishing again keeps the key
  // already stored for this service (never a new key for the same request).
  let keptId: string | undefined;
  try {
    const stored = readBooking(storage.getItem(BOOKING_DRAFT_KEY), now)?.booking;
    if (stored?.slug === service.slug && stored.request_id) keptId = stored.request_id;
  } catch {
    keptId = undefined;
  }
  const booking = { ...toBooking(service, state), request_id: keptId ?? newRequestId() };
  const values = {
    category: service.category,
    description: bookingDescription(service.title, booking),
    address: state.address.address.trim(),
    postal_code: state.address.postal_code.trim(),
    city: state.address.city.trim(),
    urgency: booking.urgent ? ("urgent" as const) : ("scheduled" as const),
  };
  const expectedValues = parsePublicDraftValues(values);
  const expectedBooking = parseBooking(booking);
  if (!expectedValues || !expectedBooking) return { ok: false, message: SAVE_FAILED_MESSAGE };
  const keys = [PUBLIC_DRAFT_KEY, BOOKING_DRAFT_KEY] as const;
  let previous: (string | null)[];
  try {
    previous = keys.map((k) => storage.getItem(k));
  } catch {
    return { ok: false, message: SAVE_FAILED_MESSAGE }; // nothing written
  }
  const proven = () => {
    try {
      const draft = readPublicDraft(storage.getItem(PUBLIC_DRAFT_KEY), now);
      const stored = readBooking(storage.getItem(BOOKING_DRAFT_KEY), now);
      return !!draft && !!stored && JSON.stringify(draft.values) === JSON.stringify(expectedValues) && JSON.stringify(stored.booking) === JSON.stringify(expectedBooking);
    } catch {
      return false;
    }
  };
  let written = false;
  try {
    written = savePublicDraft(storage, values, now).ok && saveBooking(storage, booking, now) && proven();
  } catch {
    written = false;
  }
  if (written) {
    onSaved();
    return { ok: true };
  }
  // Rollback to the exact previous pair, then prove it.
  let restored = true;
  keys.forEach((key, i) => {
    try {
      let current: string | null | undefined;
      try {
        current = storage.getItem(key);
      } catch {
        current = undefined; // unknown: restore anyway
      }
      if (current === previous[i]) return; // untouched entry: nothing to restore
      if (previous[i] === null) storage.removeItem(key);
      else storage.setItem(key, previous[i] as string);
    } catch {
      restored = false;
    }
  });
  try {
    restored = restored && keys.every((key, i) => storage.getItem(key) === previous[i]);
  } catch {
    restored = false;
  }
  return { ok: false, message: restored ? SAVE_FAILED_MESSAGE : ROLLBACK_FAILED_MESSAGE };
}

// ---- Bottom bar (closed page: « Confirmer » ; wizard: the active step's real submit) -----------
export function BookingBar({ title, range, compact = false, children }: { title: string; range: string; compact?: boolean; children: ReactNode }) {
  // Always fixed and stable (never moved by focus/blur): a tap that blurs a field lands on it.
  // `compact` (closed service page): range + caption + button on one line, no title.
  return (
    <div className={compact ? `${styles.bar} ${styles.barCompact}` : styles.bar} data-booking-bar={compact ? "compact" : ""}>
      <div className={styles.barInner}>
        {compact ? (
          <div className={styles.barText}>
            <strong>{range}</strong>
            <span>Estimation indicative</span>
          </div>
        ) : (
          <div className={styles.barText}>
            <strong>{title}</strong>
            <span>Estimation indicative : {range}</span>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// ---- Wizard ----------------------------------------------------------------------------------
const addressApi = createAddressApi();

export function BookingWizard({
  service,
  range,
  onClose,
  initial = EMPTY_BOOKING,
  go = (href: string) => window.location.assign(href),
  storage = () => getDraftStorage(),
  cardAvailable = false,
  phoneApi,
  initialPhase = "steps",
}: {
  service: ServiceEntry;
  range: string;
  onClose: () => void;
  initial?: BookingState;
  go?: (href: string) => void;
  storage?: () => Storage | null;
  /** Card authorisation offered only when the server can really do it (Stripe qualified). */
  cardAvailable?: boolean;
  phoneApi?: PhoneApi;
  /** Tests only. */
  initialPhase?: "steps" | "phone";
}) {
  // After the summary, the drafts are saved and the phone is verified inline (same page).
  const [phase, setPhase] = useState<"steps" | "phone">(initialPhase);
  const [phoneState, setPhoneState] = useState<PhoneState | null>(null);
  const [state, setState] = useState<BookingState>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState("");
  const [geolocation, setGeolocation] = useState<Geolocation | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    setGeolocation(typeof navigator !== "undefined" && navigator.geolocation ? navigator.geolocation : null);
  }, []);
  useEffect(() => {
    // Focus the step title (also when the wizard opens): keyboard and screen readers land on it.
    title.current?.focus({ preventScroll: first.current ? false : true });
    if (!first.current) title.current?.scrollIntoView({ block: "start", behavior: "auto" });
    first.current = false;
  }, [state.step, phase]);

  const set = (patch: Partial<BookingState>) => setState((s) => ({ ...s, ...patch }));
  const setContact = (patch: Partial<BookingContact>) => setState((s) => ({ ...s, contact: { ...s.contact, ...patch } }));
  const formId = `booking-step-${state.step}`;
  const phoneFormId = "booking-phone";
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFailure("");
    const step = advanceBooking(state, cardAvailable);
    setErrors(step.errors);
    if (!step.finish) {
      if (step.state !== state) setState(step.state);
      return;
    }
    const result = finishBooking({ storage: storage(), service, state, onSaved: () => setPhase("phone") });
    if (!result.ok) setFailure(result.message);
  };
  const back = () => {
    setErrors({});
    setFailure("");
    if (phase === "phone") setPhase("steps");
    else if (state.step === 1) onClose();
    else set({ step: (state.step - 1) as BookingStep });
  };

  return (
    <div className={styles.wizard} data-booking-wizard="" data-step={state.step}>
      <div className={styles.layout}>
        <aside className={styles.summary} aria-label="Votre demande" data-booking-summary="">
          <strong>{service.title}</strong>
          <span>Estimation indicative : {range}</span>
          <span>Urgence : {urgencyLabel(state)}</span>
          {state.payment && <span>Règlement : {PAYMENT_COPY[state.payment].title}</span>}
        </aside>

        <div className={styles.panel}>
          <button type="button" className={styles.back} onClick={back}>
            <span aria-hidden="true">←</span> Retour
          </button>
          <ol className={styles.steps} aria-label="Étapes">
            {([1, 2, 3, 4, 5] as BookingStep[]).map((n) => (
              <li key={n} aria-current={n === state.step ? "step" : undefined} data-done={n < state.step ? "true" : undefined}>
                <span aria-hidden="true">{n}</span>
                {STEP_TITLES[n]}
              </li>
            ))}
          </ol>
          <h2 ref={title} tabIndex={-1} className={styles.stepTitle}>
            {phase === "phone" ? "Vérifier mon téléphone" : STEP_TITLES[state.step]}
          </h2>

          {phase === "phone" ? (
            <div className={styles.form} data-booking-phone="">
              <p className={styles.private}>Votre demande est conservée dans ce navigateur. Vérifiez votre téléphone avec le code reçu : aucun compte ni mot de passe n’est nécessaire. Vous confirmerez ensuite l’envoi de la demande.</p>
              <PhoneAccess
                purpose="booking"
                formId={phoneFormId}
                api={phoneApi}
                prefill={{ phone: state.contact.phone, first_name: state.contact.first_name, last_name: state.contact.last_name }}
                onStateChange={setPhoneState}
                onVerified={() => go("/#new")}
              />
            </div>
          ) : (
          <form id={formId} className={styles.form} onSubmit={submit} noValidate>
            {state.step === 1 && (
              <>
                <fieldset className={styles.choices}>
                  <legend>Est-ce urgent ?</legend>
                  {([["Oui", true], ["Non", false]] as const).map(([label, value]) => (
                    <label key={label} className={styles.choice}>
                      <input type="radio" name="urgent" checked={state.urgent === value} onChange={() => set({ urgent: value, slot: value ? null : state.slot })} />
                      {label}
                    </label>
                  ))}
                  {errors.urgent && <small className={styles.error} role="alert">{errors.urgent}</small>}
                </fieldset>
                {state.urgent === false && (
                  <fieldset className={styles.choices} data-booking-slots="">
                    <legend>Quand souhaitez-vous l’intervention ?</legend>
                    {SLOTS.map((slot) => (
                      <label key={slot} className={styles.choice}>
                        <input type="radio" name="slot" checked={state.slot === slot} onChange={() => set({ slot })} />
                        {SLOT_LABEL[slot]}
                      </label>
                    ))}
                    <small className={styles.hint}>C’est un souhait transmis à l’artisan, pas un rendez-vous réservé : le rendez-vous est fixé ensuite avec lui.</small>
                    {errors.slot && <small className={styles.error} role="alert">{errors.slot}</small>}
                  </fieldset>
                )}
                <Field label="Précisions sur la panne (facultatif)" hint="Ce que vous constatez. N’indiquez ici ni nom, ni téléphone, ni email.">
                  <textarea value={state.notes} maxLength={1500} rows={4} onChange={(e) => set({ notes: e.target.value })} />
                </Field>
              </>
            )}

            {state.step === 2 && (
              <>
                <p className={styles.private}>Ces coordonnées restent privées : elles ne figurent pas dans la demande proposée aux artisans.</p>
                <fieldset className={styles.choices}>
                  <legend>Civilité</legend>
                  {CIVILITIES.map((c) => (
                    <label key={c || "none"} className={styles.choice}>
                      <input type="radio" name="civility" checked={state.contact.civility === c} onChange={() => setContact({ civility: c })} />
                      {CIVILITY_LABEL[c]}
                    </label>
                  ))}
                </fieldset>
                <div className={styles.grid}>
                  <Field label="Prénom" error={errors.first_name}>
                    <input autoComplete="given-name" maxLength={60} value={state.contact.first_name} onChange={(e) => setContact({ first_name: e.target.value })} />
                  </Field>
                  <Field label="Nom" error={errors.last_name}>
                    <input autoComplete="family-name" maxLength={60} value={state.contact.last_name} onChange={(e) => setContact({ last_name: e.target.value })} />
                  </Field>
                  <Field label="Adresse email" error={errors.email}>
                    <input type="email" autoComplete="email" inputMode="email" maxLength={254} value={state.contact.email} onChange={(e) => setContact({ email: e.target.value })} />
                  </Field>
                  <Field label="Téléphone" error={errors.phone}>
                    <input type="tel" autoComplete="tel" inputMode="tel" maxLength={30} value={state.contact.phone} onChange={(e) => setContact({ phone: e.target.value })} />
                  </Field>
                </div>
                <label className={styles.check}>
                  <input type="checkbox" checked={state.contact.company} onChange={(e) => setContact({ company: e.target.checked })} />
                  Je fais cette demande pour une entreprise
                </label>
              </>
            )}

            {state.step === 3 && (
              <>
                <AddressField
                  value={state.address}
                  onChange={(next) => set({ address: next })}
                  error={errors.address ?? errors.postal_code ?? errors.city}
                  search={addressApi.search}
                  reverse={addressApi.reverse}
                  geolocation={geolocation}
                />
              </>
            )}

            {state.step === 4 && (
              <fieldset className={styles.payments} data-booking-payment="">
                <legend>Comment souhaitez-vous régler ?</legend>
                {(["on_site", "card_hold"] as const).map((choice) => {
                  const disabled = choice === "card_hold" && !cardAvailable;
                  return (
                    <label key={choice} className={styles.payment} data-disabled={disabled ? "true" : undefined}>
                      <input type="radio" name="payment" value={choice} checked={state.payment === choice} disabled={disabled} onChange={() => set({ payment: choice })} />
                      <span>
                        <strong>{PAYMENT_COPY[choice].title}</strong>
                        <span>{PAYMENT_COPY[choice].text}</span>
                        {disabled && <em className={styles.soon}>{CARD_UNAVAILABLE}</em>}
                      </span>
                    </label>
                  );
                })}
                {errors.payment && <small className={styles.error} role="alert">{errors.payment}</small>}
              </fieldset>
            )}

            {state.step === 5 && (
              <>
                <dl className={styles.recap} data-booking-recap="">
                  <div><dt>Prestation</dt><dd>{service.title}</dd></div>
                  <div><dt>Estimation indicative</dt><dd>{range}</dd></div>
                  <div><dt>Urgence</dt><dd>{urgencyLabel(state)}</dd></div>
                  <div><dt>Adresse d’intervention</dt><dd>{state.address.address}<br />{state.address.postal_code} {state.address.city}</dd></div>
                  <div><dt>Vos coordonnées (privées)</dt><dd>{[CIVILITY_LABEL[state.contact.civility] === "Non précisé" ? "" : CIVILITY_LABEL[state.contact.civility], state.contact.first_name, state.contact.last_name].filter(Boolean).join(" ")}<br />{state.contact.email} · {state.contact.phone}{state.contact.company ? <><br />Demande pour une entreprise</> : null}</dd></div>
                  <div><dt>Règlement</dt><dd>{state.payment ? PAYMENT_LABEL[state.payment] : "À préciser"}</dd></div>
                  {state.notes.trim() && <div><dt>Précisions</dt><dd>{state.notes}</dd></div>}
                </dl>
                <p className={styles.next} role="note">Rien n’est encore envoyé. À l’étape suivante, vous vérifiez votre téléphone avec un code (sans créer de compte), puis vous confirmez l’envoi de la demande.</p>
              </>
            )}
            {failure && <p className={styles.failure} role="alert">{failure}</p>}
            {/* Visible action at the end of every step (the fixed bar can be off-screen or hidden on
                short viewports): SAME native submit of this form, same label, same handler. */}
            <div className={styles.inlineActions}>
              <button type="submit" className={styles.inlineSubmit} data-booking-inline-submit={state.step}>
                {STEP_ACTION[state.step]}
              </button>
            </div>
          </form>
          )}
        </div>
      </div>

      <BookingBar title={service.title} range={range}>
        {phase === "phone" ? (
          phoneState?.stage !== "verified" && (
            <button type="submit" form={phoneFormId} className={styles.barButton} data-booking-submit="phone" disabled={phoneState?.stage === "sending" || phoneState?.stage === "verifying"}>
              {phoneState ? phoneActionLabel(phoneState) : "Recevoir un code"}
            </button>
          )
        ) : (
          <button type="submit" form={formId} className={styles.barButton} data-booking-submit={state.step}>
            {STEP_ACTION[state.step]}
          </button>
        )}
      </BookingBar>
    </div>
  );
}
