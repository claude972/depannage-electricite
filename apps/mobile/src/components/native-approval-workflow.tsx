import { useEffect,useRef,useState,type ComponentRef } from 'react';
import { TextInput } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { z } from 'zod';
import { workflowStatus,workflowCommand,workflowReceipt } from '../../../../shared/advanced-approval-contract';
import { api,ApiFailure,useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { approvalCommandKey,allowedWorkflowActions,persistApprovalCommand,restoreApprovalCommand } from '@/lib/approval-command';
import { deviceDrafts } from '@/lib/device-drafts';
import { timestamp } from '@/lib/contracts';
import { Action,Card,Copy,Field,ReadState } from './ui';
type Command=z.infer<typeof workflowCommand>;
const labels={submit:'Soumettre au circuit',approve:'Approuver cette étape',reject:'Rejeter',request_information:'Demander un complément',respond:'Répondre au complément'};
const states={pending:'En attente',changes_requested:'Complément demandé',approved:'Approuvé',rejected:'Rejeté'};
export function NativeApprovalWorkflow({quoteId}:{quoteId:string}){const auth=useSession().session;return auth?<Workflow key={auth.user.id+quoteId} quoteId={quoteId} token={auth.access_token} actor={auth.user.id}/>:null;}
function Workflow({quoteId,token,actor}:{quoteId:string;token:string;actor:string}){
 const path=`/api/quotes/${quoteId}/approval`,[after,setAfter]=useState<number[]>([]),cursor=after.at(-1)??0;
 const state=useResource(path+(cursor?'?after='+cursor:''),workflowStatus,token),current=state.data,w=current?.workflow;
 const [selected,setSelected]=useState<Command['action']|null>(null),[note,setNote]=useState(''),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[busy,setBusy]=useState(false),[pending,setPending]=useState<Command|null>(null);
 const [restored,setRestored]=useState(false);
 const draftKey=approvalCommandKey(actor,quoteId);
 useEffect(()=>{let live=true;void restoreApprovalCommand(deviceDrafts,actor,quoteId).then(command=>{if(live){setPending(command);setRestored(true);}},()=>{if(live)setError('La reprise enregistrée ne peut pas être lue. Réessayez après avoir rouvert le dossier.');});return()=>{live=false;};},[actor,quoteId]);
 const lock=useRef<AbortController|null>(null),noteRef=useRef<ComponentRef<typeof TextInput>>(null);
 useEffect(()=>{setBusy(false);return()=>{lock.current?.abort();lock.current=null;};},[token]);
 async function execute(command:Command){if(lock.current)return;const controller=new AbortController();lock.current=controller;setBusy(true);setError(null);setPending(command);
  try{await persistApprovalCommand(deviceDrafts,actor,quoteId,command);
   if(controller.signal.aborted)return;
   const receipt=await api(path,workflowReceipt,{token,method:'POST',signal:controller.signal,body:command});
   const allowed=command.action==='approve'?['pending','approved']:[command.action==='reject'?'rejected':command.action==='request_information'?'changes_requested':'pending'];
   if(receipt.quote_id!==quoteId||receipt.version!==(command.expected_version??0)+1||!allowed.includes(receipt.state))throw Error('La décision doit être vérifiée. Réessayez avec la même commande.');
   if(!controller.signal.aborted){await deviceDrafts.clear(draftKey);if(controller.signal.aborted)return;setPending(null);setSelected(null);setNote('');setNotice('L’action a été enregistrée. Le circuit est actualisé.');setAfter([]);state.reload();}
  }catch(issue){if(!controller.signal.aborted){setError(issue instanceof Error?issue.message:'L’action n’a pas pu être confirmée.');if(issue instanceof ApiFailure&&[401,403,409,422].includes(issue.status)){await deviceDrafts.clear(draftKey).catch(()=>{});setPending(null);setSelected(null);state.reload();}}}
  finally{if(lock.current===controller){lock.current=null;setBusy(false);}}
 }
 function confirm(){if(!selected||!current||!restored)return;const parsed=workflowCommand.safeParse({command_id:randomUUID(),expected_version:w?.version??null,action:selected,note:note.trim()});if(!parsed.success){setError('Renseignez un commentaire pour cette action (2 000 caractères maximum).');noteRef.current?.focus();return;}void execute(parsed.data);}
 const actions=current?allowedWorkflowActions(current):[];
 return <Card><Copy kind="subtitle">Circuit d’approbation</Copy><ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>{notice&&<Copy>{notice}</Copy>}{error&&<Copy kind="error">{error}</Copy>}
 {current&&<>
 {!current.required&&!w&&<Copy kind="muted">Aucun circuit avancé n’est requis pour ce devis. Les règles simples éventuelles restent distinctes.</Copy>}
 {current.required&&!w&&<Copy>Le devis attend sa soumission au circuit.</Copy>}
 {current.approved_current&&<Copy>Le circuit est approuvé pour cette version du devis. Cela ne vaut ni acceptation du devis ni règlement.</Copy>}
 {w&&<><Copy kind="label">{states[w.state]} · étape {w.current_step} sur {w.steps.length}</Copy>{!w.snapshot_matches&&<Copy kind="error">Le devis ou la règle a changé. Une nouvelle soumission peut être nécessaire.</Copy>}{w.steps.map((step,i)=><Copy key={i}>{i+1}. {'role'in step?(step.role==='owner'?'Propriétaire':'Gestionnaire'):'Validateur désigné'} · {w.state==='approved'?'approuvée':i+1<w.current_step?'validée':i+1===w.current_step?'étape actuelle':'à venir'}</Copy>)}</>}
 {restored&&!pending&&actions.length>0&&<><Field inputRef={noteRef} label="Commentaire (requis pour refuser, demander ou fournir un complément)" value={note} maxLength={2000} multiline editable={!busy} onChangeText={setNote}/>{selected?<Card><Copy>{labels[selected]} ?</Copy><Action label="Confirmer l’action" disabled={busy} onPress={confirm}/><Action secondary label="Annuler" disabled={busy} onPress={()=>{setSelected(null);setError(null);}}/></Card>:actions.map(action=><Action key={action} secondary label={labels[action]} disabled={busy} onPress={()=>{setSelected(action);setError(null);setNotice(null);}}/>)}</>}
 {actions.length===0&&(w||current.required)&&<Copy kind="muted">Aucune action n’est autorisée pour votre compte à cette étape.</Copy>}
 <Copy kind="subtitle">Historique du circuit</Copy>{current.events.length===0&&<Copy kind="muted">Aucun événement sur cette page.</Copy>}{current.events.map(event=><Card key={event.version}><Copy>{labels[event.action]} · {timestamp(event.created_at)}</Copy>{Boolean(event.note)&&<Copy>{event.note}</Copy>}</Card>)}
 {after.length>0&&<Action secondary label="Historique précédent" disabled={busy||!!pending} onPress={()=>setAfter(v=>v.slice(0,-1))}/>}{current.next_after!==null&&<Action secondary label="Historique suivant" disabled={busy||!!pending} onPress={()=>setAfter(v=>[...v,current.next_after!])}/>}
 </>}
 {busy&&<Copy>Enregistrement de l’action…</Copy>}
 {pending&&!busy&&<><Copy kind="muted">La réponse n’a pas été confirmée. Une nouvelle tentative reprend exactement la même commande.</Copy><Action label="Vérifier cette commande" onPress={()=>void execute(pending)}/></>}
 </Card>;
}
