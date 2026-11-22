// Données commerciales validées par le propriétaire le 21 novembre 2026 et reprises telles quelles.
// Elles s’affichent sur les pages publiques (web et mobile) tant que le profil publié depuis
// l’administration ne fournit pas la même rubrique ; une valeur publiée en administration prévaut.
// Rien d’autre n’est déduit : les coordonnées de contact, l’hébergeur, le numéro de TVA et le
// titulaire des droits restent « À renseigner par l’exploitant » jusqu’à leur saisie.
export const COMMERCIAL_FACTS_VALIDATED_ON = "2026-11-21";

/** Identité de l’exploitant (mêmes clés que le profil opérateur publié). */
export const VALIDATED_OPERATOR = {
  legal_name: "TTBM",
  legal_form: "SARL",
  siren: "929507762",
  siret: "92950776200011",
  hq_address: "Cité Eucalyptus, 97240 Le François",
  publication_director: "Brafa Claude Thierry, gérant",
  privacy_controller: "TTBM SARL",
  service_area: "Martinique entière (codes postaux 972xx)",
} as const;
export type ValidatedOperatorField = keyof typeof VALIDATED_OPERATOR;

/** Immatriculation et représentant : aucune rubrique équivalente dans le profil opérateur. */
export const OPERATOR_REGISTRATION = "RCS Fort-de-France";
export const OPERATOR_MANAGER = "Brafa Claude Thierry";

/** Commission de la plateforme : 10 % (1 000 points de base, valeur attendue de PLATFORM_FEE_BPS). */
export const PLATFORM_COMMISSION_PERCENT = 10;
export const PLATFORM_COMMISSION_BPS = 1000;

/** Zone desservie : Martinique entière, soit tout code postal commençant par 972. */
export const COVERAGE_POSTAL_PREFIX = "972";
export const coveragePostalCodes = (): string[] =>
  Array.from({ length: 100 }, (_, index) => `${COVERAGE_POSTAL_PREFIX}${String(index).padStart(2, "0")}`);

/** Prix : barème horaire, devis précis avant travaux, majoration d’urgence de 25 %. */
export const URGENCY_SURCHARGE_PERCENT = 25;
export const PRICING_RULES: { label: string; text: string }[] = [
  { label: "Tarification", text: "Au barème horaire, avec un devis précis avant travaux. La grille par type de panne figure ci-dessous." },
  { label: "Devis", text: "Devis précis remis avant travaux ; rien ne commence sans votre accord." },
  { label: "Majoration d’urgence", text: `+${URGENCY_SURCHARGE_PERCENT} % pour une intervention demandée en urgence.` },
  { label: "Zone desservie", text: VALIDATED_OPERATOR.service_area },
];
export const URGENCY_NOTICE = `Intervention en urgence : majoration de ${URGENCY_SURCHARGE_PERCENT} %, indiquée sur le devis précis remis avant travaux.`;

/** Conditions du réseau artisans : seule la commission est arrêtée. */
export const NETWORK_COMMISSION_TEXT = `Commission de la plateforme : ${PLATFORM_COMMISSION_PERCENT} % du montant de l’intervention réglé sur la plateforme.`;

/** Garantie : portée par la plateforme (satisfaction, ré-intervention, remboursement). */
export const WARRANTY_SUMMARY = "Garantie de la plateforme : satisfaction, ré-intervention ou remboursement.";

export function validatedOperatorValue(field: string): string | null {
  return Object.prototype.hasOwnProperty.call(VALIDATED_OPERATOR, field)
    ? VALIDATED_OPERATOR[field as ValidatedOperatorField]
    : null;
}
