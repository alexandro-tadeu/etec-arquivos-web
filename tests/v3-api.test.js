'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createV3Api}=require('../v3/api');
const T='a'.repeat(43);
async function fixture(){
 let uses=0;
 const student={studentId:'00000000-0000-4000-8000-000000000001',roomId:'00000000-0000-4000-8000-000000000002',rm:'0007',name:'Joao Silva'};
 const store={
  async authenticateStudent(data){uses++;if(data.individualCode!=='valid')throw Object.assign(new Error('Credenciais invalidas'),{status:401});return {sessionToken:T};},
  async authorizeStudentSession(token){if(token!==T)throw Object.assign(new Error('Nao autenticado'),{status:401});return student;},
  async revokeStudentSession(token){return {revoked:token===T};},
  async listStudentActivities(s){assert.equal(s.studentId,student.studentId);return [{id:'act1',title:'SQL'}];},
  async listStudentReceipts(s){assert.equal(s.studentId,student.studentId);return [{protocol:'REC-001',version:1}];},
  async listTeacherRooms(x){return [{id:'r1',teacherId:x.teacherId}];},
  async createRoom(x){return {room:{title:x.title},pin:'SECRET'};},
  async listEnrollments(){return [{id:'s1',rm:'0007'}];},
  async enrollStudent(x){return {student:{name:x.name,rm:x.rm},individualCode:'ONE-TIME'};},
  async deactivateStudent(){return {deactivated:true};},
  async resetStudentCode(x){return {student:{id:x.studentId},individualCode:'ROTATED-ONLY-ONCE'};},
  async listTeacherActivities(){return [{id:'act1'}];},
  async createActivity(x){return {id:'act1',title:x.title,status:'DRAFT'};},
  async publishActivity(){return {id:'act1',status:'PUBLISHED'};}
 };
 let role='teacher';const handle=createV3Api({store,getPrincipal:async()=>role==='teacher'?{role:'teacher',id:'teacher1'}:role==='admin'?{role:'admin',id:'admin'}:null,secureCookies:false});
 const server=http.createServer((req,res)=>handle(req,res,new URL(req.url,'http://localhost').pathname));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 return {base,close:()=>new Promise(resolve=>server.close(resolve)),setRole:r=>role=r,uses:()=>uses};
}
async function request(base,path,method='GET',data,extra={}){
 const headers={...extra};if(method==='POST'){headers['content-type']='application/json';headers.origin=extra.origin||base;}
 const res=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data),redirect:'manual'});
 const parsed=await res.json();return {status:res.status,data:parsed,cookie:res.headers.get('set-cookie')};
}
test('v3 academic API separates teacher from student and uses HttpOnly session cookie',async()=>{
 const f=await fixture();try{
  assert.equal((await request(f.base,'/api/v3/teacher/rooms')).status,200);
  const denied=await request(f.base,'/api/v3/student/me');assert.equal(denied.status,401);
  const wrong=await request(f.base,'/api/v3/student/login','POST',{roomCode:'ROOM',individualCode:'wrong'});assert.equal(wrong.status,401);
  const login=await request(f.base,'/api/v3/student/login','POST',{roomCode:'ROOM',individualCode:'valid'});
  assert.equal(login.status,200);assert.match(login.cookie,/HttpOnly/);assert.match(login.cookie,/SameSite=Strict/);
  assert.equal(JSON.stringify(login.data).includes(T),false);
  const cookie=login.cookie.split(';')[0];
  assert.equal((await request(f.base,'/api/v3/student/me','GET',undefined,{cookie})).data.student.rm,'0007');
  assert.equal((await request(f.base,'/api/v3/student/activities','GET',undefined,{cookie})).data.activities[0].title,'SQL');
  assert.equal((await request(f.base,'/api/v3/student/receipts','GET',undefined,{cookie})).data.receipts[0].protocol,'REC-001');
  const rotated=await request(f.base,'/api/v3/teacher/enrollments/reset-code','POST',{roomId:'r1',studentId:'s1'});
  assert.equal(rotated.status,200);assert.equal(rotated.data.individualCode,'ROTATED-ONLY-ONCE');
  f.setRole('admin');assert.equal((await request(f.base,'/api/v3/teacher/rooms')).status,403);
  assert.equal((await request(f.base,'/api/v3/teacher/enrollments/reset-code','POST',{roomId:'r1',studentId:'s1'})).status,403);
  f.setRole(null);assert.equal((await request(f.base,'/api/v3/teacher/rooms','POST',{title:'Teste'})).status,403);
  const logout=await request(f.base,'/api/v3/student/logout','POST',{}, {cookie});assert.equal(logout.status,200);assert.match(logout.cookie,/Max-Age=0/);
 }finally{await f.close();}
});
test('v3 POST refuses cross-site origin and non-json bodies',async()=>{
 const f=await fixture();try{
  let r=await request(f.base,'/api/v3/student/login','POST',{individualCode:'valid'},{origin:'https://attacker.example'});
  assert.equal(r.status,403);assert.equal(f.uses(),0);
  const resp=await fetch(f.base+'/api/v3/student/login',{method:'POST',headers:{origin:f.base,'content-type':'text/plain'},body:'{}'});
  assert.equal(resp.status,415);
  r=await request(f.base,'/api/v3/unknown','POST',{});assert.equal(r.status,404);
 }finally{await f.close();}
});
