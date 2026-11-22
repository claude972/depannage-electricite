import { Action, Copy } from './ui';
import { useResource } from '@/lib/api';
import { ADDRESS_PATH, addressList, orderedAddresses, type ClientAddress } from '@/lib/client-addresses';

/** CLI-09 : les adresses enregistrées du client préremplissent le lieu d’une nouvelle demande. Lecture seule ; rien n’est affiché sans adresse. */
export function SavedAddressChoices({ token, actor, selected, onChoose }: {
  token: string; actor: string; selected: { address: string; postal_code: string; city: string };
  onChoose: (address: ClientAddress) => void;
}) {
  const list = useResource(ADDRESS_PATH, addressList, token, actor);
  const records = orderedAddresses(list.data?.records ?? []);
  if (!records.length) return null;
  return <>
    <Copy kind="label">Mes adresses enregistrées</Copy>
    {records.map(record => <Action key={record.id} secondary
      selected={record.address === selected.address && record.postal_code === selected.postal_code && record.city === selected.city}
      label={`Utiliser ${record.label} · ${record.address}, ${record.postal_code} ${record.city}`} onPress={() => onChoose(record)} />)}
    <Copy kind="muted">Vous pouvez aussi saisir une autre adresse ci-dessous.</Copy>
  </>;
}
