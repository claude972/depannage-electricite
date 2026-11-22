'use dom';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import BookingMap from '../../../../shared/booking-map';
import type { BookingMapTarget, BookingPoint } from '../../../../shared/booking-address';

export default function BookingMapDom({ target, updatePoint, ready }: {
  target: BookingMapTarget | null;
  updatePoint(point: BookingPoint): Promise<void>;
  /** Appelé une fois la carte montée dans la vue web : sans ce signal, l’écran natif affiche un repli. */
  ready(): Promise<void>;
  dom?: import('expo/dom').DOMProps;
}) {
  useEffect(() => { void ready?.(); }, []);
  return <>
    <style>{"body{margin:0;color:#4b5563;font:14px system-ui,sans-serif}"}</style>
    <BookingMap target={target} onMove={point => { void updatePoint(point); }} />
  </>;
}
