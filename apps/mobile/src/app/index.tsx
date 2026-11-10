import { Redirect } from 'expo-router';
import { useSession } from '@/lib/session';

export default function Entry() {
  const { session, phoneResume } = useSession();
  if (session && phoneResume === 'booking') return <Redirect href="/demande-client" />;
  if (session && phoneResume === 'lookup') return <Redirect href="/retrouver" />;
  return <Redirect href={session ? '/(espace)/accueil' : '/bienvenue'} />;
}
