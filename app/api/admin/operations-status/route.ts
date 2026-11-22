// SYS-09 — operational state of the platform, for administrators.
// Each line is a check actually performed by THIS request (database, file storage, sign-in service)
// or a fact read from the server configuration (payment provider, outbound notifications). Nothing
// is assumed: a check that fails is reported with its error, and what the application cannot know
// (backups, restore tests, alerting — they belong to the hosting providers) is stated as unknown.
import { adminClient, apiError, ApiError, authenticatedClient, dbError } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
type Check = { key: string; label: string; state: "ok" | "error" | "not_configured" | "unknown"; detail: string; duration_ms?: number };
async function timed(key: string, label: string, okDetail: string, work: () => Promise<string | null>): Promise<Check> {
  const started = Date.now();
  try {
    const failure = await Promise.race([work(), new Promise<string>(resolve => setTimeout(() => resolve("aucune réponse en 8 secondes"), 8000))]);
    return failure ? { key, label, state: "error", detail: failure, duration_ms: Date.now() - started } : { key, label, state: "ok", detail: okDetail, duration_ms: Date.now() - started };
  } catch (error) {
    return { key, label, state: "error", detail: error instanceof Error ? error.message.slice(0, 200) : "erreur inattendue", duration_ms: Date.now() - started };
  }
}
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient(request);
    const profile = await db.from("profiles").select("role").eq("id", user.id).single();
    dbError(profile.error);
    if (profile.data?.role !== "admin") throw new ApiError(403, "Accès réservé à l’administration.");
    const admin = adminClient();
    const [database, storage, signIn] = await Promise.all([
      timed("database", "Base de données", "Lecture réussie.", async () => {
        const result = await admin.from("profiles").select("id", { count: "exact", head: true });
        return result.error ? `lecture refusée : ${result.error.message.slice(0, 160)}` : null;
      }),
      timed("storage", "Stockage des documents", "Espace de stockage privé joignable.", async () => {
        const result = await admin.storage.getBucket("intervention-documents");
        return result.error ? `espace de stockage injoignable : ${result.error.message.slice(0, 160)}` : result.data.public ? "l’espace de stockage est public alors qu’il doit être privé" : null;
      }),
      timed("auth", "Service de connexion", "Service de comptes joignable.", async () => {
        const result = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
        return result.error ? `service de comptes injoignable : ${result.error.message.slice(0, 160)}` : null;
      }),
    ]);
    const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
    const live = /^(sk|rk)_live_/.test(stripeKey);
    const payment: Check = !stripeKey
      ? { key: "payment", label: "Prestataire de paiement", state: "not_configured", detail: "Aucune clé de paiement sur ce serveur : aucun paiement en ligne ne peut être créé ici." }
      : { key: "payment", label: "Prestataire de paiement", state: "ok", detail: live ? (process.env.STRIPE_LIVE_PAYMENTS_ENABLED === "true" ? "Clé de production configurée, paiements réels activés." : "Clé de production configurée, paiements réels non activés.") : "Clé de test configurée : aucun paiement réel." };
    const webhook: Check = process.env.STRIPE_WEBHOOK_SECRET
      ? { key: "payment_webhook", label: "Confirmation des paiements par le prestataire", state: "ok", detail: "Secret de signature configuré. La bonne réception des confirmations se vérifie dans Finance > rapprochement." }
      : { key: "payment_webhook", label: "Confirmation des paiements par le prestataire", state: "not_configured", detail: "Secret de signature absent sur ce serveur : les confirmations du prestataire ne peuvent pas y être vérifiées." };
    const outbound: Check = process.env.NOTIFICATION_RESEND_API_KEY || process.env.NOTIFICATIONS_EMAIL_PROVIDER
      ? { key: "outbound", label: "E-mails et notifications externes", state: "ok", detail: "Un fournisseur d’envoi est configuré sur ce serveur." }
      : { key: "outbound", label: "E-mails et notifications externes", state: "not_configured", detail: "Aucun fournisseur d’envoi configuré : aucun e-mail, SMS ni alerte ne part de ce serveur." };

    // Last recorded incidents (business-level, from the database). Server execution errors are not
    // stored by the application: they are in the host's runtime logs.
    const [failedPayment, conflict] = await Promise.all([
      admin.from("payment_attempts").select("failure_code,updated_at").not("failure_code", "is", null).order("updated_at", { ascending: false }).limit(1),
      admin.from("platform_audit").select("action,created_at").in("action", ["refund_terminal_conflict"]).order("id", { ascending: false }).limit(1),
    ]);
    const incidents: { key: string; label: string; at: string | null; detail: string }[] = [
      failedPayment.error
        ? { key: "payment_failure", label: "Dernier paiement en échec", at: null, detail: "lecture impossible pour l’instant" }
        : failedPayment.data?.[0]
          ? { key: "payment_failure", label: "Dernier paiement en échec", at: failedPayment.data[0].updated_at as string, detail: `code ${String(failedPayment.data[0].failure_code).slice(0, 60)}` }
          : { key: "payment_failure", label: "Dernier paiement en échec", at: null, detail: "aucun échec enregistré" },
      conflict.error
        ? { key: "refund_conflict", label: "Dernier conflit de remboursement", at: null, detail: "lecture impossible pour l’instant" }
        : conflict.data?.[0]
          ? { key: "refund_conflict", label: "Dernier conflit de remboursement", at: conflict.data[0].created_at as string, detail: "à examiner dans Finance" }
          : { key: "refund_conflict", label: "Dernier conflit de remboursement", at: null, detail: "aucun conflit enregistré" },
    ];
    const checks = [database, storage, signIn, payment, webhook, outbound];
    return Response.json({
      checked_at: new Date().toISOString(),
      environment: process.env.VERCEL_ENV ?? "local",
      checks,
      failing: checks.filter(check => check.state === "error").map(check => check.key),
      incidents,
      not_observable: [
        { key: "backups", label: "Sauvegardes de la base", detail: "Gérées par l’hébergeur de la base (Supabase). L’application ne peut ni les lister ni les déclencher : leur existence et leur date se vérifient dans la console de l’hébergeur." },
        { key: "restore", label: "Test de restauration", detail: "Aucun test de restauration n’est enregistré par l’application. La procédure écrite est dans docs/EXPLOITATION_REPRISE.md ; elle doit être exécutée et datée par l’exploitant." },
        { key: "alerting", label: "Alertes automatiques", detail: "Aucune alerte n’est émise par l’application. Les erreurs d’exécution du serveur se consultent dans les journaux de l’hébergeur web (Vercel) ; un destinataire d’alerte reste à désigner par l’exploitant." },
      ],
    }, { headers });
  } catch (error) { const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
}
