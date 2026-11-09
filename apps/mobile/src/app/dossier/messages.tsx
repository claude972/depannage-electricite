import { useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
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
  const [cursor,setCursor]=useState<string|null>(null);
  const [body,setBody]=useState(''), [error,setError]=useState<string|null>(null), [busy,setBusy]=useState(false);
  const intent=useRef<{body:string;id:string}|null>(null), lock=useRef(false);
  const path=token&&id?'/api/messages?intervention_id='+id+(cursor?'&cursor='+encodeURIComponent(cursor):''):null;
  const state=useResource(path,history,token);
  async function send(){
    if(!token||!id||!body.trim()||lock.current)return;
    const text=body.trim();
    if(intent.current?.body!==text)intent.current={body:text,id:randomUUID()};
    lock.current=true;setBusy(true);setError(null);
    try{
      await api('/api/messages',sent,{token,method:'POST',body:{intervention_id:id,body:text,command_id:intent.current.id}});
      setBody('');intent.current=null;setCursor(null);
    }catch(issue){setError(issue instanceof Error?issue.message:'Envoi indisponible.');}
    finally{lock.current=false;setBusy(false);state.reload();}
  }
  if(!id)return <Screen><Copy kind="error">Conversation introuvable.</Copy></Screen>;
  return <Screen>
    <Copy kind="title">Conversation</Copy>
    <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
    {state.data&&<>
      {cursor&&<Action secondary label="Revenir aux messages récents" onPress={()=>setCursor(null)}/>}
      {state.data.page.next_cursor&&<Action secondary label="Voir les messages plus anciens" onPress={()=>setCursor(state.data?.page.next_cursor??null)}/>}
      {state.data.messages.length===0&&<Copy kind="muted">Aucun message.</Copy>}
      {[...state.data.messages].reverse().map(item=><Card key={item.id}>
        <Copy kind="label">{item.author_id===session?.user.id?'VOUS':'INTERLOCUTEUR'}</Copy>
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
