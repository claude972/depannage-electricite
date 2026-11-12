import type { BookingLocation } from './booking-location';

export type BookingPoint = { latitude: number; longitude: number };
export type BookingMapTarget = BookingPoint & { revision: number };
export type BookingAddress = { address: string; postal_code: string; city: string };
export type BookingAddressCandidate = BookingPoint & BookingAddress & { id: string; label: string };

export const BOOKING_MAP_CENTER: BookingPoint = { latitude: 14.6415, longitude: -61.0242 };
export const EMPTY_BOOKING_LOCATION: BookingLocation = { latitude: null, longitude: null, access_details: '' };
export const BOOKING_ADDRESS_COPY = {
  search: 'Rechercher une adresse',
  placeholder: 'Rue, quartier, commune',
  find: 'Rechercher',
  finding: 'Recherche…',
  locate: 'Ma position',
  locating: 'Localisation en cours…',
  confirmPoint: 'Confirmer ce repère',
  mapHelp: 'Déplacez la carte sous le repère pour indiquer l’entrée.',
  street: 'Adresse d’intervention',
  postal: 'Code postal',
  city: 'Commune',
  access: 'Complément d’accès (facultatif)',
  accessPlaceholder: 'Bâtiment, étage, entrée, indications pour trouver le lieu…',
  filled: 'Adresse renseignée. Vous pouvez la corriger dans les champs ci-dessous.',
  noAddress: 'Aucune adresse trouvée ici. Saisissez votre adresse manuellement.',
  unavailable: 'Recherche d’adresse indisponible. Vous pouvez saisir votre adresse manuellement.',
  refused: 'Accès à la position refusé. Recherchez votre adresse ou saisissez-la manuellement.',
  gpsUnavailable: 'Position indisponible. Recherchez votre adresse ou saisissez-la manuellement.',
  imprecise: 'Position imprécise. Déplacez le repère si nécessaire et vérifiez les champs.',
  confirmed: 'Repère confirmé. Vérifiez les détails de l’adresse ci-dessous.',
} as const;

export function bookingAddressFields({ address, postal_code, city }: BookingAddress): BookingAddress {
  return { address, postal_code, city };
}

export function bookingLocationForPoint(point: BookingPoint, location: BookingLocation): BookingLocation {
  return { latitude: point.latitude, longitude: point.longitude, access_details: location.access_details };
}
