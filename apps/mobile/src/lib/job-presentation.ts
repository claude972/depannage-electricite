import { euros, statuses, type Job, type Payment, type QuoteSummary } from './contracts';
export type Role = 'client' | 'artisan' | 'manager' | 'admin';
export function jobStatus(status: Job['status'], role: Role = 'client'): string {
  if (role === 'artisan') return ({ requested: 'Offre disponible', assigned: 'Devis à préparer', quoted: 'Devis envoyé', accepted: 'À réaliser', in_progress: 'En cours', completed: 'Règlement attendu', paid: 'Dossier réglé', cancelled: 'Annulée' })[status];
  if (role === 'client') return ({ requested: 'Recherche d’un artisan', assigned: 'Artisan attribué', quoted: 'Devis à valider', accepted: 'Devis accepté', in_progress: 'En cours', completed: 'À régler', paid: 'Terminée et réglée', cancelled: 'Annulée' })[status];
  return statuses[status];
}
export function paymentLabel(payment: Payment): string {
  if (payment.status === 'failed') return 'Paiement non abouti';
  if (payment.status === 'pending') return 'Paiement en attente de confirmation';
  if (payment.method === 'on_site_declared') return 'Règlement déclaré par l’artisan — sans confirmation bancaire';
  if (payment.method === 'stripe' && payment.paid_at) return 'Règlement confirmé par la plateforme';
  return 'Règlement enregistré — preuve bancaire non précisée';
}
export function dossierAmount(job: Job, quotes?: QuoteSummary[], payments?: Payment[]) {
  const related = (quotes ?? []).filter(q => q.intervention_id === job.id).sort((a,b)=>(b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const accepted = related.find(q => q.status === 'accepted');
  const paid = accepted && (payments ?? []).filter(p => p.quote_id === accepted.id && p.status === 'paid').sort((a,b)=>(b.paid_at ?? b.created_at ?? '').localeCompare(a.paid_at ?? a.created_at ?? ''))[0];
  if (paid) return { label: paymentLabel(paid), value: euros(paid.total_cents) };
  if (accepted && accepted.accepted_total_cents === undefined) return { label: 'Montant accepté à vérifier', value: 'Actualisez le dossier pour obtenir le total avec les avenants.' };
  const attempt = accepted && (payments ?? []).filter(p => p.quote_id === accepted.id).sort((a,b)=>(b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
  if (accepted && attempt && attempt.status !== 'paid') return { label: paymentLabel(attempt), value: euros(accepted.accepted_total_cents!) };
  if (accepted) return { label: job.status === 'completed' ? 'À régler' : job.status === 'paid' ? 'Devis accepté — règlement à vérifier' : 'Devis accepté', value: euros(accepted.accepted_total_cents!) };
  const sent = related.find(q => q.status === 'sent');
  if (sent) return { label: 'Devis reçu', value: euros(sent.total_cents) };
  if (['quoted','accepted','in_progress','completed','paid'].includes(job.status)) return { label: 'Montant du devis indisponible', value: 'Consultez le dossier pour actualiser les informations.' };
  return { label: 'Estimation indicative', value: `${euros(job.estimate_min_cents)} à ${euros(job.estimate_max_cents)}` };
}
export const DOSSIER_STEPS = ['Demandée', 'Artisan', 'Devis', 'Intervention', 'Règlement'];
export function dossierStep(status: Job['status']): number {
  return ({requested:0,assigned:1,quoted:2,accepted:3,in_progress:3,completed:4,paid:4,cancelled:-1})[status];
}
