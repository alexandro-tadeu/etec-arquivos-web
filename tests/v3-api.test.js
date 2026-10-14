'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createV3Api}=require('../v3/api');
const TOKEN='a'.repeat(43);
async function fixture(){
 let role='teacher',attempts=0;
 const store={
  async authenticateStudent(data){attempts++;if(data.individualCode!=='valid')throw Object.assign(new Error('Invalid'),{status:401});return {sessionToken:TOKEN};},
  async authorizeStudentSession(token){if(token!==TOKEN)throw Object.assign(new Error('Invalid'),{status:401});return {studentId:'student-1',roomId:'room-1',rm:'0005'};},
  async revokeStudentSession(){return {revoked:true};},
  async listStudentActivities(){return [{title:'SQL'}];},
  async listStudentReceipts(){return [{protocol:'REC-001'}];},
  async listTeacherRooms(){return [{title:'Sala 1'}];},
  async createRoom({title}){return {room:{title},pin:'private'};}
 };
 const route=createV3Api({store,getPrincipal:async()=>role==='teacher'?{role:'teacher',id:'professor-1'}:{role:'admin',id:'admin'},secureCookies:false});
 const server=http.createServer((req,res)=>route(req,res,new URL(req.url,'http://localhost').pathname));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 return {base,setRole:r=>role=r,attempts:()=>attempts,close:()=>new Promise(resolve=>server.close(resolve))};
}
async function call(f,path,{method='GET',body,cookie,origin}={}){
 const headers={};if(cookie)headers.cookie=cookie;
 if(method==='POST'){headers.origin=origin||f.base;headers['content-type']='application/json';}
 const res=await fetch(f.base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 return {code:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')};
}
test('v3 student cookie and teacher separation',async()=>{
 const f=await fixture();
 try{
  assert.equal((await call(f,'/api/v3/student/me')).code,401);
  assert.equal((await call(f,'/api/v3/teacher/rooms')).code,200);
  assert.equal((await call(f,'/api/v3/student/login',{method:'POST',body:{individualCode:'bad'}})).code,401);
  const login=await call(f,'/api/v3/student/login',{method:'POST',body:{individualCode:'valid'}});
  assert.equal(login.code,200);assert.match(login.cookie,/HttpOnly/);assert.match(login.cookie,/SameSite=Strict/);
  const cookie=login.cookie.split(';')[0];
  assert.equal((await call(f,'/api/v3/student/me',{cookie})).data.student.rm,'0005');
  assert.equal((await call(f,'/api/v3/student/receipts',{cookie})).data.receipts[0].protocol,'REC-001');
  assert.equal((await call(f,'/api/v3/student/logout',{method:'POST',body:{},cookie})).code,200);
  f.setRole('admin');assert.equal((await call(f,'/api/v3/teacher/rooms')).code,403);
 }finally{await f.close();}
});
test('v3 rejects cross-origin writes before authentication',async()=>{
 const f=await fixture();
 try{
  assert.equal((await call(f,'/api/v3/student/login',{method:'POST',origin:'https://other.example',body:{individualCode:'valid'}})).code,403);
  assert.equal(f.attempts(),0);
 }finally{await f.close();}
});
