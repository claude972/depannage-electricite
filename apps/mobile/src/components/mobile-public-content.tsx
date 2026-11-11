import { useState } from 'react';
import { Image, type ImageProps } from 'expo-image';
import { openBrowserAsync } from 'expo-web-browser';
import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiOrigin } from '@/lib/config';
import { categoryLabel, indicativeRange, servicePhotoPosition, servicePhotoUri, type PublicService } from '@/lib/public-services';
import type { z } from 'zod';
import type { prices } from '@/lib/contracts';
import { MobileIcon } from './mobile-chrome';
import { Action, Copy, ReadState, editorial, usePalette } from './ui';

export const publicPhotos = {
  cabinet: require('../../assets/public/cabinet.jpg'),
  electrician: require('../../assets/public/electrician.jpg'),
  panel: require('../../assets/public/panel-work.jpg'),
  outlet: require('../../assets/public/outlet.jpg'),
  lighting: require('../../assets/public/lighting.jpg'),
} as const;

export function articlePhoto(path: string) {
  if (path.endsWith('/section-outlet.jpg')) return publicPhotos.outlet;
  if (path.endsWith('/section-real-panel.jpg')) return publicPhotos.panel;
  return publicPhotos.cabinet;
}

export function ServicePhoto({ service, fallback, decorative = false, style }: {
  service: PublicService; fallback: number; decorative?: boolean; style: ImageProps['style'];
}) {
  const uri = servicePhotoUri(service.photo?.src);
  const [failed, setFailed] = useState<string | null>(null);
  const remote = uri !== null && failed !== uri;
  const described = !decorative && remote && service.alt.length > 0;
  return <Image
    source={remote ? { uri } : fallback} placeholder={fallback} placeholderContentFit="cover"
    contentFit="cover" contentPosition={remote ? servicePhotoPosition(service.position) : undefined}
    onError={() => setFailed(uri)} style={style}
    accessible={described} accessibilityRole={described ? 'image' : undefined}
    accessibilityLabel={described ? service.alt : undefined}
    accessibilityElementsHidden={!described} importantForAccessibility={described ? 'yes' : 'no'}/>;
}

const categoryPhotos = {
  outage: publicPhotos.cabinet, socket: publicPhotos.outlet, panel: publicPhotos.panel,
  lighting: publicPhotos.lighting, diagnostic: publicPhotos.cabinet,
};

export function PublicServiceRow({ item, price }: { item: PublicService; price: z.infer<typeof prices> | null }) {
  const router = useRouter();
  const p = usePalette();
  const range = indicativeRange(price, item.category);
  const category = categoryLabel(item.category);
  return <Pressable accessibilityRole="link"
    accessibilityLabel={item.title + '. ' + category + (range ? '. Fourchette indicative ' + range.spoken : '')}
    onPress={() => router.push({ pathname: '/prestation/[slug]', params: { slug: item.slug } })}
    style={({ pressed }) => [styles.service, { borderColor: p.border, backgroundColor: pressed ? p.subtle : p.surface }]}>
    <ServicePhoto service={item} fallback={categoryPhotos[item.category]} decorative style={styles.thumbnail} />
    <View style={styles.grow}>
      <Text style={[styles.category, { color: p.muted }]}>{category.toLocaleUpperCase('fr-FR')}</Text>
      <Text style={[styles.serviceTitle, { color: p.text }]}>{item.title}</Text>
      {range && <Text style={[styles.range, { color: p.muted }]}>Estimation indicative : {range.text}</Text>}
    </View>
    <MobileIcon name="next" color={p.blue} size={16} />
  </Pressable>;
}

export function PublicReadState({ context, ...state }: Parameters<typeof ReadState>[0] & { context: string }) {
  return <>
    {state.error && <Copy>{context}</Copy>}
    <ReadState {...state} />
  </>;
}

