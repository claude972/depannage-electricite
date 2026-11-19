import test from "node:test";
import assert from "node:assert/strict";
import { reconcileCheckoutLink, reconcileObservedCheckoutEvent, reconcileFinancialCheckoutEvent } from "../lib/features/stripe-reconciliation/checkout-link";

const checkoutId="00000000-0000-4000-8000-000000000001", paymentId="00000000-0000-4000-8000-000000000002", quoteId="00000000-0000-4000-8000-000000000003";
function fixture() {
  const context:any={checkout_id:checkoutId,payment_id:paymentId,quote_id:quoteId,intervention_id:"00000000-0000-4000-8000-000000000004",session_id:"cs_test_QA",amount_cents:13020,fee_cents:2213,account_id:"acct_QA",currency:"eur",checkout_status:"paid",payment_status:"paid",payment_session_id:"cs_test_QA",payment_total_cents:13020,payment_method:"stripe",link_state:null};
  const metadata={platform_checkout_id:checkoutId,quote_id:quoteId};
  const objects:any={
    session:{object:"checkout.session",id:"cs_test_QA",livemode:false,mode:"payment",status:"complete",payment_status:"paid",currency:"eur",amount_total:13020,client_reference_id:quoteId,metadata,payment_intent:"pi_QA"},
    intent:{object:"payment_intent",id:"pi_QA",livemode:false,status:"succeeded",currency:"eur",amount:13020,amount_received:13020,application_fee_amount:2213,transfer_data:{destination:"acct_QA"},metadata,latest_charge:"ch_QA"},
    charge:{object:"charge",id:"ch_QA",livemode:false,payment_intent:"pi_QA",paid:true,captured:true,status:"succeeded",currency:"eur",amount:13020,amount_captured:13020,amount_refunded:0,refunded:false,application_fee_amount:2213,transfer_data:{destination:"acct_QA"},metadata,transfer:"tr_QA",application_fee:"fee_QA"},
    transfer:{object:"transfer",id:"tr_QA",livemode:false,amount:13020,currency:"eur",destination:"acct_QA",source_transaction:"ch_QA",reversed:false,amount_reversed:0,destination_payment:"py_QA"},
    fee:{object:"application_fee",id:"fee_QA",livemode:false,amount:2213,currency:"eur",account:"acct_QA",originating_transaction:"ch_QA",charge:"py_QA",amount_refunded:0,refunded:false},
  };
  const calls:string[]=[],writes:any[]=[];
  let bound=false;
  const db:any={rpc:async(name:string,args:any)=>{
    calls.push(name);
    if(name==='stripe_checkout_link_context')return{data:args.p_charge&&!bound?null:context,error:null};
    if(name==='record_stripe_checkout_link'){
      writes.push(args);bound=true;
      const r=args.p_refs;
      const review=(r.transfer?.amount_reversed??0)>0||(r.fee?.amount_refunded??0)>0;
      return{data:{payment_id:paymentId,state:!r.transfer||(context.fee_cents>0&&!r.fee)?'awaiting_provider':review?'needs_review':'linked',review_reason:review?'fee_refunded':null,commission:writes.length>1?'existing':'recorded',rematched:[]},error:null};
    }
    throw Error(name);
  }};
  const read=(kind:string)=>({retrieve:async(id:string)=>{calls.push(kind+':'+id);return objects[kind]}});
  const stripe:any={checkout:{sessions:read('session')},paymentIntents:read('intent'),charges:read('charge'),transfers:read('transfer'),applicationFees:read('fee')};
  return{context,objects,db,stripe,calls,writes};
}

test('Checkout: reads exact provider chain and books the frozen fee; replay still executes transaction',async()=>{
  const f=fixture();let reauthorized=0;
  const result=await reconcileCheckoutLink(f.db,f.stripe,false,{checkoutId},'actor',async()=>{reauthorized++});
  assert.equal(result?.state,'linked');assert.equal(reauthorized,1);
  assert.equal(f.writes[0].p_refs.fee_cents,2213);
  assert.equal(f.writes[0].p_refs.transfer.amount,13020);
  assert.equal(f.writes[0].p_refs.fee.connected_charge,'py_QA');
  assert.equal((await reconcileCheckoutLink(f.db,f.stripe,false,{paymentId}))?.commission,'existing');
  assert.equal(f.writes.length,2);
});

