// R-SRV-16 — deleting a request photo races a mission acceptance. Real migrations in isolated
// PGlite (one connection: interleavings are replayed step by step, both orders; the shared row
// lock is checked on the tuple and in the source). Not a live Supabase claim.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { asUser, freshDatabase } from './phase2-lot-a-http-harness.mjs';

const db = await freshDatabase();
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
const denied = async (operation, code, message) => { await assert.rejects(operation, e => e.code === code, message); checks++; };
try {
  const owner = { id: randomUUID() }, artisan = { id: randomUUID() }, rival = { id: randomUUID() }, outsider = { id: randomUUID() };
  for (const [actor, role] of [[owner, 'client'], [artisan, 'artisan'], [rival, 'artisan'], [outsider, 'client']])
    await db.query("insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at) values($1,$2,$3,now())",
      [actor.id, { role, full_name: 'Recette ' + role }, actor.id + '@example.invalid']);
  for (const a of [artisan, rival]) {
    await db.query('update public.profiles set artisan_approved=true where id=$1', [a.id]);
    await db.query("insert into public.artisan_profiles(user_id,company_name,siret,address,postal_codes,categories,application_status,available) values($1,'Recette','00000000000000','Recette',array['97200'],array['socket'],'approved',true)", [a.id]);
  }
  async function dossier() {
    const job = randomUUID(), photo = randomUUID();
    await db.query("insert into public.interventions(id,client_id,category,description,address,postal_code,city,urgency,estimate_min_cents,estimate_max_cents) values($1,$2,'socket','Description de recette','Adresse privée','97200','Ville QA','scheduled',100,200)", [job, owner.id]);
    await db.query("insert into public.documents(id,intervention_id,owner_id,name,path,mime_type) values($1,$2,$3,'Photo privée',$4,'image/jpeg')", [photo, job, owner.id, owner.id + '/' + photo]);
    return { job, photo };
  }
  const accept = (who, job) => asUser(db, who, "select (public.intervention_action($1,'accept_mission')).status v", [job]);
  const remove = (who, photo) => asUser(db, who, 'select public.delete_request_photo($1) v', [photo]);
  const exists = async (photo) => (await db.query('select count(*)::int n from public.documents where id=$1', [photo])).rows[0].n === 1;
  const state = async (job) => (await db.query('select status,artisan_id from public.interventions where id=$1', [job])).rows[0];

  // ---- 1. Reproduction of the route sequence before the fix (app/api/documents/route.ts DELETE):
  // withdraw the offer, read the dossier, then delete with the service role. An acceptance that lands
  // between the read and the delete is not seen: the assigned artisan loses the photo.
  {
    const { job, photo } = await dossier();
    eq(await asUser(db, owner, 'select public.set_mission_offer_photo($1,$2,false) v', [job, photo]), false, 'retrait de l’offre');
    eq((await state(job)).status, 'requested', 'lecture de la route : demande encore ouverte');
    eq(await accept(artisan, job), 'assigned', 'acceptation pendant la fenêtre');
    const removed = await db.transaction(async tx => { await tx.exec('set local role service_role'); return (await tx.query('delete from public.documents where id=$1 and owner_id=$2 and intervention_id=$3 returning id', [photo, owner.id, job])).rows; });
    eq(removed.length, 1, 'DÉFAUT reproduit : l’ancien chemin efface une photo d’un dossier déjà attribué');
    console.log(`REPRODUCED: old route sequence deleted the photo of a dossier already assigned (status ${(await state(job)).status})`);
  }

  // ---- 2. Atomic command, deletion first: the photo goes, the acceptance then proceeds normally.
  {
    const { job, photo } = await dossier();
    await asUser(db, owner, 'select public.set_mission_offer_photo($1,$2,true) v', [job, photo]);
    const result = await remove(owner, photo);
    eq([result.deleted, result.path], [true, owner.id + '/' + photo], 'suppression atomique : chemin renvoyé pour le nettoyage du fichier');
    eq(await exists(photo), false, 'ligne supprimée');
    eq((await db.query('select count(*)::int n from public.mission_offer_photo_consent where document_id=$1', [photo])).rows[0].n, 0, 'consentement retiré avec la photo');
    eq(await accept(artisan, job), 'assigned', 'acceptation ensuite possible');
    eq((await db.query('select count(*)::int n from public.audit_log where intervention_id=$1 and action=$2', [job, 'request_photo_deleted'])).rows[0].n, 1, 'trace de la suppression dans la même transaction');
  }

  // ---- 3. Acceptance first: the command sees the assignment under the same row lock and refuses.
  {
    const { job, photo } = await dossier();
    eq(await accept(artisan, job), 'assigned', 'acceptation d’abord');
    await denied(remove(owner, photo), 'P0001', 'offre fermée : suppression refusée');
    ok(await exists(photo), 'la photo reste au dossier attribué');
    eq(await state(job), { status: 'assigned', artisan_id: artisan.id }, 'attribution inchangée');
  }

  // ---- 4. Same transaction boundary as an acceptance: the command holds the dossier row lock
  // until commit (xmax is the deleting transaction), so a concurrent acceptance waits, then sees
  // a dossier without the photo; the reverse order is section 3.
  {
    const { job, photo } = await dossier();
    const held = await db.transaction(async tx => {
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner.id]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: owner.id, role: 'authenticated', aal: 'aal2' })]);
      await tx.query('select public.delete_request_photo($1)', [photo]);
      await tx.exec('reset role');
      return (await tx.query('select (i.xmax::text = txid_current()::text) locked from public.interventions i where id=$1', [job])).rows[0].locked;
    });
    ok(held, 'ligne du dossier verrouillée par la transaction de suppression');
    eq(await accept(rival, job), 'assigned', 'l’acceptation suivante aboutit sur un dossier cohérent');
    eq(await exists(photo), false, 'aucune photo fantôme');
  }

  // ---- 5. Refusals: other client, artisan, unknown or non-photo document, anonymous; nothing deleted.
  {
    const { job, photo } = await dossier();
    const pdf = randomUUID();
    await db.query("insert into public.documents(id,intervention_id,owner_id,name,path,mime_type) values($1,$2,$3,'Devis privé',$4,'application/pdf')", [pdf, job, owner.id, owner.id + '/' + pdf]);
    await denied(remove(outsider, photo), '42501', 'autre client');
    await denied(remove(artisan, photo), '42501', 'artisan');
    await denied(remove(owner, randomUUID()), '42501', 'document inconnu');
    await denied(remove(owner, pdf), '42501', 'document qui n’est pas une photo de demande');
    await denied(db.transaction(async tx => { await tx.exec('set local role anon'); return tx.query('select public.delete_request_photo($1)', [photo]); }), '42501', 'anonyme');
    ok(await exists(photo) && await exists(pdf), 'rien n’a été supprimé');
    // A cancelled request is closed too.
    await db.query("update public.interventions set status='cancelled' where id=$1", [job]);
    await denied(remove(owner, photo), 'P0001', 'demande annulée');
    ok(await exists(photo), 'photo conservée');
  }

  // ---- 6. Lock order matches the acceptance (organization, then dossier): no deadlock pair.
  {
    const src = (await db.query("select pg_get_functiondef('public.delete_request_photo(uuid)'::regprocedure) d")).rows[0].d;
    const org = src.indexOf('public.lock_intervention_organization'), row = src.indexOf('for update');
    ok(org > 0 && row > org, 'organisation verrouillée avant le dossier, comme l’acceptation');
    ok(/security definer/i.test(src) && /search_path/i.test(src), 'security definer avec search_path fixé');
    const grants = (await db.query("select has_function_privilege('anon','public.delete_request_photo(uuid)','execute') a, has_function_privilege('authenticated','public.delete_request_photo(uuid)','execute') u")).rows[0];
    eq([grants.a, grants.u], [false, true], 'exécutable par un membre connecté seulement');
  }

  console.log(`PASS: request photo deletion is atomic with mission acceptance (${checks} checks, isolated PostgreSQL, not live Supabase)`);
} finally {
  await db.close();
}
