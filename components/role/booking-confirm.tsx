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
import { serviceBySlug } from "./public-service-catalog";

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
}) {
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState(booking.contact);
  const contactProblems = contactErrors(contactDraft);
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
  const wish = booking.urgent ? "En urgence" : booking.slot ? SLOT_LABEL[booking.slot] : "Sans préférence";
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
      if (Object.keys(contactErrors(contact)).length) {
        setProblem("Vos coordonnées sont incomplètes ou trop longues. Modifiez-les avant d’envoyer ; rien n’a été envoyé.");
        setEditingContact(true);
        return;
      }
      if (!booking.payment) {
        setProblem("Choisissez un mode de paiement avant d’envoyer ; rien n’a été envoyé.");
        return;
      }
      setProblem("");
      await confirmBooking(); // draft + booking consumed only on 201 « confirmed »
    } finally {
      inFlight.current = false;
      if (alive.current) setSending(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="booking-confirm-title" data-booking-confirm="">
      <p className="eyebrow">Dernière étape</p>
      <h1 id="booking-confirm-title">Confirmez l’envoi de votre demande</h1>
      <p>Rien n’a encore été envoyé. Vérifiez votre demande : elle sera transmise aux artisans disponibles après votre confirmation.</p>
      <dl className="recap-list">
        <div>
          <dt>Prestation</dt>
          <dd>{service?.title ?? c.label}</dd>
        </div>
        <div>
          <dt>Estimation indicative</dt>
          <dd>
            {money(c.min)} – {money(c.max)} <small>(fourchette, pas un prix garanti)</small>
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
              À choisir.{" "}
              <button type="button" className="text-button" disabled={sending || busy} onClick={() => { onPaymentChange("on_site"); setProblem(""); }}>
                Paiement après intervention sur la plateforme
              </button>
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
                  ? "Rien n’est payé à la réservation. Après les travaux, vous réglez le montant du devis accepté sur la plateforme (carte via votre suivi, lien sécurisé ou QR code) — jamais directement à l’artisan."
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
                      Annuler la réservation par carte
                    </button>
                  )}
                </span>
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
          <dd style={{ whiteSpace: "pre-line" }}>{draft.description}</dd>
        </div>
        <div>
          <dt>Vos coordonnées (privées)</dt>
          <dd>
            {editingContact ? (
              <span className="booking-contact-edit" data-booking-contact-edit="">
                {(["first_name", "last_name", "phone"] as const).map((key) => (
                  <label key={key} className="field">
                    <span>{key === "first_name" ? "Prénom" : key === "last_name" ? "Nom" : "Téléphone"}</span>
                    <input
                      value={contactDraft[key]}
                      maxLength={key === "phone" ? 30 : 60}
                      autoComplete={key === "first_name" ? "given-name" : key === "last_name" ? "family-name" : "tel"}
                      inputMode={key === "phone" ? "tel" : undefined}
                      aria-invalid={contactProblems[key] ? true : undefined}
                      onChange={(e) => setContactDraft({ ...contactDraft, [key]: e.target.value })}
                    />
                    {contactProblems[key] && <small className="field-error">{contactProblems[key]}</small>}
                  </label>
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
              </span>
            ) : (
              <>
                {[contact.first_name, contact.last_name].filter(Boolean).join(" ")}
                {contact.phone ? ` · ${contact.phone}` : ""}{" "}
                <button type="button" className="text-button" disabled={sending || busy} onClick={() => setEditingContact(true)}>
                  Modifier mes coordonnées
                </button>
              </>
            )}
            <br />
            <small>Transmises avec votre réservation, jamais dans la description visible des artisans.</small>
          </dd>
        </div>
      </dl>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
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
