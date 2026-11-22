import { MobileContactActions, useMobileSupportPhone } from '@/components/mobile-contact-actions';
import { useRef, useState } from 'react';
import { Host, Picker } from '@expo/ui';
import { MenuView } from '@expo/ui/community/menu';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COMMITMENTS, FAQ, STEPS } from '../../../../shared/public-home';
import { INTERVENTION_PROFILES, repairSituations, type RepairSituation } from '../../../../shared/intervention-profile';
import { HOME_SUPPORT_PREVIEW } from '../../../../shared/support-contact';
import { PUBLIC_ADVICE } from '../../../../shared/public-advice';
import { useIndicativePrices, usePublicServices } from '@/lib/public-services';
import { MobileIcon, PublicTabs, type Glyph } from './mobile-chrome';
import { articlePhoto, PublicLink, publicPhotos, PublicReadState, PublicServiceRow, usePublicPortal } from './mobile-public-content';
import { Action, Card, Copy, Field, editorial, usePalette } from './ui';
import { AppSheet } from './app-sheet';

type Situation = { title: string; description: string; photo: number } &
  ({ slug: string; portal?: never } | { portal: string; slug?: never });

const repairPhotos: Record<RepairSituation['photo'], number> = {
  outage: publicPhotos.cabinet,
  socket: publicPhotos.outlet,
  panel: publicPhotos.electrician,
  light: publicPhotos.lighting,
  inspection: publicPhotos.electrician,
};
function toSituation({ title, description, slug, photo }: RepairSituation): Situation {
  return { title, description, slug, photo: repairPhotos[photo] };
}

const household = repairSituations('particulier');
const shortcuts = [
  { label: 'Coupure', art: require('../../assets/public/outage.png') },
  { label: 'Prises', art: require('../../assets/public/socket.png') },
  { label: 'Tableau', art: require('../../assets/public/panel.png') },
  { label: 'Éclairage', art: require('../../assets/public/light.png') },
].map((item, index) => ({ ...item, situation: toSituation(household[index]) }));
const showSupportPreview = process.env.EXPO_PUBLIC_HOME_SUPPORT_PREVIEW === 'true';

const modes: { label: string; title: string; icon: Glyph; items: Situation[] }[] = [
  { label: 'Dépannage', title: 'Dépannages courants', icon: 'bolt', items: [] },
  { label: 'Installation', title: 'Installations courantes', icon: 'plug', items: [
    { title: 'Ajouter une prise', description: 'Préparez la pose d’un nouveau point électrique.', photo: publicPhotos.outlet,
      portal: '/#new/installation-prise' },
    { title: 'Installer un luminaire', description: 'Décrivez le luminaire et son emplacement.', photo: publicPhotos.lighting,
      portal: '/#new/installation-luminaire' },
  ] },
  { label: 'Diagnostic', title: 'Situations à vérifier', icon: 'search', items: [
    { title: 'Origine de la panne inconnue', description: 'Vous constatez une anomalie sans avoir identifié son origine.',
      slug: 'origine-de-la-panne-inconnue', photo: publicPhotos.cabinet },
    { title: 'Faire vérifier le tableau', description: 'Décrivez le problème pour orienter la vérification.',
      slug: 'panne-tableau-electrique', photo: publicPhotos.panel },
    toSituation(household[2]),
  ] },
];

const commitmentIcons = { receipt: 'price', shield: 'shield', help: 'help' } as const;

function normalize(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr').trim();
}

type Detail = { title: string; text: string; link?: { text: string; href: string } };

function DetailRows({ items }: { items: Detail[] }) {
  const router = useRouter();
  const p = usePalette();
  const [expanded, setExpanded] = useState<string | null>(null);
  return <View>
    {items.map(item => {
      const open = expanded === item.title;
      return <View key={item.title} style={[styles.detail, { borderColor: p.border }]}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.detailButton}
          onPress={() => setExpanded(open ? null : item.title)}>
          <Text style={[styles.strong, styles.grow, { color: p.text }]}>{item.title}</Text>
          <MobileIcon name={open ? 'collapse' : 'expand'} color={p.blue} size={15} />
        </Pressable>
        {open && <>
          <Copy kind="muted">{item.text}</Copy>
          {item.link && <PublicLink label={item.link.text}
            onPress={() => router.navigate(item.link?.href === '/suivi' ? '/retrouver' : '/aide-mobile')} />}
        </>}
      </View>;
    })}
  </View>;
}

