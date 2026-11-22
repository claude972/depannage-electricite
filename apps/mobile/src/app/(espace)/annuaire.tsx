import { useState } from 'react';
import { FlatList,View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ManagementAccess } from '@/components/management-access';
import { Action,Card,Copy,Field,ReadState,usePalette } from '@/components/ui';
import { useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { directoryPage } from '@/lib/management-contracts';
export default function Directory(){const auth=useSession().session;return <ManagementAccess admin>{auth&&<List key={auth.user.id} token={auth.access_token}/>}</ManagementAccess>;}
function List({token}:{token:string}){
 const router=useRouter(),p=usePalette();const [kind,setKind]=useState('clients'),[input,setInput]=useState(''),[query,setQuery]=useState(''),[cursors,setCursors]=useState<string[]>([]);
 const params=new URLSearchParams({kind,limit:'25'});if(query)params.set('q',query);if(cursors.length)params.set('cursor',cursors.at(-1)!);
 const data=useResource('/api/admin/directory?'+params,directoryPage,token);
 return <SafeAreaView edges={['top','left','right']} style={{flex:1,backgroundColor:p.background}}><FlatList automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" data={data.data?.items??[]} keyExtractor={item=>item.id} contentContainerStyle={{padding:16,gap:14}} onRefresh={data.reload} refreshing={data.loading&&!!data.data}
 ListHeaderComponent={<View style={{gap:12}}><Copy kind="title">Annuaire</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{[['clients','Clients'],['artisans','Artisans'],['organizations','Organisations']].map(([value,label])=><Action key={value} secondary={kind!==value} label={label} onPress={()=>{setKind(value);setCursors([]);}}/>)}</View><Field label="Rechercher par nom ou identifiant" value={input} maxLength={80} onChangeText={setInput} returnKeyType="search" onSubmitEditing={()=>{setQuery(input.trim());setCursors([]);}}/><Action secondary label="Rechercher" onPress={()=>{setQuery(input.trim());setCursors([]);}}/><ReadState loading={data.loading} error={data.error} onRetry={data.reload}/>{data.data&&<Copy kind="muted">{data.data.page.total} résultat(s) · page {cursors.length+1}</Copy>}</View>}
 ListEmptyComponent={data.data&&!data.loading&&!data.error?<Card><Copy>Aucun résultat.</Copy></Card>:undefined}
 ListFooterComponent={<View style={{gap:10}}>{cursors.length>0&&<Action secondary label="Page précédente" onPress={()=>setCursors(v=>v.slice(0,-1))}/>}{data.data?.page.next_cursor&&<Action secondary label="Page suivante" onPress={()=>setCursors(v=>[...v,data.data!.page.next_cursor!])}/>}</View>}
 renderItem={({item})=><Card><Copy kind="subtitle">{item.full_name??item.name}</Copy>{item.company_name&&<Copy>{item.company_name}</Copy>}{item.artisan_approved!==undefined&&<Copy kind="muted">{item.artisan_approved?'Artisan approuvé':'Artisan non approuvé'}</Copy>}<Action secondary label="Ouvrir la fiche" onPress={()=>router.push({pathname:'/annuaire/[id]',params:{id:item.id,kind}})}/></Card>}/></SafeAreaView>;
}
