import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

function load(manipulateAsync: (...args: any[]) => Promise<unknown>, launchImageLibraryAsync: (...args: any[]) => Promise<unknown> = async () => ({ canceled: true, assets: null })) {
  const module = { exports: {} as any };
  const code = transformSync(readFileSync('apps/mobile/src/lib/photo-preparation.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, Error,
    require: (name: string) => name === 'expo-image-manipulator'
      ? { manipulateAsync, SaveFormat: { JPEG: 'jpeg' } }
      : { UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' }, launchImageLibraryAsync },
  });
  return module.exports;
}

test('photo preparation preserves resize and JPEG compression with compatible system representation', async () => {
  const calls: unknown[][] = [];
  const result = { uri: 'file:///cache/prepared.jpg', width: 1600, height: 1200 };
  const photo = load(async (...args) => { calls.push(args); return result; });
  assert.equal(photo.photoRepresentation, 'compatible');
  const actions = [{ resize: { width: 1600 } }];
  assert.equal(await photo.prepareJpeg('file:///cache/input.png', actions), result);
  assert.equal(calls[0][0], 'file:///cache/input.png');
  assert.equal(calls[0][1], actions);
  assert.equal(JSON.stringify(calls[0][2]), JSON.stringify({ compress: .74, format: 'jpeg' }));
});

test('unreadable provider file gives an actionable message without a native path; a retry can succeed', async () => {
  let attempts = 0;
  const photo = load(async () => {
    if (++attempts === 1) throw new Error("renderAsync failed: file:///private/user/cache/photo.png is not readable");
    return { uri: 'file:///cache/retry.jpg' };
  });
  await assert.rejects(photo.prepareJpeg('file:///private/user/cache/photo.png', []), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Réessayez/);
    assert.doesNotMatch(error.message, /file:|renderAsync|private/);
    return true;
  });
  assert.equal((await photo.prepareJpeg('file:///cache/another.png', [])).uri, 'file:///cache/retry.jpg');
});


test('picker cancellation is preserved; blank/native rejection becomes actionable and retry works', async () => {
  let attempt = 0;
  const photo = load(async () => ({}), async options => {
    assert.equal(options.preferredAssetRepresentationMode, 'compatible');
    assert.equal(options.allowsMultipleSelection, false);
    if (++attempt === 1) throw new Error('');
    if (attempt === 2) throw new Error('native provider failed at file:///private/photo.png');
    return { canceled: true, assets: null };
  });
  for (let n = 0; n < 2; n++) await assert.rejects(photo.selectLibraryPhoto(), (error: Error) => {
    assert.match(error.message, /sélectionnée.*Réessayez/);
    assert.doesNotMatch(error.message, /file:|private|provider/);
    return true;
  });
  assert.equal((await photo.selectLibraryPhoto()).canceled, true);
});
