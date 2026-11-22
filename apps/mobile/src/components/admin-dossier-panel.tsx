import { useRef,useState } from 'react';
import { Alert,View } from 'react-native';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Action,Card,Copy,Field,ReadState } from './ui';
import { api,useResource } from '@/lib/api';
import { useWorkspace } from '@/lib/use-workspace';
import { adminDossier,adminTickets,directoryDetail,directoryPage,dossierAuditLabels,reassigned,supportStatusLabels,ticketTriage,triageReceipt } from '@/lib/management-contracts';
import { commissionRate,euros,participantsView,statuses,timestamp,type Job } from '@/lib/contracts';

const REASSIGNABLE=['requested','assigned','quoted'];
const REASON_MIN=10;
const roleNames:Record<string,string>={client:'Client',manager:'Client entreprise',artisan:'Artisan',admin:'Exploitant'};
const shortId=(value:string)=>'compte '+value.slice(0,8);
type Props={id:string;token:string;actor:string;status:Job['status'];artisanId:string|null;clientId:string|null;onChanged:()=>void};
/** Outils de l’administration sur un dossier : affichage seulement, les droits restent vérifiés par le serveur. */
export function AdminDossierPanel(props:Props){
 const role=useWorkspace(true).data?.profile.role;
 return role==='admin'?<Panel key={props.actor+props.id} {...props}/>:null;
}
function Panel({id,token,actor,status,artisanId,clientId,onChanged}:Props){
 const router=useRouter();
 const dossier=useResource('/api/admin/interventions?id='+id,adminDossier,token,actor);
 const people=useResource(`/api/interventions/${id}/operations`,participantsView,token,actor);
 const client=useResource(clientId?`/api/admin/directory?kind=clients&id=${clientId}`:null,directoryDetail,token,actor);
 const named=people.data?.participants??[];
 const actorLabel=(value:string|null)=>{
  if(!value)return 'Acteur non renseigné';
  if(value===actor)return 'Vous (administration)';
  const person=named.find(item=>item.id===value);
  if(person)return `${person.full_name?.trim()||'Nom non communiqué'} (${roleNames[person.role]??person.role})`;
  if(value===clientId&&client.data?.item.full_name)return `${client.data.item.full_name} (Client)`;
  return shortId(value);
 };
 const artisan=named.find(item=>item.id===artisanId);
 const reload=()=>{dossier.reload();people.reload();onChanged();};
 const settlement=dossier.data?.settlement,audit=dossier.data?.audit;
 return <>
  <Copy kind="subtitle">Administration du dossier</Copy>
  <Card><Copy kind="subtitle">Participants</Copy><ReadState loading={people.loading} error={people.error} onRetry={people.reload}/>
   {clientId&&<View style={{gap:2}}><Copy kind="label">Client</Copy><Copy selectable>{named.find(item=>item.id===clientId)?.full_name?.trim()||client.data?.item.full_name||shortId(clientId)}</Copy>{(named.find(item=>item.id===clientId)?.phone??client.data?.item.phone)?<Copy kind="muted" selectable>{named.find(item=>item.id===clientId)?.phone??client.data?.item.phone}</Copy>:<Copy kind="muted">Téléphone non communiqué.</Copy>}
    <Action secondary label="Ouvrir la fiche du client" onPress={()=>router.push({pathname:'/annuaire/[id]',params:{id:clientId,kind:'clients'}})}/></View>}
   <View style={{gap:2}}><Copy kind="label">Artisan attribué</Copy>{artisanId?<><Copy selectable>{artisan?.full_name?.trim()||shortId(artisanId)}</Copy>{artisan?.phone?<Copy kind="muted" selectable>{artisan.phone}</Copy>:<Copy kind="muted">Téléphone non communiqué.</Copy>}
    <Action secondary label="Ouvrir la fiche de l’artisan" onPress={()=>router.push({pathname:'/annuaire/[id]',params:{id:artisanId,kind:'artisans'}})}/></>:<Copy>Aucun artisan attribué : le dossier est en attente d’attribution.</Copy>}</View>
  </Card>
  <Card><Copy kind="subtitle">Règlement et commission</Copy><ReadState loading={dossier.loading} error={dossier.error} onRetry={dossier.reload}/>
   {dossier.data&&(settlement?<>
    <Copy selectable>Montant réglé par carte · {euros(settlement.amount_cents)}</Copy>
    <Copy selectable>Commission plateforme ({commissionRate(settlement.fee_bps)}) · {euros(settlement.fee_cents)}</Copy>
    <Copy selectable>Part nette de l’artisan · {euros(settlement.net_cents)}</Copy>
    <Copy kind="muted">Montants figés par le serveur lors du règlement. Ils ne prouvent pas un virement sur le compte bancaire de l’artisan.</Copy>
   </>:<Copy>Aucun règlement par carte confirmé sur ce dossier : aucune commission n’est figée.</Copy>)}
  </Card>
  <Reassign id={id} token={token} status={status} artisanId={artisanId} artisanName={artisan?.full_name?.trim()||null} onSaved={reload}/>
  <Escalations id={id} token={token} actor={actor}/>
  <Card><Copy kind="subtitle">Journal du dossier</Copy><Copy kind="muted">Actions enregistrées, de la plus récente à la plus ancienne.</Copy>
   {audit?.status==='ok'?<>
    {audit.items.length===0&&<Copy>Aucune action enregistrée dans le journal de ce dossier.</Copy>}
    {audit.items.map(event=><View key={event.id} style={{gap:2}}><Copy>{dossierAuditLabels[event.action]??'Événement du dossier'} · {actorLabel(event.actor_id)}</Copy><Copy kind="muted">{timestamp(event.created_at)}</Copy></View>)}
    <Copy kind="muted">{audit.limited?`Affichage limité aux ${audit.limit} dernières actions.`:'Toutes les actions du journal sont affichées.'}</Copy>
   </>:dossier.data&&<><Copy kind="error">Le journal du dossier est momentanément indisponible.</Copy></>}
   <Action secondary label="Recharger le journal" onPress={dossier.reload}/>
  </Card>
 </>;
}

