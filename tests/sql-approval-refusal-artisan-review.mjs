// ENT-12 — the artisan is told when the client organisation refuses the quote internally (migration
// 20261122150000), in real isolated SQL (PGlite). Not a live Supabase claim, in-app notification only.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { isolatedMigrationSql } from "./sql-isolated-migrations.mjs";

const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}', email text,
      is_anonymous boolean not null default false, email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
  `);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort()) {
    const migration = await isolatedMigrationSql(db, name, await readFile(new URL(name, dir), "utf8"));
    await db.exec(migration.replace("create extension if not exists pgcrypto;", "-- stub for isolated test"));
  }
  let checks = 0;
  const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0]?.v;
  async function as(actor, role) { await db.exec("reset role"); await q("select set_config('request.jwt.claim.sub',$1,false)", [actor ?? ""]); if (role) await db.exec(`set role ${role}`); }
  const ids = Object.fromEntries(["owner", "artisan", "other"].map((x) => [x, crypto.randomUUID()]));
  for (const [n, id] of Object.entries(ids)) await q("insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())", [id, JSON.stringify({ role: n === "artisan" ? "artisan" : n === "owner" ? "manager" : "client", full_name: "QA" }), n + "@example.invalid"]);
  const org = await one("insert into public.organizations(name,owner_id)values('QA organisation',$1)returning id v", [ids.owner]);
  await q("insert into public.organization_members(organization_id,user_id,role)values($1,$2,'owner')on conflict do nothing", [org, ids.owner]);
  const site = await one("insert into public.sites(organization_id,name,type,address)values($1,'QA site','office','QA adresse du site')returning id v", [org]);
  async function quoted() {
    await as(null, null);
    const job = await one("insert into public.interventions(client_id,artisan_id,site_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)values($1,$2,$3,'panel','QA synthétique','QA adresse','97200','QA','scheduled','quoted',10000,20000)returning id v", [ids.owner, ids.artisan, site]);
    const quote = await one(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{"label":"QA","quantity":1,"unit_price_cents":90000}]',90000,0,0,90000,'sent')returning id v`, [job, ids.artisan]);
    return { job, quote, ref: await one("select public.intervention_reference($1)v", [job]) };
  }
  const inbox = async (user) => { await as(null, null); return q("select kind,title,body,intervention_id,site_id,actor_id,payload from public.notifications where recipient_id=$1 and kind='approval_decided' order by created_at,id", [user]); };

  // ---- 1. Simple circuit: a refusal tells the artisan, without the private note.
  const A = await quoted();
  const approval = await one("insert into public.approvals(quote_id,site_id)values($1,$2)returning id v", [A.quote, site]);
  await as(ids.owner, null);
  await q("update public.approvals set status='rejected',note='Note interne privée',decided_by=$2,decided_at=now() where id=$1", [approval, ids.owner]);
  let artisan = await inbox(ids.artisan);
  eq(artisan.length, 1, "une notification pour l’artisan");
  eq([artisan[0].title, artisan[0].body, artisan[0].intervention_id, artisan[0].site_id, artisan[0].actor_id], ["Devis non approuvé par le client", `L’organisation cliente n’a pas approuvé le devis du dossier ${A.ref}.`, A.job, null, ids.owner], "titre, texte, dossier ; aucun rattachement au site privé");
  eq(artisan[0].payload, { subject: "quote_not_approved", reference: A.ref, quote_id: A.quote }, "données de navigation seulement");
  eq(JSON.stringify(artisan[0]).includes("Note interne"), false, "la note interne n’est jamais transmise");
  eq(await one("select status v from public.quotes where id=$1", [A.quote]), "sent", "l’état du devis n’est pas modifié par la notification");

  // ---- 2. A later edit of the decided row adds nothing.
  await q("update public.approvals set note='Autre note' where id=$1", [approval]);
  eq((await inbox(ids.artisan)).length, 1, "aucun doublon");

  // ---- 3. An internal approval is not announced to the artisan: only the client's acceptance counts.
  const B = await quoted();
  const approved = await one("insert into public.approvals(quote_id,site_id)values($1,$2)returning id v", [B.quote, site]);
  await as(ids.owner, null);
  await q("update public.approvals set status='approved',decided_by=$2,decided_at=now() where id=$1", [approved, ids.owner]);
  eq((await inbox(ids.artisan)).length, 1, "approbation interne : rien pour l’artisan");

  // ---- 4. Advanced circuit: only the final refusal tells the artisan.
  const C = await quoted();
  await as(null, null);
  await q("insert into public.advanced_approval_workflows(quote_id,site_id,version,policy_version,steps,snapshot,state,current_step)values($1,$2,1,1,'[{}]','{}','pending',1)", [C.quote, site]);
  await as(ids.owner, null);
  await q("update public.advanced_approval_workflows set state='changes_requested',version=2 where quote_id=$1", [C.quote]);
  eq((await inbox(ids.artisan)).length, 1, "demande d’information interne : rien pour l’artisan");
  await q("update public.advanced_approval_workflows set state='pending',version=3 where quote_id=$1", [C.quote]);
  await q("update public.advanced_approval_workflows set state='rejected',version=4 where quote_id=$1", [C.quote]);
  artisan = await inbox(ids.artisan);
  eq(artisan.length, 2, "refus du circuit avancé : une notification");
  eq([artisan[1].title, artisan[1].intervention_id, artisan[1].payload], ["Devis non approuvé par le client", C.job, { subject: "quote_not_approved", reference: C.ref, quote_id: C.quote }], "même message, bon dossier");
  await q("update public.advanced_approval_workflows set version=5 where quote_id=$1", [C.quote]);
  eq((await inbox(ids.artisan)).length, 2, "aucun doublon");

  // ---- 5. A muted kind is respected; a third party reads nothing.
  await as(null, null);
  await q("insert into public.notification_preferences(user_id,muted_kinds)values($1,array['approval_decided'])", [ids.artisan]);
  const D = await quoted();
  const muted = await one("insert into public.approvals(quote_id,site_id)values($1,$2)returning id v", [D.quote, site]);
  await as(ids.owner, null);
  await q("update public.approvals set status='rejected',decided_by=$2,decided_at=now() where id=$1", [muted, ids.owner]);
  eq((await inbox(ids.artisan)).length, 2, "type coupé par l’artisan : aucune notification ajoutée");
  await as(ids.other, "authenticated");
  eq((await q("select id from public.notifications")).length, 0, "un tiers ne lit aucune notification");
  await as(ids.artisan, "authenticated");
  eq((await q("select id from public.notifications where kind='approval_decided'")).length, 2, "l’artisan lit les siennes sous RLS");
  await as(null, null);

  console.log(`PASS: an internal refusal of the quote notifies the artisan once, without private content (${checks} checks, isolated PostgreSQL, not live Supabase)`);
} finally { await db.close(); }
