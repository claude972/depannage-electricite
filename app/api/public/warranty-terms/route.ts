import {
  ApiError,
  apiError,
  dbError,
  publicClient,
} from "@/lib/supabase/server";
import { published } from "@/lib/features/warranty-policy/contract";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const q = new URL(request.url).searchParams;
    const v = q.get("version");
    if (
      [...q.keys()].some((k) => k !== "version") ||
      q.getAll("version").length > 1 ||
      (v !== null && (!/^[1-9][0-9]{0,9}$/.test(v) || Number(v) > 2147483647))
    )
      throw new ApiError(422, "Version invalide.");
    const db = publicClient();
    const r = await db.rpc("read_public_warranty_terms", {
      p_version: v === null ? null : Number(v),
    });
    dbError(r.error);
    const p = published.nullable().safeParse(r.data);
    if (
      !p.success ||
      (v !== null && p.data !== null && p.data.version !== Number(v))
    )
      throw new ApiError(
        503,
        "Les conditions publiées sont momentanément indisponibles.",
      );
    return Response.json({ published: p.data }, { headers });
  } catch (e) {
    const r = apiError(e);
    r.headers.set("Cache-Control", "no-store");
    return r;
  }
}
