import { Host, Switch } from '@expo/ui';
import { Platform, Pressable, StyleSheet, Switch as NativeSwitch, Text, View } from 'react-native';
import { usePalette } from './ui';

/**
 * Interrupteur avec libellé. iOS garde le composant Expo UI (Host dimensionné, voir
 * docs/qa/DISPONIBILITE_IOS_2026-11-19.md). Sur Android, le Switch Expo UI avec libellé laisse
 * son curseur consommer l’appui sans rappeler onValueChange : la ligne entière et le curseur
 * sont donc rendus avec le composant React Native, tous deux actifs.
 */
export function LabeledSwitch({ label, value, onValueChange, disabled = false, iosHeight = 48 }: {
  label: string; value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean; iosHeight?: number;
}) {
  const palette = usePalette();
  if (Platform.OS === 'ios') return <Host style={{ width: '100%', height: iosHeight }} ignoreSafeArea="all">
    <Switch label={label} value={value} disabled={disabled} onValueChange={onValueChange} />
  </Host>;
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }}
    disabled={disabled} onPress={() => onValueChange(!value)} style={[styles.row, { opacity: disabled ? .48 : 1 }]}>
    <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
    {/* Le curseur reste touchable ; la ligne porte seule le rôle et l’état pour les lecteurs d’écran. */}
    <View importantForAccessibility="no-hide-descendants">
      <NativeSwitch value={value} disabled={disabled} onValueChange={onValueChange}
        trackColor={{ false: palette.border, true: palette.primary }} />
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1, minWidth: 0, fontFamily: 'JakartaRegular', fontSize: 15, lineHeight: 23 },
});