test('Checkout: refuses inconsistent provider references, capture, status, account, mode, currency and amounts',async()=>{
  const cases:Array<[string,string,unknown]>=[
    ['session','payment_status','unpaid'],['session','client_reference_id','wrong'],['session','amount_total',13021],['session','livemode',true],
    ['intent','amount_received',13019],['intent','application_fee_amount',2000],['intent','status','processing'],['intent','currency','usd'],
    ['charge','payment_intent','pi_OTHER'],['charge','captured',false],['charge','paid',false],['charge','amount_captured',13019],
    ['charge','amount_refunded',1],['charge','refunded',true],['charge','livemode',true],
    ['transfer','source_transaction','ch_OTHER'],['transfer','destination','acct_OTHER'],['transfer','amount',10807],['transfer','currency','usd'],['transfer','livemode',true],
    ['fee','account','acct_OTHER'],['fee','originating_transaction','ch_OTHER'],['fee','charge','py_OTHER'],['fee','amount',2214],['fee','currency','usd'],['fee','livemode',true],['fee','amount_refunded',null],
  ];
  for(const[k,key,value]of cases){const f=fixture();f.objects[k][key]=value;await assert.rejects(reconcileCheckoutLink(f.db,f.stripe,false,{checkoutId}),`${k}.${key}`);assert.equal(f.writes.length,0);}
});

test('Checkout: pending local confirmation is retryable; metadata cannot rescue a different local chain',async()=>{
  const f=fixture();f.context.payment_status='pending';await assert.rejects(reconcileCheckoutLink(f.db,f.stripe,false,{checkoutId}));assert.equal(f.writes.length,0);
  const g=fixture();g.objects.intent.metadata={quote_id:quoteId,platform_checkout_id:'00000000-0000-4000-8000-000000000099'};
  await assert.rejects(reconcileCheckoutLink(g.db,g.stripe,false,{chargeId:'ch_QA'}));assert.equal(g.writes.length,0);
});

test('Checkout: incomplete provider objects are persisted but trigger retries, including later success',async()=>{
  const f=fixture();f.objects.charge.application_fee=null;
  await assert.rejects(reconcileCheckoutLink(f.db,f.stripe,false,{checkoutId}));assert.equal(f.writes.length,1);assert.equal(f.writes[0].p_refs.fee,null);
  f.objects.charge.application_fee='fee_QA';assert.equal((await reconcileCheckoutLink(f.db,f.stripe,false,{checkoutId}))?.state,'linked');assert.equal(f.writes.length,2);
});

test('Checkout: no-commission frozen snapshot needs no Fee object',async()=>{
  const f=fixture();f.context.fee_cents=0;f.objects.intent.application_fee_amount=0;f.objects.charge.application_fee_amount=0;f.objects.charge.application_fee=null;
  assert.equal((await reconcileCheckoutLink(f.db,f.stripe,false,{checkoutId}))?.state,'linked');assert.equal(f.writes[0].p_refs.fee,null);
});

test('Checkout: operator authorization is rechecked after reads and before recording',async()=>{
  const f=fixture();await assert.rejects(reconcileCheckoutLink(f.db,f.stripe,false,{checkoutId},'actor',async()=>{throw Error('revoked')}));assert.equal(f.writes.length,0);
});

const observation=(family='transfer')=>({family,type:family==='transfer'?'transfer.created':'application_fee.created',livemode:false,source_account:null,object:{id:family==='transfer'?'tr_QA':'fee_QA'}});
test('Financial arrival before link: retrieves source charge and validates the full Checkout chain',async()=>{
  for(const family of ['transfer','fee']){const f=fixture();assert.equal((await reconcileObservedCheckoutEvent(observation(family),f.db,f.stripe,false))?.state,'linked');assert.equal(f.writes.length,1);}
});
test('Connected and unrelated events do not create a Checkout binding; unrecognized metadata is not evidence',async()=>{
  const f=fixture();assert.equal(await reconcileObservedCheckoutEvent({...observation(),source_account:'acct_QA'},f.db,f.stripe,false),null);assert.equal(f.calls.length,0);
  f.objects.charge.metadata={};assert.equal(await reconcileObservedCheckoutEvent(observation(),f.db,f.stripe,false),null);assert.equal(f.writes.length,0);
});
test('Replayed financial delivery still retries reconciliation and never uses financial mutation APIs',async()=>{
  const f=fixture();const event:any={type:'application_fee.created',livemode:false,data:{object:{id:'fee_QA'}}};
  await reconcileFinancialCheckoutEvent(event,f.db,f.stripe,false);await reconcileFinancialCheckoutEvent(event,f.db,f.stripe,false);
  assert.equal(f.writes.length,2);assert.ok(f.calls.filter(x=>x==='fee:fee_QA').length>=2);
});
test('Current reversal/refund is carried to the SQL decision, without forging a successful match',async()=>{
  const f=fixture();f.objects.fee.amount_refunded=100;assert.equal((await reconcileCheckoutLink(f.db,f.stripe,false,{checkoutId}))?.state,'needs_review');assert.equal(f.writes[0].p_refs.fee.amount_refunded,100);
});
