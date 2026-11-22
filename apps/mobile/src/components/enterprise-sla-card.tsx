import { useEffect,useRef,useState } from 'react';
import { orderReference } from '../../../../shared/order-reference';
import { Action,Card,Copy,ReadState } from './ui';
import { api,useResource } from '@/lib/api';
import { timestamp } from '@/lib/contracts';
import { operationsSaved,siteOperations,trackLine } from '@/lib/enterprise-operations';
/** Délais contractuels d’un dossier de site : état calculé par le serveur (cible, écoulé, pause, dépassement). */
export function EnterpriseSlaCard({id,siteId,openedAt,token}:{id:string;siteId:string;openedAt:string;token:string}){
 const state=useResource('/api/site-operations?site_id='+siteId,siteOperations,token),snapshot=state.data?.snapshot;
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const lock=useRef(false);useEffect(()=>{lock.current=false;setBusy(false);},[token]);
 async function send(body:object,done:string){
  if(lock.current)return;lock.current=true;setBusy(true);setError(null);setNotice(null);
  try{await api('/api/site-operations',operationsSaved,{token,method:'POST',body});setNotice(done);state.reload();}
  catch(issue){setError(issue instanceof Error?issue.message:'Enregistrement indisponible.');}
  finally{lock.current=false;setBusy(false);}
 }
 const cases=(snapshot?.sla_cases??[]).filter(item=>item.intervention_id===id),evaluations=new Map((state.data?.sla.cases??[]).map(item=>[item.case_id,item]));
 const rules=(snapshot?.sla_policies??[]).filter(item=>item.status==='active'),write=snapshot?.limits.can_write_site===true;
 return <Card><Copy kind="subtitle">Délais contractuels (SLA)</Copy><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>{notice&&<Copy>{notice}</Copy>}{error&&<Copy kind="error">{error}</Copy>}
 {snapshot&&cases.length===0&&<><Copy>Aucun délai contractuel n’est suivi pour ce dossier.</Copy>
  {write&&rules.length===0&&<Copy kind="muted">Créez d’abord une règle de délai active pour ce site.</Copy>}
  {write&&rules.map(rule=><Action key={rule.id} secondary disabled={busy} label={`Suivre avec la règle « ${rule.name} »`} onPress={()=>void send({action:'save_sla_case',site_id:siteId,payload:{policy_id:rule.id,intervention_id:id,reference:orderReference(id),opened_at:openedAt,responded_at:null,resolved_at:null,notes:''}},'Le suivi du délai est ouvert pour ce dossier.')}/>)}</>}
 {cases.map(item=>{const evaluation=evaluations.get(item.id),rule=snapshot?.sla_policies.find(value=>value.id===item.policy_id),current=item.pauses.find(value=>value.ended_at===null);
  return <Card key={item.id}><Copy kind="label">{evaluation?.paused_now?'Délai en pause':item.resolved_at?'Dossier résolu':'Délai en cours'}</Copy><Copy kind="muted">Règle : {rule?.name??'non lisible'} · ouvert le {timestamp(item.opened_at)}</Copy>
  {evaluation?<><Copy>{trackLine('Prise en charge',evaluation.response,timestamp)}</Copy><Copy>{trackLine('Résolution',evaluation.resolution,timestamp)}</Copy></>:<Copy kind="muted">Évaluation indisponible.</Copy>}
  <Copy kind="muted">{item.pauses_total} pause(s) enregistrée(s){current?' · en pause depuis le '+timestamp(current.started_at):''}</Copy>
  {write&&item.resolved_at===null&&(evaluation?.paused_now?<Action secondary disabled={busy} label="Reprendre le décompte" onPress={()=>void send({action:'resume_sla_case',id:item.id,ended_at:new Date().toISOString(),expected_version:item.version},'Le décompte du délai a repris.')}/>:<Action secondary disabled={busy} label="Mettre le délai en pause" onPress={()=>void send({action:'pause_sla_case',id:item.id,started_at:new Date().toISOString(),reason:'',expected_version:item.version},'Le délai est en pause.')}/>)}</Card>;})}
 {state.data&&<Copy kind="muted">Calculé par le serveur le {timestamp(state.data.computed_at)} selon le calendrier ouvré de la règle.</Copy>}
 </Card>;
}
