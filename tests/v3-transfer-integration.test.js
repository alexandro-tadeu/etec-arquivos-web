'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto');
const {createV3Api}=require('../v3/api');
const {createTransferRelay}=require('../v3/transfer-relay');
const {createChunkReceiver}=require('../v3/edge-storage');
const UUID=()=>crypto.randomUUID(),roomId=UUID(),teacherId=UUID(),studentId=UUID(),activityId=UUID(),submissionId=UUID(),fileId=UUID();
const content=Buffer.from('Arquivo real enviado por HTTPS para a pasta do professor.\n','utf8');
const sha=crypto.createHash('sha256').update(content).digest('hex');
function localHandle(){const files=new Map();function folder(path=''){return {name:path||'raiz',async queryPermission(){return 'granted';},async getDirectoryHandle(name){return folder(path+'/'+name);},async getFileHandle(name,{create}={}){const id=path+'/'+name;if(!create&&!files.has(id)){const e=Error('Not found');e.name='NotFoundError';throw e;}if(create&&!files.has(id))files.set(id,Buffer.alloc(0));return {async createWritable(){let bytes=[];return {async write(arr){bytes.push(Buffer.from(arr));},async close(){files.set(id,Buffer.concat(bytes));},async abort(){bytes=[];}};},async getFile(){const v=files.get(id);return {size:v.length,async arrayBuffer(){return Uint8Array.from(v).buffer;}};}};}};}return {root:folder(),files};}
function mock(){let saved=null;const privateFile={fileId,name:'Atividade.pdf',size:content.length,sha256:sha,physicalPath:['ENTREGAS',roomId,activityId,studentId,submissionId,UUID().replace(/-/g,'')+'.pdf'].join('/')};const submissions={
 async begin(){return {submissionId,version:'V001',status:'STAGING',files:[{fileId,name:privateFile.name,size:content.length}]};},
 async studentPlan({studentId:s,roomId:r,submissionId:id}){assert.equal(s,studentId);assert.equal(r,roomId);assert.equal(id,submissionId);return {files:[{fileId,name:privateFile.name,size:content.length}]};},
 async teacherPlan({teacherId:t,submissionId:id}){assert.equal(t,teacherId);assert.equal(id,submissionId);return {submissionId,files:[privateFile]};},
 async commit({teacherId:t,submissionId:id,evidence,edgeWriteVerified}){assert.equal(t,teacherId);assert.equal(id,submissionId);assert.equal(edgeWriteVerified,true);assert.deepEqual(evidence,[{fileId,size:content.length,sha256:sha}]);saved='ETEC-COMPROVANTE-01';return {status:'COMMITTED',protocol:saved};}}
 const academic={async assertRoomOwner({teacherId:t,roomId:r}){assert.equal(t,teacherId);assert.equal(r,roomId);},async ownerForRoom({roomId:r}){assert.equal(r,roomId);return teacherId;}};
 const store={...academic,async authenticateStudent(){return {sessionToken:'z'.repeat(43)};},async authorizeStudentSession(){return {studentId,roomId};},async listStudentReceipts(){return saved?[{protocol:saved}]:[];}};
 return {submissions,academic,store,privateFile};}
async function startApp(){const mocks=mock(),relay=createTransferRelay({academic:mocks.academic,submissions:mocks.submissions});const route=createV3Api({store:mocks.store,submissionStore:mocks.submissions,transferRelay:relay,getPrincipal:async()=>({role:'teacher',id:teacherId}),secureCookies:false});const server=http.createServer((req,res)=>route(req,res,new URL(req.url,'http://localhost').pathname));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;return {...mocks,base,close:()=>new Promise(resolve=>server.close(resolve))};}
async function request(app,path,data,cookie){const r=await fetch(app.base+'/api/v3/'+path,{method:'POST',headers:{'content-type':'application/json',origin:app.base,...(cookie?{cookie}:{})},body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw new Error(path+': '+r.status+' '+JSON.stringify(body));return {body,cookie:r.headers.get('set-cookie')};}
async function until(fn,attempts=50){for(let i=0;i<attempts;i++){const v=await fn();if(v)return v;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Timed out');}
test('direct teacher commit is blocked and staged data hides physical destinations',async()=>{
 const app=await startApp();try{
  const login=await request(app,'student/login',{roomCode:'any'}),cookie=login.cookie.split(';')[0];
  const plan=(await request(app,'student/submissions/begin',{activityId,requestKey:UUID(),files:[{name:'Atividade.pdf',size:content.length,sha256:sha}]},cookie)).body;
  assert.equal(plan.status,'STAGING');assert.equal(JSON.stringify(plan).includes('ENTREGAS'),false);
  const response=await fetch(app.base+'/api/v3/teacher/submissions/commit',{method:'POST',headers:{origin:app.base,'content-type':'application/json'},body:JSON.stringify({submissionId,evidence:[{fileId,size:content.length,sha256:sha}]})});
  assert.equal(response.status,410);
  assert.deepEqual((await app.store.listStudentReceipts()),[]);
 }finally{await app.close();}
});
test('full chunk transfer with active teacher and SHA-256 verification produces Neon receipt',async()=>{
 const app=await startApp(),{root,files}=localHandle(),receiver=createChunkReceiver({rootHandle:root,subtle:crypto.webcrypto.subtle});
 let running=true;try{
  const login=await request(app,'student/login',{roomCode:'any'}),cookie=login.cookie.split(';')[0];
  const processed=[];
  const loop=(async()=>{while(running){const {body}=await request(app,'teacher/relay/poll',{roomId});for(const evt of body.events){try{
   if(evt.type==='start'){await receiver.start(evt);await request(app,'teacher/relay/ready',{roomId,transferId:evt.transferId});}
   if(evt.type==='chunk'){await receiver.append({transferId:evt.transferId,seq:evt.seq,bytes:Uint8Array.from(Buffer.from(evt.data,'base64'))});await request(app,'teacher/relay/ack',{roomId,transferId:evt.transferId,seq:evt.seq});}
   if(evt.type==='finish'){const evidence=await receiver.finish(evt.transferId);processed.push((await request(app,'teacher/relay/complete',{roomId,transferId:evt.transferId,evidence})).body);running=false;}
  }catch(e){running=false;throw e;}}}})();
  const prep=(await request(app,'student/submissions/begin',{activityId,requestKey:UUID(),files:[{name:'Atividade.pdf',size:content.length,sha256:sha}]},cookie)).body;
  const started=(await request(app,'student/transfer/begin',{submissionId,fileId},cookie)).body;
  await until(async()=>{const x=(await request(app,'student/transfer/status',{transferId:started.transferId},cookie)).body;return x.status==='READY';});
  const ack=(await request(app,'student/transfer/chunk',{transferId:started.transferId,seq:0,data:content.toString('base64')},cookie)).body;
  assert.equal(ack.received,content.length);
  await request(app,'student/transfer/finish',{transferId:started.transferId},cookie);
  await until(async()=>{const x=(await request(app,'student/transfer/status',{transferId:started.transferId},cookie)).body;return x.protocol;});
  await loop;
  assert.equal(processed[0].status,'COMMITTED');assert.equal(processed[0].protocol,'ETEC-COMPROVANTE-01');
  assert.equal(files.size,1);assert.deepEqual([...files.values()][0],content);
  assert.equal((await request(app,'student/transfer/status',{transferId:started.transferId},cookie)).body.protocol,'ETEC-COMPROVANTE-01');
 }finally{running=false;await app.close();}
});
