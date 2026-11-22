import { useState } from 'react';
import { FlatList,View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Action,Card,Copy,Field,ReadState,usePalette } from './ui';
import { useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { adminInterventions } from '@/lib/management-contracts';
import { categories,statuses,timestamp } from '@/lib/contracts';
export function AdminNativeInterventions(){const auth=useSession().session;return auth?<List key={auth.user.id} token={auth.access_token}/>:null;}
function List({token}:{token:string}){
 const router=useRouter(),p=usePalette();
 const [text,setText]=useState(''),[query,setQuery]=useState(''),[status,setStatus]=useState(''),[category,setCategory]=useState(''),[urgency,setUrgency]=useState(''),[open,setOpen]=useState(false),[cursors,setCursors]=useState<string[]>([]);
 const params=new URLSearchParams({limit:'25'});if(query)params.set('q',query);if(status)params.set('status',status);if(category)params.set('category',category);if(urgency)params.set('urgency',urgency);if(cursors.length)params.set('cursor',cursors.at(-1)!);
 const data=useResource('/api/admin/interventions?'+params,adminInterventions,token);
 const change=(setter:(value:string)=>void,value:string)=>{setCursors([]);setter(value);};
 return <SafeAreaView edges={['top','left','right']} style={{flex:1,backgroundColor:p.background}}><FlatList data={data.data?.interventions??[]} keyExtractor={item=>item.id} onRefresh={data.reload} refreshing={data.loading&&!!data.data} contentContainerStyle={{padding:16,gap:14}}
 ListHeaderComponent={<View style={{gap:12}}><Copy kind="title">Interventions</Copy>
 <Field label="Rechercher une intervention" value={text} maxLength={80} onChangeText={setText} returnKeyType="search" onSubmitEditing={()=>change(setQuery,text.trim())}/><Action secondary label="Rechercher" onPress={()=>change(setQuery,text.trim())}/>
 <Action secondary label={`${open?'Masquer':'Afficher'} les filtres (${[status,category,urgency].filter(Boolean).length})`} onPress={()=>setOpen(!open)}/>
 {open&&<Card><Copy kind="subtitle">Statut</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{[['','Tous'],...Object.entries(statuses)].map(([value,label])=><Action key={value} secondary={status!==value} label={label} onPress={()=>change(setStatus,value)}/>)}</View><Copy kind="subtitle">Type de dépannage</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{[['','Tous'],...Object.entries(categories)].map(([value,label])=><Action key={value} secondary={category!==value} label={label} onPress={()=>change(setCategory,value)}/>)}</View><Copy kind="subtitle">Urgence</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{[['','Toutes'],['urgent','Urgent'],['scheduled','Planifié']].map(([value,label])=><Action key={value} secondary={urgency!==value} label={label} onPress={()=>change(setUrgency,value)}/>)}</View></Card>}
 {Boolean(query||status||category||urgency)&&<Action secondary label="Réinitialiser la recherche et les filtres" onPress={()=>{setText('');setQuery('');setStatus('');setCategory('');setUrgency('');setCursors([]);}}/>}
 <ReadState loading={data.loading} error={data.error} onRetry={data.reload}/>{data.data&&<Copy kind="muted">{data.data.page.total} intervention(s) · page {cursors.length+1}</Copy>}</View>}
 ListEmptyComponent={data.data&&!data.loading&&!data.error?<Card><Copy>Aucune intervention dans cette sélection.</Copy></Card>:undefined}
 ListFooterComponent={<View style={{gap:10}}>{cursors.length>0&&<Action secondary label="Page précédente" onPress={()=>setCursors(v=>v.slice(0,-1))}/>}{data.data?.page.next_cursor&&<Action secondary label="Page suivante" onPress={()=>setCursors(v=>[...v,data.data!.page.next_cursor!])}/>}</View>}
 renderItem={({item})=><Card><Copy kind="label">{statuses[item.status]}</Copy><Copy kind="subtitle">{categories[item.category]}</Copy><Copy>{item.city} · {item.urgency==='urgent'?'Urgent':'Planifié'}</Copy><Copy kind="muted">{timestamp(item.created_at)}</Copy><Action secondary label="Ouvrir le dossier" onPress={()=>router.push({pathname:'/dossier/[id]',params:{id:item.id}})}/></Card>}/></SafeAreaView>;
}
