import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichAcceptedTotals, AcceptedTotalsUnavailable } from "../lib/features/workspace/accepted-totals";
import { routeHarness, quote, id, stamp } from "./detail-read-fixtures";
const accepted=quote(1,{status:"accepted",accepted_at:stamp,total_cents:12000});
const total={quote_id:accepted.id,accepted_total_cents:15000};
test("helper preserves base and enriches accepted only, including empty no-RPC case",async()=>{
 const calls:unknown[]=[];const db={rpc:async(...args:unknown[])=>{calls.push(args);return{data:[total],error:null}}} as unknown as SupabaseClient;
 assert.deepEqual(await enrichAcceptedTotals(db,[]),[]);assert.equal(calls.length,0);
 const out=await enrichAcceptedTotals(db,[accepted,quote(2,{accepted_total_cents:999})]);assert.equal(out[0].total_cents,12000);assert.equal(out[0].accepted_total_cents,15000);assert.equal(Object.hasOwn(out[1],"accepted_total_cents"),false);assert.deepEqual(calls,[["accepted_quote_totals",{p_quote_ids:[accepted.id]}]]);
});
test("missing/extra/duplicate/unsafe/malformed/provider failures never fall back to base",async()=>{
 for(const data of [null,{},[],[total,total],[{...total,quote_id:id(999)}],[{...total,accepted_total_cents:0}],[{...total,accepted_total_cents:11999}],[{...total,accepted_total_cents:"15000"}],[{...total,accepted_total_cents:Number.MAX_SAFE_INTEGER+1}],[{...total,secret:"no"}]])await assert.rejects(()=>enrichAcceptedTotals({rpc:async()=>({data,error:null})} as unknown as SupabaseClient,[accepted]),AcceptedTotalsUnavailable);
 for(const rpc of [async()=>({data:[total],error:{code:"42501"}}),async()=>{throw Error("private") }])await assert.rejects(()=>enrichAcceptedTotals({rpc} as unknown as SupabaseClient,[accepted]),AcceptedTotalsUnavailable);
 await assert.rejects(()=>enrichAcceptedTotals({} as SupabaseClient,[accepted,accepted]),AcceptedTotalsUnavailable);
});
test("actual workspace and point routes enrich with user-scoped RPC and fail503 on incomplete proof",async()=>{
 for(const route of ["workspace","detail"] as const){
  for(const bad of [false,true]){
   const h=routeHarness(route,{rows:{quotes:[accepted,quote(2)]},intercept:c=>c.table==="accepted_quote_totals"?Response.json(bad?[]:[total]):undefined});
   const r=await h.get();assert.equal(r.status,bad?503:200);assert.equal(r.headers.get("cache-control"),"private, no-store");
   if(bad){assert.equal(r.headers.get("retry-after"),"2");continue}
   const b=await r.json();const rows=route==="detail"?b.quotes.items:b.quotes;const q=rows.find((x:{id:string})=>x.id===accepted.id);assert.equal(q.total_cents,12000);assert.equal(q.accepted_total_cents,15000);assert.equal(h.calls.filter(c=>c.table==="accepted_quote_totals").length,1);
  }
 }
});
