import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from './ui';

const symbols = {
  home: { ios: 'house', android: 'home' },
  services: { ios: 'square.grid.2x2', android: 'apps' },
  activity: { ios: 'list.bullet.rectangle', android: 'receipt_long' },
  account: { ios: 'person.crop.circle', android: 'account_circle' },
  messages: { ios: 'bubble.left', android: 'chat' },
  close: { ios: 'xmark', android: 'close' },
  work: { ios: 'briefcase', android: 'work_outline' },
  mail: { ios: 'envelope', android: 'mail_outline' },
  phone: { ios: 'phone', android: 'call' },
  pin: { ios: 'mappin', android: 'location_on' },
  bolt: { ios: 'bolt.fill', android: 'bolt' },
  plug: { ios: 'powerplug', android: 'power' },
  search: { ios: 'magnifyingglass', android: 'search' },
  calendar: { ios: 'calendar', android: 'calendar_today' },
  clock: { ios: 'clock', android: 'schedule' },
  next: { ios: 'chevron.right', android: 'chevron_right' },
  back: { ios: 'chevron.left', android: 'chevron_left' },
  expand: { ios: 'chevron.down', android: 'expand_more' },
  collapse: { ios: 'chevron.up', android: 'expand_less' },
  price: { ios: 'doc.text', android: 'receipt' },
  shield: { ios: 'checkmark.shield', android: 'verified_user' },
  help: { ios: 'questionmark.circle', android: 'help_outline' },
  lock: { ios: 'lock', android: 'lock_outline' },
} as const satisfies Record<string, Exclude<SymbolViewProps['name'], string>>;

export type Glyph = keyof typeof symbols;

export function MobileIcon({ name, color, size = 20 }: { name: Glyph; color: string; size?: number }) {
  const symbol = symbols[name];
  // Android : le glyphe est un texte qui suit la taille de police du système ; sa boîte doit grandir avec lui, sinon il est rogné.
  const { fontScale } = useWindowDimensions();
  const box = Platform.OS === 'android' ? Math.ceil(size * Math.max(1, fontScale)) : size;
  return <SymbolView name={{ ...symbol, web: symbol.android }} size={size} tintColor={color} style={{ width: box, height: box }}
    accessible={false} accessibilityElementsHidden importantForAccessibility="no" />;
}

// The root navigator owns the single persistent menu, including detail/auth screens.
export function PublicTabs() { return null; }

export function MobileTabBar({ items }: { items: { label: string; icon: Glyph; selected: boolean; onPress: () => void }[] }) {
  const p = usePalette();
  const { bottom } = useSafeAreaInsets();
  return <View style={[styles.tabsArea, { paddingBottom: 10 + bottom, backgroundColor: p.background }]}>
    <View accessibilityRole="tablist" style={[styles.tabs, { borderColor: p.border, backgroundColor: p.surface }]}>
      {items.map(item => <Pressable key={item.label} accessibilityRole="tab" accessibilityLabel={item.label}
        accessibilityState={{ selected: item.selected }} onPress={item.onPress}
        style={[styles.tab, item.selected && { backgroundColor: p.subtle }]}>
        <MobileIcon name={item.icon} color={item.selected ? p.text : p.muted} size={19} />
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.2}
          style={[styles.tabLabel, { color: item.selected ? p.text : p.muted }]}>{item.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  tabsArea: { paddingTop: 6, paddingHorizontal: 12 },
  tabs: { flexDirection: 'row', gap: 2, borderWidth: 1, borderRadius: 999, padding: 4, width: '100%', maxWidth: 370, alignSelf: 'center', boxShadow: '0 4px 18px #101b3c18' },
  tab: { flex: 1, minWidth: 0, minHeight: 46, justifyContent: 'center', alignItems: 'center', gap: 3, borderRadius: 24, padding: 2 },
  tabLabel: { fontFamily: 'JakartaMedium', fontSize: 12, lineHeight: 18, textAlign: 'center', alignSelf: 'stretch' },
});
