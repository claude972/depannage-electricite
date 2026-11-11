import { Stack, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { MobileIcon, MobilePublicHeader } from '@/components/mobile-chrome';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from '@/lib/session';
import { ReadState, Screen, usePalette } from '@/components/ui';

function PublicRouteHeader({ back }: { back: boolean }) {
  const router = useRouter();
  const palette = usePalette();
  return <View style={{ backgroundColor: palette.background }}>
    <MobilePublicHeader top />
    {back && <Pressable accessibilityRole="button" onPress={() => router.back()}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 44 }}>
      <MobileIcon name="back" color={palette.blue} size={16} />
      <Text style={{ fontFamily: 'JakartaBold', color: palette.blue }}>Retour</Text>
    </Pressable>}
  </View>;
}

const publicHeader = ({ back }: { back?: { title?: string } }) => <PublicRouteHeader back={Boolean(back)} />;

function Navigator() {
  const { session, ready } = useSession();
  const palette = usePalette();
  if (!ready) return <Screen><ReadState loading error={null} onRetry={() => {}}/></Screen>;
  return <>
    <StatusBar style={palette.background === '#FFFFFF' ? 'dark' : 'light'}/>
    <Stack key={session?.user.id??'guest'} screenOptions={{headerTintColor:palette.blue,headerStyle:{backgroundColor:palette.surface},contentStyle:{backgroundColor:palette.background}}}>
      <Stack.Screen name="index" options={{headerShown:false}}/>
      <Stack.Screen name="demande-client" options={{title:'Votre demande', header:publicHeader}}/>
      <Stack.Screen name="retrouver" options={{title:'Mes demandes', header:publicHeader}}/>
      <Stack.Screen name="aide-mobile" options={{title:'Aide', header:publicHeader}}/>
      <Stack.Screen name="catalogue" options={{title:'Catalogue', header:publicHeader}}/>
      <Stack.Screen name="conseils" options={{title:'Conseils', header:publicHeader}}/>
      <Stack.Screen name="candidature" options={{title:'Candidature', header:publicHeader}}/>
      <Stack.Screen name="prestation/[slug]" options={{title:'Votre dépannage', header:publicHeader}}/>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="bienvenue" options={{headerShown:false}}/>
        <Stack.Screen name="connexion" options={{title:'Connexion', header:publicHeader}}/>
      </Stack.Protected>
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="(espace)" options={{headerShown:false}}/>
        <Stack.Screen name="demande" options={{title:'Nouvelle demande'}}/>
        <Stack.Screen name="offre/[id]" options={{title:"Offre de mission"}}/>
        <Stack.Screen name="dossier/[id]" options={{title:'Intervention'}}/>
        <Stack.Screen name="dossier/messages" options={{title:'Messages'}}/>
      </Stack.Protected>
    </Stack>
  </>;
}

export default function Root() {
  const [ready,error] = useFonts({
    JakartaRegular: require('../../assets/fonts/plus-jakarta-sans-400.ttf'),
    JakartaSemiBold: require('../../assets/fonts/plus-jakarta-sans-600.ttf'),
    JakartaBold: require('../../assets/fonts/plus-jakarta-sans-700.ttf'),
  });
  if (!ready&&!error) return null;
  return <SessionProvider><Navigator/></SessionProvider>;
}
