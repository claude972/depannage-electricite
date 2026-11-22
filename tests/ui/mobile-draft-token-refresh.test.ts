import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ROOT, skip, withScenarios } from './phase2-lot-b-harness';

const entry = `
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {z} from 'zod';
import {useResource} from './apps/mobile/src/lib/api.ts';

const schema = z.object({name:z.string()});
const responses = new Map();
window.fetch = (_url, options) => new Promise(resolve => {
  responses.set(options.headers.Authorization, resolve);
});
let move;
function Editor() {
  const [draft,setDraft] = useState('');
  return <input aria-label="Brouillon" value={draft} onChange={event => setDraft(event.target.value)} />;
}
function App() {
  const [identity,setIdentity] = useState({actor:'a', token:'a-first'});
  move = setIdentity;
  const read = useResource('/api/fixture', schema, identity.token, identity.actor);
  return <>{read.data && <><p>{read.data.name}</p><Editor /></>}{read.error && <p role="alert">{read.error}</p>}</>;
}
createRoot(document.getElementById('app')).render(<App />);
window.scenarios = {
  identity: value => move(value),
  pending: token => responses.has('Bearer ' + token),
  reply: ({token,status,name}) => {
    const key = 'Bearer ' + token;
    responses.get(key)(new Response(JSON.stringify(status===200 ? {name} : {error:'Accès refusé'}),{status}));
    responses.delete(key);
  },
};
`;

test('mobile draft stays mounted on a token refresh, then disappears on an access refusal or a different account', { skip }, async () => {
  await withScenarios(entry, async (run, { page, errors }) => {
    async function pending(token: string) {
      for (let i = 0; i < 100; i++) {
        if (await run('pending', token)) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail(`No request for ${token}`);
    }
    await pending('a-first');
    await run('reply', { token: 'a-first', status: 200, name: 'Dossier A' });
    const input = page.getByRole('textbox', { name: 'Brouillon' });
    await input.fill('Travaux saisis');
    await run('identity', { actor: 'a', token: 'a-renewed' });
    await pending('a-renewed');
    assert.equal(await input.inputValue(), 'Travaux saisis');
    await run('reply', { token: 'a-renewed', status: 200, name: 'Dossier A relu' });
    await page.getByText('Dossier A relu').waitFor();
    assert.equal(await input.inputValue(), 'Travaux saisis');

    await run('identity', { actor: 'a', token: 'a-revoked' });
    await pending('a-revoked');
    await run('reply', { token: 'a-revoked', status: 403 });
    await page.getByRole('alert').waitFor();
    assert.equal(await input.count(), 0);

    await run('identity', { actor: 'a', token: 'a-reauthorized' });
    await pending('a-reauthorized');
    await run('reply', { token: 'a-reauthorized', status: 200, name: 'Dossier A réautorisé' });
    await page.getByText('Dossier A réautorisé').waitFor();
    await run('identity', { actor: 'b', token: 'b-first' });
    await pending('b-first');
    assert.equal(await input.count(), 0);
    assert.equal(await page.getByText('Dossier A réautorisé').count(), 0);
    await run('reply', { token: 'b-first', status: 401 });
    await page.getByRole('alert').waitFor();
    assert.deepEqual(errors, []);
  }, 390, [
    { filter: /^react$/, contents: `module.exports=require(${JSON.stringify(path.join(ROOT, 'node_modules/react/index.js'))})` },
    { filter: /^react-native$/, contents: 'export const AppState={addEventListener(){return {remove(){}}}}' },
    { filter: /^\.\/config$/, contents: 'export const apiOrigin=location.origin' },
  ]);
});
