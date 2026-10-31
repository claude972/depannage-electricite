import path from 'node:path';
import { createHash } from 'node:crypto';

export const HELP = 'node scripts/qa-pwa-desktop/run.mjs --app-dir DIR --app-sha SHA --build-id ID --origin http://127.0.0.1:3017 --chromium-path EXE --playwright-path MODULE --out NEW_DIR [--execute] [--proof-timeout-ms 180000] [--recover-manifest FILE --recover-sha256 HASH [--continue-proof]]';
export class Blocked extends Error {}
export const hash = value => createHash('sha256').update(value).digest('hex');
export async function bounded(promise, ms, label='operation') {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out; outcome not cancelled`)),ms);})]); }
  finally { clearTimeout(timer); }
}
export function parseArgs(args) {
  const o = { execute: false, proofTimeoutMs: 180000 };
  const keys = { '--app-dir':'appDir', '--app-sha':'appSha', '--build-id':'buildId', '--origin':'origin', '--chromium-path':'chromiumPath', '--playwright-path':'playwrightPath', '--out':'out', '--proof-timeout-ms':'proofTimeoutMs', '--recover-manifest':'recoverManifest','--recover-sha256':'recoverSha256' };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help') return { help: true };
    if (seen.has(a)) throw new Blocked(`duplicate ${a}`);
    seen.add(a);
    if (a === '--execute') o.execute = true;
    else if(a==='--continue-proof')o.continueProof=true;
    else if (keys[a] && args[i+1] && !args[i+1].startsWith('--')) o[keys[a]] = args[++i];
    else throw new Blocked(`unknown or incomplete option ${a}`);
  }
  for (const k of ['appDir','appSha','buildId','origin','chromiumPath','playwrightPath','out']) if (!o[k]) throw new Blocked(`${k} required`);
  if(!!o.recoverManifest!==!!o.recoverSha256 || (o.recoverSha256&&!/^[a-f0-9]{64}$/.test(o.recoverSha256)) || (o.continueProof&&!o.recoverManifest))throw new Blocked('recovery needs source manifest and SHA256; continue-proof only in recovery');
  if (!/^[a-f0-9]{40}$/.test(o.appSha)) throw new Blocked('full app SHA required');
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(o.buildId)) throw new Blocked('invalid build ID');
  const u = new URL(o.origin);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || u.pathname !== '/' || u.username || u.password || u.search || u.hash) throw new Blocked('explicit HTTP loopback origin required');
  o.origin = u.origin;
  o.proofTimeoutMs = Number(o.proofTimeoutMs);
  if (!Number.isInteger(o.proofTimeoutMs) || o.proofTimeoutMs < 1000 || o.proofTimeoutMs > 300000) throw new Blocked('proof timeout 1000..300000ms');
  return o;
}
export function verifyBuild({ expectedSha, expectedBuildId, head, diskBuildId, html }) {
  if (head !== expectedSha || diskBuildId !== expectedBuildId) throw new Blocked('checkout SHA or disk BUILD_ID mismatch');
  if (!html.includes(expectedBuildId) || !/Courant/.test(html)) throw new Blocked('served HTML build/app mismatch');
  return true;
}
export function identity(manifest, manifestUrl, origin) {
  const start = new URL(manifest.start_url, manifestUrl);
  const id = new URL(manifest.id, start);
  const scope = new URL(manifest.scope, manifestUrl);
  if (!manifest.id || !manifest.start_url || !manifest.scope || manifest.display !== 'standalone' || [start,id,scope].some(u => u.origin !== origin || u.username || u.password || u.search || u.hash)) throw new Blocked('unexpected manifest identity');
  if (scope.pathname !== '/' || id.pathname !== '/' || start.pathname !== '/') throw new Blocked('only reviewed root-scope app supported');
  return { manifestId: id.href, startUrl: start.href, scope: scope.href };
}
// Chromium app_id_helpers.cc -> crx_file::id_util::GenerateId(manifest_id.spec()).
export function chromeAppId(manifestId) {
  return hash(Buffer.from(hash(manifestId),'hex')).slice(0,32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c,16)));
}
export function fullProfile(plist) {
  const dir = plist.CrAppModeUserDataDir;
  const profile = plist.CrAppModeProfileDir;
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || typeof profile !== 'string' || !/^[A-Za-z0-9 _-]+$/.test(profile)) return null;
  const p = path.normalize(dir);
  return path.basename(path.dirname(path.dirname(p))) === profile ? path.dirname(path.dirname(p)) : path.join(p,profile);
}
export function collision(bundle, id) {
  const p = bundle.plist;
  if (p.CrAppModeShortcutID === id.appId) return true;
  try { return new URL(p.CrAppModeShortcutURL).origin === new URL(id.manifestId).origin; } catch { return false; }
}
export function uniqueDefault(local,id) {
  const profiles=local?.profile?.info_cache,apps=local?.app_shims,entry=apps?.[id];
  return !!profiles&&Object.keys(profiles).length===1&&Object.hasOwn(profiles,'Default')&&!!apps&&Object.keys(apps).length===1&&Object.hasOwn(apps,id)&&Array.isArray(entry?.installed_profiles)&&entry.installed_profiles.length===1&&entry.installed_profiles[0]==='Default'&&(entry.last_active_profiles===undefined||(Array.isArray(entry.last_active_profiles)&&entry.last_active_profiles.every(p=>p==='Default')));
}
export function attributable(bundle, id, profileRoot, baseline, localState) {
  if (!bundle || bundle.symlink || baseline.some(b => b.path === bundle.path) || !bundle.executable || !bundle.inode) return false;
  const p = bundle.plist;
  if(p.CrAppModeShortcutID!==id.appId||p.CrAppModeShortcutURL!==id.startUrl)return false;
  const mono=typeof p.CFBundleIdentifier==='string'&&[`.app.${id.appId}`,`.app.Default-${id.appId}`].some(suffix=>p.CFBundleIdentifier.endsWith(suffix))&&fullProfile(p)===path.join(profileRoot,'Default');
  const multi=!Object.hasOwn(p,'CrAppModeProfileDir')&&!!id.browserBundleId&&p.CrBundleIdentifier===id.browserBundleId&&p.CFBundleIdentifier===`${id.browserBundleId}.app.${id.appId}`&&p.CrAppModeUserDataDir===path.join(profileRoot,'-','Web Applications',`_crx_${id.appId}`)&&uniqueDefault(localState,id.appId);
  return mono||multi;
}
export function baselineUnchanged(before, after) {
  return before.every(b => after.some(a => a.path === b.path && a.inode === b.inode && a.digest === b.digest));
}
export function absentRegistry(error) {
  return /Unknown web-app manifest id https?:\/\//.test(String(error?.message)) && !/closed|disconnect|timeout|method.*not found/i.test(String(error?.message));
}
export function canUninstall(state, current) {
  const intent=state.installIntent;
  const runMatches=intent?.runId===state.runId || (state.recovery?.sourceRunId===intent?.runId&&state.recovery?.sourceHashVerified===true);
  return !!intent && runMatches && intent.manifestId === state.identity.manifestId && intent.appId === state.identity.appId && current.ownedProcess && current.profileRoot === state.profileRoot && current.registryPresent && attributable(current.bundle,state.identity,state.profileRoot,state.baseline,current.localState);
}
export function proofMatches(proof, expected, bytes) {
  return proof?.kind === 'macos-visible-window' && ['runId','appId','windowId','browserPid','nonce'].every(k => proof[k] === expected[k]) && typeof proof.observedAt === 'string' && Date.parse(proof.observedAt) >= expected.startedAt && Date.parse(proof.observedAt) <= Date.now() + 5000 && proof.sha256 === hash(bytes) && bytes.length > 100 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
}
export function resultStatus(state) {
  if (!state.cleanup?.ok) return 'INCOMPLETE';
  if (state.error) return state.error.kind === 'Blocked' ? 'BLOCKED' : 'FAIL';
  return ['installed','shim','window','osProof','relaunched'].every(k => state.proofs[k]) ? 'PASS' : 'BLOCKED';
}
export function createGate() {
  let stopped = false; const pending = new Set();
  return {
    stop() { stopped = true; },
    check() { if (stopped) throw new Blocked('stopping'); },
    get stopping() { return stopped; },
    async effect(intent, task) {
      this.check(); await intent(); this.check();
      // Invoke synchronously after the second gate check; register before yielding.
      const p = Promise.resolve().then(() => { this.check(); return task(); });
      pending.add(p); p.then(() => pending.delete(p), () => pending.delete(p)); return p;
    },
    async drain(ms) {
      let timer; await Promise.race([Promise.allSettled([...pending]), new Promise(r => { timer = setTimeout(r,ms); })]); clearTimeout(timer); return pending.size;
    },
  };
}
export function onceAsync(fn) { let p; return (...args) => p ??= Promise.resolve().then(() => fn(...args)); }
export function sameProcess(a,b) { return !!a && !!b && a.pid === b.pid && a.started === b.started && a.command === b.command; }
export function profileRemovalAllowed(cleanup) { return !!cleanup.registryAbsent && cleanup.browserExited === true && cleanup.shimsAbsent === true && cleanup.baselineUnchanged === true && cleanup.shimPids?.length === 0 && cleanup.pending === 0 && cleanup.errors?.length === 0; }
