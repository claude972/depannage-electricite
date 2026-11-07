import { z } from 'zod';
import { authenticatedClient, ApiError, dbError } from '@/lib/supabase/server';
import { detailReadSchema, DETAIL_PROJECTIONS } from '@/lib/features/workspace/detail-read';
import { calculateQuote } from '@/lib/domain';

// Reuse the stored-decimal normalization and tax schema of the existing dossier detail.
// This endpoint returns the exact base quote, not an accepted total including amendments.
const quoteSchema = detailReadSchema.shape.quotes.options[0].shape.items.element
  .omit({ accepted_total_cents: true });
const interventionSchema = z.object({
  id: z.uuid(), artisan_id: z.uuid(),
  category: z.enum(['outage', 'panel', 'socket', 'lighting', 'diagnostic']),
  status: z.enum(['requested', 'assigned', 'quoted', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled']),
});
const sourceSchema = quoteSchema.extend({
  intervention: interventionSchema,
  author: z.object({ role: z.literal('artisan') }),
});
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const projection = [
  DETAIL_PROJECTIONS.quotes,
  'intervention:interventions!quotes_intervention_id_fkey!inner(id,artisan_id,category,status)',
  'author:profiles!quotes_artisan_id_fkey!inner(role)',
].join(',');

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await authenticatedClient();
    const parsedId = z.uuid().safeParse((await context.params).id);
    if (!parsedId.success || new URL(request.url).searchParams.size || request.url.length > 2048) {
      throw new ApiError(422, 'Identifiant ou paramètres invalides.');
    }
    const id = parsedId.data.toLowerCase();
    const actor = user.id.toLowerCase();
    const profile = await db.from('profiles').select('role').eq('id', actor).maybeSingle();
    dbError(profile.error);
    if (profile.data?.role !== 'artisan') throw new ApiError(403, 'Accès artisan requis.');

    const result = await db.from('quotes').select(projection)
      .eq('id', id).eq('artisan_id', actor)
      .eq('intervention.artisan_id', actor).eq('author.role', 'artisan').limit(2);
    dbError(result.error);
    const rows = z.array(sourceSchema).max(1).parse(result.data);
    if (!rows.length) throw new ApiError(404, 'Devis introuvable.');
    const row = rows[0];
    if (row.id !== id || row.artisan_id !== actor || row.intervention.artisan_id !== actor ||
        row.intervention.id !== row.intervention_id) throw new ApiError(404, 'Devis introuvable.');
    const { intervention, author: _author, ...quote } = row;
    const totals = calculateQuote(quote.lines, quote.tax_rate);
    if (totals.subtotal_cents !== quote.subtotal_cents || totals.tax_cents !== quote.tax_cents ||
        totals.total_cents !== quote.total_cents) throw Error('Unverifiable quote');
    return Response.json({ quote, intervention: {
      id: intervention.id, category: intervention.category, status: intervention.status,
    } }, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message :
      'Le devis n’a pas pu être vérifié. Réessayez.' }, {
      status, headers: { ...headers, ...(status === 503 ? { 'Retry-After': '2' } : {}) },
    });
  }
}
