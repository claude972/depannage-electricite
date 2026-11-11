// Pure content lists and guards of the public site (addendum « pages publiques »). Every string
// shown to a visitor on the public pages lives here or in public-site.tsx; the test
// tests/ui/public-lists.test.ts checks that none of them carries a promise, delay, counter,
// rating or contact detail copied from the reference mockups.
import type { Category } from "../app/types";

export type PublicStep = { icon: string; title: string; text: string };
export type PublicFact = { icon: string; title: string; text: string };
export type FaqEntry = { icon: string; question: string; answer: string };
export type PricingRow = { id: Category | string; icon: string; label: string; description: string; min: number; max: number };

/** Three steps of the landing card (M11): real product stages only. */
export const HOME_STEPS: PublicStep[] = [
  { icon: "edit", title: "Décrivez la panne", text: "Le problème, le lieu et votre besoin ; une estimation indicative s’affiche aussitôt." },
  { icon: "receipt", title: "Validez le devis", text: "L’artisan affecté détaille prestations, quantités et TVA ; rien ne commence sans votre accord." },
  { icon: "check", title: "Suivez et réglez", text: "Rendez-vous, déplacement, compte rendu et règlement au même endroit, une fois l’intervention terminée." },
];
/** Four facts of the reassurance strip (M11): product facts, never service promises. */
export const HOME_FACTS: PublicFact[] = [
  { icon: "document", title: "Devis avant travaux", text: "Accepté explicitement, version exacte." },
  { icon: "lock", title: "Règlement avec Stripe", text: "Après l’intervention, confirmé par le serveur." },
  { icon: "shield", title: "Attribution contrôlée", text: "Une mission, un seul artisan éligible." },
  { icon: "list", title: "Suivi au même endroit", text: "Demande, devis, échanges et documents." },
];
/** Four stages of the help page process card (M46): what the application really does. */
export const HELP_PROCESS: PublicStep[] = [
  { icon: "edit", title: "Décrire la panne", text: "Type de problème, lieu, description et photos facultatives. L’estimation affichée est une fourchette indicative." },
  { icon: "receipt", title: "Recevoir un devis", text: "Un artisan éligible accepte la demande puis établit un devis détaillé que vous acceptez avant tout travail." },
  { icon: "wrench", title: "Intervention", text: "Rendez-vous enregistré, déplacement et compte rendu consultables dans votre espace." },
  { icon: "euro", title: "Règlement et suivi", text: "Le paiement est proposé une fois l’intervention terminée, sur la base du devis accepté, et traité avec Stripe." },
];
// Wording kept verbatim from the previous public help page; only the icons are new (M70).
export const FAQ: FaqEntry[] = [
  { icon: "euro", question: "Quelle différence entre estimation et devis ?", answer: "L’estimation donne une fourchette indicative. Le devis est établi par l’artisan à partir de votre besoin et détaille les prestations, les taxes et le montant proposé. Vous le validez avant le début des travaux." },
  { icon: "lock", question: "Quand dois-je régler l’intervention ?", answer: "Le paiement est proposé une fois l’intervention terminée, sur la base du devis accepté, toujours sur la plateforme : par carte via votre suivi, un lien sécurisé ou un QR code. Jamais directement à l’artisan. Une redirection de paiement ne suffit pas à confirmer son encaissement." },
  { icon: "eye", question: "Comment suivre ma demande ?", answer: "Dans « Mes demandes », ouvrez une intervention pour consulter son état, son devis et les échanges associés." },
  { icon: "wrench", question: "Comment sont attribuées les missions ?", answer: "Un artisan éligible accepte une demande disponible. L’attribution est contrôlée pour qu’une même mission ne soit pas acceptée par plusieurs artisans. Aucun délai n’est garanti à ce stade." },
  { icon: "shield", question: "Où consulter les conditions de garantie ?", answer: "Les conditions de garantie de la plateforme figurent dans l’aide, rubrique Garantie, après publication par l’exploitant." },
  { icon: "building", question: "Puis-je gérer plusieurs établissements ?", answer: "L’espace professionnel regroupe les sites et leurs interventions. Il distingue copropriétés, restauration, bureaux et établissements recevant du public." },
  { icon: "offline", question: "Puis-je tester sans transmettre mes informations ?", answer: "Oui. La démonstration utilise des exemples et conserve ses modifications dans ce navigateur. Elle n’envoie aucune demande à un artisan et ne réalise aucun débit bancaire." },
];
/** Five parts of the artisan application (M60 checklist); text unchanged from the previous page. */
export const JOIN_STEPS: PublicStep[] = [
  { icon: "person", title: "Informations personnelles", text: "Nom, téléphone et adresse email professionnelle : les coordonnées utilisées pour vous joindre au sujet d’une mission." },
  { icon: "building", title: "Société", text: "Raison sociale, SIRET, statut juridique, effectif et adresse de l’entreprise." },
  { icon: "document", title: "Pièces justificatives", text: "Extrait Kbis, attestation d’assurance RC Pro et justificatif de qualification. Les fichiers sont déposés dans un stockage privé et consultés uniquement pour l’examen du dossier." },
  { icon: "location", title: "Zones d’intervention", text: "Les codes postaux que vous couvrez et les types de panne que vous traitez. Vous les modifiez depuis votre espace." },
  { icon: "calendar", title: "Disponibilité", text: "Un indicateur que vous activez ou désactivez à tout moment pour recevoir ou non des missions disponibles." },
];
/** Three facts under the join title (M60 shows three facts; ours are product facts). */
export const JOIN_FACTS: PublicFact[] = [
  { icon: "badge", title: "Dossier examiné", text: "Par l’opérateur, avant tout accès aux missions." },
  { icon: "location", title: "Missions ciblées", text: "Dans vos zones et catégories déclarées." },
  { icon: "euro", title: "Règlement suivi", text: "Traité avec Stripe depuis votre espace." },
];
/** What the artisan space allows (M60 advantages tiles); text unchanged. */
export const JOIN_TILES: PublicStep[] = [
  { icon: "briefcase", title: "Missions", text: "Recevoir, accepter ou décliner une mission disponible." },
  { icon: "receipt", title: "Devis", text: "Établir un devis détaillé (prestations, quantités, TVA) que le client accepte avant les travaux." },
  { icon: "truck", title: "Intervention", text: "Suivre l’intervention : rendez-vous, déplacement, compte rendu." },
  { icon: "euro", title: "Règlement", text: "Suivre le règlement du client, traité avec Stripe, en reliant votre compte Stripe depuis votre espace." },
];
export const JOIN_REVIEW: string[] = [
  "Vous complétez le dossier à votre rythme ; il reste en brouillon tant que vous ne le soumettez pas.",
  "Une fois soumis, il est examiné par l’opérateur de la plateforme. Il n’existe aucune validation automatique.",
  "L’opérateur peut demander des compléments, approuver ou suspendre un dossier. Vous voyez l’état courant dans votre espace.",
  "Les missions disponibles ne sont proposées qu’aux dossiers approuvés, dans les zones et catégories déclarées.",
];
/** Three principles of the about page value cards (V8-C03 shows three value cards). */
export const ABOUT_VALUES: PublicStep[] = [
  { icon: "document", title: "Devis avant travaux", text: "L’estimation affichée est une fourchette indicative. Les travaux ne commencent qu’après l’acceptation d’un devis détaillé établi par l’artisan." },
  { icon: "lock", title: "Paiement après intervention", text: "Le règlement est proposé une fois l’intervention terminée, sur la base du devis accepté, et traité avec Stripe. Aucun numéro de carte n’est stocké par l’application." },
  { icon: "shield", title: "Attribution contrôlée", text: "Une mission ne peut être acceptée que par un seul artisan éligible. Aucun délai d’intervention n’est garanti à ce stade." },
];
export const PRIVACY_DATA: { label: string; text: string }[] = [
  { label: "Compte", text: "adresse e-mail, prénom, nom, numéro de téléphone et rôle choisi. Le compte est confirmé par un lien envoyé à votre adresse e-mail ; l’authentification est gérée par le service d’identité de l’application." },
  { label: "Demandes", text: "type de panne, description, adresse, code postal, ville, niveau d’urgence et état de la demande." },
  { label: "Devis", text: "lignes de prestation, montants, taux de TVA, état et date d’acceptation." },
  { label: "Messages", text: "les échanges liés à une intervention entre le client et l’artisan affecté." },
  { label: "Demande de rappel", text: "si le formulaire est ouvert, le numéro saisi, le motif choisi et votre accord au rappel sont enregistrés pour l’assistance habilitée." },
  { label: "Documents", text: "les fichiers déposés (justificatifs, pièces liées à une intervention) sont conservés dans un stockage privé, accessible uniquement aux rôles autorisés." },
  { label: "Paiements", text: "le règlement est traité avec Stripe. L’application conserve l’état du paiement et son montant ; elle ne stocke aucun numéro de carte." },
  { label: "Application mobile", text: "le site n’envoie aucun code par SMS. Dans les versions de l’application mobile qui proposent de vérifier un numéro, un code à usage unique est envoyé par SMS par le service d’identité ; l’application ne conserve pas le code." },
  { label: "Adresses enregistrées", text: "les adresses que vous choisissez de mémoriser dans votre profil (nom, prénom, adresse, éventuelle position déclarée par vous). Elles sont privées ; vous pouvez les modifier ou les archiver." },
  { label: "Préférences de notification", text: "les canaux que vous activez ou désactivez dans votre profil." },
  { label: "Notifications du navigateur", text: "si vous les activez, l’adresse technique et les clés de l’abonnement de ce navigateur servent à lui envoyer une notification chiffrée. Vous pouvez désactiver cet abonnement." },
  { label: "Préanalyse d’une photo", text: "lorsque ce service est disponible, la photo choisie est envoyée avec votre accord. L’artisan attribué vérifie le résultat avant qu’il vous soit présenté." },
  { label: "Position pendant le déplacement", text: "seulement si l’artisan accepte de la partager : dernière position, précision et heure de mesure. Elle n’est plus lisible 60 secondes après sa mesure, puis elle est supprimée par une purge automatique du serveur, qui peut intervenir un peu plus tard ; l’artisan peut arrêter le partage à tout moment." },
  { label: "Dans votre navigateur", text: "un brouillon de demande non envoyé, le thème clair ou sombre choisi et, en démonstration, les exemples modifiés. Rien de cela n’est transmis à un tiers." },
];
/** Third parties the code really calls today (no analytics, no advertising tracker). */
export const PRIVACY_THIRD_PARTIES: { name: string; text: string }[] = [
  { name: "Supabase", text: "base de données, authentification et stockage privé des fichiers de l’application." },
  { name: "Stripe", text: "règlement par carte, une fois activé par l’exploitant ; les données de carte sont saisies chez Stripe, jamais dans l’application." },
  { name: "Resend", text: "si les notifications par e-mail sont ouvertes et que vous les activez, ce service reçoit votre adresse vérifiée et le contenu de la notification pour la transmettre." },
  { name: "Service de notifications du navigateur", text: "si vous inscrivez un navigateur, son service de notifications reçoit un message chiffré à transmettre à ce navigateur." },
  { name: "OpenAI", text: "si la préanalyse est ouverte et que vous la demandez, ce service traite la photo choisie pour proposer une catégorie et une indication de lisibilité." },
  { name: "OpenStreetMap (fonds de carte)", text: "lorsque la carte de suivi du déplacement est affichée, votre navigateur charge des tuiles de carte depuis tile.openstreetmap.org : le serveur de tuiles voit la zone affichée (autour de la position partagée par l’artisan et de la destination) et votre adresse IP. Le choix définitif d’un fournisseur de carte est en attente de décision de l’exploitant." },
  { name: "IGN Géoplateforme", text: "appelée par le serveur de l’application pour calculer un itinéraire (position partagée par l’artisan et destination confirmée) et pour proposer des adresses à partir du texte saisi, lors de la confirmation de la destination." },
];
/** Real controls available in the signed-in space. */
export const PRIVACY_CONTROLS: string[] = [
  "Profil → informations du compte (nom, téléphone).",
  "Profil → préférences de notification.",
  "Profil → adresses enregistrées (modifier, choisir l’adresse préférée, archiver).",
  "Profil → Mes données (télécharger ses données personnelles et déposer une demande d’effacement auprès de l’assistance).",
  "Artisan : arrêter le partage de position à tout moment depuis le dossier.",
  "Démonstration : bouton « Réinitialiser » du bandeau pour effacer les exemples de ce navigateur.",
];
/** Contact channels (PUB-04): only what really exists; the others are explicitly pending. */
export const CONTACT_CHANNELS: { label: string; state: "available" | "pending"; text: string }[] = [
  { label: "Assistance en ligne", state: "available", text: "Une fois connecté, écrivez à l’assistance depuis votre espace ; la réponse s’affiche dans votre espace." },
  { label: "Adresse e-mail de contact", state: "pending", text: "À renseigner par l’exploitant." },
  { label: "Téléphone", state: "pending", text: "À renseigner par l’exploitant. Cette version ne fournit pas de ligne d’urgence." },
];
/** Operator presentation (PUB-09): fields the owner must provide; nothing is filled in by default. */
export const OPERATOR_FIELDS: string[] = ["Nom de l’exploitant et forme juridique", "Personnes responsables", "Équipe", "Zone d’intervention couverte", "Coordonnées de contact"];
/** Pricing decisions still pending (PUB-02). */
export const PRICING_PENDING: string[] = ["Barème officiel", "Frais de déplacement", "Majorations (soir, week-end, urgence)", "Zone desservie"];
export const LEGAL_SECTIONS: { title: string; fields: string[] }[] = [
  { title: "Éditeur", fields: ["Raison sociale et forme juridique", "Adresse du siège", "Numéro SIREN et numéro de TVA", "Directeur ou directrice de la publication", "Adresse de contact"] },
  { title: "Hébergeur", fields: ["Nom de l’hébergeur", "Adresse", "Coordonnées de contact"] },
  { title: "Propriété intellectuelle", fields: ["Titulaire des droits sur le nom, le logo et les contenus"] },
  { title: "Données personnelles", fields: ["Responsable du traitement", "Contact pour l’exercice des droits"] },
];
export const PENDING = "À renseigner par l’exploitant";

