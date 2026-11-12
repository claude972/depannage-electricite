'use dom';
import 'leaflet/dist/leaflet.css';
import BookingMap from '../../../../shared/booking-map';
import type { BookingMapTarget, BookingPoint } from '../../../../shared/booking-address';

export default function BookingMapDom({ target, updatePoint }: {
  target: BookingMapTarget | null;
  updatePoint(point: BookingPoint): Promise<void>;
  dom?: import('expo/dom').DOMProps;
}) {
  return <>
    <style>{"body{margin:0;color:#4b5563;font:14px system-ui,sans-serif}"}</style>
    <BookingMap target={target} onMove={point => { void updatePoint(point); }} />
  </>;
}
