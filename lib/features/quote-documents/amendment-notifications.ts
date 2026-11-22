// CLI-07 — in-app notifications of quote amendments (proposed, withdrawn, accepted, rejected).
// The database has no trigger on quote_amendments and the `notifications.kind` CHECK list has no
// amendment kind, so the route writes the notification itself, AFTER the SQL command confirmed the
// change, through the private `public.notify` function (service role only): same recipient rules,
// muted kinds and dedupe as every other notification. The kind is the closest existing one
// (quote_received / quote_accepted / quote_rejected) and `payload.subject = "quote_amendment"`
// tells the notification centre to label it as an amendment, never as a quote.
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatEuro } from "./format";

export type AmendmentEvent = "proposed" | "withdrawn" | "accepted" | "rejected";
export type AmendmentFacts = {
  id: string;
  intervention_id: string;
  base_quote_id: string;
  artisan_id: string;
  reference: string;
  total_cents: number;
};
export type AmendmentNotification = {
  recipient: "requester" | "artisan";
  kind: "quote_received" | "quote_accepted" | "quote_rejected";
  title: string;
  body: string;
  dedupe: string;
  payload: Record<string, unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Same reference as SQL `intervention_reference` and the screens: INT- + first 6 hex digits. */
export function interventionReference(id: string): string {
  return `INT-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/** Strict read of the amendment returned by the SQL command; null when it cannot be trusted. */
export function amendmentFacts(value: unknown): AmendmentFacts | null {
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  for (const key of ["id", "intervention_id", "base_quote_id", "artisan_id"] as const) if (typeof a[key] !== "string" || !UUID.test(a[key] as string)) return null;
  if (typeof a.reference !== "string" || !a.reference.trim() || a.reference.length > 80) return null;
  if (typeof a.total_cents !== "number" || !Number.isSafeInteger(a.total_cents) || a.total_cents < 0) return null;
  return { id: a.id as string, intervention_id: a.intervention_id as string, base_quote_id: a.base_quote_id as string, artisan_id: a.artisan_id as string, reference: a.reference.trim(), total_cents: a.total_cents };
}

/** Pure: who is told what. The amount is the amendment's own TTC total computed by the server. */
export function buildAmendmentNotification(event: AmendmentEvent, a: AmendmentFacts): AmendmentNotification {
  const dossier = interventionReference(a.intervention_id);
  const amount = `${formatEuro(a.total_cents)} TTC`;
  const payload = { subject: "quote_amendment", event, amendment_id: a.id, quote_id: a.base_quote_id, amendment_reference: a.reference, reference: dossier, total_cents: a.total_cents };
  const dedupe = `amendment:${a.id}:${event}`;
  if (event === "proposed")
    return { recipient: "requester", kind: "quote_received", title: "Avenant proposé", body: `L’artisan propose l’avenant ${a.reference} (${amount}) sur le devis accepté de votre demande ${dossier}. Il attend votre décision : rien n’est ajouté au montant à régler sans votre accord.`, dedupe, payload };
  if (event === "withdrawn")
    return { recipient: "requester", kind: "quote_received", title: "Avenant retiré par l’artisan", body: `L’artisan a retiré l’avenant ${a.reference} (${amount}) de votre demande ${dossier}. Aucune décision n’est plus attendue et le montant à régler n’est pas modifié.`, dedupe, payload };
  if (event === "accepted")
    return { recipient: "artisan", kind: "quote_accepted", title: "Avenant accepté", body: `L’avenant ${a.reference} (${amount}) du dossier ${dossier} a été accepté. Il s’ajoute au devis accepté.`, dedupe, payload };
  return { recipient: "artisan", kind: "quote_rejected", title: "Avenant refusé", body: `L’avenant ${a.reference} (${amount}) du dossier ${dossier} a été refusé. Le devis accepté reste inchangé.`, dedupe, payload };
}

/** Best effort, after the command is confirmed: a notification failure never undoes or fails the
 *  amendment command. Returns whether the notify call was issued without error (for tests/logs). */
export async function notifyAmendment(getAdmin: () => SupabaseClient, event: AmendmentEvent, amendment: unknown, actorId: string): Promise<boolean> {
  try {
    const facts = amendmentFacts(amendment);
    if (!facts) return false;
    const n = buildAmendmentNotification(event, facts);
    const admin = getAdmin();
    let recipient: string | null = facts.artisan_id;
    if (n.recipient === "requester") {
      const job = await admin.from("interventions").select("client_id").eq("id", facts.intervention_id).maybeSingle();
      recipient = job.error || !job.data ? null : ((job.data as { client_id: string | null }).client_id ?? null);
    }
    if (!recipient || recipient === actorId) return false;
    const sent = await admin.rpc("notify", { p_recipient: recipient, p_kind: n.kind, p_title: n.title, p_body: n.body, p_dedupe: n.dedupe, p_intervention: facts.intervention_id, p_actor: actorId, p_payload: n.payload });
    return !sent.error;
  } catch {
    return false;
  }
}
