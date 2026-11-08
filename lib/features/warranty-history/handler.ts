import process from "node:process";

import { z } from 'zod';
import { authenticatedClient, ApiError, dbError } from '@/lib/supabase/server';
import { comparePostgresTime } from '@/lib/shared/postgres-time-order';

const uuid = z.uuid().transform(v => v.toLowerCase());
const time = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const rowSchema = z.object({
  id: uuid, intervention_id: uuid, client_id: uuid, description: z.string().min(10).max(4000),
  status: z.enum(['submitted', 'reviewing', 'resolved', 'declined']), resolution: z.string().max(4000),
  created_at: time, updated_at: time, terms_version: z.number().int().positive().nullable(),
});
const fields = 'id,intervention_id,client_id,description,status,resolution,created_at,updated_at,terms_version';
const cursorSchema = z.object({ v: z.literal(1), actor: uuid, intervention: uuid.nullable(), at: time, id: uuid }).strict();
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };

export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    const actor = uuid.parse(user.id), params = new URL(request.url).searchParams;
    const parsed = uuid.nullable().safeParse(params.get('intervention_id'));
    if (request.url.length > 2048 || !parsed.success || [...params.keys()].some(k => !['intervention_id', 'cursor'].includes(k) || params.getAll(k).length !== 1)) {
      throw new ApiError(422, 'Paramètres invalides.');
    }
    const intervention = parsed.data;
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (params.has('cursor')) {
      try {
        const raw = params.get('cursor')!;
        if (!/^[A-Za-z0-9_-]{1,600}$/.test(raw)) throw Error();
        const bytes = Buffer.from(raw, 'base64url');
        if (bytes.toString('base64url') !== raw) throw Error();
        cursor = cursorSchema.parse(JSON.parse(bytes.toString('utf8')));
        if (cursor.actor !== actor || cursor.intervention !== intervention) throw Error();
      } catch { throw new ApiError(422, 'Curseur invalide. Rechargez le suivi.'); }
    }
    async function access(ids: string[]) {
      if (!ids.length) return;
      const result = await db.from('interventions').select('id').in('id', ids).limit(101);
      dbError(result.error);
      const rows = z.array(z.object({ id: uuid })).max(101).parse(result.data);
      if (rows.length !== ids.length || new Set(rows.map(r => r.id)).size !== ids.length || rows.some(r => !ids.includes(r.id))) {
        throw new ApiError(404, 'Dossier introuvable.');
      }
    }
    if (intervention) await access([intervention]);
    let query = db.from('warranty_cases').select(fields);
    if (intervention) query = query.eq('intervention_id', intervention);
    if (cursor) query = query.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(101);
    dbError(result.error);
    const rows = z.array(rowSchema).max(101).parse(result.data);
    let previous = cursor ? { at: cursor.at, id: cursor.id } : null;
    for (const row of rows) {
      if (intervention && row.intervention_id !== intervention) throw Error('Inconsistent dossier');
      if (previous) {
        const order = comparePostgresTime(row.created_at, previous.at);
        if (order > 0 || (order === 0 && row.id >= previous.id)) throw Error('Inconsistent order');
      }
      previous = { at: row.created_at, id: row.id };
    }
    let hasActive: boolean | null = null;
    if (intervention) {
      const active = await db.from('warranty_cases').select('id,intervention_id,status').eq('intervention_id', intervention).in('status', ['submitted', 'reviewing']).limit(2);
      dbError(active.error);
      const activeRows = z.array(z.object({ id: uuid, intervention_id: uuid, status: z.enum(['submitted', 'reviewing']) })).max(1).parse(active.data);
      if (activeRows.some(r => r.intervention_id !== intervention)) throw Error('Inconsistent active dossier');
      hasActive = activeRows.length === 1;
    }
    const gate = await db.rpc('warranty_requests_enabled');
    dbError(gate.error);
    const enabled = z.boolean().parse(gate.data);
    await access([...new Set([...(intervention ? [intervention] : []), ...rows.map(r => r.intervention_id)])]);
    const cases = rows.slice(0, 100), last = cases.at(-1);
    const next = rows.length > 100 && last ? Buffer.from(JSON.stringify({ v: 1, actor, intervention, at: last.created_at, id: last.id })).toString('base64url') : null;
    return Response.json({ cases, enabled: process.env.WARRANTY_REQUESTS_ENABLED === 'true' && enabled, next_cursor: next, has_active: hasActive }, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : 'Le suivi n’a pas pu être vérifié. Réessayez.' }, { status, headers: { ...headers, ...(status === 503 ? { 'Retry-After': '2' } : {}) } });
  }
}
