import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, Copy, ReadState, usePalette } from '@/components/ui';
import { JobCard } from '@/components/job-card';
import { useWorkspace } from '@/lib/use-workspace';
import { useSession } from '@/lib/session';
import { api } from '@/lib/api';
import { creation, type Job } from '@/lib/contracts';

export default function Interventions() {
  const router=useRouter(), p=usePalette(), state=useWorkspace();
  const token=useSession().session?.access_token;
  const locked=useRef(false);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const profile=state.data?.profile;
  const reload=state.reload;
  useFocusEffect(useCallback(()=>{reload();},[reload]));
  async function take(job:Job) {
    if(!token||locked.current) return;
    locked.current=true;setBusy(true);setError(null);
    try { await api(`/api/interventions/${job.id}/actions`,creation,{token,method:'POST',body:{action:'accept_mission'}}); }
    catch(issue){setError(issue instanceof Error?issue.message:'Attribution indisponible.');}
    finally {locked.current=false;setBusy(false);state.reload();}
  }
  function open(job:Job) {
    if(profile?.role==='artisan'&&job.status==='requested'&&!job.artisan_id) {
      if(!busy) Alert.alert('Accepter cette mission ?', 'Le serveur vérifie la disponibilité de la mission avant de vous l’attribuer.', [
        {text:'Revenir',style:'cancel'}, {text:'Accepter',onPress:()=>void take(job)},
      ]);
      return;
    }
    router.push({pathname:'/dossier/[id]',params:{id:job.id}});
  }
  return <SafeAreaView style={[styles.fill,{backgroundColor:p.background}]} edges={['top','left','right']}>
    <FlatList
      data={state.data?.interventions??[]} keyExtractor={job=>job.id}
      refreshing={state.loading&&Boolean(state.data)} onRefresh={state.reload}
      contentContainerStyle={styles.list}
      ListHeaderComponent={<View style={styles.list}>
        <Copy kind="title">{profile?.role==='artisan'?'Missions':'Interventions'}</Copy>
        {profile?.role==='client'&&<Action label="Nouvelle demande" onPress={()=>router.push('/demande')}/>}
        {error&&<Copy kind="error">{error}</Copy>}
        {busy&&<Copy kind="muted">Vérification de l’attribution…</Copy>}
        <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
        {state.data?.limits?.interventions.limited&&<Copy kind="muted">Les 100 dossiers les plus récents sont affichés.</Copy>}
      </View>}
      ListEmptyComponent={state.data?<Copy kind="muted">Aucun dossier visible pour le moment.</Copy>:undefined}
      renderItem={({item})=><JobCard job={item} onOpen={()=>open(item)} label={profile?.role==='artisan'&&item.status==='requested'&&!item.artisan_id?'Accepter la mission':undefined}/>}
    />
  </SafeAreaView>;
}
const styles=StyleSheet.create({fill:{flex:1},list:{gap:14,padding:14}});
