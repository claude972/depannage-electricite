import { useState } from 'react';
import { FlatList,View } from 'react-native';
import { useLocalSearchParams,useRouter } from 'expo-router';
import { z } from 'zod';
import { ManagementAccess } from './management-access';
import { Action,Card,Copy,ReadState,Screen,usePalette } from './ui';
import { useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { approvalPage,approvalLabels,contractPage,contractLabels,calendarDate } from '@/lib/management-contracts';
import { euros } from '@/lib/contracts';
export function OrganizationNativeList({approvals=false}:{approvals?:boolean}){
 const {organization_id}=useLocalSearchParams<{organization_id:string}>(),auth=useSession().session;
 return <ManagementAccess>{auth&&z.uuid().safeParse(organization_id).success?<List key={auth.user.id+organization_id} org={organization_id} token={auth.access_token} approvals={approvals}/>:<Screen><Copy>Organisation introuvable.</Copy></Screen>}</ManagementAccess>;
}
function List({org,token,approvals}:{org:string;token:string;approvals:boolean}){
 const router=useRouter(),p=usePalette(),[cursors,setCursors]=useState<string[]>([]),[status,setStatus]=useState('all');
 const params=new URLSearchParams({organization_id:org});if(approvals)params.set('status',status);if(cursors.length)params.set('cursor',cursors.at(-1)!);
 const contracts=useResource(approvals?null:'/api/enterprise/contracts?'+params,contractPage,token);
 const decisions=useResource(approvals?'/api/enterprise/approvals?'+params:null,approvalPage,token);
 const state=approvals?decisions:contracts,next=state.data?.page.next_cursor;
 type Row={id:string;title:string;label:string;description:string};
 const rows:Row[]=approvals?(decisions.data?.items??[]).map(a=>({id:a.id,title:a.site.name,label:approvalLabels[a.status],description:`Devis proposé · ${euros(a.quote.total_cents)} TTC`})):(contracts.data?.items??[]).map(c=>({id:c.id,title:c.title,label:contractLabels[c.status],description:`Du ${calendarDate(c.starts_on)}${c.ends_on?' au '+calendarDate(c.ends_on):' · sans date de fin renseignée'}`}));
 return <FlatList style={{flex:1,backgroundColor:p.background}} contentContainerStyle={{padding:16,gap:14}} data={rows} keyExtractor={r=>r.id} onRefresh={state.reload} refreshing={state.loading&&!!state.data}
 ListHeaderComponent={<View style={{gap:12}}><Copy kind="title">{approvals?'Approbations':'Contrats'}</Copy>{approvals&&<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{[['all','Toutes'],...Object.entries(approvalLabels)].map(([value,label])=><Action key={value} secondary={status!==value} label={label} onPress={()=>{setStatus(value);setCursors([]);}}/>)}</View>}<ReadState loading={state.loading} error={state.error} onRetry={state.reload}/><Copy kind="muted">Page {cursors.length+1} · données limitées au périmètre de votre compte.</Copy></View>}
 ListEmptyComponent={state.data&&!state.loading&&!state.error?<Card><Copy>Aucun résultat dans cette sélection.</Copy></Card>:undefined}
 ListFooterComponent={<View style={{gap:10}}>{cursors.length>0&&<Action secondary label="Page précédente" onPress={()=>setCursors(v=>v.slice(0,-1))}/>}{next&&<Action secondary label="Page suivante" onPress={()=>setCursors(v=>[...v,next])}/>}</View>}
 renderItem={({item})=><Card><Copy kind="label">{item.label}</Copy><Copy kind="subtitle">{item.title}</Copy><Copy>{item.description}</Copy><Action secondary label="Consulter le détail" onPress={()=>router.push({pathname:approvals?'/approbation/[id]':'/contrat/[id]',params:{id:item.id,organization_id:org}})}/></Card>}/>;
}
