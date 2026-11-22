import type { Role } from './job-presentation';
export function spaceTabs(role?: Role) {
  if (role === 'artisan') return ['accueil', 'interventions', 'devis', 'messages', 'profil'] as const;
  if (role === 'manager') return ['accueil', 'organisations', 'interventions', 'messages', 'profil'] as const;
  if (role === 'admin') return ['accueil', 'interventions', 'annuaire', 'messages', 'profil'] as const;
  return ['profil', 'interventions', 'messages', 'aide'] as const;
}
