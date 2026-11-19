import { useEffect, useRef, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { z } from 'zod';
import { Action, Copy, Field, ReadState, Screen, usePalette } from '@/components/ui';
import { api, useResource } from '@/lib/api';
import { categories, detail } from '@/lib/contracts';
import { useSession } from '@/lib/session';
import { useDeviceDraft } from '@/lib/use-device-draft';
import { confirmSupportDraft, supportCommand, supportDraft, supportDraftKey, supportReceipt, supportRetry } from '@/lib/support-contract';
import { orderReference } from '../../../../../shared/order-reference';

export default function DossierAssistance() {
  const params=useLocalSearchParams<{id?:string}>(), session=useSession().session;
  const id=z.uuid().safeParse(params.id).data;
  if(!session||!id)return <Screen><Copy kind="error">Ouvrez l’assistance depuis un dossier de votre espace.</Copy></Screen>;
  return <Access key={`${session.user.id}:${session.access_token}:${id}`} actor={session.user.id} token={session.access_token} id={id}/>;
}
function Access({actor,token,id}:{actor:string;token:string;id:string}) {
  const read=useResource(`/api/interventions/${id}`,detail,token);
  if(!read.data)return <Screen><ReadState loading={read.loading} error={read.error} onRetry={read.reload}/></Screen>;
  if(read.data.intervention.id!==id)return <Screen><Copy kind="error">Ce dossier n’a pas pu être vérifié.</Copy></Screen>;
  return <Editor actor={actor} token={token} id={id} label={categories[read.data.intervention.category]}/>;
}
function Editor({actor,token,id,label}:{actor:string;token:string;id:string;label:string}) {
  const router=useRouter(), palette=usePalette();
  const draft=useDeviceDraft(supportDraftKey(actor,id),supportDraft,{subject:'',body:'',pending:null,confirmedTicketId:null});
  const [problem,setProblem]=useState(''),[errors,setErrors]=useState<{subject?:string;body?:string}>({}),[busy,setBusy]=useState(false);
  const lock=useRef(false), alive=useRef(true), request=useRef<AbortController|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current?.abort();};},[]);
  const value=draft.value;
  const back=()=>router.replace({pathname:'/dossier/[id]',params:{id}});
  async function send(){
    if(lock.current||!value)return;
    setProblem('');setErrors({});
    const parsed=supportCommand.safeParse({request_id:value.pending?.command.request_id??randomUUID(),subject:value.subject,body:value.body,intervention_id:id});
    if(!value.pending&&!parsed.success){
      const fields=parsed.error.flatten().fieldErrors;
      setErrors({subject:fields.subject?'Indiquez un sujet de 4 à 160 caractères.':undefined,body:fields.body?'Écrivez un message de 10 à 4000 caractères.':undefined});return;
    }
    const pending=value.pending??(parsed.success?{actor_id:actor,command:parsed.data}:null);
    if(!pending)return;
    lock.current=true;setBusy(true);Keyboard.dismiss();
    const controller=new AbortController();request.current=controller;
    try{
      const command=supportRetry(pending,actor,id);
      // Persist the exact command before the first request or every retry.
      await draft.update(current=>({...current,pending,confirmedTicketId:null}));
      if(!alive.current)return;
      const result=await api('/api/support',supportReceipt(command,actor),{token,method:'POST',body:command,signal:controller.signal});
      if(!alive.current||controller.signal.aborted)return;
      await draft.update(current=>confirmSupportDraft(current,actor,id,result));
    }catch(issue){if(alive.current&&!controller.signal.aborted)setProblem(issue instanceof Error?issue.message:'La demande n’a pas été confirmée. Réessayez avec le même contenu.');}
    finally{if(alive.current){lock.current=false;setBusy(false);request.current=null;}}
  }
  if(!value)return <Screen><Copy kind="title">Écrire à l’assistance</Copy><ReadState loading={!draft.error} error={draft.error} onRetry={draft.retry}/></Screen>;
  if(value.confirmedTicketId)return <Screen><Copy kind="title">Demande enregistrée</Copy><Copy>Votre demande d’assistance est liée au dossier {orderReference(id)}.</Copy><Copy kind="muted">Aucun délai de réponse n’est garanti.</Copy><Action label="Suivre ma demande d’assistance" onPress={()=>router.push({pathname:'/dossier/assistance-suivi',params:{ticket_id:value.confirmedTicketId!}})}/><Action secondary label="Poser une autre question" disabled={draft.pending} onPress={()=>void draft.update(current=>({...current,confirmedTicketId:null})).catch(()=>{})}/>{draft.error&&<Copy kind="error">{draft.error}</Copy>}<Action secondary label="Retour au dossier" onPress={back}/></Screen>;
  const disabled=busy||Boolean(value.pending);
  return <Screen>
    <Copy kind="title">Écrire à l’assistance</Copy>
    <Copy>{label} · {orderReference(id)}</Copy>
    <View style={{padding:16,gap:12,borderWidth:1,borderRadius:12,borderColor:palette.border,backgroundColor:palette.surface}}>
      <Field label="Sujet" value={value.subject} onChangeText={subject=>draft.edit(current=>({...current,subject}))} placeholder="Saisissez le sujet de votre demande" maxLength={160} editable={!disabled}/>
      {errors.subject&&<Copy kind="error">{errors.subject}</Copy>}
      <Field label="Message" value={value.body} onChangeText={body=>draft.edit(current=>({...current,body}))} placeholder="Décrivez votre question à l’équipe" multiline maxLength={4000} editable={!disabled}/>
      {errors.body&&<Copy kind="error">{errors.body}</Copy>}
      <Text style={{fontFamily:'JakartaRegular',fontSize:12,lineHeight:18,color:palette.muted}}>Sujet : 4–160 caractères. Message : 10–4000 caractères.</Text>
      <Copy kind="label">Dossier concerné</Copy><Copy>{label} · {orderReference(id)}</Copy>
      <Copy kind="muted">Ce dossier sera lié à votre demande d’assistance.</Copy>
      <Copy kind="muted">Aucun appel, email ni SMS : aucun délai de réponse n’est garanti.</Copy>
      {value.pending&&<Copy kind="muted">Cette demande attend une confirmation. Une nouvelle tentative renverra exactement le même contenu pour éviter un doublon.</Copy>}
      {draft.error&&<><Copy kind="error">{draft.error}</Copy><Action secondary label="Réessayer l’enregistrement du brouillon" onPress={draft.retry}/></>}
      {problem&&<Copy kind="error">{problem}</Copy>}
      <Action label={busy?'Envoi…':value.pending?'Réessayer la même demande':'Envoyer la demande'} disabled={busy||draft.pending} onPress={()=>void send()}/>
      <Action secondary label="Retour au dossier" disabled={busy} onPress={back}/>
    </View>
  </Screen>;
}
