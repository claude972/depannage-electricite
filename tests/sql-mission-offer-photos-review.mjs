import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { asUser, freshDatabase } from './phase2-lot-a-http-harness.mjs';

const db = await freshDatabase();
try {
  const owner = { id: randomUUID() }, artisan = { id: randomUUID() }, outsider = { id: randomUUID() };
  for (const [actor, role] of [[owner,'client'],[artisan,'artisan'],[outsider,'client']])
    await db.query("insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,$2,$3,now())",
      [actor.id, { role, full_name: 'Recette ' + role }, actor.id + '@example.invalid']);
  await db.query('update public.profiles set artisan_approved=true where id=$1',[artisan.id]);
  await db.query("insert into public.artisan_profiles(user_id,company_name,siret,address,postal_codes,categories,application_status,available) values($1,'Recette','00000000000000','Recette',array['97200'],array['socket'],'approved',true)",[artisan.id]);
  const job = randomUUID();
  await db.query("insert into public.interventions(id,client_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents) values($1,$2,'socket','Description de recette','Adresse privée','97200','Ville QA','scheduled',100,200)",[job,owner.id]);
  const photo = randomUUID(), pdf = randomUUID();
  for (const [id, mime] of [[photo,'image/jpeg'],[pdf,'application/pdf']])
    await db.query('insert into public.documents(id,intervention_id,owner_id,name,path,mime_type) values($1,$2,$3,$4,$5,$6)',[id,job,owner.id,'Fichier privé',owner.id+'/'+id,mime]);
  const read = who => db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query('select public.read_mission_offer_photos($1,$2) v',[job,who.id])).rows[0].v;
  });
  const share = (who, id, shared) => asUser(db,who,'select public.set_mission_offer_photo($1,$2,$3) v',[job,id,shared]);
  const denied = (operation, code) => assert.rejects(operation, error => error.code === code);
  assert.deepEqual(await read(artisan),[]);
  await denied(read(outsider),'P0002');
  await denied(share(outsider,photo,true),'42501');
  await denied(share(owner,pdf,true),'42501');
  await denied(asUser(db,artisan,'select public.read_mission_offer_photos($1,$2) v',[job,artisan.id]),'42501');
  assert.equal(await share(owner,photo,true),true);
  assert.deepEqual(await read(artisan),[{id:photo,path:owner.id+'/'+photo}]);
  assert.equal(await asUser(db,artisan,'select count(*)::int v from public.documents where id=$1',[photo]),0);
  assert.equal(await share(owner,photo,false),false);
  assert.deepEqual(await read(artisan),[]);
  assert.equal(await share(owner,photo,true),true);
  await db.query("update public.interventions set updated_at=updated_at + interval '1 second' where id=$1",[job]);
  assert.deepEqual(await read(artisan),[]);
  assert.equal(await share(owner,photo,true),true);
  await db.query("update public.interventions set artisan_id=$2,status='assigned' where id=$1",[job,artisan.id]);
  await denied(read(artisan),'P0002');
  await denied(share(owner,photo,true),'P0001');
  console.log('PASS consent, wrong actor, private storage, revoke, stale version and closed offer');
} finally {
  await db.close();
}
