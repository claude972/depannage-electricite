import { Redirect, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { ArtisanAvailability } from '@/components/artisan-availability';
import { JobCard } from '@/components/job-card';
import { PublicLink } from '@/components/mobile-public-content';
import { Action, Card, Copy, ReadState, Screen } from '@/components/ui';
import { useWorkspace } from '@/lib/use-workspace';

export default function SpaceHome() {
  const router = useRouter();
  const state = useWorkspace();
  const profile = state.data?.profile;
  const recent = (state.data?.interventions ?? [])
    .filter(job => profile?.role !== 'artisan' || job.artisan_id === profile.id)
    .sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 4);
  if (profile?.role === 'client') return <Redirect href="/interventions" />;
  const isArtisan = profile?.role === 'artisan';
  const management = profile?.role === 'admin' || profile?.role === 'manager';
  return <Screen top>
    <Copy kind="title">{profile?.first_name ? `Bonjour ${profile.first_name}` : 'Votre accueil'}</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
    {isArtisan && <>
      <ArtisanAvailability approved={profile.artisan_approved} />
      <Card>
        <Copy kind="muted">Tableau de bord</Copy>
        <Copy kind="subtitle">Vue d’ensemble</Copy>
        <Copy>{profile.artisan_approved ? 'Consultez les offres et les interventions qui vous sont affectées.'
          : 'Votre candidature doit être validée avant d’accepter des missions.'}</Copy>
      </Card>
      <Action label="Voir les offres et missions" onPress={() => router.push('/interventions')} />
    </>}
    {isArtisan && <>
      <View style={styles.heading}>
        <Copy kind="subtitle">Missions récentes</Copy>
        <PublicLink label="Toutes mes missions" onPress={() => router.push('/interventions')} />
      </View>
      {recent.length === 0 && <Card><Copy kind="muted">Aucune mission affectée pour le moment.</Copy></Card>}
      {recent.map(job => <JobCard key={job.id} role={profile?.role} quotes={state.data?.quotes} payments={state.data?.payments} job={job} onOpen={() => router.push({ pathname: '/dossier/[id]', params: { id: job.id } })} />)}
    </>}
    {management && <>
      <Card><Copy kind="subtitle">{profile?.role === 'admin' ? 'Administration' : 'Espace entreprise'}</Copy><Copy>Retrouvez les dossiers et les sites autorisés pour votre compte.</Copy></Card>
      <Action label="Consulter les interventions" onPress={() => router.push('/interventions')} />
      <Action secondary label={profile?.role === 'admin' ? 'Ouvrir l’annuaire' : 'Organisations et sites'} onPress={() => router.push(profile?.role === 'admin' ? '/annuaire' : '/organisations')} />
      <Action secondary label="Ouvrir les messages" onPress={() => router.push('/messages')} />
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 5 },
});
