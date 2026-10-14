'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const root=path.join(__dirname,'..');
async function freePort(){return new Promise((resolve,reject)=>{
  const s=net.createServer();
  s.once('error',reject);
  s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});
});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('professor room survives grace and account TTL, and only explicit close removes it',async()=>{
  const port=await freePort(),base='http://127.0.0.1:'+port;
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'etec-session-test-'));
  const p=spawn(process.execPath,['server.js'],{
    cwd:root,
    env:{...process.env,NODE_ENV:'test',PORT:String(port),ADMIN_PASSWORD:'Teste-Senha-Admin-2026',
      DATABASE_URL:'',ETEC_V3_API_ENABLED:'false',
      TEACHERS_FILE:path.join(tmp,'teachers.json'),
      ETEC_TEST_GRACE_MS:'300',ETEC_TEST_LOGIN_TTL_MS:'850',ETEC_TEST_CLEAN_MS:'80'},
    stdio:'pipe'
  });
  async function post(route,data,cookie=''){
    const r=await fetch(base+'/api/'+route,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)});
    const b=await r.json();
    return {status:r.status,data:b,cookie:r.headers.get('set-cookie')};
  }
  try{
    let ready=false;
    for(let i=0;i<50;i++){
      try{ready=(await fetch(base+'/healthz')).ok;if(ready)break;}catch{}
      await sleep(100);
    }
    assert.ok(ready,'server should start');
    const login=await post('admin/login',{username:'admin',password:'Teste-Senha-Admin-2026'});
    assert.equal(login.status,200);
    const cookie=login.cookie.split(';')[0];
    const room=await post('create',{},cookie);
    assert.equal(room.status,200);
    assert.match(room.cookie||'',/Max-Age=604800/,'room cookie persists while room remains open');
    await sleep(1450); // surpass both heartbeat grace and original login TTL
    const health=await (await fetch(base+'/healthz')).json();
    assert.equal(health.rooms,1,'room must not close automatically');
    const waitPoll=post('poll',{token:room.data.token},cookie);
    const joined=await post('join',{code:room.data.code,pin:room.data.pin,name:'Aluno Teste'});
    const renewed=await waitPoll;
    assert.equal(renewed.status,200,'teacher can resume polling after grace/TTL');
    assert.match(renewed.cookie||'',/etec_login=/,'refresh login cookie while active');
    assert.equal(joined.status,200,'room accepts students after professor reconnects');
    const ended=await post('close',{token:room.data.token},cookie);
    assert.equal(ended.status,200,'manual stop works');
    const after=await (await fetch(base+'/healthz')).json();
    assert.equal(after.rooms,0,'manual closure removes the room');
    assert.equal((await post('join',{code:room.data.code,pin:room.data.pin,name:'Aluno Teste'})).status,401);
  }finally{
    p.kill();
    fs.rmSync(tmp,{recursive:true,force:true});
  }
});
