"use client";
import { useEffect, useRef, useState } from "react";
import type { Map } from "leaflet";
import styles from "./booking-location.module.css";
export type MapPoint = { latitude: number; longitude: number };
export default function BookingMap({ target, onMove }: { target: MapPoint | null; onMove(point: MapPoint): void }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const latest = useRef(onMove);
  latest.current = onMove;
  const latestTarget = useRef(target);
  latestTarget.current = target;
  const [message, setMessage] = useState("");
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void import("leaflet").then(L => {
      if (disposed || !host.current) return;
      const point = latestTarget.current;
      const instance = L.map(host.current, { center: point ? [point.latitude, point.longitude] : [14.6415, -61.0242], zoom: point ? 17 : 11, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
      map.current = instance;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', referrerPolicy: "strict-origin-when-cross-origin" })
        .on("tileerror", () => setMessage("Fond de carte indisponible. Vous pouvez saisir l’adresse ci-dessous."))
        .on("tileload", () => setMessage(""))
        .addTo(instance);
      instance.on("moveend", () => { const p = instance.getCenter(); latest.current({ latitude: p.lat, longitude: ((p.lng + 180) % 360 + 360) % 360 - 180 }); });
      observer = new ResizeObserver(() => instance.invalidateSize());
      observer.observe(host.current);
    }).catch(() => { if (!disposed) setMessage("La carte n’a pas pu charger. Saisissez l’adresse ci-dessous."); });
    return () => { disposed = true; observer?.disconnect(); map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => { if (target && map.current) map.current.setView([target.latitude, target.longitude], 17, { animate: false }); }, [target]);
  return <><div className={styles.mapFrame}><div ref={host} className={styles.map} role="region" aria-label="Carte du lieu d’intervention. Flèches pour déplacer, plus et moins pour zoomer." /><svg className={styles.pin} aria-hidden="true" viewBox="0 0 32 44"><path d="M16 42C13 36 2 25 2 16a14 14 0 1 1 28 0c0 9-11 20-14 26Z" fill="#2246e5" stroke="white" strokeWidth="2"/><circle cx="16" cy="16" r="5" fill="white"/></svg></div>{message && <p role="status">{message}</p>}</>;
}
