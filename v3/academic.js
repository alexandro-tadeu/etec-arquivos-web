'use strict';
// Regras de dominio v3. Todos os argumentos de autorizacao devem vir do servidor/Neon,
// nunca de atributos enviados pelo navegador do aluno.
const crypto = require('node:crypto');
const LIMITS = Object.freeze({filesPerVersion:10,bytesPerFile:40*1024*1024,bytesPerVersion:100*1024*1024});
const SAFE_EXTENSIONS = Object.freeze(['.pdf','.doc','.docx','.odt','.ppt','.pptx','.xls','.xlsx','.ods','.txt','.csv','.jpg','.jpeg','.png','.zip','.json','.md','.sql']);
const DANGEROUS_PARTS = new Set(['exe','msi','bat','cmd','ps1','psm1','scr','vbs','vbe','wsf','wsh','hta','lnk','com','dll','jar','apk','sh','app','js','mjs','cjs','py','php','pl','rb']);
function invariant(ok,message){if(!ok)throw Object.assign(new Error(message),{status:400});}
function comparableName(input){
  invariant(typeof input==='string'&&input.length>=3&&input.length<=180,'Nome invalido.');
  const value=input.normalize('NFKD').replace(/\p{M}/gu,'').trim().replace(/\s+/gu,' ').toLocaleLowerCase('pt-BR');
  invariant(value.length>=3&&value.split(' ').length>=2&&/^[\p{L}\p{N}\s'’-]+$/u.test(value),'Informe nome completo valido.');
  return value;
}
function normalizeRm(input){
  invariant(typeof input==='string'&&/^\d{1,20}$/.test(input),'RM deve ser texto numerico, preservando zeros iniciais.');
  return input;
}
function createStudentSecret(){return crypto.randomBytes(24).toString('base64url');}
function validFilename(name){
  return typeof name==='string'&&name.length>=1&&name.length<=180&&!/[/\\\x00-\x1f<>:"|?*]/.test(name)&&
    name!=='.'&&name!=='..'&&!/[. ]$/.test(name)&&!/\p{Cf}/u.test(name);
}
function extension(name){const i=name.lastIndexOf('.');return i>0?name.slice(i).toLowerCase():'';}
function allowedFile(name,activityExtensions=SAFE_EXTENSIONS){
  if(!validFilename(name))return false;
  const ext=extension(name);
  if(!SAFE_EXTENSIONS.includes(ext)||!activityExtensions.includes(ext))return false;
  return !name.toLowerCase().split('.').slice(1).some(part=>DANGEROUS_PARTS.has(part));
}
function validateManifest(files,allowedExtensions=SAFE_EXTENSIONS){
  invariant(Array.isArray(files)&&files.length>0&&files.length<=LIMITS.filesPerVersion,'A entrega requer de 1 a 10 arquivos.');
  invariant(Array.isArray(allowedExtensions)&&allowedExtensions.length>0&&allowedExtensions.every(x=>typeof x==='string'&&SAFE_EXTENSIONS.includes(x)),'Formatos permitidos invalidos.');
  const names=new Set();let total=0;
  return files.map(file=>{
    invariant(file&&typeof file==='object'&&!Array.isArray(file),'Arquivo invalido.');
    invariant(allowedFile(file.name,allowedExtensions),'Nome ou formato de arquivo nao permitido.');
    invariant(Number.isSafeInteger(file.size)&&file.size>=0&&file.size<=LIMITS.bytesPerFile,'Arquivo acima do limite de 40 MB.');
    const lower=file.name.normalize('NFC').toLocaleLowerCase('pt-BR');
    invariant(!names.has(lower),'Nomes de arquivo duplicados.');names.add(lower);
    total+=file.size;
    invariant(total<=LIMITS.bytesPerVersion,'A versao ultrapassa 100 MB.');
    return Object.freeze({name:file.name,size:file.size});
  });
}
function isoMillis(value,label){
  invariant(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value),label+' deve conter fuso horario.');
  const ms=Date.parse(value);invariant(Number.isFinite(ms),label+' invalida.');return ms;
}
function evaluateSubmission({activity,studentId,at,exception,files}){
  invariant(activity&&typeof activity==='object','Atividade invalida.');
  invariant(typeof studentId==='string'&&studentId.length>0,'Aluno invalido.');
  const current=isoMillis(at,'Horario de conclusao');
  const deadline=isoMillis(activity.deadlineAt,'Prazo da atividade');
  invariant(['DRAFT','PUBLISHED','CLOSED','ARCHIVED'].includes(activity.status),'Estado da atividade invalido.');
  invariant(activity.status!=='ARCHIVED'&&activity.status!=='DRAFT','Atividade indisponivel para entregas.');
  const ex=exception&&exception.studentId===studentId&&exception.activityId===activity.id&&exception.approved===true?exception:null;
  if(activity.status==='CLOSED'){
    invariant(ex&&ex.reopenClosed===true,'Atividade encerrada para este aluno.');
    invariant(ex.personalDeadlineAt,'Reabertura exige prazo individual.');
    invariant(current<=isoMillis(ex.personalDeadlineAt,'Prazo excepcional'),'Prazo de reabertura encerrado.');
  }
  // Extensoes individuais previamente autorizadas podem valer para atividade publicada.
  // Na atividade encerrada somente a reabertura individual permite novas entregas.
  const effectiveDeadline=ex?.personalDeadlineAt?isoMillis(ex.personalDeadlineAt,'Prazo excepcional'):deadline;
  const isLate=current>effectiveDeadline;
  if(activity.status==='PUBLISHED'&&isLate&&!activity.acceptLate){
    invariant(false,'Prazo da atividade encerrado.');
  }
  const manifest=validateManifest(files,activity.allowedExtensions);
  return Object.freeze({activityId:activity.id,studentId,completedAt:new Date(current).toISOString(),
    late:isLate,deadlineAt:new Date(effectiveDeadline).toISOString(),closedReopening:activity.status==='CLOSED',files:manifest});
}
function versionLabel(version){invariant(Number.isSafeInteger(version)&&version>=1&&version<=999999,'Numero de versao invalido.');return 'V'+String(version).padStart(3,'0');}
function receiptView({submission,activity,student,room,protocol}){
  invariant(submission?.status==='COMMITTED','Comprovante apenas para entrega efetivamente confirmada.');
  invariant(submission.studentId===student?.id&&submission.activityId===activity?.id&&activity.roomId===room?.id,'Vinculo de comprovante invalido.');
  invariant(typeof protocol==='string'&&protocol.length>=8&&protocol.length<=100,'Protocolo invalido.');
  const files=validateManifest(submission.files,activity.allowedExtensions);
  return Object.freeze({protocol,room:room.title,activity:activity.title,student:student.name,rm:normalizeRm(student.rm),
    version:versionLabel(submission.version),completedAt:submission.completedAt,late:Boolean(submission.late),files,
    note:'Comprovante de recebimento registrado; nao comprova disponibilidade fisica permanente dos arquivos.'});
}
module.exports={LIMITS,SAFE_EXTENSIONS,comparableName,normalizeRm,createStudentSecret,validFilename,allowedFile,
  validateManifest,evaluateSubmission,versionLabel,receiptView};
