export type Role = 'client' | 'artisan' | 'manager' | 'admin';
export type InterventionStatus = 'requested' | 'assigned' | 'quoted' | 'accepted' | 'in_progress' | 'completed' | 'paid' | 'cancelled';
export type InterventionAction = 'accept_mission' | 'send_quote' | 'accept_quote' | 'start' | 'complete' | 'cancel';

// Initial indicative ranges derived from the provided mockups, not contractual tariffs.
export const CATEGORIES = [
  { id: 'outage', label: 'Panne générale', min: 15000, max: 25000 },
  { id: 'panel', label: 'Tableau électrique', min: 15000, max: 35000 },
  { id: 'socket', label: 'Prise ou interrupteur', min: 8000, max: 18000 },
  { id: 'lighting', label: 'Éclairage', min: 8000, max: 20000 },
  { id: 'diagnostic', label: 'Recherche de panne', min: 12000, max: 28000 },
] as const;
export type Category = typeof CATEGORIES[number]['id'];
export interface QuoteLine { label: string; quantity: number; unit_price_cents: number }
export interface QuoteTotals { subtotal_cents: number; tax_cents: number; total_cents: number }
export function calculateQuote(lines: QuoteLine[], taxRate: number): QuoteTotals {
  if (!lines.length || lines.length > 30 || ![0, 5.5, 10, 20].includes(taxRate)) throw new Error('Devis invalide.');
  let subtotal = 0;
  for (const line of lines) {
    if (!line.label.trim() || line.label.length > 160 || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000 || !Number.isSafeInteger(line.unit_price_cents) || line.unit_price_cents < 0 || line.unit_price_cents > 10000000) throw new Error('Ligne de devis invalide.');
    subtotal += line.quantity * line.unit_price_cents;
  }
  const tax = Math.round(subtotal * taxRate / 100);
  if (subtotal < 1 || subtotal + tax > 10000000) throw new Error('Montant du devis hors limites.');
  return { subtotal_cents: subtotal, tax_cents: tax, total_cents: subtotal + tax };
}
export function canTransition(status: InterventionStatus, action: InterventionAction, role: Role): boolean {
  if (action === 'accept_mission') return role === 'artisan' && status === 'requested';
  if (action === 'send_quote') return role === 'artisan' && (status === 'assigned' || status === 'quoted');
  if (action === 'accept_quote') return (role === 'client' || role === 'manager') && status === 'quoted';
  if (action === 'start') return role === 'artisan' && status === 'accepted';
  if (action === 'complete') return role === 'artisan' && status === 'in_progress';
  if (action === 'cancel') return (role === 'client' || role === 'manager') && ['requested', 'assigned', 'quoted'].includes(status);
  return false;
}
export function verifyPayment(expected: { total_cents: number; session_id: string; quote_id: string }, received: { amount_total: number | null; currency: string | null; id: string; payment_status: string; quote_id?: string }): boolean {
  return received.payment_status === 'paid' && received.currency === 'eur' && received.amount_total === expected.total_cents && received.id === expected.session_id && received.quote_id === expected.quote_id;
}
