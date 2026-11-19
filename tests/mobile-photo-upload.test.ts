import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const bytes = new Uint8Array([255, 216, 255, 224, 0, 16, 255, 217]);
const name = 'photo-demande-00000000-0000-4000-8000-000000000001.jpg';
class LocalFile {
  constructor(readonly uri: string) {}
  get name() { return this.uri.split('/').pop()!; }
  get type() { return 'image/jpeg'; }
  async bytes() { return bytes; }
}
class NativeForm {
  parts = new Map<string, unknown>();
  append(key: string, value: unknown) { this.parts.set(key, value); }
}
function load(platform: string) {
  const module = { exports: {} as any };
  const code = transformSync(readFileSync('apps/mobile/src/lib/photo-upload.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports,
    require: (key: string) => key === 'react-native' ? { Platform: { OS: platform } } : { File: LocalFile },
    FormData: platform === 'web' ? FormData : NativeForm,
    Blob: platform === 'web' ? Blob : class { constructor() { throw Error('RN Blob cannot construct ArrayBuffer'); } }, Error,
  });
  return module.exports.createJpegUpload;
}

test('native multipart uses an Expo File with readable bytes and stable receipt name, without URI-only part or RN Blob construction', async () => {
  const upload = load('android');
  const body: NativeForm = await upload('dossier', { uri: 'file:///cache/random.jpg', arrayBuffer: async () => { throw Error('not used on native'); } }, name);
  assert.equal(body.parts.get('intervention_id'), 'dossier');
  const file = body.parts.get('file');
  assert.ok(file instanceof LocalFile);
  assert.equal(file.uri, 'file:///cache/random.jpg');
  assert.equal(file.name, name);
  assert.equal(file.type, 'image/jpeg');
  assert.deepEqual(await file.bytes(), bytes);
  await assert.rejects(upload('dossier', {}, name), /photo locale/);
});

test('web multipart preserves the JPEG bytes and filename through real Request serialization', async () => {
  const body = await load('web')('dossier', { arrayBuffer: async () => bytes.buffer }, name);
  const request = new Request('https://example.test/api/documents', { method: 'POST', body });
  assert.match(request.headers.get('content-type')!, /^multipart\/form-data; boundary=/);
  const decoded = await request.formData();
  assert.equal(decoded.get('intervention_id'), 'dossier');
  const file = decoded.get('file');
  assert.ok(file instanceof File);
  assert.equal(file.name, name);
  assert.equal(file.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
});
