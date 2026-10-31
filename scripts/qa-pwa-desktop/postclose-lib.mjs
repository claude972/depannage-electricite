import {Blocked,hash,createGate,bounded} from './lib.mjs';
export const POST={runId:'6df65d6c-4e0a-4082-88b3-596c81bf3979',sha:'f5fc549bea511207c872857cb49df5f0ce1f85c5',manifestHash:'8b8b7489eb19952f87fc9e3b9f5e2f56965d13e577d5139c2a33534cbba6c268',profileInode:127315203,folderInode:127315558,localizedInode:127315559,files:[
  {relative:'Icon\r',inode:127323329,digest:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',attributes:'ada277f2eb559511311bce90dfb8736d991b93ed701689dc220056f1ce02768e'},
  {relative:'.localized/fr.strings',inode:127323323,digest:'9eeca3d3ace4f90657f9491db09aec78cef790bda3401f31233ce105108c6a51',attributes:'750c7f1acb088aa57fac571c04fde0880dc7cb91af245d243b423919cd093545'}]};
export const PLAN=['unlink-icon','unlink-language','rmdir-localized','rmdir-generated-folder','remove-owned-profile'];
export function validatePostSource(s,bytes,expectedHash){
  if(expectedHash!==POST.manifestHash||hash(bytes)!==expectedHash||s.runId!==POST.runId||s.harnessSha!==POST.sha||s.status!=='INCOMPLETE'||s.cleanup?.registryAbsent!==true||s.cleanup?.diskRegistryAbsent!==true||s.cleanup?.browserExited!==true||s.cleanup?.pending!==0||s.recovery?.adoption?.inode!==POST.profileInode||s.recovery?.folder?.inode!==POST.folderInode||s.recovery?.folder?.localizedInode!==POST.localizedInode)throw new Blocked('unapproved post-close source');
  return s;
}
export function metadataMatches(actual,expected,start,end,uid){return actual.inode===expected.inode&&actual.digest===expected.digest&&actual.attributes===expected.attributes&&actual.uid===uid&&actual.mode===0o600&&Number.isFinite(actual.birthtimeMs)&&actual.birthtimeMs>=start&&actual.birthtimeMs<=end;}
// Same coordinator used by CLI; tests inject all filesystem effects and journals.
export function createPostCleanup({inspect,effect,journal,gate=createGate(),timeoutMs=20000}){
  const completed=[];
  return {gate,completed,async execute(){
    for(const step of PLAN){
      gate.check();
      await bounded(gate.effect(()=>journal({intent:step,completed:[...completed]}),async()=>{
        await inspect(completed);gate.check();await effect(step);
      }),timeoutMs,step);
      completed.push(step);await journal({done:step,completed:[...completed]});
    }
    gate.check();await inspect(completed);gate.check();return 'RECOVERED_CLEAN';
  }};
}
