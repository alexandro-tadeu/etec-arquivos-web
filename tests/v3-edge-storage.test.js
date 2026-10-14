'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {webcrypto,randomUUID} = require('node:crypto');
const {safePhysicalPath,checkPlan,writeVerifiedSubmission,checksum} = require('../v3/edge-storage');
const uuid = () => randomUUID();
const fileFrom = bytes => ({size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer,
  slice(start,end){return fileFrom(bytes.slice(start,end));}});
function directoryFactory() {
  const files = new Map(), dirs = new Map(); let tamper = false; let allow = true;
  const root = {
    async queryPermission(){return allow?'granted':'denied';},
    async getDirectoryHandle(name){if(!dirs.has(name))dirs.set(name,directoryFactory().root);return dirs.get(name);},
    async getFileHandle(name, options){
      if(!options.create && !files.has(name)){const e = new Error('NotFound');e.name='NotFoundError';throw e;}
      if(!files.has(name))files.set(name,Uint8Array.of());
      return {
        async createWritable(){let buffer=[];return {async write(b){buffer.push(...new Uint8Array(b));},async close(){files.set(name,Uint8Array.from(buffer));},async abort(){buffer=[];}};},
        async getFile(){const b=Array.from(files.get(name));if(tamper && b.length)b[0]^=0xff;return fileFrom(b);}
      };
    }
  };
  return {root,files,dirs,setTamper(v){tamper=v;},setAllowed(v){allow=v;}};
}
function planFor(fileId,bytes,{submissionId=uuid(),pathOverride}={}){
  const room=uuid(),activity=uuid(),student=uuid(),path=pathOverride||`ENTREGAS/${room}/${activity}/${student}/${submissionId}/`+'a'.repeat(32)+'.pdf';
  return {submissionId,files:[{fileId,name:'tarefa.pdf',size:bytes.length,sha256:'',physicalPath:path}]};
}
test('Edge writer only accepts private ENTREGAS paths',()=>{
 const sub=uuid(),valid=planFor(uuid(),[1],{submissionId:sub});
 assert.equal(safePhysicalPath(valid.files[0].physicalPath,sub)[0],'ENTREGAS');
 for(const malicious of [valid.files[0].physicalPath.replace('ENTREGAS','MATERIAIS'),
   valid.files[0].physicalPath.replace('ENTREGAS','ENTREGAS/..'),
   valid.files[0].physicalPath.replace('a'.repeat(32)+'.pdf','evil.exe')]){
  assert.throws(()=>safePhysicalPath(malicious,sub));
 }
 assert.throws(()=>safePhysicalPath(valid.files[0].physicalPath,uuid()));
});
test('Edge writer checks hash before and after physically saving file, with no overwrite',async()=>{
 const dir=directoryFactory(),fileId=uuid(),raw=[1,2,3],source=fileFrom(raw),plan=planFor(fileId,raw);
 plan.files[0].sha256=await checksum(source,webcrypto.subtle);
 const args={rootHandle:dir.root,plan,files:[{fileId,name:'tarefa.pdf',file:source}],subtle:webcrypto.subtle};
 const evidence=await writeVerifiedSubmission(args);
 assert.deepEqual(evidence,[{fileId,size:3,sha256:plan.files[0].sha256}]);
 await assert.rejects(writeVerifiedSubmission(args),/Ja existe arquivo fisico/);
});
test('Edge writer rejects forged file checksum without creating folders',async()=>{
 const dir=directoryFactory(),fileId=uuid(),file=fileFrom([1,2,3]),plan=planFor(fileId,[1,2,3]);
 plan.files[0].sha256='0'.repeat(64);
 await assert.rejects(writeVerifiedSubmission({rootHandle:dir.root,plan,files:[{fileId,name:'tarefa.pdf',file}],subtle:webcrypto.subtle}),/Integridade/);
 assert.equal(dir.dirs.size,0);
});
test('Edge writer re-reads physical bytes and denies corrupted writes',async()=>{
 const dir=directoryFactory(),fileId=uuid(),file=fileFrom([1,2,3]),plan=planFor(fileId,[1,2,3]);
 plan.files[0].sha256=await checksum(file,webcrypto.subtle);
 // directoryFactory nested root controls are separate; monkey patch handles on deepest directory when created
 const first=await dir.root.getDirectoryHandle('ENTREGAS');const d2=await first.getDirectoryHandle(plan.files[0].physicalPath.split('/')[1]);
 const d3=await d2.getDirectoryHandle(plan.files[0].physicalPath.split('/')[2]);const d4=await d3.getDirectoryHandle(plan.files[0].physicalPath.split('/')[3]);
 const d5=await d4.getDirectoryHandle(plan.submissionId);
 const original=d5.getFileHandle.bind(d5);d5.getFileHandle=async(...arg)=>{const h=await original(...arg);return {...h,async getFile(){const file=await h.getFile();const bytes=Array.from(new Uint8Array(await file.arrayBuffer()));bytes[0]^=0xff;return fileFrom(bytes);}};};
 await assert.rejects(writeVerifiedSubmission({rootHandle:dir.root,plan,files:[{fileId,name:'tarefa.pdf',file}],subtle:webcrypto.subtle}),/arquivo fisico gravado nao corresponde/);
});
test('Edge writer refuses absent professor folder permission',async()=>{
 const dir=directoryFactory();dir.setAllowed(false);const fileId=uuid(),file=fileFrom([1]),plan=planFor(fileId,[1]);plan.files[0].sha256=await checksum(file,webcrypto.subtle);
 await assert.rejects(writeVerifiedSubmission({rootHandle:dir.root,plan,files:[{fileId,name:'tarefa.pdf',file}],subtle:webcrypto.subtle}),/permissao/);
});
