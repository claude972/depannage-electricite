// Isolated test adaptation only. Never import this helper into an application/migration.
import { createHash } from 'node:crypto';
import { installCronStub } from './sql-tracking-retention-review.mjs';

export const RETENTION_FILE = '202610310020_tracking_retention.sql';
// Reviewed a658087 source: drift requires an explicit new source review and pin update.
export const RETENTION_SHA256 = '76d5517d31ef01ca0b17f5172e48a6ebb5671b0026ed275bdf51e4cf54355acf';
const START = '-- BEGIN PG_CRON INSTALL';
const END = '-- END PG_CRON INSTALL';
export const STUB_NOTICE = '-- TEST ONLY: native pg_cron installation replaced by explicit metadata/API stub; NO scheduler worker exists.';

/** Preserve every SQL instruction except the exact reviewed native-extension installation block. */
export function adaptRetentionSql(name, source) {
  if (name !== RETENTION_FILE) {
    if (name.startsWith('202610310020')) throw Error('Unexpected 020 migration filename; review required');
    return source;
  }
  if (createHash('sha256').update(source).digest('hex') !== RETENTION_SHA256)
    throw Error('020 source differs from reviewed a658087; refusing isolated adaptation');
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end <= start || source.indexOf(START, start + START.length) !== -1 || source.indexOf(END, end + END.length) !== -1)
    throw Error('Unexpected native installation block structure; review required');
  return source.slice(0, start) + STUB_NOTICE + source.slice(end + END.length);
}

export async function isolatedMigrationSql(db, name, source, { install = installCronStub, announce = console.log } = {}) {
  const adapted = adaptRetentionSql(name, source); // Validate BEFORE creating any stub objects.
  if (name === RETENTION_FILE) {
    announce('ISOLATED SQL: 020 native installation is an explicit pg_cron STUB; remaining migration executes. NOT real scheduler/timing proof. Dedicated retention CI test is mandatory.');
    await install(db);
  }
  return adapted;
}
