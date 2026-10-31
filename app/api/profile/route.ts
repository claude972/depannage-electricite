import { z } from 'zod';
import { authenticatedClient, apiError, assertOrigin, dbError } from '@/lib/supabase/server';
import { validated } from '@/lib/supabase/validation';
const schema = z.object({ full_name: z.string().trim().min(1).max(120), phone: z.string().trim().max(30) }).strict();
export async function PATCH(request: Request) {
  try {
    assertOrigin(request); const { db } = await authenticatedClient(); const data = await validated(request, schema);
    const { data: profile, error } = await db.rpc('update_profile', { p_full_name: data.full_name, p_phone: data.phone });
    dbError(error);
    return Response.json({ profile: profile ? { id: profile.id, full_name: profile.full_name, phone: profile.phone, role: profile.role, artisan_approved: profile.artisan_approved } : null });
  } catch (error) { return apiError(error); }
}
