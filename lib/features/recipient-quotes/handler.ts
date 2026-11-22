import { z } from 'zod';
import { authenticatedClient, ApiError, dbError } from '@/lib/supabase/server';
import { comparePostgresTime } from '@/lib/shared/postgres-time-order';
import { detailReadSchema, DETAIL_PROJECTIONS } from '@/lib/features/workspace/detail-read';
import { readDecisionContext } from './decision-context';
import { calculateQuote } from '@/lib/domain';

const uuid = z.uuid().transform(v => v.toLowerCase());
const timestamp = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const status = z.enum(['sent', 'accepted', 'rejected']);
const filter = z.enum(['all', 'sent', 'accepted', 'rejected']);
const jobSchema = z.object({
  id: uuid, client_id: uuid, site_id: uuid.nullable(),
  category: z.enum(['outage', 'panel', 'socket', 'lighting', 'diagnostic']),
  status: z.enum(['requested', 'assigned', 'quoted', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled']),
});
const summary = z.object({
  id: uuid, intervention_id: uuid, total_cents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  status, created_at: timestamp,
});
// Same normalization, tax rates and exact line projection as the existing artisan detail reader.
const quoteSchema = detailReadSchema.shape.quotes.options[0].shape.items.element.omit({ accepted_total_cents: true });
const source = quoteSchema.extend({ intervention: jobSchema });
const listSource = summary.extend({ intervention: jobSchema });
const cursorSchema = z.object({ v: z.literal(1), actor: uuid, status: filter, at: timestamp, id: uuid }).strict();
const jobFields = 'id,client_id,site_id,category,status';
const embed = `intervention:interventions!quotes_intervention_id_fkey!inner(${jobFields})`;
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
type Context = { params: Promise<{ id: string }> };

async function read(request: Request, context?: Context, decision = false) {
  try {
    const { db, user } = await authenticatedClient();
    const actor = uuid.parse(user.id), params = new URL(request.url).searchParams;
    const allowed = context ? ['organization_id', 'site_id'] : ['status', 'cursor'];
    const idResult = uuid.nullable().safeParse(context ? (await context.params).id : null);
    const orgResult = uuid.nullable().safeParse(params.get('organization_id'));
    const siteResult = uuid.nullable().safeParse(params.get('site_id'));
    const statusResult = filter.safeParse(params.get('status') ?? 'all');
    if (request.url.length > 2048 || !idResult.success || !orgResult.success || !siteResult.success || !statusResult.success ||
        [...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw new ApiError(422, 'Paramètres invalides.');
    const id = idResult.data, org = orgResult.data, site = siteResult.data, selected = statusResult.data;
    const profile = await db.from('profiles').select('role').eq('id', actor).maybeSingle();
    dbError(profile.error);
    const role = profile.data?.role;
    if ((decision && role !== 'manager') || (role !== 'client' && !(context && role === 'manager'))) throw new ApiError(403, 'Accès destinataire requis.');
    if (role === 'client' && (org || site)) throw new ApiError(422, 'Périmètre client invalide.');
    if (role === 'manager' && !org) throw new ApiError(422, 'Choisissez une organisation.');
    async function access(jobs: z.infer<typeof jobSchema>[] = []) {
      const current = await db.from('profiles').select('role').eq('id', actor).maybeSingle();
      dbError(current.error);
      if (current.data?.role !== role) throw new ApiError(403, 'Vos droits ont changé.');
      if (role === 'manager') {
        const member = await db.from('organization_members').select('organization_id,user_id').eq('organization_id', org!).eq('user_id', actor).maybeSingle();
        dbError(member.error);
        if (member.data?.organization_id !== org || member.data?.user_id !== actor) throw new ApiError(404, 'Devis introuvable.');
        const ids = [...new Set([...(site ? [site] : []), ...jobs.map(j => j.site_id)])];
        if (ids.includes(null)) throw new ApiError(404, 'Devis introuvable.');
        if (ids.length) {
          const visible = await db.from('sites').select('id,organization_id').eq('organization_id', org!).in('id', ids as string[]).limit(2);
          dbError(visible.error);
          const rows = z.array(z.object({ id: uuid, organization_id: uuid })).max(2).parse(visible.data);
          if (rows.length !== ids.length || new Set(rows.map(r => r.id)).size !== ids.length || rows.some(r => r.organization_id !== org || !ids.includes(r.id))) throw new ApiError(404, 'Devis introuvable.');
        }
        if (site && jobs.some(j => j.site_id !== site)) throw new ApiError(404, 'Devis introuvable.');
      } else if (jobs.some(j => j.client_id !== actor)) throw new ApiError(404, 'Devis introuvable.');
      if (jobs.length) {
        const ids = [...new Set(jobs.map(j => j.id))];
        let query = db.from('interventions').select(jobFields).in('id', ids);
        if (role === 'client') query = query.eq('client_id', actor);
        const result = await query.limit(51);
        dbError(result.error);
        const currentJobs = z.array(jobSchema).max(51).parse(result.data);
        if (currentJobs.length !== ids.length || new Set(currentJobs.map(j => j.id)).size !== ids.length || jobs.some(j => !currentJobs.some(c => c.id === j.id && c.client_id === j.client_id && c.site_id === j.site_id))) throw new ApiError(404, 'Devis introuvable.');
        if (jobs.some(j => currentJobs.find(c => c.id === j.id)?.status !== j.status)) throw Error('Dossier changed during read');
      }
    }
    await access();
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (params.has('cursor')) {
      try {
        const raw = params.get('cursor')!;
        if (!/^[A-Za-z0-9_-]{1,600}$/.test(raw)) throw Error();
        const bytes = Buffer.from(raw, 'base64url');
        if (bytes.toString('base64url') !== raw) throw Error();
        cursor = cursorSchema.parse(JSON.parse(bytes.toString('utf8')));
        if (cursor.actor !== actor || cursor.status !== selected) throw Error();
      } catch { throw new ApiError(422, 'Curseur invalide. Rechargez les devis.'); }
    }
    let query = db.from('quotes').select(`${id ? DETAIL_PROJECTIONS.quotes : 'id,intervention_id,total_cents,status,created_at'},${embed}`);
    if (role === 'client') query = query.eq('intervention.client_id', actor);
    if (site) query = query.eq('intervention.site_id', site);
    if (id) query = query.eq('id', id);
    if (selected !== 'all') query = query.eq('status', selected);
    if (cursor) query = query.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(id ? 2 : 51);
    dbError(result.error);
    const rows = id ? z.array(source).max(1).parse(result.data) : z.array(listSource).max(51).parse(result.data);
    let previous = cursor ? { at: cursor.at, id: cursor.id } : null;
    for (const row of rows) {
      if (row.intervention_id !== row.intervention.id || (id && row.id !== id) || (selected !== 'all' && row.status !== selected)) throw Error('Inconsistent quote');
      if (previous) {
        const order = comparePostgresTime(row.created_at, previous.at);
        if (order > 0 || (order === 0 && row.id >= previous.id)) throw Error('Inconsistent order');
      }
      previous = { at: row.created_at, id: row.id };
    }
    await access(rows.map(r => r.intervention));
    const projectJob = (job: z.infer<typeof jobSchema>) => ({ id: job.id, category: job.category, status: job.status, site_id: job.site_id });
    if (id) {
      if (!rows.length) throw new ApiError(404, 'Devis introuvable.');
      const { intervention, ...quote } = source.parse(rows[0]);
      const totals = calculateQuote(quote.lines, quote.tax_rate);
      if (totals.subtotal_cents !== quote.subtotal_cents || totals.tax_cents !== quote.tax_cents || totals.total_cents !== quote.total_cents) throw Error('Inconsistent amounts');
      const activeResult = await db.from('quotes').select('id,intervention_id,status').eq('intervention_id', intervention.id).in('status', ['sent', 'accepted']).limit(2);
      dbError(activeResult.error);
      const active = z.array(z.object({ id: uuid, intervention_id: uuid, status: z.enum(['sent', 'accepted']) })).max(1).parse(activeResult.data);
      if (active.some(q => q.intervention_id !== intervention.id) || (quote.status !== 'rejected' && (active[0]?.id !== quote.id || active[0]?.status !== quote.status)) || (quote.status === 'rejected' && active[0]?.id === quote.id)) throw Error('Quote version changed');
      if (decision) {
        if (!intervention.site_id) throw new ApiError(404, 'Devis introuvable.');
        const before = await readDecisionContext(db, quote.id, intervention.id, intervention.site_id);
        await access([intervention]);
        const after = await readDecisionContext(db, quote.id, intervention.id, intervention.site_id);
        if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Decision context changed');
        await access([intervention]);
        return Response.json(after, { headers });
      }
      await access([intervention]);
      return Response.json({ quote, intervention: projectJob(intervention), version: { current_quote_id: active[0]?.id ?? null, is_current: active[0]?.id === quote.id } }, { headers });
    }
    const items = rows.slice(0, 50).map(row => ({ ...row, intervention: projectJob(row.intervention) }));
    const hasMore = rows.length > 50, last = items.at(-1);
    const next = hasMore && last ? Buffer.from(JSON.stringify({ v: 1, actor, status: selected, at: last.created_at, id: last.id })).toString('base64url') : null;
    return Response.json({ items, page: { limit: 50, has_more: hasMore, next_cursor: next } }, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : 'Le devis n’a pas pu être vérifié. Réessayez.' }, { status, headers: { ...headers, ...(status === 503 ? { 'Retry-After': '2' } : {}) } });
  }
}
export const GET = (request: Request) => read(request);
export const GET_DETAIL = (request: Request, context: Context) => read(request, context);

export const GET_DECISION_CONTEXT = (request: Request, context: Context) => read(request, context, true);
