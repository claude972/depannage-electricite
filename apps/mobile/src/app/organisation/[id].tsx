import { useState } from 'react';
import { useLocalSearchParams,useRouter } from 'expo-router';
import { z } from 'zod';
import { ManagementAccess } from '@/components/management-access';
import { Action, Card, Copy, ReadState, Screen } from '@/components/ui';
import { useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { membershipLabels, organizationOverview, sitePage, siteTypes } from '@/lib/management-contracts';
export default function Organization(){const {id}=useLocalSearchParams<{id:string}>();const auth=useSession().session;return <ManagementAccess>{auth&&z.uuid().safeParse(id).success?<Details key={auth.user.id+id} id={id} token={auth.access_token} actor={auth.user.id}/>:<Screen><Copy>Organisation introuvable.</Copy></Screen>}</ManagementAccess>;}
function Details({id,token,actor}:{id:string;token:string;actor:string}){
 const router=useRouter(),[archived,setArchived]=useState(false),[cursors,setCursors]=useState<string[]>([]);
 const info=useResource('/api/organizations?organization_id='+id,organizationOverview,token,actor);
 const after=cursors.at(-1), sites=useResource(`/api/organizations/${id}/sites?state=${archived?'archived':'active'}${after?'&after='+after:''}`,sitePage,token);
 const reload=()=>{info.reload();sites.reload();};
 return <Screen onRefresh={reload}><ReadState loading={info.loading} error={info.error} onRetry={info.reload}/>
 {info.data&&<><Copy kind="title">{info.data.organization.name}</Copy><Copy kind="label">{membershipLabels[info.data.current_role]}</Copy>
 <Card><Copy kind="subtitle">Votre accès</Copy>{info.data.site_access.members.filter(m=>m.user_id===actor).map(m=><Copy key={m.user_id}>{m.scope==='all'?'Tous les sites autorisés de l’organisation':`${m.grants.length} site(s) attribué(s) ; les droits d’écriture sont propres à chaque site.`}</Copy>)}{info.data.current_role==='platform_admin'&&<Copy>Lecture dans le périmètre de votre rôle plateforme. Aucun droit d’édition de site n’est déduit de ce rôle.</Copy>}</Card>
 {info.data.current_role!=='platform_admin'&&<Card><Copy kind="subtitle">Suivi entreprise</Copy><Action secondary label="Rechercher les interventions" onPress={()=>router.push({pathname:'/organisation/interventions',params:{organization_id:id}})}/><Action secondary label="Consulter les approbations" onPress={()=>router.push({pathname:'/organisation/approbations',params:{organization_id:id}})}/>{info.data.site_access.members.some(member=>member.user_id===actor&&member.scope==='all')?<Action secondary label="Consulter les contrats" onPress={()=>router.push({pathname:'/organisation/contrats',params:{organization_id:id}})}/>:<Copy kind="muted">L’accès aux contrats nécessite un périmètre couvrant toute l’organisation.</Copy>}</Card>}
 <Copy kind="subtitle">Sites {archived?'archivés':'actifs'}</Copy><Action secondary label={archived?'Afficher les sites actifs':'Afficher les archives'} onPress={()=>{setCursors([]);setArchived(!archived);}}/>
 <ReadState loading={sites.loading} error={sites.error} onRetry={sites.reload}/>
 {sites.data?.sites.length===0&&<Copy>Aucun site dans cette sélection.</Copy>}
 {sites.data?.sites.map(site=><Card key={site.id}><Copy kind="subtitle">{site.name}</Copy><Copy>{siteTypes[site.type]}</Copy><Copy kind="muted">{site.address}</Copy><Action secondary label="Ouvrir le site" onPress={()=>router.push({pathname:'/site/[id]',params:{id:site.id}})}/>{info.data?.current_role!=='platform_admin'&&<Action secondary label="Interventions de ce site" onPress={()=>router.push({pathname:'/organisation/interventions',params:{organization_id:id,site_id:site.id}})}/>}</Card>)}
 {cursors.length>0&&<Action secondary label="Page précédente" onPress={()=>setCursors(values=>values.slice(0,-1))}/>}{sites.data?.next_after&&<Action secondary label="Sites suivants" onPress={()=>setCursors(values=>[...values,sites.data!.next_after!])}/>}
 <Copy kind="subtitle">Membres</Copy>{info.data.limits.members_limited&&<Copy kind="muted">Les 200 premiers membres sont affichés.</Copy>}
 {info.data.members.map(member=><Card key={member.user_id}><Copy>{member.full_name}</Copy><Copy kind="muted">{membershipLabels[member.role]}</Copy></Card>)}
 </>}
 </Screen>;
}
