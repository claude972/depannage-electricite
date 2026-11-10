import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobileBFooterAction, MobileBState, ServicePhoto, mobileBPhotos, useMobileB } from '@/components/mobile-client-home';
import { categoryLabel, indicativeRange, useIndicativePrices, usePublicServices } from '@/lib/public-services';

export default function ServiceSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const { palette } = useMobileB();
  const services = usePublicServices();
  const pricing = useIndicativePrices();
  const service = services.data?.items.find(item => item.slug === slug) ?? null;
  const range = service ? indicativeRange(pricing.data, service.category) : null;
  const card = [styles.card, { backgroundColor: palette.surface, borderColor: palette.border }];
  const list = (entries: string[]) => entries.map((entry, index) => <View key={index} style={styles.entry}>
    <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.copy, { color: palette.muted }]}>•</Text>
    <Text style={[styles.copy, styles.grow, { color: palette.muted }]}>{entry}</Text>
  </View>);

  return <SafeAreaView edges={['left', 'right']} style={[styles.flex, { backgroundColor: palette.background }]}>
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <MobileBState loading={services.loading} error={services.error} onRetry={services.reload}
        context="Cette fiche ne peut pas être affichée pour le moment."/>
      {services.data && !service && <View style={card}>
        <Text accessibilityRole="header" style={[styles.cardTitle, { color: palette.text }]}>Cette fiche n’est plus disponible</Text>
        <Text style={[styles.copy, { color: palette.muted }]}>Retrouvez les interventions proposées dans le catalogue.</Text>
        <Pressable accessibilityRole="button" onPress={() => router.replace('/catalogue')}
          style={({ pressed }) => [styles.secondary, { borderColor: palette.border, opacity: pressed ? .76 : 1 }]}>
          <Text style={[styles.secondaryText, { color: palette.accent }]}>Voir le catalogue</Text>
        </Pressable>
      </View>}
      {service && <>
        <Text style={[styles.eyebrow, { color: palette.accent }]}>{categoryLabel(service.category).toLocaleUpperCase('fr-FR')}</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>{service.title}</Text>
        <Text style={[styles.intro, { color: palette.muted }]}>{service.intro}</Text>
        <ServicePhoto service={service} fallback={mobileBPhotos.editorial} style={styles.photo}/>

        <View style={card}>
          {range
            ? <Text accessibilityLabel={`Fourchette indicative ${range.spoken}`} style={[styles.range, { color: palette.accent }]}>{range.text}</Text>
            : pricing.loading && <ActivityIndicator accessibilityLabel="Chargement de la fourchette indicative" color={palette.accent} style={styles.start}/>}
          <Text style={[styles.copy, { color: palette.muted }]}>
            {range ? 'Fourchette indicative. ' : pricing.loading ? '' : 'Fourchette indicative indisponible pour le moment. '}
            Le prix final est fixé par le devis que vous acceptez.
          </Text>
          {!range && pricing.error && <Pressable accessibilityRole="button" onPress={pricing.reload}
            style={({ pressed }) => [styles.secondary, { borderColor: palette.border, opacity: pressed ? .76 : 1 }]}>
            <Text style={[styles.secondaryText, { color: palette.accent }]}>Réessayer</Text>
          </Pressable>}
        </View>

        {service.covers.length > 0 && <View style={card}>
          <Text accessibilityRole="header" style={[styles.cardTitle, { color: palette.text }]}>Ce que couvre l’intervention</Text>
          {list(service.covers)}
        </View>}
        {service.checks.length > 0 && <View style={card}>
          <Text accessibilityRole="header" style={[styles.cardTitle, { color: palette.text }]}>Points de vérification</Text>
          {list(service.checks)}
        </View>}
        {service.extras.length > 0 && <View style={[styles.card, { borderColor: palette.border }]}>
          <Text accessibilityRole="header" style={[styles.outlineTitle, { color: palette.text }]}>Si des travaux supplémentaires sont nécessaires</Text>
          {list(service.extras)}
        </View>}
        {service.faq.length > 0 && <View style={card}>
          <Text accessibilityRole="header" style={[styles.cardTitle, { color: palette.text }]}>Questions fréquentes</Text>
          {service.faq.map((item, index) => <View key={index} style={styles.question}>
            <Text style={[styles.questionTitle, { color: palette.text }]}>{item.question}</Text>
            <Text style={[styles.copy, { color: palette.muted }]}>{item.answer}</Text>
          </View>)}
        </View>}
      </>}
    </ScrollView>
    {service && <MobileBFooterAction label="Demander cette intervention"
      onPress={() => router.push({ pathname: '/demande-client', params: { service: service.slug } })}/>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  start: { alignSelf: 'flex-start' },
  content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 32, gap: 20, width: '100%', maxWidth: 650, alignSelf: 'center' },
  eyebrow: { fontFamily: 'JakartaBold', fontSize: 11, lineHeight: 16 },
  title: { fontFamily: 'JakartaBold', fontSize: 28, lineHeight: 40 },
  intro: { fontFamily: 'JakartaRegular', fontSize: 15, lineHeight: 22 },
  photo: { width: '100%', height: 180, borderRadius: 18 },
  card: { padding: 16, gap: 10, borderWidth: 1, borderRadius: 18 },
  range: { fontFamily: 'JakartaBold', fontSize: 28, lineHeight: 40 },
  cardTitle: { fontFamily: 'JakartaBold', fontSize: 17, lineHeight: 25 },
  outlineTitle: { fontFamily: 'JakartaSemiBold', fontSize: 17, lineHeight: 25 },
  copy: { fontFamily: 'JakartaRegular', fontSize: 14, lineHeight: 20 },
  entry: { flexDirection: 'row', gap: 8 },
  question: { gap: 4 },
  questionTitle: { fontFamily: 'JakartaSemiBold', fontSize: 14, lineHeight: 20 },
  secondary: { minHeight: 44, paddingHorizontal: 16, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  secondaryText: { fontFamily: 'JakartaSemiBold', fontSize: 14, lineHeight: 22 },
});
