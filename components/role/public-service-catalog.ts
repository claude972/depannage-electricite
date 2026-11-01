// Public service pages (FASTSPLIT-PUBLIC-SERVICE-PAGES-001): the single catalogue shared by the
// home cards and /prestations/<slug>. Pure data, no React, no window. Every price is the canonical
// indicative estimate of the business category (lib/domain.ts CATEGORIES): never a fixed or
// guaranteed price, never a delay or a warranty. Photos are local illustrations credited in
// public/home/CREDITS.md. Copy is original and deliberately sober.
import { CATEGORIES } from "../../lib/domain";
import type { Category } from "../app/types";

export type ServicePhoto = { src: string; width: number; height: number };
export type ServiceEntry = {
  slug: string;
  category: Category;
  title: string;
  photo: ServicePhoto;
  /** CSS object-position of the photo in cards and in the page hero. */
  position: string;
  alt: string;
  intro: string;
  covers: string[];
  checks: string[];
  /** Possible separately quoted items, « selon le diagnostic » — never a contractual exclusion. */
  extras: string[];
  faq: { question: string; answer: string }[];
};

export const SERVICE_PHOTOS = {
  panel: { src: "/home/section-real-panel.jpg", width: 1200, height: 900 },
  panelWork: { src: "/home/hero-photo-2.jpg", width: 1800, height: 1350 },
  cabinet: { src: "/home/hero-photo-1.jpg", width: 1800, height: 1200 },
  /** Wall sockets (mechanisms of a double outlet). */
  outlet: { src: "/home/section-outlet.jpg", width: 1000, height: 1498 },
  /** Wall fixture being fitted, wires from the ceiling: lighting, never sockets. */
  fixture: { src: "/home/section-socket.jpg", width: 1000, height: 667 },
} as const satisfies Record<string, ServicePhoto>;

