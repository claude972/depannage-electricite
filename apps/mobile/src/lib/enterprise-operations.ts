import { z } from 'zod';
// Native read contracts of the enterprise operations endpoints (site-operations, organisation SLA, reports).
// Every value is displayed as returned by the server: no delay, calendar or amount is computed on the device.
const id = z.uuid();
const track = z.object({
 target_minutes:z.number().nullable(),deadline_at:z.string().nullable(),elapsed_minutes:z.number().nullable(),remaining_minutes:z.number().nullable(),
 status:z.enum(['met','breached','pending','not_measurable']),reason:z.string().nullable(),
});
export const slaEvaluation = z.object({case_id:id,policy_id:id,measurable:z.boolean(),reasons:z.array(z.string()),paused_now:z.boolean(),response:track,resolution:track});
const slaSummary = z.object({cases:z.number(),measurable:z.number(),not_measurable:z.number(),breached:z.number(),pending:z.number(),met:z.number(),indeterminate:z.number()});
const gridLine = z.object({label:z.string(),unit:z.enum(['hour','visit','flat','km','unit']),amount_cents:z.number().int().nonnegative(),note:z.string()});
export const contractGrid = z.object({id,version:z.number().int().positive(),organization_id:id,lineage_id:id,version_number:z.number().int().positive(),label:z.string(),contract_id:id.nullable(),effective_from:z.string().nullable(),status:z.enum(['draft','published','superseded']),published_at:z.string().nullable(),lines:z.array(gridLine)});
const calendar = z.object({id,version:z.number().int().positive(),name:z.string(),timezone:z.string(),windows:z.array(z.object({weekday:z.number().int().min(1).max(7),start:z.string(),end:z.string()})),closed_dates:z.array(z.string())});
const policy = z.object({id,version:z.number().int().positive(),site_id:id,name:z.string(),calendar_id:id.nullable(),urgency:z.enum(['urgent','scheduled']).nullable(),response_target_minutes:z.number().nullable(),resolution_target_minutes:z.number().nullable(),status:z.enum(['active','archived'])});
const slaCase = z.object({id,version:z.number().int().positive(),site_id:id,policy_id:id,intervention_id:id.nullable(),reference:z.string(),opened_at:z.string(),responded_at:z.string().nullable(),resolved_at:z.string().nullable(),notes:z.string(),pauses_total:z.number(),pauses:z.array(z.object({id,started_at:z.string(),ended_at:z.string().nullable(),reason:z.string()}))});
export const siteOperations = z.object({
 site_id:id,computed_at:z.string(),
 snapshot:z.object({
  site:z.object({id,organization_id:id,name:z.string()}),
  contract_grids:z.array(contractGrid).nullable(),sla_calendars:z.array(calendar),sla_policies:z.array(policy),sla_cases:z.array(slaCase),
  limits:z.object({can_write_site:z.boolean(),can_write_organization:z.boolean(),contract_grids_limited:z.boolean(),sla_cases_limited:z.boolean(),sla_policies_limited:z.boolean(),sla_calendars_limited:z.boolean()}),
 }),
 sla:z.object({cases:z.array(slaEvaluation),summary:slaSummary}),
});
export const organizationSla = z.object({
 organization_id:id,captured_at:z.string(),state:z.enum(['complete','partial']),
 summary:slaSummary,
 page:z.object({has_more:z.boolean(),next_cursor:z.string().nullable()}),
 sites:z.array(z.object({id,name:z.string(),cases_total:z.number(),complete:z.boolean(),cases:z.array(z.object({case_id:id,evaluation:slaEvaluation.nullable(),reason:z.string().nullable()}))})),
});
export const operationsSaved = z.object({action:z.string()});
const cents = z.number().int().nonnegative();
export const reportSite = z.object({site_id:id,name:z.string(),type:z.enum(['syndic','restaurant','office','erp']),budget_cents:cents,paid_cents:cents,committed_cents:cents,interventions:cents,accepted_cents:cents,active_accepted_cents:cents,declared_paid_cents:cents,unverified_paid_cents:cents,refunded_cents:cents,net_paid_cents:cents,financial_complete:z.boolean()});
export const professionalReport = z.object({
 sites:z.array(reportSite),
 totals:z.object({budget_cents:cents,accepted_cents:cents,active_accepted_cents:cents,paid_cents:cents,declared_paid_cents:cents,unverified_paid_cents:cents,refunded_cents:cents,net_paid_cents:cents,committed_cents:cents,financial_complete:z.boolean()}),
 scope:z.object({complete:z.boolean()}),
 page:z.object({has_more:z.boolean(),next_after:id.nullable()}).optional(),
});
export const siteCreated = z.object({site:z.unknown()});
export const trackLabels = {met:'Respecté',breached:'Dépassé',pending:'En cours',not_measurable:'Non mesurable'};
export const notMeasurable: Record<string,string> = {
 no_calendar:'aucun calendrier ouvré n’est associé à la règle',no_target:'aucune cible de délai n’est configurée',
 calendar_without_windows:'le calendrier n’a aucune plage ouvrée',calendar_unreachable:'le calendrier est trop restreint pour atteindre la cible',
 invalid_timezone:'le fuseau horaire du calendrier est inconnu',future_fact:'une date de fait constaté est dans le futur',
 pauses_incomplete:'la liste des pauses reçue est incomplète',policy_unavailable:'la règle de délai n’est pas lisible',calendar_unavailable:'le calendrier n’est pas lisible',
};
export const weekdays = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
export const gridStatus = {draft:'Brouillon',published:'Publiée',superseded:'Remplacée'};
export const gridUnit = {hour:'par heure',visit:'par déplacement',flat:'forfait',km:'par kilomètre',unit:'à l’unité'};
export const reportSiteTypes = {syndic:'Copropriété',restaurant:'Restauration',office:'Bureaux',erp:'ERP'};
export const minutes = (value: number | null) => {
 if (value === null) return '—';
 const h = Math.floor(value / 60), m = value % 60;
 return h ? (m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`) : `${m} min`;
};
export function trackLine(label: string, value: z.infer<typeof track>, when: (iso: string) => string) {
 if (value.status === 'not_measurable') return `${label} : non mesurable${value.reason ? ' (' + (notMeasurable[value.reason] ?? value.reason) + ')' : ''}`;
 const parts = [`${label} : ${trackLabels[value.status]}`, `cible ${minutes(value.target_minutes)}`];
 if (value.elapsed_minutes !== null) parts.push(`écoulé ${minutes(value.elapsed_minutes)}`);
 if (value.status === 'pending' && value.remaining_minutes !== null) parts.push(`reste ${minutes(value.remaining_minutes)}`);
 if (value.deadline_at) parts.push(`échéance ${when(value.deadline_at)}`);
 return parts.join(' · ');
}
