// Durable files (root review P2-2): the manifest and the intents are written atomically (temp file
// in the same directory, fsync, rename, directory fsync, mode 0600) and the manifest exists on
// disk BEFORE the first creation or lookup. The shared scripts/qa Fixtures writes its manifest
// with a plain writeFile; this harness replaces that method ON ITS OWN INSTANCE (the shared file
// is untouched) so every manifest update of a tracking run is atomic too.
import { openSync, writeSync, fsyncSync, closeSync, renameSync, chmodSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export function atomicWriteJsonSync(file, value) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, file);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw error;
  }
  chmodSync(file, 0o600);
  try {
    const dfd = openSync(dir, "r");
    try {
      fsyncSync(dfd);
    } finally {
      closeSync(dfd);
    }
  } catch {} // directory fsync is not supported everywhere; the rename is still atomic
}

/** Makes the shared Fixtures instance persist atomically and writes the (empty) manifest NOW. */
export function makeManifestDurable(fixtures) {
  fixtures.save = async function save() {
    this.manifest.updated_at = new Date().toISOString();
    atomicWriteJsonSync(this.manifestPath, this.manifest);
  };
  fixtures.manifest.updated_at = new Date().toISOString();
  atomicWriteJsonSync(fixtures.manifestPath, fixtures.manifest);
  return fixtures;
}