export function PublicFooterAction({ label, onPress }: { label: string; onPress: () => void }) {
  const { bottom } = useSafeAreaInsets();
  const p = usePalette();
  return <View style={[styles.footerAction, { borderColor: p.border, backgroundColor: p.surface, paddingBottom: Math.max(bottom, 12) }]}>
    <Action label={label} onPress={onPress} />
  </View>;
}

export function PublicLink({ label, onPress, light = false }: { label: string; onPress: () => void; light?: boolean }) {
  const p = usePalette();
  return <Pressable accessibilityRole="link" onPress={onPress} style={styles.link}>
    <Text style={[styles.linkText, { color: light ? editorial.white : p.blue }]}>{label}</Text>
    {!light && <MobileIcon name="next" color={p.blue} size={14} />}
  </Pressable>;
}

export function usePublicPortal() {
  const [portalError, setPortalError] = useState<string | null>(null);
  function openPortal(path: string) {
    if (!apiOrigin) {
      setPortalError('Le portail est indisponible pour le moment.');
      return;
    }
    setPortalError(null);
    void openBrowserAsync(apiOrigin + path).catch(() => setPortalError('Le portail n’a pas pu s’ouvrir. Réessayez.'));
  }
  return { openPortal, portalError };
}

const groups: { title: string; links: { label: string; href: Href }[] }[] = [
  { title: 'Services', links: [
    { label: 'Voir les dépannages', href: '/catalogue' }, { label: 'Zones d’intervention', href: '/aide-mobile' },
  ] },
  { title: 'Assistance', links: [
    { label: 'Aide', href: '/aide-mobile' }, { label: 'Suivre mon intervention', href: '/retrouver' },
    { label: 'Nous contacter', href: '/aide-mobile' }, { label: 'Garantie', href: '/aide-mobile' },
  ] },
  { title: 'À propos', links: [
    { label: 'Candidature électricien', href: '/candidature' }, { label: 'Le blog du dépannage', href: '/conseils' },
  ] },
];

export function PublicEditorialFooter() {
  const router = useRouter();
  const { openPortal, portalError } = usePublicPortal();
  return <View style={styles.editorialFooter}>
    <Image source={require('../../assets/images/splash.png')} style={styles.footerLogo} contentFit="contain"
      accessible accessibilityLabel="DomDépannage" />
    <Text style={styles.footerCopy}>De la demande au suivi de votre intervention électrique.</Text>
    {groups.map(group => <View key={group.title}>
      <Text accessibilityRole="header" style={styles.footerTitle}>{group.title}</Text>
      {group.links.map(link => <PublicLink key={link.label} label={link.label} light onPress={() => router.navigate(link.href)} />)}
    </View>)}
    <PublicLink label="Confidentialité" light onPress={() => openPortal('/#privacy')} />
    <PublicLink label="Mentions légales" light onPress={() => openPortal('/#legal')} />
    {portalError && <Text accessibilityLiveRegion="polite" style={styles.footerCopy}>{portalError}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  service: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 9, borderWidth: 1, borderRadius: 14 },
  thumbnail: { width: 68, height: 58, borderRadius: 9 },
  category: { fontFamily: 'JakartaSemiBold', fontSize: 10, lineHeight: 15 },
  serviceTitle: { fontFamily: 'JakartaBold', fontSize: 14, lineHeight: 20 },
  range: { fontFamily: 'JakartaRegular', fontSize: 12, lineHeight: 17 },
  footerAction: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 10 },
  link: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { fontFamily: 'JakartaBold', fontSize: 13 },
  editorialFooter: { gap: 9, backgroundColor: editorial.navy, padding: 22 },
  footerLogo: { width: 90, height: 52, borderRadius: 6 },
  footerCopy: { fontFamily: 'JakartaRegular', fontSize: 13, lineHeight: 20, color: '#EDF1FF' },
  footerTitle: { fontFamily: 'JakartaBold', fontSize: 15, color: editorial.white, marginTop: 8 },
});
