'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createAcademicStore}=require('../v3/academic-store');
const TEACHER=crypto.randomUUID();
const ANOTHER=crypto.randomUUID();
const KEY=crypto.randomBytes(32).toString('hex');
function fixture(){
 const rooms=new Map(),enrollments=new Map(),sessions=new Map(),activities=new Map();
 const traces=[];
 const fake={
  async query(sql,p=[]){
   traces.push({sql,p});
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rowCount:0,rows:[]};
   if(sql.includes('INSERT INTO etec_v3_rooms')){
    if(p[4]!==TEACHER)return {rowCount:0,rows:[]};
    const room={id:p[0],teacher_id:p[4],title:p[1],code:p[2],pin_digest:p[3],status:'OPEN'};
    rooms.set(room.id,room);return {rowCount:1,rows:[room]};
   }
   if(sql.includes('FROM etec_v3_rooms r JOIN etec_teachers')){
    const room=rooms.get(p[0]);return room&&room.teacher_id===p[1]&&room.status==='OPEN'?{rowCount:1,rows:[{id:room.id}]}:{rowCount:0,rows:[]};
   }
   if(sql.includes('INSERT INTO etec_v3_enrollments')){
    if([...enrollments.values()].some(e=>e.room_id===p[1]&&e.rm===p[4]))throw Object.assign(new Error('unique'),{code:'23505'});
    const student={id:p[0],room_id:p[1],full_name:p[2],normalized_name:p[3],rm:p[4],code_digest:p[5],active:true,code_version:1,current_session_id:null};
    enrollments.set(student.id,student);return {rowCount:1,rows:[student]};
   }
   if(sql.includes('SELECT id,pin_digest FROM etec_v3_rooms')){
    const room=[...rooms.values()].find(r=>r.code===p[0]&&r.status==='OPEN');return room?{rowCount:1,rows:[room]}:{rowCount:0,rows:[]};
   }
   if(sql.includes('FROM etec_v3_enrollments')&&sql.includes('FOR UPDATE')){
    const student=[...enrollments.values()].find(e=>e.room_id===p[0]&&e.rm===p[1]&&e.normalized_name===p[2]&&e.active);
    return student?{rowCount:1,rows:[student]}:{rowCount:0,rows:[]};
   }
   if(sql.includes('UPDATE etec_v3_student_sessions SET revoked_at')){
    for(const s of sessions.values())if((p.length===2&&s.id===p[0]&&s.enrollment_id===p[1])||(p.length===1&&s.enrollment_id===p[0]))s.revoked_at=Date.now();
    return {rowCount:1,rows:[]};
   }
   if(sql.includes('INSERT INTO etec_v3_student_sessions')){
    const s={id:p[0],enrollment_id:p[1],session_digest:p[2],code_version:p[3],revoked_at:null,expires_at:Date.now()+8*3600*1000};
    sessions.set(s.id,s);return {rowCount:1,rows:[]};
   }
   if(sql.includes('UPDATE etec_v3_enrollments SET current_session_id')){
    enrollments.get(p[0]).current_session_id=p[1];return {rowCount:1,rows:[]};
   }
   if(sql.includes('FROM etec_v3_student_sessions s')){
    const s=[...sessions.values()].find(x=>x.session_digest===p[0]);
    const e=s&&enrollments.get(s.enrollment_id),r=e&&rooms.get(e.room_id);
    return s&&!s.revoked_at&&s.expires_at>Date.now()&&e&&e.active&&e.current_session_id===s.id&&e.code_version===s.code_version&&r.status==='OPEN'
      ?{rowCount:1,rows:[{student_id:e.id,room_id:e.room_id,full_name:e.full_name,rm:e.rm}]}:{rowCount:0,rows:[]};
   }
   if(sql.includes('UPDATE etec_v3_enrollments SET active=false')){
    const e=enrollments.get(p[0]);if(!e||e.room_id!==p[1]||!e.active)return {rowCount:0,rows:[]};
    e.active=false;e.code_version++;e.current_session_id=null;return {rowCount:1,rows:[{id:e.id}]};
   }
   if(sql.includes('INSERT INTO etec_v3_activities')){
    const a={id:p[0],room_id:p[1],title:p[2],description:p[3],deadline_at:p[4],allowed_extensions:p[5],accept_late:p[6],status:'DRAFT'};
    activities.set(a.id,a);return {rowCount:1,rows:[a]};
   }
   if(sql.includes('UPDATE etec_v3_activities SET status=')){
    const a=activities.get(p[0]);if(!a||a.room_id!==p[1]||a.status!=='DRAFT')return {rowCount:0,rows:[]};
    a.status='PUBLISHED';return {rowCount:1,rows:[a]};
   }
   throw new Error('SQL nao simulada: '+sql.slice(0,100));
  },async connect(){return {...fake,release(){}};}
 };
 return {store:createAcademicStore({pool:fake,hmacKey:KEY}),rooms,enrollments,sessions,activities,traces};
}
test('room ownership is checked and no raw PIN is persisted',async()=>{
 const {store,rooms}=fixture();
 await assert.rejects(store.createRoom({teacherId:ANOTHER,title:'Banco de Dados'}),/Professor nao autorizado/);
 const {room,pin}=await store.createRoom({teacherId:TEACHER,title:'Banco de Dados'});
 assert.match(room.code,/^[A-Z2-9]{10}$/);assert.equal(pin.length,16);
 assert.notEqual(rooms.get(room.id).pin_digest,pin);
 await assert.rejects(store.enrollStudent({teacherId:ANOTHER,roomId:room.id,name:'João Silva',rm:'0007'}),/sem permissao/);
});
test('student enrollment uses individualized secret and one persistent active session',async()=>{
 const {store,enrollments,sessions}=fixture();
 const {room,pin}=await store.createRoom({teacherId:TEACHER,title:'Sala 1 DS'});
 const {student,individualCode}=await store.enrollStudent({teacherId:TEACHER,roomId:room.id,name:'João da Silva',rm:'0007'});
 assert.equal(student.rm,'0007');assert.notEqual(enrollments.get(student.id).code_digest,individualCode);
 await assert.rejects(store.authenticateStudent({roomCode:room.code,pin,name:'João da Silva',rm:'0007',individualCode:'ERRADO'}),/Credenciais invalidas/);
 const credentials={roomCode:room.code,pin,name:'JOÃO  DA   SILVA',rm:'0007',individualCode};
 const s1=await store.authenticateStudent(credentials);
 assert.equal((await store.authorizeStudentSession(s1.sessionToken)).studentId,student.id);
 const s2=await store.authenticateStudent(credentials);
 await assert.rejects(store.authorizeStudentSession(s1.sessionToken),/Credenciais invalidas/);
 assert.equal((await store.authorizeStudentSession(s2.sessionToken)).rm,'0007');
 assert.equal([...sessions.values()].filter(s=>!s.revoked_at).length,1);
 await store.deactivateStudent({teacherId:TEACHER,roomId:room.id,studentId:student.id});
 await assert.rejects(store.authorizeStudentSession(s2.sessionToken),/Credenciais invalidas/);
 await assert.rejects(store.authenticateStudent(credentials),/Credenciais invalidas/);
});
test('activities start as drafts and can only be published by their room teacher',async()=>{
 const {store}=fixture();
 const {room}=await store.createRoom({teacherId:TEACHER,title:'Turma teste'});
 await assert.rejects(store.createActivity({teacherId:ANOTHER,roomId:room.id,title:'Exercicio SQL',deadlineAt:'2026-11-02T23:59:00-03:00'}),/sem permissao/);
 const a=await store.createActivity({teacherId:TEACHER,roomId:room.id,title:'Exercicio SQL',description:'Entregue PDF',deadlineAt:'2026-11-02T23:59:00-03:00',allowedExtensions:['.pdf']});
 assert.equal(a.status,'DRAFT');
 assert.equal((await store.publishActivity({teacherId:TEACHER,roomId:room.id,activityId:a.id})).status,'PUBLISHED');
 await assert.rejects(store.publishActivity({teacherId:TEACHER,roomId:room.id,activityId:a.id}),/indisponivel/);
});
test('fails closed on missing keys, invalid data and unauthenticated session',async()=>{
 assert.throws(()=>createAcademicStore({pool:{query(){},connect(){}},hmacKey:'1234'}),/32 bytes/);
 const {store}=fixture();
 await assert.rejects(store.createRoom({teacherId:ANOTHER,title:'X'}),/invalido/);
 await assert.rejects(store.authorizeStudentSession('invalid'),/Credenciais invalidas/);
});
