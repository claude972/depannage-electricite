import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBookingLocation, type BookingLocation } from "../../../shared/booking-location";

/** The scoped RPC verifies the current assignment in the same statement as the read. */
export async function readBookingLocation(db: SupabaseClient, id: string): Promise<BookingLocation | null> {
  const { data, error } = await db.rpc("read_booking_location", { p_intervention_id: id });
  if (!error) {
    if (data === null) return null;
    const location = parseBookingLocation(data);
    if (location) return location;
  }
  throw new Error("Les informations d’accès sont momentanément indisponibles.");
}
