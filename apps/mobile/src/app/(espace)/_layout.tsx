import { Tabs } from 'expo-router';
import { MobileTabBar, type Glyph } from '@/components/mobile-chrome';
import { usePalette } from '@/components/ui';
import { useWorkspace } from '@/lib/use-workspace';
import { spaceTabs } from '@/lib/mobile-navigation';

export default function Layout() {
  const p = usePalette();
  const role = useWorkspace(true).data?.profile.role;
  const visible = spaceTabs(role);
  const items: Record<string, { label: string; icon: Glyph }> = {
    accueil: { label: 'Accueil', icon: 'home' }, services: { label: 'Services', icon: 'services' },
    interventions: { label: role === 'artisan' ? 'Missions' : 'Demandes', icon: 'activity' },
    devis: { label: 'Devis', icon: 'price' }, messages: { label: 'Messages', icon: 'messages' },
    aide: { label: 'Aide', icon: 'help' }, profil: { label: 'Profil', icon: 'account' },
  };
  return <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: p.background } }}
    tabBar={({ state, emitter, navigateToTab }) => <MobileTabBar items={visible.flatMap(name => {
      const route = state.routes.find(route => route.name === name);
      return route ? [{ ...items[name], selected: state.routes[state.index]?.key === route.key,
        onPress: () => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (state.routes[state.index]?.key !== route.key && !event.defaultPrevented) navigateToTab(route.key);
        },
      }] : [];
    })} />}>
    <Tabs.Screen name="accueil" options={{ title: 'Accueil' }} />
    <Tabs.Screen name="services" options={{ title: 'Services' }} />
    <Tabs.Screen name="interventions" options={{ title: role === 'artisan' ? 'Missions' : 'Demandes' }} />
    <Tabs.Screen name="devis" options={{ title: 'Devis' }} />
    <Tabs.Screen name="messages" options={{ title: 'Messages' }} />
    <Tabs.Screen name="aide" options={{ title: 'Aide' }} />
    <Tabs.Screen name="profil" options={{ title: 'Profil' }} />
  </Tabs>;
}
