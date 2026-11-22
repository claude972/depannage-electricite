// SYS-06 — validity and versions of an artisan's credentials (pure, shared by the admin file and the
// artisan's « Mes documents »). The only date used is `expires_on` (« valable jusqu’au »), compared
// with today's local date. Rules:
//   · the CURRENT version of a kind is the most recently linked credential; older ones are
//     « remplacées » and never count ;
//   · a current credential whose date is passed is « expirée » and is NOT counted as valid ;
//   · « expire bientôt » is a display warning for the last EXPIRING_SOON_DAYS days. It is a screen
//     threshold, not a retention or legal duration, and nothing is deleted or blocked by it ;
//   · a credential without a date is shown as such (never presented as « valide jusqu’au »).
export const EXPIRING_SOON_DAYS = 30;
export type ValidityState = "valid" | "expiring" | "expired" | "undated";
export type Validity = { state: ValidityState; label: string; tone: "green" | "amber" | "red" | "neutral"; days: number | null };
export type CredentialRow = { id: string; kind: string; expires_on?: string | null; created_at: string; document_id?: string };

const DAY = 86_400_000;
const parseDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
/** A calendar date (YYYY-MM-DD) in French, without any time-zone shift. */
export const frenchDay = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(parseDay(iso)));

/** `today` and `expiresOn` are local calendar dates (YYYY-MM-DD). The day of expiry is still valid. */
export function validityOf(expiresOn: string | null | undefined, today: string): Validity {
  if (!expiresOn || !/^\d{4}-\d{2}-\d{2}/.test(expiresOn)) return { state: "undated", label: "Sans date de validité renseignée", tone: "neutral", days: null };
  const days = Math.round((parseDay(expiresOn) - parseDay(today)) / DAY);
  if (days < 0) return { state: "expired", label: `Expirée depuis le ${frenchDay(expiresOn)}`, tone: "red", days };
  if (days <= EXPIRING_SOON_DAYS)
    return { state: "expiring", label: days === 0 ? `Expire aujourd’hui (${frenchDay(expiresOn)})` : `Expire bientôt : dans ${days} jour${days > 1 ? "s" : ""} (${frenchDay(expiresOn)})`, tone: "amber", days };
  return { state: "valid", label: `Valable jusqu’au ${frenchDay(expiresOn)}`, tone: "green", days };
}

export type KindVersions<T extends CredentialRow> = { kind: string; current: T; validity: Validity; superseded: T[] };
/** Versions per kind, newest first: the first is the current one, the others were replaced by it. */
export function credentialVersions<T extends CredentialRow>(credentials: readonly T[], today: string): KindVersions<T>[] {
  const byKind = new Map<string, T[]>();
  for (const credential of credentials) byKind.set(credential.kind, [...(byKind.get(credential.kind) ?? []), credential]);
  return [...byKind.entries()].map(([kind, rows]) => {
    const sorted = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? 1 : -1));
    return { kind, current: sorted[0], validity: validityOf(sorted[0].expires_on, today), superseded: sorted.slice(1) };
  });
}

export type ValiditySummary = { required: number; transmitted: number; valid: number; expired: number; expiring: number; missing: number; label: string };
/** Count over the required kinds. « valid » excludes expired and missing credentials; a credential
 *  without a date is transmitted and not expired, so it counts (the reviewer decides on its content). */
export function validitySummary(credentials: readonly CredentialRow[], requiredKinds: readonly string[], today: string): ValiditySummary {
  const versions = new Map(credentialVersions(credentials, today).map((entry) => [entry.kind, entry]));
  let transmitted = 0, valid = 0, expired = 0, expiring = 0;
  for (const kind of requiredKinds) {
    const entry = versions.get(kind);
    if (!entry) continue;
    transmitted++;
    if (entry.validity.state === "expired") expired++;
    else {
      valid++;
      if (entry.validity.state === "expiring") expiring++;
    }
  }
  const required = requiredKinds.length, missing = required - transmitted;
  const parts = [`${valid} pièce${valid > 1 ? "s" : ""} en cours de validité sur ${required} obligatoire${required > 1 ? "s" : ""}`];
  if (expired) parts.push(`${expired} expirée${expired > 1 ? "s" : ""} (non comptée${expired > 1 ? "s" : ""})`);
  if (expiring) parts.push(`${expiring} expire${expiring > 1 ? "nt" : ""} bientôt`);
  if (missing) parts.push(`${missing} manquante${missing > 1 ? "s" : ""}`);
  return { required, transmitted, valid, expired, expiring, missing, label: parts.join(" · ") };
}
export const REQUIRED_CREDENTIAL_KINDS = ["registration", "liability", "qualification"] as const;
