export const STEPS = [
  { title: "Décrivez la panne", text: "Indiquez ce qui ne fonctionne plus." },
  { title: "Précisez le lieu", text: "Indiquez l’adresse et le créneau souhaité." },
  { title: "Examinez le devis", text: "L’électricien présente son devis avant les travaux." },
];
export const MATCHING = [
  { title: "Vous décrivez la panne", text: "Indiquez les pièces ou appareils concernés et depuis quand la panne se manifeste." },
  { title: "On recherche un électricien dans votre secteur", text: "La recherche tient compte du type de panne et des disponibilités. Le rendez-vous confirmé apparaît dans votre dossier." },
  { title: "Vous décidez après le devis", text: "L’électricien vérifie la panne et détaille les travaux et leur coût. Vous pouvez accepter ou refuser." },
  { title: "Vous retrouvez le suivi dans votre dossier", text: "Le rendez-vous, les échanges et les documents sont regroupés dans le même dossier." },
];
export const COMMITMENTS: {
  icon: "receipt" | "shield" | "help";
  title: string;
  text: string;
  link?: { href: string; text: string };
}[] = [
  { icon: "receipt", title: "Le détail du prix", text: "Le devis indique le coût de la main-d’œuvre, du déplacement et des pièces, selon l’intervention." },
  { icon: "shield", title: "Votre accord avant les travaux", text: "Les travaux commencent après votre accord. Si d’autres travaux sont nécessaires, le devis mis à jour vous est soumis." },
  { icon: "help", title: "Une aide après l’intervention", text: "Votre dossier donne accès aux justificatifs et à l’assistance.", link: { href: "/#help/garantie", text: "Garantie et assistance" } },
];
const faq = (accountAnswer: string) => [
  { title: "Quel sera le prix du dépannage ?", text: "La fourchette est indicative. Le prix des travaux figure sur le devis que vous acceptez." },
  { title: "Que se passe-t-il après ma demande ?", text: "La recherche tient compte de votre commune et des disponibilités. Le rendez-vous apparaît dans votre dossier une fois confirmé." },
  { title: "Dois-je créer un compte pour suivre ma demande ?", text: accountAnswer, link: { href: "/suivi", text: "Suivre mon intervention" } },
  { title: "Comment se passe le règlement ?", text: "Le règlement se fait sur la plateforme, sur la base du devis accepté. Si l’empreinte bancaire est proposée, elle autorise un montant sans débit à la réservation." },
  { title: "À qui m’adresser après les travaux ?", text: "Retrouvez le devis et les justificatifs disponibles dans votre dossier. Vous pouvez contacter l’assistance si le problème persiste." },
];
/** Native application (builds already delivered included): the wording they were built with. */
export const FAQ = faq("Si la vérification par SMS est disponible, vous pouvez retrouver vos interventions avec le numéro associé à votre demande.");
/** Website: the account is an e-mail address and a password, confirmed by a link. No SMS code. */
export const WEB_FAQ = faq("Oui. Le compte se crée avec votre nom, votre adresse e-mail, votre téléphone et un mot de passe ; un lien reçu par e-mail le confirme. Vos demandes se retrouvent ensuite dans votre profil.");

