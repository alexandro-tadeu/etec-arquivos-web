'use strict';
// Registro transacional de entregas v3. NENHUM byte dos arquivos e mantido no Render ou Neon.
// O computador do professor deve finalizar a gravacao e verificar SHA-256 antes do ACK.
// Este modulo nao prova, por si so, que um navegador gravou os arquivos fisicamente.
const crypto=require('node:crypto');
const {validateManifest,evaluateSubmission,LIMITS,versionLabel}=require('./academic');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const PENDING_TTL_MS=2*60*60*1000;
function problem(message,status=400){return Object.assign(new Error(message),{status});}
function ensure(ok,message,status){if(!ok)throw problem(message,status);}
function uuid(s){ensure(typeof s==='string'&&UUID.test(s),'Identificador invalido.');return s;}
function utc(x){if(x instanceof Date)return x.toISOString();ensure(typeof x==='string'&&Number.isFinite(Date.parse(x)),'Horario invalido.');return new Date(x).toISOString();}
function policyFiles(files,activity){
 const m=validateManifest(files,activity.allowed_extensions);
 ensure(m.length<=Number(activity.max_files||LIMITS.filesPerVersion),'Quantidade excede o limite da atividade.');
 const max=Number(activity.max_file_bytes||LIMITS.bytesPerFile),total=Number(activity.max_total_bytes||LIMITS.bytesPerVersion);
 ensure(m.every(f=>f.size<=max)&&m.reduce((a,f)=>a+f.size,0)<=total,'Tamanho excede o limite da atividade.');
 return m.map((f,i)=>{const sha=files[i].sha256;ensure(typeof sha==='string'&&SHA.test(sha),'SHA-256 do arquivo invalido.');return {...f,sha256:sha};});
}
function sameManifest(a,b){return a.length===b.length&&a.every((f,i)=>f.name===b[i].name&&f.size===b[i].size&&f.sha256===b[i].sha256);}
function privatePath(roomId,activityId,studentId,submissionId,filename){
 const ext=filename.slice(filename.lastIndexOf('.')).toLowerCase();
 return ['ENTREGAS',uuid(roomId),uuid(activityId),uuid(studentId),uuid(submissionId),crypto.randomUUID().replace(/-/g,'')+ext].join('/');
}
function exceptionObject(row,studentId,activityId){return row?{studentId,activityId,approved:true,reopenClosed:row.reopen_closed,personalDeadlineAt:utc(row.personal_deadline_at)}:null;}
function toActivity(a){return {id:a.id,status:a.status,deadlineAt:utc(a.deadline_at),allowedExtensions:a.allowed_extensions,acceptLate:a.accept_late};}
function validateEvidence(expected,evidence){
 ensure(Array.isArray(evidence)&&evidence.length===expected.length,'Confirmacao fisica incompleta.');
 const seen=new Set();
 for(const file of evidence){
  ensure(file&&typeof file==='object'&&!Array.isArray(file)&&uuid(file.fileId)&&!seen.has(file.fileId),'Confirmacao duplicada ou invalida.');seen.add(file.fileId);
  const original=expected.find(f=>f.fileId===file.fileId);
  ensure(original&&Number.isSafeInteger(file.size)&&file.size===original.size&&typeof file.sha256==='string'&&SHA.test(file.sha256)&&file.sha256===original.sha256,'Integridade fisica divergente.');
 }
}
function createSubmissionStore(pool){
 ensure(pool&&typeof pool.connect==='function','PostgreSQL obrigatorio.',503);
 async function tx(fn){const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(err){try{await client.query('ROLLBACK');}catch{}throw err;}finally{client.release();}}
 async function clock(db){const r=await db.query('SELECT clock_timestamp() AS now');return utc(r.rows[0].now);}
 async function exception(db,activityId,studentId){const r=await db.query(`SELECT personal_deadline_at,reopen_closed FROM etec_v3_activity_exceptions WHERE activity_id=$1 AND enrollment_id=$2 AND revoked_at IS NULL`,[activityId,studentId]);return exceptionObject(r.rows[0],studentId,activityId);}
 async function studentContext(db,studentId,roomId,activityId){
  const r=await db.query(`SELECT a.id,a.room_id,a.status,a.deadline_at,a.allowed_extensions,a.accept_late,
      a.max_files,a.max_file_bytes,a.max_total_bytes,e.id AS enrollment_id,e.active
    FROM etec_v3_enrollments e JOIN etec_v3_rooms room ON room.id=e.room_id AND room.status='OPEN'
    JOIN etec_teachers t ON t.id=room.teacher_id AND t.active=true
    JOIN etec_v3_activities a ON a.room_id=room.id AND a.id=$3
    WHERE e.id=$1 AND e.room_id=$2 AND e.active=true FOR UPDATE OF e`,[uuid(studentId),uuid(roomId),uuid(activityId)]);
  ensure(r.rowCount===1,'Atividade ou matricula indisponivel.',403);return r.rows[0];
 }
 async function begin({studentId,roomId,activityId,requestKey,files}){
  uuid(requestKey);
  return tx(async db=>{
   const activity=await studentContext(db,studentId,roomId,activityId);
   const manifest=policyFiles(files,activity);
   const prior=await db.query('SELECT id,version,status,manifest,protocol,created_at FROM etec_v3_submission_versions WHERE activity_id=$1 AND enrollment_id=$2 AND request_key=$3 FOR UPDATE',[activityId,studentId,requestKey]);
   if(prior.rowCount){const p=prior.rows[0];ensure(sameManifest(p.manifest,manifest),'Chave de requisicao reutilizada com arquivos diferentes.',409);ensure(p.status!=='FAILED','Tentativa anterior cancelada.',409);return {submissionId:p.id,version:versionLabel(p.version),status:p.status,protocol:p.protocol||null,files:p.manifest.map(f=>({fileId:f.fileId,name:f.name,size:f.size}))};}
   const staged=await db.query("SELECT id,created_at FROM etec_v3_submission_versions WHERE activity_id=$1 AND enrollment_id=$2 AND status='STAGING' FOR UPDATE",[activityId,studentId]);
   const at=await clock(db);
   if(staged.rowCount){const old=staged.rows[0];if(Date.parse(at)-Date.parse(utc(old.created_at))<PENDING_TTL_MS)throw problem('Uma entrega ainda esta em andamento.',409);
    await db.query("UPDATE etec_v3_submission_versions SET status='FAILED' WHERE id=$1 AND status='STAGING'",[old.id]);
   }
   evaluateSubmission({activity:toActivity(activity),studentId,at,exception:await exception(db,activityId,studentId),files:manifest});
   const current=await db.query('SELECT COALESCE(MAX(version),0) AS n FROM etec_v3_submission_versions WHERE activity_id=$1 AND enrollment_id=$2',[activityId,studentId]);
   const version=Number(current.rows[0].n)+1;ensure(version<=999999,'Limite de versoes atingido.',409);
   const submissionId=crypto.randomUUID();
   const stored=manifest.map(f=>({...f,fileId:crypto.randomUUID(),physicalPath:privatePath(roomId,activityId,studentId,submissionId,f.name)}));
   await db.query(`INSERT INTO etec_v3_submission_versions(id,activity_id,enrollment_id,version,request_key,status,manifest)
      VALUES($1,$2,$3,$4,$5,'STAGING',$6::jsonb)`,[submissionId,activityId,studentId,version,requestKey,JSON.stringify(stored)]);
   return {submissionId,version:versionLabel(version),status:'STAGING',protocol:null,files:stored.map(f=>({fileId:f.fileId,name:f.name,size:f.size}))};
  });
 }
 async function teacherPlan({teacherId,submissionId}){
  const r=await pool.query(`SELECT s.id,s.status,s.manifest FROM etec_v3_submission_versions s
    JOIN etec_v3_activities a ON a.id=s.activity_id JOIN etec_v3_rooms room ON room.id=a.room_id
    JOIN etec_teachers t ON t.id=room.teacher_id AND t.active=true
    WHERE s.id=$1 AND room.teacher_id=$2`,[uuid(submissionId),uuid(teacherId)]);
  ensure(r.rowCount===1,'Entrega nao encontrada.',404);
  ensure(r.rows[0].status==='STAGING','Entrega nao disponivel para gravacao.',409);
  return {submissionId,files:r.rows[0].manifest.map(f=>({fileId:f.fileId,name:f.name,size:f.size,sha256:f.sha256,physicalPath:f.physicalPath}))};
 }
 async function commit({teacherId,submissionId,evidence,edgeWriteVerified}){
  ensure(edgeWriteVerified===true,'Gravacao fisica nao confirmada.');
  return tx(async db=>{
   const r=await db.query(`SELECT s.id,s.activity_id,s.enrollment_id,s.version,s.status,s.manifest,s.protocol,
       a.room_id,a.status AS activity_status,a.deadline_at,a.allowed_extensions,a.accept_late,a.max_files,a.max_file_bytes,a.max_total_bytes
     FROM etec_v3_submission_versions s JOIN etec_v3_activities a ON a.id=s.activity_id
     JOIN etec_v3_rooms room ON room.id=a.room_id AND room.status='OPEN'
     JOIN etec_teachers t ON t.id=room.teacher_id AND t.active=true
     JOIN etec_v3_enrollments e ON e.id=s.enrollment_id AND e.active=true AND e.room_id=room.id
     WHERE s.id=$1 AND room.teacher_id=$2 FOR UPDATE OF s`,[uuid(submissionId),uuid(teacherId)]);
   ensure(r.rowCount===1,'Sem permissao ou entrega indisponivel.',403);
   const s=r.rows[0];validateEvidence(s.manifest,evidence);
   if(s.status==='COMMITTED')return {submissionId,version:versionLabel(s.version),protocol:s.protocol,status:'COMMITTED'};
   ensure(s.status==='STAGING','Entrega nao pode ser confirmada.',409);
   const now=await clock(db);
   const result=evaluateSubmission({activity:toActivity({id:s.activity_id,status:s.activity_status,deadline_at:s.deadline_at,allowed_extensions:s.allowed_extensions,accept_late:s.accept_late}),studentId:s.enrollment_id,at:now,
     exception:await exception(db,s.activity_id,s.enrollment_id),files:s.manifest});
   const ref='EDGE-ACK-'+crypto.randomUUID();
   const protocol='ETEC-'+now.slice(0,10).replace(/-/g,'')+'-'+crypto.randomBytes(12).toString('hex').toUpperCase();
   await db.query(`UPDATE etec_v3_submission_versions SET status='COMMITTED',physical_commit_ref=$2,
      protocol=$3,completed_at=$4::timestamptz,deadline_snapshot_at=$5::timestamptz,is_late=$6
      WHERE id=$1 AND status='STAGING'`,[submissionId,ref,protocol,now,result.deadlineAt,result.late]);
   for(const file of s.manifest)await db.query(`INSERT INTO etec_v3_submission_files(id,submission_id,original_name,physical_name,size_bytes,sha256)
       VALUES($1,$2,$3,$4,$5,$6)`,[file.fileId,submissionId,file.name,file.physicalPath,file.size,file.sha256]);
   return {submissionId,version:versionLabel(s.version),protocol,status:'COMMITTED',completedAt:now,late:result.late};
  });
 }
 return {begin,teacherPlan,commit};
}
module.exports={createSubmissionStore,policyFiles,sameManifest,privatePath,validateEvidence};
