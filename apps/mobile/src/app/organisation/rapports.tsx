import { useEffect,useRef,useState } from 'react';
import { Share,View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { File,Paths } from 'expo-file-system';
import { z } from 'zod';
import { ManagementAccess } from '@/components/management-access';
import { Action,Card,Copy,ReadState,Screen } from '@/components/ui';
import { useResource } from '@/lib/api';
import { apiOrigin } from '@/lib/config';
import { useSession } from '@/lib/session';
import { euros } from '@/lib/contracts';
import { professionalReport,reportSiteTypes } from '@/lib/enterprise-operations';
const fileName='rapport-interventions.csv';
export default function Reports(){const {organization_id}=useLocalSearchParams<{organization_id:string}>(),auth=useSession().session;
 return <ManagementAccess>{auth&&z.uuid().safeParse(organization_id).success?<Report key={auth.user.id+organization_id} org={organization_id} token={auth.access_token}/>:<Screen><Copy>Organisation introuvable.</Copy></Screen>}</ManagementAccess>;}
function Report({org,token}:{org:string;token:string}){
 const [site,setSite]=useState<string|null>(null),[choices,setChoices]=useState<{id:string;name:string}[]|null>(null);
 const query=`organization_id=${org}${site?'&site_id='+site:''}`,state=useResource('/api/reports?'+query,professionalReport,token),data=state.data;
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[exported,setExported]=useState<{rows:number;bytes:number;uri:string;scope:string}|null>(null);
 const lock=useRef(false);useEffect(()=>{lock.current=false;setBusy(false);},[token]);
 // The filter keeps the sites of the unfiltered read: a filtered answer only holds the selected site.
 useEffect(()=>{if(data&&!site)setChoices(data.sites.map(row=>({id:row.site_id,name:row.name})));},[data,site]);
 async function exportCsv(){
  if(lock.current||!apiOrigin)return;lock.current=true;setBusy(true);setError(null);setExported(null);
  try{
   // Same scope query as the screen with format=csv: the file is the one produced by the server.
   const response=await fetch(new URL('/api/reports?'+query+'&format=csv',apiOrigin),{headers:{Authorization:`Bearer ${token}`,Accept:'text/csv'},redirect:'error',credentials:'omit'});
   if(!response.ok){const body:unknown=await response.json().catch(()=>null);throw Error(body&&typeof body==='object'&&'error' in body&&typeof body.error==='string'?body.error:'L’export n’a pas pu être produit. Réessayez.');}
   if(!response.headers.get('content-type')?.startsWith('text/csv'))throw Error('La réponse du service n’est pas un fichier CSV.');
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(!bytes.length)throw Error('Le fichier reçu est vide.');
   const file=new File(Paths.cache,fileName);if(file.exists)file.delete();file.create();await file.write(bytes);
   // One line feed precedes every data row; the header line has none.
   const done={rows:bytes.reduce((count,value)=>count+(value===10?1:0),0),bytes:bytes.length,uri:file.uri,scope:site?choices?.find(item=>item.id===site)?.name??'site sélectionné':'tous les sites accessibles'};
   setExported(done);await Share.share({url:file.uri,title:fileName});
  }catch(issue){setError(issue instanceof Error?issue.message:'Export indisponible.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <Screen onRefresh={state.reload}><Copy kind="title">Rapports</Copy><Copy kind="muted">Budget et engagements par site, dans le périmètre autorisé de votre compte.</Copy>
 {choices&&choices.length>1&&<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Action label="Tous les sites" selected={site===null} secondary onPress={()=>{setSite(null);setExported(null);}}/>{choices.map(item=><Action key={item.id} label={item.name} selected={site===item.id} secondary onPress={()=>{setSite(item.id);setExported(null);}}/>)}</View>}
 <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
 {data&&<><Card><Copy kind="subtitle">{data.page?'Somme des lignes reçues (liste paginée)':data.scope.complete?'Total':'Somme des lignes reçues (non garantie complète)'} · {data.sites.length} site(s)</Copy>
  <Copy>Budget déclaré : {euros(data.totals.budget_cents)}</Copy><Copy>Devis acceptés (avenants compris) : {euros(data.totals.accepted_cents)}</Copy><Copy>Paiements Stripe enregistrés : {euros(data.totals.paid_cents)}</Copy>{data.totals.declared_paid_cents>0&&<Copy>Reçus sur place déclarés : {euros(data.totals.declared_paid_cents)}</Copy>}<Copy>Remboursements confirmés : {euros(data.totals.refunded_cents)}</Copy><Copy>Dépense nette : {euros(data.totals.net_paid_cents)}</Copy><Copy>Engagement restant : {euros(data.totals.committed_cents)}</Copy>
  <Copy kind="muted">Interventions : {data.sites.reduce((count,row)=>count+row.interventions,0)}{data.totals.financial_complete?'':' · certains paiements ne sont pas vérifiés.'}</Copy></Card>
 {data.sites.length===0&&<Copy>Aucun site dans ce périmètre.</Copy>}
 {data.sites.map(row=><Card key={row.site_id}><Copy kind="subtitle">{row.name}</Copy><Copy kind="label">{reportSiteTypes[row.type]}</Copy>
  <Copy>Budget : {row.budget_cents>0?euros(row.budget_cents):'—'}{row.budget_cents>0&&row.accepted_cents>row.budget_cents?' · budget de référence dépassé':''}</Copy><Copy>Devis acceptés : {euros(row.accepted_cents)}</Copy><Copy>Paiements Stripe enregistrés : {euros(row.paid_cents)}</Copy>{row.declared_paid_cents>0&&<Copy kind="muted">Historiques déclarés sur place : {euros(row.declared_paid_cents)}</Copy>}<Copy>Engagement restant : {euros(row.committed_cents)}</Copy><Copy kind="muted">{row.interventions} intervention(s){row.financial_complete?'':' · données financières incomplètes'}</Copy></Card>)}
 <Card><Copy kind="subtitle">Export CSV</Copy><Copy kind="muted">Le fichier est produit par le serveur pour la sélection affichée ({site?'site sélectionné':'tous les sites accessibles'}), puis proposé au partage.</Copy>
  <Action label={busy?'Préparation du fichier…':'Exporter le rapport CSV'} disabled={busy} onPress={()=>void exportCsv()}/>
  {error&&<Copy kind="error">{error}</Copy>}
  {exported&&<><Copy>Fichier {fileName} · {exported.rows} ligne(s) de site · {exported.bytes} octets</Copy><Copy kind="muted">Périmètre exporté : {exported.scope}.</Copy><Action secondary label="Partager à nouveau le fichier" disabled={busy} onPress={()=>void Share.share({url:exported.uri,title:fileName}).catch(()=>setError('Le partage n’a pas pu s’ouvrir.'))}/></>}</Card></>}
 </Screen>;
}
