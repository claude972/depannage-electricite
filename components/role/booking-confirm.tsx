"use client";
// Final explicit confirmation of the service booking flow, AFTER login (FASTSPLIT-SERVICE-BOOKING-
// FLOW-001). Nothing is created on login: the user reviews and clicks « Envoyer ma demande ».
// Order: PATCH /api/profile {full_name, phone} (private, never in the description) then ONE POST
// of the request. A double click is refused; any failure keeps the draft and the booking; the
// component is remounted on identity change (role space key) so a late step never runs for
// another account.
import { useEffect, useRef, useState } from "react";
import { SLOT_LABEL, contactErrors, profilePatch, type BookingDraft } from "../app/booking-draft";
import { category, money } from "../app/format";
import type { RequestValues } from "../app/types";
import { serviceBySlug } from "./public-service-catalog";

export function BookingConfirm({
  draft,
  booking,
  busy,
  profileId,
  updateProfile,
  createIntervention,
  onEdit,
}: {
  draft: RequestValues;
  booking: BookingDraft;
  busy: boolean;
  profileId: string;
  updateProfile(values: { full_name: string; phone: string }): Promise<boolean>;
  createIntervention(values: RequestValues): Promise<boolean>;
  onEdit(): void;
}) {
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");
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
    inFlight.current = true;
    setSending(true);
    const startedAs = identity.current;
    try {
      const patch = profilePatch(contact);
      if (!patch || Object.keys(contactErrors(contact)).length) {
        // Never a PATCH the API would refuse, never a request without the contact profile.
        setProblem("Vos coordonnées sont incomplètes ou trop longues. Modifiez-les avant d’envoyer ; rien n’a été envoyé.");
        return;
      }
      setProblem("");
      const ok = await updateProfile(patch);
      if (!ok || !alive.current || identity.current !== startedAs) return; // draft kept
      await createIntervention(draft); // clears draft + booking only after POST 201
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
            {[contact.first_name, contact.last_name].filter(Boolean).join(" ")}
            {contact.phone ? ` · ${contact.phone}` : ""}
            <br />
            <small>Enregistrées dans votre profil, jamais dans la description visible des artisans.</small>
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
          Modifier
        </button>
        <button type="button" className="button primary" disabled={sending || busy} onClick={() => void send()} data-booking-send="">
          {sending ? "Envoi…" : "Envoyer ma demande"}
        </button>
      </div>
    </section>
  );
}
