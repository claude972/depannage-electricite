import { z } from 'zod';
import { category, statuses } from './contracts';

// Contrats natifs des blocs de la fiche site (ENT-03/04/11). Mêmes routes et mêmes commandes que le
// portail Web ; aucune échéance ni aucun droit n’est calculé ici : tout vient du serveur.
const id = z.uuid();
const stamp = z.string();
const version = z.number().int().positive();

export const areaKinds = { floor: 'Étage', zone: 'Zone', common_area: 'Partie commune' } as const;
export const areaRecord = z.object({
  id, site_id: id, label: z.string(), kind: z.enum(['floor', 'zone', 'common_area']), reference: z.string(), note: z.string(),
  parent_id: id.nullable(), depth: z.number().int().min(1).max(4), version, archived_at: stamp.nullable(),
});
export type SiteArea = z.infer<typeof areaRecord>;
export const areaPage = z.object({
  records: z.array(areaRecord), page: z.object({ total: z.number().int().nonnegative(), has_more: z.boolean() }),
  permissions: z.object({ can_write: z.boolean() }),
});
export const areaSaved = z.object({ record: areaRecord });
export function areaValues(values: { label: string; reference: string; note: string }) {
  return z.object({
    label: z.string().trim().min(1, 'Renseignez le nom de la zone.').max(160, 'Limitez le nom à 160 caractères.'),
    reference: z.string().trim().max(80, 'Limitez le repère à 80 caractères.'),
    note: z.string().trim().max(2000, 'Limitez la note à 2 000 caractères.'),
  }).safeParse(values);
}

export const contactRecord = z.object({
  id, site_id: id, first_name: z.string(), last_name: z.string(), role_label: z.string(), phone: z.string().nullable(),
  email: z.string().nullable(), note: z.string(), is_primary: z.boolean(), version, archived_at: stamp.nullable(),
});
export type SiteContact = z.infer<typeof contactRecord>;
export const contactPage = z.object({
  records: z.array(contactRecord), page: z.object({ has_more: z.boolean() }), permissions: z.object({ can_write: z.boolean() }),
});
export const contactSaved = z.object({ record: contactRecord });
export function contactValues(values: { first_name: string; last_name: string; role_label: string; phone: string; email: string; note: string; is_primary: boolean }) {
  return z.object({
    first_name: z.string().trim().min(1, 'Renseignez le prénom.').max(100),
    last_name: z.string().trim().min(1, 'Renseignez le nom.').max(100),
    role_label: z.string().trim().min(1, 'Renseignez la fonction du contact.').max(160),
    phone: z.string().trim().refine(value => value === '' || /^\+?[0-9][0-9 ().-]{5,30}$/.test(value), 'Vérifiez le numéro de téléphone.'),
    email: z.string().trim().max(254).refine(value => value === '' || z.email().safeParse(value).success, 'Vérifiez l’adresse e-mail.'),
    note: z.string().trim().max(2000, 'Limitez la consigne à 2 000 caractères.'),
    is_primary: z.boolean(),
  }).refine(value => value.phone !== '' || value.email !== '', { message: 'Renseignez un téléphone ou un e-mail.', path: ['phone'] }).safeParse(values);
}

export const documentKinds = { plan: 'Plan', maintenance: 'Maintenance', compliance: 'Conformité', other: 'Autre document' } as const;
export const siteDocument = z.object({
  id, site_id: id, name: z.string(), mime_type: z.string(), kind: z.enum(['plan', 'maintenance', 'compliance', 'other']),
  created_at: stamp, version, replaced_at: stamp.nullable(), archived_at: stamp.nullable(),
});
export const siteDocumentPage = z.object({ documents: z.array(siteDocument), page: z.object({ has_more: z.boolean(), next_cursor: z.string().nullable() }) });

export const siteJobs = z.object({
  items: z.array(z.object({ id, site_id: id, category, status: z.enum(Object.keys(statuses) as [keyof typeof statuses, ...(keyof typeof statuses)[]]), created_at: stamp, urgency: z.enum(['urgent', 'scheduled']) })),
  page: z.object({ has_more: z.boolean(), next_cursor: z.string().nullable() }),
});
export const complianceKinds = { audit: 'Audit', maintenance: 'Maintenance', safety: 'Sécurité', equipment: 'Équipement', contract: 'Contrat' } as const;
export const complianceStatuses = { pending: 'À planifier', scheduled: 'Planifié', completed: 'Réalisé' } as const;
export const siteCompliance = z.object({
  items: z.array(z.object({ id, site_id: id, title: z.string(), kind: z.enum(['audit', 'maintenance', 'safety', 'equipment', 'contract']), due_on: z.string(), status: z.enum(['pending', 'scheduled', 'completed']), notes: z.string() })),
  page: z.object({ has_more: z.boolean(), next_cursor: z.string().nullable() }),
});

export const equipmentCategories = {
  panel: 'Tableau électrique', lighting: 'Éclairage', emergency_lighting: 'Éclairage de sécurité',
  fire_safety: 'Sécurité incendie (partie électrique)', hvac: 'Chauffage / ventilation (partie électrique)',
  generator: 'Groupe électrogène', ups: 'Onduleur', other: 'Autre équipement',
} as const;
export const criticalities = { low: 'Faible', medium: 'Moyenne', high: 'Élevée', critical: 'Critique' } as const;
export const equipmentStatuses = { in_service: 'En service', degraded: 'Dégradé', out_of_service: 'Hors service', retired: 'Retiré' } as const;
export const planStatuses = { active: 'Actif', paused: 'Suspendu', archived: 'Archivé' } as const;
/** Lecture limitée aux équipements et plans : les délais (SLA) sont décrits dans enterprise-operations.ts. */
export const siteOperations = z.object({
  site_id: id, computed_at: stamp,
  snapshot: z.object({
    site: z.object({ id, organization_id: id, name: z.string() }),
    equipment: z.array(z.object({
      id, version, name: z.string(), category: z.enum(Object.keys(equipmentCategories) as [keyof typeof equipmentCategories, ...(keyof typeof equipmentCategories)[]]),
      criticality: z.enum(['low', 'medium', 'high', 'critical']), location: z.string(), reference: z.string(), installed_on: z.string().nullable(),
      status: z.enum(['in_service', 'degraded', 'out_of_service', 'retired']), notes: z.string(),
    })),
    maintenance_plans: z.array(z.object({
      id, equipment_id: id.nullable(), title: z.string(), frequency_kind: z.enum(['none', 'days', 'weeks', 'months']), frequency_value: z.number().nullable(),
      next_due_on: z.string().nullable(), last_done_on: z.string().nullable(), status: z.enum(['active', 'paused', 'archived']), visits_total: z.number().int().nonnegative(),
    })),
    limits: z.object({ equipment_limited: z.boolean(), maintenance_plans_limited: z.boolean(), can_write_site: z.boolean() }),
  }),
});
export type SiteOperations = z.infer<typeof siteOperations>;
export const operationSaved = z.object({ action: z.string() });

export const isoDay = (value: string | null) => value ? value.slice(0, 10).split('-').reverse().join('/') : '—';
