import { Keyboard, Linking, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import { z } from 'zod';
import { Action, Copy, Field } from '@/components/ui';
import BookingMap from '@/components/booking-map-dom';
import { ApiFailure, api } from '@/lib/api';
import { nearbyBanUrl, parseNearbyBan } from '../../../../shared/ban-nearby';
import { BOOKING_ADDRESS_COPY as copy, type BookingAddress, type BookingPoint } from '../../../../shared/booking-address';
import type { BookingLocation } from '../../../../shared/booking-location';
import { useBookingAddress } from '../../../../shared/use-booking-address';

const suggestions = z.object({ candidates: z.array(z.object({
  id: z.string(), label: z.string(), address: z.string().trim().min(1), postal_code: z.string().regex(/^\d{5}$/), city: z.string().trim().min(1),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
})).max(5) });
const lookup = {
  search: (query: string, signal: AbortSignal) => api(`/api/addresses/search?q=${encodeURIComponent(query)}`, suggestions, { signal }),
  async reverse({ latitude, longitude }: BookingPoint, signal: AbortSignal): Promise<BookingAddress | null> {
    try {
      const reply = await api(`/api/addresses/reverse?lat=${latitude}&lon=${longitude}`, suggestions, { signal });
      if (reply.candidates[0]) return reply.candidates[0];
    } catch (error) {
      if (signal.aborted || (error instanceof ApiFailure && error.status === 429)) throw error;
      // Older preview backends lack the WFS fallback. Use the same official BAN layer.
      const request = new AbortController();
      const abort = () => request.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 4000);
      try {
        const response = await fetch(nearbyBanUrl(latitude, longitude), { signal: request.signal, headers: { Accept: 'application/json' } });
        if (response.ok) {
          const match = parseNearbyBan(await response.json(), latitude, longitude)[0];
          if (match) return match;
        }
      } catch (issue) { if (signal.aborted) throw issue; }
      finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
    }
    // iOS and Android also provide a geocoder when the BAN has no usable point.
    if (!(await Location.getForegroundPermissionsAsync()).granted || signal.aborted) return null;
    const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
    const street = place?.street || place?.name;
    const postal = place?.postalCode;
    const city = place?.city || place?.subregion;
    return street && postal && /^\d{5}$/.test(postal) && city
      ? { address: place.streetNumber && place.street ? `${place.streetNumber} ${street}` : street, postal_code: postal, city }
      : null;
  },
};
async function locate() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error(copy.refused);
  try {
    const { coords: { latitude, longitude, accuracy } } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { latitude, longitude, accuracy };
  } catch { throw new Error(copy.gpsUnavailable); }
}

export function BookingLocationField({ value, location, onChange, disabled = false }: {
  value: BookingAddress;
  location?: BookingLocation;
  onChange(value: BookingAddress, location: BookingLocation): void;
  disabled?: boolean;
}) {
  const address = useBookingAddress({ value, location, onChange, lookup, locate });
  const canSearch = !disabled && !address.searching && address.query.trim().length >= 3;
  const find = () => { if (canSearch) { Keyboard.dismiss(); void address.find(); } };
  return <View style={styles.location}>
    <Field label={copy.search} value={address.query} maxLength={200} placeholder={copy.placeholder} editable={!disabled}
      onChangeText={address.changeQuery} onSubmitEditing={find} returnKeyType="search" />
    <Action secondary label={address.searching ? copy.finding : copy.find} disabled={!canSearch} onPress={find} />
    {address.searchMessage ? <Copy kind="muted">{address.searchMessage}</Copy> : null}
    {address.results.map(result => <Action key={result.id} secondary label={result.label} disabled={disabled} onPress={() => address.choose(result)} />)}
    <Action secondary label={address.busy === 'gps' ? copy.locating : copy.locate} disabled={disabled || address.busy === 'gps'}
      onPress={() => { Keyboard.dismiss(); void address.usePosition(); }} />
    <Copy kind="muted">{copy.mapHelp}</Copy>
    <BookingMap target={address.target} updatePoint={async point => { if (!disabled) address.move(point); }} dom={{
      useExpoDOMWebView: false, style: styles.map, matchContents: true, scrollEnabled: false,
      userAgent: 'DomDepannage/0.1',
      onOpenWindow: ({ nativeEvent }) => {
        if (nativeEvent.targetUrl === 'https://www.openstreetmap.org/copyright') void Linking.openURL(nativeEvent.targetUrl).catch(() => {});
      },
    }} />
    {address.busy === 'reverse' || address.pointMessage ? <Copy kind="muted">{address.busy === 'reverse' ? 'Recherche de l’adresse du repère…' : address.pointMessage}</Copy> : null}
    {address.candidate && <Copy kind="muted">{address.candidate.address}, {address.candidate.postal_code} {address.candidate.city}</Copy>}
    {address.pendingPoint && <Action secondary label={copy.confirmPoint} disabled={disabled || Boolean(address.busy)} onPress={address.confirmPoint} />}
    <Field label={copy.street} value={value.address} onChangeText={street => address.edit({ ...value, address: street })} placeholder="Numéro et nom de rue" maxLength={250} editable={!disabled} />
    <Field label={copy.postal} value={value.postal_code} onChangeText={postal_code => address.edit({ ...value, postal_code })} keyboardType="numeric" maxLength={5} editable={!disabled} />
    <Field label={copy.city} value={value.city} onChangeText={city => address.edit({ ...value, city })} maxLength={120} editable={!disabled} />
    <Field label={copy.access} value={address.current.access_details} onChangeText={address.editAccess} maxLength={1000}
      placeholder={copy.accessPlaceholder} multiline editable={!disabled} returnKeyType="done" submitBehavior="blurAndSubmit" />
  </View>;
}
const styles = StyleSheet.create({
  location: { gap: 12 },
  map: { width: '100%', minHeight: 262, backgroundColor: 'transparent' },
});
