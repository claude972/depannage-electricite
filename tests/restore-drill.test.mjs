import assert from 'node:assert/strict';
import {test} from 'node:test';
import {installFixture} from '../scripts/restore-drill/fixture.mjs';
import {capture,restoreVerified,validateManifest} from '../scripts/restore-drill/verification.mjs';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');

test('real synthetic archive restore preserves lifecycle, replay and current RLS',async()=>{
 const source=new PGlite();let restored;
 const owner='10000000-0000-4000-8000-000000000001',foreign='10000000-0000-4000-8000-000000000002',command='10000000-0000-4000-8000-000000000003';
 const one=async(db,sql,args=[]) => (await db.query(sql,args)).rows[0].v;
 const as=async(db,id)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated')};
 try{
  const migrations=await installFixture(source);
  for(const id of [owner,foreign])await source.query("insert into auth.users(id,raw_user_meta_data)values($1,'{\"full_name\":\"QA synthetic restore\"}')",[id]);
  await as(source,owner);
  const original=await one(source,'select public.create_data_erasure_request($1)v',[command]);
  assert.equal(original.request.execution_state,'not_started');
  await source.exec('reset role');
  const bundle=await capture(source,migrations);
  assert.ok(bundle.manifest.tables>50);assert.ok(bundle.manifest.rows>0);
  // Corrupt archives/manifests fail before instantiating any database.
  let opened=0;class Forbidden{constructor(){opened++;throw Error('must not open')}}
  for(const manifest of [{...bundle.manifest,extra:true},{...bundle.manifest,rows:'1'},{...bundle.manifest,scope:'production'},{...bundle.manifest,archive_sha256:'0'.repeat(64)},{...bundle.manifest,migrations_sha256:'0'.repeat(64)}])await assert.rejects(restoreVerified(Forbidden,{...bundle,manifest},migrations));
  const corrupt=bundle.archive.slice();corrupt[100]^=1;
  assert.throws(()=>validateManifest(bundle.manifest,corrupt,migrations));assert.equal(opened,0);
  // A syntactically valid but incorrect expected data digest fails after actual reopen.
  await assert.rejects(restoreVerified(PGlite,{...bundle,manifest:{...bundle.manifest,data_sha256:'0'.repeat(64)}},migrations),/Restored database mismatch/);
  restored=await restoreVerified(PGlite,bundle,migrations);
  await as(restored,owner);
  const replay=await one(restored,'select public.create_data_erasure_request($1)v',[command]);
  assert.equal(replay.replayed,true);assert.deepEqual(replay.request,original.request);assert.equal(replay.ticket_id,original.ticket_id);
  assert.equal(await one(restored,'select count(*)::integer v from public.support_tickets where id=$1',[original.ticket_id]),1);
  const next=await one(restored,'select public.create_data_erasure_request($1)v',['10000000-0000-4000-8000-000000000004']);
  assert.equal(next.replayed,false);assert.notEqual(next.request.id,original.request.id);assert.equal(next.request.execution_state,'not_started');
  await as(restored,foreign);
  assert.equal(await one(restored,'select count(*)::integer v from public.support_tickets where id=$1',[original.ticket_id]),0);
  await assert.rejects(restored.query('select * from data_request_private.requests'),e=>e.code==='42501');
  assert.equal((await one(restored,'select public.list_data_erasure_requests(false,null,25)v')).rows.length,0);
  console.log(JSON.stringify({scope:'synthetic-local-only',restored:true,manifest:bundle.manifest,provider_backup_verified:false,storage_files_verified:false}));
 }finally{await source.close();if(restored)await restored.close()}
});
