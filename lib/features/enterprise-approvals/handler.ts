import { z } from 'zod';
import { authenticatedClient, ApiError, dbError } from '@/lib/supabase/server';
import { comparePostgresTime } from '@/lib/shared/postgres-time-order';

const uuid = z.uuid().transform(value => value.toLowerCase());
const timestamp = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const status = z.enum(['pending', 'approved', 'rejected']);
const filter = z.enum(['all', 'pending', 'approved', 'rejected']);
const siteSchema = z.object({ id: uuid, name: z.string().min(1).max(160), organization_id: uuid });
const interventionSchema = z.object({
  id: uuid, site_id: uuid,
  category: z.enum(['outage', 'panel', 'socket', 'lighting', 'diagnostic']),
  status: z.enum(['requested', 'assigned', 'quoted', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled']),
});
const sourceSchema = z.object({
  id: uuid, quote_id: uuid, site_id: uuid, status, note: z.string().max(2000),
  decided_by: uuid.nullable(), created_at: timestamp, decided_at: timestamp.nullable(),
  site: siteSchema,
  quote: z.object({
    id: uuid, intervention_id: uuid, total_cents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    status: z.enum(['sent', 'accepted', 'rejected']), intervention: interventionSchema,
  }),
});
const ruleSchema = z.object({
  site_id: uuid, enabled: z.boolean(), required_role: z.enum(['owner', 'manager']),
  threshold_cents: z.number().int().min(0).max(100000000),
});
const cursorSchema = z.object({
  v: z.literal(1), actor: uuid, org: uuid, site: uuid.nullable(), status: filter, at: timestamp, id: uuid,
}).strict();
const projection = [
  'id,quote_id,site_id,status,note,decided_by,created_at,decided_at',
  'site:sites!approvals_site_id_fkey!inner(id,name,organization_id)',
  'quote:quotes!approvals_quote_id_fkey!inner(id,intervention_id,total_cents,status,intervention:interventions!quotes_intervention_id_fkey!inner(id,site_id,category,status))',
].join(',');
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
type Context = { params: Promise<{ id: string }> };

async function read(request: Request, context?: Context) {
  try {
    const { db, user } = await authenticatedClient();
    const actor = uuid.parse(user.id);
    const params = new URL(request.url).searchParams;
    const allowed = context ? ['organization_id', 'site_id'] : ['organization_id', 'site_id', 'status', 'cursor'];
    const orgResult = uuid.safeParse(params.get('organization_id'));
    const siteResult = uuid.nullable().safeParse(params.get('site_id'));
    const filterResult = filter.safeParse(params.get('status') ?? 'all');
    const idResult = uuid.nullable().safeParse(context ? (await context.params).id : null);
    if (request.url.length > 2048 || !orgResult.success || !siteResult.success || !filterResult.success || !idResult.success ||
        [...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) {
      throw new ApiError(422, 'Paramètres invalides.');
    }
    const org = orgResult.data, site = siteResult.data, selected = filterResult.data, id = idResult.data;
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (params.has('cursor')) {
      try {
        const raw = params.get('cursor')!;
        if (!/^[A-Za-z0-9_-]{1,700}$/.test(raw)) throw Error();
        const bytes = Buffer.from(raw, 'base64url');
        if (bytes.toString('base64url') !== raw) throw Error();
        cursor = cursorSchema.parse(JSON.parse(bytes.toString('utf8')));
        if (cursor.actor !== actor || cursor.org !== org || cursor.site !== site || cursor.status !== selected) throw Error();
      } catch { throw new ApiError(422, 'Curseur invalide. Rechargez cette liste.'); }
    }
    async function access(siteIds: string[] = []) {
      const profile = await db.from('profiles').select('role').eq('id', actor).maybeSingle();
      dbError(profile.error);
      if (profile.data?.role !== 'manager') throw new ApiError(403, 'Accès entreprise requis.');
      const member = await db.from('organization_members').select('organization_id,user_id')
        .eq('organization_id', org).eq('user_id', actor).maybeSingle();
      dbError(member.error);
      if (member.data?.organization_id !== org || member.data?.user_id !== actor) throw new ApiError(404, 'Périmètre introuvable.');
      const ids = [...new Set([...(site ? [site] : []), ...siteIds])];
      if (ids.length) {
        const visible = await db.from('sites').select('id,organization_id').eq('organization_id', org).in('id', ids).limit(51);
        dbError(visible.error);
        const rows = z.array(z.object({ id: uuid, organization_id: uuid })).max(51).parse(visible.data);
        if (rows.length !== ids.length || new Set(rows.map(row => row.id)).size !== ids.length ||
            rows.some(row => row.organization_id !== org || !ids.includes(row.id))) throw new ApiError(404, 'Périmètre introuvable.');
      }
    }
    await access();
    let query = db.from('approvals').select(projection).eq('site.organization_id', org);
    if (site) query = query.eq('site_id', site);
    if (id) query = query.eq('id', id);
    if (selected !== 'all') query = query.eq('status', selected);
    if (cursor) query = query.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(id ? 2 : 51);
    dbError(result.error);
    const rows = z.array(sourceSchema).max(id ? 1 : 51).parse(result.data);
    let previous = cursor ? { at: cursor.at, id: cursor.id } : null;
    for (const row of rows) {
      if (row.site.organization_id !== org || row.site.id !== row.site_id || (site && row.site_id !== site) ||
          (id && row.id !== id) || (selected !== 'all' && row.status !== selected) || row.quote_id !== row.quote.id ||
          row.quote.intervention_id !== row.quote.intervention.id || row.quote.intervention.site_id !== row.site_id) throw Error('Inconsistent approval scope');
      if (previous) {
        const order = comparePostgresTime(row.created_at, previous.at);
        if (order > 0 || (order === 0 && row.id >= previous.id)) throw Error('Inconsistent approval order');
      }
      previous = { at: row.created_at, id: row.id };
    }
    const items = rows.map(row => {
      const { intervention, ...quote } = row.quote;
      const { site_id: _siteId, ...job } = intervention;
      return { ...row, quote, intervention: job };
    });
    let rule = null;
    if (id) {
      if (!rows.length) throw new ApiError(404, 'Approbation introuvable.');
      const result = await db.from('approval_rules').select('site_id,enabled,required_role,threshold_cents').eq('site_id', rows[0].site_id).limit(2);
      dbError(result.error);
      const rules = z.array(ruleSchema).max(1).parse(result.data);
      if (rules.length) {
        if (rules[0].site_id !== rows[0].site_id) throw Error('Inconsistent rule');
        const { site_id: _siteId, ...value } = rules[0];
        rule = value;
      }
    }
    await access(rows.map(row => row.site_id));
    if (id) return Response.json({ approval: items[0], rule }, { headers });
    const visible = items.slice(0, 50), hasMore = items.length > 50, last = visible.at(-1);
    const next = hasMore && last ? Buffer.from(JSON.stringify({
      v: 1, actor, org, site, status: selected, at: last.created_at, id: last.id,
    })).toString('base64url') : null;
    return Response.json({ items: visible, page: { limit: 50, has_more: hasMore, next_cursor: next } }, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : 'Les approbations n’ont pas pu être vérifiées. Réessayez.' }, {
      status, headers: { ...headers, ...(status === 503 ? { 'Retry-After': '2' } : {}) },
    });
  }
}
export const GET = (request: Request) => read(request);
export const GET_DETAIL = (request: Request, context: Context) => read(request, context);
