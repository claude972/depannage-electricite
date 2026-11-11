import { Image, type ImageProps } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  categoryLabel, featuredServices, indicativeRange, servicePhotoPosition, servicePhotoUri,
  useIndicativePrices, usePublicServices, type PublicService,
} from '@/lib/public-services';

// Direction Mobile B (Figma hec6XdQ7IbOFVeFhq6KPDw) : couleurs exactes des
// écrans client clair et sombre.
const lightPalette = {
  background: '#FFFFFF', surface: '#FFFFFF', navigation: '#FFFFFF', text: '#12151C', muted: '#515B6B',
  border: '#DFE3EB', accent: '#2246E5', primary: '#2246E5', onPrimary: '#FFFFFF', danger: '#B42318',
};
const darkPalette: typeof lightPalette = {
  background: '#111318', surface: '#1B2028', navigation: '#1B2028', text: '#F7F9FC', muted: '#B9C2D0',
  border: '#343C49', accent: '#91A4FF', primary: '#2246E5', onPrimary: '#FFFFFF', danger: '#FF9F9F',
};
// Pictogrammes Figma, un fichier par thème (assets-manifest.json).
const lightIcons = {
  bell: require('../../assets/mobile-b/3861f.svg'),
  pin: require('../../assets/mobile-b/697ca.svg'), chevron: require('../../assets/mobile-b/7ab3e.svg'),
  check: require('../../assets/mobile-b/a0a32.svg'), chevronAccent: require('../../assets/mobile-b/c8f21.svg'),
  home: require('../../assets/mobile-b/1165a.svg'), file: require('../../assets/mobile-b/783ab.svg'),
  help: require('../../assets/mobile-b/cdf42.svg'),
};
const darkIcons: typeof lightIcons = {
  bell: require('../../assets/mobile-b/f58c4.svg'),
  pin: require('../../assets/mobile-b/19cee.svg'), chevron: require('../../assets/mobile-b/ef4a7.svg'),
  check: require('../../assets/mobile-b/f0c76.svg'), chevronAccent: require('../../assets/mobile-b/4e40c.svg'),
  home: require('../../assets/mobile-b/9e7c4.svg'), file: require('../../assets/mobile-b/54537.svg'),
  help: require('../../assets/mobile-b/3e4ba.svg'),
};
/** Photographies de la maquette, aux emplacements qu’elle représente. */
export const mobileBPhotos = {
  editorial: require('../../assets/mobile-b/337b8.jpg') as number,
  sockets: require('../../assets/mobile-b/93981.jpg') as number,
};

export function useMobileB() {
  const dark = useColorScheme() === 'dark';
  return { palette: dark ? darkPalette : lightPalette, icons: dark ? darkIcons : lightIcons };
}

function Icon({ source, size }: { source: number; size: number }) {
  return <Image source={source} contentFit="contain" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no" style={{ width: size, height: size }}/>;
}

/**
 * Photo de fiche : image de l’API lorsqu’elle est valide et se charge, sinon
 * la photographie locale de la maquette. Un échec distant ne casse rien.
 */
export function ServicePhoto({ service, fallback, decorative = false, style }: {
  service: PublicService; fallback: number; decorative?: boolean; style: ImageProps['style'];
}) {
  const uri = servicePhotoUri(service.photo?.src);
  const [failed, setFailed] = useState<string | null>(null);
  const remote = uri !== null && failed !== uri;
  const described = !decorative && remote && service.alt.length > 0;
  return <Image
    source={remote && uri ? { uri } : fallback} placeholder={fallback} placeholderContentFit="cover"
    contentFit="cover" contentPosition={remote ? servicePhotoPosition(service.position) : undefined}
    onError={() => setFailed(uri)} transition={150} style={style}
    accessible={described} accessibilityRole={described ? 'image' : undefined}
    accessibilityLabel={described ? service.alt : undefined}
    accessibilityElementsHidden={!described} importantForAccessibility={described ? 'yes' : 'no'}/>;
}

