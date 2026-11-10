import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MobileBState, useMobileB } from '@/components/mobile-client-home';
import { categoryLabel, indicativeRange, useIndicativePrices, usePublicServices } from '@/lib/public-services';

export default function Catalogue() {
  const router = useRouter();
  const { palette } = useMobileB();
  const insets = useSafeAreaInsets();
  const services = usePublicServices();
  const prices = useIndicativePrices();
  const items = services.data?.items ?? [];

  return <SafeAreaView edges={['left', 'right']} style={[styles.flex, { backgroundColor: palette.background }]}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>Quel problème rencontrez-vous ?</Text>
      <Text style={[styles.intro, { color: palette.muted }]}>
        Choisissez la situation la plus proche de votre besoin. Vous pourrez ajouter des précisions ensuite.
      </Text>
      <MobileBState loading={services.loading} error={services.error} onRetry={services.reload}
        context="Le catalogue ne peut pas être affiché pour le moment."/>
      {services.data && !items.length && <Text style={[styles.category, { color: palette.muted }]}>
        Aucune intervention n’est proposée pour le moment.
      </Text>}
      {items.length > 0 && <MobileBState loading={prices.loading} error={prices.error} onRetry={prices.reload}
        context="Les estimations ne sont pas disponibles pour le moment."/>}
      {items.map(item => {
        const range = indicativeRange(prices.data, item.category);
        return <Pressable key={item.slug} accessibilityRole="link"

        accessibilityLabel={`${item.title}. ${categoryLabel(item.category)}.${range ? ' Fourchette indicative ' + range.spoken + '.' : ''}`}
        accessibilityHint="Ouvre la fiche de cette intervention."
        onPress={() => router.push({ pathname: '/prestation/[slug]', params: { slug: item.slug } })}
        style={({ pressed }) => [styles.card, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? .76 : 1 }]}>
        <Text style={[styles.cardTitle, { color: palette.text }]}>{item.title}</Text>
        <Text style={[styles.category, { color: palette.muted }]}>{categoryLabel(item.category)}</Text>
        {range && <Text style={[styles.price, { color: palette.accent }]}>{range.text} · estimation indicative</Text>}
      </Pressable>; })}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 12, gap: 20, width: '100%', maxWidth: 650, alignSelf: 'center' },
  title: { fontFamily: 'JakartaBold', fontSize: 28, lineHeight: 40 },
  intro: { fontFamily: 'JakartaRegular', fontSize: 15, lineHeight: 22 },
  card: { padding: 16, gap: 10, borderWidth: 1, borderRadius: 18 },
  cardTitle: { fontFamily: 'JakartaBold', fontSize: 17, lineHeight: 25 },
  price: { fontFamily: 'JakartaSemiBold', fontSize: 14, lineHeight: 20 },
  category: { fontFamily: 'JakartaRegular', fontSize: 14, lineHeight: 20 },
});
