// Tab-scoped PRIVATE pending commands of the leaves (identity-fenced writes). They can carry
// private content (invitation email, notes, addresses, request payloads). The fences already refuse
// to REPLAY them under another identity; this purge also makes sure the outgoing user's content
// never stays in the tab after a logout or an identity change. A same-identity reload never calls
// it, so an uncertain command can still be resumed by its author.
// Prefixes are the exact keys used in the sources (grep « sessionStorage » / pendingKey):
export const PRIVATE_STORAGE_PREFIXES = [
  "courant-private-", // convention for new leaves
  "courant-support-pending-", // components/role/support-tickets.tsx
  "courant-request-key-v1", // components/app/request-key.ts (manager request payload + key)
  "courant-booking-photos-v1", // components/app/signed-booking.ts (photo count)
  "site-settings:", // components/features/site-lifecycle
  "site-asset-link:", // components/features/site-asset-links
  "refund-execution:", // components/features/refund-execution
  "hold-reauthorization:", // components/features/hold-reauthorization
  "credential-review:", // components/features/credential-reviews
  "warranty-policy-pending-command", // components/features/warranty-policy
  "warranty-corrective-pending", // components/features/warranty-corrective
  "operator-profile-pending-command", // components/features/public-operator-profile
  "appointment-reminder-pending", // components/features/appointment-reminders
  "account-erasure-pending", // components/features/account-data
  "provider-teams-pending", // components/features/provider-teams (ART-12)
] as const;

/** Removes every private pending entry; returns the removed keys. Never throws. */
export function purgePrivateStorage(storage: Pick<Storage, "removeItem"> & { length: number; key(i: number): string | null } | null | undefined): string[] {
  if (!storage) return [];
  const removed: string[] = [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k) keys.push(k);
    }
    for (const k of keys)
      if (PRIVATE_STORAGE_PREFIXES.some((p) => k.startsWith(p))) {
        storage.removeItem(k);
        removed.push(k);
      }
  } catch {
    /* storage unavailable: nothing to purge */
  }
  return removed;
}