/** États de lecture d’une ressource publique : chargement, puis erreur avec reprise. */
export function MobileBState({ loading, error, onRetry, context }: {
  loading: boolean; error: string | null; onRetry: () => void; context: string;
}) {
  const { palette } = useMobileB();
  if (loading) return <View accessible accessibilityRole="progressbar" accessibilityLabel="Chargement en cours" style={styles.loading}>
    <ActivityIndicator color={palette.accent}/>
    <Text style={[styles.note, { color: palette.muted }]}>Chargement…</Text>
  </View>;
  if (!error) return null;
  return <View accessibilityLiveRegion="polite" style={[styles.stateCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
    <Text style={[styles.stateTitle, { color: palette.text }]}>{context}</Text>
    <Text style={[styles.note, { color: palette.danger }]}>{error}</Text>
    <Pressable accessibilityRole="button" onPress={onRetry}
      style={({ pressed }) => [styles.retry, { borderColor: palette.border, opacity: pressed ? .76 : 1 }]}>
      <Text style={[styles.retryText, { color: palette.accent }]}>Réessayer</Text>
    </Pressable>
  </View>;
}

/**
 * Action basse fixe. À placer après la zone défilante, dans une colonne
 * flex : elle occupe sa propre zone et ne recouvre jamais le contenu.
 */
export function MobileBFooterAction({ label, onPress }: { label: string; onPress: () => void }) {
  const { palette } = useMobileB();
  const insets = useSafeAreaInsets();
  return <View style={[styles.footer, { backgroundColor: palette.background, paddingBottom: insets.bottom + 12 }]}>
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => [styles.footerAction, { backgroundColor: palette.primary, opacity: pressed ? .76 : 1 }]}>
      <Text style={[styles.actionText, { color: palette.onPrimary }]}>{label}</Text>
    </Pressable>
  </View>;
}

// Voile de lisibilité de la maquette (dégradé horizontal 88 % → 25 %), rendu
// en bandes pour ne dépendre d’aucune bibliothèque de dégradé.
const veil = Array.from({ length: 18 }, (_, index) => `rgba(6,10,23,${(.88 - .63 * index / 17).toFixed(3)})`);

function NavigationItem({ label, icon, selected = false, onPress }: {
  label: string; icon: number; selected?: boolean; onPress?: () => void;
}) {
  const { palette } = useMobileB();
  const content = <>
    <Icon source={icon} size={20}/>
    <Text numberOfLines={1} maxFontSizeMultiplier={1.4}
      style={[selected ? styles.navigationActive : styles.navigationLabel, { color: selected ? palette.accent : palette.muted }]}>{label}</Text>
  </>;
  if (!onPress) return <View accessible accessibilityRole="tab" accessibilityLabel={label}
    accessibilityState={{ selected }} style={styles.navigationItem}>{content}</View>;
  return <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress}
    style={({ pressed }) => [styles.navigationItem, { opacity: pressed ? .6 : 1 }]}>{content}</Pressable>;
}

/**
 * Accueil client Mobile B. Par défaut : visiteur sans compte (cloche vers la
 * connexion, « Mes demandes » vers la recherche de dossier). L’accueil
 * authentifié peut fournir ses propres destinations.
 */
