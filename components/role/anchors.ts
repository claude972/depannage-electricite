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
/** Transient failure → the shell offers a bounded "Réessayer" (re-probe); missing → honest state only. */
export { retryableState } from "../app/features";

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

// ---- Back-office plateforme (ADV-PLATFORM-FINANCE-001) : entrées et autorité fail-closed ----
import { platformViewAllowed, type PlatformView } from "../app/features";
import type { PlatformAccess } from "../../lib/features/platform-operations/types";

export type PlatformEntry = { view: PlatformView; label: string; icon: string };
export const PLATFORM_ENTRIES: readonly PlatformEntry[] = [
  { view: "platform-operators", label: "Opérateurs", icon: "users" },
  { view: "platform-finance", label: "Finance", icon: "euro" },
  { view: "platform-moderation", label: "Modération", icon: "flag" },
];

/**
 * Entrées de back-office proposées à un utilisateur : seule la réponse serveur `/me`
 * (`platformAccess`) ouvre une entrée ; sans réponse (null, inconnu, périmé) aucune entrée.
 * `allowed(view)` est le garde de rôle existant (`canAccess`), jamais contourné.
 */
export function platformEntries(
  access: PlatformAccess | null | undefined,
  allowed: (view: PlatformView) => boolean,
): PlatformEntry[] {
  return PLATFORM_ENTRIES.filter((e) => allowed(e.view) && platformViewAllowed(access, e.view));
}

/** Écriture : super-administrateur, ou capacité serveur correspondant à la vue ; sinon lecture avec raison. */
export function platformAuthority(
  access: PlatformAccess | null | undefined,
  view: PlatformView,
): { canWrite: boolean; reason?: string } {
  if (!access) return { canWrite: false, reason: "Droits d’opérateur non vérifiés." };
  if (access.super_admin === true) return { canWrite: true };
  const caps = access.capabilities;
  const can =
    view === "platform-operators" ? caps?.operators === true
    : view === "platform-finance" ? caps?.finance === true
    : caps?.reviews_moderation === true;
  return can ? { canWrite: true } : { canWrite: false, reason: "Vos droits d’opérateur ne couvrent pas cette section." };
}
