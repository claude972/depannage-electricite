import { useResource } from './api';
import { workspace } from './contracts';
import { useSession } from './session';
export function useWorkspace(retainWhileRefreshing = false) {
  const session = useSession().session;
  const token = session?.access_token;
  return useResource(token ? '/api/workspace' : null, workspace, token, retainWhileRefreshing ? session?.user.id : undefined);
}
