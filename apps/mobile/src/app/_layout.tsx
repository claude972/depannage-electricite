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
    <StatusBar style="auto"/>
    <Stack key={session?.user.id??'guest'} screenOptions={{headerTintColor:palette.blue,headerStyle:{backgroundColor:palette.surface},contentStyle:{backgroundColor:palette.background}}}>
      <Stack.Screen name="index" options={{headerShown:false}}/>
      <Stack.Screen name="demande-client" options={{title:'Votre demande'}}/>
      <Stack.Screen name="retrouver" options={{title:'Mes demandes'}}/>
      <Stack.Screen name="aide-mobile" options={{title:'Aide'}}/>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="bienvenue" options={{title:'Dépannage électrique'}}/>
        <Stack.Screen name="connexion" options={{title:'Connexion'}}/>
      </Stack.Protected>
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="(espace)" options={{headerShown:false}}/>
        <Stack.Screen name="demande" options={{title:'Nouvelle demande'}}/>
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
