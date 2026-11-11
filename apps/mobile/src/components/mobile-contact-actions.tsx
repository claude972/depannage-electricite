import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SUPPORT_CONTACT, supportContactHref } from '../../../../shared/support-contact';
import { useResource } from '@/lib/api';
import { operatorPublicationSchema, PUBLIC_PATHS } from '@/lib/published-info';
import { AppSheet } from './app-sheet';
import { MobileIcon } from './mobile-chrome';
import { Action, Copy, editorial, usePalette } from './ui';

type Channel = keyof typeof SUPPORT_CONTACT;
const whatsappHref = supportContactHref('whatsapp', process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP_PHONE);

export function MobileContactActions() {
  const router = useRouter();
  const palette = usePalette();
  const operator = useResource(PUBLIC_PATHS.operatorProfile, operatorPublicationSchema);
  const phoneHref = supportContactHref('phone', operator.data?.published?.profile.public_phone);
  const [help, setHelp] = useState<{ channel: Channel; message: string } | null>(null);

  function open(channel: Channel, href: string | null) {
    if (!href) {
      setHelp({ channel, message: SUPPORT_CONTACT[channel].unavailable });
      return;
    }
    void Linking.openURL(href).catch(() => {
      setHelp({ channel, message: 'Ce moyen de contact n’a pas pu être ouvert sur cet appareil.' });
    });
  }

  return <>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel={SUPPORT_CONTACT.phone.label}
        onPress={() => open('phone', phoneHref)}
        style={({ pressed }) => [styles.button, styles.call, { backgroundColor: palette.primary, opacity: pressed ? .8 : 1 }]}>
        <MobileIcon name="phone" color={editorial.white} size={19} />
        <Text style={styles.label}>{SUPPORT_CONTACT.phone.label}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={SUPPORT_CONTACT.whatsapp.label}
        onPress={() => open('whatsapp', whatsappHref)}
        style={({ pressed }) => [styles.button, styles.whatsapp, { borderColor: palette.border, opacity: pressed ? .8 : 1 }]}>
        <Image source={require('../../assets/public/contact-whatsapp.png')} style={styles.icon} accessible={false} />
      </Pressable>
    </View>
    <AppSheet title={help ? SUPPORT_CONTACT[help.channel].label : ''} open={help !== null} onClose={() => setHelp(null)}>
      <Copy>{help?.message}</Copy>
      <Action label="Voir les options de contact" onPress={() => {
        setHelp(null);
        router.push('/aide-mobile');
      }} />
    </AppSheet>
  </>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 5, paddingHorizontal: 12 },
  button: {
    minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 999,
    boxShadow: '0 4px 12px #121c3930',
  },
  call: { flexDirection: 'row', gap: 8, paddingHorizontal: 17, flexShrink: 1 },
  label: { fontFamily: 'JakartaBold', fontSize: 14, color: editorial.white, flexShrink: 1, textAlign: 'center' },
  whatsapp: { width: 48, borderWidth: 1, backgroundColor: editorial.white },
  icon: { width: 23, height: 23 },
});
