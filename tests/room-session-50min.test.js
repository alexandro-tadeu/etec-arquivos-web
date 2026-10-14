'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const root=path.join(__dirname,'..');
async function freePort(){return new Promise((ok,no)=>{const s=net.createServer();s.once('error',no);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p));});});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('50-minute lease is server-enforced, manually renewed and automatically closed after timeout',async()=>{
 const port=await freePort(),base='http://127.0.0.1:'+port;
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'etec-lease-test-'));
 const proc=spawn(process.execPath,['server.js'],{cwd:root,env:{
   ...process.env,PORT:String(port),NODE_ENV:'test',DATABASE_URL:'',ETEC_V3_API_ENABLED:'false',
   ADMIN_PASSWORD:'Teste-Admin-Sessao-2026',TEACHERS_FILE:path.join(temp,'users.json'),
   ETEC_TEST_SESSION_MS:'1400',ETEC_TEST_CLEAN_MS:'60'
 },stdio:'pipe'});
 async function post(route,data,cookie=''){
  const r=await fetch(base+'/api/'+route,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)});
  return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};
 }
 try{
  let ready=false;for(let i=0;i<60;i++){try{ready=(await fetch(base+'/healthz')).ok;if(ready)break;}catch{}await sleep(100);}
  assert.ok(ready,'server starts');
  const login=await post('admin/login',{username:'admin',password:'Teste-Admin-Sessao-2026'});
  assert.equal(login.status,200);const cookie=login.cookie.split(';')[0];
  const room=await post('create',{},cookie);
  assert.equal(room.status,200);
  assert.equal(room.body.durationMinutes,50);
  assert.ok(Date.parse(room.body.expiresAt)>Date.now());
  const student=await post('join',{code:room.body.code,pin:room.body.pin,name:'Aluno Exemplo'});
  assert.equal(student.status,200);
  assert.ok(Date.parse(student.body.expiresAt)<=Date.parse(room.body.expiresAt));
  await sleep(180);
  const renewed=await post('renew',{token:room.body.token},cookie);
  assert.equal(renewed.status,200);
  assert.ok(Date.parse(renewed.body.expiresAt)>Date.parse(room.body.expiresAt));
  const before=await post('renew',{token:student.body.token});
  assert.equal(before.status,403,'student cannot renew the room');
  const studentPoll=await post('poll',{token:student.body.token});
  assert.equal(studentPoll.status,200);
  assert.equal(Date.parse(studentPoll.body.roomExpiresAt),Date.parse(renewed.body.expiresAt));
  assert.ok(studentPoll.body.events.some(e=>e.type==='room_lease'),'teacher renewal reaches student');
  await sleep(650);
  const again=await post('renew',{token:room.body.token},cookie);
  assert.equal(again.status,200);
  assert.ok(Date.parse(again.body.expiresAt)>Date.parse(renewed.body.expiresAt));
  await sleep(1580); // expires despite any server polling
  const health=await (await fetch(base+'/healthz')).json();
  assert.equal(health.rooms,0);
  assert.equal((await post('renew',{token:room.body.token},cookie)).status,401);
  assert.equal((await post('join',{code:room.body.code,pin:room.body.pin,name:'Aluno Exemplo'})).status,401);
 }finally{proc.kill();fs.rmSync(temp,{recursive:true,force:true});}
});
test('both interfaces show shared countdown, and only teacher can renew',()=>{
 const teacher=fs.readFileSync(path.join(root,'public/professor.html'),'utf8');
 const student=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 const browser=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
 for(const id of ['teacherCountdown','renewTeacherSession'])assert.ok(teacher.includes('id="'+id+'"'));
 assert.ok(student.includes('id="studentCountdown"'));
 assert.ok(!student.includes('id="renewStudentSession"'));
 assert.match(browser,/setInterval\(updateLeaseClock,1000\)/);
 assert.match(browser,/api\('renew',\{token:state\.token\}\)/);
 assert.match(browser,/evt\.type==='room_lease'/);
});
