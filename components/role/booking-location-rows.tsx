"use client";

import { useEffect, useState } from "react";
import { api } from "../app/api";
import { parseBookingLocation, type BookingLocation } from "../../shared/booking-location";

export function BookingLocationRows({ interventionId }: { interventionId: string }) {
  const [result, setResult] = useState<BookingLocation | "unavailable" | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void api<{ booking_location: unknown }>(`/api/interventions/${encodeURIComponent(interventionId)}/booking-location`)
      .then(({ booking_location }) => {
        if (active) setResult(booking_location === null ? null : parseBookingLocation(booking_location) ?? "unavailable");
      })
      .catch(() => {
        if (active) setResult("unavailable");
      });
    return () => { active = false; };
  }, [interventionId, attempt]);

  if (result === null) return null;
  if (result === "unavailable") return (
    <div>
      <dt>Informations d’accès</dt>
      <dd>
        <span role="status">Indisponibles pour le moment.</span>{" "}
        <button type="button" className="button outline" onClick={() => { setResult(null); setAttempt((value) => value + 1); }}>
          Réessayer
        </button>
      </dd>
    </div>
  );

  return (
    <>
      {result.access_details.trim() && (
        <div>
          <dt>Complément d’accès</dt>
          <dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{result.access_details}</dd>
        </div>
      )}
      {result.latitude !== null && result.longitude !== null && (
        <div>
          <dt>Repère GPS</dt>
          <dd>{result.latitude}, {result.longitude}</dd>
        </div>
      )}
    </>
  );
}
