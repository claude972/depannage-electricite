// Logique pure des points d’ancrage des lots avancés (WEB-SHARED-001) dans les coques de rôle.
// Sans React : testée par tests/ui/anchors.test.ts. La visibilité d’un menu ne confère aucun droit :
// une entrée n’apparaît que si le rôle y a accès (ACCESS) et que la capacité n’est pas absente.
import type { ContractState, Role } from "../app/types";
import type { LeafScope } from "../../lib/features/planning/leaf";

/**
 * Entrée de menu d’un lot : visible quand le rôle est admis et que la capacité est disponible ou
 * encore en vérification. Capacité `missing`/`unavailable` : l’entrée reste visible seulement si
 * elle mène à l’écran d’indisponibilité honnête (`leadsToHonestState`), jamais à un menu sans action.
 */
export function anchorEntryVisible(
  allowed: boolean,
  capability: ContractState,
  leadsToHonestState = true,
): boolean {
  if (!allowed) return false;
  if (capability === "available" || capability === "unknown") return true;
  return leadsToHonestState;
}

/** Portée transmise aux feuilles : identité et contexte connus de la session, jamais recalculés. */
export function leafScope(
  userId: string,
  role: Role,
  authority: { canWrite: boolean; reason?: string },
  context: { organizationId?: string; siteId?: string } = {},
): LeafScope {
  return {
    userId,
    role,
    ...(context.organizationId ? { organizationId: context.organizationId } : {}),
    ...(context.siteId ? { siteId: context.siteId } : {}),
    authority: authority.reason ? { canWrite: authority.canWrite, reason: authority.reason } : { canWrite: authority.canWrite },
  };
}
