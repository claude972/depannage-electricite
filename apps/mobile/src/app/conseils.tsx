import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { PUBLIC_ADVICE } from '../../../../shared/public-advice';
import { PublicTabs } from '@/components/mobile-chrome';
import { articlePhoto, PublicLink } from '@/components/mobile-public-content';
import { Card, Copy, Screen } from '@/components/ui';

export default function Conseils() {
  const router = useRouter();
  const { article } = useLocalSearchParams<{ article?: string }>();
  const selected = PUBLIC_ADVICE.find(item => item.id === article);
  return <Screen footer={<PublicTabs />}>
    <Copy kind="title">{selected?.title ?? 'Le blog du dépannage'}</Copy>
    {selected
      ? <Card>
          <Image source={articlePhoto(selected.image)} style={styles.photo} contentFit="cover" accessible={false} />
          <Copy kind="label">{selected.topic}</Copy>
          {selected.paragraphs.map(paragraph => <Copy key={paragraph}>{paragraph}</Copy>)}
          <PublicLink label="Voir tous les conseils" onPress={() => router.replace('/conseils')} />
        </Card>
      : <>
          <Copy kind="muted">Des conseils pour préparer votre intervention.</Copy>
          {PUBLIC_ADVICE.map(item => <Card key={item.id}>
            <Image source={articlePhoto(item.image)} style={styles.photo} contentFit="cover" accessible={false} />
            <Copy kind="label">{item.topic}</Copy>
            <PublicLink label={item.title} onPress={() => router.push({ pathname: '/conseils', params: { article: item.id } })} />
            <Copy kind="muted">{item.summary}</Copy>
          </Card>)}
        </>}
  </Screen>;
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 150, borderRadius: 12 },
});
