import { NativeTabs } from 'expo-router/native-tabs';
import { usePalette } from '@/components/ui';

export default function Layout() {
  const p=usePalette();
  return <NativeTabs tintColor={p.blue} backgroundColor={p.surface}>
    <NativeTabs.Trigger name="accueil"><NativeTabs.Trigger.Label>Accueil</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="house" md="home"/></NativeTabs.Trigger>
    <NativeTabs.Trigger name="interventions"><NativeTabs.Trigger.Label>Interventions</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="list.bullet.rectangle" md="assignment"/></NativeTabs.Trigger>
    <NativeTabs.Trigger name="messages"><NativeTabs.Trigger.Label>Messages</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="bubble.left" md="chat"/></NativeTabs.Trigger>
    <NativeTabs.Trigger name="profil"><NativeTabs.Trigger.Label>Profil</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="person.crop.circle" md="account_circle"/></NativeTabs.Trigger>
  </NativeTabs>;
}
