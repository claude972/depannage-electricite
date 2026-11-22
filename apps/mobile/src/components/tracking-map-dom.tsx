'use dom';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { LayerGroup, Map } from 'leaflet';

export type TrackingMapPoint = { latitude: number; longitude: number };
/**
 * Carte de suivi (CLI-05) : dernière position partagée, destination confirmée et, s’il est disponible, tracé IGN.
 * Lecture seule ; seules les valeurs reçues en propriétés sont dessinées, aucune position passée n’est conservée.
 */
export default function TrackingMapDom({ position, accuracy, destination, line, ready }: {
  position: TrackingMapPoint | null;
  accuracy: number | null;
  destination: TrackingMapPoint | null;
  line: [number, number][] | null;
  /** Appelé une fois la carte montée dans la vue web : sans ce signal, l’écran natif affiche un repli. */
  ready(): Promise<void>;
  dom?: import('expo/dom').DOMProps;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null), layer = useRef<LayerGroup | null>(null), leaflet = useRef<typeof import('leaflet') | null>(null);
  const [mounted, setMounted] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void import('leaflet').then(L => {
      if (disposed || !host.current) return;
      const instance = L.map(host.current, { center: [14.64, -61.02], zoom: 11, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors', referrerPolicy: 'strict-origin-when-cross-origin' })
        .on('tileerror', () => !disposed && setMessage('Fond de carte indisponible : les repères restent positionnés.'))
        .on('tileload', () => !disposed && setMessage(''))
        .addTo(instance);
      map.current = instance; layer.current = L.layerGroup().addTo(instance); leaflet.current = L;
      observer = new ResizeObserver(() => { if (!disposed) instance.invalidateSize(); });
      observer.observe(host.current);
      setMounted(true);
      void ready?.();
    }).catch(() => { if (!disposed) setMessage('La carte n’a pas pu charger.'); });
    return () => { disposed = true; observer?.disconnect(); map.current?.remove(); map.current = null; layer.current = null; };
  }, []);
  const key = JSON.stringify([position, accuracy, destination, line?.length, line?.[0], line?.at(-1)]);
  useEffect(() => {
    const L = leaflet.current, instance = map.current, group = layer.current;
    if (!mounted || !L || !instance || !group) return;
    group.clearLayers();
    const bounds: [number, number][] = [];
    if (line && line.length > 1) { L.polyline(line, { color: '#2246e5', weight: 4, opacity: 0.75 }).addTo(group); bounds.push(...line); }
    if (destination) {
      const at: [number, number] = [destination.latitude, destination.longitude];
      L.marker(at, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [28, 38], iconAnchor: [14, 38], html: '<svg aria-hidden="true" width="28" height="38" viewBox="0 0 32 44"><path d="M16 42C13 36 2 25 2 16a14 14 0 1 1 28 0c0 9-11 20-14 26Z" fill="#b93a0a" stroke="white" stroke-width="2"/><circle cx="16" cy="16" r="5" fill="white"/></svg>' }) }).addTo(group);
      bounds.push(at);
    }
    if (position) {
      const at: [number, number] = [position.latitude, position.longitude];
      if (accuracy && accuracy > 0) L.circle(at, { radius: accuracy, color: '#2246e5', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(group);
      L.circleMarker(at, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2246e5', fillOpacity: 1, interactive: false }).addTo(group);
      bounds.push(at);
    }
    if (bounds.length === 1) instance.setView(bounds[0], 16, { animate: false });
    else if (bounds.length > 1) instance.fitBounds(bounds, { padding: [36, 36], maxZoom: 17, animate: false });
  }, [mounted, key]);
  return <>
    <style>{'body{margin:0;color:#4b5563;font:13px system-ui,sans-serif}.leaflet-control-zoom a{min-width:44px;min-height:44px;line-height:44px}.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:6px 2px 0}.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px}'}</style>
    {/* Un seul bloc en pleine largeur : la racine de la vue web aligne ses enfants en ligne. */}
    <div style={{ width: '100%', minWidth: '100%' }}>
    <div style={{ border: '1px solid #cbd5e1', borderRadius: 12, overflow: 'hidden' }}>
      <div ref={host} role="region" aria-label="Carte du suivi : position partagée de l’artisan et destination." style={{ height: 240, width: '100%', background: '#e8edf2' }} />
    </div>
    <p className="legend" aria-hidden="true">
      {position && <span><i style={{ background: '#2246e5' }} />Artisan (dernière position partagée)</span>}
      {destination && <span><i style={{ background: '#b93a0a' }} />Destination</span>}
    </p>
    {message && <p role="status" style={{ margin: '4px 2px 0' }}>{message}</p>}
    </div>
  </>;
}
