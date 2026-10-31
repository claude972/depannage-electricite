// Identity adoption inside a login chain. Three facts must agree before a chain adopts an
// identity: the user the login promise returned, the user the SDK currently holds (another
// tab or a later login may have replaced it), and the user the controller already loaded
// (the SIGNED_IN event often arrives before the promise resolves). Pure sequence, exercised
// by tests/ui/identity.test.ts with the same runner the controller uses.
import type { RunContext } from "./guard";
import type { RequestValues, View } from "./types";

export type IdentityDeps = {
  /** Authoritative current user according to the auth SDK (server-verified), or null. */
  currentUserId(): Promise<string | null>;
  /** User whose workspace the controller currently holds (userId ref), or null. */
  loadedUserId(): string | null;
  /** Clears every account-scoped state and bumps the identity generation. */
  clearSessionState(): void;
  setUserId(id: string | null): void;
  /** Loads the workspace for the current user id. */
  refresh(): Promise<void>;
  navigate(view: View): void;
  setPendingDraft(draft: RequestValues | null): void;
  /** Home view for the role known after refresh. */
  homeView(): View;
};
export type AdoptionOutcome = "adopted" | "superseded" | "interrupted";
export async function adoptIdentity(
  ctx: RunContext,
  expectedUserId: string | null,
  keepDraft: RequestValues | null,
  deps: IdentityDeps,
): Promise<AdoptionOutcome> {
  // 1. The SDK is the authority: a login promise resolving after another account took over
  //    the browser must not reset that account's session.
  const authoritative = await deps.currentUserId();
  if (!expectedUserId || authoritative !== expectedUserId) return "superseded";
  // 2. The auth event may already have adopted this very identity: do not clear it again,
  //    simply continue the chain as that identity.
  if (deps.loadedUserId() !== expectedUserId) {
    deps.clearSessionState();
    deps.setUserId(expectedUserId);
  }
  ctx.rebind();
  await deps.refresh();
  // 3. Logged out or replaced while loading: nothing more.
  if (!ctx.alive() || deps.loadedUserId() !== expectedUserId) return "interrupted";
  if (keepDraft) {
    deps.setPendingDraft(keepDraft);
    deps.navigate("new");
  } else deps.navigate(deps.homeView());
  return "adopted";
}
