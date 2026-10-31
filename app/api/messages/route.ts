import { z } from 'zod';
import { authenticatedClient, apiError, assertOrigin, dbError } from '@/lib/supabase/server';
import { uuid, validated } from '@/lib/supabase/validation';
const schema = z.object({ intervention_id: uuid, body: z.string().trim().min(1).max(4000) }).strict();
export async function POST(request: Request) {
  try {
    assertOrigin(request); const { db } = await authenticatedClient(); const data = await validated(request, schema);
    const { data: result, error } = await db.rpc('send_message', { p_intervention_id: data.intervention_id, p_body: data.body });
    dbError(error); return Response.json({ message: result }, { status: 201 });
  } catch (error) { return apiError(error); }
}
