import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { z } from 'zod';
import { Action, Card, Copy, ReadState, Screen } from '@/components/ui';
import { useResource } from '@/lib/api';
import { timestamp } from '@/lib/contracts';
import { supportDetailFor } from '@/lib/support-contract';
import { SupportReply } from '@/components/support-reply';
import { useSession } from '@/lib/session';
import { orderReference } from '../../../../../shared/order-reference';

const labels={open:'Ouverte',in_progress:'En cours',awaiting_user:'Réponse attendue',resolved:'Résolue'};
export default function SupportFollowup(){
  const {ticket_id}=useLocalSearchParams<{ticket_id?:string}>(),session=useSession().session;
  const id=z.uuid().safeParse(ticket_id).data;
  if(!id||!session)return <Screen><Copy kind="error">Cette demande d’assistance ne peut pas être ouverte.</Copy></Screen>;
  return <History key={`${session.user.id}:${session.access_token}:${id}`} id={id} token={session.access_token} actor={session.user.id}/>;
}
function History({id,token,actor}:{id:string;token:string;actor:string}){
  const router=useRouter(),schema=useMemo(()=>supportDetailFor(id),[id]);
  const [after,setAfter]=useState(0),[previous,setPrevious]=useState<number[]>([]);
  const read=useResource(`/api/support/${id}?limit=50&after_version=${after}`,schema,token);
  const data=read.data;
  const [notice,setNotice]=useState('');
  function refresh(message=''){setNotice(message);setAfter(0);setPrevious([]);read.reload();}
  return <Screen>
    <Copy kind="title">{data?.ticket.subject??'Suivi de votre demande'}</Copy>
    {notice&&<Copy>{notice}</Copy>}
    <ReadState loading={read.loading} error={read.error} onRetry={read.reload}/>
    {data&&<>
      <Copy kind="label">{labels[data.ticket.status]}</Copy>
      <Action secondary label="Actualiser" onPress={refresh}/>
      {data.ticket.intervention_id&&<Action secondary label={`Dossier lié : ${orderReference(data.ticket.intervention_id)}`} onPress={()=>router.push({pathname:'/dossier/[id]',params:{id:data.ticket.intervention_id!}})}/>}
      <Copy kind="muted">Aucun appel, email ni SMS. Aucun délai de réponse n’est garanti.</Copy>
      <Card><Copy kind="subtitle">Historique</Copy>
        {!data.events.length&&<Copy kind="muted">Aucun événement sur cette page.</Copy>}
        {data.events.map(event=>{
          const message=data.messages.find(item=>item.id===event.message_id);
          return <Card key={event.id}>
            <Copy kind="label">{event.kind==='status_changed'?`Statut : ${labels[event.to_status]}`:event.actor_id===actor?'Vous':'Équipe de la plateforme'}</Copy>
            {message&&<Copy>{message.body}</Copy>}
            <Copy kind="muted">{timestamp(event.created_at)}</Copy>
          </Card>;
        })}
        <Copy kind="muted">{data.page.total_events} événement(s) · {data.page.total_messages} message(s)</Copy>
      </Card>
      <SupportReply id={id} actor={actor} token={token} data={data} onSent={refresh}/>
      {previous.length>0&&<Action secondary label="Événements précédents" onPress={()=>{setAfter(previous[previous.length-1]);setPrevious(current=>current.slice(0,-1));}}/>}
      {data.page.has_more&&data.page.next_after_version!==null&&<Action secondary label="Événements suivants" onPress={()=>{setPrevious(current=>[...current,after]);setAfter(data.page.next_after_version!);}}/>}
    </>}
  </Screen>;
}
