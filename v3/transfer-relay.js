'use strict';
// Transporte transitorio: um fragmento por vez, sem armazenar bytes permanentemente.
// Confirmação física exige Edge autenticado e releitura SHA-256 pelo navegador docente.
const crypto=require('node:crypto');
const MAX_CHUNK=48*1024;
const CHUNK_TIMEOUT=28000;
const TEACHER_TTL=40000;
const QUEUE_LIMIT=128;
function problem(msg,status=400){return Object.assign(new Error(msg),{status});}
function check(ok,msg,status=400){if(!ok)throw problem(msg,status);}
function createTransferRelay({academic,submissions,now=()=>Date.now()}) {
 const connections=new Map(), transfers=new Map(), submissionEvidence=new Map();
 const active=new Map();
 function validConnection(roomId,teacherId){const s=connections.get(roomId);return s&&s.teacherId===teacherId&&now()-s.lastSeen<TEACHER_TTL?s:null;}
 async function authorizeTeacher(teacherId,roomId){await academic.assertRoomOwner({teacherId,roomId});}
 function enqueue(connection,event){check(connection.queue.length<QUEUE_LIMIT,'Fila de transferencia ocupada.',503);connection.queue.push(event);if(connection.wake){connection.wake();connection.wake=null;}}
 async function teacherPoll({teacherId,roomId}){
   await authorizeTeacher(teacherId,roomId);
   let s=connections.get(roomId);
   if(s&&s.teacherId!==teacherId){if(s.wake)s.wake();connections.delete(roomId);s=null;}
   if(!s){s={teacherId,roomId,lastSeen:now(),queue:[],wake:null};connections.set(roomId,s);}
   s.lastSeen=now();
   if(!s.queue.length){await new Promise(resolve=>{const timer=setTimeout(()=>{if(s.wake===wake)s.wake=null;resolve();},16000);function wake(){clearTimeout(timer);resolve();}s.wake=wake;});}
   s.lastSeen=now();
   return {events:s.queue.splice(0,10)};
 }
 async function beginFile({studentId,roomId,submissionId,fileId}){
   check(transfers.size<1000,'Limite de transferencias atingido.',503);
   const owner=await academic.ownerForRoom({roomId});
   const connection=validConnection(roomId,owner);
   check(connection,'Professor desconectado. Mantenha o Edge aberto.',503);
   const plan=await submissions.studentPlan({studentId,roomId,submissionId});
   const target=plan.files.find(f=>f.fileId===fileId);
   check(target,'Arquivo nao encontrado na entrega.',404);
   const key=submissionId;
   check(!active.has(key),'Existe um arquivo em transferencia para esta entrega.',409);
   const privatePlan=await submissions.teacherPlan({teacherId:owner,submissionId});
   const teacherFile=privatePlan.files.find(f=>f.fileId===fileId);
   check(teacherFile,'Plano privado nao localizado.',409);
   const transferId=crypto.randomUUID();
   const transfer={transferId,submissionId,fileId,studentId,roomId,teacherId:owner,file:teacherFile,
      stage:'REQUESTED',received:0,seq:0,pending:null,started:now()};
   transfers.set(transferId,transfer);active.set(key,transferId);
   enqueue(connection,{type:'start',transferId,submissionId,file:teacherFile});
   return {transferId,status:'REQUESTED'};
 }
 function ownTransfer({studentId,roomId,transferId}){const t=transfers.get(transferId);
   check(t&&t.studentId===studentId&&t.roomId===roomId,'Transferencia nao encontrada.',404);
   return t;
 }
 function teacherTransfer({teacherId,roomId,transferId}){const t=transfers.get(transferId);
   check(t&&t.teacherId===teacherId&&t.roomId===roomId,'Transferencia nao encontrada.',404);
   return t;
 }
 function teacherReady({teacherId,roomId,transferId}){
   const t=teacherTransfer({teacherId,roomId,transferId});
   check(t.stage==='REQUESTED','Transferencia nao aguarda preparacao.',409);t.stage='READY';return {ok:true};
 }
 function studentStatus({studentId,roomId,transferId}){
   const t=ownTransfer({studentId,roomId,transferId});
   return {status:t.stage,received:t.received,error:t.failure||null,protocol:t.protocol||null};
 }
 async function studentChunk({studentId,roomId,transferId,seq,data}){
   const t=ownTransfer({studentId,roomId,transferId});
   check(t.stage==='READY'&&!t.pending,'Professor ainda nao confirmou a pasta ou envio interrompido.',409);
   check(Number.isSafeInteger(seq)&&seq===t.seq,'Sequencia do fragmento invalida.',409);
   check(typeof data==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data),'Fragmento invalido.');
   const bytes=Buffer.from(data,'base64');
   check(bytes.length>0&&bytes.length<=MAX_CHUNK&&t.received+bytes.length<=t.file.size,'Fragmento excede o tamanho autorizado.');
   const connection=validConnection(roomId,t.teacherId);check(connection,'Professor desconectado.',503);
   check(connection.queue.length<QUEUE_LIMIT,'Fila de transferencia ocupada.',503);
   t.stage='CHUNK';
   const result=new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>{
       if(t.pending){t.pending=null;t.stage='ERROR';t.failure='Sem confirmacao do Edge.';active.delete(t.submissionId);reject(problem(t.failure,504));}
     },CHUNK_TIMEOUT);
     t.pending={seq,bytes:bytes.length,resolve:()=>{clearTimeout(timer);resolve({ok:true,nextSeq:t.seq,received:t.received});},reject:e=>{clearTimeout(timer);reject(e);}};
   });
   enqueue(connection,{type:'chunk',transferId,seq,data});
   return result;
 }
 function teacherAck({teacherId,roomId,transferId,seq}){
   const t=teacherTransfer({teacherId,roomId,transferId});
   check(t.stage==='CHUNK'&&t.pending&&t.pending.seq===seq,'Confirmacao de fragmento invalida.',409);
   const pending=t.pending;t.pending=null;t.received+=pending.bytes;t.seq++;t.stage='READY';pending.resolve();
   return {ok:true};
 }
 function finishFile({studentId,roomId,transferId}){
   const t=ownTransfer({studentId,roomId,transferId});
   check(t.stage==='READY'&&t.received===t.file.size,'Arquivo nao foi transferido integralmente.',409);
   const connection=validConnection(roomId,t.teacherId);check(connection,'Professor desconectado.',503);
   t.stage='VERIFYING';enqueue(connection,{type:'finish',transferId});return {status:'VERIFYING'};
 }
 async function teacherComplete({teacherId,roomId,transferId,evidence}){
   const t=teacherTransfer({teacherId,roomId,transferId});
   check(t.stage==='VERIFYING'&&t.received===t.file.size,'Transferencia incompleta.',409);
   check(evidence&&evidence.fileId===t.fileId&&evidence.size===t.file.size&&evidence.sha256===t.file.sha256,
    'Arquivo gravado nao corresponde ao manifesto.',409);
   let evidenceMap=submissionEvidence.get(t.submissionId);
   if(!evidenceMap){evidenceMap=new Map();submissionEvidence.set(t.submissionId,evidenceMap);}
   evidenceMap.set(t.fileId,{fileId:t.fileId,size:evidence.size,sha256:evidence.sha256});
   const plan=await submissions.teacherPlan({teacherId,submissionId:t.submissionId});
   if(plan.files.every(f=>evidenceMap.has(f.fileId))){
     const result=await submissions.commit({teacherId,submissionId:t.submissionId,
       evidence:plan.files.map(f=>evidenceMap.get(f.fileId)),edgeWriteVerified:true});
     t.protocol=result.protocol;
     for(const prior of transfers.values())if(prior.submissionId===t.submissionId)prior.protocol=result.protocol;
     submissionEvidence.delete(t.submissionId);t.stage='COMMITTED';active.delete(t.submissionId);
     return {status:'COMMITTED',protocol:result.protocol};
   }
   t.stage='SAVED';active.delete(t.submissionId);
   return {status:'SAVED',remaining:plan.files.length-evidenceMap.size};
 }
 function teacherError({teacherId,roomId,transferId,message}){
   const t=teacherTransfer({teacherId,roomId,transferId});
   if(t.pending){const p=t.pending;t.pending=null;p.reject(problem('Gravacao pelo Edge falhou.',409));}
   t.stage='ERROR';t.failure='Falha no computador do professor: '+String(message||'arquivo indisponivel').slice(0,160);
   active.delete(t.submissionId);return {ok:true};
 }
 return {teacherPoll,beginFile,studentStatus,studentChunk,teacherReady,teacherAck,finishFile,teacherComplete,teacherError};
}
module.exports={createTransferRelay,MAX_CHUNK};
