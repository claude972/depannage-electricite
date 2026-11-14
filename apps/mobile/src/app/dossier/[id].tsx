import { useRef, useState } from 'react';
import { Alert, View, type ScrollViewInstance } from 'react-native';
import { Host, Switch } from '@expo/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { z } from 'zod';
import { Action, BookingProgress, Card, Copy, Field, ReadState, Screen } from '@/components/ui';
import { QuoteEditor } from '@/components/quote-editor';
import { ReportEditor } from '@/components/report-editor';
import { AppointmentEditor } from '@/components/appointment-editor';
import { MissionTracking } from '@/components/mission-tracking';
import { OfferPhotoConsent } from '@/components/offer-photos';
import { PaymentReturnStatus } from '@/components/payment-return-status';
import { deviceDrafts } from '@/lib/device-drafts';
import { paymentReturnKey } from '@/lib/payment-return';
import { api, useResource } from '@/lib/api';
import { categories, creation, detail, euros, link, operations, signature, success, timestamp } from '@/lib/contracts';
import { dossierAmount, dossierStep, DOSSIER_STEPS, jobStatus, paymentLabel } from '@/lib/job-presentation';
import { useSession } from '@/lib/session';
import { supabaseOrigin } from '@/lib/config';
import { quoteDraftKey, reportDraftKey } from '@/lib/draft-store';
import { orderReference } from '../../../../../shared/order-reference';

