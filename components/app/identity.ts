// Identity adoption inside a mutation chain (login / signup with session). The chain that
// authenticates is the one that creates the new identity: it must clear the previous
// session state (which bumps the generation), then explicitly adopt the new generation
// before loading and navigating. Pure sequence, exercised by tests/ui/identity.test.ts
// with the same runner the controller uses.
import type { RunContext } from "./guard";
import type { RequestValues, View } from "./types";

export type IdentityDeps = {
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
export async function adoptIdentity(
  ctx: RunContext,
  userId: string | null,
  keepDraft: RequestValues | null,
  deps: IdentityDeps,
): Promise<void> {
  deps.clearSessionState(); // bumps generation: any older chain (previous account) is dead
  ctx.rebind(); // this chain continues as the identity it just created
  deps.setUserId(userId);
  await deps.refresh();
  if (!ctx.alive()) return; // logged out or replaced while loading: do nothing more
  if (keepDraft) {
    deps.setPendingDraft(keepDraft);
    deps.navigate("new");
  } else deps.navigate(deps.homeView());
}
