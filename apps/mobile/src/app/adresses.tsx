import { AddressBook } from '@/components/address-book';
import { Copy, ReadState, Screen } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/use-workspace';

export default function Addresses() {
  const auth = useSession().session, state = useWorkspace(true), profile = state.data?.profile;
  if (!auth || !profile) return <Screen><ReadState loading={state.loading} error={state.error} onRetry={state.reload} /></Screen>;
  if (profile.role !== 'client') return <Screen><Copy>Le carnet d’adresses est réservé aux comptes particuliers.</Copy></Screen>;
  return <AddressBook key={auth.user.id} token={auth.access_token} actor={auth.user.id} firstName={profile.first_name ?? ''} lastName={profile.last_name ?? ''} />;
}
