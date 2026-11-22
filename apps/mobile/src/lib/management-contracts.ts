import { z } from 'zod';
import { category, job } from './contracts';
const id = z.uuid();
export const memberRole = z.enum(['owner','manager','viewer']);
export const membershipLabels = {owner:'Propriétaire',manager:'Gestionnaire',viewer:'Lecture seule',platform_admin:'Administration de plateforme'};
export const siteTypes = {syndic:'Copropriété',restaurant:'Restaurant',office:'Bureaux',erp:'Établissement recevant du public'};
export const siteRecord = z.object({
 id, organization_id:id, name:z.string().min(1).max(160), address:z.string().min(5).max(500),
 access_notes:z.string().max(2000), type:z.enum(['syndic','restaurant','office','erp']), budget_cents:z.number().int().nonnegative(),
 settings_version:z.number().int().positive(), archived_at:z.string().nullable(),created_at:z.string(),
 opening_hours:z.array(z.object({day:z.number().int().min(1).max(7),opens:z.string(),closes:z.string()})),
});
export const siteSettings = z.object({site:siteRecord,can_write:z.boolean()});
export const siteSaved = z.object({site:siteRecord});
export const sitePage = z.object({sites:z.array(siteRecord),next_after:id.nullable()});
export const organizationOverview = z.object({
 organization:z.object({id,name:z.string(),owner_id:id}), current_role:z.enum(['owner','manager','viewer','platform_admin']),
 members:z.array(z.object({user_id:id,role:memberRole,full_name:z.string()})),
 permissions:z.object({can_manage:z.boolean()}),
 limits:z.object({members_limited:z.boolean()}),
 site_access:z.object({organization_id:id,can_manage:z.boolean(),members:z.array(z.object({user_id:id,role:memberRole,scope:z.enum(['all','selected']),grants:z.array(z.object({site_id:id,can_write:z.boolean()}))}))})
});
const page = z.object({limit:z.number().int().positive(),has_more:z.boolean(),next_cursor:z.string().nullable(),total:z.number().int().nonnegative()});
export const adminInterventions = z.object({interventions:z.array(z.object({id,category,status:job.shape.status,city:z.string(),postal_code:z.string().nullish(),urgency:job.shape.urgency,created_at:z.string()})),page});
export const directoryKind = z.enum(['clients','artisans','organizations']);
export const directoryRow = z.object({id,created_at:z.string(),full_name:z.string().optional(),name:z.string().optional(),phone:z.string().nullish(),role:z.enum(['client','manager']).optional(),artisan_approved:z.boolean().optional(),company_name:z.string().nullish(),application_status:z.string().nullish(),owner_id:id.optional()});
export const directoryPage = z.object({kind:directoryKind,items:z.array(directoryRow),page});
export const directoryDetail = z.object({kind:directoryKind,item:directoryRow});
export function siteEditValues(values: {name:string;address:string;access_notes:string}) {
 return z.object({name:z.string().trim().min(1,'Renseignez le nom du site.').max(160),address:z.string().trim().min(5,'Renseignez une adresse complète.').max(500),access_notes:z.string().trim().max(2000,'Limitez les consignes à 2 000 caractères.')}).safeParse(values);
}

const cursorPage = z.object({limit:z.number().int().positive(),has_more:z.boolean(),next_cursor:z.string().nullable()});
export const contractSummary = z.object({id,organization_id:id,title:z.string(),reference:z.string(),starts_on:z.iso.date(),ends_on:z.iso.date().nullable(),status:z.enum(['draft','active','archived']),created_at:z.string()});
export const contractPage = z.object({items:z.array(contractSummary),page:cursorPage});
export const contractDetail = z.object({contract:contractSummary.extend({terms:z.string()})});
export const contractLabels = {draft:'Brouillon',active:'Actif',archived:'Archivé'};
export const calendarDate = (date:string) => date.split('-').reverse().join('/');
export const approvalRecord = z.object({id,quote_id:id,site_id:id,status:z.enum(['pending','approved','rejected']),note:z.string(),created_at:z.string(),decided_at:z.string().nullable(),site:z.object({id,name:z.string(),organization_id:id}),quote:z.object({id,intervention_id:id,total_cents:z.number().int().nonnegative(),status:z.enum(['sent','accepted','rejected'])}),intervention:z.object({id,category,status:job.shape.status})});
export const approvalPage = z.object({items:z.array(approvalRecord),page:cursorPage});
export const approvalDetail = z.object({approval:approvalRecord,rule:z.object({enabled:z.boolean(),required_role:z.enum(['owner','manager']),threshold_cents:z.number().int().nonnegative()}).nullable()});
export const approvalLabels = {pending:'En attente',approved:'Approuvée',rejected:'Refusée'};
export const applicationStatus = z.enum(['draft','submitted','changes_requested','approved','suspended']);
export const applicationLabels = {draft:'Brouillon',submitted:'Soumise',changes_requested:'Compléments demandés',approved:'Approuvée',suspended:'Suspendue'};
export const artisanApplication = z.object({artisan_profile:z.object({user_id:id,company_name:z.string(),siret:z.string(),legal_status:z.string(),address:z.string(),postal_codes:z.array(z.string()),categories:z.array(category),application_status:applicationStatus,application_version:z.number().int().positive()}).nullable(),credentials:z.array(z.object({id,document_id:id,kind:z.enum(['registration','liability','qualification','other']),expires_on:z.iso.date().nullable()}))});
export function applicationActions(status:z.infer<typeof applicationStatus>) {
 if(status==='submitted')return ['approve','request_changes'] as const;
 if(status==='approved')return ['suspend'] as const;
 if(status==='suspended')return ['reinstate'] as const;
 return [];
}
export const applicationActionLabels = {approve:'Approuver la candidature',request_changes:'Demander des compléments',suspend:'Suspendre l’artisan',reinstate:'Réactiver l’artisan'};

