import { PublicTabs } from '@/components/mobile-chrome';
import { useRouter } from 'expo-router';
import { Action, Copy, Screen } from '@/components/ui';
import { OptionalEmailAccount } from '@/components/optional-email-account';
import { useSession } from '@/lib/session';

export default function FindRequests() {
  const { session } = useSession();
  const router = useRouter();
  return <Screen top footer={<PublicTabs />}>
    <Copy kind="title">Activité</Copy>
    <Copy>Connectez-vous à votre compte par e-mail pour retrouver une intervention avec son numéro de commande.</Copy>
    {session?.user.email_confirmed_at
      ? <Action label="Voir mes interventions" onPress={() => router.push('/interventions')} />
      : session
        ? <OptionalEmailAccount />
        : <Action label="Me connecter par e-mail" onPress={() => router.push({ pathname: '/connexion', params: { retour: 'interventions' } })} />}
  </Screen>;
}
