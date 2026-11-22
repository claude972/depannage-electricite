import { z } from 'zod';
import { Copy } from './ui';
import { useResource } from '@/lib/api';
import { coverageSchema, isPostalCode, PUBLIC_PATHS } from '@/lib/published-info';

const availability = z.object({ availability: z.enum(['available', 'none']) });

/**
 * CLI-03 — avis honnête sur un récapitulatif ou un dossier encore en recherche (mêmes formulations que le Web).
 * Hors de la zone publiée, sinon aucun artisan disponible aujourd’hui, sinon rien. Une erreur, une zone non
 * publiée ou une réponse hors contrat n’affichent aucun avis : le dépôt d’une demande n’est jamais bloqué.
 */
export function CoverageNotice({ code }: { code: string }) {
  const valid = isPostalCode(code);
  const zone = useResource(valid ? `${PUBLIC_PATHS.coverage}?postal_code=${code}` : null, coverageSchema);
  const outside = zone.data?.status === 'not_covered';
  const today = useResource(valid && zone.data && !outside ? `${PUBLIC_PATHS.coverage}/availability?postal_code=${code}` : null, availability);
  if (outside) return <Copy kind="muted">Le code postal {code} ne figure pas dans la zone publiée par l’exploitant : il est possible qu’aucun artisan ne puisse prendre votre demande. Elle reste enregistrée et aucun délai n’est garanti.</Copy>;
  if (today.data?.availability === 'none') return <Copy kind="muted">Aucun artisan disponible dans votre zone pour le moment (code postal {code}). Votre demande reste enregistrée et sera proposée dès qu’un artisan desservira ce secteur ; aucun délai n’est garanti.</Copy>;
  return null;
}
