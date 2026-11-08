import { z } from 'zod';
import { ApiError, authenticatedClient, dbError } from '@/lib/supabase/server';
import { isIsoDate, validityState } from '@/lib/features/quote-documents/validity';

type Database = Awaited<ReturnType<typeof authenticatedClient>>['db'];
const uuid = z.uuid();
const ruleSchema = z.object({
  site_id: uuid, enabled: z.boolean(), threshold_cents: z.number().int().min(0).max(100000000),
  required_role: z.enum(['owner', 'manager']),
});
const approvalSchema = z.object({
  id: uuid, quote_id: uuid, site_id: uuid, status: z.enum(['pending', 'approved', 'rejected']),
});
const termsSchema = z.object({ quote_id: uuid, valid_until: z.string().refine(isIsoDate).nullable() });

/** Absence is established by successful bounded RLS reads, never by an error or cached workspace. */
export async function readDecisionContext(db: Database, quoteId: string, interventionId: string, siteId: string) {
  const rulesResult = await db.from('approval_rules').select('site_id,enabled,threshold_cents,required_role').eq('site_id', siteId).limit(2);
  dbError(rulesResult.error);
  const rules = z.array(ruleSchema).max(1).parse(rulesResult.data);
  const approvalsResult = await db.from('approvals').select('id,quote_id,site_id,status').eq('quote_id', quoteId).limit(2);
  dbError(approvalsResult.error);
  const approvals = z.array(approvalSchema).max(1).parse(approvalsResult.data);
  const termsResult = await db.from('quote_terms').select('quote_id,valid_until').eq('quote_id', quoteId).limit(2);
  dbError(termsResult.error);
  const terms = z.array(termsSchema).max(1).parse(termsResult.data);
  if (rules.some(r => r.site_id !== siteId) || approvals.some(a => a.site_id !== siteId || a.quote_id !== quoteId) || terms.some(t => t.quote_id !== quoteId)) {
    throw Error('Inconsistent decision scope');
  }
  const siteResult = await db.from('sites').select('id,archived_at').eq('id', siteId).maybeSingle();
  dbError(siteResult.error);
  if (!siteResult.data) throw new ApiError(404, 'Devis introuvable.');
  const site = z.object({ id: uuid, archived_at: z.iso.datetime({ offset: true }).nullable() }).parse(siteResult.data);
  if (site.id !== siteId) throw Error('Inconsistent site');
  const rights = await db.rpc('can_manage_site', { p_site_id: siteId });
  dbError(rights.error);
  const canManage = z.boolean().parse(rights.data);
  const rule = rules[0], approval = approvals[0], validUntil = terms[0]?.valid_until ?? null;
  return {
    quote_id: quoteId, intervention_id: interventionId, site_id: siteId,
    can_write: canManage && site.archived_at === null,
    simple_rule: rule ? { enabled: rule.enabled, threshold_cents: rule.threshold_cents, required_role: rule.required_role } : null,
    simple_approval: approval ? { id: approval.id, status: approval.status } : null,
    validity: { valid_until: validUntil, state: validityState(validUntil) },
  };
}
