import { z } from 'zod';
import { comparePostgresTime } from '@/lib/shared/postgres-time-order';
import { authenticatedClient, ApiError, dbError } from '@/lib/supabase/server';

const uuid = z.uuid().transform(value => value.toLowerCase());
const timestamp = z.iso.datetime({ offset: true }).regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/,
);
const statusFilter = z.enum(['all', 'sent', 'accepted', 'rejected']);
const cursorSchema = z.object({
  v: z.literal(1), actor: uuid, status: statusFilter, at: timestamp, id: uuid,
}).strict();
const interventionSchema = z.object({
  id: uuid,
  artisan_id: uuid,
  category: z.enum(['outage', 'panel', 'socket', 'lighting', 'diagnostic']),
  status: z.enum(['requested', 'assigned', 'quoted', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled']),
});
const rowSchema = z.object({
  id: uuid,
  intervention_id: uuid,
  artisan_id: uuid,
  status: z.enum(['sent', 'accepted', 'rejected']),
  total_cents: z.number().int().positive().max(10000000),
  created_at: timestamp,
  accepted_at: timestamp.nullable(),
  intervention: interventionSchema,
  author: z.object({ role: z.literal('artisan') }),
});
type Cursor = z.infer<typeof cursorSchema>;
type Position = { created_at: string; id: string };
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const projection = [
  'id,intervention_id,artisan_id,status,total_cents,created_at,accepted_at',
  'intervention:interventions!quotes_intervention_id_fkey!inner(id,artisan_id,category,status)',
  'author:profiles!quotes_artisan_id_fkey!inner(role)',
].join(',');

function readCursor(raw: string, actor: string, status: z.infer<typeof statusFilter>): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]{1,600}$/.test(raw)) throw Error();
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw Error();
    const cursor = cursorSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (cursor.actor !== actor || cursor.status !== status) throw Error();
    return cursor;
  } catch {
    throw new ApiError(422, 'Curseur invalide. Rechargez les devis.');
  }
}

function isOlder(row: Position, previous: Position): boolean {
  const order = comparePostgresTime(row.created_at, previous.created_at);
  return order < 0 || (order === 0 && row.id < previous.id);
}

export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    const actor = user.id.toLowerCase();
    const query = new URL(request.url).searchParams;
    const invalidQuery = [...query.keys()].some(key =>
      !['status', 'limit', 'cursor'].includes(key) || query.getAll(key).length !== 1,
    );
    if (request.url.length > 2048 || invalidQuery) {
      throw new ApiError(422, 'Paramètres invalides.');
    }
    const selected = statusFilter.safeParse(query.get('status') ?? 'all');
    const rawLimit = query.get('limit') ?? '50';
    if (!selected.success || !/^([1-9]|[1-4][0-9]|50)$/.test(rawLimit)) {
      throw new ApiError(422, 'Filtre ou limite invalide.');
    }
    const limit = Number(rawLimit);
    const cursor = query.has('cursor') ? readCursor(query.get('cursor')!, actor, selected.data) : null;
    const profile = await db.from('profiles').select('role').eq('id', actor).maybeSingle();
    dbError(profile.error);
    if (profile.data?.role !== 'artisan') throw new ApiError(403, 'Accès artisan requis.');

    // Both INNER relations are filtered in the same RLS-protected statement.
    // An old author loses the entry as soon as the dossier is assigned elsewhere.
    let quotes = db.from('quotes').select(projection)
      .eq('artisan_id', actor)
      .eq('intervention.artisan_id', actor)
      .eq('author.role', 'artisan');
    if (selected.data !== 'all') quotes = quotes.eq('status', selected.data);
    if (cursor) {
      quotes = quotes.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    }
    const result = await quotes.order('created_at', { ascending: false })
      .order('id', { ascending: false }).limit(limit + 1);
    dbError(result.error);

    const rows = z.array(rowSchema).max(limit + 1).parse(result.data);
    const seen = new Set<string>();
    let previous: Position | null = cursor ? { created_at: cursor.at, id: cursor.id } : null;
    for (const row of rows) {
      const wrongScope = row.artisan_id !== actor || row.intervention.artisan_id !== actor ||
        row.intervention.id !== row.intervention_id;
      const wrongStatus = selected.data !== 'all' && row.status !== selected.data;
      if (wrongScope || wrongStatus || seen.has(row.id) || (previous && !isOlder(row, previous))) {
        throw Error('Unverifiable page');
      }
      seen.add(row.id);
      previous = row;
    }
    const items = rows.slice(0, limit).map(row => ({
      id: row.id,
      intervention_id: row.intervention_id,
      status: row.status,
      total_cents: row.total_cents,
      created_at: row.created_at,
      accepted_at: row.accepted_at,
      intervention: {
        id: row.intervention.id,
        category: row.intervention.category,
        status: row.intervention.status,
      },
    }));
    const hasMore = rows.length > limit;
    const last = items.at(-1);
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({
      v: 1, actor, status: selected.data, at: last.created_at, id: last.id,
    })).toString('base64url') : null;
    return Response.json({
      items, page: { limit, has_more: hasMore, next_cursor: nextCursor }, order: 'newest_first',
    }, { headers });
  } catch (error) {
    const code = error instanceof ApiError ? error.status : 503;
    return Response.json({
      error: error instanceof ApiError ? error.message : 'Les devis n’ont pas pu être vérifiés. Réessayez.',
    }, { status: code, headers: { ...headers, ...(code === 503 ? { 'Retry-After': '2' } : {}) } });
  }
}
