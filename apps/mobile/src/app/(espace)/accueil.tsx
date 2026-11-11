import { useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MobileIcon, type Glyph } from '@/components/mobile-chrome';
import { JobCard } from '@/components/job-card';
import { PublicLink } from '@/components/mobile-public-content';
import { Action, Card, Copy, ReadState, Screen, usePalette } from '@/components/ui';
import { useWorkspace } from '@/lib/use-workspace';
import { apiOrigin } from '@/lib/config';
import { categories, type Category } from '@/lib/contracts';
import { verifiedPhone } from '@/lib/phone-client';
import { useSession } from '@/lib/session';

const quickActions: { type: Category; service: string; icon: Glyph }[] = [
  { type: 'outage', service: 'coupure-de-courant-partielle', icon: 'bolt' },
  { type: 'panel', service: 'panne-tableau-electrique', icon: 'activity' },
  { type: 'socket', service: 'prise-qui-ne-fonctionne-plus', icon: 'plug' },
  { type: 'lighting', service: 'eclairage-qui-ne-sallume-plus', icon: 'bolt' },
];

export default function SpaceHome() {
  const router = useRouter();
  const state = useWorkspace();
  const p = usePalette();
  const profile = state.data?.profile;
  const hasPhone = Boolean(verifiedPhone(useSession().session?.user));
  const recent = [...(state.data?.interventions ?? [])]
    .sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 4);
  const isClient = profile?.role === 'client';
  const isArtisan = profile?.role === 'artisan';
  const management = profile?.role === 'admin' || profile?.role === 'manager';
  return <Screen top>
    <Copy kind="title">{profile?.first_name ? `Bonjour ${profile.first_name}` : 'Votre accueil'}</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
    {isClient && <>
      <Copy kind="muted">Comment pouvons-nous vous aider ?</Copy>
      <Action label="J’ai besoin d’un électricien" onPress={() => router.push(hasPhone ? '/demande-client' : '/demande')} />
      <View style={styles.heading}>
        <Copy kind="subtitle">Actions rapides</Copy>
        <PublicLink label="Voir tout" onPress={() => router.push('/catalogue')} />
      </View>
      <View style={styles.shortcuts}>
        {quickActions.map(item => <Pressable key={item.type} accessibilityRole="link"
          style={[styles.shortcut, { borderColor: p.border, backgroundColor: p.surface }]} onPress={() => {
            if (hasPhone) router.push({ pathname: '/demande-client', params: { service: item.service } });
            else router.push({ pathname: '/demande', params: { type: item.type } });
          }}>
          <MobileIcon name={item.icon} color={p.blue} />
          <Text style={[styles.shortcutLabel, { color: p.text }]}>{categories[item.type]}</Text>
        </Pressable>)}
      </View>
      {hasPhone && <PublicLink label="Retrouver mes demandes" onPress={() => router.push('/retrouver')} />}
    </>}
    {isArtisan && <>
      <Card>
        <Copy kind="muted">Tableau de bord</Copy>
        <Copy kind="subtitle">Vue d’ensemble</Copy>
        <Copy>{profile.artisan_approved ? 'Consultez les offres et les interventions qui vous sont affectées.'
          : 'Votre candidature doit être validée avant d’accepter des missions.'}</Copy>
      </Card>
      <Action label="Voir les offres et missions" onPress={() => router.push('/interventions')} />
    </>}
    {(isClient || isArtisan) && <>
      <View style={styles.heading}>
        <Copy kind="subtitle">{isClient ? 'Interventions récentes' : 'Missions récentes'}</Copy>
        <PublicLink label={isClient ? 'Voir mes interventions' : 'Toutes mes missions'} onPress={() => router.push('/interventions')} />
      </View>
      {recent.length === 0 && <Card><Copy kind="muted">{isClient ? 'Aucune intervention pour le moment.' : 'Aucune mission affectée pour le moment.'}</Copy></Card>}
      {recent.map(job => <JobCard key={job.id} job={job} onOpen={() => router.push({ pathname: '/dossier/[id]', params: { id: job.id } })} />)}
    </>}
    {management && <Card>
      <Copy kind="subtitle">Outils de gestion</Copy>
      <Copy>Les opérations d’administration et de gestion de site sont accessibles sur le portail Web.</Copy>
      {apiOrigin && <Action label="Ouvrir le portail" onPress={() => void openBrowserAsync(apiOrigin!)} />}
    </Card>}
    {management && <Action secondary label="Voir mes interventions" onPress={() => router.push('/interventions')} />}
  </Screen>;
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 5 },
  shortcuts: { flexDirection: 'row', gap: 6 },
  shortcut: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 94, borderWidth: 1, borderRadius: 12, gap: 6, padding: 4 },
  shortcutLabel: { fontFamily: 'JakartaSemiBold', textAlign: 'center', fontSize: 10, lineHeight: 15 },
});