function Reassign({id,token,status,artisanId,artisanName,onSaved}:{id:string;token:string;status:Job['status'];artisanId:string|null;artisanName:string|null;onSaved:()=>void}){
 const [text,setText]=useState(''),[query,setQuery]=useState<string|null>(null),[target,setTarget]=useState<{id:string;name:string}|null>(null),[pending,setPending]=useState(false);
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const lock=useRef(false);
 const params=new URLSearchParams({kind:'artisans',approved:'true',limit:'25'});if(query)params.set('q',query);
 const found=useResource(query===null?null:'/api/admin/directory?'+params,directoryPage,token);
 const motive=reason.trim();
 const issue=!target&&!pending?'Choisissez un artisan approuvé ou la remise en attente.'
  :target&&target.id===artisanId?'Cet artisan est déjà attribué au dossier.'
  :pending&&!artisanId?'Le dossier est déjà en attente d’attribution.'
  :motive.length<REASON_MIN?`Indiquez un motif d’au moins ${REASON_MIN} caractères ; il sera partagé avec les participants.`:null;
 function search(){const value=text.trim();setError(null);if(value&&value.length<2){setError('Saisissez au moins deux caractères pour rechercher un artisan.');return;}setQuery(value);}
 function submit(){
  if(issue||lock.current)return;
  Alert.alert('Confirmer la réaffectation ?',(target?`Réaffecter ce dossier à ${target.name} ?`:'Remettre ce dossier en attente d’attribution ?')+' Les devis envoyés seront refusés et le rendez-vous supprimé.',[{text:'Revenir',style:'cancel'},{text:'Confirmer',onPress:()=>{
   if(lock.current)return;lock.current=true;setBusy(true);setError(null);setNotice(null);
   void api(`/api/interventions/${id}/operations`,reassigned,{token,method:'POST',body:{action:'reassign',artisan_id:target?.id??null,reason:motive}})
    .then(()=>{setNotice(target?`Dossier réaffecté à ${target.name}.`:'Dossier remis en attente d’attribution.');setTarget(null);setPending(false);setReason('');setQuery(null);setText('');},
     failure=>setError(failure instanceof Error?failure.message:'La réaffectation n’a pas pu être enregistrée.'))
    .finally(()=>{lock.current=false;setBusy(false);onSaved();});
  }}]);
 }
 return <Card><Copy kind="subtitle">Réaffectation</Copy>{notice&&<Copy>{notice}</Copy>}
  {!REASSIGNABLE.includes(status)?<Copy>Réaffectation impossible à ce stade : elle n’est possible qu’avant l’acceptation du devis (« {statuses.requested} », « {statuses.assigned} », « {statuses.quoted} »). Statut actuel : {statuses[status]}.</Copy>:<>
   <Copy>Artisan actuel : {artisanId?artisanName??'attribué':'aucun'}</Copy>
   <Field label="Rechercher un artisan approuvé" value={text} onChangeText={setText} maxLength={80} editable={!busy} returnKeyType="search" onSubmitEditing={search}/>
   <Action secondary label="Rechercher un artisan" disabled={busy} onPress={search}/>
   <ReadState loading={found.loading} error={found.error} onRetry={found.reload}/>
   {found.data&&<Copy kind="muted">{found.data.page.total} artisan(s) approuvé(s){found.data.page.has_more?' · les 25 premiers sont affichés, précisez la recherche':''}</Copy>}
   {found.data?.items.map(item=>{const name=(item.full_name??'Artisan')+(item.company_name?' — '+item.company_name:'');return <Action key={item.id} secondary selected={target?.id===item.id} disabled={busy} label={(item.id===artisanId?'Artisan actuel · ':'Choisir ')+name} onPress={()=>{setTarget({id:item.id,name});setPending(false);setNotice(null);}}/>;})}
   <Action secondary selected={pending} disabled={busy} label="Remettre en attente d’attribution" onPress={()=>{setPending(true);setTarget(null);setNotice(null);}}/>
   {(target||pending)&&<Copy>Choix : {target?target.name:'remise en attente d’attribution'}</Copy>}
   <Field label="Motif de la réaffectation (obligatoire)" value={reason} onChangeText={setReason} maxLength={1000} multiline editable={!busy}/>
   <Copy kind="muted">Les devis envoyés et non acceptés sont refusés, le rendez-vous éventuel est supprimé et le motif est partagé avec les participants du dossier.</Copy>
   {issue&&(target||pending||motive.length>0)&&<Copy kind="muted">{issue}</Copy>}
   {error&&<Copy kind="error">{error}</Copy>}
   <Action label={busy?'Enregistrement…':target||!pending?'Réaffecter le dossier':'Remettre le dossier en attente'} disabled={busy||Boolean(issue)} onPress={submit}/>
  </>}
 </Card>;
}

