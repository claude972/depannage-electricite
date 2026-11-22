"use client";
import dynamic from "next/dynamic";
import { useEffect, useId, useState } from "react";
import { AddressField, createAddressApi, type AddressValue } from "./address-field";
import { BOOKING_ADDRESS_COPY as copy, type BookingPoint } from "../../shared/booking-address";
import type { BookingLocation } from "../../shared/booking-location";
import { useBookingAddress } from "../../shared/use-booking-address";
import styles from "./booking-location.module.css";

const Map = dynamic(() => import("../../shared/booking-map"), { ssr: false, loading: () => <p role="status">Chargement de la carte…</p> });
const api = createAddressApi();
const lookup = {
  search: api.search,
  async reverse(point: BookingPoint, signal: AbortSignal) {
    const reply = await api.reverse(point.latitude, point.longitude, signal);
    return reply.candidates[0] ?? null;
  },
};

export function BookingLocationField({ value, location, onChange, error, geolocation }: { value: AddressValue; location?: BookingLocation; onChange(address: AddressValue, location: BookingLocation): void; error?: string; geolocation?: Pick<Geolocation, "getCurrentPosition"> | null }) {
  const id = useId();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  const address = useBookingAddress({ value, location, onChange, lookup, locate: () => new Promise((resolve, reject) => {
    const geo = geolocation === undefined ? navigator.geolocation : geolocation;
    if (!geo) { reject(new Error(copy.gpsUnavailable)); return; }
    geo.getCurrentPosition(({ coords: { latitude, longitude, accuracy } }) => resolve({ latitude, longitude, accuracy }),
      error => reject(new Error(error.code === 1 ? copy.refused : error.code === 3 ? "La localisation a pris trop de temps. Réessayez ou saisissez votre adresse." : copy.gpsUnavailable)),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  }) });
  const canSearch = online && !address.searching && address.query.trim().length >= 3;
  return <div className={styles.location}>
    <div className={styles.search}>
      <label htmlFor={`${id}-search`}>{copy.search}
        <input id={`${id}-search`} value={address.query} maxLength={200} placeholder={copy.placeholder}
          onChange={event => address.changeQuery(event.target.value)} onKeyDown={event => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (canSearch) void address.find();
          }} />
      </label>
      <button type="button" disabled={!canSearch} onClick={() => void address.find()}>{address.searching ? copy.finding : copy.find}</button>
    </div>
    {address.searchMessage && <p role="status" className={styles.help}>{address.searchMessage}</p>}
    {address.results.length > 0 && <ul className={styles.results} aria-label="Adresses trouvées">
      {address.results.map(result => <li key={result.id}><button type="button" onClick={() => address.choose(result)}>{result.label}</button></li>)}
    </ul>}
    <div className={styles.actions}><button type="button" disabled={address.busy === "gps" || !online} onClick={() => void address.usePosition()}>{address.busy === "gps" ? copy.locating : copy.locate}</button></div>
    <p className={styles.help}>{copy.mapHelp} Au clavier, utilisez les flèches sur la carte.</p>
    <Map target={address.target} onMove={address.move} />
    {!online && <p role="status">Vous êtes hors ligne. La carte et la recherche nécessitent une connexion. L’adresse peut être saisie manuellement.</p>}
    <p role="status" className={styles.help}>{address.busy === "reverse" ? "Recherche de l’adresse du repère…" : address.pointMessage}</p>
    {(address.pendingPoint || address.current.latitude === null) && <p className={styles.help} data-booking-point-unconfirmed="">{address.current.latitude === null ? "Repère non confirmé : le point affiché sur la carte ne sera pas utilisé. Seule l’adresse renseignée ci-dessous sera transmise tant que vous ne confirmez pas un repère." : "Ce nouveau repère n’est pas confirmé. L’adresse et le dernier repère validés restent utilisés tant que vous ne confirmez pas ce changement."}</p>}
    {address.candidate && <p className={styles.help}>Adresse proposée pour le repère : {address.candidate.address}, {address.candidate.postal_code} {address.candidate.city}</p>}
    {address.pendingPoint && <button type="button" disabled={Boolean(address.busy)} onClick={address.confirmPoint}>{copy.confirmPoint}</button>}
    <AddressField value={value} error={error} cityLabel={copy.city} onChange={address.edit} />
    <div className={styles.access}>
      <label htmlFor={`${id}-access`}>{copy.access}</label>
      <textarea id={`${id}-access`} rows={3} maxLength={1000} value={address.current.access_details} placeholder={copy.accessPlaceholder} onChange={event => address.editAccess(event.target.value)} />
    </div>
    <p className={styles.help}>Source des adresses : Base Adresse Nationale.</p>
  </div>;
}
