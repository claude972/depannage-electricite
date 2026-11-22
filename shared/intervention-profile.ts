export const INTERVENTION_PROFILES = [
  { value: "particulier", label: "Particulier" },
  { value: "restaurant", label: "Restaurant" },
  { value: "airbnb", label: "Airbnb" },
  { value: "bureau", label: "Bureau" },
  { value: "autre", label: "Autre" },
] as const;

const household = {
  outage: {
    title: "Coupure de courant partielle",
    description: "Une pièce ou une partie du logement reste sans courant.",
    slug: "coupure-de-courant-partielle",
    photo: "outage",
  },
  socket: {
    title: "Prise qui ne fonctionne plus",
    description: "Une ou plusieurs prises n’alimentent plus les appareils.",
    slug: "prise-qui-ne-fonctionne-plus",
    photo: "socket",
  },
  panel: {
    title: "Disjoncteur qui saute",
    description: "Le courant se coupe lorsqu’un circuit ou un appareil démarre.",
    slug: "disjoncteur-qui-saute",
    photo: "panel",
  },
  light: {
    title: "Éclairage en panne",
    description: "Un luminaire ou une zone reste sans éclairage.",
    slug: "eclairage-qui-ne-sallume-plus",
    photo: "light",
  },
} as const;

export type RepairSituation = {
  title: string;
  description: string;
  slug: (typeof household)[keyof typeof household]["slug"];
  photo: keyof typeof household | "inspection";
};

const commonRepairs = Object.values(household);
const restaurantRepairs: RepairSituation[] = [
  { ...household.outage, title: "Coupure de courant en cuisine", description: "Une zone de préparation ou plusieurs prises n’ont plus de courant." },
  { ...household.socket, photo: "inspection", title: "Chambre froide sans alimentation", description: "La prise ou le circuit qui alimente la chambre froide est en panne." },
  { ...household.socket, title: "Hotte sans courant", description: "L’alimentation électrique de la hotte de cuisine ne répond plus." },
  { ...household.light, title: "Éclairage de la salle en panne", description: "Une partie de la salle ou de l’accueil reste sans lumière." },
];
const officeRepairs: RepairSituation[] = [
  { ...household.socket, title: "Prises des postes de travail hors service", description: "Plusieurs postes d’un même espace ne sont plus alimentés." },
  { ...household.light, title: "Éclairage de l’open space en panne", description: "Un secteur de travail ou un couloir reste sans lumière." },
  { ...household.panel, title: "Disjoncteur de la salle de réunion", description: "Le circuit coupe quand les équipements de la salle démarrent." },
  { ...household.outage, title: "Coupure de courant sur un étage", description: "Un étage ou une aile du bâtiment perd son alimentation." },
];

export function repairSituations(profile: string): readonly RepairSituation[] {
  if (profile === "restaurant") return restaurantRepairs;
  if (profile === "bureau") return officeRepairs;
  return commonRepairs;
}
