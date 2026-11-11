import { Tabs } from 'expo-router';
import { MobileTabBar, type Glyph } from '@/components/mobile-chrome';
import { usePalette } from '@/components/ui';

const items: Record<string, { label: string; icon: Glyph }> = {
  accueil: { label: 'Accueil', icon: 'home' },
  interventions: { label: 'Activité', icon: 'activity' },
  messages: { label: 'Messages', icon: 'messages' },
  profil: { label: 'Compte', icon: 'account' },
};

export default function Layout() {
  const p = usePalette();
  return <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: p.background } }}
    tabBar={({ state, emitter, navigateToTab }) => <MobileTabBar items={state.routes.map((route, index) => ({
      ...items[route.name],
      selected: state.index === index,
      onPress: () => {
        const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (state.index !== index && !event.defaultPrevented) navigateToTab(route.key);
      },
    }))} />}>
    <Tabs.Screen name="accueil" options={{ title: 'Accueil' }} />
    <Tabs.Screen name="interventions" options={{ title: 'Activité' }} />
    <Tabs.Screen name="messages" options={{ title: 'Messages' }} />
    <Tabs.Screen name="profil" options={{ title: 'Compte' }} />
  </Tabs>;
}
