// Informations publiées par l’exploitant, lues par l’aide mobile : zone par code postal, profil,
// contact, conditions de garantie. Les schémas sont construits depuis la description commune au Web
// (shared/public-contract.ts) ; rien n’est déduit ni complété quand une information manque.
// Module sans React Native : le contrôle de frontière du dépôt l’importe tel quel.
import { z } from 'zod';
import {
  COVERAGE, EMAIL_PATTERN, MAX_VERSION, OPERATOR_PROFILE_FIELDS, OPERATOR_PROFILE_REQUIRED, POSTAL_CODE_PATTERN,
  PUBLIC_PATHS, WARRANTY_TERMS, siretMatchesSiren, type FieldRule, type OperatorProfileField,
} from '../../../../shared/public-contract';

export { PUBLIC_PATHS };

// ---- Schémas -----------------------------------------------------------------------------------
const fieldSchema = (rule: FieldRule) => {
  if (rule.kind === 'code') return z.string().regex(new RegExp(rule.pattern));
  const text = z.string().trim().min(1).max(rule.max);
  return rule.kind === 'email' ? text.regex(new RegExp(EMAIL_PATTERN)) : text;
};
const profileShape = Object.fromEntries(
  (Object.keys(OPERATOR_PROFILE_FIELDS) as OperatorProfileField[]).map(key => [key, fieldSchema(OPERATOR_PROFILE_FIELDS[key]).optional()]),
) as Record<OperatorProfileField, z.ZodOptional<z.ZodString>>;
// Un champ inconnu est ignoré (une application déjà installée survit à un ajout facultatif côté
// Web) ; un champ connu mal formé rend toute la publication illisible : rien n’est affiché à moitié.
export const operatorProfileSchema = z.object(profileShape)
  .refine(profile => profile.siret === undefined || siretMatchesSiren(profile.siret, profile.siren));
export type OperatorProfile = z.infer<typeof operatorProfileSchema>;

const publishedAt = z.iso.datetime({ offset: true });
export const operatorPublicationSchema = z.object({
  published: z.object({ version: z.number().int().positive(), profile: operatorProfileSchema, published_at: publishedAt })
    .refine(({ profile }) => OPERATOR_PROFILE_REQUIRED.every(field => Boolean(profile[field])))
    .nullable(),
});
export const warrantyTermsSchema = z.object({
  published: z.object({
    version: z.number().int().min(1).max(MAX_VERSION),
    title: z.string().min(1).max(WARRANTY_TERMS.titleMax),
    body: z.string().min(1).max(WARRANTY_TERMS.bodyMax),
    published_at: publishedAt,
  }).nullable(),
});
export const coverageSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal(COVERAGE.unpublished), version: z.null() }),
  z.object({ status: z.enum(COVERAGE.published), version: z.number().int().positive() }),
]);
export type Coverage = z.infer<typeof coverageSchema>;

// ---- États de lecture ----------------------------------------------------------------------------
/** « absent » : le service a répondu qu’aucune publication n’existe — distinct d’une panne. */
export type Published<T> = { phase: 'loading' } | { phase: 'error' } | { phase: 'absent' } | { phase: 'published'; value: T };
export function publishedState<T>(read: { data: { published: T | null } | null; error: string | null; loading: boolean }): Published<T> {
  if (read.data) return read.data.published === null ? { phase: 'absent' } : { phase: 'published', value: read.data.published };
  return read.loading && !read.error ? { phase: 'loading' } : { phase: 'error' };
}
export function publishedStamp(publication: { version: number; published_at: string }) {
  const day = new Date(publication.published_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Publié par l’exploitant le ${day} (version ${publication.version}).`;
}

// ---- Zone par code postal ------------------------------------------------------------------------
const postalCode = new RegExp(POSTAL_CODE_PATTERN);
export const isPostalCode = (value: string) => postalCode.test(value);
/** Chemin de la vérification, ou null tant que la saisie n’est pas un code postal (aucun appel). */
export const coveragePath = (code: string) => (isPostalCode(code) ? `${PUBLIC_PATHS.coverage}?postal_code=${code}` : null);
export const COVERAGE_COPY = {
  intro: 'Indiquez un code postal pour savoir s’il figure dans la liste publiée par l’exploitant.',
  invalid: 'Saisissez un code postal de cinq chiffres.',
  failed: 'La vérification n’a pas abouti. Réessayez.',
  informative: 'Cette information porte sur la liste publiée : elle n’engage ni la disponibilité d’un artisan, ni un délai d’intervention, et ne bloque jamais le dépôt d’une demande.',
} as const;
/** Libellé court et phrase complète de chaque statut (mêmes formulations que le Web). */
export function coverageResult(code: string, result: Coverage): { label: string; message: string } {
  if (result.status === 'covered') return { label: 'Dans la zone publiée', message: `Le code postal ${code} figure dans la zone publiée par l’exploitant.` };
  if (result.status === 'not_covered') return { label: 'Hors de la zone publiée', message: `Le code postal ${code} ne figure pas dans la zone publiée par l’exploitant. Vous pouvez tout de même déposer une demande.` };
  return { label: 'Zone non publiée', message: 'L’exploitant n’a pas encore publié la liste des codes postaux desservis. Vous pouvez déposer une demande.' };
}

// ---- Exploitant et contact -----------------------------------------------------------------------
export type Row = { label: string; value: string };
/** Identité légale : uniquement les valeurs publiées, dans l’ordre des mentions du Web. */
export function operatorRows(profile: OperatorProfile): Row[] {
  const rows: Row[] = [];
  const add = (label: string, value: string | undefined) => { if (value) rows.push({ label, value }); };
  add('Nom du service', profile.display_name);
  add('Raison sociale et forme juridique', [profile.legal_name, profile.legal_form].filter(Boolean).join(', ') || undefined);
  add('SIREN', profile.siren);
  add('SIRET de l’établissement', profile.siret);
  add('TVA intracommunautaire', profile.vat_number);
  add('Adresse du siège', profile.hq_address);
  add('Direction de la publication', profile.publication_director);
  return rows;
}
export type Channel = Row & { action: string; url: string };
const mailto = (address: string) => `mailto:${encodeURIComponent(address).replace(/%40/g, '@')}`;
/** Canaux réellement publiés ; le téléphone est facultatif et n’apparaît que s’il est publié. */
export function contactChannels(profile: OperatorProfile): Channel[] {
  const channels: Channel[] = [];
  if (profile.public_email) channels.push({ label: 'Adresse e-mail de contact', value: profile.public_email, action: 'Écrire à l’exploitant', url: mailto(profile.public_email) });
  if (profile.public_phone) channels.push({ label: 'Téléphone', value: profile.public_phone, action: 'Appeler l’exploitant', url: `tel:${profile.public_phone}` });
  if (profile.privacy_email) channels.push({ label: 'Données personnelles', value: profile.privacy_email, action: 'Écrire au sujet de mes données', url: mailto(profile.privacy_email) });
  return channels;
}
