import { useRef,useState,type ComponentRef } from 'react';
import { Alert,TextInput } from 'react-native';
import { useLocalSearchParams,useRouter } from 'expo-router';
import { z } from 'zod';
import { NativeApprovalWorkflow } from '@/components/native-approval-workflow';
import { ManagementAccess } from '@/components/management-access';
import { Action,Card,Copy,Field,ReadState,Screen } from '@/components/ui';
import { api,ApiFailure,useResource } from '@/lib/api';
import { useSession } from '@/lib/session';
import { approvalDetail,approvalLabels } from '@/lib/management-contracts';
import { categories,euros,timestamp } from '@/lib/contracts';
export default function Approval(){const {id,organization_id}=useLocalSearchParams<{id:string;organization_id:string}>(),auth=useSession().session;return <ManagementAccess>{auth&&z.uuid().safeParse(id).success&&z.uuid().safeParse(organization_id).success?<Details key={auth.user.id+id} id={id} org={organization_id} token={auth.access_token}/>:<Screen><Copy>Approbation introuvable.</Copy></Screen>}</ManagementAccess>;}
const decisionReceipt=z.object({result:z.unknown()});
type Decision='approved'|'rejected';
function Details({id,org,token}:{id:string;org:string;token:string}){
 const router=useRouter(),state=useResource(`/api/enterprise/approvals/${id}?organization_id=${org}`,approvalDetail,token),item=state.data?.approval;
 // Decision state lives here: the read below is replaced on reload, the outcome message must survive it.
 const [note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null),[denied,setDenied]=useState(false),[conflict,setConflict]=useState(false);
 const lock=useRef(false),noteRef=useRef<ComponentRef<typeof TextInput>>(null);
 async function decide(decision:Decision,comment:string){
  if(lock.current)return;
  lock.current=true;setBusy(true);setError(null);setNotice(null);setConflict(false);
  try{
   // Simple site rule (POST /api/professional). The server alone decides who may approve or refuse.
   await api('/api/professional',decisionReceipt,{token,method:'POST',body:{action:'decide_approval',approval_id:id,decision,note:comment}});
   setNote('');
   setNotice(decision==='approved'?'Approbation enregistrée. Le devis peut maintenant être accepté depuis le dossier de l’intervention.':'Refus enregistré. Votre commentaire est transmis au demandeur.');
   state.reload();
  }catch(issue){
   const status=issue instanceof ApiFailure?issue.status:-1,message=issue instanceof Error?issue.message:'La décision n’a pas pu être enregistrée.';
   if(status===403){setDenied(true);setError('Votre rôle dans cette organisation ne permet pas de décider cette approbation. Une personne habilitée par la règle du site doit la traiter. Aucune décision n’a été enregistrée.');}
   else if(status===409){setConflict(true);setError(message+' L’état affiché vient d’être rechargé.');state.reload();}
   else if(status===404){setError('Cette approbation est introuvable ou n’est plus accessible avec ce compte.');state.reload();}
   else if(status===422){setError(message);if(decision==='rejected')noteRef.current?.focus();}
   else if(status===401)setError('Votre session a expiré. Reconnectez-vous, puis reprenez la décision.');
   // Timeout or lost connection: the decision may have been recorded, so the state is read again before any retry.
   else if(status===0||status===502){setError('La réponse n’a pas été reçue. Vérifiez l’état rechargé ci-dessous avant de décider à nouveau.');state.reload();}
   else setError(message);
  }finally{lock.current=false;setBusy(false);}
 }
 function ask(decision:Decision,total:string,site:string){
  if(lock.current||busy)return;
  const comment=note.trim();
  if(decision==='rejected'&&!comment){setNotice(null);setError('Un commentaire est obligatoire pour refuser. Il est transmis au demandeur.');noteRef.current?.focus();return;}
  setError(null);
  Alert.alert(decision==='approved'?'Approuver ce devis ?':'Refuser ce devis ?',
   `${site} · ${total} TTC.\n${decision==='approved'?'Le devis pourra ensuite être accepté dans le dossier. L’approbation ne vaut ni acceptation ni règlement.':'Le devis restera bloqué et votre commentaire sera transmis au demandeur.'}\nCette décision est définitive.`,
   [{text:'Revenir',style:'cancel'},{text:decision==='approved'?'Approuver':'Refuser',style:decision==='rejected'?'destructive':'default',onPress:()=>void decide(decision,comment)}]);
 }
 return <Screen onRefresh={state.reload}>
  {notice&&<Card><Copy>{notice}</Copy></Card>}
  {error&&<Card><Copy kind="error">{error}</Copy></Card>}
  <ReadState loading={state.loading} error={state.error} onRetry={state.reload}/>
  {item&&<>
   <Copy kind="label">{approvalLabels[item.status]}</Copy><Copy kind="title">{item.site.name}</Copy>
   <Card><Copy kind="subtitle">{categories[item.intervention.category]}</Copy><Copy kind="label">Montant du devis proposé</Copy><Copy>{euros(item.quote.total_cents)} TTC</Copy><Copy kind="muted">Ce montant décrit le devis soumis à cette approbation. Le total accepté et le règlement sont suivis dans le dossier.</Copy></Card>
   <Copy>Demande du {timestamp(item.created_at)}</Copy>
   {item.decided_at&&<Copy>Décision du {timestamp(item.decided_at)}</Copy>}
   {Boolean(item.note)&&<Card><Copy kind="subtitle">Note de décision</Copy><Copy>{item.note}</Copy></Card>}
   {state.data?.rule&&<Copy kind="muted">Règle du site : {state.data.rule.required_role==='owner'?'propriétaire':'gestionnaire'} requis à partir de {euros(state.data.rule.threshold_cents)}.</Copy>}
   {item.status==='pending'&&!denied&&<Card>
    <Copy kind="subtitle">Votre décision</Copy>
    {conflict&&<Copy kind="muted">La décision n’a pas été acceptée dans cet état. Si un circuit d’approbation avancé est actif sur ce site, utilisez le circuit ci-dessous.</Copy>}
    <Field inputRef={noteRef} label="Commentaire (obligatoire pour refuser, facultatif pour approuver)" value={note} maxLength={2000} multiline editable={!busy} onChangeText={setNote}/>
    <Action label="Approuver" disabled={busy} onPress={()=>ask('approved',euros(item.quote.total_cents),item.site.name)}/>
    <Action secondary label="Refuser" disabled={busy} onPress={()=>ask('rejected',euros(item.quote.total_cents),item.site.name)}/>
    {busy&&<Copy>Enregistrement de la décision…</Copy>}
   </Card>}
   <NativeApprovalWorkflow quoteId={item.quote_id}/>
   <Action label="Consulter le dossier de l’intervention" onPress={()=>router.push({pathname:'/dossier/[id]',params:{id:item.intervention.id}})}/>
  </>}
 </Screen>;
}
