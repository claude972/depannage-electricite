import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import { sha256 } from './verification.mjs';

const bucket = 'intervention-documents';
const mimeType = 'image/png';
const sample = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2i4AAAAASUVORK5CYII=',
  'base64',
);
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const dockerContext = 'colima-release-auth-qa';
const expectedCounts = { users: 2, identities: 2, profiles: 2, interventions: 1, documents: 1 };
const tables = {
  users: 'auth.users',
  identities: 'auth.identities',
  profiles: 'public.profiles',
  interventions: 'public.interventions',
  documents: 'public.documents',
};

class DrillFailure extends Error {}

function requireThat(condition, message) {
  if (!condition) throw new DrillFailure(message);
}

function docker(args, input) {
  const result = spawnSync('docker', ['--context', dockerContext, ...args], {
    input, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  // SQL errors can contain the failed row. Keep raw process output out of the report.
  requireThat(result.status === 0, 'Commande Docker/PostgreSQL en échec');
  return result.stdout.trim();
}

function psql(project, sql) {
  return docker(['exec', '-i', `supabase_db_${project}`, 'psql', '-XqAt',
    '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], sql);
}

async function instance(kind, date, statusPath, apiPort, dbPort) {
  const config = JSON.parse(await readFile(statusPath, 'utf8'));
  const api = new URL(config.API_URL);
  const db = new URL(config.DB_URL);
  const local = (url, port) => ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === port;
  requireThat(api.protocol === 'http:' && local(api, apiPort) && api.href === `${api.origin}/`,
    'URL Supabase locale inattendue');
  requireThat(db.protocol === 'postgresql:' && local(db, dbPort), 'URL PostgreSQL locale inattendue');

  const project = `domdepannage-${kind}-qa-${date}`;
  const hostsPort = (container, port) => Object.values(JSON.parse(
    docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', `supabase_${container}_${project}`]),
  )).some(bindings => bindings?.some(binding => binding.HostPort === port));
  requireThat(hostsPort('kong', apiPort) && hostsPort('db', dbPort),
    'Les ports annoncés ne correspondent pas aux conteneurs de recette');

  const publicKey = config.PUBLISHABLE_KEY ?? config.ANON_KEY;
  requireThat(typeof publicKey === 'string' && typeof config.SERVICE_ROLE_KEY === 'string',
    'Clés de la pile locale indisponibles');
  const client = (key = publicKey) => createClient(api.origin, key, { auth: authOptions });
  return { project, client, service: client(config.SERVICE_ROLE_KEY) };
}

function value(result, action) {
  requireThat(!result.error && result.data != null,
    `${action} en échec${result.error?.code ? ` (${result.error.code})` : ''}`);
  return result.data;
}

function syntheticAccount(name, run) {
  return {
    name,
    email: `restore-${name.toLowerCase()}-${run}@example.invalid`,
    password: `Qa!9${randomBytes(24).toString('base64url')}`,
  };
}

async function signIn(environment, account) {
  const client = environment.client();
  const { user } = value(await client.auth.signInWithPassword({
    email: account.email, password: account.password,
  }), 'Connexion Auth');
  requireThat(user?.id === account.id && Boolean(user.email_confirmed_at), 'Identité Auth inattendue');
  return client;
}

function uuid(value) {
  requireThat(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value),
    'Identifiant de la fixture invalide');
  return `'${value}'::uuid`;
}

async function seed(source) {
  const run = randomUUID();
  const owner = syntheticAccount('Client', run);
  const outsider = syntheticAccount('Tiers', run);
  for (const account of [owner, outsider]) {
    const { user } = value(await source.service.auth.admin.createUser({
      email: account.email, password: account.password, email_confirm: true,
      user_metadata: { first_name: 'Recette', last_name: account.name },
    }), 'Création du compte synthétique');
    account.id = user.id;
  }

  const dossier = value(await (await signIn(source, owner)).rpc('create_intervention', {
    p_category: 'socket',
    p_description: 'Panne synthétique pour la recette de restauration.',
    p_address: 'Adresse synthétique de recette',
    p_postal_code: '97200',
    p_city: 'Fort-de-France',
    p_urgency: 'scheduled',
  }), 'Création du dossier');
  const documentId = randomUUID();
  const path = `${owner.id}/${documentId}`;
  value(await source.service.storage.from(bucket).upload(path, sample, { contentType: mimeType }),
    'Dépôt de la pièce source');
  const authenticated = await signIn(source, owner);
  value(await authenticated.rpc('finalize_document_upload', {
    p_id: documentId, p_path: path, p_name: 'recette-restauration.png',
    p_mime: mimeType, p_intervention_id: dossier.id,
  }), 'Rattachement de la pièce');
  return { owner, outsider, dossier, documentId, path };
}

function exportRows(project, fixture) {
  const users = `${uuid(fixture.owner.id)}, ${uuid(fixture.outsider.id)}`;
  const filters = {
    users: `id in (${users})`,
    identities: `user_id in (${users})`,
    profiles: `id in (${users})`,
    interventions: `id = ${uuid(fixture.dossier.id)}`,
    documents: `id = ${uuid(fixture.documentId)}`,
  };
  const rows = Object.entries(tables).map(([name, table]) =>
    `'${name}', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from ${table} t where ${filters[name]})`);
  const archive = psql(project, `
    begin isolation level repeatable read read only;
    select jsonb_build_object(${rows.join(',\n')});
    commit;
  `);
  const decoded = JSON.parse(archive);
  for (const [name, count] of Object.entries(expectedCounts)) {
    requireThat(decoded[name].length === count, `Nombre de lignes inattendu pour ${name}`);
  }
  return archive;
}

function restoreRows(project, archive) {
  const statements = Object.entries(tables).map(([name, table]) => {
    const [schema, tableName] = table.split('.');
    // PostgreSQL reconstructs its native types and recomputes generated Auth columns.
    const rowset = `jsonb_populate_recordset(null::${table}, $1->'${name}')`;
    const profileRestore = name === 'profiles';
    const columnExpression = profileRestore ? "quote_ident(column_name)||' = records.'||quote_ident(column_name)" : 'quote_ident(column_name)';
    const condition = profileRestore ? "and column_name <> 'id'" : '';
    const sql = profileRestore
      ? `update ${table} set %s from ${rowset} records where ${tableName}.id=records.id`
      : `insert into ${table} (%s) select %s from ${rowset}`;
    return `
      select string_agg(${columnExpression}, ', ' order by ordinal_position) into columns
      from information_schema.columns where table_schema = '${schema}' and table_name = '${tableName}'
        and is_generated = 'NEVER' and is_identity = 'NO' ${condition};
      execute format('${sql.replaceAll("'", "''")}', columns, columns) using payload;
      get diagnostics restored = row_count;
      if restored <> ${expectedCounts[name]} then raise exception 'Unexpected restored row count'; end if;
    `;
  });
  // The trigger on auth.users creates profiles. Their original values are applied afterwards.
  // Base64 transports the archive through psql stdin without interpolating row contents as SQL.
  const base64 = Buffer.from(archive).toString('base64');
  psql(project, `
    begin;
    do $restore$
    declare payload jsonb := convert_from(decode('${base64}', 'base64'), 'UTF8')::jsonb;
      columns text;
      restored integer;
    begin
      ${statements.join('\n')}
    end;
    $restore$;
    commit;
  `);
}

async function download(client, path) {
  const blob = value(await client.storage.from(bucket).download(path), 'Lecture de la pièce');
  return Buffer.from(await blob.arrayBuffer());
}

function assertRejected(result) {
  requireThat(result.data == null && ['400', '401', '403', '404'].includes(String(result.error?.statusCode)),
    'Le stockage n’a pas retourné un refus d’accès attendu');
  return String(result.error.statusCode);
}

async function verify(target, fixture, expectedHash) {
  const owner = await signIn(target, fixture.owner);
  const outsider = await signIn(target, fixture.outsider);
  const dossier = value(await owner.from('interventions').select('id,client_id,status')
    .eq('id', fixture.dossier.id).single(), 'Lecture du dossier restauré');
  requireThat(dossier.client_id === fixture.owner.id && dossier.status === fixture.dossier.status,
    'Propriétaire ou statut restauré différent');
  const document = value(await owner.from('documents').select('id,intervention_id,owner_id,path')
    .eq('id', fixture.documentId).single(), 'Lecture des métadonnées restaurées');
  requireThat(document.owner_id === fixture.owner.id && document.intervention_id === dossier.id
    && document.path === fixture.path, 'Rattachement restauré différent');
  const actualHash = sha256(await download(owner, document.path));
  requireThat(actualHash === expectedHash, 'Empreinte de la pièce restaurée différente');
  for (const [table, id] of [['interventions', dossier.id], ['documents', document.id]]) {
    const result = await outsider.from(table).select('id').eq('id', id).maybeSingle();
    requireThat(!result.error && result.data === null, `La ligne ${table} est visible du tiers`);
  }
  return {
    owner_login: true, outsider_login: true, owner_dossier: true, owner_document: true,
    outsider_dossier_hidden: true, outsider_document_hidden: true,
    outsider_storage_status: assertRejected(await outsider.storage.from(bucket).download(document.path)),
    anonymous_storage_status: assertRejected(await target.client().storage.from(bucket).download(document.path)),
  };
}

async function run() {
  const [date, sourceStatus, targetStatus] = process.argv.slice(2);
  requireThat(/^[0-9]{8}$/.test(date) && sourceStatus && targetStatus,
    'Usage: node scripts/restore-drill/supabase-local.mjs YYYYMMDD SOURCE_STATUS_JSON TARGET_STATUS_JSON');
  const source = await instance('launch', date, sourceStatus, '59421', '59422');
  const target = await instance('restore', date, targetStatus, '59521', '59522');
  const migrations = project => psql(project, 'select version from supabase_migrations.schema_migrations order by version;');
  const versions = migrations(source.project);
  requireThat(versions && versions === migrations(target.project), 'Historique de migrations différent');
  const targetCounts = psql(target.project, `select ${Object.values(tables)
    .map(table => `(select count(*) from ${table})`).join(', ')}, (select count(*) from storage.objects);`);
  requireThat(targetCounts === '0|0|0|0|0|0', 'La cible de recette doit être vierge');

  const fixture = await seed(source);
  const exportStart = performance.now();
  const archive = exportRows(source.project, fixture);
  const file = await download(source.service, fixture.path);
  const fileHash = sha256(file);
  requireThat(fileHash === sha256(sample), 'Empreinte de la pièce source différente');
  const exportMs = Math.round(performance.now() - exportStart);

  const restoreStart = performance.now();
  restoreRows(target.project, archive);
  requireThat(exportRows(target.project, fixture) === archive, 'Lignes restaurées différentes');
  value(await target.service.storage.from(bucket).upload(fixture.path, file, { contentType: mimeType }),
    'Restauration des octets Storage');
  const restoreMs = Math.round(performance.now() - restoreStart);
  const verification = await verify(target, fixture, fileHash);
  console.log(JSON.stringify({
    scope: 'supabase-local-synthetic',
    migration_count: versions.split('\n').length,
    counts: expectedCounts,
    archive_bytes: Buffer.byteLength(archive),
    archive_sha256: sha256(archive),
    file_bytes: file.length,
    file_sha256: fileHash,
    export_ms: exportMs,
    restore_ms: restoreMs,
    restore_and_verify_ms: Math.round(performance.now() - restoreStart),
    verification,
  }, null, 2));
}

try {
  await run();
} catch (error) {
  // Unexpected SDK errors can contain request information. Emit the check name only.
  console.error(error instanceof DrillFailure ? error.message : 'Échec inattendu de la recette locale');
  process.exitCode = 1;
}
