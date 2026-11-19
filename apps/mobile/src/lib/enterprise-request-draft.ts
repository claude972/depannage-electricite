import { z } from 'zod';
import { category, requestFields } from './contracts';

/** An enterprise request always belongs to one account, organization and site. */
export const enterpriseRequestIntent = z.object({
  id: z.uuid(), actor_id: z.uuid(), organization_id: z.uuid(),
  payload: requestFields.extend({ site_id: z.uuid(), reviewed_estimate_version: z.number().int().min(1).max(2147483647) }).strict(),
  estimate: z.object({ min_cents: z.number().int().nonnegative(), max_cents: z.number().int().nonnegative() })
    .refine(value => value.min_cents <= value.max_cents),
  reviewRequired: z.boolean(),
}).strict();
export const enterpriseRequestForm = z.object({ category: category.nullable(), description: z.string().max(4000), address: z.string().max(500), postal: z.string().max(5), city: z.string().max(120), urgency: z.enum(['urgent','scheduled']).nullable(), step: z.number().int().min(0).max(2) });
export const enterpriseRequestDraft = z.object({ form: enterpriseRequestForm.optional(), intent: enterpriseRequestIntent.nullable(), confirmedId: z.uuid().nullable() }).strict();
export type EnterpriseRequestIntent = z.infer<typeof enterpriseRequestIntent>;
export function enterpriseDraftKey(actor: string, organization: string, site: string) {
  return ['enterprise-request-v1', ...[actor, organization, site].map(value => z.uuid().parse(value))].join('.');
}
export function enterpriseRequestCommand(intent: EnterpriseRequestIntent, scope: { actor: string; organization: string; site: string }) {
  const checked = enterpriseRequestIntent.parse(intent);
  if (checked.actor_id !== scope.actor || checked.organization_id !== scope.organization || checked.payload.site_id !== scope.site)
    throw new Error('Cette demande appartient à un autre compte ou site. Revenez au site concerné.');
  if (checked.reviewRequired) throw new Error('Consultez la nouvelle estimation avant de confirmer.');
  return { ...checked.payload, request_id: checked.id };
}
