import { useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { Action, Card, Copy, Screen } from '@/components/ui';
import { apiOrigin } from '@/lib/config';

export default function MobileHelp() {
  const router = useRouter();
  return <Screen>
    <Copy kind="title">Comment pouvons-nous vous aider ?</Copy>
    <Card>
      <Copy kind="subtitle">Une intervention en cours ?</Copy>
      <Copy>Utilisez le numéro indiqué dans votre demande pour consulter son avancement.</Copy>
      <Action label="Retrouver mon intervention" onPress={() => router.push('/retrouver')} />
    </Card>
    {apiOrigin && <Action secondary label="Ouvrir le centre d’aide sur le Web" onPress={() => void openBrowserAsync(apiOrigin + '/#help')} />}
  </Screen>;
}
