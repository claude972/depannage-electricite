import { useState } from 'react';
import { Image } from 'expo-image';
import { usePathname, useRouter, type Href } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/lib/session';
import { editorial, usePalette } from './ui';

const symbols = {
  home: { ios: 'house', android: 'home' },
  services: { ios: 'square.grid.2x2', android: 'apps' },
  activity: { ios: 'list.bullet.rectangle', android: 'receipt_long' },
  account: { ios: 'person.crop.circle', android: 'account_circle' },
  messages: { ios: 'bubble.left', android: 'chat' },
  menu: { ios: 'line.3.horizontal', android: 'menu' },
  close: { ios: 'xmark', android: 'close' },
  work: { ios: 'briefcase', android: 'work_outline' },
  mail: { ios: 'envelope', android: 'mail_outline' },
  pin: { ios: 'mappin', android: 'location_on' },
  bolt: { ios: 'bolt.fill', android: 'bolt' },
  plug: { ios: 'powerplug', android: 'power' },
  search: { ios: 'magnifyingglass', android: 'search' },
  calendar: { ios: 'calendar', android: 'calendar_today' },
  next: { ios: 'chevron.right', android: 'chevron_right' },
  back: { ios: 'chevron.left', android: 'chevron_left' },
  expand: { ios: 'chevron.down', android: 'expand_more' },
  collapse: { ios: 'chevron.up', android: 'expand_less' },
  price: { ios: 'doc.text', android: 'receipt' },
  shield: { ios: 'checkmark.shield', android: 'verified_user' },
  help: { ios: 'questionmark.circle', android: 'help_outline' },
} as const satisfies Record<string, Exclude<SymbolViewProps['name'], string>>;

export type Glyph = keyof typeof symbols;

export function MobileIcon({ name, color, size = 20 }: { name: Glyph; color: string; size?: number }) {
  const symbol = symbols[name];
  return <SymbolView name={{ ...symbol, web: symbol.android }} size={size} tintColor={color}
    accessible={false} accessibilityElementsHidden importantForAccessibility="no" />;
}

const primaryRoutes = [
  { label: 'Accueil', href: '/bienvenue', icon: 'home' },
  { label: 'Services', href: '/catalogue', icon: 'services' },
  { label: 'Activité', href: '/retrouver', icon: 'activity' },
  { label: 'Compte', href: '/connexion', icon: 'account' },
] as const;

const menuRoutes: { label: string; href: Href }[] = [
  { label: 'Accueil', href: '/bienvenue' },
  { label: 'Services', href: '/catalogue' },
  { label: 'Décrire ma panne', href: '/demande-client' },
  { label: 'Le blog du dépannage', href: '/conseils' },
  { label: 'Activité', href: '/retrouver' },
  { label: 'Compte', href: '/connexion' },
];

export function MobilePublicHeader({ top = false }: { top?: boolean }) {
  const router = useRouter();
  const current = usePathname();
  const { session } = useSession();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  function go(href: Href) {
    setOpen(false);
    if (session && href === '/connexion') router.navigate('/(espace)/profil');
    else if (session && href === '/bienvenue') router.navigate('/(espace)/accueil');
    else router.navigate(href);
  }
  return <View style={[styles.header, { paddingTop: top ? insets.top + 6 : 6, borderColor: p.border }]}>
    <View style={styles.headerInner}>
      <View style={styles.row}>
        <Pressable accessibilityRole="link" accessibilityLabel="DomDépannage, accueil"
          onPress={() => go('/')} style={styles.logoLink}>
          <Image source={require('../../assets/images/splash.png')} contentFit="contain"
            style={styles.logo} accessible={false} />
        </Pressable>
        <Pressable accessibilityRole="link" accessibilityLabel="Candidature électricien"
          onPress={() => go('/candidature')} style={[styles.recruit, { borderColor: p.border }]}>
          <Text style={styles.recruitTitle}>Rejoindre le réseau</Text>
          <Text style={[styles.small, { color: p.blue }]}>Candidature électricien</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable accessibilityRole="link" onPress={() => go('/retrouver')} style={styles.headerAction}>
          <Text style={[styles.small, { color: p.muted }]}>Suivre mon intervention</Text>
        </Pressable>
        <View style={styles.actions}>
          <Pressable accessibilityRole="link" onPress={() => go('/aide-mobile')}
            style={[styles.contact, { borderColor: p.blue }]}>
            <MobileIcon name="mail" color={p.blue} size={15} />
            <Text style={[styles.small, { color: p.blue }]}>Nous contacter</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={open ? 'Fermer le menu' : 'Ouvrir le menu'}
            accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={styles.iconButton}>
            <MobileIcon name={open ? 'close' : 'menu'} color={p.blue} />
          </Pressable>
        </View>
      </View>
      {open && <View style={[styles.menu, { borderColor: p.border }]}>
        {menuRoutes.map(item => <Pressable key={item.label} accessibilityRole="link"
          accessibilityState={{ selected: current === item.href }} onPress={() => go(item.href)}
          style={[styles.menuLink, current === item.href && { backgroundColor: p.subtle }]}>
          <Text style={[styles.menuLabel, { color: p.text }]}>{item.label}</Text>
        </Pressable>)}
      </View>}
    </View>
  </View>;
}

