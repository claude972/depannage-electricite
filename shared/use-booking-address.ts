import { useEffect, useRef, useState } from 'react';
import { BOOKING_ADDRESS_COPY as copy, EMPTY_BOOKING_LOCATION, bookingAddressFields, bookingLocationForPoint, type BookingAddress, type BookingAddressCandidate, type BookingPoint } from './booking-address';
import type { BookingLocation } from './booking-location';

type Locate = () => Promise<BookingPoint & { accuracy: number | null }>;
type Lookup = {
  search(query: string, signal: AbortSignal): Promise<{ candidates: BookingAddressCandidate[] }>;
  reverse(point: BookingPoint, signal: AbortSignal): Promise<BookingAddress | null>;
};

export function useBookingAddress({ value, location, onChange, lookup, locate }: {
  value: BookingAddress;
  location?: BookingLocation;
  onChange(value: BookingAddress, location: BookingLocation): void;
  lookup: Lookup;
  locate: Locate;
}) {
  const current = location ?? EMPTY_BOOKING_LOCATION;
  const latest = useRef({ value, current, onChange });
  latest.current = { value, current, onChange };
  const [target, setTarget] = useState<BookingPoint | null>(() => current.latitude !== null && current.longitude !== null ? { latitude: current.latitude, longitude: current.longitude } : null);
  const [pendingPoint, setPendingPoint] = useState<BookingPoint | null>(null);
  const [candidate, setCandidate] = useState<BookingAddress | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookingAddressCandidate[]>([]);
  const [searchMessage, setSearchMessage] = useState('');
  const [pointMessage, setPointMessage] = useState('');
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<'gps' | 'reverse' | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const pointRequest = useRef<AbortController | null>(null);
  const mapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    searchRequest.current?.abort();
    pointRequest.current?.abort();
    clearTimeout(mapTimer.current);
  }, []);

  function apply(address: BookingAddress, point: BookingPoint) {
    const { current, onChange } = latest.current;
    onChange(bookingAddressFields(address), bookingLocationForPoint(point, current));
    setPendingPoint(null);
    setCandidate(null);
  }

  function preparePoint(point: BookingPoint) {
    pointRequest.current?.abort();
    clearTimeout(mapTimer.current);
    const controller = new AbortController();
    pointRequest.current = controller;
    setPendingPoint(point);
    setCandidate(null);
    setPointMessage('');
    setBusy('reverse');
    return controller;
  }

  async function reverse(point: BookingPoint, controller: AbortController, accuracy?: number | null) {
    try {
      const found = await lookup.reverse(point, controller.signal);
      if (controller.signal.aborted) return;
      if (!found) setPointMessage(copy.noAddress);
      else if (accuracy !== undefined) {
        if (accuracy !== null && accuracy > 100) {
          const { current, onChange } = latest.current;
          onChange(bookingAddressFields(found), { ...EMPTY_BOOKING_LOCATION, access_details: current.access_details });
          setPointMessage(copy.imprecise);
        } else {
          apply(found, point);
          setPointMessage(copy.filled);
        }
      } else setCandidate(found);
    } catch {
      if (!controller.signal.aborted) setPointMessage(copy.unavailable);
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  function move(point: BookingPoint) {
    const controller = preparePoint(point);
    mapTimer.current = setTimeout(() => { void reverse(point, controller); }, 500);
  }

  async function usePosition() {
    pointRequest.current?.abort();
    clearTimeout(mapTimer.current);
    const controller = new AbortController();
    pointRequest.current = controller;
    setCandidate(null);
    setPendingPoint(null);
    setPointMessage('');
    setBusy('gps');
    try {
      const { latitude, longitude, accuracy } = await locate();
      if (controller.signal.aborted) return;
      const point = { latitude, longitude };
      setTarget(point);
      setPendingPoint(point);
      setBusy('reverse');
      await reverse(point, controller, accuracy);
    } catch (error) {
      if (!controller.signal.aborted) {
        setPointMessage(error instanceof Error ? error.message : copy.gpsUnavailable);
        setBusy(null);
      }
    }
  }

  function changeQuery(text: string) {
    searchRequest.current?.abort();
    setSearching(false);
    setResults([]);
    setSearchMessage('');
    setQuery(text);
  }

  async function find() {
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    setResults([]);
    setSearchMessage('');
    try {
      const { candidates } = await lookup.search(query.trim(), controller.signal);
      if (controller.signal.aborted) return;
      setResults(candidates);
      setSearchMessage(candidates.length ? '' : 'Aucune adresse trouvée. Précisez la commune ou saisissez l’adresse manuellement.');
    } catch {
      if (!controller.signal.aborted) setSearchMessage(copy.unavailable);
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  function choose(result: BookingAddressCandidate) {
    pointRequest.current?.abort();
    clearTimeout(mapTimer.current);
    setResults([]);
    setBusy(null);
    const point = { latitude: result.latitude, longitude: result.longitude };
    setTarget(point);
    apply(result, point);
    setPointMessage(copy.filled);
  }

  function confirmPoint() {
    if (!pendingPoint || busy) return;
    apply(candidate ?? latest.current.value, pendingPoint);
    setPointMessage(candidate ? copy.filled : copy.confirmed);
  }

  function edit(next: BookingAddress) {
    pointRequest.current?.abort();
    clearTimeout(mapTimer.current);
    setBusy(null);
    setCandidate(null);
    setPointMessage('');
    const { current, onChange } = latest.current;
    onChange(next, { ...EMPTY_BOOKING_LOCATION, access_details: current.access_details });
  }

  function editAccess(access_details: string) {
    const { value, current, onChange } = latest.current;
    onChange(value, { ...current, access_details });
  }

  return { current, target, pendingPoint, candidate, query, results, searchMessage, pointMessage, searching, busy, move, usePosition, changeQuery, find, choose, confirmPoint, edit, editAccess };
}
