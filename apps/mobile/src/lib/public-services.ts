import type { ImageContentPosition } from 'expo-image';
import { z } from 'zod';
import { useResource } from './api';
import { apiOrigin } from './config';
import { categories, category, prices, type Category } from './contracts';

const line = (max: number) => z.string().trim().min(1).max(max);
const lines = z.array(line(600)).max(30);
// Une photo absente ou mal formée retire seulement l’image de la fiche : la
// liste entière reste lisible.
const photo = z.object({ src: z.string().max(300), width: z.number().positive(), height: z.number().positive() });
const service = z.object({
  slug: z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category,
  title: line(200),
  photo: photo.nullable().catch(null),
  position: z.string().max(40).nullable().catch(null),
  alt: z.string().max(400).catch(''),
  intro: line(4000),
  covers: lines,
  checks: lines,
  extras: lines,
  faq: z.array(z.object({ question: line(400), answer: line(4000) })).max(30),
});
export const catalogueSchema = z.object({ items: z.array(service).max(60) });
export type PublicService = z.infer<typeof service>;

export const featuredSlugs = ['plusieurs-prises-sans-courant', 'disjoncteur-qui-saute', 'coupure-de-courant-partielle'] as const;

export function usePublicServices() {
  return useResource('/api/public/services', catalogueSchema);
}
export function useIndicativePrices() {
  return useResource('/api/public/indicative-prices', prices);
}

/** Fiches mises en avant sur l’accueil ; à défaut, les premières du catalogue. */
export function featuredServices(items: PublicService[]) {
  const picked = featuredSlugs
    .map(slug => items.find(item => item.slug === slug))
    .filter((item): item is PublicService => Boolean(item));
  return picked.length ? picked : items.slice(0, featuredSlugs.length);
}

export const categoryLabel = (key: Category) => categories[key];

// Seule forme admise : chemin relatif /home/….jpg servi par l’origine de l’API.
const photoPath = /^\/home\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.jpe?g$/;
export function servicePhotoUri(src: string | null | undefined) {
  if (!apiOrigin || !src || !photoPath.test(src)) return null;
  try {
    const url = new URL(src, apiOrigin);
    return url.origin === apiOrigin && url.pathname === src ? url.href : null;
  } catch {
    return null;
  }
}

/** Cadrage transmis par l’API (mot-clé simple ou « x% y% ») ; centré sinon. */
export function servicePhotoPosition(position: string | null | undefined): ImageContentPosition | undefined {
  const value = position?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === 'center' || value === 'top' || value === 'bottom' || value === 'left' || value === 'right') return value;
  const match = /^(\d{1,3})% (\d{1,3})%$/.exec(value);
  if (!match) return undefined;
  const left = Math.min(Number(match[1]), 100), top = Math.min(Number(match[2]), 100);
  return { left: `${left}%`, top: `${top}%` };
}

const wholeEuros = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const exactEuros = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amount = (cents: number) => (cents % 100 === 0 ? wholeEuros : exactEuros).format(cents / 100);

/**
 * Fourchette indicative d’une catégorie. Les montants viennent uniquement de
 * /api/public/indicative-prices ; null tant qu’ils ne sont pas disponibles.
 */
export function indicativeRange(data: z.infer<typeof prices> | null, key: Category) {
  const range = data?.ranges[key];
  if (!range) return null;
  const min = amount(range.min_cents), max = amount(range.max_cents);
  return range.min_cents === range.max_cents
    ? { text: `${min} €`, spoken: `${min} euros` }
    : { text: `${min}–${max} €`, spoken: `de ${min} à ${max} euros` };
}
