import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { z } from 'zod';
import { Action, Card, Copy, Field, ReadState, Screen } from '@/components/ui';
import { api, useResource } from '@/lib/api';
import { history, sent, timestamp } from '@/lib/contracts';
import { useSession } from '@/lib/session';

export default function Conversation() {
  const params=useLocalSearchParams<{id:string}>();
  const id=z.uuid().safeParse(params.id).data;
  const session=useSession().session;
  const token=session?.access_token;
  if(!id)return <Screen><Copy kind="error">Conversation introuvable.</Copy></Screen>;
  if(!token||!session)return <Screen><Copy kind="muted">Connectez-vous pour ouvrir cette conversation.</Copy></Screen>;
  return <ConversationThread key={`${session.user.id}:${token}:${id}`} id={id} token={token} profileId={session.user.id}/>;
}

function ConversationThread({id,token,profileId}:{id:string;token:string;profileId:string}) {
  const pending=useRef<AbortController|null>(null);
  useEffect(()=>()=>{pending.current?.abort();},[]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [body,setBody]=useState(''), [error,setError]=useState<string|null>(null), [busy,setBusy]=useState(false);
  const intent=useRef<{body:string;id:string}|null>(null), lock=useRef(false);
  const path=token&&id?'/api/messages?intervention_id='+id+(cursor?'&cursor='+encodeURIComponent(cursor):''):null;
  const [focused,setFocused]=useState(false);
  const [active,setActive]=useState(AppState.currentState==='active');
  useFocusEffect(useCallback(()=>{setFocused(true);return ()=>setFocused(false);},[]));
  useEffect(()=>{
    const subscription=AppState.addEventListener('change',value=>setActive(value==='active'));
    return ()=>subscription.remove();
  },[]);
  // Keep the draft and current page stable; only the newest page follows arrivals.
  const state=useResource(path,history,token,profileId,focused&&active&&!cursor?5000:0);
  async function send(){
    if(!token||!id||!body.trim()||lock.current)return;
    const text=body.trim();
    if(intent.current?.body!==text)intent.current={body:text,id:randomUUID()};
    const controller=new AbortController();pending.current=controller;
    lock.current=true;setBusy(true);setError(null);
    try{
      await api('/api/messages',sent,{token,signal:controller.signal,method:'POST',body:{intervention_id:id,body:text,command_id:intent.current.id}});
      if(controller.signal.aborted)return;
      setBody('');intent.current=null;setCursor(null);
    }catch(issue){if(controller.signal.aborted)return;setError(issue instanceof Error?issue.message:'Envoi indisponible.');}
    finally{if(!controller.signal.aborted){pending.current=null;lock.current=false;setBusy(false);state.reload();}}
  }
  return <Screen onRefresh={state.reload}>
    <Copy kind="title">Conversation</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
    {state.data&&<>
      {cursor&&<Action secondary label="Revenir aux messages récents" onPress={()=>setCursor(null)}/>}
      {state.data.page.next_cursor&&<Action secondary label="Voir les messages plus anciens" onPress={()=>setCursor(state.data?.page.next_cursor??null)}/>}
      {state.data.messages.length===0&&<Copy kind="muted">Aucun message.</Copy>}
      {[...state.data.messages].reverse().map(item=><Card key={item.id}>
        <Copy kind="label">{item.author_id===profileId?'VOUS':'INTERLOCUTEUR'}</Copy>
        <Copy>{item.body}</Copy>
        {item.attachment_id&&<Copy kind="muted">Pièce jointe disponible dans le dossier.</Copy>}
        <Copy kind="muted">{timestamp(item.created_at)}</Copy>
      </Card>)}
      <Field label="Votre message" value={body} onChangeText={setBody} multiline maxLength={4000} editable={!busy}/>
      {error&&<Copy kind="error">{error}</Copy>}
      <Action label={busy?'Envoi…':'Envoyer'} disabled={busy||!body.trim()} onPress={()=>void send()}/>
    </>}
  </Screen>;
}
