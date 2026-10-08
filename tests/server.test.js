'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const net = require('node:net');

async function findPort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});s.once('error',reject);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let child,base;
async function post(route,data){const res=await fetch(base+'/api/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const body=await res.json();return {code:res.status,body};}
async function receive(token,condition,limit=10000){
  const deadline=Date.now()+limit;
  while(Date.now()<deadline){
    const a=await post('poll',{token});
    if(a.code!==200)throw new Error('poll falhou '+JSON.stringify(a));
    const matches=a.body.events.find(condition);
    if(matches)return matches;
  }
  throw new Error('Evento esperado nao recebido.');
}
test.before(async()=>{
  const port=await findPort();base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['server.js'],{cwd:__dirname+'/..',env:{...process.env,PORT:String(port)},stdio:'pipe'});
  for(let i=0;i<35;i++) { try {const r=await fetch(base+'/healthz');if(r.ok)return;}catch{}await sleep(120); }
  throw Error('Servidor nao iniciou');
});
test.after(()=>{if(child)child.kill();});

test('site, sala, protecao, lista, download e upload em eventos intermediados',async()=>{
  const page=await fetch(base+'/');assert.equal(page.status,200);
  assert.match(await page.text(),/ETEC • Arquivos da Aula/);
  const created=await post('create',{});assert.equal(created.code,200);
  const {code,pin,token:teacherToken}=created.body;
  assert.match(code,/^[A-Z2-9]{8}$/);assert.equal(pin.length,16);
  const wrong=await post('join',{code,pin:'SENHAERRADA'});assert.equal(wrong.code,401);
  const joined=await post('join',{code,pin});assert.equal(joined.code,200);
  const studentToken=joined.body.token;
  const request={type:'request',id:'list-1',op:'list',path:[]};
  assert.equal((await post('send',{token:studentToken,message:request})).code,200);
  const ev=await receive(teacherToken,e=>e.type==='request');
  assert.equal(ev.op,'list');assert.equal(ev.from,joined.body.studentId);
  assert.equal((await post('send',{token:teacherToken,message:{type:'answer',to:ev.from,id:ev.id,phase:'done',entries:[{name:'aula.pdf',kind:'file'}]}})).code,200);
  const list=await receive(studentToken,e=>e.type==='answer');
  assert.equal(list.entries[0].name,'aula.pdf');
  const badPath=await post('send',{token:studentToken,message:{type:'request',id:'bad',op:'list',path:['..']}});
  assert.equal(badPath.code,400);
  const download={type:'request',id:'down1',op:'download',path:[],name:'aula.pdf'};
  assert.equal((await post('send',{token:studentToken,message:download})).code,200);
  const downRequest=await receive(teacherToken,e=>e.type==='request'&&e.id==='down1');
  assert.equal(downRequest.op,'download');
  await post('send',{token:teacherToken,message:{type:'answer',id:'down1',to:ev.from,phase:'ready',size:3,name:'aula.pdf'}});
  assert.equal((await receive(studentToken,e=>e.type==='answer'&&e.id==='down1')).size,3);
  await post('send',{token:studentToken,message:{type:'pull',id:'down1'}});
  await receive(teacherToken,e=>e.type==='pull'&&e.id==='down1');
  await post('send',{token:teacherToken,message:{type:'chunk',id:'down1',to:ev.from,data:Buffer.from('ABC').toString('base64')}});
  const body=await receive(studentToken,e=>e.type==='chunk'&&e.id==='down1');assert.equal(Buffer.from(body.data,'base64').toString(),'ABC');
  await post('send',{token:studentToken,message:{type:'pull',id:'down1'}});
  await receive(teacherToken,e=>e.type==='pull'&&e.id==='down1');
  await post('send',{token:teacherToken,message:{type:'answer',id:'down1',to:ev.from,phase:'done'}});
  assert.equal((await receive(studentToken,e=>e.type==='answer'&&e.phase==='done'&&e.id==='down1')).phase,'done');
  await post('send',{token:studentToken,message:{type:'request',id:'up1',op:'upload',path:['Trabalhos'],name:'entrega.txt',size:2}});
  const uploadRequest=await receive(teacherToken,e=>e.id==='up1');assert.equal(uploadRequest.size,2);
  await post('send',{token:teacherToken,message:{type:'answer',id:'up1',to:ev.from,phase:'ready',savedName:'entrega.txt'}});
  await receive(studentToken,e=>e.phase==='ready'&&e.id==='up1');
  await post('send',{token:studentToken,message:{type:'chunk',id:'up1',data:Buffer.from('OK').toString('base64')}});
  await receive(teacherToken,e=>e.type==='chunk'&&e.id==='up1');
  await post('send',{token:teacherToken,message:{type:'ack',id:'up1',to:ev.from}});
  await receive(studentToken,e=>e.type==='ack'&&e.id==='up1');
  await post('send',{token:studentToken,message:{type:'finish',id:'up1'}});
  await receive(teacherToken,e=>e.type==='finish'&&e.id==='up1');
  await post('send',{token:teacherToken,message:{type:'answer',id:'up1',to:ev.from,phase:'done',savedName:'entrega.txt'}});
  assert.equal((await receive(studentToken,e=>e.phase==='done'&&e.id==='up1')).savedName,'entrega.txt');
  const forbidden=await post('send',{token:studentToken,message:{type:'request',id:'bad2',op:'upload',path:[],name:'aaa.txt',size:41943041}});
  assert.equal(forbidden.code,400);
  const closed=await post('close',{token:teacherToken});assert.equal(closed.code,200);
  const after=await post('join',{code,pin});assert.equal(after.code,401);
});
