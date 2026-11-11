import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SUPPORT_CONTACT, supportContactHref } from '../../../../shared/support-contact';
import { useResource } from '@/lib/api';
import { operatorPublicationSchema, PUBLIC_PATHS } from '@/lib/published-info';
import { MobileIcon } from './mobile-chrome';
import { editorial, usePalette } from './ui';

type Channel = keyof typeof SUPPORT_CONTACT;
const whatsappHref = supportContactHref('whatsapp', process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP_PHONE);

export function useMobileSupportPhone() {
  const operator = useResource(PUBLIC_PATHS.operatorProfile, operatorPublicationSchema);
  return supportContactHref('phone', operator.data?.published?.profile.public_phone);
}

export function MobileContactActions({ phoneHref, inline = false, phoneLabel = SUPPORT_CONTACT.phone.label }: {
  phoneHref: string | null;
  inline?: boolean;
  phoneLabel?: string;
}) {
  const router = useRouter();
  const palette = usePalette();
  function showHelp(channel: Channel, message: string) {
    Alert.alert(SUPPORT_CONTACT[channel].label, message, [
      { text: 'Fermer', style: 'cancel' },
      { text: 'Voir les options de contact', onPress: () => router.push('/aide-mobile') },
    ], { cancelable: true });
  }

  function open(channel: Channel, href: string | null) {
    if (!href) {
      showHelp(channel, SUPPORT_CONTACT[channel].unavailable);
      return;
    }
    void Linking.openURL(href).catch(() => {
      showHelp(channel, 'Ce moyen de contact n’a pas pu être ouvert sur cet appareil.');
    });
  }

  const call = <Pressable accessibilityRole="button" accessibilityLabel={phoneLabel}
    onPress={() => open('phone', phoneHref)}
    style={({ pressed }) => [styles.call, inline ? styles.inline : styles.button, {
      backgroundColor: inline ? editorial.homeInk : palette.primary, opacity: pressed ? .8 : 1,
    }]}>
    <MobileIcon name="phone" color={editorial.white} size={19} />
    <Text style={styles.label}>{phoneLabel}</Text>
  </Pressable>;
  if (inline) return call;
  return (
    <View style={styles.actions}>
      {call}
      <Pressable accessibilityRole="button" accessibilityLabel={SUPPORT_CONTACT.whatsapp.label}
        onPress={() => open('whatsapp', whatsappHref)}
        style={({ pressed }) => [styles.button, styles.whatsapp, { borderColor: palette.border, opacity: pressed ? .8 : 1 }]}>
        <Image source={require('../../assets/public/contact-whatsapp.png')} style={styles.icon} accessible={false} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 5, paddingHorizontal: 12 },
  button: {
    minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 999,
    boxShadow: '0 4px 12px #121c3930',
  },
  call: { flexDirection: 'row', gap: 8, paddingHorizontal: 17, flexShrink: 1 },
  inline: { minHeight: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  label: { fontFamily: 'JakartaBold', fontSize: 14, color: editorial.white, flexShrink: 1, textAlign: 'center' },
  whatsapp: { width: 48, borderWidth: 1, backgroundColor: editorial.white },
  icon: { width: 23, height: 23 },
});
