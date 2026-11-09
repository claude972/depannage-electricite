import { Redirect } from 'expo-router';
import { useSession } from '@/lib/session';

export default function Entry() {
  return <Redirect href={useSession().session?'/(espace)/accueil':'/bienvenue'}/>;
}
