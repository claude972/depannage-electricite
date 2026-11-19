"use client";
// Final explicit confirmation of the service booking flow, AFTER identification (FASTSPLIT-SERVICE-
// BOOKING-FLOW-001 + guest checkout contract). Nothing is created on login: the user reviews and
// clicks « Envoyer ma demande » ⇒ ONE idempotent POST /api/bookings (contact in the booking body,
// never in the description; never the legacy /api/interventions). A double click is refused; any
// failure keeps the draft and the booking; the component is remounted on identity change.
import { useEffect, useRef, useState } from "react";
import { PAYMENT_LABEL, SLOT_LABEL, contactErrors, type BookingDraft, type PaymentChoice } from "../app/booking-draft";
import { category, money } from "../app/format";
import type { RequestValues } from "../app/types";
import { EnterpriseBookingLink } from "./enterprise-booking-link";
import { serviceBySlug } from "./public-service-catalog";
import { RequestProgress } from "../app/request-progress";
import { Field } from "../app/ui";
import { ReservedEstimate, ReviewEstimate } from "../features/indicative-prices/indicative-range";
import { REVIEW_COPY, REVIEW_SCOPES } from "../features/indicative-prices/model";

const CONTACT_KEYS = ["first_name", "last_name", "email", "phone"] as const;
const CONTACT_FIELD: Record<(typeof CONTACT_KEYS)[number], { label: string; type: "text" | "email" | "tel"; max: number; autoComplete: string; inputMode?: "email" | "tel" }> = {
  first_name: { label: "Prénom", type: "text", max: 60, autoComplete: "given-name" },
  last_name: { label: "Nom", type: "text", max: 60, autoComplete: "family-name" },
  email: { label: "Adresse e-mail", type: "email", max: 254, autoComplete: "email", inputMode: "email" },
  phone: { label: "Téléphone", type: "tel", max: 30, autoComplete: "tel", inputMode: "tel" },
};

