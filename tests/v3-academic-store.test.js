'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createAcademicStore}=require('../v3/academic-store');
const KEY=crypto.randomBytes(32).toString('hex'),OWNER=crypto.randomUUID(),OTHER=crypto.randomUUID();
function fakeDatabase(){
 const rooms=new Map(),students=new Map(),sessions=new Map(),activities=new Map();
 const db={async query(q,p=[]){
  if(['BEGIN','COMMIT','ROLLBACK'].includes(q))return {rowCount:0,rows:[]};
  if(q.includes('INSERT INTO etec_v3_rooms')){if(p[4]!==OWNER)return {rowCount:0,rows:[]};const row={id:p[0],teacher_id:p[4],title:p[1],code:p[2],pin_digest:p[3],status:'OPEN'};rooms.set(row.id,row);return {rowCount:1,rows:[row]};}
  if(q.includes('FROM etec_v3_rooms r JOIN etec_teachers')){const r=rooms.get(p[0]);return r&&r.teacher_id===p[1]&&r.status==='OPEN'?{rowCount:1,rows:[r]}:{rowCount:0,rows:[]};}
  if(q.includes('INSERT INTO etec_v3_enrollments')){const s={id:p[0],room_id:p[1],full_name:p[2],normalized_name:p[3],rm:p[4],code_digest:p[5],active:true,code_version:1,current_session_id:null};students.set(s.id,s);return {rowCount:1,rows:[s]};}
  if(q.includes('SELECT id,pin_digest FROM etec_v3_rooms')){const r=[...rooms.values()].find(x=>x.code===p[0]&&x.status==='OPEN');return {rowCount:r?1:0,rows:r?[r]:[]};}
  if(q.includes('FROM etec_v3_enrollments')&&q.includes('FOR UPDATE')){const s=[...students.values()].find(x=>x.room_id===p[0]&&x.rm===p[1]&&x.normalized_name===p[2]&&x.active);return {rowCount:s?1:0,rows:s?[s]:[]};}
  if(q.includes('UPDATE etec_v3_student_sessions SET revoked_at')){for(const s of sessions.values())if((p.length===2&&s.id===p[0]&&s.enrollment_id===p[1])||(p.length===1&&s.enrollment_id===p[0]))s.revoked_at=true;return {rowCount:1,rows:[]};}
  if(q.includes('INSERT INTO etec_v3_student_sessions')){sessions.set(p[0],{id:p[0],enrollment_id:p[1],session_digest:p[2],code_version:p[3],revoked_at:false});return {rowCount:1,rows:[]};}
  if(q.includes('UPDATE etec_v3_enrollments SET current_session_id')){students.get(p[0]).current_session_id=p[1];return {rowCount:1,rows:[]};}
  if(q.includes('FROM etec_v3_student_sessions s')){const s=[...sessions.values()].find(x=>x.session_digest===p[0]),e=s&&students.get(s.enrollment_id),r=e&&rooms.get(e.room_id);const ok=s&&!s.revoked_at&&e?.active&&e.current_session_id===s.id&&e.code_version===s.code_version&&r?.status==='OPEN';return {rowCount:ok?1:0,rows:ok?[{student_id:e.id,room_id:e.room_id,rm:e.rm,full_name:e.full_name}]:[]};}
  if(q.includes('UPDATE etec_v3_enrollments SET active=false')){const s=students.get(p[0]);if(!s||s.room_id!==p[1]||!s.active)return {rowCount:0,rows:[]};s.active=false;s.code_version++;s.current_session_id=null;return {rowCount:1,rows:[s]};}
  if(q.includes('INSERT INTO etec_v3_activities')){const a={id:p[0],room_id:p[1],title:p[2],status:'DRAFT'};activities.set(a.id,a);return {rowCount:1,rows:[a]};}
  if(q.includes('UPDATE etec_v3_activities SET status=')){const a=activities.get(p[0]);if(!a||a.room_id!==p[1]||a.status!=='DRAFT')return {rowCount:0,rows:[]};a.status='PUBLISHED';return {rowCount:1,rows:[a]};}
  throw new Error('SQL unexpected: '+q.slice(0,80));
 },async connect(){return {...db,release(){}};}};
 return {store:createAcademicStore({pool:db,hmacKey:KEY}),rooms,students,sessions};
}
test('room enrollment rejects another teacher and avoids plaintext secrets',async()=>{
 const {store,rooms,students}=fakeDatabase();
 await assert.rejects(store.createRoom({teacherId:OTHER,title:'Banco de Dados'}),/Professor nao autorizado/);
 const {room,pin}=await store.createRoom({teacherId:OWNER,title:'Banco de Dados'});
 assert.notEqual(rooms.get(room.id).pin_digest,pin);
 await assert.rejects(store.enrollStudent({teacherId:OTHER,roomId:room.id,name:'Joao Silva',rm:'0004'}),/Sem permissao/);
 const {student,individualCode}=await store.enrollStudent({teacherId:OWNER,roomId:room.id,name:'Joao Silva',rm:'0004'});
 assert.equal(student.rm,'0004');assert.notEqual(students.get(student.id).code_digest,individualCode);
});
test('new student login revokes former session; deactivation revokes all',async()=>{
 const {store}=fakeDatabase(),{room,pin}=await store.createRoom({teacherId:OWNER,title:'Sala teste'});
 const {student,individualCode}=await store.enrollStudent({teacherId:OWNER,roomId:room.id,name:'Joao Silva',rm:'0004'});
 const cred={roomCode:room.code,pin,name:'JOAO SILVA',rm:'0004',individualCode};
 await assert.rejects(store.authenticateStudent({...cred,individualCode:'errado'}),/Credenciais invalidas/);
 const a=await store.authenticateStudent(cred);assert.equal((await store.authorizeStudentSession(a.sessionToken)).studentId,student.id);
 const b=await store.authenticateStudent(cred);await assert.rejects(store.authorizeStudentSession(a.sessionToken),/Sessao invalida/);
 assert.equal((await store.authorizeStudentSession(b.sessionToken)).rm,'0004');
 await store.deactivateStudent({teacherId:OWNER,roomId:room.id,studentId:student.id});
 await assert.rejects(store.authorizeStudentSession(b.sessionToken),/Sessao invalida/);
});
test('teacher authorizes creation and draft publication of activities',async()=>{
 const {store}=fakeDatabase(),{room}=await store.createRoom({teacherId:OWNER,title:'Sala teste'});
 await assert.rejects(store.createActivity({teacherId:OTHER,roomId:room.id,title:'Atividade SQL',deadlineAt:'2026-11-02T23:59:00-03:00'}),/Sem permissao/);
 const a=await store.createActivity({teacherId:OWNER,roomId:room.id,title:'Atividade SQL',deadlineAt:'2026-11-02T23:59:00-03:00'});
 assert.equal(a.status,'DRAFT');
 assert.equal((await store.publishActivity({teacherId:OWNER,roomId:room.id,activityId:a.id})).status,'PUBLISHED');
 await assert.rejects(store.publishActivity({teacherId:OWNER,roomId:room.id,activityId:a.id}),/nao publicavel/);
});
