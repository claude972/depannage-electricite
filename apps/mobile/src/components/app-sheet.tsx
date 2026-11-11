import { BottomSheet, Host } from '@expo/ui';
import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MobileIcon } from './mobile-chrome';
import { Copy, usePalette } from './ui';

export function AppSheet({ title, open, onClose, children }: PropsWithChildren<{
  title: string;
  open: boolean;
  onClose: () => void;
}>) {
  const palette = usePalette();
  return <Host matchContents>
    <BottomSheet isPresented={open} onDismiss={onClose} containerColor={palette.surface}
      contentPadding={{ left: 16, right: 16, top: 8, bottom: 20 }}>
      <View style={styles.content}>
        <View style={styles.heading}>
          <View style={styles.title}><Copy kind="subtitle">{title}</Copy></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" style={styles.close} onPress={onClose}>
            <MobileIcon name="close" color={palette.text} size={16} />
          </Pressable>
        </View>
        {children}
      </View>
    </BottomSheet>
  </Host>;
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
