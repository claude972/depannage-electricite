// CLI-07 — in-app notifications for a quote amendment (migration 20261122140000), in real isolated
// SQL (PGlite). Not a live Supabase claim and no external delivery: only the in-app notification row.
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
  const ids = Object.fromEntries(["client", "artisan", "other"].map((x) => [x, crypto.randomUUID()]));
  for (const [n, id] of Object.entries(ids)) await q("insert into auth.users(id,raw_user_meta_data,email,email_confirmed_at)values($1,$2,$3,now())", [id, JSON.stringify({ role: n === "artisan" ? "artisan" : "client", full_name: "QA" }), n + "@example.invalid"]);
  const job = await one("insert into public.interventions(client_id,artisan_id,category,description,address,postal_code,city,urgency,status,estimate_min_cents,estimate_max_cents)values($1,$2,'panel','QA synthétique','QA adresse','97200','QA','scheduled','accepted',10000,20000)returning id v", [ids.client, ids.artisan]);
  const quote = await one(`insert into public.quotes(intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status)values($1,$2,'[{"label":"QA","quantity":1,"unit_price_cents":12000}]',12000,0,0,12000,'accepted')returning id v`, [job, ids.artisan]);
  const ref = await one("select public.intervention_reference($1)v", [job]);
  let version = 0;
  // Rows are written as the acting member (auth.uid()), like the propose/decide/withdraw commands do.
  const propose = async () => { await as(ids.artisan, null); return one(`insert into public.quote_amendments(intervention_id,base_quote_id,artisan_id,version,reason,lines,subtotal_cents,tax_rate,tax_cents,total_cents)values($1,$2,$3,${++version},'QA motif','[{"label":"QA","quantity":1,"unit_price_cents":3000}]',3000,0,0,3000)returning id v`, [job, quote, ids.artisan]); };
  const decide = async (id, status, actor) => { await as(actor, null); await q("update public.quote_amendments set status=$2,decided_by=$3,decided_at=now() where id=$1", [id, status, actor]); await as(null, null); };
  const inbox = async (user) => { await as(null, null); return q("select kind,title,body,intervention_id,actor_id,payload from public.notifications where recipient_id=$1 order by created_at,id", [user]); };

  // ---- 1. Proposal: the client is told, the author is not.
  const a1 = await propose();
  let client = await inbox(ids.client);
  eq(client.length, 1, "une notification pour le client");
  eq([client[0].kind, client[0].title, client[0].intervention_id, client[0].actor_id], ["quote_received", "Avenant proposé", job, ids.artisan], "type, titre, dossier et auteur");
  eq(client[0].body, `Un avenant au devis du dossier ${ref} attend votre décision.`, "texte sans montant ni contenu privé");
  eq(client[0].payload, { reference: ref, amendment_id: a1, amendment_version: 1 }, "données de navigation seulement");
  eq((await inbox(ids.artisan)).length, 0, "l’auteur ne reçoit pas sa propre proposition");

  // ---- 2. An edit that changes no status adds nothing.
  await as(ids.artisan, null); await q("update public.quote_amendments set valid_until=current_date+7 where id=$1", [a1]);
  eq((await inbox(ids.client)).length, 1, "aucune notification sans changement d’état");

  // ---- 3. Acceptance: the artisan is told once.
  await decide(a1, "accepted", ids.client);
  let artisan = await inbox(ids.artisan);
  eq(artisan.length, 1, "une notification pour l’artisan");
  eq([artisan[0].kind, artisan[0].title, artisan[0].body, artisan[0].actor_id], ["quote_accepted", "Avenant accepté", `L’avenant n° 1 du dossier ${ref} a été accepté.`, ids.client], "acceptation");
  eq((await inbox(ids.client)).length, 1, "le décideur ne reçoit pas sa propre décision");

  // ---- 4. Refusal of a second amendment.
  const a2 = await propose();
  await decide(a2, "rejected", ids.client);
  artisan = await inbox(ids.artisan);
  eq(artisan.length, 2, "deuxième notification pour l’artisan");
  eq([artisan[1].kind, artisan[1].title, artisan[1].body], ["quote_rejected", "Avenant refusé", `L’avenant n° 2 du dossier ${ref} a été refusé.`], "refus");
  eq((await inbox(ids.client)).length, 2, "le client a été prévenu de la deuxième proposition");

  // ---- 5. Withdrawal by the author: no decision notification.
  const a3 = await propose();
  await decide(a3, "withdrawn", ids.artisan);
  eq((await inbox(ids.artisan)).length, 2, "un retrait n’est pas une décision du client");

  // ---- 6. A muted kind is respected.
  await as(null, null);
  await q("insert into public.notification_preferences(user_id,muted_kinds)values($1,array['quote_received'])", [ids.client]);
  await propose();
  eq((await inbox(ids.client)).length, 3, "type coupé par le client : aucune notification ajoutée");

  // ---- 7. Isolation: a third party reads nothing.
  await as(ids.other, "authenticated");
  eq((await q("select id from public.notifications")).length, 0, "un tiers ne lit aucune notification du dossier");
  await as(ids.client, "authenticated");
  eq((await q("select id from public.notifications")).length, 3, "le client lit les siennes");
  await as(null, null);

  console.log(`PASS: amendment proposal and decision notify the other party once (${checks} checks, isolated PostgreSQL, not live Supabase)`);
} finally { await db.close(); }
