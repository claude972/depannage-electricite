export const REQUEST_DESCRIPTION_LABEL = 'Décrivez la panne (facultatif)';
export const REQUEST_PHOTO_LABEL = 'Ajouter une photo (facultatif)';

/** Keep older APIs and saved dossiers compatible with the existing minimum length. */
export function requestDescription(notes: string | undefined, categoryLabel: string): string {
  const text = notes?.trim() ?? '';
  return text.length >= 10 ? text : [`Dépannage électrique — ${categoryLabel}`, text].filter(Boolean).join('\n');
}
