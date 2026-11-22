import { z } from 'zod';
import { bookingLocation } from './booking-location';

export const categories = {
  outage: 'Coupure de courant',
  panel: 'Tableau électrique',
  socket: 'Prise ou interrupteur',
  lighting: 'Éclairage',
  diagnostic: 'Diagnostic électrique',
} as const;
export const category = z.enum(['outage', 'panel', 'socket', 'lighting', 'diagnostic']);
export type Category = z.infer<typeof category>;
export const statuses = {
  requested: 'Demande transmise', assigned: 'Artisan affecté', quoted: 'Devis envoyé',
  accepted: 'Devis accepté', in_progress: 'En cours', completed: 'Terminée',
  paid: 'Réglée', cancelled: 'Annulée',
} as const;
const status = z.enum(['requested', 'assigned', 'quoted', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled']);
const cents = z.number().int().nonnegative();
const name = z.string().trim().min(1).max(120);
const id = z.uuid();
export const job = z.object({
  id, category, status, description: z.string().optional(), city: z.string(),
  address: z.string().nullish(), postal_code: z.string().nullish(),
  client_id: id.nullish(), artisan_id: id.nullish(), site_id: id.nullish(), urgency: z.enum(['urgent', 'scheduled']),
  estimate_min_cents: cents, estimate_max_cents: cents,
  created_at: z.string(),
});
export type Job = z.infer<typeof job>;
export const quoteSummary = z.object({
  id, intervention_id: id, status: z.enum(['sent', 'accepted', 'rejected']),
  total_cents: cents, accepted_total_cents: cents.optional(), created_at: z.string().optional(),
});
export type QuoteSummary = z.infer<typeof quoteSummary>;
const quote = quoteSummary.extend({
  id, intervention_id: id, status: z.enum(['sent', 'accepted', 'rejected']),
  lines: z.array(z.object({label: z.string(), quantity: z.number().int().positive(), unit_price_cents: cents})),
  // Détail HT/TVA du devis lui-même ; absent des réponses plus anciennes.
  subtotal_cents: cents.optional(), tax_rate: z.coerce.number().min(0).max(100).optional().catch(undefined), tax_cents: cents.optional(),
  total_cents: cents, accepted_total_cents: cents.optional(),
});
const attachment = z.object({id, name: z.string(), mime_type: z.string(), owner_id: id.nullish(), created_at: z.string().nullish()});
const message = z.object({id, author_id: id, body: z.string(), created_at: z.string(), attachment_id: id.nullish()});
export const payment = z.object({id, quote_id: id.optional(), total_cents: cents, status: z.enum(['pending','paid','failed']), method: z.enum(['stripe','on_site_declared']).optional(), paid_at: z.string().nullish(), created_at: z.string().optional()});
export type Payment = z.infer<typeof payment>;
// ART-11 : part de l’artisan sur un règlement par carte, lue sur GET /api/payments/status (champ
// facultatif réservé à l’auteur du devis). Rien n’est recalculé ici : un rapport absent, illisible ou
// incohérent au centime donne `undefined` et l’écran garde le seul montant réglé.
const artisanSettlement = z.object({
  amount_cents: cents.positive(), fee_bps: z.number().int().min(0).max(9999), fee_cents: cents, net_cents: cents,
  transfer: z.enum(['with_payment','confirmed']),
}).refine(item => item.fee_cents + item.net_cents === item.amount_cents);
export type ArtisanSettlement = z.infer<typeof artisanSettlement>;
export const paymentSettlement = z.object({ artisan_settlement: artisanSettlement.optional().catch(undefined) });
/** Taux figé sur le règlement, en points de base : 1000 → « 10 % », 1250 → « 12,5 % ». */
export const commissionRate = (bps: number) => `${String(bps / 100).replace('.', ',')} %`;
/** Même formulation que le web : le virement bancaire suit le calendrier de Stripe, sans confirmation de la plateforme. */
export const settlementPayout = (transfer: ArtisanSettlement['transfer']) =>
  (transfer === 'confirmed'
    ? 'Le transfert de votre part nette vers votre compte de règlement Stripe est confirmé par la plateforme.'
    : 'Votre part nette est transférée par Stripe sur votre compte de règlement dans le cadre de ce paiement (transfert automatique).')
  + ' Le virement vers votre compte bancaire suit ensuite le calendrier de versement de Stripe ; la plateforme ne le confirme pas ici.';
const list = <T extends z.ZodType>(schema: T) => z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), items: z.array(schema), limited: z.boolean(), incomplete: z.boolean().optional() }),
  z.object({ status: z.literal('error') }),
]);
export const workspace = z.object({
  profile: z.object({id, role: z.enum(['client', 'artisan', 'manager', 'admin']), full_name: z.string(), first_name: z.string().nullish(), last_name: z.string().nullish(), phone: z.string().nullish(), artisan_approved: z.boolean()}),
  interventions: z.array(job),
  organizations: z.array(z.object({id, name: z.string(), owner_id: id, created_at: z.string()})).optional(),
  quotes: z.array(quoteSummary).optional(),
  payments: z.array(payment).optional(),
  limits: z.object({interventions: z.object({limited: z.boolean()}), quotes: z.object({limited: z.boolean()}).optional(), organizations: z.object({limited: z.boolean()}).optional()}).optional(),
});
export const detail = z.object({
  intervention: job,
  quotes: list(quote),
  documents: list(attachment),
  payments: list(payment),
  booking_location: bookingLocation.nullish(),
});
const participant = z.object({ id, full_name: z.string().nullish(), phone: z.string().nullish(), role: z.string() });
export type Participant = z.infer<typeof participant>;
/** Participants réels du dossier (client et artisan attribué) ; une liste illisible est ignorée. */
export const participants = z.array(participant).nullish().catch(null);
export const participantsView = z.object({ participants });
export const phoneHref = (phone: string) => 'tel:' + phone.replace(/[^+\d]/g, '');
export const operations = z.object({
  participants,
  travel_stage: z.enum(['planned','en_route','on_site']),
  appointment: z.object({starts_at: z.iso.datetime({ offset: true }), ends_at: z.iso.datetime({ offset: true }), reminder_version: z.number().int().positive(), note: z.string().optional(), updated_by: id.nullish().catch(null), updated_at: z.string().nullish().catch(null)}).nullable(),
  // Instantanés serveur des créneaux et comptes rendus successifs (les plus récents d’abord) ; illisible → ignoré.
  history: z.array(z.object({ id: z.number(), actor_id: id, kind: z.string(), payload: z.unknown(), created_at: z.string() })).optional().catch(undefined),
  report_evidence_required: z.boolean(),
  report: z.object({summary: z.string(), signature_name: z.string(), report_revision: id.nullish(), before_photo_id: id.nullish(), after_photo_id: id.nullish()}).nullable(),
  report_receipt: z.object({signed_at: z.string(), signature_name: z.string()}).nullable(),
});
const range = z.object({min_cents: cents, max_cents: cents}).refine(item => item.min_cents <= item.max_cents);
export const prices = z.object({version: z.number().int().positive(), ranges: z.record(category, range), indicative: z.literal(true)});
export const creation = z.object({intervention: z.object({id})});
export const success = z.object({success: z.literal(true)});
export const sent = z.object({message: z.object({id})});
export const fileSaved = z.object({document: z.object({id})});
export const link = z.object({url: z.url()});
export const history = z.object({messages: z.array(message), page: z.object({next_cursor:z.string().nullable()})});
export const requestFields = z.object({
  category, description: z.string().trim().min(10, 'Décrivez la panne en au moins 10 caractères.').max(4000),
  address: z.string().trim().min(5, 'Renseignez l’adresse d’intervention.').max(500),
  postal_code: z.string().regex(/^\d{5}$/, 'Renseignez un code postal à cinq chiffres.'),
  city: z.string().trim().min(2, 'Renseignez la commune.').max(120),
  urgency: z.enum(['urgent','scheduled']),
});
export const signature = name.min(2, 'Saisissez vos nom et prénom.');
export const euros = (value: number) => new Intl.NumberFormat('fr-FR', {style:'currency',currency:'EUR'}).format(value / 100);
export const timestamp = (value: string) => new Date(value).toLocaleString('fr-FR', {dateStyle:'medium',timeStyle:'short',timeZone:'America/Martinique'});
