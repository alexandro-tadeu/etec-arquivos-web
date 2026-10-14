'use strict';
// ETEC Web v3 academic persistence. Not wired into the legacy server.
const crypto=require('node:crypto');
const {comparableName,normalizeRm,createStudentSecret,SAFE_EXTENSIONS}=require('./academic');
function fail(message,status=400){return Object.assign(new Error(message),{status});}
function requireUuid(s){if(typeof s!=='string'||! /^[0-9a-f-]{36}$/i.test(s))throw fail('Identificador invalido.');return s;}
function keyFrom(hex){if(typeof hex!=='string'||! /^[0-9a-f]{64}$/i.test(hex))throw fail('Chave criptografica ausente ou invalida.',503);return Buffer.from(hex,'hex');}
function code(size){const letters='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:size},()=>letters[crypto.randomInt(letters.length)]).join('');}
function createAcademicStore({pool,hmacKey}){
 if(!pool||typeof pool.query!=='function'||typeof pool.connect!=='function')throw fail('Neon obrigatorio.',503);
 const key=keyFrom(hmacKey);
 const mac=(domain,s)=>crypto.createHmac('sha256',key).update('etec-v3:'+domain+':'+s).digest('hex');
 const compare=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/i.test(a)&&/^[a-f0-9]{64}$/i.test(b)&&crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
 async function transaction(fn){const db=await pool.connect();try{await db.query('BEGIN');const r=await fn(db);await db.query('COMMIT');return r;}catch(e){try{await db.query('ROLLBACK');}catch{}throw e;}finally{db.release();}}
 async function ownership(db,roomId,teacherId){
  const r=await db.query("SELECT r.id FROM etec_v3_rooms r JOIN etec_teachers t ON t.id=r.teacher_id WHERE r.id=$1 AND r.teacher_id=$2 AND t.active=true AND r.status='OPEN' FOR UPDATE OF r",[requireUuid(roomId),requireUuid(teacherId)]);
  if(r.rowCount!==1)throw fail('Sem permissao sobre a sala.',403);
 }
 async function createRoom({teacherId,title}){
  if(typeof title!=='string'||title.trim().length<3||title.trim().length>120)throw fail('Titulo invalido.');
  const id=crypto.randomUUID(),pin=code(16),roomCode=code(10);
  const r=await pool.query("INSERT INTO etec_v3_rooms(id,teacher_id,title,code,pin_digest) SELECT $1,t.id,$2,$3,$4 FROM etec_teachers t WHERE t.id=$5 AND t.active=true RETURNING id,title,code,status,created_at",[id,title.trim(),roomCode,mac('room-pin',pin),requireUuid(teacherId)]);
  if(r.rowCount!==1)throw fail('Professor nao autorizado.',403);
  return {room:r.rows[0],pin};
 }
 async function enrollStudent({teacherId,roomId,name,rm}){
  const norm=comparableName(name),number=normalizeRm(rm),id=crypto.randomUUID(),secret=createStudentSecret();
  return transaction(async db=>{await ownership(db,roomId,teacherId);
   const r=await db.query("INSERT INTO etec_v3_enrollments(id,room_id,full_name,normalized_name,rm,code_digest) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,room_id,full_name,rm,active",[id,roomId,name.trim(),norm,number,mac('student-code',secret)]);
   return {student:r.rows[0],individualCode:secret};
  });
 }
 async function authenticateStudent({roomCode,pin,name,rm,individualCode}){
  const denied=()=>fail('Credenciais invalidas ou acesso indisponivel.',401);
  if(typeof roomCode!=='string'||! /^[A-Z2-9]{10}$/.test(roomCode)||typeof pin!=='string'||typeof individualCode!=='string'||individualCode.length>256)throw denied();
  let normalizedName,number;try{normalizedName=comparableName(name);number=normalizeRm(rm);}catch{throw denied();}
  return transaction(async db=>{
   const rooms=await db.query("SELECT id,pin_digest FROM etec_v3_rooms WHERE code=$1 AND status='OPEN'",[roomCode]);
   if(rooms.rowCount!==1||!compare(rooms.rows[0].pin_digest,mac('room-pin',pin)))throw denied();
   const students=await db.query("SELECT id,code_digest,code_version,current_session_id FROM etec_v3_enrollments WHERE room_id=$1 AND rm=$2 AND normalized_name=$3 AND active=true FOR UPDATE",[rooms.rows[0].id,number,normalizedName]);
   if(students.rowCount!==1||!compare(students.rows[0].code_digest,mac('student-code',individualCode)))throw denied();
   const student=students.rows[0],sessionId=crypto.randomUUID(),sessionToken=crypto.randomBytes(32).toString('base64url');
   if(student.current_session_id)await db.query("UPDATE etec_v3_student_sessions SET revoked_at=clock_timestamp() WHERE id=$1 AND enrollment_id=$2 AND revoked_at IS NULL",[student.current_session_id,student.id]);
   await db.query("INSERT INTO etec_v3_student_sessions(id,enrollment_id,session_digest,code_version,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '8 hours')",[sessionId,student.id,mac('student-session',sessionToken),student.code_version]);
   await db.query('UPDATE etec_v3_enrollments SET current_session_id=$2 WHERE id=$1',[student.id,sessionId]);
   return {sessionToken,studentId:student.id,roomId:rooms.rows[0].id};
  });
 }
 async function authorizeStudentSession(sessionToken){
  if(typeof sessionToken!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(sessionToken))throw fail('Sessao invalida.',401);
  const r=await pool.query("SELECT e.id AS student_id,e.room_id,e.rm,e.full_name FROM etec_v3_student_sessions s JOIN etec_v3_enrollments e ON e.id=s.enrollment_id AND e.active=true AND e.current_session_id=s.id AND e.code_version=s.code_version JOIN etec_v3_rooms r ON r.id=e.room_id AND r.status='OPEN' WHERE s.session_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()",[mac('student-session',sessionToken)]);
  if(r.rowCount!==1)throw fail('Sessao invalida.',401);
  return {studentId:r.rows[0].student_id,roomId:r.rows[0].room_id,rm:r.rows[0].rm,name:r.rows[0].full_name};
 }
 async function deactivateStudent({teacherId,roomId,studentId}){
  return transaction(async db=>{await ownership(db,roomId,teacherId);
   const r=await db.query('UPDATE etec_v3_enrollments SET active=false,code_version=code_version+1,current_session_id=NULL WHERE id=$1 AND room_id=$2 AND active=true RETURNING id',[requireUuid(studentId),roomId]);
   if(r.rowCount!==1)throw fail('Matricula nao encontrada.',404);
   await db.query('UPDATE etec_v3_student_sessions SET revoked_at=clock_timestamp() WHERE enrollment_id=$1 AND revoked_at IS NULL',[studentId]);
   return {deactivated:true};
  });
 }
 async function createActivity({teacherId,roomId,title,description='',deadlineAt,allowedExtensions=['.pdf'],acceptLate=false}){
  if(typeof title!=='string'||title.trim().length<3||title.trim().length>140||typeof description!=='string'||description.length>10000)throw fail('Dados da atividade invalidos.');
  if(typeof deadlineAt!=='string'||! /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(deadlineAt)||!Number.isFinite(Date.parse(deadlineAt)))throw fail('Prazo com fuso horario obrigatorio.');
  if(typeof acceptLate!=='boolean'||!Array.isArray(allowedExtensions)||allowedExtensions.length<1||new Set(allowedExtensions).size!==allowedExtensions.length||!allowedExtensions.every(e=>SAFE_EXTENSIONS.includes(e)))throw fail('Politica de arquivos invalida.');
  return transaction(async db=>{await ownership(db,roomId,teacherId);
   const r=await db.query('INSERT INTO etec_v3_activities(id,room_id,title,description,deadline_at,allowed_extensions,accept_late) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,room_id,title,description,status,deadline_at,allowed_extensions,accept_late',[crypto.randomUUID(),roomId,title.trim(),description,deadlineAt,allowedExtensions,acceptLate]);return r.rows[0];
  });
 }
 async function publishActivity({teacherId,roomId,activityId}){
  return transaction(async db=>{await ownership(db,roomId,teacherId);
   const r=await db.query("UPDATE etec_v3_activities SET status='PUBLISHED',published_at=clock_timestamp() WHERE id=$1 AND room_id=$2 AND status='DRAFT' RETURNING id,room_id,title,status,published_at,deadline_at",[requireUuid(activityId),roomId]);
   if(r.rowCount!==1)throw fail('Atividade nao publicavel.',409);return r.rows[0];
  });
 }
 return {createRoom,enrollStudent,authenticateStudent,authorizeStudentSession,deactivateStudent,createActivity,publishActivity};
}
module.exports={createAcademicStore};
