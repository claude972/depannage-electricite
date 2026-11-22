import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { categories, type Category } from '@/lib/contracts';
import { usePalette } from './ui';
const icons = {
  outage: require('../../assets/enterprise-request/outage.svg'),
  panel: require('../../assets/enterprise-request/panel.svg'),
  socket: require('../../assets/enterprise-request/socket.svg'),
  lighting: require('../../assets/enterprise-request/lighting.svg'),
  diagnostic: require('../../assets/enterprise-request/diagnostic.svg'),
};
const labels = { ...categories, diagnostic: 'Recherche de panne' };
const descriptions: Record<Category, string> = {
  outage: 'Tout ou partie du logement', panel: 'Disjoncteur, fusible ou tableau',
  socket: 'Une prise ou un point de commande', lighting: 'Luminaire ou circuit d’éclairage',
  diagnostic: 'L’origine du problème est inconnue',
};
/** Figma 336:20878: flexible rows retain 24×25 assets and grow with text size. */
export function EnterpriseProblemPicker({ value, onChange, disabled = false }: { value: Category | null; onChange: (value: Category) => void; disabled?: boolean }) {
  const palette = usePalette();
  return <View style={styles.list}>{(Object.keys(categories) as Category[]).map(category => <Pressable key={category}
    accessibilityRole="radio" accessibilityLabel={labels[category]} accessibilityHint={descriptions[category]}
    accessibilityState={{ checked: value === category, disabled }} disabled={disabled} onPress={() => onChange(category)}
    style={({ pressed }) => [styles.row, { backgroundColor: palette.surface, borderColor: value === category ? palette.blue : palette.border, opacity: disabled ? .6 : pressed ? .8 : 1 }]}>
    <Image source={icons[category]} style={styles.icon} contentFit="contain" accessibilityElementsHidden />
    <View style={styles.text}><Text style={[styles.title, { color: palette.text }]}>{labels[category]}</Text><Text style={[styles.description, { color: palette.muted }]}>{descriptions[category]}</Text></View>
  </Pressable>)}</View>;
}
export function EnterpriseUrgencyPicker({ value, onChange }: { value: 'urgent' | 'scheduled' | null; onChange: (value: 'urgent' | 'scheduled') => void }) {
  const palette = usePalette();
  return <View style={styles.list}>{([
    ['scheduled', 'Intervention à planifier', 'Le problème peut attendre un rendez-vous.'],
    ['urgent', 'Demande urgente', 'Le problème nécessite une prise en charge prioritaire.'],
  ] as const).map(([key, title, description]) => <Pressable key={key} accessibilityRole="radio" accessibilityLabel={title}
    accessibilityState={{ checked: value === key }} onPress={() => onChange(key)}
    style={[styles.row, { borderColor: value === key ? palette.blue : palette.border, backgroundColor: palette.surface }]}>
    <View style={styles.text}><Text style={[styles.title, { color: palette.text }]}>{value === key ? '◉' : '○'}  {title}</Text><Text style={[styles.description, { color: palette.muted }]}>{description}</Text></View>
  </Pressable>)}</View>;
}
const styles = StyleSheet.create({
  list: { gap: 9 }, row: { minHeight: 83, borderWidth: 1, borderRadius: 7, padding: 13, gap: 9, flexDirection: 'row', alignItems: 'center' },
  icon: { width: 24, height: 25, flexShrink: 0 }, text: { flex: 1, gap: 5 },
  title: { fontFamily: 'JakartaMedium', fontSize: 14, lineHeight: 22 }, description: { fontFamily: 'JakartaRegular', fontSize: 12, lineHeight: 19 },
});
