import { z } from 'zod';
import { authenticatedClient, apiError, assertOrigin, ApiError, dbError } from '@/lib/supabase/server';
import { uuid, validated } from '@/lib/supabase/validation';
const schema = z.object({ user_id: uuid, approved: z.boolean() }).strict();
export async function GET() {
  try {
    const { db, user } = await authenticatedClient();
    const profile = await db.from('profiles').select('role').eq('id', user.id).single(); dbError(profile.error);
    if (profile.data?.role !== 'admin') throw new ApiError(403, 'Accès réservé à l’administration.');
    const { data, error } = await db.from('profiles').select('id,full_name,artisan_approved,created_at').eq('role','artisan').order('created_at',{ascending:false}).limit(100);
    dbError(error); return Response.json({ artisans: data });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request); const { db } = await authenticatedClient(); const data = await validated(request, schema);
    const { error } = await db.rpc('approve_artisan', { p_user_id: data.user_id, p_approved: data.approved });
    dbError(error); return Response.json({ success: true });
  } catch (error) { return apiError(error); }
}