export const SERVICES: ServiceEntry[] = [
  {
    slug: "panne-tableau-electrique",
    category: "panel",
    title: "Panne de tableau électrique",
    photo: SERVICE_PHOTOS.panel,
    position: "center 45%",
    alt: "Électricien intervenant sur un tableau électrique ouvert (photo d’illustration)",
    intro: "Un tableau qui ne réarme plus, un différentiel qui déclenche ou un module qui chauffe : l’artisan recherche la cause avant de remplacer quoi que ce soit.",
    covers: ["Disjoncteur ou interrupteur différentiel qui ne se réarme pas", "Module qui chauffe, grésille ou sent le chaud", "Tableau ancien dont un circuit ne répond plus"],
    checks: ["Contrôle visuel des modules et des serrages", "Test des différentiels et de l’isolement des circuits", "Remplacement d’un module défectueux, sur devis accepté"],
    extras: ["Le remplacement complet du tableau ou sa mise en conformité", "La fourniture de modules au-delà de ceux à remplacer", "Des travaux sur d’autres circuits que celui en cause"],
    faq: [
      { question: "Puis-je réarmer moi-même le tableau ?", answer: "N’ouvrez pas le tableau et ne forcez pas un réarmement. S’il chauffe, sent le brûlé ou porte des traces noires, ne le réarmez pas et faites-le vérifier par un professionnel." },
      { question: "Le remplacement complet du tableau est-il inclus ?", answer: "L’estimation n’est qu’une fourchette indicative. Ce que comprend l’intervention est précisé dans le devis détaillé de l’artisan, que vous acceptez avant tout travail." },
    ],
  },
  {
    slug: "prise-qui-ne-fonctionne-plus",
    category: "socket",
    title: "Prise qui ne fonctionne plus",
    photo: SERVICE_PHOTOS.outlet,
    position: "center 55%",
    alt: "Mécanismes d’une double prise murale en cours de pose (photo d’illustration)",
    intro: "Une prise reste sans courant alors que le reste du logement fonctionne : la panne peut venir de la prise elle-même, de son câblage ou du circuit qui l’alimente.",
    covers: ["Prise sans courant, le reste du logement fonctionnant", "Appareil qui ne s’allume que par intermittence", "Prise qui bouge ou se détache du mur"],
    checks: ["Mesure de la tension et de la continuité du circuit", "Contrôle des connexions de la prise", "Remplacement du mécanisme si nécessaire, sur devis accepté"],
    extras: ["La création d’une nouvelle prise ou d’un nouveau circuit", "La fourniture d’un modèle de prise particulier", "Les reprises de peinture ou de plâtre autour de la prise"],
    faq: [
      { question: "Dois-je couper le courant en attendant ?", answer: "N’utilisez plus la prise. Si elle présente une trace de chauffe, coupez le disjoncteur du circuit concerné." },
      { question: "Le prix de la prise est-il compris ?", answer: "Le devis détaillé de l’artisan précise la main-d’œuvre et le matériel éventuel avant toute intervention." },
    ],
  },
  {
    slug: "disjoncteur-qui-saute",
    category: "panel",
    title: "Disjoncteur qui saute",
    photo: SERVICE_PHOTOS.panelWork,
    position: "60% 45%",
    alt: "Électricien travaillant sur une rangée de disjoncteurs (photo d’illustration)",
    intro: "Un disjoncteur qui saute protège l’installation : surcharge, court-circuit ou défaut d’isolement. L’objectif est d’en trouver la cause, pas seulement de le réarmer.",
    covers: ["Disjoncteur qui saute dès qu’un appareil est branché", "Déclenchements répétés sans raison apparente", "Différentiel qui coupe tout le logement"],
    checks: ["Recherche d’une surcharge ou d’un appareil en défaut", "Mesure d’isolement circuit par circuit", "Remplacement d’un disjoncteur défaillant, sur devis accepté"],
    extras: ["La réparation des appareils électroménagers en cause", "Le remplacement du tableau électrique", "Une modification de la puissance de l’abonnement"],
    faq: [
      { question: "Que noter avant de faire votre demande ?", answer: "Notez les appareils qui fonctionnaient au moment où le disjoncteur a sauté. Ne démontez rien et ne renouvelez pas l’essai si un appareil, une prise ou le tableau présente une anomalie : chaleur, odeur ou traces noires." },
      { question: "Un disjoncteur plus puissant réglerait-il le problème ?", answer: "Non. Le calibre dépend du câble qu’il protège ; seul l’artisan peut juger d’un remplacement." },
    ],
  },
  {
    slug: "coupure-de-courant-partielle",
    category: "outage",
    title: "Coupure de courant partielle",
    photo: SERVICE_PHOTOS.cabinet,
    position: "30% 35%",
    alt: "Électricien en tenue haute visibilité contrôlant une armoire électrique (photo d’illustration)",
    intro: "Une partie du logement n’a plus de courant : une pièce, un étage ou un groupe de circuits. L’artisan vérifie d’abord le tableau puis remonte jusqu’au circuit en cause.",
    covers: ["Une pièce ou un étage sans courant", "Plusieurs circuits coupés en même temps", "Courant qui revient puis repart"],
    checks: ["Contrôle de l’arrivée et du tableau", "Recherche du circuit ou de la connexion en défaut", "Réparation de la liaison concernée, sur devis accepté"],
    extras: ["Une intervention sur le réseau de distribution ou les parties communes de l’immeuble", "La réfection complète d’un circuit", "La fourniture de matériel au-delà de la réparation"],
    faq: [
      { question: "D’où peut venir une coupure partielle ?", answer: "Elle peut venir du réseau de distribution, de l’installation commune de l’immeuble ou de votre propre installation. Consultez les informations du gestionnaire de l’immeuble ; l’origine n’est établie qu’après vérification." },
      { question: "Que préciser dans ma demande ?", answer: "Les pièces concernées, depuis quand, et si un disjoncteur est en position basse." },
    ],
  },
  {
    slug: "prise-abimee-ou-qui-chauffe",
    category: "socket",
    title: "Prise abîmée ou qui chauffe",
    photo: SERVICE_PHOTOS.outlet,
    position: "center 45%",
    alt: "Mécanismes d’une double prise murale, cache retiré (photo d’illustration)",
    intro: "Une prise qui chauffe, noircit ou crépite signale une mauvaise connexion. Cessez de l’utiliser : l’artisan contrôle la prise et son raccordement.",
    covers: ["Prise qui chauffe ou noircit", "Odeur de brûlé près d’une prise", "Prise fendue ou mal fixée"],
    checks: ["Contrôle des connexions et de l’état des conducteurs", "Vérification de la protection du circuit", "Remplacement de la prise, sur devis accepté"],
    extras: ["Le remplacement de toutes les prises de la pièce", "La création d’un circuit dédié pour un appareil puissant", "Les reprises de finition autour de la prise"],
    faq: [
      { question: "Que faire en attendant ?", answer: "Cessez d’utiliser la prise et ne la démontez pas. Faites vérifier la prise et son circuit par un professionnel." },
      { question: "Faut-il changer toutes les prises de la pièce ?", answer: "Pas nécessairement. Le diagnostic indique ce qui doit l’être, et le devis détaillé le précise avant toute intervention." },
    ],
  },
  {
    slug: "eclairage-qui-ne-sallume-plus",
    category: "lighting",
    title: "Éclairage qui ne s’allume plus",
    photo: SERVICE_PHOTOS.fixture,
    position: "30% 40%",
    alt: "Artisan fixant un luminaire mural, fils d’alimentation apparents (photo d’illustration)",
    intro: "Un plafonnier, une applique ou tout un circuit d’éclairage reste éteint alors que les ampoules sont bonnes : interrupteur, raccordement ou circuit peuvent être en cause.",
    covers: ["Luminaire qui ne s’allume plus malgré une ampoule neuve", "Circuit d’éclairage entièrement éteint", "Éclairage qui clignote ou s’allume seul"],
    checks: ["Contrôle de l’interrupteur et du raccordement du luminaire", "Mesure sur le circuit d’éclairage", "Remplacement de l’élément défectueux, sur devis accepté"],
    extras: ["La fourniture d’un nouveau luminaire", "La pose de nouveaux points lumineux", "Les ampoules ou tubes à remplacer"],
    faq: [
      { question: "Que préciser dans ma demande ?", answer: "Indiquez si un seul point lumineux ou plusieurs sont concernés, et depuis quand, sans démonter le luminaire ni l’interrupteur." },
      { question: "La fourniture d’un nouveau luminaire est-elle incluse ?", answer: "L’estimation reste indicative. La fourniture éventuelle d’un luminaire, comme le reste de l’intervention, est précisée dans le devis détaillé de l’artisan." },
    ],
  },
  {
    slug: "plusieurs-prises-sans-courant",
    category: "socket",
    title: "Plusieurs prises sans courant",
    photo: SERVICE_PHOTOS.outlet,
    position: "center 60%",
    alt: "Double prise murale en cours de raccordement (photo d’illustration)",
    intro: "Plusieurs prises d’une même pièce ou d’un même circuit ne fonctionnent plus : la cause est souvent commune, une connexion ou une protection en amont.",
    covers: ["Plusieurs prises d’une pièce sans courant", "Prises d’un même circuit qui coupent ensemble", "Prises coupées après un orage ou des travaux"],
    checks: ["Identification du circuit concerné au tableau", "Recherche de la connexion interrompue entre les prises", "Réparation du raccordement, sur devis accepté"],
    extras: ["La création de prises supplémentaires", "La rénovation complète du circuit", "Les reprises de finition des murs"],
    faq: [
      { question: "Les prises sont-elles toutes sur le même circuit ?", answer: "Souvent, mais pas toujours. Indiquez les pièces concernées : l’artisan le vérifiera au tableau." },
      { question: "Puis-je utiliser une rallonge en attendant ?", answer: "Évitez de multiplier les rallonges depuis une autre pièce, surtout pour des appareils puissants." },
    ],
  },
  {
    slug: "origine-de-la-panne-inconnue",
    category: "diagnostic",
    title: "Origine de la panne inconnue",
    photo: SERVICE_PHOTOS.cabinet,
    position: "60% 50%",
    alt: "Électricien effectuant des contrôles dans une armoire électrique (photo d’illustration)",
    intro: "Vous ne savez pas d’où vient le problème : panne intermittente, odeur de chaud ou comportement inhabituel. La recherche de panne commence par un diagnostic méthodique.",
    covers: ["Panne intermittente difficile à reproduire", "Odeur de chaud sans source identifiée", "Plusieurs symptômes à la fois"],
    checks: ["Relevé des symptômes avec vous", "Mesures sur le tableau et les circuits suspects", "Proposition d’une réparation chiffrée, sur devis accepté"],
    extras: ["La réparation elle-même, chiffrée après le diagnostic", "Le remplacement d’appareils défectueux", "Des travaux de mise en conformité de l’installation"],
    faq: [
      { question: "Que se passe-t-il après le diagnostic ?", answer: "L’artisan vous propose un devis pour la réparation. Rien n’est engagé tant que vous ne l’avez pas accepté." },
      { question: "Comment décrire une panne intermittente ?", answer: "Notez quand elle survient, ce qui fonctionnait à ce moment et ce qui s’est coupé : ces détails orientent la recherche." },
    ],
  },
];

