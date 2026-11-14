import { FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, Card, Copy, ReadState, usePalette } from '@/components/ui';
import { ArtisanAvailability } from '@/components/artisan-availability';
import { AdminNativeInterventions } from '@/components/admin-native-interventions';
import { JobCard } from '@/components/job-card';
import { useWorkspace } from '@/lib/use-workspace';
import { ArtisanOffers } from '@/components/artisan-offers';
import { OrderLookup } from '@/components/order-lookup';
import { useSession } from '@/lib/session';

export default function Interventions() {
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const router=useRouter(), p=usePalette(), state=useWorkspace();
  const auth=useSession();
  const profile=state.data?.profile;
  const reload=state.reload;
  useFocusEffect(useCallback(()=>{reload();},[reload]));
  useEffect(() => {
    if (auth.loginResume === 'interventions') auth.consumeLoginResume();
  }, [auth.loginResume, auth.consumeLoginResume]);
  if (profile?.role === 'admin') return <AdminNativeInterventions />;
  return <SafeAreaView style={[styles.fill,{backgroundColor:p.background}]} edges={['top','left','right']}>
    <FlatList
      data={(state.data?.interventions??[]).filter(job => profile?.role !== 'artisan' || job.artisan_id === profile.id)} keyExtractor={job=>job.id}
      refreshing={state.loading&&Boolean(state.data)} onRefresh={state.reload}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.list}
      ListHeaderComponent={<View style={styles.list}>
        <Copy kind="title">{profile?.role==='artisan'?'Missions':profile?.role==='manager'?'Interventions':'Mes demandes'}</Copy>
        {profile?.role==='manager'&&<><Copy kind="subtitle">Recherche par organisation</Copy>{state.data?.organizations?.map(org=><Action key={org.id} secondary label={`Rechercher · ${org.name}`} onPress={()=>router.push({pathname:'/organisation/interventions',params:{organization_id:org.id}})}/>)}</>}
        {profile?.role==='client'&&<>
          <Action label="Nouvelle demande" onPress={()=>router.push('/demande')}/>
          <OrderLookup key={profile.id} />
        </>}
        {profile?.role==='artisan'&&<><ArtisanAvailability approved={profile.artisan_approved} onChanged={() => setAvailabilityVersion(value => value + 1)} /><ArtisanOffers key={availabilityVersion} /></>}
        <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
        {state.data?.limits?.interventions.limited&&<Copy kind="muted">Les 100 dossiers les plus récents sont affichés.</Copy>}
      </View>}
      ListEmptyComponent={state.data && !state.loading && !state.error ? <Card>
        <Copy kind="subtitle">{profile?.role === 'artisan' ? 'Aucune mission affectée' : 'Aucune intervention en cours'}</Copy>
        <Copy kind="muted">Les dossiers accessibles depuis votre compte apparaîtront ici.</Copy>
      </Card> : undefined}
      renderItem={({item})=><JobCard role={profile?.role} quotes={state.data?.quotes} payments={state.data?.payments} job={item} onOpen={()=>router.push({pathname:'/dossier/[id]',params:{id:item.id}})}/>}
    />
  </SafeAreaView>;
}
const styles=StyleSheet.create({fill:{flex:1},list:{gap:14,padding:14}});
