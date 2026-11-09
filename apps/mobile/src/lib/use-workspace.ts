import { useResource } from './api';
import { workspace } from './contracts';
import { useSession } from './session';
export function useWorkspace() {
  const token = useSession().session?.access_token;
  return useResource(token ? '/api/workspace' : null, workspace, token);
}
