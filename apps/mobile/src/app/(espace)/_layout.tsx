import { Tabs } from 'expo-router';
import { MobileTabBar, type Glyph } from '@/components/mobile-chrome';
import { usePalette } from '@/components/ui';

const items: Record<string, { label: string; icon: Glyph }> = {
  accueil: { label: 'Accueil', icon: 'home' },
  services: { label: 'Services', icon: 'services' },
  interventions: { label: 'Activité', icon: 'activity' },
  profil: { label: 'Compte', icon: 'account' },
};

export default function Layout() {
  const p = usePalette();
  return <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: p.background } }}
    tabBar={({ state, emitter, navigateToTab }) => <MobileTabBar items={state.routes.filter(route => route.name !== 'messages').map(route => ({
      ...items[route.name],
      selected: state.routes[state.index]?.key === route.key ||
        (route.name === 'profil' && state.routes[state.index]?.name === 'messages'),
      onPress: () => {
        const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (state.routes[state.index]?.key !== route.key && !event.defaultPrevented) navigateToTab(route.key);
      },
    }))} />}>
    <Tabs.Screen name="accueil" options={{ title: 'Accueil' }} />
    <Tabs.Screen name="services" options={{ title: 'Services' }} />
    <Tabs.Screen name="interventions" options={{ title: 'Activité' }} />
    <Tabs.Screen name="messages" options={{ title: 'Messages', href: null }} />
    <Tabs.Screen name="profil" options={{ title: 'Compte' }} />
  </Tabs>;
}
