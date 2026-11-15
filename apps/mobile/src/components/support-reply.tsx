import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Action, Card, Copy, Field, ReadState } from './ui';
import { api } from '@/lib/api';
import { useDeviceDraft } from '@/lib/use-device-draft';
import { pendingReplyRecorded, supportDetail, supportDetailFor, supportReplyDraft, supportReplyReceipt } from '@/lib/support-contract';

export function SupportReply({id,actor,token,data,onSent}:{id:string;actor:string;token:string;data:z.infer<typeof supportDetail>;onSent:()=>void}) {
  const draft=useDeviceDraft(`support-reply-v1.${actor}.${id}`,supportReplyDraft,{body:'',pending:null});
  const [problem,setProblem]=useState(''),[busy,setBusy]=useState(false);
  const lock=useRef(false),alive=useRef(true),request=useRef<AbortController|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current?.abort();};},[]);
  async function run(check:boolean){
    if(lock.current||!draft.value)return;
    const current=draft.value;
    if(!check&&!current.body.trim()){setProblem('Écrivez une réponse avant de l’envoyer.');return;}
    if(!check&&(!data.permissions.can_reply||current.pending))return;
    lock.current=true;setBusy(true);setProblem('');
    const controller=new AbortController();request.current=controller;
    try{
      if(check&&current.pending){
        // Read the exact event interval even when the current history page is elsewhere.
        const fresh=await api(`/api/support/${id}?limit=50&after_version=${current.pending.version}`,supportDetailFor(id),{token,signal:controller.signal});
        if(!alive.current)return;
        if(pendingReplyRecorded(fresh,actor,current.pending)){
          await draft.update(value=>({...value,body:value.body.trim()===current.pending!.body?'':value.body,pending:null}));
          onSent();
        }else if(fresh.ticket.version>current.pending.version){
          // A different event consumed this version: the pending command cannot have succeeded.
          await draft.update(value=>({...value,pending:null}));
          setProblem('Le dossier a évolué. Votre texte est conservé ; relisez l’historique avant de confirmer son envoi.');onSent();
        }else{
          setProblem('Aucune réponse confirmée à cette version. Vous pouvez réessayer la même réponse.');
          await post(current.pending,controller);
        }
      }else if(!check){
        const pending={body:current.body.trim(),version:data.ticket.version};
        await draft.update(value=>({...value,pending}));
        if(alive.current)await post(pending,controller);
      }
    }catch(issue){if(alive.current&&!controller.signal.aborted)setProblem(issue instanceof Error?issue.message:'Envoi non confirmé. Vérifiez l’historique avant de réessayer.');}
    finally{if(alive.current){lock.current=false;setBusy(false);request.current=null;}}
  }
  async function post(pending:{body:string;version:number},controller:AbortController){
    await api(`/api/support/${id}`,supportReplyReceipt(id,actor,pending.version,pending.body),{token,method:'POST',signal:controller.signal,body:{action:'reply',expected_version:pending.version,body:pending.body}});
    if(!alive.current||controller.signal.aborted)return;
    await draft.update(value=>({...value,body:value.body.trim()===pending.body?'':value.body,pending:null}));onSent();
  }
  if(!draft.value)return <ReadState loading={!draft.error} error={draft.error} onRetry={draft.retry}/>;
  return <Card><Copy kind="subtitle">Répondre</Copy>
    {!data.permissions.can_reply&&<Copy kind="muted">La réponse n’est pas disponible pour cette demande.</Copy>}
    <Field label="Votre réponse" value={draft.value.body} multiline maxLength={4000} editable={!busy&&!draft.value.pending&&data.permissions.can_reply} onChangeText={body=>draft.edit(value=>({...value,body}))}/>
    {problem&&<Copy kind="error">{problem}</Copy>}
    {draft.error&&<><Copy kind="error">{draft.error}</Copy><Action secondary label="Réessayer la sauvegarde" onPress={draft.retry}/></>}
    {draft.value.pending?<Action label={busy?'Vérification…':'Vérifier puis réessayer la même réponse'} disabled={busy||draft.pending} onPress={()=>void run(true)}/>:<Action label={busy?'Envoi…':'Envoyer la réponse'} disabled={busy||draft.pending||!data.permissions.can_reply||!draft.value.body.trim()} onPress={()=>void run(false)}/>}
  </Card>;
}
