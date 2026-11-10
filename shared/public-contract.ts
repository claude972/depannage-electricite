// Frontière publique réellement partagée par le Web et le mobile : les trois lectures publiées
// (zone par code postal, profil de l’exploitant, conditions de garantie).
// Fichier sans import ni dépendance : Next et Metro le lisent tel quel.
//   Web    : schémas zod de lib/features/{coverage,public-operator-profile,warranty-policy}/contract.ts
//   Mobile : schémas construits depuis cette description (apps/mobile/src/lib/published-info.ts)
//   SQL    : public.valid_public_operator_profile (dernière migration qui la définit)
// tests/release-contract.test.ts échoue dès que l’un des trois s’en écarte.

export const PUBLIC_PATHS = {
  coverage: "/api/public/coverage",
  operatorProfile: "/api/public/operator-profile",
  warrantyTerms: "/api/public/warranty-terms",
} as const;

// ---- Zone par code postal : GET ?postal_code=NNNNN → { status, version } ---------------------------
export const POSTAL_CODE_PATTERN = "^[0-9]{5}$";
/** « unknown » : aucune zone publiée (version null). Les deux autres portent la version publiée. */
export const COVERAGE = { unpublished: "unknown", published: ["covered", "not_covered"] } as const;

// ---- Conditions de garantie : GET → { published: null | { version, title, body, published_at } } ----
export const MAX_VERSION = 2147483647;
export const WARRANTY_TERMS = { titleMax: 160, bodyMax: 20000 } as const;

// ---- Profil de l’exploitant : GET → { published: null | { version, profile, published_at } } --------
/** text : texte libre, espaces de bord retirés, 1 à max caractères. email : text + forme d’adresse.
 *  code : motif exact (max = longueur maximale admise par le motif, reprise telle quelle en SQL). */
export type FieldRule =
  | { kind: "text"; max: number }
  | { kind: "email"; max: number }
  | { kind: "code"; max: number; pattern: string };
export const EMAIL_PATTERN = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

const text = (max: number): FieldRule => ({ kind: "text", max });
const email = (max: number): FieldRule => ({ kind: "email", max });
const code = (max: number, pattern: string): FieldRule => ({ kind: "code", max, pattern });

/** Tous les champs sont facultatifs dans un brouillon ; aucun autre champ n’est admis. */
export const OPERATOR_PROFILE_FIELDS = {
  legal_name: text(160),
  legal_form: text(80),
  siren: code(9, "^[0-9]{9}$"),
  siret: code(14, "^[0-9]{14}$"),
  vat_number: code(16, "^[A-Z]{2}[0-9A-Z]{2,14}$"),
  hq_address: text(500),
  publication_director: text(160),
  public_email: email(254),
  privacy_email: email(254),
  privacy_controller: text(200),
  privacy_retention: text(2000),
  privacy_notice: text(8000),
  public_phone: code(16, "^[+][1-9][0-9]{6,14}$"),
  host_name: text(160),
  host_address: text(500),
  host_contact: text(254),
  rights_holder: text(160),
  display_name: text(120),
  about_text: text(2000),
  team_text: text(4000),
  service_area: text(500),
  network_terms: text(8000),
};
export type OperatorProfileField = keyof typeof OPERATOR_PROFILE_FIELDS;

/** Champs sans lesquels rien n’est publié. Le SIRET n’en fait pas partie : il reste facultatif. */
export const OPERATOR_PROFILE_REQUIRED: readonly OperatorProfileField[] = [
  "legal_name", "legal_form", "siren", "hq_address", "publication_director",
  "public_email", "privacy_email", "host_name", "host_address", "host_contact", "rights_holder",
];

/** Un SIRET (14 chiffres) n’est admis qu’avec le SIREN dont il reprend les neuf premiers chiffres. */
export function siretMatchesSiren(siret: string, siren: string | null | undefined): boolean {
  return typeof siren === "string" && siren.length === 9 && siret.slice(0, 9) === siren;
}
