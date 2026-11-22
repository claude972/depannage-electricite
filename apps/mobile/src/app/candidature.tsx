import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import { PublicTabs } from '@/components/mobile-chrome';
import { publicPhotos, usePublicPortal } from '@/components/mobile-public-content';
import { Action, Card, Copy, Screen } from '@/components/ui';

export default function Candidature() {
  const { openPortal, portalError } = usePublicPortal();
  return <Screen footer={<PublicTabs />}>
    <Copy kind="title">Rejoindre le réseau d’électriciens</Copy>
    <Card>
      <Image source={publicPhotos.electrician} contentFit="cover" style={styles.photo} accessible={false} />
      <Copy>Recevez des propositions de mission selon votre secteur, vos compétences et vos disponibilités.</Copy>
      <Copy kind="muted">Le dossier de candidature s’ouvre sur le portail DomDépannage.</Copy>
      <Action label="Ouvrir le dossier de candidature" onPress={() => openPortal('/#join')} />
      {portalError && <Copy kind="error">{portalError}</Copy>}
    </Card>
  </Screen>;
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 165, borderRadius: 12 },
});
