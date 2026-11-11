import { MobileContactActions } from '@/components/mobile-contact-actions';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PublicTabs } from '@/components/mobile-chrome';
import { PublicReadState, PublicServiceRow } from '@/components/mobile-public-content';
import { Copy, usePalette } from '@/components/ui';
import { useIndicativePrices, usePublicServices } from '@/lib/public-services';

export function ServiceCatalogue({ embedded = false }: { embedded?: boolean }) {
  const palette = usePalette();
  const services = usePublicServices();
  const prices = useIndicativePrices();
  const items = services.data?.items ?? [];

  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.flex, { backgroundColor: palette.background }]}>
    <ScrollView contentContainerStyle={styles.content}>
      <Copy kind="title">Services</Copy>
      <Copy kind="muted">Choisissez la situation la plus proche de votre besoin.</Copy>
      <PublicReadState loading={services.loading} error={services.error} onRetry={services.reload}
        context="Le catalogue ne peut pas être affiché pour le moment." />
      {services.data && !items.length && <Copy kind="muted">Aucune intervention n’est proposée pour le moment.</Copy>}
      {items.length > 0 && <PublicReadState loading={prices.loading} error={prices.error} onRetry={prices.reload}
        context="Les estimations ne sont pas disponibles pour le moment." />}
      {items.map(item => <PublicServiceRow key={item.slug} item={item} price={prices.data} />)}
    </ScrollView>
    <MobileContactActions />
    {!embedded && <PublicTabs />}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 28, gap: 10, width: '100%', maxWidth: 650, alignSelf: 'center' },
});