/** "1. Éditeur" — numbering used by the legal and privacy documents (M63, V8-C05). */
export function numbered(index: number, title: string): string {
  return `${index + 1}. ${title}`;
}
/** Pricing rows derived from the visual categories and the domain bounds; nothing is typed by hand. */
export function pricingRows(
  categories: ReadonlyArray<{ id: string; icon: string; label: string; description: string }>,
  resolve: (id: string) => { min: number; max: number },
): PricingRow[] {
  return categories.map((c) => { const bounds = resolve(c.id); return { id: c.id, icon: c.icon, label: c.label, description: c.description, min: bounds.min, max: bounds.max }; });
}
/**
 * Expressions the reference mockups display as examples and that this site must never show:
 * delays, availability, guarantees, counters, ratings, percentages, phone numbers.
 */
export const FORBIDDEN_PUBLIC_CLAIMS: RegExp[] = [
  /\b24\s*h\s*\/\s*24/i,
  /\b24\s*\/\s*7\b/i,
  /\b7\s*j\s*\/\s*7/i,
  /sous\s+\d+\s*h\b/i,
  /sous\s+\d+\s*(?:à|-)\s*\d+\s*h/i,
  /\bgaranti(?:e|es|s)?\s+(?:1|un)\s+an\b/i,
  /prix\s+fixe/i,
  /sans\s+surco[uû]t/i,
  /aucune\s+majoration/i,
  /couverture\s+nationale/i,
  /\bmilliers\b/i,
  /\d[\d\s]*\+\s*(?:électriciens|missions|clients)/i,
  /\b\d,\d\s*\/\s*5\b/,
  /\b\d{1,3}\s*%/,
  /\b0\d(?:[ .]?\d{2}){4}\b/,
  /@[a-z0-9-]+\.[a-z]{2,}/i,
  /\bSIREN\s*:?\s*\d/i,
  /certifi(?:é|és|ée|ées)\b/i,
];
/** Every public string of the lists above, flattened for the guard test. */
export function publicStrings(): string[] {
  const out: string[] = [];
  for (const list of [HOME_STEPS, HOME_FACTS, HELP_PROCESS, JOIN_STEPS, JOIN_FACTS, JOIN_TILES, ABOUT_VALUES]) for (const item of list) out.push(item.title, item.text);
  for (const item of FAQ) out.push(item.question, item.answer);
  for (const item of PRIVACY_DATA) out.push(item.label, item.text);
  for (const item of PRIVACY_THIRD_PARTIES) out.push(item.name, item.text);
  for (const item of CONTACT_CHANNELS) out.push(item.label, item.text);
  out.push(...PRIVACY_CONTROLS, ...OPERATOR_FIELDS, ...PRICING_PENDING);
  for (const section of LEGAL_SECTIONS) out.push(section.title, ...section.fields);
  out.push(...JOIN_REVIEW, PENDING);
  return out;
}
export function forbiddenClaims(text: string): string[] {
  return FORBIDDEN_PUBLIC_CLAIMS.filter((re) => re.test(text)).map((re) => re.source);
}
