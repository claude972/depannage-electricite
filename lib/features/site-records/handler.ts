import { z } from 'zod';
import { authenticatedClient, ApiError, dbError } from '@/lib/supabase/server';
import { comparePostgresTime } from '@/lib/shared/postgres-time-order';

const uuid = z.uuid().transform(value => value.toLowerCase());
const timestamp = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const kinds = z.enum(['open', 'past', 'upcoming', 'completed', 'audits']);
const jobStatuses = ['requested', 'assigned', 'quoted', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled'] as const;
const jobSchema = z.object({
  id: uuid, site_id: uuid, category: z.enum(['outage', 'panel', 'socket', 'lighting', 'diagnostic']),
  status: z.enum(jobStatuses), created_at: timestamp,
});
const complianceSchema = z.object({
  id: uuid, site_id: uuid, title: z.string().min(1).max(160),
  kind: z.enum(['audit', 'maintenance', 'safety', 'equipment', 'contract']), due_on: z.iso.date(),
  status: z.enum(['pending', 'scheduled', 'completed']), notes: z.string().max(4000),
});
const cursorSchema = z.object({
  v: z.literal(1), actor: uuid, site: uuid, kind: kinds, at: z.string().max(40), id: uuid,
}).strict();
type Cursor = z.infer<typeof cursorSchema>;
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await authenticatedClient();
    const actor = user.id.toLowerCase();
    const siteResult = uuid.safeParse((await context.params).id);
    const params = new URL(request.url).searchParams;
    const selected = kinds.safeParse(params.get('kind'));
    if (!siteResult.success || !selected.success || request.url.length > 2048 ||
        [...params.keys()].some(key => !['kind', 'cursor'].includes(key) || params.getAll(key).length !== 1)) {
      throw new ApiError(422, 'Paramètres invalides.');
    }
    const site = siteResult.data, kind = selected.data;
    const jobs = kind === 'open' || kind === 'past';
    const dateField = jobs ? 'created_at' : 'due_on';
    let cursor: Cursor | null = null;
    if (params.has('cursor')) {
      try {
        const raw = params.get('cursor')!;
        if (!/^[A-Za-z0-9_-]{1,600}$/.test(raw)) throw Error();
        const bytes = Buffer.from(raw, 'base64url');
        if (bytes.toString('base64url') !== raw) throw Error();
        cursor = cursorSchema.parse(JSON.parse(bytes.toString('utf8')));
        if (cursor.actor !== actor || cursor.site !== site || cursor.kind !== kind ||
            !(jobs ? timestamp : z.iso.date()).safeParse(cursor.at).success) throw Error();
      } catch { throw new ApiError(422, 'Curseur invalide. Rechargez cette liste.'); }
    }
    async function access() {
      const profile = await db.from('profiles').select('role').eq('id', actor).maybeSingle();
      dbError(profile.error);
      if (profile.data?.role !== 'manager') throw new ApiError(403, 'Accès entreprise requis.');
      const visible = await db.from('sites').select('id').eq('id', site).maybeSingle();
      dbError(visible.error);
      if (!visible.data || visible.data.id !== site) throw new ApiError(404, 'Site introuvable.');
    }
    await access();
    const fields = jobs ? 'id,site_id,category,status,created_at' : 'id,site_id,title,kind,due_on,status,notes';
    let query = db.from(jobs ? 'interventions' : 'compliance_records').select(fields).eq('site_id', site);
    const states = kind === 'open' ? jobStatuses.slice(0, 5) : kind === 'past' ? jobStatuses.slice(5) :
      kind === 'upcoming' ? ['pending', 'scheduled'] : kind === 'completed' ? ['completed'] : null;
    if (states) query = query.in('status', states);
    if (kind === 'audits') query = query.in('kind', ['audit', 'safety']);
    if (cursor) {
      const op = jobs ? 'lt' : 'gt';
      query = query.or(`${dateField}.${op}.${cursor.at},and(${dateField}.eq.${cursor.at},id.${op}.${cursor.id})`);
    }
    const result = await query.order(dateField, { ascending: !jobs }).order('id', { ascending: !jobs }).limit(51);
    dbError(result.error);
    const rows = jobs ? z.array(jobSchema).max(51).parse(result.data) : z.array(complianceSchema).max(51).parse(result.data);
    const at = (row: typeof rows[number]) => 'created_at' in row ? row.created_at : row.due_on;
    let previous = cursor ? { at: cursor.at, id: cursor.id } : null;
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.site_id !== site || seen.has(row.id) || (states && !states.includes(row.status)) ||
          (kind === 'audits' && (!('kind' in row) || !['audit', 'safety'].includes(row.kind)))) throw Error('Invalid scope');
      if (previous) {
        const order = jobs ? comparePostgresTime(at(row), previous.at) : at(row).localeCompare(previous.at);
        const direction = order || (row.id < previous.id ? -1 : row.id > previous.id ? 1 : 0);
        if (jobs ? direction >= 0 : direction <= 0) throw Error('Invalid order');
      }
      previous = { at: at(row), id: row.id };
      seen.add(row.id);
    }
    await access(); // Re-check role/site after the read; no stale authorization from bootstrap.
    const items = rows.slice(0, 50), hasMore = rows.length > 50, last = items.at(-1);
    const next = hasMore && last ? Buffer.from(JSON.stringify({
      v: 1, actor, site, kind, at: at(last), id: last.id,
    })).toString('base64url') : null;
    return Response.json({ items, page: { limit: 50, has_more: hasMore, next_cursor: next } }, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : 'Les données du site n’ont pas pu être vérifiées. Réessayez.' }, {
      status, headers: { ...headers, ...(status === 503 ? { 'Retry-After': '2' } : {}) },
    });
  }
}