export function MobileClientHome({ notificationsHref = '/connexion', requestsHref = '/retrouver' }: {
  notificationsHref?: Href; requestsHref?: Href;
}) {
  const router = useRouter();
  const { palette, icons } = useMobileB();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const services = usePublicServices();
  const pricing = useIndicativePrices();
  const compact = width < 360;
  const featured = services.data ? featuredServices(services.data.items) : [];

  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.flex, { backgroundColor: palette.background }]}>
    <ScrollView style={styles.flex} contentContainerStyle={[styles.content, compact && styles.contentCompact]}>
      <View style={styles.brand}>
        <View accessible accessibilityRole="header" accessibilityLabel="DomDépannage" style={styles.grow}>
          <Image source={require('../../assets/images/splash.png')} style={styles.brandLogo}
            contentFit="contain" accessible={false}/>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Notifications"
          accessibilityHint="Ouvre la connexion, nécessaire pour recevoir des notifications."
          onPress={() => router.push(notificationsHref)}
          style={({ pressed }) => [styles.bell, { backgroundColor: palette.surface, opacity: pressed ? .6 : 1 }]}>
          <Icon source={icons.bell} size={22}/>
        </Pressable>
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Lieu d’intervention. Choisir mon adresse"
        onPress={() => router.push({ pathname: '/demande-client', params: { field: 'address' } })}
        style={({ pressed }) => [styles.address, { backgroundColor: palette.surface, opacity: pressed ? .76 : 1 }]}>
        <Icon source={icons.pin} size={20}/>
        <View style={styles.grow}>
          <Text style={[styles.eyebrow, { color: palette.muted }]}>LIEU D’INTERVENTION</Text>
          <Text style={[styles.addressValue, { color: palette.text }]}>Choisir mon adresse</Text>
        </View>
        <Icon source={icons.chevron} size={16}/>
      </Pressable>

      <View style={styles.hero}>
        <Image source={mobileBPhotos.editorial} contentFit="cover" accessible={false} accessibilityElementsHidden
          importantForAccessibility="no" style={StyleSheet.absoluteFill}/>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.veil]}>
          {veil.map((backgroundColor, index) => <View key={index} style={[styles.grow, { backgroundColor }]}/>)}
        </View>
        <View style={[styles.heroBody, compact && styles.heroBodyCompact]}>
          <Text style={[styles.eyebrow, styles.onPhoto]}>UN PROBLÈME ÉLECTRIQUE ?</Text>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3}
            style={[styles.heroTitle, compact && styles.heroTitleCompact, styles.onPhoto]}>{'Un dépannage,\nen toute clarté.'}</Text>
          <Text style={[styles.heroCopy, styles.onPhoto]}>{'Expliquez ce qui ne va pas.\nL’artisan vous proposera un devis.'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Présenter mon besoin"
            onPress={() => router.push('/demande-client')}
            style={({ pressed }) => [styles.heroAction, { backgroundColor: palette.primary, opacity: pressed ? .76 : 1 }]}>
            <Text style={[styles.actionText, { color: palette.onPrimary }]}>Présenter mon besoin  →</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.proofs}>
        {['Devis avant travaux', 'Compte facultatif'].map(label => <View key={label} style={styles.proof}>
          <Icon source={icons.check} size={16}/>
          <Text style={[styles.proofText, { color: palette.muted }]}>{label}</Text>
        </View>)}
      </View>

      <View style={styles.services}>
        <View style={styles.servicesHeading}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: palette.text }]}>Quel est votre besoin ?</Text>
          <Pressable accessibilityRole="link" accessibilityLabel="Tout voir" accessibilityHint="Ouvre le catalogue complet."
            hitSlop={14} onPress={() => router.push('/catalogue')} style={({ pressed }) => [styles.seeAll, { opacity: pressed ? .6 : 1 }]}>
            <Text style={[styles.seeAllText, { color: palette.accent }]}>Tout voir</Text>
          </Pressable>
        </View>
        <MobileBState loading={services.loading} error={services.error} onRetry={services.reload}
          context="Les interventions ne peuvent pas être affichées pour le moment."/>
        {services.data && !featured.length && <Text style={[styles.note, { color: palette.muted }]}>
          Aucune intervention n’est proposée pour le moment. Vous pouvez tout de même présenter votre besoin.
        </Text>}
        {featured.map((item, index) => {
          const range = indicativeRange(pricing.data, item.category);
          const estimate = range ? `${range.text} · fourchette indicative` : 'Diagnostic et devis à confirmer';
          const spoken = range ? `Fourchette indicative ${range.spoken}` : 'Diagnostic et devis à confirmer';
          return <Pressable key={item.slug} accessibilityRole="link"
            accessibilityLabel={`${item.title}. ${categoryLabel(item.category)}. ${spoken}.`}
            accessibilityHint="Ouvre la fiche de cette intervention."
            onPress={() => router.push({ pathname: '/prestation/[slug]', params: { slug: item.slug } })}
            style={({ pressed }) => [styles.card, { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? .76 : 1 }]}>
            <ServicePhoto decorative service={item} fallback={index === 0 ? mobileBPhotos.sockets : mobileBPhotos.editorial}
              style={styles.cardPhoto}/>
            <View style={styles.cardBody}>
              <Text style={[styles.eyebrow, { color: palette.muted }]}>{categoryLabel(item.category).toLocaleUpperCase('fr-FR')}</Text>
              <Text style={[styles.cardTitle, { color: palette.text }]}>{item.title}</Text>
              <Text style={[styles.cardEstimate, { color: palette.muted }]}>{estimate}</Text>
            </View>
            <Icon source={icons.chevronAccent} size={16}/>
          </Pressable>;
        })}
      </View>
      <Pressable accessibilityRole="link" onPress={() => router.push('/aide-mobile')}
        style={({ pressed }) => [styles.advice, { opacity: pressed ? .8 : 1 }]}>
        <Text style={styles.adviceTitle}>Conseils &amp; prévention</Text>
        <Text style={styles.adviceCopy}>Les bons réflexes en cas de panne électrique →</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => router.push('/connexion')}
        style={({ pressed }) => [styles.retry, { borderColor: palette.border, opacity: pressed ? .76 : 1 }]}>
        <Text style={[styles.retryText, { color: palette.accent }]}>Accéder à mon espace</Text>
      </Pressable>
    </ScrollView>

    <View accessibilityRole="tablist" style={[styles.navigation, { backgroundColor: palette.navigation, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <NavigationItem selected label="Accueil" icon={icons.home}/>
      <NavigationItem label="Mes demandes" icon={icons.file} onPress={() => router.push(requestsHref)}/>
      <NavigationItem label="Aide" icon={icons.help} onPress={() => router.push('/aide-mobile')}/>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 20, width: '100%', maxWidth: 650, alignSelf: 'center' },
  contentCompact: { paddingHorizontal: 16 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandLogo: { width: '100%', maxWidth: 112, aspectRatio: 313 / 181, borderRadius: 8 },
  bell: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  address: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, minHeight: 48 },
  eyebrow: { fontFamily: 'JakartaBold', fontSize: 11, lineHeight: 15 },
  addressValue: { fontFamily: 'JakartaSemiBold', fontSize: 13, lineHeight: 18 },
  hero: { minHeight: 248, borderRadius: 24, overflow: 'hidden' },
  veil: { flexDirection: 'row' },
  heroBody: { paddingHorizontal: 24, paddingVertical: 22, gap: 14, alignItems: 'flex-start' },
  heroBodyCompact: { paddingHorizontal: 18 },
  onPhoto: { color: '#FFFFFF' },
  heroTitle: { fontFamily: 'JakartaBold', fontSize: 33, lineHeight: 38 },
  heroTitleCompact: { fontSize: 27, lineHeight: 32 },
  heroCopy: { fontFamily: 'JakartaRegular', fontSize: 13, lineHeight: 18 },
  heroAction: { minHeight: 48, minWidth: 228, maxWidth: '100%', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontFamily: 'JakartaSemiBold', fontSize: 14, lineHeight: 22, letterSpacing: -.28, textAlign: 'center' },
  proofs: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 8 },
  proof: { flexDirection: 'row', alignItems: 'center', gap: 6, flexGrow: 1, flexBasis: 140 },
  proofText: { fontFamily: 'JakartaSemiBold', fontSize: 11, lineHeight: 16, flexShrink: 1 },
  services: { gap: 12 },
  servicesHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { flex: 1, fontFamily: 'JakartaBold', fontSize: 20, lineHeight: 28 },
  seeAll: { minHeight: 28, justifyContent: 'center' },
  seeAllText: { fontFamily: 'JakartaSemiBold', fontSize: 12, lineHeight: 17, textAlign: 'right' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: .7, borderRadius: 18 },
  cardPhoto: { width: 62, height: 60, borderRadius: 12 },
  cardBody: { flex: 1, minWidth: 0, gap: 3 },
  cardTitle: { fontFamily: 'JakartaBold', fontSize: 14, lineHeight: 20 },
  cardEstimate: { fontFamily: 'JakartaRegular', fontSize: 12, lineHeight: 17 },
  navigation: { flexDirection: 'row', gap: 12, paddingHorizontal: 24, paddingTop: 12 },
  navigationItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3 },
  navigationLabel: { fontFamily: 'JakartaSemiBold', fontSize: 11, lineHeight: 15, textAlign: 'center' },
  navigationActive: { fontFamily: 'JakartaBold', fontSize: 11, lineHeight: 15, textAlign: 'center' },
  loading: { alignItems: 'center', gap: 10, padding: 16 },
  advice: { backgroundColor: '#FF6B35', borderRadius: 18, padding: 16, gap: 6 },
  adviceTitle: { fontFamily: 'JakartaBold', fontSize: 16, lineHeight: 22, color: '#12151C' },
  adviceCopy: { fontFamily: 'JakartaSemiBold', fontSize: 13, lineHeight: 19, color: '#12151C' },
  note: { fontFamily: 'JakartaRegular', fontSize: 14, lineHeight: 20 },
  stateCard: { padding: 16, gap: 10, borderWidth: 1, borderRadius: 18 },
  stateTitle: { fontFamily: 'JakartaBold', fontSize: 15, lineHeight: 22 },
  retry: { minHeight: 44, paddingHorizontal: 16, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  retryText: { fontFamily: 'JakartaSemiBold', fontSize: 14, lineHeight: 22 },
  footer: { paddingHorizontal: 24, paddingTop: 12 },
  footerAction: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 602, alignSelf: 'center' },
});
