import { useState } from 'react';
import { Linking,View } from 'react-native';
import { useLocalSearchParams,useRouter } from 'expo-router';
import { z } from 'zod';
import { ArtisanApplicationReview } from '@/components/artisan-application-review';
import { ManagementAccess } from '@/components/management-access';
import { Action,Card,Copy,ReadState,Screen } from '@/components/ui';
import { useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { adminInterventions,directoryDetail,directoryKind,directoryPage } from '@/lib/management-contracts';
import { categories,phoneHref,statuses,timestamp } from '@/lib/contracts';
import { orderReference } from '../../../../../shared/order-reference';
type Kind=z.infer<typeof directoryKind>;
export default function Entry(){const params=useLocalSearchParams<{id:string;kind:string}>(),auth=useSession().session;const id=z.uuid().safeParse(params.id).data,kind=directoryKind.safeParse(params.kind).data;return <ManagementAccess admin>{auth&&id&&kind?<Details key={auth.user.id+kind+id} id={id} kind={kind} token={auth.access_token} actor={auth.user.id}/>:<Screen><Copy>Fiche introuvable.</Copy></Screen>}</ManagementAccess>;}
function Details({id,kind,token,actor}:{id:string;kind:Kind;token:string;actor:string}){
 const router=useRouter(),state=useResource(`/api/admin/directory?kind=${kind}&id=${id}`,directoryDetail,token,actor),item=state.data?.item;
 const [callError,setCallError]=useState<string|null>(null);
 const call=(phone:string)=>void Linking.openURL(phoneHref(phone)).catch(()=>setCallError('Aucune application de cet appareil n’a pu composer le '+phone+'.'));
 return <Screen onRefresh={state.reload}><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>{item&&<>
  <Copy kind="label">{kind==='clients'?(item.role==='manager'?'Entreprise cliente':'Client particulier'):kind==='artisans'?'Artisan':'Organisation'}</Copy>
  <Copy kind="title">{item.full_name??item.name}</Copy>
  <Card><Copy kind="subtitle">{kind==='organizations'?'Informations de l’organisation':'Coordonnées du compte'}</Copy>
   {kind!=='organizations'&&(item.phone?<><Copy selectable>{item.phone}</Copy><Action secondary label={'Appeler le '+item.phone} onPress={()=>call(item.phone!)}/></>:<Copy>Téléphone non renseigné.</Copy>)}
   {callError&&<Copy kind="error">{callError}</Copy>}
   {item.role&&<Copy>{item.role==='manager'?'Compte entreprise':'Compte particulier'}</Copy>}{item.company_name&&<Copy>{item.company_name}</Copy>}{item.artisan_approved!==undefined&&<Copy>{item.artisan_approved?'Artisan approuvé':'Artisan non approuvé'}</Copy>}
   <Copy kind="muted">Créé le {timestamp(item.created_at)}</Copy><Copy kind="muted" selectable>Identifiant · {item.id}</Copy></Card>
  {kind==='organizations'&&<>{item.owner_id&&<Owner id={item.owner_id} token={token} actor={actor}/>}<Action label="Sites et accès de l’organisation" onPress={()=>router.push({pathname:'/organisation/[id]',params:{id}})}/></>}
  {kind==='clients'&&item.role==='manager'&&<Organizations owner={id} token={token} actor={actor}/>}
  {kind==='artisans'&&<ArtisanApplicationReview id={id} onChanged={state.reload}/>}
  {kind!=='organizations'&&<Interventions filter={kind==='clients'?'client_id':'artisan_id'} id={id} token={token} actor={actor}/>}
  {kind!=='artisans'&&<Card><Copy kind="subtitle">Accès de l’opérateur</Copy><Copy>Cette fiche est en lecture seule dans l’application. L’adresse e-mail, les moyens de paiement et le contenu des messages n’y sont pas affichés.</Copy><Copy kind="muted">La modification des rôles, des membres et des sites se fait depuis le portail web d’administration ; chaque accès reste vérifié par le serveur.</Copy></Card>}
 </>}</Screen>;
}
function Owner({id,token,actor}:{id:string;token:string;actor:string}){
 const router=useRouter(),state=useResource(`/api/admin/directory?kind=clients&id=${id}`,directoryDetail,token,actor),owner=state.data?.item;
 return <Card><Copy kind="subtitle">Propriétaire de l’organisation</Copy><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
  {owner&&<><Copy selectable>{owner.full_name}</Copy><Copy kind="muted" selectable>{owner.phone||'Téléphone non renseigné'}</Copy><Action secondary label="Ouvrir la fiche du propriétaire" onPress={()=>router.push({pathname:'/annuaire/[id]',params:{id,kind:'clients'}})}/></>}</Card>;
}
function Organizations({owner,token,actor}:{owner:string;token:string;actor:string}){
 const router=useRouter(),state=useResource(`/api/admin/directory?kind=organizations&owner_id=${owner}&limit=25`,directoryPage,token,actor);
 return <Card><Copy kind="subtitle">Organisations dont ce compte est propriétaire</Copy><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
  {state.data&&state.data.items.length===0&&<Copy>Aucune organisation dont ce compte est propriétaire.</Copy>}
  {state.data?.items.map(item=><Action key={item.id} secondary label={'Ouvrir l’organisation · '+(item.name??'')} onPress={()=>router.push({pathname:'/annuaire/[id]',params:{id:item.id,kind:'organizations'}})}/>)}
  {state.data?.page.has_more&&<Copy kind="muted">Les 25 organisations les plus récentes sont affichées.</Copy>}
  <Copy kind="muted">Les organisations dont ce compte est seulement membre ne sont pas transmises dans cette fiche.</Copy></Card>;
}
function Interventions({filter,id,token,actor}:{filter:'client_id'|'artisan_id';id:string;token:string;actor:string}){
 const router=useRouter(),[cursors,setCursors]=useState<string[]>([]);
 const params=new URLSearchParams({[filter]:id,limit:'10'});if(cursors.length)params.set('cursor',cursors.at(-1)!);
 const state=useResource('/api/admin/interventions?'+params,adminInterventions,token,actor);
 return <Card><Copy kind="subtitle">{filter==='client_id'?'Interventions de ce client':'Missions attribuées à cet artisan'}</Copy><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
  {state.data&&<Copy kind="muted">{state.data.page.total} dossier(s) · page {cursors.length+1}</Copy>}
  {state.data&&state.data.interventions.length===0&&<Copy>Aucun dossier.</Copy>}
  {state.data?.interventions.map(job=><View key={job.id} style={{gap:6}}><Copy>{orderReference(job.id)} · {categories[job.category]} · {statuses[job.status]}</Copy><Copy kind="muted">{job.city} · {timestamp(job.created_at)}</Copy><Action secondary label={'Ouvrir le dossier '+orderReference(job.id)} onPress={()=>router.push({pathname:'/dossier/[id]',params:{id:job.id}})}/></View>)}
  {cursors.length>0&&<Action secondary label="Dossiers précédents" onPress={()=>setCursors(value=>value.slice(0,-1))}/>}
  {state.data?.page.next_cursor&&<Action secondary label="Dossiers suivants" onPress={()=>setCursors(value=>[...value,state.data!.page.next_cursor!])}/>}
 </Card>;
}