const uuid=z.uuid();
const bookingOptions=z.object({test_checkout_available:z.boolean().optional()});
export default function Dossier() {
  const params=useLocalSearchParams<{id:string;retourPaiement?:string}>(), router=useRouter();
  const auth=useSession().session;
  const id=uuid.safeParse(params.id).data;
  const token=auth?.access_token, base=id?`/api/interventions/${id}`:null;
  const data=useResource(token?base:null,detail,token,auth?.user.id);
  const ops=useResource(base&&token?base+'/operations':null,operations,token,auth?.user.id);
  const paymentOptions=useResource('/api/bookings/options',bookingOptions);
  const [error,setError]=useState<string|null>(null), [busy,setBusy]=useState(false);
  const [returnEpoch,setReturnEpoch]=useState(0);
  const [ack,setAck]=useState(false), [name,setName]=useState(''), [reason,setReason]=useState('');
  const lock=useRef(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const sections = useRef({ quotes: 0, report: 0, travel: 0 });
  const showSection = (section: keyof typeof sections.current) => scroll.current?.scrollTo({ y: Math.max(0, sections.current[section] - 16), animated: true });
  const job=data.data?.intervention;
  const owner=Boolean(job?.client_id&&job.client_id===auth?.user.id), artisan=Boolean(job?.artisan_id&&job.artisan_id===auth?.user.id);
  const reload=()=>{data.reload();ops.reload();};
  async function run(work:()=>Promise<unknown>, refresh=true) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError(null);
    try{await work();}
    catch(issue){setError(issue instanceof Error?issue.message:'Action indisponible.');}
    finally{lock.current=false;setBusy(false);if(refresh)reload();}
  }
  function action(body:object, onSaved?:()=>Promise<void>) {
    if(!base||!token)return;
    void run(async()=>{
      await api(base+'/actions',creation,{token,method:'POST',body});
      await onSaved?.();
    });
  }
  function operation(body:object) {
    if(!base||!token)return;
    void run(()=>api(base+'/operations',success,{token,method:'POST',body}));
  }
  function confirm(title:string, message:string, work:()=>void) {
    Alert.alert(title,message,[{text:'Revenir',style:'cancel'},{text:'Confirmer',onPress:work}]);
  }
  function pay(quoteId:string){
    if(!token||!auth||!id)return;
    void run(async()=>{
      await deviceDrafts.write(paymentReturnKey(auth.user.id),{dossier:id,quote:quoteId,startedAt:Date.now()});
      const result=await api('/api/payments/checkout',link,{token,method:'POST',body:{quote_id:quoteId,native_test:true}});
      const checkout=new URL(result.url);
      if(checkout.origin!=='https://checkout.stripe.com'||!/(?:^|\/)cs_test_/.test(checkout.pathname)||checkout.username||checkout.password)
        throw Error('L’application de recette accepte uniquement un paiement Stripe de test.');
      await openBrowserAsync(checkout.toString());
      setReturnEpoch(value=>value+1);
    });
  }
  function openDocument(documentId:string){
    if(!token)return;
    void run(async()=>{
      const result=await api('/api/documents?id='+encodeURIComponent(documentId),link,{token});
      const target=new URL(result.url);
      if(target.origin!==supabaseOrigin||!target.pathname.startsWith('/storage/v1/object/sign/'))
        throw Error('Le lien du document est invalide.');
      await openBrowserAsync(target.toString());
    },false);
  }
  const quotes = data.data?.quotes.status === 'ok' ? data.data.quotes.items : undefined;
  const payments = data.data?.payments.status === 'ok' ? data.data.payments.items : undefined;
  const accepted = quotes?.find(quote => quote.status === 'accepted');
  const amount = job ? dossierAmount(job, quotes, payments) : null;
  const role = artisan ? 'artisan' : owner ? 'client' : 'manager';
  const access = owner || artisan ? data.data?.booking_location : null;
  const report=ops.data?.report;
  const receipt=ops.data?.report_receipt;
  if(!id)return <Screen><Copy kind="error">Dossier introuvable.</Copy></Screen>;
  return <Screen scrollRef={scroll} refreshing={data.loading && Boolean(job)} onRefresh={reload}>
    <ReadState loading={data.loading} error={data.error} onRetry={reload}/>
    {error&&<Copy kind="error">{error}</Copy>}
    {job&&<>
      <Copy kind="label">{jobStatus(job.status, role)}</Copy>
      <Copy kind="title">{categories[job.category]}</Copy>
      {owner && <Copy kind="muted" selectable>Numéro de commande · {orderReference(job.id)}</Copy>}
      {dossierStep(job.status) >= 0 && <BookingProgress labels={DOSSIER_STEPS} index={dossierStep(job.status)} />}
      {amount && <Card><Copy kind="label">{artisan && amount.label === 'À régler' ? 'Règlement attendu' : artisan && amount.label === 'Devis reçu' ? 'Devis envoyé' : amount.label}</Copy><Copy kind="subtitle" selectable>{amount.value}</Copy></Card>}
      {['requested','assigned','quoted','accepted','in_progress','completed'].includes(job.status) && <Card>
        <Copy kind="subtitle">Prochaine action</Copy>
        {owner && job.status === 'requested' && <Copy>Votre demande est transmise. Vous serez informé lorsqu’un artisan sera attribué.</Copy>}
        {owner && job.status === 'assigned' && <Copy>L’artisan prépare votre devis. Vous pourrez le relire avant d’accepter les travaux.</Copy>}
        {owner && job.status === 'quoted' && <Action label="Examiner le devis" disabled={!quotes?.length} onPress={() => showSection('quotes')} />}
        {owner && ['accepted','in_progress'].includes(job.status) && <Copy>{job.status === 'accepted' ? 'Votre devis est accepté. Retrouvez le rendez-vous et le suivi ci-dessous.' : 'L’intervention est en cours. Le compte rendu apparaîtra après sa rédaction.'}</Copy>}
        {owner && job.status === 'completed' && <>
          {accepted && paymentOptions.data?.test_checkout_available ? <Action label="Régler sur Stripe en mode test" disabled={busy} onPress={() => pay(accepted.id)} /> : <Copy kind="muted">{paymentOptions.loading ? 'Vérification de la disponibilité du règlement…' : 'Le paiement en ligne n’est pas disponible dans cette version de recette. Aucun règlement n’est confirmé ici ; consultez le suivi sur la plateforme.'}</Copy>}
          {report && !receipt && <Action secondary label="Consulter et signer le compte rendu" onPress={() => showSection('report')} />}
        </>}
        {artisan && job.status === 'assigned' && <Action label="Préparer le devis" onPress={() => showSection('quotes')} />}
        {artisan && job.status === 'quoted' && <Copy>Le devis attend la décision du client. L’accord est nécessaire avant les travaux.</Copy>}
        {artisan && job.status === 'accepted' && <Action label="Préparer l’intervention" onPress={() => showSection('travel')} />}
        {artisan && job.status === 'in_progress' && <Action label="Compléter le compte rendu" onPress={() => showSection('report')} />}
        {artisan && job.status === 'completed' && <Copy>L’intervention est terminée. Le règlement du client reste à confirmer par la plateforme ; ce statut ne prouve pas un versement à l’artisan.</Copy>}
        {!owner && !artisan && <Copy>Consultez les informations autorisées du dossier ci-dessous.</Copy>}
      </Card>}
      {owner && accepted && token && auth && <PaymentReturnStatus key={accepted.id+':'+returnEpoch} id={id} actor={auth.user.id} token={token} quote={accepted.id} fromLink={params.retourPaiement==='1'} onPaid={reload} />}
      <Copy kind="subtitle">Détails de l’intervention</Copy>
      <Copy>{job.description}</Copy>
      <Copy kind="muted">Estimation initiale indicative · {euros(job.estimate_min_cents)} à {euros(job.estimate_max_cents)}</Copy>
      <Copy kind="muted">{[job.address,job.postal_code,job.city].filter(Boolean).join(', ')}</Copy>
      {access && (access.access_details || access.latitude !== null) && <Card>
        <Copy kind="subtitle">Accès à l’intervention</Copy>
        {access.access_details && <Copy selectable>{access.access_details}</Copy>}
        {access.latitude !== null && access.longitude !== null &&
          <Copy kind="muted" selectable>Repère GPS · {access.latitude.toFixed(6)}, {access.longitude.toFixed(6)}</Copy>}
      </Card>}
      <Action secondary label="Ouvrir la conversation" onPress={()=>router.push({pathname:'/dossier/messages',params:{id}})}/>
      {owner&&['requested','assigned','quoted'].includes(job.status)&&
        <Action secondary label="Annuler ma demande" disabled={busy} onPress={()=>confirm('Annuler la demande ?', 'Le serveur vérifiera que le dossier peut être annulé.',()=>action({action:'cancel'}))}/>}

      <ReadState loading={ops.loading} error={ops.error} onRetry={ops.reload}/>
      {artisan && ops.data && ['assigned','quoted','accepted'].includes(job.status) ? <AppointmentEditor current={ops.data.appointment} busy={busy} save={operation} /> : ops.data?.appointment&&<Card><Copy kind="subtitle">Rendez-vous</Copy><Copy>{timestamp(ops.data.appointment.starts_at)} – {timestamp(ops.data.appointment.ends_at)}</Copy></Card>}
      <View onLayout={event => { sections.current.quotes = event.nativeEvent.layout.y; }} style={{gap:16}}>
      {artisan&&auth&&job.status==='assigned'&&<QuoteEditor key={quoteDraftKey(auth.user.id,id)} draftKey={quoteDraftKey(auth.user.id,id)} busy={busy} onSend={(lines,tax_rate,onSaved)=>confirm('Envoyer le devis ?', 'Le client pourra examiner le devis et décider avant les travaux.',()=>action({action:'send_quote',lines,tax_rate},onSaved))}/>}
      {data.data?.quotes.status==='error'&&<Copy kind="error">Les devis n’ont pas pu être chargés.</Copy>}
      {data.data?.quotes.status==='ok'&&data.data.quotes.items.map(quote=><Card key={quote.id}>
        <Copy kind="subtitle">Devis {quote.status==='accepted'?'accepté':quote.status==='rejected'?'refusé':'proposé'}</Copy>
        {quote.lines.map((line,index)=><Copy key={index}>{line.quantity} × {line.label} · {euros(line.unit_price_cents)} HT</Copy>)}
        <Copy>{quote.status === 'accepted' && quote.accepted_total_cents === undefined ? 'Montant accepté à vérifier — actualisez le dossier.' : `Total TTC ${euros(quote.status === 'accepted' ? quote.accepted_total_cents! : quote.total_cents)}`}</Copy>
        {owner&&quote.status==='sent'&&job.status==='quoted'&&<>
          <Action label="Accepter ce devis" disabled={busy} onPress={()=>confirm('Accepter ce devis ?', `Le montant total est de ${euros(quote.total_cents)} TTC.`,()=>action({action:'accept_quote',quote_id:quote.id}))}/>
          <Field label="Motif si vous refusez" value={reason} onChangeText={setReason} maxLength={2000}/>
          <Action secondary label="Refuser ce devis" disabled={busy||!reason.trim()} onPress={()=>confirm('Refuser ce devis ?', 'Le motif sera transmis à l’artisan.',()=>operation({action:'reject_quote',quote_id:quote.id,reason:reason.trim()}))}/>
        </>}
      </Card>)}
      </View>
      {(artisan || owner) && token && auth && ['assigned','quoted','accepted','in_progress'].includes(job.status) && <MissionTracking key={auth.user.id+id} id={id} actor={auth.user.id} token={token} artisan={artisan} address={[job.address,job.postal_code,job.city].filter(Boolean).join(' ')} />}
      <View onLayout={event => { sections.current.travel = event.nativeEvent.layout.y; }} style={{gap:16}}>
      {artisan&&job.status==='accepted'&&<Card>
        <Copy kind="subtitle">Déplacement</Copy>
        <Action secondary label="Signaler mon départ" disabled={busy||ops.data?.travel_stage==='en_route'} onPress={()=>operation({action:'set_travel_stage',stage:'en_route'})}/>
        <Action secondary label="Signaler mon arrivée" disabled={busy||ops.data?.travel_stage==='on_site'} onPress={()=>operation({action:'set_travel_stage',stage:'on_site'})}/>
        <Action label="Démarrer l’intervention" disabled={busy} onPress={()=>confirm('Démarrer ?', 'Le dossier passera au statut en cours.',()=>action({action:'start'}))}/>
      </Card>}
      </View>
      <View onLayout={event => { sections.current.report = event.nativeEvent.layout.y; }} style={{gap:16}}>
      {artisan&&auth&&job.status==='in_progress'&&token&&ops.data&&<>
        <ReportEditor key={reportDraftKey(auth.user.id,id)} draftKey={reportDraftKey(auth.user.id,id)} token={token} id={id} report={report??null} required={ops.data.report_evidence_required} onSaved={reload}/>
        <Action label="Clôturer l’intervention" disabled={busy||!report} onPress={()=>confirm('Clôturer l’intervention ?', 'Vérifiez le compte rendu et ses pièces jointes.',()=>action({action:'complete'}))}/>
      </>}
      {report&&<Card>
        <Copy kind="subtitle">Compte rendu enregistré</Copy><Copy>{report.summary}</Copy><Copy kind="muted">{report.signature_name}</Copy>
        {receipt&&<Copy>Remis et signé par {receipt.signature_name} le {timestamp(receipt.signed_at)}.</Copy>}
        {owner&&['completed','paid'].includes(job.status)&&report.report_revision&&!receipt&&<>
          <Host matchContents><Switch label="J’accuse réception du compte rendu" value={ack} onValueChange={setAck}/></Host>
          <Field label="Vos nom et prénom" value={name} onChangeText={setName} maxLength={120}/>
          <Action label="Signer le compte rendu" disabled={busy||!ack||!signature.safeParse(name).success} onPress={()=>operation({action:'sign_report',acknowledged:true,signature_name:name.trim(),report_revision:report.report_revision})}/>
        </>}
      </Card>}
      </View>
      {owner && job.status==='requested' && token && data.data?.documents.status==='ok' && <OfferPhotoConsent id={id} token={token} documents={data.data.documents.items} onUploaded={data.reload} />}
      {data.data?.documents.status==='ok'&&data.data.documents.items.length>0&&<Card><Copy kind="subtitle">Pièces du dossier</Copy>
        {data.data.documents.items.map(item=><Action key={item.id} label={item.name} disabled={busy} secondary onPress={()=>openDocument(item.id)}/>)}
      </Card>}
      {data.data?.payments.status === 'ok' && (data.data.payments.limited || data.data.payments.incomplete) && <Copy kind="muted">L’historique des règlements est partiel. Vérifiez le suivi du règlement avant toute nouvelle tentative.</Copy>}
      {data.data?.quotes.status === 'ok' && data.data.quotes.limited && <Copy kind="muted">Les devis affichés sont limités aux plus récents.</Copy>}
      {data.data?.payments.status === 'error' && <Copy kind="error">Les règlements n’ont pas pu être chargés. Actualisez le dossier pour vérifier leur état.</Copy>}
      {data.data?.documents.status === 'error' && <Copy kind="error">Les pièces du dossier n’ont pas pu être chargées.</Copy>}
      {data.data?.payments.status==='ok'&&data.data.payments.items.map(item=><Copy key={item.id} kind="muted">
        {paymentLabel(item)} · {euros(item.total_cents)}{item.paid_at ? ` · ${timestamp(item.paid_at)}` : ''}
      </Copy>)}
    </>}
  </Screen>;
}
