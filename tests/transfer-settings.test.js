'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const {DEFAULT_TRANSFER,validateTransfer}=require('../transfer-settings');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('transfer settings validate server safety limits',()=>{
 assert.deepEqual(DEFAULT_TRANSFER,{maxFileMiB:40,downloadBlockKiB:768});
 assert.deepEqual(validateTransfer({maxFileMiB:100,downloadBlockKiB:1024}),{maxFileMiB:100,downloadBlockKiB:1024});
 for(const v of [{maxFileMiB:101,downloadBlockKiB:768},{maxFileMiB:40,downloadBlockKiB:999},{maxFileMiB:0,downloadBlockKiB:48},{maxFileMiB:'40',downloadBlockKiB:768}])assert.throws(()=>validateTransfer(v));
});
test('admin settings persist, old rooms retain original limits, new rooms receive new limits',async()=>{
 const port=await new Promise((ok,no)=>{const s=net.createServer();s.once('error',no);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p));});});
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'etec-transfer-')),file=path.join(tmp,'users.json'),base='http://127.0.0.1:'+port,password='Teste-Admin-Transferencia-2026';
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),NODE_ENV:'test',DATABASE_URL:'',ETEC_V3_API_ENABLED:'false',ADMIN_PASSWORD:password,TEACHERS_FILE:file},stdio:'pipe'});
 async function post(route,data={},cookie=''){const r=await fetch(base+'/api/'+route,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)});return {code:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};}
 try{
  let ready=false;for(let i=0;i<50;i++){try{ready=(await fetch(base+'/healthz')).ok;if(ready)break;}catch{}await sleep(100);}assert.ok(ready);
  assert.equal((await post('admin/transfer/get')).code,403);
  const login=await post('admin/login',{username:'admin',password});assert.equal(login.code,200);const cookie=login.cookie.split(';')[0];
  assert.deepEqual((await post('admin/transfer/get',{},cookie)).body.settings,DEFAULT_TRANSFER);
  const old=await post('create',{},cookie);assert.equal(old.code,200);
  assert.equal((await post('admin/transfer/save',{maxFileMiB:101,downloadBlockKiB:1024},cookie)).code,400);
  const saved={maxFileMiB:80,downloadBlockKiB:1024};
  assert.deepEqual((await post('admin/transfer/save',saved,cookie)).body.settings,saved);
  assert.deepEqual(JSON.parse(fs.readFileSync(file+'.transfer.json','utf8')),saved);
  const before=await post('join',{code:old.body.code,pin:old.body.pin,name:'Aluno Teste'});assert.deepEqual(before.body.transfer,DEFAULT_TRANSFER);
  const newRoom=await post('create',{},cookie);assert.deepEqual(newRoom.body.transfer,saved);
  const after=await post('join',{code:newRoom.body.code,pin:newRoom.body.pin,name:'Aluno Teste'});assert.deepEqual(after.body.transfer,saved);
  assert.equal((await post('admin/transfer/save',DEFAULT_TRANSFER)).code,403);
  const request=(token,size,id)=>post('send',{token,message:{type:'request',id,op:'upload',path:[],name:'material.zip',size}});
  assert.equal((await request(before.body.token,41*1024*1024,'old')).code,400);
  assert.equal((await request(after.body.token,81*1024*1024,'too-large')).code,400);
  assert.equal((await request(after.body.token,41*1024*1024,'new')).code,200);
  assert.equal((await post('send',{token:after.body.token,message:{type:'cancel',id:'new'}})).code,200);
  const id='fast-new',data=Buffer.alloc(1024*1024,37);
  assert.equal((await post('send',{token:after.body.token,message:{type:'request',id,op:'download',path:[],name:'arquivo.zip',downloadBlock:1048576}})).code,200);
  const poll=await post('poll',{token:newRoom.body.token},cookie);
  const d=poll.body.events.find(e=>e.id===id);assert.equal(d.downloadBlock,1048576);
  const teacher=(message)=>post('send',{token:newRoom.body.token,message:{id,to:d.from,...message}},cookie);
  assert.equal((await teacher({type:'answer',phase:'ready',size:81*1024*1024})).code,400);
  assert.equal((await teacher({type:'answer',phase:'ready',size:data.length})).code,200);
  await post('poll',{token:after.body.token});
  assert.equal((await post('send',{token:after.body.token,message:{type:'pull',id}})).code,200);
  await post('poll',{token:newRoom.body.token},cookie);
  assert.equal((await teacher({type:'chunk',data:data.toString('base64')})).code,200);
  const received=await post('poll',{token:after.body.token});
  assert.deepEqual(Buffer.from(received.body.events.find(e=>e.type==='chunk').data,'base64'),data);
  assert.equal((await teacher({type:'answer',phase:'done'})).code,200);
 }finally{child.kill();fs.rmSync(tmp,{recursive:true,force:true});}
});
