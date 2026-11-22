import { useRouter } from 'expo-router';
import { AccountEntry } from '@/components/account-entry';
import { PublicLink } from '@/components/mobile-public-content';
import { Action } from '@/components/ui';

export default function GuestAccount() {
  const router = useRouter();
  return <AccountEntry title="Votre espace" description="Retrouvez votre profil et le suivi de vos interventions.">
    <Action label="Se connecter" onPress={() => router.push('/connexion')} />
    <PublicLink label="Créer un compte par e-mail" onPress={() => router.push('/inscription')} />
    <PublicLink label="Retrouver une intervention" onPress={() => router.navigate('/retrouver')} />
    <PublicLink label="Aide et contact" onPress={() => router.push('/aide-mobile')} />
  </AccountEntry>;
}
