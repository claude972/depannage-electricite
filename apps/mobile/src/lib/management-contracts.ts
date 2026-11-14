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