export function MobileClientHome({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const p = usePalette();
  const { width } = useWindowDimensions();
  const services = usePublicServices();
  const prices = useIndicativePrices();
  const phoneHref = useMobileSupportPhone();
  const { openPortal, portalError } = usePublicPortal();
  const [modeIndex, setModeIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [profile, setProfile] = useState('particulier');
  const [cityDraft, setCityDraft] = useState('');
  const [locationOpen, setLocationOpen] = useState(false);
  const locationParams = city ? { commune: city } : {};
  const scroll = useRef<ScrollViewInstance>(null);
  const rail = useRef<ScrollViewInstance>(null);
  const railOffset = useRef(0);
  const railY = useRef(0);
  const mode = modes[modeIndex];
  const normalized = normalize(query);
  const situations = modeIndex === 0 ? repairSituations(profile).map(toSituation) : mode.items;
  const items = situations.filter(item => !normalized || normalize(item.title + ' ' + item.description).includes(normalized));
  const profileLabel = INTERVENTION_PROFILES.find(item => item.value === profile)?.label;
  const scheme = p.background === editorial.white ? 'light' : 'dark';
  const profileWidth = (Math.min(width, 650) - 40) / 2.4;
  const cardWidth = Math.min(Math.max(190, (width - 32) * .78), 290);

  function openSituation(item: Situation) {
    if (item.portal) openPortal(item.portal);
    else router.push({ pathname: '/prestation/[slug]', params: { slug: item.slug, ...locationParams } });
  }

  function selectMode(index: number) {
    setModeIndex(index);
    setQuery('');
    railOffset.current = 0;
    rail.current?.scrollTo({ x: 0, animated: false });
  }

  function selectProfile(value: string) {
    setProfile(value);
    railOffset.current = 0;
    rail.current?.scrollTo({ x: 0, animated: false });
  }

  function moveRail(direction: -1 | 1) {
    const next = Math.max(0, Math.min((items.length - 1) * (cardWidth + 10), railOffset.current + direction * (cardWidth + 10)));
    rail.current?.scrollTo({ x: next, animated: true });
  }

  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.flex, { backgroundColor: p.background }]}>
    <ScrollView ref={scroll} style={styles.flex} keyboardShouldPersistTaps="handled">
      <View style={styles.content}>
        <View style={styles.entry}>
          <View style={styles.locationAndProfile}>
            <Pressable accessibilityRole="button" onPress={() => { setCityDraft(city); setLocationOpen(true); }}
              style={[styles.address, styles.identityField]}>
              <MobileIcon name="pin" color={p.blue} size={18} />
              <View style={styles.grow}>
                <Text style={[styles.small, { color: p.muted }]}>Lieu d’intervention</Text>
                <Text style={[styles.strong, { color: p.text }]}>{city || 'Choisir mon adresse'}</Text>
              </View>
              <MobileIcon name="next" color={p.blue} size={16} />
            </Pressable>
            {Platform.OS === 'web' ? (
              <View style={styles.profilePicker}>
                <Text style={[styles.small, { color: p.muted }]}>Je suis un</Text>
                <Host style={styles.pickerHost} colorScheme={scheme}>
                  <Picker<string> selectedValue={profile} onValueChange={selectProfile} appearance="menu" testID="intervention-profile">
                    {INTERVENTION_PROFILES.map(({ value, label }) => <Picker.Item key={value} label={label} value={value} />)}
                  </Picker>
                </Host>
              </View>
            ) : (
              <MenuView
                testID="intervention-profile"
                style={{ width: profileWidth }}
                colorScheme={scheme}
                actions={INTERVENTION_PROFILES.map(({ value, label }) => ({
                  id: value, title: label, state: profile === value ? 'on' : 'off',
                }))}
                onPressAction={({ nativeEvent }) => selectProfile(nativeEvent.event)}
              >
                <View accessible accessibilityRole="button" accessibilityLabel={`Je suis un · ${profileLabel}`} style={[styles.identityField, { width: profileWidth }]}>
                  <MobileIcon name="account" color={p.blue} size={18} />
                  <View style={styles.grow}>
                    <Text style={[styles.small, { color: p.muted }]}>Je suis un</Text>
                    <Text style={[styles.strong, { color: p.text }]}>{profileLabel}</Text>
                  </View>
                  <MobileIcon name="expand" color={p.blue} size={16} />
                </View>
              </MenuView>
            )}
          </View>
          <View accessibilityRole="tablist" accessibilityLabel="Type de service" style={[styles.modes, { borderColor: p.border }]}>
            {modes.map((item, index) => {
              const selected = index === modeIndex;
              const color = selected ? p.blue : p.muted;
              return <Pressable key={item.label} accessibilityRole="tab" accessibilityState={{ selected }}
                style={[styles.mode, { borderColor: selected ? p.primary : 'transparent' }]} onPress={() => selectMode(index)}>
                <MobileIcon name={item.icon} color={color} size={15} />
                <Text style={[styles.modeText, { color }]}>{item.label}</Text>
              </Pressable>;
            })}
          </View>
          <View style={[styles.searchRow, { borderColor: p.border }]}>
            <MobileIcon name="search" color={p.muted} size={20} />
            <TextInput style={[styles.search, { color: p.text, fontSize: width < 360 ? 12 : 14 }]} accessibilityLabel="Rechercher un problème électrique"
              placeholder="Quel est le problème ?" placeholderTextColor={p.muted} value={query} onChangeText={value => {
                setQuery(value); railOffset.current = 0; rail.current?.scrollTo({ x: 0, animated: false });
              }}
              returnKeyType="search" maxLength={120} onSubmitEditing={() => {
                if (items.length === 1) openSituation(items[0]);
                else scroll.current?.scrollTo({ y: railY.current, animated: true });
              }} />
            <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/demande-client', params: { field: 'address', urgency: 'scheduled', ...locationParams } })}
              style={[styles.later, { backgroundColor: p.subtle }]}>
              <MobileIcon name="calendar" color={p.text} size={15} />
              <Text style={[styles.strong, { color: p.text }]}>Plus tard</Text>
            </Pressable>
          </View>
          {showSupportPreview && <View style={styles.responseBanner}>
            <MobileIcon name="clock" color={editorial.homeInk} size={20} />
            <Text style={[styles.responseText, styles.grow]}>
              <Text style={styles.strong}>{HOME_SUPPORT_PREVIEW.average}</Text> {HOME_SUPPORT_PREVIEW.message}
            </Text>
          </View>}
        </View>

        <View style={styles.section}>
          <Copy kind="subtitle">Pour vous</Copy>
          <View style={styles.shortcuts}>
            {shortcuts.map(item => <Pressable key={item.label} accessibilityRole="link" style={styles.shortcut}
              onPress={() => openSituation(item.situation)}>
              <View style={[styles.shortcutCircle, { backgroundColor: scheme === 'dark' ? '#282828' : '#F1F1F1' }]}>
                <Image source={item.art} style={styles.shortcutImage} accessible={false} />
              </View>
              <Text style={[styles.shortcutText, { color: p.text }]}>{item.label}</Text>
            </Pressable>)}
          </View>
        </View>

        <View onLayout={event => { railY.current = event.nativeEvent.layout.y; }} style={styles.section}>
          <View style={styles.split}>
            <Copy kind="subtitle">{mode.title}</Copy>
            {items.length > 1 && <View style={styles.railControls}>
              <Pressable accessibilityRole="button" accessibilityLabel="Cartes précédentes" onPress={() => moveRail(-1)}
                style={[styles.railButton, { backgroundColor: p.subtle }]}>
                <MobileIcon name="back" color={p.text} size={16} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Cartes suivantes" onPress={() => moveRail(1)}
                style={[styles.railButton, { backgroundColor: p.subtle }]}>
                <MobileIcon name="next" color={p.text} size={16} />
              </Pressable>
            </View>}
          </View>
          {items.length ? <ScrollView horizontal ref={rail} keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}
            snapToInterval={cardWidth + 10} decelerationRate="fast" onScroll={event => { railOffset.current = event.nativeEvent.contentOffset.x; }}
            scrollEventThrottle={64} contentContainerStyle={styles.rail}>
            {items.map(item => <Pressable key={item.title} accessibilityRole="link" accessibilityLabel={item.title}
              onPress={() => openSituation(item)} style={[styles.situation, { width: cardWidth }]}>
              <Image source={item.photo} style={styles.situationPhoto} contentFit="cover" accessible={false} />
              <View style={styles.situationBody}>
                <View style={styles.grow}>
                  <Text style={[styles.strong, styles.white]}>{item.title}</Text>
                  <Text style={[styles.small, styles.white]}>{item.description}</Text>
                </View>
                <MobileIcon name="next" color={editorial.white} size={15} />
              </View>
            </Pressable>)}
          </ScrollView> : <Card>
            <Copy>Aucune situation ne correspond à votre recherche.</Copy>
            <PublicLink label="Décrire mon besoin" onPress={() => router.push({ pathname: '/demande-client', params: locationParams })} />
            <PublicLink label="Effacer la recherche" onPress={() => setQuery('')} />
          </Card>}
          {portalError && <Copy kind="error">{portalError}</Copy>}
        </View>

        <View style={styles.banner}>
          <View style={styles.step}>
            <View style={styles.bannerIcon}><MobileIcon name="bolt" color={editorial.homeYellow} /></View>
            <View style={styles.grow}>
              <Text accessibilityRole="header" style={styles.bannerTitle}>Votre panne est urgente ?</Text>
              <Text style={styles.responseText}>Décrivez la panne et indiquez votre commune. Le créneau dépend des disponibilités.</Text>
            </View>
          </View>
          <MobileContactActions inline phoneHref={phoneHref} phoneLabel={showSupportPreview ? HOME_SUPPORT_PREVIEW.callLabel : undefined} />
          <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/demande-client', params: { urgency: 'urgent', ...locationParams } })}
            style={[styles.bannerButton, styles.urgentRequest]}>
            <Text style={[styles.strong, styles.ink]}>Décrire ma panne urgente</Text>
            <MobileIcon name="next" color={editorial.homeInk} size={15} />
          </Pressable>
        </View>

        <View style={[styles.steps, { borderColor: p.border }]}>
          <Copy kind="subtitle">De la demande au devis</Copy>
          {STEPS.map((step, index) => <View key={step.title} style={styles.step}>
            <View style={styles.stepNumber}><Text style={[styles.strong, { color: p.blue }]}>{index + 1}</Text></View>
            <View style={styles.grow}>
              <Text style={[styles.strong, { color: p.text }]}>{step.title}</Text>
              <Copy kind="muted">{step.text}</Copy>
            </View>
          </View>)}
          <PublicLink label="Présenter mon besoin" onPress={() => router.push({ pathname: '/demande-client', params: locationParams })} />
        </View>

        <View style={styles.section}>
          <Copy kind="subtitle">Nos engagements</Copy>
          {COMMITMENTS.map(item => <Card key={item.title}>
            <View style={styles.step}>
              <MobileIcon name={commitmentIcons[item.icon]} color={p.blue} size={20} />
              <View style={styles.grow}>
                <Text style={[styles.strong, { color: p.text }]}>{item.title}</Text>
                <Copy kind="muted">{item.text}</Copy>
                {item.link && <PublicLink label={item.link.text} onPress={() => router.navigate('/aide-mobile')} />}
              </View>
            </View>
          </Card>)}
        </View>

        <View style={styles.section}>
          <Copy kind="subtitle">Les interventions électriques les plus courantes</Copy>
          <Copy kind="muted">Fourchettes indicatives TTC. Le prix final figure sur le devis que vous acceptez.</Copy>
          <PublicReadState loading={services.loading} error={services.error} onRetry={services.reload}
            context="Le catalogue ne peut pas être affiché pour le moment." />
          {services.data && services.data.items.length === 0 && <Copy kind="muted">Aucune intervention n’est proposée pour le moment.</Copy>}
          {Boolean(services.data?.items.length) && <PublicReadState loading={prices.loading} error={prices.error} onRetry={prices.reload}
            context="Les estimations ne sont pas disponibles pour le moment." />}
          {services.data?.items.map(item => <PublicServiceRow key={item.slug} item={item} price={prices.data} />)}
          <PublicLink label="Voir toutes les interventions" onPress={() => router.navigate(embedded ? '/(espace)/services' : '/catalogue')} />
        </View>

        <Card>
          <Copy kind="subtitle">Questions fréquentes</Copy>
          <Copy kind="muted">Les réponses utiles avant de demander un dépannage.</Copy>
          <PublicLink label="Voir l’assistance" onPress={() => router.navigate('/aide-mobile')} />
          <DetailRows items={FAQ} />
        </Card>

        <View style={styles.recruitment}>
          <View style={styles.banner}>
            <Text accessibilityRole="header" style={styles.bannerTitle}>Vous êtes électricien ?</Text>
            <Text style={styles.responseText}>Rejoignez notre réseau pour recevoir des propositions de mission selon votre secteur, vos compétences et vos disponibilités.</Text>
            <BannerButton label="Découvrir la candidature" onPress={() => router.navigate('/candidature')} />
          </View>
          <Image source={publicPhotos.electrician} style={styles.recruitPhoto} contentFit="cover" accessible={false} />
        </View>

        <View style={styles.section}>
          <Copy kind="subtitle">Le blog du dépannage</Copy>
          <Copy kind="muted">Des conseils pour préparer votre intervention.</Copy>
          <PublicLink label="Voir tous les conseils" onPress={() => router.navigate('/conseils')} />
          {PUBLIC_ADVICE.map(article => <Pressable key={article.id} accessibilityRole="link"
            onPress={() => router.push({ pathname: '/conseils', params: { article: article.id } })}
            style={[styles.article, { borderColor: p.border }]}>
            <Image source={articlePhoto(article.image)} style={styles.articlePhoto} contentFit="cover" accessible={false} />
            <View style={styles.articleBody}>
              <Text style={[styles.small, { color: p.blue }]}>{article.topic}</Text>
              <Text style={[styles.strong, { color: p.text }]}>{article.title}</Text>
              <Copy kind="muted">{article.summary}</Copy>
            </View>
          </Pressable>)}
        </View>
      </View>
    </ScrollView>
    <MobileContactActions phoneHref={phoneHref} />
    {!embedded && <PublicTabs />}
    <AppSheet title="Lieu d’intervention" open={locationOpen} onClose={() => setLocationOpen(false)}>
      <Field label="Commune" value={cityDraft} onChangeText={setCityDraft}
        placeholder="Fort-de-France" maxLength={120} autoCapitalize="words" />
      <Action label="Utiliser cette commune" disabled={!cityDraft.trim()} onPress={() => {
        setCity(cityDraft.trim());
        setLocationOpen(false);
      }} />
    </AppSheet>
  </SafeAreaView>;
}

function BannerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.bannerButton}>
    <Text style={[styles.strong, styles.white]}>{label}</Text>
    <MobileIcon name="next" color={editorial.white} size={15} />
  </Pressable>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28, gap: 26, width: '100%', maxWidth: 650, alignSelf: 'center' },
  entry: { gap: 10, paddingTop: 6 },
  locationAndProfile: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  profilePicker: { flex: 1, minWidth: 0 },
  pickerHost: { minHeight: 54 },
  identityField: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 57 },
  address: { flex: 1.4, minWidth: 0 },
  strong: { fontFamily: 'JakartaBold', fontSize: 14, lineHeight: 20 },
  small: { fontFamily: 'JakartaRegular', fontSize: 12, lineHeight: 17 },
  modes: { flexDirection: 'row', borderBottomWidth: 1 },
  mode: { flex: 1, minHeight: 45, borderBottomWidth: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  modeText: { fontFamily: 'JakartaBold', fontSize: 11, flexShrink: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 55, borderWidth: 1, borderRadius: 28, padding: 4, paddingStart: 12 },
  search: { flex: 1, minWidth: 0, minHeight: 44, fontFamily: 'JakartaRegular', paddingHorizontal: 4 },
  later: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, gap: 5, borderRadius: 24 },
  section: { gap: 10 },
  shortcuts: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  shortcut: { flex: 1, minWidth: 0, alignItems: 'center', gap: 5 },
  shortcutCircle: { width: '100%', maxWidth: 76, aspectRatio: 1, borderRadius: 50, alignItems: 'center', justifyContent: 'center' },
  shortcutImage: { width: '78%', height: '78%' },
  shortcutText: { fontFamily: 'JakartaBold', fontSize: 12, textAlign: 'center' },
  split: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  railControls: { flexDirection: 'row', gap: 4 },
  railButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  rail: { gap: 10 },
  situation: { overflow: 'hidden', borderRadius: 16, backgroundColor: '#183AA0' },
  situationPhoto: { width: '100%', height: 144 },
  situationBody: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11 },
  white: { color: editorial.white },
  steps: { gap: 9, borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 13 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNumber: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderWidth: 1, borderColor: editorial.navy },
  detail: { borderBottomWidth: 1, paddingBottom: 4 },
  detailButton: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  recruitment: { backgroundColor: editorial.homeYellow, borderRadius: 20, overflow: 'hidden' },
  banner: { padding: 16, gap: 9, borderRadius: 20, backgroundColor: editorial.homeYellow },
  responseBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, padding: 12, borderRadius: 13, backgroundColor: editorial.homeYellow },
  responseText: { color: editorial.homeInk, fontFamily: 'JakartaRegular', fontSize: 13, lineHeight: 20 },
  bannerTitle: { color: editorial.homeInk, fontFamily: 'JakartaBold', fontSize: 20, lineHeight: 25, marginBottom: 4 },
  ink: { color: editorial.homeInk },
  urgentRequest: { borderWidth: 1, borderColor: editorial.homeInk, backgroundColor: 'transparent', alignSelf: 'stretch', justifyContent: 'center' },
  bannerIcon: { width: 44, height: 44, backgroundColor: editorial.homeInk, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bannerButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 44, borderRadius: 12, backgroundColor: editorial.navy, alignSelf: 'flex-start' },
  recruitPhoto: { width: '100%', height: 180 },
  article: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  articlePhoto: { width: '100%', height: 140 },
  articleBody: { gap: 3, padding: 12 },
});
