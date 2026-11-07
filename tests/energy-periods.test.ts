import test from "node:test";
import assert from "node:assert/strict";
import { energyCommand, energyDate, energyPage, energyRecord, energyValues, kwhToWh } from "../lib/features/energy/schemas";
const id="10000000-0000-4000-8000-000000000001", site="10000000-0000-4000-8000-000000000002";
const values={meter_label:"Compteur A",period_start:"2026-01-01",period_end:"2026-01-31",consumption_wh:1250500,cost_cents:40000,source_kind:"invoice" as const,source_reference:"Facture de démonstration",note:""};
const row=()=>energyRecord.parse({...values,id,site_id:site,version:1,created_by:id,updated_by:id,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z",archived_at:null});
test("energy periods require real calendar dates, ordered periods, bounded integer quantities and a source",()=>{
 assert.equal(energyDate.safeParse("2026-02-30").success,false);
 assert.equal(energyValues.safeParse({...values,period_end:"2025-12-31"}).success,false);
 for(const consumption_wh of [-1,1.1,NaN,Infinity,9_000_000_000_001])assert.equal(energyValues.safeParse({...values,consumption_wh}).success,false);
 assert.equal(energyValues.safeParse({...values,source_reference:"  "}).success,false);
 assert.equal(energyValues.safeParse({...values,cost_cents:null}).success,true);
 assert.equal(energyValues.safeParse({...values,certified:true}).success,false);
});
test("decimal kWh conversion is exact, locale-aware and never rounds malformed input to zero",()=>{
 assert.equal(kwhToWh("1250,5"),1250500);assert.equal(kwhToWh("0.001"),1);assert.equal(kwhToWh("0"),0);
 for(const v of ["","-1","0.0001","1e3","Infinity","1,2.3","1 000","9999999999"])assert.equal(kwhToWh(v),null,v);
});
test("energy commands preserve optimistic version and stable client-generated ID, with strict payload",()=>{
 assert.equal(energyCommand.safeParse({action:"save",id,expected_version:null,values}).success,true);
 assert.equal(energyCommand.safeParse({action:"archive",id,expected_version:1}).success,true);
 for(const v of [null,0,-1,2147483647])assert.equal(energyCommand.safeParse({action:"archive",id,expected_version:v}).success,false);
 assert.equal(energyCommand.safeParse({action:"save",id,expected_version:null,values,site_id:site}).success,false);
});
test("missing costs and partial pages never become misleading zero or exhaustive totals",()=>{
 const r=row();assert.deepEqual(energyPage([r],false,null,true).totals,{consumption_wh:1250500,cost_cents:40000,complete:true,cost_complete:true});
 const absent={...r,cost_cents:null};const emptyCost=energyPage([absent],false,null,false);
 assert.equal(emptyCost.totals.cost_cents,null);assert.equal(emptyCost.totals.consumption_wh,1250500);assert.equal(emptyCost.totals.cost_complete,false);
 assert.equal(energyPage([r],true,"next",true).totals.consumption_wh,null);
 assert.equal(energyPage([r],true,"next",true).totals.cost_cents,null);
 assert.equal(energyPage([],false,null,false).totals.consumption_wh,0);
});
