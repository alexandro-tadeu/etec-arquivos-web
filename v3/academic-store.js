'use strict';
// ETEC Web 3.0 — acesso persistente ao Neon. Nao ligado ao servidor legado.
const crypto = require('node:crypto');
const {comparableName,normalizeRm,createStudentSecret,SAFE_EXTENSIONS} = require('./academic');
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function code(length) {let s='';for(let i=0;i<length;i++)s+=CHARS[crypto.randomInt(CHARS.length)];return s;}
function bad(message,status=400){return Object.assign(new Error(message),{status});}
function ensure(ok,message,status){if(!ok)throw bad(message,status);}
function stringBetween(value,min,max,label){ensure(typeof value==='string'&&value.trim().length>=min&&value.trim().length<=max,label+' invalido.');return value.trim();}
function hexKey(input){ensure(typeof input==='string'&&/^[a-f0-9]{64}$/i.test(input),'V3_STUDENT_CODE_HMAC_KEY deve conter 32 bytes hexadecimais.',503);return Buffer.from(input,'hex');}
function digest(key,purpose,value){return crypto.createHmac('sha256',key).update('etec-v3:'+purpose+':'+value,'utf8').digest('hex');}
function digestEquals(a,b){return typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/i.test(a)&&/^[a-f0-9]{64}$/i.test(b)&&crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
const GENERIC_AUTH_ERROR='Credenciais invalidas ou acesso indisponivel.';
function verifyUUID(value){ensure(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),'Identificador invalido.');return value;}
function createAcademicStore({pool,hmacKey}){
  ensure(pool&&typeof pool.query==='function'&&typeof pool.connect==='function','Pool PostgreSQL obrigatorio.',503);
  const key=hexKey(hmacKey);
  async function transaction(fn){
    const client=await pool.connect();
    try {await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}
    catch(err){try{await client.query('ROLLBACK');}catch{}throw err;}
    finally{client.release();}
  }
  async function requireRoomOwner(db,roomId,teacherId){
    verifyUUID(roomId);verifyUUID(teacherId);
    const r=await db.query(`SELECT r.id FROM etec_v3_rooms r JOIN etec_teachers t ON t.id=r.teacher_id
      WHERE r.id=$1 AND r.teacher_id=$2 AND t.active=true AND r.status='OPEN' FOR UPDATE OF r`,[roomId,teacherId]);
    ensure(r.rowCount===1,'Sala nao encontrada ou sem permissao.',403);
  }
  async function createRoom({teacherId,title}){
    verifyUUID(teacherId);
    const roomTitle=stringBetween(title,3,120,'Titulo da sala');
    const pin=code(16),roomCode=code(10),id=crypto.randomUUID();
    const r=await pool.query(`INSERT INTO etec_v3_rooms(id,teacher_id,title,code,pin_digest)
      SELECT $1,t.id,$2,$3,$4 FROM etec_teachers t WHERE t.id=$5 AND t.active=true RETURNING id,title,code,status,created_at`,
      [id,roomTitle,roomCode,digest(key,'room-pin',pin),teacherId]);
    ensure(r.rowCount===1,'Professor nao autorizado.',403);
    return {room:r.rows[0],pin}; // A senha da sala aparece uma unica vez.
  }
  async function enrollStudent({teacherId,roomId,name,rm}){
    const fullName=stringBetween(name,3,180,'Nome completo');
    const normalizedName=comparableName(fullName),normalizedRm=normalizeRm(rm);
    const individualCode=createStudentSecret(),id=crypto.randomUUID();
    return transaction(async db=>{
      await requireRoomOwner(db,roomId,teacherId);
      const r=await db.query(`INSERT INTO etec_v3_enrollments
        (id,room_id,full_name,normalized_name,rm,code_digest)
        VALUES($1,$2,$3,$4,$5,$6)
        RETURNING id,room_id,full_name,rm,active,created_at`,
        [id,roomId,fullName,normalizedName,normalizedRm,digest(key,'student-code',individualCode)]);
      return {student:r.rows[0],individualCode}; // Codigo individual exibido apenas aqui.
    });
  }
  async function authenticateStudent({roomCode,pin,name,rm,individualCode}){
    // O endpoint devera implementar limitacao de tentativas antes de chamar este metodo.
    const generic=()=>bad(GENERIC_AUTH_ERROR,401);
    if(typeof roomCode!=='string'||!/^[A-Z2-9]{10}$/.test(roomCode)||
       typeof pin!=='string'||typeof individualCode!=='string'||individualCode.length>256)throw generic();
    let normalizedName,normalizedRm;
    try{normalizedName=comparableName(name);normalizedRm=normalizeRm(rm);}catch{throw generic();}
    return transaction(async db=>{
      const rr=await db.query(`SELECT id,pin_digest FROM etec_v3_rooms WHERE code=$1 AND status='OPEN'`,[roomCode]);
      if(rr.rowCount!==1||!digestEquals(rr.rows[0].pin_digest,digest(key,'room-pin',pin)))throw generic();
      const er=await db.query(`SELECT id,code_digest,code_version,current_session_id FROM etec_v3_enrollments
        WHERE room_id=$1 AND rm=$2 AND normalized_name=$3 AND active=true FOR UPDATE`,
        [rr.rows[0].id,normalizedRm,normalizedName]);
      if(er.rowCount!==1||!digestEquals(er.rows[0].code_digest,digest(key,'student-code',individualCode)))throw generic();
      const enrollment=er.rows[0];
      const sessionId=crypto.randomUUID(),sessionToken=crypto.randomBytes(32).toString('base64url');
      if(enrollment.current_session_id){
        await db.query(`UPDATE etec_v3_student_sessions SET revoked_at=clock_timestamp()
          WHERE id=$1 AND enrollment_id=$2 AND revoked_at IS NULL`,[enrollment.current_session_id,enrollment.id]);
      }
      await db.query(`INSERT INTO etec_v3_student_sessions
        (id,enrollment_id,session_digest,code_version,expires_at)
        VALUES($1,$2,$3,$4,clock_timestamp()+interval '8 hours')`,
        [sessionId,enrollment.id,digest(key,'student-session',sessionToken),enrollment.code_version]);
      await db.query(`UPDATE etec_v3_enrollments SET current_session_id=$2 WHERE id=$1`,[enrollment.id,sessionId]);
      return {sessionToken,studentId:enrollment.id,roomId:rr.rows[0].id};
    });
  }
  async function authorizeStudentSession(sessionToken){
    if(typeof sessionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(sessionToken))throw bad(GENERIC_AUTH_ERROR,401);
    const r=await pool.query(`SELECT e.id AS student_id,e.room_id,e.rm,e.full_name
      FROM etec_v3_student_sessions s
      JOIN etec_v3_enrollments e ON e.id=s.enrollment_id AND e.active=true
        AND e.current_session_id=s.id AND e.code_version=s.code_version
      JOIN etec_v3_rooms r ON r.id=e.room_id AND r.status='OPEN'
      WHERE s.session_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`,
      [digest(key,'student-session',sessionToken)]);
    if(r.rowCount!==1)throw bad(GENERIC_AUTH_ERROR,401);
    return {studentId:r.rows[0].student_id,roomId:r.rows[0].room_id,rm:r.rows[0].rm,name:r.rows[0].full_name};
  }
  async function deactivateStudent({teacherId,roomId,studentId}){
    verifyUUID(studentId);
    return transaction(async db=>{
      await requireRoomOwner(db,roomId,teacherId);
      const r=await db.query(`UPDATE etec_v3_enrollments SET active=false,code_version=code_version+1,current_session_id=NULL
        WHERE id=$1 AND room_id=$2 AND active=true RETURNING id`,[studentId,roomId]);
      ensure(r.rowCount===1,'Matricula ativa nao encontrada.',404);
      await db.query(`UPDATE etec_v3_student_sessions SET revoked_at=clock_timestamp()
        WHERE enrollment_id=$1 AND revoked_at IS NULL`,[studentId]);
      return {deactivated:true};
    });
  }
  async function createActivity({teacherId,roomId,title,description='',deadlineAt,allowedExtensions=['.pdf'],acceptLate=false}){
    const activityTitle=stringBetween(title,3,140,'Titulo da atividade');
    ensure(typeof description==='string'&&description.length<=10000,'Descricao invalida.');
    ensure(typeof deadlineAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(deadlineAt)&&Number.isFinite(Date.parse(deadlineAt)),'Prazo com fuso horario obrigatorio.');
    ensure(typeof acceptLate==='boolean','Aceitacao de atraso invalida.');
    ensure(Array.isArray(allowedExtensions)&&allowedExtensions.length>0&&allowedExtensions.length<=SAFE_EXTENSIONS.length&&
      new Set(allowedExtensions).size===allowedExtensions.length&&allowedExtensions.every(x=>SAFE_EXTENSIONS.includes(x)),'Formatos invalidos.');
    return transaction(async db=>{
      await requireRoomOwner(db,roomId,teacherId);
      const r=await db.query(`INSERT INTO etec_v3_activities
        (id,room_id,title,description,deadline_at,allowed_extensions,accept_late)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,room_id,title,description,status,deadline_at,allowed_extensions,accept_late`,
        [crypto.randomUUID(),roomId,activityTitle,description,deadlineAt,allowedExtensions,acceptLate]);
      return r.rows[0];
    });
  }
  async function publishActivity({teacherId,roomId,activityId}){
    verifyUUID(activityId);
    return transaction(async db=>{
      await requireRoomOwner(db,roomId,teacherId);
      const r=await db.query(`UPDATE etec_v3_activities SET status='PUBLISHED',published_at=clock_timestamp()
        WHERE id=$1 AND room_id=$2 AND status='DRAFT'
        RETURNING id,room_id,title,status,published_at,deadline_at`,[activityId,roomId]);
      ensure(r.rowCount===1,'Atividade nao encontrada ou indisponivel para publicacao.',409);
      return r.rows[0];
    });
  }
  async function revokeStudentSession(sessionToken){
    if(typeof sessionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(sessionToken))return {revoked:false};
    return transaction(async db=>{
      const r=await db.query(`UPDATE etec_v3_student_sessions SET revoked_at=clock_timestamp()
        WHERE session_digest=$1 AND revoked_at IS NULL RETURNING id,enrollment_id`,[digest(key,'student-session',sessionToken)]);
      if(r.rowCount===0)return {revoked:false};
      await db.query(`UPDATE etec_v3_enrollments SET current_session_id=NULL
        WHERE id=$1 AND current_session_id=$2`,[r.rows[0].enrollment_id,r.rows[0].id]);
      return {revoked:true};
    });
  }
  async function listTeacherRooms({teacherId}){
    verifyUUID(teacherId);
    const r=await pool.query(`SELECT r.id,r.title,r.code,r.status,r.created_at
      FROM etec_v3_rooms r JOIN etec_teachers t ON t.id=r.teacher_id AND t.active=true
      WHERE r.teacher_id=$1 ORDER BY r.created_at DESC LIMIT 100`,[teacherId]);return r.rows;
  }
  async function listEnrollments({teacherId,roomId}){
    const r=await pool.query(`SELECT e.id,e.full_name,e.rm,e.active,e.created_at
      FROM etec_v3_enrollments e JOIN etec_v3_rooms r ON r.id=e.room_id
      JOIN etec_teachers t ON t.id=r.teacher_id AND t.active=true
      WHERE r.id=$1 AND r.teacher_id=$2 ORDER BY e.full_name ASC LIMIT 1000`,[verifyUUID(roomId),verifyUUID(teacherId)]);
    return r.rows;
  }
  async function listTeacherActivities({teacherId,roomId}){
    const r=await pool.query(`SELECT a.id,a.title,a.description,a.status,a.deadline_at,a.allowed_extensions,a.accept_late,a.published_at
      FROM etec_v3_activities a JOIN etec_v3_rooms r ON r.id=a.room_id
      JOIN etec_teachers t ON t.id=r.teacher_id AND t.active=true
      WHERE a.room_id=$1 AND r.teacher_id=$2 ORDER BY a.created_at DESC LIMIT 500`,[verifyUUID(roomId),verifyUUID(teacherId)]);
    return r.rows;
  }
  async function listStudentActivities({studentId,roomId}){
    const r=await pool.query(`SELECT a.id,a.title,a.description,a.status,a.deadline_at,a.allowed_extensions,a.accept_late
      FROM etec_v3_activities a JOIN etec_v3_enrollments e ON e.room_id=a.room_id
      JOIN etec_v3_rooms r ON r.id=a.room_id AND r.status='OPEN'
      WHERE e.id=$1 AND e.room_id=$2 AND e.active=true AND a.status='PUBLISHED'
      ORDER BY a.deadline_at ASC LIMIT 500`,[verifyUUID(studentId),verifyUUID(roomId)]);
    return r.rows;
  }
  async function listStudentReceipts({studentId,roomId}){
    const r=await pool.query(`SELECT sv.id,sv.version,sv.protocol,sv.completed_at,sv.is_late,sv.manifest,
      a.id AS activity_id,a.title AS activity_title
      FROM etec_v3_submission_versions sv
      JOIN etec_v3_activities a ON a.id=sv.activity_id
      JOIN etec_v3_enrollments e ON e.id=sv.enrollment_id AND e.room_id=a.room_id AND e.active=true
      JOIN etec_v3_rooms room ON room.id=e.room_id AND room.status='OPEN'
      WHERE sv.enrollment_id=$1 AND e.room_id=$2 AND sv.status='COMMITTED'
      ORDER BY sv.completed_at DESC LIMIT 500`,[verifyUUID(studentId),verifyUUID(roomId)]);
    return r.rows.map(row=>({submissionId:row.id,activityId:row.activity_id,activityTitle:row.activity_title,
      version:row.version,protocol:row.protocol,completedAt:row.completed_at,late:row.is_late,
      files:(Array.isArray(row.manifest)?row.manifest:[]).map(f=>({name:f.name,size:f.size}))}));
  }
  async function assertRoomOwner({teacherId,roomId}){
    const r=await pool.query("SELECT r.id FROM etec_v3_rooms r JOIN etec_teachers t ON t.id=r.teacher_id AND t.active=true WHERE r.id=$1 AND r.teacher_id=$2 AND r.status='OPEN'",[verifyUUID(roomId),verifyUUID(teacherId)]);
    ensure(r.rowCount===1,'Professor nao autorizado para a turma.',403);return true;
  }
  async function ownerForRoom({roomId}){
    const r=await pool.query("SELECT r.teacher_id FROM etec_v3_rooms r JOIN etec_teachers t ON t.id=r.teacher_id AND t.active=true WHERE r.id=$1 AND r.status='OPEN'",[verifyUUID(roomId)]);
    ensure(r.rowCount===1,'Turma sem professor ativo.',503);return r.rows[0].teacher_id;
  }

  async function resetStudentCode({teacherId,roomId,studentId}){
    verifyUUID(studentId);
    const individualCode=createStudentSecret();
    return transaction(async db=>{
      await requireRoomOwner(db,roomId,teacherId);
      const r=await db.query(`UPDATE etec_v3_enrollments
        SET code_digest=$3,code_version=code_version+1,current_session_id=NULL,updated_at=clock_timestamp()
        WHERE id=$1 AND room_id=$2 AND active=true
        RETURNING id,room_id,full_name,rm,code_version`,
        [studentId,roomId,digest(key,'student-code',individualCode)]);
      ensure(r.rowCount===1,'Aluno nao encontrado ou inativo.',404);
      await db.query(`UPDATE etec_v3_student_sessions SET revoked_at=clock_timestamp()
        WHERE enrollment_id=$1 AND revoked_at IS NULL`,[studentId]);
      return {student:r.rows[0],individualCode};
    });
  }
  return {createRoom,enrollStudent,resetStudentCode,authenticateStudent,authorizeStudentSession,revokeStudentSession,
    deactivateStudent,createActivity,publishActivity,listTeacherRooms,listEnrollments,listTeacherActivities,
    listStudentActivities,listStudentReceipts,assertRoomOwner,ownerForRoom};
}
module.exports={createAcademicStore};
