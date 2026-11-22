import { z } from "zod";
import {
  ApiError,
  authenticatedClient,
  apiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { nativeTransport, normalizeWebPhone, WEB_PHONE_MESSAGE } from "@/lib/features/guest/phone-number";
import { validated } from "@/lib/supabase/validation";
const schema = z
  .object({
    full_name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(30),
    first_name: z.string().trim().min(1).max(60).optional(),
    last_name: z.string().trim().min(1).max(60).optional(),
  })
  .strict()
  .refine(value => (value.first_name === undefined && value.last_name === undefined)
    || (value.first_name !== undefined && value.last_name !== undefined
      && value.full_name === `${value.first_name} ${value.last_name}`),
    "Vérifiez le prénom et le nom.");
export async function PATCH(request: Request) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient(request);
    const data = await validated(request, schema);
    // Website: a client account always keeps a reachable number (+596, +590 or +33), stored in
    // international form. Professionals, administrators and native builds keep the former rule.
    if (!nativeTransport(request)) {
      const own = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
      dbError(own.error);
      if (own.data?.role === "client") {
        const phone = normalizeWebPhone(data.phone);
        if (!phone) throw new ApiError(422, WEB_PHONE_MESSAGE);
        data.phone = phone;
      }
    }
    const { data: profile, error } = await (data.first_name !== undefined && data.last_name !== undefined
      ? db.rpc("update_profile_name", {
          p_first_name: data.first_name,
          p_last_name: data.last_name,
          p_phone: data.phone,
        })
      : db.rpc("update_profile", { p_full_name: data.full_name, p_phone: data.phone }));
    dbError(error);
    return Response.json({
      profile: profile
        ? {
            id: profile.id,
            full_name: profile.full_name,
            first_name: profile.first_name,
            last_name: profile.last_name,
            phone: profile.phone,
            role: profile.role,
            artisan_approved: profile.artisan_approved,
          }
        : null,
    });
  } catch (error) {
    return apiError(error);
  }
}
