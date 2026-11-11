"use client";
import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";
import { AddressField, createAddressApi, type AddressCandidate, type AddressValue } from "./address-field";
import type { MapPoint } from "./booking-map";
import type { BookingLocation } from "../../shared/booking-location";
import styles from "./booking-location.module.css";
const Map = dynamic(() => import("./booking-map"), { ssr: false, loading: () => <p role="status">Chargement de la carte…</p> });
const api = createAddressApi();
const emptyLocation: BookingLocation = { latitude: null, longitude: null, access_details: "" };
export function BookingLocationField({ value, location, onChange, error, geolocation }: { value: AddressValue; location?: BookingLocation; onChange(address: AddressValue, location: BookingLocation): void; error?: string; geolocation?: Pick<Geolocation, "getCurrentPosition"> | null }) {
  const id = useId();
  const current = location ?? emptyLocation;
  const [target, setTarget] = useState<MapPoint | null>(() => current.latitude !== null && current.longitude !== null ? { latitude: current.latitude, longitude: current.longitude } : null);
  const [point, setPoint] = useState<MapPoint | null>(null);
  const [candidate, setCandidate] = useState<AddressCandidate | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressCandidate[]>([]);
  const [searchMessage, setSearchMessage] = useState("");
  const [pointMessage, setPointMessage] = useState("");
  const [geoMessage, setGeoMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [reverseBusy, setReverseBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const search = useRef<AbortController | null>(null);
  const geoSequence = useRef(0);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); search.current?.abort(); geoSequence.current++; };
  }, []);
  useEffect(() => {
    if (!point) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!navigator.onLine) { setReverseBusy(false); return; }
      void api.reverse(point.latitude, point.longitude, controller.signal).then(reply => {
        if (controller.signal.aborted) return;
        setCandidate(reply.candidates[0] ?? null);
        setPointMessage(reply.candidates.length ? "Vérifiez l’adresse proposée avant de confirmer le repère." : "Aucune adresse trouvée ici. Saisissez l’adresse ci-dessous, puis confirmez le repère.");
      }).catch(() => { if (!controller.signal.aborted) setPointMessage("Adresse introuvable pour le moment. Saisissez-la ci-dessous, puis confirmez le repère."); })
        .finally(() => { if (!controller.signal.aborted) setReverseBusy(false); });
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [point]);
  function move(next: MapPoint) {
    setCandidate(null); setPoint(next); setPointMessage(""); setReverseBusy(true);
  }
  async function find() {
    search.current?.abort(); const controller = new AbortController(); search.current = controller;
    setResults([]); setBusy(true); setSearchMessage("");
    try {
      const reply = await api.search(query.trim(), controller.signal);
      if (controller.signal.aborted) return;
      setResults(reply.candidates); setSearchMessage(reply.candidates.length ? "Choisissez une adresse pour centrer la carte." : "Aucune adresse trouvée. Précisez la commune ou saisissez l’adresse manuellement.");
    } catch { if (!controller.signal.aborted) setSearchMessage("Recherche indisponible. Vous pouvez saisir l’adresse manuellement."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function locate() {
    const geo = geolocation === undefined ? navigator.geolocation : geolocation;
    if (!geo) { setGeoMessage("La localisation n’est pas disponible. Utilisez la recherche ou déplacez la carte."); return; }
    const seq = ++geoSequence.current; setLocating(true); setGeoMessage("");
    geo.getCurrentPosition(position => {
      if (seq !== geoSequence.current) return;
      setLocating(false);
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      move(next); setTarget(next);
      setGeoMessage(position.coords.accuracy > 100 ? `Position imprécise (environ ${Math.round(position.coords.accuracy)} m). Déplacez la carte pour placer le repère sur l’entrée.` : "Position trouvée. Vérifiez le repère et l’adresse avant de confirmer.");
    }, error => {
      if (seq !== geoSequence.current) return;
      setLocating(false); setGeoMessage(error.code === 1 ? "Accès à la position refusé. Recherchez votre adresse ou déplacez la carte." : error.code === 3 ? "La localisation a pris trop de temps. Réessayez ou saisissez votre adresse." : "Position indisponible. Recherchez votre adresse ou déplacez la carte.");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  }
  return <div className={styles.location}>
    <div className={styles.search}>
      <label htmlFor={`${id}-search`}>
        Rechercher une adresse
        <input
          id={`${id}-search`}
          value={query}
          maxLength={200}
          placeholder="Rue, quartier, commune en Martinique"
          onChange={e => {
            search.current?.abort();
            setBusy(false);
            setResults([]);
            setSearchMessage("");
            setQuery(e.target.value);
          }}
          onKeyDown={e => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (query.trim().length >= 3 && online && !busy) void find();
          }}
        />
      </label>
      <button type="button" disabled={!online || busy || query.trim().length < 3} onClick={() => void find()}>
        {busy ? "Recherche…" : "Rechercher"}
      </button>
    </div>
    {searchMessage && <p role="status" className={styles.help}>{searchMessage}</p>}
    {results.length > 0 && (
      <ul className={styles.results} aria-label="Adresses trouvées">
        {results.map(c => (
          <li key={c.id}>
            <button type="button" onClick={() => {
              setResults([]);
              setSearchMessage("");
              const next = { latitude: c.latitude, longitude: c.longitude };
              move(next);
              setTarget(next);
            }}>
              {c.label}
            </button>
          </li>
        ))}
      </ul>
    )}
    <div className={styles.actions}><button type="button" disabled={locating || !online} onClick={locate}>{locating ? "Localisation en cours…" : "Ma position"}</button></div>
    <p className={styles.help}>Déplacez la carte sous le repère pour indiquer l’entrée. Au clavier, utilisez les flèches sur la carte.</p>
    <Map target={target} onMove={move} />
    {!online && <p role="status">Vous êtes hors ligne. La carte et la recherche nécessitent une connexion. L’adresse peut être saisie manuellement.</p>}
    <p role="status" className={styles.help}>{geoMessage}</p><p role="status" className={styles.help}>{reverseBusy ? "Recherche de l’adresse du repère…" : pointMessage}</p>
    {candidate && <p>{candidate.label}</p>}
    {point && <button type="button" disabled={reverseBusy} onClick={() => { onChange(candidate ? { address: candidate.address, postal_code: candidate.postal_code, city: candidate.city } : value, { ...current, ...point }); setPoint(null); setCandidate(null); setPointMessage("Repère confirmé. Vérifiez les détails de l’adresse ci-dessous."); }}>Confirmer ce repère</button>}
    {current.latitude !== null && current.longitude !== null && <p className={styles.help}>Repère enregistré : {current.latitude.toFixed(5)}, {current.longitude.toFixed(5)}.</p>}
    <p className={styles.help}>Adresses : IGN Géoplateforme / Base Adresse Nationale. Vous pouvez aussi saisir l’adresse sans utiliser la carte.</p>
    <AddressField value={value} error={error} onChange={next => onChange(next, { ...current, latitude: null, longitude: null })} />
    <label htmlFor={`${id}-access`}>Complément d’accès (facultatif)<textarea id={`${id}-access`} rows={3} maxLength={1000} value={current.access_details} placeholder="Bâtiment, étage, entrée, indications pour trouver le lieu…" onChange={e => onChange(value, { ...current, access_details: e.target.value })} /></label>
  </div>;
}
