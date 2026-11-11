import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { PublicTabs } from './mobile-chrome';
import { Copy, Screen } from './ui';

export function AccountEntry({ title, description, children }: PropsWithChildren<{ title: string; description: string }>) {
  return <Screen top footer={<PublicTabs />}>
    <View style={styles.entry}>
      <View style={styles.intro}>
        <Copy kind="title">{title}</Copy>
        <Copy kind="muted">{description}</Copy>
      </View>
      {children}
    </View>
  </Screen>;
}

const styles = StyleSheet.create({
  entry: { gap: 24, paddingTop: 20, paddingHorizontal: 4 },
  intro: { gap: 10 },
});
