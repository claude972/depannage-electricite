import { useEffect,useRef,useState } from 'react';
import { Alert,View } from 'react-native';
import { useLocalSearchParams,useRouter } from 'expo-router';
import { z } from 'zod';
import { ManagementAccess } from '@/components/management-access';
import { Action,Card,Copy,Field,ReadState,Screen } from '@/components/ui';
import { api,useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { timestamp } from '@/lib/contracts';
import { minutes,operationsSaved,organizationSla,siteOperations,trackLine,weekdays } from '@/lib/enterprise-operations';
import { refusal } from '@/components/site-sections';
const clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
export default function Sla(){const {organization_id,site_id}=useLocalSearchParams<{organization_id:string;site_id?:string}>(),auth=useSession().session;
 const valid=auth&&z.uuid().safeParse(organization_id).success&&(!site_id||z.uuid().safeParse(site_id).success);
 return <ManagementAccess>{valid?site_id?<SiteSla key={auth.user.id+site_id} org={organization_id} site={site_id} token={auth.access_token}/>:<OrganizationSla key={auth.user.id+organization_id} org={organization_id} token={auth.access_token}/>:<Screen><Copy>Périmètre introuvable.</Copy></Screen>}</ManagementAccess>;}
function OrganizationSla({org,token}:{org:string;token:string}){
 const router=useRouter(),[cursors,setCursors]=useState<string[]>([]);
 const state=useResource(`/api/organizations/${org}/sla${cursors.length?'?cursor='+cursors.at(-1):''}`,organizationSla,token),data=state.data;
 return <Screen onRefresh={state.reload}><Copy kind="title">Engagements de délai (SLA)</Copy><Copy kind="muted">Délais suivis par site, calculés par le serveur selon les calendriers et règles enregistrés par votre organisation.</Copy>
 <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
 {data&&<><Card><Copy kind="subtitle">{data.summary.cases} dossier(s) suivi(s)</Copy><Copy>{data.summary.breached} dépassé(s) · {data.summary.pending} en cours · {data.summary.met} respecté(s) · {data.summary.not_measurable} non mesurable(s)</Copy><Copy kind="muted">Relevé du {timestamp(data.captured_at)}{data.state==='partial'?' · relevé partiel : certaines données ne sont pas comptées.':''}</Copy></Card>
 {data.sites.length===0&&<Copy>Aucun site accessible dans ce périmètre.</Copy>}
 {data.sites.map(site=>{const evaluations=site.cases.flatMap(item=>item.evaluation?[item.evaluation]:[]),breached=evaluations.filter(item=>[item.response.status,item.resolution.status].includes('breached')).length,paused=evaluations.filter(item=>item.paused_now).length;
  return <Card key={site.id}><Copy kind="subtitle">{site.name}</Copy><Copy>{site.cases_total} dossier(s) suivi(s){site.cases_total?` · ${breached} dépassé(s) · ${paused} en pause`:''}</Copy><Action secondary label="Voir les délais du site" onPress={()=>router.push({pathname:'/organisation/sla',params:{organization_id:org,site_id:site.id}})}/></Card>;})}
 {cursors.length>0&&<Action secondary label="Page précédente" onPress={()=>setCursors(values=>values.slice(0,-1))}/>}{data.page.next_cursor&&<Action secondary label="Sites suivants" onPress={()=>setCursors(values=>[...values,data.page.next_cursor!])}/>}</>}
 </Screen>;
}
type Form=null|{kind:'calendar';name:string;timezone:string;days:number[];start:string;end:string}|{kind:'policy';name:string;calendar:string|null;urgency:'urgent'|'scheduled'|null;response:string;resolution:string};
function SiteSla({org,site,token}:{org:string;site:string;token:string}){
 const state=useResource('/api/site-operations?site_id='+site,siteOperations,token),snapshot=state.data?.snapshot;
 const [form,setForm]=useState<Form>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const lock=useRef(false);useEffect(()=>{lock.current=false;setBusy(false);},[token]);
 async function send(body:object,done:string){
  if(lock.current)return;lock.current=true;setBusy(true);setError(null);setNotice(null);
  try{await api('/api/site-operations',operationsSaved,{token,method:'POST',body});setForm(null);setNotice(done);state.reload();}
  catch(issue){setError(refusal(issue,'Enregistrement indisponible.'));state.reload();}
  finally{lock.current=false;setBusy(false);}
 }
 function save(){
  if(!form)return;
  if(!form.name.trim()){setError(form.kind==='calendar'?'Indiquez le nom du calendrier.':'Indiquez le nom de la règle.');return;}
  if(form.kind==='calendar'){
   if(!form.timezone.trim()){setError('Indiquez le fuseau horaire, par exemple America/Martinique.');return;}
   if(!form.days.length){setError('Choisissez au moins un jour ouvré.');return;}
   if(!clock.test(form.start)||!clock.test(form.end)||form.end<=form.start){setError('Indiquez des heures au format HH:MM, la fin après le début.');return;}
   void send({action:'save_sla_calendar',organization_id:org,payload:{name:form.name.trim(),timezone:form.timezone.trim(),windows:[...form.days].sort().map(weekday=>({weekday,start:form.start,end:form.end})),closed_dates:[]}},'Le calendrier ouvré a été enregistré.');
  }else{
   const target=(value:string)=>value.trim()===''?null:/^\d{1,6}$/.test(value.trim())?Number(value.trim()):NaN,response=target(form.response),resolution=target(form.resolution);
   if(Number.isNaN(response)||Number.isNaN(resolution)||response===0||resolution===0){setError('Indiquez les délais en minutes entières, ou laissez le champ vide.');return;}
   void send({action:'save_sla_policy',site_id:site,payload:{name:form.name.trim(),calendar_id:form.calendar,urgency:form.urgency,response_target_minutes:response,resolution_target_minutes:resolution,status:'active'}},'La règle de délai a été enregistrée.');
  }
 }
 const pause=(id:string,version:number)=>Alert.alert('Mettre le délai en pause ?','Le décompte est suspendu à partir de maintenant, jusqu’à la reprise.',[{text:'Annuler',style:'cancel'},{text:'Mettre en pause',onPress:()=>void send({action:'pause_sla_case',id,started_at:new Date().toISOString(),reason:'',expected_version:version},'Le délai est en pause.')}]);
 // Faits constatés par l’organisation : l’instant présent, légèrement reculé pour ne jamais devancer l’horloge du serveur.
 type Tracked=NonNullable<typeof snapshot>['sla_cases'][number];
 const observe=(item:Tracked,fact:'responded_at'|'resolved_at')=>Alert.alert(fact==='responded_at'?'Constater la prise en charge ?':'Constater la résolution ?','L’heure actuelle sera enregistrée comme fait constaté par votre organisation.',[{text:'Annuler',style:'cancel'},{text:'Confirmer',onPress:()=>void send({action:'save_sla_case',site_id:site,id:item.id,expected_version:item.version,payload:{policy_id:item.policy_id,intervention_id:item.intervention_id,reference:item.reference,opened_at:item.opened_at,responded_at:item.responded_at,resolved_at:item.resolved_at,notes:item.notes,[fact]:new Date(Date.now()-3000).toISOString()}},fact==='responded_at'?'La prise en charge a été constatée.':'La résolution a été constatée.')}]);
 const resume=(id:string,version:number)=>void send({action:'resume_sla_case',id,ended_at:new Date().toISOString(),expected_version:version},'Le décompte du délai a repris.');
 const limits=snapshot?.limits,calendars=new Map((snapshot?.sla_calendars??[]).map(item=>[item.id,item])),policies=new Map((snapshot?.sla_policies??[]).map(item=>[item.id,item])),evaluations=new Map((state.data?.sla.cases??[]).map(item=>[item.case_id,item]));
 return <Screen onRefresh={form?undefined:state.reload}><Copy kind="title">Délais du site</Copy><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>{notice&&<Copy>{notice}</Copy>}{error&&!form&&<Copy kind="error">{error}</Copy>}
 {snapshot&&state.data&&<><Copy kind="label">{snapshot.site.name}</Copy>
 <Card><Copy kind="subtitle">{state.data.sla.summary.cases} dossier(s) suivi(s)</Copy><Copy>{state.data.sla.summary.breached} dépassé(s) · {state.data.sla.summary.pending} en cours · {state.data.sla.summary.met} respecté(s) · {state.data.sla.summary.not_measurable} non mesurable(s)</Copy><Copy kind="muted">Calculé le {timestamp(state.data.computed_at)}. Un délai sans calendrier ou sans cible reste non mesurable.</Copy></Card>
 {form?.kind==='calendar'&&<Card><Copy kind="subtitle">Nouveau calendrier ouvré</Copy>
  <Field label="Nom du calendrier" value={form.name} maxLength={160} editable={!busy} onChangeText={name=>setForm({...form,name})}/>
  <Field label="Fuseau horaire" placeholder="America/Martinique" autoCapitalize="none" autoCorrect={false} value={form.timezone} maxLength={64} editable={!busy} onChangeText={timezone=>setForm({...form,timezone})}/>
  <Copy>Jours ouvrés</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{weekdays.map((label,index)=>{const day=index+1,on=form.days.includes(day);return <Action key={day} label={label} selected={on} secondary disabled={busy} onPress={()=>setForm({...form,days:on?form.days.filter(value=>value!==day):[...form.days,day]})}/>;})}</View>
  <Field label="Ouverture (HH:MM)" placeholder="08:00" value={form.start} maxLength={5} keyboardType="numbers-and-punctuation" editable={!busy} onChangeText={start=>setForm({...form,start})}/>
  <Field label="Fermeture (HH:MM)" placeholder="18:00" value={form.end} maxLength={5} keyboardType="numbers-and-punctuation" editable={!busy} onChangeText={end=>setForm({...form,end})}/>
  {error&&<Copy kind="error">{error}</Copy>}<Action label={busy?'Enregistrement…':'Enregistrer le calendrier'} disabled={busy} onPress={save}/><Action secondary label="Annuler" disabled={busy} onPress={()=>{setForm(null);setError(null);}}/></Card>}
 {form?.kind==='policy'&&<Card><Copy kind="subtitle">Nouvelle règle de délai</Copy>
  <Field label="Nom de la règle" value={form.name} maxLength={160} editable={!busy} onChangeText={name=>setForm({...form,name})}/>
  <Copy>Calendrier ouvré</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Action label="Sans calendrier" selected={form.calendar===null} secondary disabled={busy} onPress={()=>setForm({...form,calendar:null})}/>{snapshot.sla_calendars.map(item=><Action key={item.id} label={item.name} selected={form.calendar===item.id} secondary disabled={busy} onPress={()=>setForm({...form,calendar:item.id})}/>)}</View>
  <Copy>Niveau d’urgence concerné</Copy><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{([[null,'Tous les niveaux'],['urgent','Urgent'],['scheduled','Planifié']] as const).map(([value,label])=><Action key={label} label={label} selected={form.urgency===value} secondary disabled={busy} onPress={()=>setForm({...form,urgency:value})}/>)}</View>
  <Field label="Délai de prise en charge (minutes)" value={form.response} maxLength={6} keyboardType="number-pad" editable={!busy} onChangeText={response=>setForm({...form,response})}/>
  <Field label="Délai de résolution (minutes)" value={form.resolution} maxLength={6} keyboardType="number-pad" editable={!busy} onChangeText={resolution=>setForm({...form,resolution})}/>
  {error&&<Copy kind="error">{error}</Copy>}<Action label={busy?'Enregistrement…':'Enregistrer la règle'} disabled={busy} onPress={save}/><Action secondary label="Annuler" disabled={busy} onPress={()=>{setForm(null);setError(null);}}/></Card>}
 {!form&&<>
 <Copy kind="subtitle">Dossiers suivis</Copy>{limits?.sla_cases_limited&&<Copy kind="muted">Liste limitée : tous les dossiers suivis ne sont pas affichés.</Copy>}
 {snapshot.sla_cases.length===0&&<Copy>Aucun dossier suivi pour ce site.</Copy>}
 {snapshot.sla_cases.map(item=>{const evaluation=evaluations.get(item.id),rule=policies.get(item.policy_id),open=item.resolved_at===null;
  return <Card key={item.id}><Copy kind="label">{evaluation?.paused_now?'En pause':item.resolved_at?'Résolu':'Ouvert'}</Copy><Copy kind="subtitle">{item.reference||'Dossier sans référence'}</Copy><Copy kind="muted">Règle : {rule?.name??'non lisible'} · ouvert le {timestamp(item.opened_at)}</Copy>
  {evaluation?<><Copy>{trackLine('Prise en charge',evaluation.response,timestamp)}</Copy><Copy>{trackLine('Résolution',evaluation.resolution,timestamp)}</Copy></>:<Copy kind="muted">Évaluation indisponible.</Copy>}
  <Copy kind="muted">{item.pauses_total} pause(s) enregistrée(s){item.pauses.some(value=>value.ended_at===null)?' · pause en cours depuis le '+timestamp(item.pauses.find(value=>value.ended_at===null)!.started_at):''}</Copy>
  {limits?.can_write_site&&open&&(evaluation?.paused_now?<Action secondary label="Reprendre le décompte" disabled={busy} onPress={()=>resume(item.id,item.version)}/>:<Action secondary label="Mettre en pause" disabled={busy} onPress={()=>pause(item.id,item.version)}/>)}
  {limits?.can_write_site&&open&&!evaluation?.paused_now&&<>{item.responded_at===null&&<Action secondary label="Constater la prise en charge" disabled={busy} onPress={()=>observe(item,'responded_at')}/>}<Action secondary label="Constater la résolution" disabled={busy} onPress={()=>observe(item,'resolved_at')}/></>}</Card>;})}
 <Copy kind="subtitle">Règles de délai</Copy>
 {snapshot.sla_policies.length===0&&<Copy>Aucune règle de délai pour ce site.</Copy>}
 {snapshot.sla_policies.map(item=><Card key={item.id}><Copy kind="label">{item.status==='active'?'Active':'Archivée'}</Copy><Copy kind="subtitle">{item.name}</Copy><Copy>{item.urgency==='urgent'?'Demandes urgentes':item.urgency==='scheduled'?'Demandes planifiées':'Tous les niveaux d’urgence'}</Copy><Copy>Prise en charge : {minutes(item.response_target_minutes)} · Résolution : {minutes(item.resolution_target_minutes)}</Copy><Copy kind="muted">Calendrier : {item.calendar_id?calendars.get(item.calendar_id)?.name??'non lisible':'aucun (délais non mesurables)'}</Copy></Card>)}
 {limits?.can_write_site?<Action secondary label="Ajouter une règle de délai" disabled={busy} onPress={()=>{setError(null);setNotice(null);setForm({kind:'policy',name:'',calendar:null,urgency:null,response:'',resolution:''});}}/>:<Copy kind="muted">Ce site est en lecture seule pour votre compte : les règles ne sont pas modifiables.</Copy>}
 <Copy kind="subtitle">Calendriers ouvrés</Copy>
 {snapshot.sla_calendars.length===0&&<Copy>Aucun calendrier ouvré dans l’organisation.</Copy>}
 {snapshot.sla_calendars.map(item=><Card key={item.id}><Copy kind="subtitle">{item.name}</Copy><Copy kind="muted">Fuseau : {item.timezone}</Copy>{item.windows.length?item.windows.map((slot,index)=><Copy key={index}>{weekdays[slot.weekday-1]} · {slot.start}–{slot.end}</Copy>):<Copy>Aucune plage ouvrée.</Copy>}{item.closed_dates.length>0&&<Copy kind="muted">{item.closed_dates.length} jour(s) fermé(s)</Copy>}</Card>)}
 {limits?.can_write_organization?<Action secondary label="Ajouter un calendrier ouvré" disabled={busy} onPress={()=>{setError(null);setNotice(null);setForm({kind:'calendar',name:'',timezone:'',days:[],start:'',end:''});}}/>:<Copy kind="muted">Les calendriers sont définis au niveau de l’organisation.</Copy>}
 </>}</>}
 </Screen>;
}
