// Website account creation. The screen checks the same fields, but this is where they are required:
// first name, last name, e-mail, phone (+596, +590 or +33) and password. The account is confirmed
// by the link sent to the e-mail address (/auth/confirm); no code is sent by SMS.
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { ApiError, serverClient } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { normalizeWebPhone, WEB_PHONE_MESSAGE } from "@/lib/features/guest/phone-number";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const text = (message: string, max: number) => z.string({ error: message }).trim().min(1, message).max(max, message);
const EMAIL_MESSAGE = "Indiquez une adresse e-mail valide.";
const PASSWORD_MESSAGE = "Choisissez un mot de passe de 10 à 128 caractères.";
export const signupSchema = z.object({
  first_name: text("Indiquez votre prénom (60 caractères au plus).", 60),
  last_name: text("Indiquez votre nom (60 caractères au plus).", 60),
  email: z.string({ error: EMAIL_MESSAGE }).trim().toLowerCase().max(254, EMAIL_MESSAGE).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, EMAIL_MESSAGE),
  phone: z.string({ error: WEB_PHONE_MESSAGE }).max(40, WEB_PHONE_MESSAGE).transform((value, ctx) => {
    const phone = normalizeWebPhone(value);
    if (!phone) { ctx.addIssue({ code: "custom", message: WEB_PHONE_MESSAGE }); return z.NEVER; }
    return phone;
  }),
  password: z.string({ error: PASSWORD_MESSAGE }).min(10, PASSWORD_MESSAGE).max(128, PASSWORD_MESSAGE),
  role: z.enum(["client", "artisan", "manager"], { error: "Choisissez votre espace : particulier, artisan ou professionnel." }),
}, { error: "Vérifiez les informations saisies." }).strict()
  .refine(value => `${value.first_name} ${value.last_name}`.length <= 120, "Prénom et nom : 120 caractères au plus.");

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function refused(error: unknown): never {
  const e = record(error) ? error : {}, code = typeof e.code === "string" ? e.code : "", status = typeof e.status === "number" ? e.status : 0;
  if (status === 429 || code.startsWith("over_")) throw new ApiError(429, "Trop de tentatives. Patientez quelques minutes avant de réessayer.");
  if (code === "weak_password") throw new ApiError(422, "Ce mot de passe est trop simple. Choisissez-en un plus long ou moins courant.");
  if (code === "email_address_invalid" || code === "validation_failed") throw new ApiError(422, EMAIL_MESSAGE);
  if (["user_already_exists", "email_exists", "identity_already_exists"].includes(code))
    throw new ApiError(409, "Un compte existe déjà avec cette adresse. Connectez-vous, ou utilisez « Mot de passe oublié ».");
  throw new ApiError(503, "La création de compte est momentanément indisponible. Réessayez.");
}

function statelessSignupClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new ApiError(503, "La création de compte est momentanément indisponible. Réessayez.");
  // The browser that opens the e-mail never shares a PKCE verifier with the native request.
  return createClient(url, key, { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function signupRoute(request: Request, transport: "web" | "native" = "web"): Promise<Response> {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const native = transport === "native";
    if ((!native || origin !== null) && origin !== url.origin)
      throw new ApiError(403, "Origine de la requête non autorisée.");
    if (url.search) throw new ApiError(422, "Vérifiez les informations saisies.");
    const data = await validated(request, signupSchema);
    if (native && data.role !== "client") throw new ApiError(422, "L’inscription dans l’application est réservée aux particuliers.");
    const db = native ? statelessSignupClient() : await serverClient();
    const result = await db.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: { full_name: `${data.first_name} ${data.last_name}`, first_name: data.first_name, last_name: data.last_name, role: data.role, phone: data.phone },
        emailRedirectTo: new URL("/auth/confirm", url.origin).href,
      },
    });
    if (result.error) refused(result.error);
    if (!record(result.data) || !record(result.data.user) || typeof result.data.user.id !== "string") refused(null);
    // Native sign-in always takes place in the app, regardless of the provider's confirmation setting.
    const status = !result.data.session ? { status: "confirmation_required" }
      : native ? { status: "sign_in_required" }
      : { status: "signed_in", user_id: result.data.user!.id };
    return Response.json(status, { status: 201, headers: HEADERS });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 503;
    const message = error instanceof ApiError ? error.message : status === 400 ? "Le contenu envoyé est invalide." : "La création de compte est momentanément indisponible. Réessayez.";
    return Response.json({ error: message }, { status, headers: { ...HEADERS, ...(status === 503 ? { "Retry-After": "2" } : status === 429 ? { "Retry-After": "60" } : {}) } });
  }
}
