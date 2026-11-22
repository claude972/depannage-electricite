import { authenticatedClient, ApiError } from "@/lib/supabase/server";
import { readBookingLocation } from "@/lib/features/workspace/booking-location-read";
import { detailIdSchema } from "@/lib/features/workspace/detail-read";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await authenticatedClient(request);
    const { id } = await context.params;
    if (!detailIdSchema.safeParse(id).success)
      return Response.json({ booking_location: null }, { headers });
    const booking_location = await readBookingLocation(db, id.toLowerCase());
    return Response.json({ booking_location }, { headers });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      return Response.json({ error: "Connectez-vous pour accéder à cet espace." }, { status: 401, headers });
    return Response.json(
      { error: "Les informations d’accès sont momentanément indisponibles." },
      { status: 503, headers: { ...headers, "Retry-After": "2" } },
    );
  }
}
