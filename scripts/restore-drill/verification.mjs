import {createHash} from 'node:crypto';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha256(JSON.stringify(value));
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const appSchema = "n.nspname !~ '^pg_' and n.nspname <> 'information_schema'";

// Only a newly created in-memory synthetic database is supplied by the drill.
// Digests never contain plaintext rows; they are integrity checks, not encryption/signatures.
export async function fingerprint(db) {
  const tables = (await db.query(`select n.nspname as schema,c.relname as name,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,c.relacl::text as acl
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where ${appSchema} and c.relkind='r' order by 1,2`)).rows;
  const data = [];
  for (const table of tables) {
    const rows = (await db.query(`select to_jsonb(t)::text as row from ${quote(table.schema)}.${quote(table.name)} t order by 1 limit 10001`)).rows;
    if (rows.length > 10000) throw Error('Synthetic drill row bound exceeded');
    data.push({table:table.schema+'.'+table.name,count:rows.length,sha256:hash(rows)});
  }
  const catalog = {tables};
  const queries = {
    schemas: `select n.nspname,n.nspacl::text as acl from pg_namespace n where ${appSchema} order by 1`,
    columns: `select table_schema,table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name from information_schema.columns where table_schema !~ '^pg_' and table_schema <> 'information_schema' order by 1,2,4`,
    views: `select schemaname,viewname,definition from pg_views where schemaname !~ '^pg_' and schemaname <> 'information_schema' order by 1,2`,
    sequences: `select schemaname,sequencename,data_type,start_value::text,min_value::text,max_value::text,increment_by::text,cycle,cache_size::text from pg_sequences where schemaname !~ '^pg_' order by 1,2`,
    policies: `select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname !~ '^pg_' order by 1,2,3`,
    functions: `select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,pg_get_functiondef(p.oid) as definition,p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${appSchema} and p.prokind='f' order by 1,2,3`,
    constraints: `select n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where ${appSchema} order by 1,2,3`,
    indexes: `select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname !~ '^pg_' order by 1,2,3`,
    roles: `select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles order by rolname`,
    triggers: `select n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where ${appSchema} and not t.tgisinternal order by 1,2,3`,
  };
  for (const [name,sql] of Object.entries(queries)) catalog[name]=(await db.query(sql)).rows;
  return {catalog_sha256:hash(catalog),data_sha256:hash(data),tables:data.length,rows:data.reduce((n,t)=>n+t.count,0)};
}
const keys = ['format','scope','archive_sha256','archive_bytes','migrations_sha256','catalog_sha256','data_sha256','tables','rows'];
export function validateManifest(manifest, archive, expectedMigrations) {
  if (!manifest || typeof manifest!=='object' || Array.isArray(manifest) || Object.keys(manifest).sort().join()!==[...keys].sort().join()) throw Error('Invalid restore manifest');
  if (manifest.format!==1 || manifest.scope!=='synthetic-pglite-only') throw Error('Unsupported restore scope');
  for (const key of ['archive_sha256','migrations_sha256','catalog_sha256','data_sha256']) if (typeof manifest[key]!=='string' || !/^[a-f0-9]{64}$/.test(manifest[key])) throw Error('Invalid digest');
  for (const key of ['archive_bytes','tables','rows']) if (!Number.isSafeInteger(manifest[key]) || manifest[key]<0) throw Error('Invalid manifest count');
  if (!(archive instanceof Uint8Array) || archive.length===0 || archive.length>128*1024*1024 || manifest.archive_bytes!==archive.length || manifest.archive_sha256!==sha256(archive)) throw Error('Archive integrity mismatch');
  if (manifest.migrations_sha256!==expectedMigrations) throw Error('Migration manifest mismatch');
}
export async function capture(db, migrationsSha256) {
  const expected=await fingerprint(db);
  const blob=await db.dumpDataDir();
  const archive=new Uint8Array(await blob.arrayBuffer());
  const manifest={format:1,scope:'synthetic-pglite-only',archive_sha256:sha256(archive),archive_bytes:archive.length,migrations_sha256:migrationsSha256,...expected};
  validateManifest(manifest,archive,migrationsSha256);
  return {manifest,archive};
}
export async function restoreVerified(PGlite, bundle, migrationsSha256) {
  // Validate before allowing the engine to read any archive bytes. No target path or URL.
  validateManifest(bundle.manifest,bundle.archive,migrationsSha256);
  const restored=new PGlite({loadDataDir:new Blob([bundle.archive])});
  try {
    await restored.waitReady;
    const actual=await fingerprint(restored);
    for (const key of Object.keys(actual)) if (actual[key]!==bundle.manifest[key]) throw Error('Restored database mismatch: '+key);
    return restored;
  } catch(error) {await restored.close();throw error;}
}