export function BookingConfirm({
  draft,
  booking,
  busy,
  profileId,
  confirmBooking,
  onEdit,
  onContactChange,
  onPaymentChange,
  cardAvailable = false,
  verifyCardHold,
  cancelCardHold,
  demo = false,
}: {
  draft: RequestValues;
  booking: BookingDraft;
  busy: boolean;
  profileId: string;
  /** POST /api/bookings (idempotent; contact travels in the booking body, never the description). */
  confirmBooking(): Promise<boolean>;
  /** « Modifier la demande »: regular form prefilled; its submit only replaces the kept draft. */
  onEdit(): void;
  /** Saves edited private contact details in the kept booking (nothing is sent). */
  onContactChange(contact: BookingDraft["contact"]): void;
  /** Guest checkout: switch the payment choice (e.g. card hold not available yet ⇒ on site). */
  onPaymentChange?(payment: PaymentChoice): void;
  /** Card authorisation flow available (server checkout API qualified). Default false: honest refusal. */
  cardAvailable?: boolean;
  /** Card hold already started with this key (reply lost / back from the bank): server finalize. */
  verifyCardHold?(requestId: string): Promise<boolean>;
  /** Cancels the card-hold attempt on the server; the mode/key only change after « cancelled ». */
  cancelCardHold?(): Promise<boolean>;
  /** Demo: local estimate only, zero price reads. */
  demo?: boolean;
}) {
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");
  const [paymentProblem, setPaymentProblem] = useState("");
  const paymentOptions = useRef<HTMLDivElement>(null);
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState(booking.contact);
  // The demonstration has no account and sends nothing: its contact needs no e-mail address.
  const contactRule = { emailRequired: !demo };
  const contactProblems = contactErrors(contactDraft, contactRule);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const identity = useRef(profileId);
  identity.current = profileId;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const service = serviceBySlug(booking.slug);
  const c = category(draft.category);
  const wish = draft.urgency === "urgent" ? "Demande urgente" : booking.slot ? SLOT_LABEL[booking.slot] : "Intervention à planifier";
  const contact = booking.contact;

  async function send() {
    if (inFlight.current || busy) return; // one POST only
    if (booking.payment === "card_hold" && !cardAvailable) {
      // Never a fake card form or a request presented as covered by an authorisation.
      setProblem("L’empreinte bancaire n’est pas encore disponible. Choisissez le paiement après intervention sur la plateforme pour envoyer votre demande ; rien n’a été envoyé.");
      return;
    }
    inFlight.current = true;
    setSending(true);
    try {
      if (!booking.payment) {
        setPaymentProblem("Choisissez un mode de paiement avant d’envoyer ; rien n’a été envoyé.");
        paymentOptions.current?.querySelector("button")?.focus();
        return;
      }
      if (Object.keys(contactErrors(contact, contactRule)).length) {
        setProblem("Vos coordonnées sont incomplètes : nom, adresse e-mail et téléphone (+596, +590 ou +33) sont nécessaires. Complétez-les avant d’envoyer ; rien n’a été envoyé.");
        setContactDraft(contact);
        setEditingContact(true);
        return;
      }
      setProblem("");
      await confirmBooking(); // draft + booking consumed only on 201 « confirmed »
    } finally {
      inFlight.current = false;
      if (alive.current) setSending(false);
    }
  }

  if (booking.contact.company) {
    return (
      <section className="panel" aria-labelledby="booking-confirm-title">
        <h1 id="booking-confirm-title">Votre demande pour une entreprise</h1>
        <p>Ce brouillon a été préparé depuis le parcours particulier. Créez le dossier depuis votre espace entreprise pour le rattacher au bon site.</p>
        <EnterpriseBookingLink />
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="booking-confirm-title" data-booking-confirm="">
      {/* The public form may start with the address; drafts do not persist that ordering. */}
      <RequestProgress step={3} labels={["Étape 1", "Étape 2", "Règlement et confirmation"]} />
      <h1 id="booking-confirm-title">Confirmez l’envoi de votre demande</h1>
      <p>Rien n’a encore été envoyé. Vérifiez votre demande : elle sera transmise aux artisans disponibles après votre confirmation.</p>
      {!demo && booking.estimate_review_required && (
        <p className="alert" role="alert" data-estimate-review-required="">{REVIEW_COPY.conflict}</p>
      )}
      <dl className="recap-list">
        <div>
          <dt>Prestation</dt>
          <dd>{service?.title ?? c.label}</dd>
        </div>
        <div>
          <dt>Estimation indicative</dt>
          <dd>
            {/* PUB-02: demo = local range (zero calls); live = the version RENDERED here (recorded for
                the submit), or the version already stored with this request — never the static amount. */}
            {demo ? (
              <>{money(c.min)} – {money(c.max)}</>
            ) : booking.request_id && booking.reviewed_estimate_version !== undefined && booking.reviewed_estimate_range && !booking.estimate_review_required ? (
              // Amounts confirmed with THIS request (its version), never a later tariff.
              <strong data-reserved-estimate={booking.reviewed_estimate_version}>
                {money(booking.reviewed_estimate_range.min_cents)} – {money(booking.reviewed_estimate_range.max_cents)}
              </strong>
            ) : booking.request_id && booking.reviewed_estimate_version !== undefined && !booking.estimate_review_required ? (
              <ReservedEstimate category={draft.category} version={booking.reviewed_estimate_version} />
            ) : (
              <ReviewEstimate category={draft.category} scope={REVIEW_SCOPES.bookingConfirm} />
            )}{" "}
            <small>(fourchette, pas un prix garanti)</small>
          </dd>
        </div>
        <div>
          <dt>Délai souhaité</dt>
          <dd>{wish} <small>(souhait, pas un rendez-vous réservé)</small></dd>
        </div>
        {!booking.payment && onPaymentChange && (
          <div>
            <dt>Paiement</dt>
            <dd data-booking-payment="">
              <div ref={paymentOptions} className="booking-payment-options" role="group" aria-label="Mode de règlement" aria-describedby={paymentProblem ? "booking-payment-error" : undefined}>
                <span>Choisissez votre mode de règlement :</span>
                <br />
                <button type="button" className="button outline booking-payment-option" aria-pressed={false} disabled={sending || busy} onClick={() => { onPaymentChange("on_site"); setProblem(""); setPaymentProblem(""); }} data-booking-choose="on_site">
                  {PAYMENT_LABEL.on_site}
                </button>
                <br />
                {cardAvailable ? (
                  <button type="button" className="button outline booking-payment-option" aria-pressed={false} disabled={sending || busy} onClick={() => { onPaymentChange("card_hold"); setProblem(""); setPaymentProblem(""); }} data-booking-choose="card_hold">
                    {PAYMENT_LABEL.card_hold}
                  </button>
                ) : (
                  <small data-booking-choose="card_hold_unavailable">{PAYMENT_LABEL.card_hold} : {demo ? "indisponible en démonstration ; aucune empreinte bancaire n’est créée." : "pas encore disponible sur ce service."}</small>
                )}
                {paymentProblem && <p id="booking-payment-error" className="field-error" role="alert">{paymentProblem}</p>}
              </div>
            </dd>
          </div>
        )}
        {booking.payment && (
          <div>
            <dt>Paiement</dt>
            <dd data-booking-payment={booking.payment}>
              {PAYMENT_LABEL[booking.payment]}
              <br />
              <small>
                {booking.payment === "on_site"
                  ? "Rien n’est payé à l’envoi de la demande. Après les travaux, vous réglez le montant du devis accepté sur la plateforme (par carte depuis le suivi du dossier) — jamais directement à l’artisan."
                  : "Une empreinte n’est pas un débit ; seul le montant du devis accepté peut être prélevé."}
              </small>
              {booking.payment === "card_hold" && booking.request_id && (verifyCardHold || cancelCardHold) && (
                <span className="booking-card-actions" data-booking-card-actions="">
                  <br />
                  {verifyCardHold && (
                    <button type="button" className="text-button" disabled={sending || busy} onClick={() => void verifyCardHold(booking.request_id as string)}>
                      Vérifier mon empreinte
                    </button>
                  )}{" "}
                  {cancelCardHold && (
                    <button type="button" className="text-button" disabled={sending || busy} onClick={() => void cancelCardHold()}>
                      Annuler la demande d’empreinte bancaire
                    </button>
                  )}
                </span>
              )}
              {!booking.request_id && onPaymentChange && cardAvailable && (
                <>
                  <br />
                  <button type="button" className="text-button" disabled={sending || busy} onClick={() => { onPaymentChange(booking.payment === "on_site" ? "card_hold" : "on_site"); setProblem(""); }} data-booking-switch="">
                    {booking.payment === "on_site" ? `Choisir plutôt : ${PAYMENT_LABEL.card_hold}` : `Choisir plutôt : ${PAYMENT_LABEL.on_site}`}
                  </button>
                </>
              )}
              {booking.payment === "card_hold" && !booking.request_id && !cardAvailable && onPaymentChange && (
                <>
                  <br />
                  <button type="button" className="text-button" disabled={sending || busy} onClick={() => { onPaymentChange("on_site"); setProblem(""); }}>
                    Choisir le paiement après intervention sur la plateforme
                  </button>
                </>
              )}
            </dd>
          </div>
        )}
        <div>
          <dt>Adresse d’intervention</dt>
          <dd>
            {draft.address}, {draft.postal_code} {draft.city}
          </dd>
        </div>
        <div>
          <dt>Description transmise aux artisans</dt>
          <dd style={{ whiteSpace: "pre-line" }}>{draft.description.trim() || "Aucune description ajoutée."}</dd>
        </div>
        <div>
          <dt>Vos coordonnées (privées)</dt>
          <dd>
            {editingContact ? (
              <div className="booking-contact-edit" data-booking-contact-edit="">
                {/* CLI-05: Field keeps the label stable; the error is linked by aria-describedby. */}
                {(demo ? CONTACT_KEYS.filter((key) => key !== "email") : CONTACT_KEYS).map((key) => (
                  <Field
                    key={key}
                    label={CONTACT_FIELD[key].label}
                    error={contactProblems[key] || undefined}
                  >
                    <input
                      value={contactDraft[key]}
                      type={CONTACT_FIELD[key].type}
                      maxLength={CONTACT_FIELD[key].max}
                      autoComplete={CONTACT_FIELD[key].autoComplete}
                      inputMode={CONTACT_FIELD[key].inputMode}
                      onChange={(e) => setContactDraft({ ...contactDraft, [key]: e.target.value })}
                    />
                  </Field>
                ))}
                <button
                  type="button"
                  className="button outline"
                  disabled={Object.keys(contactProblems).length > 0}
                  onClick={() => {
                    onContactChange(contactDraft);
                    setEditingContact(false);
                    setProblem("");
                  }}
                >
                  Enregistrer mes coordonnées
                </button>
              </div>
            ) : (
              <>
                {[contact.first_name, contact.last_name].filter(Boolean).join(" ")}
                {contact.email ? <><br />{contact.email}</> : null}
                {contact.phone ? <><br />{contact.phone}</> : null}{" "}
                <button type="button" className="text-button booking-contact-edit" disabled={sending || busy} onClick={() => setEditingContact(true)}>
                  Modifier mes coordonnées
                </button>
              </>
            )}
            <br />
            <small>Transmises avec votre demande, jamais dans la description visible des artisans.</small>
          </dd>
        </div>
      </dl>
      {(problem || (!onPaymentChange && paymentProblem)) && (
        <p className="field-error" role="alert">
          {problem || paymentProblem}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button outline" disabled={sending || busy} onClick={onEdit}>
          Modifier la demande
        </button>
        <button type="button" className="button primary" disabled={sending || busy || editingContact} onClick={() => void send()} data-booking-send="">
          {sending ? "Envoi…" : "Envoyer ma demande"}
        </button>
      </div>
    </section>
  );
}
