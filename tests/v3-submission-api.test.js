'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createV3Api}=require('../v3/api');
const TOKEN='A'.repeat(43);
async function fixture(){
 let role='teacher';const received=[];
 const store={
  authenticateStudent:async()=>({sessionToken:TOKEN}),
  authorizeStudentSession:async x=>{if(x!==TOKEN)throw Object.assign(new Error('bad'),{status:401});return {studentId:'s1',roomId:'r1'};},
  listTeacherRooms:async()=>[],listStudentActivities:async()=>[],listStudentReceipts:async()=>[],
 };
 const submissionStore={
  async begin(args){received.push({op:'begin',args});return {submissionId:'staged',status:'STAGING',files:[{name:'A.pdf',size:3}]};},
  async teacherPlan(args){received.push({op:'plan',args});return {submissionId:args.submissionId,files:[{physicalPath:'ENTREGAS/private'}]};},
  async commit(args){received.push({op:'commit',args});return {status:'COMMITTED',protocol:'ETEC-test'};}
 };
 const route=createV3Api({store,submissionStore,getPrincipal:async()=>role==='teacher'?{role:'teacher',id:'teacher-1'}:{role:'admin',id:'admin-1'},secureCookies:false});
 const server=http.createServer((req,res)=>route(req,res,new URL(req.url,'http://localhost').pathname));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {base:'http://127.0.0.1:'+server.address().port,received,setRole:r=>role=r,close:()=>new Promise(resolve=>server.close(resolve))};
}
async function request(f,path,{data,cookie,origin}={}){
 const headers={'content-type':'application/json'};if(cookie)headers.cookie=cookie;headers.origin=origin||f.base;
 const r=await fetch(f.base+path,{method:'POST',headers,body:JSON.stringify(data||{})});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
}
test('only student stages and authenticated teacher views private destinations; direct commit disabled',async()=>{
 const f=await fixture();try{
  const login=await request(f,'/api/v3/student/login',{data:{roomCode:'x'}});
  assert.equal(login.status,200);const cookie=login.cookie.split(';')[0];
  let r=await request(f,'/api/v3/student/submissions/begin',{cookie,data:{activityId:'a',requestKey:'k',files:[{name:'A.pdf',size:3}]}});
  assert.equal(r.status,200);assert.equal(f.received[0].args.studentId,'s1');
  assert.ok(!JSON.stringify(r.data).includes('ENTREGAS'));
  assert.equal((await request(f,'/api/v3/teacher/submissions/plan',{cookie,data:{submissionId:'a'}})).status,200);
  f.setRole('admin');assert.equal((await request(f,'/api/v3/teacher/submissions/commit',{data:{submissionId:'a',evidence:[]}})).status,410);
  f.setRole('teacher');r=await request(f,'/api/v3/teacher/submissions/commit',{data:{submissionId:'a',evidence:[{fileId:'f1'}],edgeWriteVerified:false}});
  assert.equal(r.status,410);assert.equal(f.received.some(x=>x.op==='commit'),false);
  assert.equal((await request(f,'/api/v3/student/submissions/begin',{data:{activityId:'a'}})).status,401);
 }finally{await f.close();}
});
test('submission endpoints deny cross-origin POST',async()=>{
 const f=await fixture();try{
  const r=await request(f,'/api/v3/teacher/submissions/commit',{origin:'https://evil.invalid',data:{submissionId:'abc',evidence:[]}});
  assert.equal(r.status,403);assert.equal(f.received.length,0);
 }finally{await f.close();}
});
