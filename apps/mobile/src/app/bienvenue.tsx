import { useRouter } from 'expo-router';
import { Action, Card, Copy, ReadState, Screen } from '@/components/ui';
import { useResource } from '@/lib/api';
import { categories, euros, prices, type Category } from '@/lib/contracts';
import { apiOrigin } from '@/lib/config';
import { openBrowserAsync } from 'expo-web-browser';

export default function Welcome() {
  const router = useRouter();
  const catalogue = useResource('/api/public/indicative-prices', prices);
  return <Screen>
    <Copy kind="label">ASSISTANCE ÉLECTRIQUE</Copy>
    <Copy kind="title">Une panne ? Demandez une intervention.</Copy>
    <Copy>Retrouvez vos demandes, vos devis et les étapes de votre intervention depuis votre téléphone.</Copy>
    <Action label="Accéder à mon espace" onPress={() => router.push('/connexion')}/>
    {apiOrigin&&<Action secondary label="Demander sans compte sur le site" onPress={() => void openBrowserAsync(apiOrigin+'/#new')}/>}
    <Copy kind="subtitle">Fourchettes indicatives</Copy>
    <ReadState loading={catalogue.loading} error={catalogue.error} onRetry={catalogue.reload}/>
    {catalogue.data&&Object.entries(categories).map(([key,label])=>{
      const price=catalogue.data!.ranges[key as Category];
      return <Card key={key}><Copy kind="subtitle">{label}</Copy><Copy>{euros(price.min_cents)} à {euros(price.max_cents)}</Copy></Card>;
    })}
    <Copy kind="muted">Le prix final est fixé par le devis que vous acceptez.</Copy>
  </Screen>;
}
