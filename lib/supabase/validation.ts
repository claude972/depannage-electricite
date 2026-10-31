import { z } from "zod";
import { ApiError } from "./server";
export const uuid = z.string().uuid();
export const quoteLine = z
  .object({
    label: z.string().trim().min(1).max(160),
    quantity: z.number().int().min(1).max(1000),
    unit_price_cents: z.number().int().min(0).max(10000000),
  })
  .strict();
export async function validated<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  if (Number(request.headers.get("content-length") || 0) > 65536)
    throw new ApiError(413, "Le contenu envoyé est trop volumineux.");
  const raw = await request.text();
  if (raw.length > 65536)
    throw new ApiError(413, "Le contenu envoyé est trop volumineux.");
  const result = schema.safeParse(JSON.parse(raw));
  if (!result.success)
    throw new ApiError(
      422,
      result.error.issues[0]?.message ?? "Vérifiez les informations saisies.",
    );
  return result.data;
}
