import { FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, Copy, ReadState, usePalette } from '@/components/ui';
import { JobCard } from '@/components/job-card';
import { useWorkspace } from '@/lib/use-workspace';
import { ArtisanOffers } from '@/components/artisan-offers';

export default function Interventions() {
  const router=useRouter(), p=usePalette(), state=useWorkspace();
  const profile=state.data?.profile;
  const reload=state.reload;
  useFocusEffect(useCallback(()=>{reload();},[reload]));
  return <SafeAreaView style={[styles.fill,{backgroundColor:p.background}]} edges={['top','left','right']}>
    <FlatList
      data={(state.data?.interventions??[]).filter(job => profile?.role !== 'artisan' || job.artisan_id === profile.id)} keyExtractor={job=>job.id}
      refreshing={state.loading&&Boolean(state.data)} onRefresh={state.reload}
      contentContainerStyle={styles.list}
      ListHeaderComponent={<View style={styles.list}>
        <Copy kind="title">{profile?.role==='artisan'?'Missions':'Interventions'}</Copy>
        {profile?.role==='client'&&<Action label="Nouvelle demande" onPress={()=>router.push('/demande')}/>}
        {profile?.role==='artisan'&&<ArtisanOffers />}
        <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
        {state.data?.limits?.interventions.limited&&<Copy kind="muted">Les 100 dossiers les plus récents sont affichés.</Copy>}
      </View>}
      ListEmptyComponent={state.data?<Copy kind="muted">Aucun dossier visible pour le moment.</Copy>:undefined}
      renderItem={({item})=><JobCard job={item} onOpen={()=>router.push({pathname:'/dossier/[id]',params:{id:item.id}})}/>}
    />
  </SafeAreaView>;
}
const styles=StyleSheet.create({fill:{flex:1},list:{gap:14,padding:14}});
