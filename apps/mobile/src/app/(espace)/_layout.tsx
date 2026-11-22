import { Tabs } from 'expo-router';
import { usePalette } from '@/components/ui';
import { useWorkspace } from '@/lib/use-workspace';

export default function Layout() {
  const p = usePalette();
  const role = useWorkspace(true).data?.profile.role;
  return <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: p.background } }}
    tabBar={() => null}>
    <Tabs.Screen name="accueil" options={{ title: 'Accueil' }} />
    <Tabs.Screen name="services" options={{ title: 'Services' }} />
    <Tabs.Screen name="interventions" options={{ title: role === 'artisan' ? 'Missions' : role === 'client' ? 'Demandes' : 'Interventions' }} />
    <Tabs.Screen name="organisations" options={{ title: 'Organisations' }} />
    <Tabs.Screen name="annuaire" options={{ title: 'Annuaire' }} />
    <Tabs.Screen name="devis" options={{ title: 'Devis' }} />
    <Tabs.Screen name="messages" options={{ title: 'Messages' }} />
    <Tabs.Screen name="aide" options={{ title: 'Aide' }} />
    <Tabs.Screen name="profil" options={{ title: 'Profil' }} />
  </Tabs>;
}
