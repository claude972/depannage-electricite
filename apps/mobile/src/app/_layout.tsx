import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from '@/lib/session';
import { ReadState, Screen, usePalette } from '@/components/ui';

function Navigator() {
  const { session, ready } = useSession();
  const palette = usePalette();
  if (!ready) return <Screen><ReadState loading error={null} onRetry={() => {}}/></Screen>;
  return <>
    <StatusBar style={palette.background === '#FFFFFF' ? 'dark' : 'light'}/>
    <Stack key={session?.user.id??'guest'} screenOptions={{headerBackButtonDisplayMode:'minimal',headerTintColor:palette.blue,headerStyle:{backgroundColor:palette.surface},contentStyle:{backgroundColor:palette.background}}}>
      <Stack.Screen name="index" options={{headerShown:false}}/>
      <Stack.Screen name="demande-client" options={{title:'Votre demande'}}/>
      <Stack.Screen name="retrouver" options={{headerShown:false}}/>
      <Stack.Screen name="aide-mobile" options={{title:'Aide'}}/>
      <Stack.Screen name="catalogue" options={{headerShown:false}}/>
      <Stack.Screen name="conseils" options={{title:'Conseils'}}/>
      <Stack.Screen name="candidature" options={{title:'Candidature'}}/>
      <Stack.Screen name="prestation/[slug]" options={{title:'Votre dépannage', presentation:'modal'}}/>
      <Stack.Screen name="mot-de-passe-oublie" options={{headerShown:false}}/>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="bienvenue" options={{headerShown:false}}/>
        <Stack.Screen name="compte" options={{headerShown:false}}/>
        <Stack.Screen name="connexion" options={{headerShown:false}}/>
        <Stack.Screen name="inscription" options={{headerShown:false}}/>
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
