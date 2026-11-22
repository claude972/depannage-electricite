import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Action, Card, Copy, ReadState, usePalette } from '@/components/ui';
import { useWorkspace } from '@/lib/use-workspace';
import { categories, euros } from '@/lib/contracts';
export default function Quotes() {
  const state = useWorkspace(), router = useRouter(), palette = usePalette();
  const [filter, setFilter] = useState<'all'|'sent'|'accepted'|'rejected'>('all');
  const reload = state.reload;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  const all = state.data?.quotes ?? [];
  const rows = all.filter(quote => filter === 'all' || quote.status === filter);
  return <SafeAreaView edges={['top','left','right']} style={{flex:1,backgroundColor:palette.background}}><FlatList data={rows} keyExtractor={quote => quote.id} contentInsetAdjustmentBehavior="automatic"
    style={{backgroundColor:palette.background}} contentContainerStyle={{padding:16,gap:12}} refreshing={state.loading && Boolean(state.data)} onRefresh={reload}
    ListHeaderComponent={<View style={{gap:12}}><Copy kind="title">Mes devis</Copy>
      <ReadState loading={state.loading} error={state.error} onRetry={reload}/>
      <Copy kind="muted">Devis accessibles dans les dossiers chargés. Les décisions et le suivi s’ouvrent dans le dossier.</Copy>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{([['all','Tous'],['sent','Envoyés'],['accepted','Acceptés'],['rejected','Refusés']] as const).map(([value,label])=><Action key={value} label={label} secondary={filter!==value} onPress={()=>setFilter(value)}/>)}</View>
      {state.data?.limits?.quotes?.limited && <Copy kind="muted">Les 200 devis les plus récents sont chargés ; cette liste est partielle.</Copy>}
    </View>}
    ListEmptyComponent={state.data&&!state.loading&&!state.error?<Card><Copy>Aucun devis dans cette sélection.</Copy></Card>:undefined}
    renderItem={({item})=>{const job=state.data?.interventions.find(job=>job.id===item.intervention_id);return <Card>
      <Copy kind="label">{item.status==='accepted'?'Devis accepté':item.status==='rejected'?'Devis refusé':'Devis envoyé'}</Copy>
      <Copy kind="subtitle">{job?categories[job.category]:'Dossier'}</Copy>
      {job&&<Copy>{job.city}</Copy>}
      <Copy selectable>{item.status==='accepted' && item.accepted_total_cents === undefined ? 'Montant accepté à vérifier dans le dossier' : `${euros(item.status==='accepted'?item.accepted_total_cents!:item.total_cents)} TTC`}</Copy>
      <Action secondary label="Ouvrir le dossier" onPress={()=>router.push({pathname:'/dossier/[id]',params:{id:item.intervention_id}})}/>
    </Card>}} /></SafeAreaView>;
}