// Administration native (ADM-02/03/04) : décisions motivées, journal, réaffectation, escalades, fiches.
const instant = z.iso.datetime({offset:true});
export const applicationDecided = z.object({success:z.literal(true),reason_recorded:z.boolean().optional()});
export const artisanFile = z.object({
 payment_account:z.object({linked:z.boolean(),transfers:z.enum(['active','inactive','unknown']).nullable()}),
 decisions:z.array(z.object({id,actor_id:id.nullable(),decided_at:instant,action:z.enum(['approve','request_changes','suspend','reinstate']),reason:z.string(),application_version:z.number().int().nonnegative()})),
});
export const applicationDecisionLabels = {approve:'Candidature approuvée',request_changes:'Compléments demandés',suspend:'Artisan suspendu',reinstate:'Artisan réactivé'};
export const credentialDecision = z.enum(['accepted','changes_requested','rejected']);
export const credentialDecisionLabels = {accepted:'Pièce acceptée',changes_requested:'Modifications demandées',rejected:'Pièce refusée'};
const credentialReview = z.object({version:z.number().int().positive(),decision:credentialDecision,reason:z.string(),reviewed_at:instant});
export const credentialReviews = z.object({credential_id:id,can_review:z.boolean(),current_version:z.number().int().nonnegative(),reviews:z.array(credentialReview),next_before:z.number().int().nullable()});
export const credentialReviewed = z.object({review:credentialReview});
const settlementCents = z.number().int().nonnegative();
export const adminDossier = z.object({
 intervention:z.object({id,client_id:id.nullish(),artisan_id:id.nullish(),site_id:id.nullish(),status:job.shape.status}),
 audit:z.discriminatedUnion('status',[z.object({status:z.literal('ok'),items:z.array(z.object({id:z.string(),actor_id:id.nullable(),action:z.string(),created_at:z.string()})),limit:z.number().int(),limited:z.boolean()}),z.object({status:z.literal('error')})]),
 settlement:z.object({amount_cents:settlementCents,fee_bps:z.number().int().min(0).max(9999),fee_cents:settlementCents,net_cents:settlementCents,transfer:z.enum(['with_payment','confirmed'])}).refine(v=>v.fee_cents+v.net_cents===v.amount_cents).optional().catch(undefined),
});
export const dossierAuditLabels: Record<string,string> = {create:'Demande créée',created:'Demande créée',appointment_saved:'Rendez-vous enregistré',accept_mission:'Mission acceptée',admin_reassigned:'Artisan réaffecté',send_quote:'Devis envoyé',accept_quote:'Devis accepté',start:'Intervention démarrée',complete:'Intervention clôturée',cancel:'Demande annulée',payment_confirmed:'Paiement confirmé'};
export const reassigned = z.object({success:z.literal(true)});
export const supportStatusLabels = {open:'Ouverte',in_progress:'En cours de traitement',awaiting_user:'En attente du demandeur',resolved:'Résolue'};
export const adminTickets = z.object({tickets:z.array(z.object({id,subject:z.string(),status:z.enum(['open','in_progress','awaiting_user','resolved']),intervention_id:id.nullable(),created_at:z.string()})),page});
const triageState = z.object({ticket_id:id,assigned_to:id.nullable(),assignee_name:z.string().nullable(),escalated:z.boolean(),version:z.number().int().nonnegative()});
export const ticketTriage = z.object({triage:triageState,events:z.array(z.object({id,actor_id:id,version:z.number().int(),action:z.enum(['assign','set_escalated']),reason:z.string(),escalated:z.boolean(),created_at:z.string()})),can_manage:z.boolean()});
export const triageReceipt = z.object({triage:triageState,replayed:z.boolean()});
export const escalatedQueue = z.object({rows:z.array(z.object({id,subject:z.string(),status:z.enum(['open','in_progress','awaiting_user']),assigned_to:id.nullable(),escalated:z.boolean()})),next_cursor:id.nullable()});