/** The 4 steps shown on every service page (same flow as the real product). */
export const SERVICE_STEPS: { title: string; text: string }[] = [
  { title: "Décrivez la panne", text: "Type de problème, lieu et description, en quelques étapes." },
  { title: "Estimation indicative", text: "Une fourchette s’affiche dès la description ; ce n’est pas un prix garanti." },
  { title: "Devis de l’artisan", text: "L’artisan établit un devis détaillé ; rien n’est engagé avant votre accord." },
  { title: "Intervention et suivi", text: "Rendez-vous, intervention et compte rendu consultables dans votre espace." },
];

export function serviceBySlug(slug: string): ServiceEntry | null {
  return SERVICES.find((s) => s.slug === slug) ?? null;
}
/** Canonical indicative range of a business category (cents), from lib/domain.ts. */
export function serviceEstimate(category: Category): { min: number; max: number; label: string } {
  const c = CATEGORIES.find((x) => x.id === category);
  if (!c) throw new Error(`unknown category ${category}`);
  return { min: c.min, max: c.max, label: c.label };
}
/** Related services for a page: same category first, then the catalogue order; never `slug`. */
export function relatedServices(slug: string, count = 3): ServiceEntry[] {
  const current = serviceBySlug(slug);
  const others = SERVICES.filter((s) => s.slug !== slug);
  const same = others.filter((s) => s.category === current?.category);
  return [...same, ...others.filter((s) => s.category !== current?.category)].slice(0, count);
}
export const servicePath = (slug: string) => `/prestations/${slug}`;
/** Opens the existing public request form with the category pre-selected (hash routing). */
export const serviceRequestHref = (category: Category) => `/#new/${category}`;
