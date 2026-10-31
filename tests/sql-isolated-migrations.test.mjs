import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {adaptRetentionSql, isolatedMigrationSql, RETENTION_FILE, STUB_NOTICE} from './sql-isolated-migrations.mjs';
const source = await readFile(new URL('../supabase/migrations/' + RETENTION_FILE, import.meta.url), 'utf8');

test('020 adaptation preserves exact prefix/suffix and all non-installation SQL', () => {
  const start = source.indexOf('-- BEGIN PG_CRON INSTALL');
  const after = source.indexOf('-- END PG_CRON INSTALL') + '-- END PG_CRON INSTALL'.length;
  assert.equal(adaptRetentionSql(RETENTION_FILE, source), source.slice(0, start) + STUB_NOTICE + source.slice(after));
  for (const text of ['limit 1000 for update of t skip locked', 'grant execute on function public.purge_expired_tracking_points() to service_role', 'pg_try_advisory_xact_lock', 'has_table_privilege', 'cron.schedule', 'commit;'])
    assert.ok(adaptRetentionSql(RETENTION_FILE, source).includes(text), text);
});
test('001–019 and future migration SQL are returned unchanged, never automatically stubbed', async () => {
  let installs = 0;
  const text = 'select 42; -- BEGIN PG_CRON INSTALL';
  for (const name of ['202610310019_intervention_tracking.sql','202610310021_future.sql'])
    assert.equal(await isolatedMigrationSql({}, name, text, {install: async () => installs++}), text);
  assert.equal(installs, 0);
});
test('020 drift, missing/duplicate/reordered markers and filename drift fail before stub creation', async () => {
  let installs = 0;
  for (const text of [source + '\n', source.replace('limit 1000', 'limit 1001'), source.replace('-- BEGIN PG_CRON INSTALL','-- MISSING'), source + '\n-- END PG_CRON INSTALL', source.replace('-- BEGIN PG_CRON INSTALL','-- END PG_CRON INSTALL')])
    await assert.rejects(isolatedMigrationSql({}, RETENTION_FILE, text, {install: async () => installs++}), /review|reviewed/);
  assert.throws(() => adaptRetentionSql('202610310020_other.sql', source), /filename/);
  assert.equal(installs, 0);
});
test('020 explicitly announces simulation before installing only once per migration call', async () => {
  const events = [];
  const db = {};
  const adapted = await isolatedMigrationSql(db, RETENTION_FILE, source, {announce: text => events.push(text), install: async value => {assert.equal(value, db);events.push('installed');}});
  assert.equal(events.length, 2);
  assert.match(events[0], /STUB.*NOT real scheduler\/timing proof.*mandatory/);
  assert.equal(events[1], 'installed');
  assert.equal(adapted, adaptRetentionSql(RETENTION_FILE, source));
});
test('stub installation failure propagates, never replaced with success', async () => {
  await assert.rejects(isolatedMigrationSql({}, RETENTION_FILE, source, {announce: () => {}, install: async () => {throw Error('stub failed');}}), /stub failed/);
});
