import type { Role } from './job-presentation';
export function spaceTabs(role?: Role) {
  if (role === 'artisan') return ['accueil', 'interventions', 'devis', 'messages', 'profil'] as const;
  if (role === 'manager' || role === 'admin') return ['accueil', 'interventions', 'messages', 'profil'] as const;
  return ['profil', 'interventions', 'messages', 'aide'] as const;
}