function Escalations({id,token,actor}:{id:string;token:string;actor:string}){
 const router=useRouter();
 const tickets=useResource(`/api/support?scope=all&intervention_id=${id}&limit=25`,adminTickets,token,actor);
 return <Card><Copy kind="subtitle">Assistance et escalades</Copy><ReadState loading={tickets.loading} error={tickets.error} onRetry={tickets.reload}/>
  {tickets.data&&tickets.data.tickets.length===0&&<Copy>Aucune demande d’assistance n’est rattachée à ce dossier : rien à escalader.</Copy>}
  {tickets.data?.tickets.map(ticket=><View key={ticket.id} style={{gap:8}}>
   <Copy selectable>{ticket.subject}</Copy><Copy kind="muted">{supportStatusLabels[ticket.status]} · ouverte le {timestamp(ticket.created_at)}</Copy>
   <TicketEscalation ticket={ticket.id} subject={ticket.subject} token={token} actor={actor}/>
   <Action secondary label={'Ouvrir la demande · '+ticket.subject} onPress={()=>router.push({pathname:'/dossier/assistance-suivi',params:{ticket_id:ticket.id}})}/>
  </View>)}
  {tickets.data?.page.has_more&&<Copy kind="muted">Les 25 demandes les plus récentes de ce dossier sont affichées.</Copy>}
 </Card>;
}
export function TicketEscalation({ticket,subject,token,actor}:{ticket:string;subject:string;token:string;actor:string}){
 const state=useResource('/api/support/triage?kind=ticket&ticket_id='+ticket,ticketTriage,token,actor);
 const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const lock=useRef(false),command=useRef<{key:string;id:string}|null>(null);
 const triage=state.data?.triage,motive=reason.trim(),last=state.data?.events.filter(item=>item.action==='set_escalated').at(-1);
 async function save(){
  if(!triage||lock.current||!motive)return;
  const escalated=!triage.escalated,key=`${escalated}|${triage.version}|${motive}`;
  if(command.current?.key!==key)command.current={key,id:randomUUID()};
  lock.current=true;setBusy(true);setError(null);
  try{await api('/api/support/triage',triageReceipt,{token,method:'POST',body:{ticket_id:ticket,command_id:command.current.id,expected_version:triage.version,reason:motive,action:'set_escalated',escalated}});command.current=null;setOpen(false);setReason('');}
  catch(issue){setError(issue instanceof Error?issue.message:'L’escalade n’a pas pu être enregistrée.');}
  finally{lock.current=false;setBusy(false);state.reload();}
 }
 return <><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
  {triage&&<Copy kind="label">{triage.escalated?'Demande escaladée':'Demande non escaladée'}{triage.assignee_name?' · suivie par '+triage.assignee_name:' · non attribuée'}</Copy>}
  {last&&<Copy kind="muted" selectable>{last.escalated?'Escaladée':'Escalade levée'} le {timestamp(last.created_at)} · Motif : {last.reason}</Copy>}
  {error&&<Copy kind="error">{error}</Copy>}
  {triage&&(!state.data?.can_manage?<Copy kind="muted">Vos droits d’opérateur ne permettent pas de modifier l’escalade de cette demande (demande résolue ou droit de suivi absent).</Copy>
   :open?<><Field label={(triage.escalated?'Motif de la levée d’escalade':'Motif de l’escalade')+' (obligatoire)'} value={reason} onChangeText={setReason} maxLength={500} multiline editable={!busy}/>
    <Action label={busy?'Enregistrement…':triage.escalated?'Confirmer la levée de l’escalade':'Confirmer l’escalade'} disabled={busy||!motive} onPress={()=>void save()}/>
    <Action secondary label="Annuler" disabled={busy} onPress={()=>{setOpen(false);setError(null);command.current=null;}}/></>
   :<Action secondary label={(triage.escalated?'Lever l’escalade · ':'Escalader · ')+subject} onPress={()=>{setOpen(true);setError(null);}}/>)}
 </>;
}
