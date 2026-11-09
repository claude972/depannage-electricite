import { useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { Action, Card, Copy, ReadState, Screen } from '@/components/ui';
import { useWorkspace } from '@/lib/use-workspace';
import { apiOrigin } from '@/lib/config';

export default function SpaceHome() {
  const router=useRouter(), state=useWorkspace(), profile=state.data?.profile;
  return <Screen top>
    <Copy kind="label">ESPACE {profile?.role==='artisan'?'ARTISAN':'PERSONNEL'}</Copy>
    <Copy kind="title">{profile?.first_name ? `Bonjour, ${profile.first_name}` : 'Votre accueil'}</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
    {profile?.role==='client'&&<Card>
      <Copy kind="subtitle">Un problème électrique ?</Copy>
      <Copy>Décrivez la panne et choisissez l’adresse d’intervention.</Copy>
      <Action label="Nouvelle demande" onPress={()=>router.push('/demande')}/>
    </Card>}
    {profile?.role==='artisan'&&<Card>
      <Copy kind="subtitle">Vos missions</Copy>
      <Copy>{profile.artisan_approved?'Consultez les offres et les interventions qui vous sont affectées.':'Votre candidature doit être validée avant d’accepter des missions.'}</Copy>
      <Action label="Voir les missions" onPress={()=>router.push('/interventions')}/>
    </Card>}
    {(profile?.role==='admin'||profile?.role==='manager')&&<Card>
      <Copy kind="subtitle">Outils de gestion</Copy>
      <Copy>Les opérations d’administration et de gestion de site sont accessibles sur le portail Web.</Copy>
      {apiOrigin&&<Action label="Ouvrir le portail" onPress={()=>void openBrowserAsync(apiOrigin!)}/>}
    </Card>}
    {profile&&profile.role!=='artisan'&&<Action secondary label="Voir mes interventions" onPress={()=>router.push('/interventions')}/>}
    <Copy kind="muted">Version de recette. Les services externes dépendent de l’environnement de test.</Copy>
  </Screen>;
}
