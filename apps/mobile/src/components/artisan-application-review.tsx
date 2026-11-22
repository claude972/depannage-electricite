import { useEffect,useRef,useState } from 'react';
import { View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { openBrowserAsync } from 'expo-web-browser';
import { Action,Card,Copy,Field,ReadState } from './ui';
import { api,useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { applicationActions,applicationActionLabels,applicationDecided,applicationDecisionLabels,applicationLabels,artisanApplication,artisanFile,calendarDate,credentialDecisionLabels,credentialReviewed,credentialReviews } from '@/lib/management-contracts';
import { categories,link,timestamp } from '@/lib/contracts';
import { supabaseOrigin } from '@/lib/config';
type Decision=keyof typeof applicationActionLabels;
type PieceDecision=keyof typeof credentialDecisionLabels;
const credentialLabels={registration:'Immatriculation',liability:'Assurance responsabilité civile',qualification:'Qualification',other:'Autre justificatif'};
const REASON_MIN=10;
const accountState=(account:{linked:boolean;transfers:'active'|'inactive'|'unknown'|null})=>!account.linked?'Aucun compte de règlement créé : cet artisan ne peut pas encore recevoir de paiement par carte.'
 :account.transfers==='active'?'Compte de règlement actif : les paiements par carte peuvent lui être transférés.'
 :account.transfers==='inactive'?'Compte de règlement créé, vérification Stripe incomplète : les paiements par carte restent fermés pour cet artisan.'
 :'Compte de règlement créé. Son état n’a pas pu être vérifié auprès de Stripe pour le moment.';
export function ArtisanApplicationReview({id,onChanged}:{id:string;onChanged:()=>void}){const auth=useSession().session;return auth?<Review key={auth.user.id+id} id={id} token={auth.access_token} onChanged={onChanged}/>:null;}
function Review({id,token,onChanged}:{id:string;token:string;onChanged:()=>void}){
 const state=useResource('/api/artisan?user_id='+id,artisanApplication,token),dossier=state.data?.artisan_profile;
 const file=useResource('/api/admin/artisans?user_id='+id,artisanFile,token);
 const [selected,setSelected]=useState<Decision|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const request=useRef<AbortController|null>(null),command=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{setBusy(false);return()=>{request.current?.abort();request.current=null;};},[token]);
 const motive=reason.trim(),motiveValid=motive.length>=REASON_MIN&&motive.length<=500;
 async function decide(){
  if(!selected||!dossier||request.current||!motiveValid)return;
  const action=selected,version=dossier.application_version,key=action+'|'+version+'|'+motive;
  if(command.current?.key!==key)command.current={key,id:randomUUID()};
  const controller=new AbortController();request.current=controller;setBusy(true);setError(null);
  try{const saved=await api('/api/admin/artisans',applicationDecided,{token,method:'POST',signal:controller.signal,body:{user_id:id,action,expected_version:version,command_id:command.current.id,reason:motive}});
   if(!controller.signal.aborted){setNotice(saved.reason_recorded===false?'La décision est enregistrée, mais son motif n’a pas pu être conservé. Communiquez-le à l’artisan par un autre moyen.':'La décision et son motif ont été enregistrés. Le motif est transmis à l’artisan.');setSelected(null);setReason('');command.current=null;state.reload();file.reload();onChanged();}
  }catch(issue){if(!controller.signal.aborted)setError(issue instanceof Error?issue.message:'La décision n’a pas pu être enregistrée.');}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 }
 async function document(documentId:string){if(request.current)return;const controller=new AbortController();request.current=controller;setBusy(true);setError(null);
  try{const result=await api('/api/documents?id='+documentId,link,{token,signal:controller.signal});const url=new URL(result.url);if(url.origin!==supabaseOrigin||!url.pathname.startsWith('/storage/v1/object/sign/'))throw Error('Le lien du justificatif n’a pas pu être vérifié.');if(!controller.signal.aborted)await openBrowserAsync(url.toString());}
  catch(issue){if(!controller.signal.aborted)setError(issue instanceof Error?issue.message:'Justificatif indisponible.');}finally{if(request.current===controller){request.current=null;setBusy(false);}}
 }
 const leave=()=>{setSelected(null);setReason('');setError(null);command.current=null;};
 return <><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>{notice&&<Copy>{notice}</Copy>}{error&&<Copy kind="error">{error}</Copy>}
 <Card><Copy kind="subtitle">Compte de règlement Stripe</Copy><ReadState loading={file.loading} error={file.error} onRetry={file.reload}/>{file.data&&<Copy>{accountState(file.data.payment_account)}</Copy>}<Copy kind="muted">État lu auprès du prestataire de paiement au moment de l’affichage. Il ne prouve aucun versement bancaire.</Copy></Card>
 {state.data&&!dossier&&<Copy kind="muted">Aucune candidature renseignée. Aucune approbation n’est proposée ici.</Copy>}
 {dossier&&<><Card><Copy kind="subtitle">Candidature {applicationLabels[dossier.application_status].toLocaleLowerCase('fr')}</Copy><Copy>{dossier.company_name||'Entreprise non renseignée'}</Copy><Copy>SIRET : {dossier.siret||'Non renseigné'}</Copy><Copy>{dossier.legal_status||'Forme juridique non renseignée'}</Copy><Copy>{dossier.address||'Adresse non renseignée'}</Copy><Copy kind="muted">Zones : {dossier.postal_codes.join(', ')||'Non renseignées'}</Copy><Copy kind="muted">Activités : {dossier.categories.map(value=>categories[value]).join(', ')||'Non renseignées'}</Copy></Card>
 <Card><Copy kind="subtitle">Justificatifs</Copy>{state.data?.credentials.length===0&&<Copy>Aucun justificatif renseigné.</Copy>}{state.data?.credentials.map(item=><Card key={item.id}><Copy>{credentialLabels[item.kind]}</Copy><Copy kind="muted">{item.expires_on?'Échéance : '+calendarDate(item.expires_on):'Aucune échéance renseignée'}</Copy><Action secondary label={'Consulter le justificatif · '+credentialLabels[item.kind]} disabled={busy} onPress={()=>void document(item.document_id)}/><PieceReview id={item.id} label={credentialLabels[item.kind]} token={token}/></Card>)}</Card>
 {selected?<Card><Copy kind="subtitle">{applicationActionLabels[selected]} ?</Copy><Copy>Vérifiez les informations et les justificatifs avant de confirmer cette décision.</Copy>
  <Field label="Motif de la décision (obligatoire)" value={reason} onChangeText={setReason} maxLength={500} multiline editable={!busy}/>
  <Copy kind="muted">{motiveValid?'Ce motif sera transmis à l’artisan et conservé dans l’historique des décisions.':`Indiquez un motif d’au moins ${REASON_MIN} caractères ; il sera transmis à l’artisan.`}</Copy>
  <Action label={busy?'Enregistrement…':'Confirmer la décision'} disabled={busy||!motiveValid} onPress={()=>void decide()}/><Action secondary label="Revenir au dossier" disabled={busy} onPress={leave}/>{error&&<Action secondary label="Actualiser le dossier" disabled={busy} onPress={()=>{leave();state.reload();file.reload();}}/>}</Card>:applicationActions(dossier.application_status).map(action=><Action key={action} secondary label={applicationActionLabels[action]} disabled={busy} onPress={()=>{setSelected(action);setReason('');setError(null);setNotice(null);}}/>)}
 </>}
 <Card><Copy kind="subtitle">Historique des décisions</Copy>{file.data&&file.data.decisions.length===0&&<Copy>Aucune décision motivée enregistrée pour cet artisan.</Copy>}
  {file.data?.decisions.map(item=><View key={item.id} style={{gap:2}}><Copy>{applicationDecisionLabels[item.action]} · {timestamp(item.decided_at)}</Copy><Copy kind="muted" selectable>Motif · {item.reason}</Copy></View>)}
  {file.data&&file.data.decisions.length>=20&&<Copy kind="muted">Les 20 décisions les plus récentes sont affichées.</Copy>}</Card>
 </>;
}
/** Décision motivée par pièce : même commande que le portail web (motif obligatoire, visible par l’artisan). */
function PieceReview({id,label,token}:{id:string;label:string;token:string}){
 const path=`/api/artisan/credentials/${id}/reviews`,state=useResource(path,credentialReviews,token);
 const [open,setOpen]=useState(false),[decision,setDecision]=useState<PieceDecision|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const lock=useRef(false),command=useRef<{key:string;id:string}|null>(null);
 const last=state.data?.reviews[0],motive=reason.trim();
 async function save(){
  if(lock.current||!state.data||!decision||!motive)return;
  const version=state.data.current_version,key=decision+'|'+version+'|'+motive;
  if(command.current?.key!==key)command.current={key,id:randomUUID()};
  lock.current=true;setBusy(true);setError(null);
  try{await api(path,credentialReviewed,{token,method:'POST',body:{command_id:command.current.id,expected_version:version,decision,reason:motive}});command.current=null;setOpen(false);setDecision(null);setReason('');state.reload();}
  catch(issue){setError(issue instanceof Error?issue.message:'La décision sur la pièce n’a pas pu être enregistrée.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
 {state.data&&<Copy kind="muted" selectable>{last?`${credentialDecisionLabels[last.decision]} le ${timestamp(last.reviewed_at)} · Motif : ${last.reason}`:'Aucune décision enregistrée sur cette pièce.'}</Copy>}
 {state.data&&state.data.reviews.length>1&&<Copy kind="muted">{state.data.current_version} décisions successives sur cette pièce ; la plus récente est affichée.</Copy>}
 {state.data?.can_review&&(open?<>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(Object.keys(credentialDecisionLabels) as PieceDecision[]).map(value=><Action key={value} secondary selected={decision===value} label={credentialDecisionLabels[value]} disabled={busy} onPress={()=>setDecision(value)}/>)}</View>
  <Field label={'Motif pour la pièce '+label+' (obligatoire)'} value={reason} onChangeText={setReason} maxLength={1000} multiline editable={!busy}/>
  <Copy kind="muted">Le motif est visible par l’artisan.</Copy>{error&&<Copy kind="error">{error}</Copy>}
  <Action label={busy?'Enregistrement…':'Enregistrer la décision sur la pièce'} disabled={busy||!decision||!motive} onPress={()=>void save()}/><Action secondary label="Annuler la décision sur la pièce" disabled={busy} onPress={()=>{setOpen(false);setError(null);command.current=null;}}/>
 </>:<Action secondary label={'Décider sur la pièce · '+label} onPress={()=>{setOpen(true);setError(null);}}/>)}
 </>;
}
