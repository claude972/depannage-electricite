// Adresses enregistrées du client (CLI-09) : même contrat que le Web
//   GET  /api/profile/addresses → { records, page:{limit:50,count,complete:true}, permissions:{can_write} }
//   POST /api/profile/addresses { action:'save', id, command_id, expected_version, values } | { action:'archive', id, command_id, expected_version } → { record }
// Module sans React Native.
import { z } from 'zod';

export const ADDRESS_PATH = '/api/profile/addresses';
export const ADDRESS_LIMIT = 50;
const id = z.uuid();
export const addressRecord = z.object({
  id, user_id: id, label: z.string(), first_name: z.string(), last_name: z.string(), address: z.string(),
  postal_code: z.string(), city: z.string(), country_code: z.string(),
  latitude: z.number().nullable(), longitude: z.number().nullable(),
  geo_source: z.enum(['manual_pin', 'device_reported', 'geocoder_selected']).nullable(),
  is_preferred: z.boolean(), version: z.number().int().positive(), archived_at: z.string().nullable(),
});
export type ClientAddress = z.infer<typeof addressRecord>;
export const addressList = z.object({
  records: z.array(addressRecord).max(ADDRESS_LIMIT),
  page: z.object({ limit: z.number().int(), count: z.number().int().nonnegative(), complete: z.literal(true) }),
  permissions: z.object({ can_write: z.boolean() }),
}).refine(list => list.records.length === list.page.count && list.records.filter(record => record.is_preferred).length <= 1
  && list.records.every(record => record.archived_at === null));
export const addressSaved = z.object({ record: addressRecord });

export type AddressForm = { label: string; first_name: string; last_name: string; address: string; postal_code: string; city: string; is_preferred: boolean };
export type AddressField = Exclude<keyof AddressForm, 'is_preferred'>;
export const emptyAddressForm = (first = '', last = ''): AddressForm =>
  ({ label: '', first_name: first, last_name: last, address: '', postal_code: '', city: '', is_preferred: false });
export const addressFormOf = (record: ClientAddress): AddressForm => ({
  label: record.label, first_name: record.first_name, last_name: record.last_name, address: record.address,
  postal_code: record.postal_code, city: record.city, is_preferred: record.is_preferred,
});
// Mêmes bornes et mêmes messages que le formulaire Web (lib/features/client-addresses/schemas.ts).
const text = (min: number, max: number, message: string) =>
  z.string().trim().min(min, message).max(max, message).refine(value => !/[\u0000-\u001f\u007f]/.test(value), message);
const formSchema = z.object({
  label: text(1, 100, 'Nom de l’adresse : 1 à 100 caractères.'),
  first_name: text(1, 100, 'Prénom : 1 à 100 caractères.'),
  last_name: text(1, 100, 'Nom : 1 à 100 caractères.'),
  address: text(5, 500, 'Adresse complète : 5 à 500 caractères (numéro et voie).'),
  postal_code: z.string().trim().regex(/^[0-9]{5}$/, 'Le code postal doit comporter cinq chiffres.'),
  city: text(1, 160, 'Ville : 1 à 160 caractères.'),
  is_preferred: z.boolean(),
});
export type AddressValues = z.infer<typeof formSchema> & {
  country_code: string; latitude: number | null; longitude: number | null; geo_source: ClientAddress['geo_source'];
};
/**
 * Valeurs exactes de la commande. La position déclarée d’une adresse existante est conservée tant que
 * la voie, le code postal et la ville ne changent pas ; elle est retirée sinon (jamais inventée).
 */
export function addressValues(form: AddressForm, current: ClientAddress | null):
  { values: AddressValues } | { field: AddressField; message: string } {
  const parsed = formSchema.safeParse(form);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { field: String(issue.path[0]) as AddressField, message: issue.message };
  }
  const same = current && current.address === parsed.data.address && current.postal_code === parsed.data.postal_code && current.city === parsed.data.city;
  return { values: {
    ...parsed.data, country_code: current?.country_code ?? 'FR',
    latitude: same ? current.latitude : null, longitude: same ? current.longitude : null, geo_source: same ? current.geo_source : null,
  } };
}
export const preferredValues = (record: ClientAddress, preferred: boolean): AddressValues => ({
  label: record.label, first_name: record.first_name, last_name: record.last_name, address: record.address,
  postal_code: record.postal_code, city: record.city, country_code: record.country_code,
  latitude: record.latitude, longitude: record.longitude, geo_source: record.geo_source, is_preferred: preferred,
});
export const orderedAddresses = (records: ClientAddress[]) =>
  [...records].sort((a, b) => Number(b.is_preferred) - Number(a.is_preferred) || a.label.localeCompare(b.label, 'fr'));
