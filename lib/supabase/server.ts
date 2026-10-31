import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new ApiError(
      503,
      "Les comptes sont en cours de configuration. La démonstration reste disponible.",
    );
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        for (const { name, value, options } of values)
          store.set(name, value, options);
      },
    },
  });
}
export async function authenticatedClient() {
  const db = await serverClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    throw new ApiError(401, "Connectez-vous pour accéder à cet espace.");
  return { db, user };
}
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new ApiError(
      503,
      "Le service sécurisé est en cours de configuration.",
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function apiError(error: unknown) {
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof SyntaxError)
    return Response.json(
      { error: "Le contenu envoyé est invalide." },
      { status: 400 },
    );
  return Response.json(
    { error: "L’action n’a pas pu être effectuée. Réessayez." },
    { status: 500 },
  );
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new ApiError(403, "Origine de la requête non autorisée.");
}
export function dbError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  const code = error.code;
  if (code === "53300")
    throw new ApiError(
      429,
      "Trop de tentatives. Patientez une minute puis réessayez.",
    );
  if (code === "42501" || code === "PGRST301")
    throw new ApiError(403, "Vous n’avez pas accès à cette action.");
  if (code === "P0002") throw new ApiError(404, "Ce dossier est introuvable.");
  if (code === "23505" || code === "P0001")
    throw new ApiError(
      409,
      "L’état du dossier a changé ou cette action n’est plus disponible. Actualisez la page.",
    );
  if (
    code === "22023" ||
    code === "23514" ||
    code === "22P02" ||
    code === "22007" ||
    code === "22008" ||
    code === "23502"
  )
    throw new ApiError(422, "Vérifiez les informations saisies.");
  throw new ApiError(
    503,
    "Les données sont momentanément indisponibles. Réessayez.",
  );
}