export function PublicTabs() {
  const router = useRouter();
  const current = usePathname();
  const { session } = useSession();
  return <MobileTabBar items={primaryRoutes.map(item => ({
    ...item, selected: current === item.href || (item.href === '/catalogue' && current.startsWith('/prestation/')),
    onPress: () => {
      if (session && item.href === '/connexion') router.navigate('/(espace)/profil');
      else if (session && item.href === '/bienvenue') router.navigate('/(espace)/accueil');
      else router.navigate(item.href);
    },
  }))} />;
}

export function MobileTabBar({ items }: { items: { label: string; icon: Glyph; selected: boolean; onPress: () => void }[] }) {
  const p = usePalette();
  const { bottom } = useSafeAreaInsets();
  return <View style={[styles.tabsArea, { paddingBottom: Math.max(10, bottom), backgroundColor: p.background }]}>
    <View accessibilityRole="tablist" style={[styles.tabs, { borderColor: p.border, backgroundColor: p.surface }]}>
      {items.map(item => <Pressable key={item.label} accessibilityRole="tab" accessibilityLabel={item.label}
        accessibilityState={{ selected: item.selected }} onPress={item.onPress}
        style={[styles.tab, item.selected && { backgroundColor: p.subtle }]}>
        <MobileIcon name={item.icon} color={item.selected ? p.text : p.muted} size={19} />
        <Text style={[styles.tabLabel, { color: item.selected ? p.text : p.muted }]}>{item.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  header: { backgroundColor: editorial.white, borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 6 },
  headerInner: { gap: 4, maxWidth: 650, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  logoLink: { minHeight: 48, justifyContent: 'center' },
  logo: { width: 86, height: 50 },
  recruit: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EDF1FF',
    borderWidth: 1, borderRadius: 24, paddingHorizontal: 14, paddingVertical: 4, flexShrink: 1 },
  recruitTitle: { fontFamily: 'JakartaBold', fontSize: 12, textAlign: 'center', color: editorial.navy },
  small: { fontFamily: 'JakartaBold', fontSize: 11 },
  headerAction: { justifyContent: 'center', minHeight: 44, flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  contact: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, borderWidth: 1, borderRadius: 24, paddingHorizontal: 9 },
  iconButton: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  menu: { borderWidth: 1, borderRadius: 14, padding: 5, width: '100%', maxWidth: 280, alignSelf: 'flex-end' },
  menuLink: { minHeight: 44, borderRadius: 10, paddingHorizontal: 12, justifyContent: 'center' },
  menuLabel: { fontFamily: 'JakartaSemiBold', fontSize: 14 },
  tabsArea: { paddingTop: 6, paddingHorizontal: 12 },
  tabs: { flexDirection: 'row', gap: 2, borderWidth: 1, borderRadius: 30, padding: 4, width: '100%', maxWidth: 370, alignSelf: 'center' },
  tab: { flex: 1, minWidth: 0, minHeight: 46, justifyContent: 'center', alignItems: 'center', gap: 3, borderRadius: 24, padding: 2 },
  tabLabel: { fontFamily: 'JakartaBold', fontSize: 11, textAlign: 'center' },
});
