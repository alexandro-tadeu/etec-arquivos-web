'use strict';
// Endpoints academicos v3; habilitacao opt-in, ainda sem rotas para envio de arquivos.
// O modulo recebe uma identidade do professor validada pelo backend v2.
const {URL}=require('node:url');
const COOKIE='etec_v3_student';
const MAX_BODY=16*1024;
const MAX_CHUNK_BODY=96*1024;
const LOGIN_WINDOW=15*60*1000;
const LOGIN_ATTEMPTS=8;
function error(status,message){return Object.assign(new Error(message),{status});}
function json(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(JSON.stringify(data));}
function cookie(name,value,secure,maxAge){return `${name}=${value}; Path=/api/v3/student; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`+(secure?'; Secure':'');}
function readCookie(req){const str=String(req.headers.cookie||'');const m=str.match(/(?:^|;\s*)etec_v3_student=([A-Za-z0-9_-]{43})(?=;|$)/);return m?m[1]:null;}
async function bodyJson(req,maxBody=MAX_BODY){
  if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')throw error(415,'Conteudo JSON obrigatorio.');
  const length=Number(req.headers['content-length']);if(Number.isFinite(length)&&length>maxBody)throw error(413,'Mensagem excede limite.');
  let data='',size=0;
  for await(const chunk of req){size+=chunk.length;if(size>maxBody)throw error(413,'Mensagem excede limite.');data+=chunk;}
  let parsed;try{parsed=JSON.parse(data);}catch{throw error(400,'JSON invalido.');}
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw error(400,'JSON invalido.');
  return parsed;
}
function sameOrigin(req){
  const site=String(req.headers['sec-fetch-site']||'');if(site&&site!=='same-origin'&&site!=='none')return false;
  const origin=req.headers.origin;if(!origin||typeof origin!=='string')return false;
  let url;try{url=new URL(origin);}catch{return false;}
  const hostname=String(req.headers.host||'').toLowerCase();
  // X-Forwarded-Proto somente quando servidor usa HTTPS em producao e proxy confiavel.
  const secure=process.env.NODE_ENV==='production'||req.socket.encrypted===true;
  return (url.protocol===(secure?'https:':'http:') && url.host.toLowerCase()===hostname);
}
function createV3Api({store,getPrincipal,submissionStore=null,transferRelay=null,now=()=>Date.now(),secureCookies=process.env.NODE_ENV==='production'}){
 if(!store||typeof store.authenticateStudent!=='function'||typeof getPrincipal!=='function')throw new Error('Dependencias v3 ausentes.');
 const failures=new Map();
 function loginGuard(req,roomCode){
  const t=now();if(failures.size>10000){for(const [k,x] of failures)if(t-x.start>LOGIN_WINDOW)failures.delete(k);}
  const key=String(req.socket.remoteAddress||'unknown')+':'+String(roomCode||'').slice(0,12);
  const state=failures.get(key);if(state&&t-state.start<LOGIN_WINDOW&&state.count>=LOGIN_ATTEMPTS)throw error(429,'Muitas tentativas. Aguarde.');
  return {key,state:state&&t-state.start<LOGIN_WINDOW?state:{start:t,count:0}};
 }
 async function teacher(req){const principal=await getPrincipal(req);if(!principal||principal.role!=='teacher'||typeof principal.id!=='string')throw error(403,'Acesso restrito ao professor.');return principal.id;}
 async function student(req){const token=readCookie(req);if(!token)throw error(401,'Sessao do aluno ausente ou expirada.');return store.authorizeStudentSession(token);}
 async function route(req,res,pathname){
  try{
   if(!pathname.startsWith('/api/v3/'))return false;
   if(req.method!=='POST'&&req.method!=='GET')throw error(405,'Metodo nao permitido.');
   if(req.method==='POST'&&!sameOrigin(req))throw error(403,'Origem nao autorizada.');
   const data=req.method==='POST'?await bodyJson(req,pathname==='/api/v3/student/transfer/chunk'?MAX_CHUNK_BODY:MAX_BODY):null;
   if(pathname==='/api/v3/student/login'&&req.method==='POST'){
    const guard=loginGuard(req,data.roomCode);
    let logged;
    try{logged=await store.authenticateStudent(data);}catch(e){guard.state.count++;failures.set(guard.key,guard.state);if(e.status===401)throw error(401,'Credenciais invalidas ou acesso indisponivel.');throw e;}
    failures.delete(guard.key);
    res.setHeader('set-cookie',cookie(COOKIE,logged.sessionToken,secureCookies,8*60*60));
    json(res,200,{ok:true});return true;
   }
   if(pathname==='/api/v3/student/logout'&&req.method==='POST'){
    const token=readCookie(req);if(token)await store.revokeStudentSession(token);
    res.setHeader('set-cookie',cookie(COOKIE,'',secureCookies,0));
    json(res,200,{ok:true});return true;
   }
   if(pathname==='/api/v3/student/me'&&req.method==='GET'){json(res,200,{student:await student(req)});return true;}
   if(pathname==='/api/v3/student/activities'&&req.method==='GET'){
    const s=await student(req);json(res,200,{activities:await store.listStudentActivities(s)});return true;
   }
   if(pathname==='/api/v3/student/submissions/begin'&&req.method==='POST'){
    if(!submissionStore)throw error(503,'Modulo de entregas indisponivel.');
    const actor=await student(req);
    const prepared=await submissionStore.begin({studentId:actor.studentId,roomId:actor.roomId,
      activityId:data.activityId,requestKey:data.requestKey,files:data.files});
    json(res,200,prepared);return true;
   }
   if(pathname==='/api/v3/teacher/submissions/plan'&&req.method==='POST'){
    if(!submissionStore)throw error(503,'Modulo de entregas indisponivel.');
    const teacherId=await teacher(req);
    json(res,200,await submissionStore.teacherPlan({teacherId,submissionId:data.submissionId}));return true;
   }
   // A API nao aceita mais confirmacao fisica direta: exige sequencia controlada pelo relay.
   if(pathname==='/api/v3/teacher/submissions/commit'&&req.method==='POST')throw error(410,'Use confirmacao da transferencia validada.');
   if(pathname==='/api/v3/teacher/relay/poll'&&req.method==='POST'){
    if(!transferRelay)throw error(503,'Transferencias indisponiveis.');
    json(res,200,await transferRelay.teacherPoll({teacherId:await teacher(req),roomId:data.roomId}));return true;
   }
   if(pathname==='/api/v3/teacher/relay/ready'&&req.method==='POST'){
    if(!transferRelay)throw error(503,'Transferencias indisponiveis.');
    json(res,200,transferRelay.teacherReady({teacherId:await teacher(req),roomId:data.roomId,transferId:data.transferId}));return true;
   }
   if(pathname==='/api/v3/teacher/relay/ack'&&req.method==='POST'){
    if(!transferRelay)throw error(503,'Transferencias indisponiveis.');
    json(res,200,transferRelay.teacherAck({teacherId:await teacher(req),roomId:data.roomId,transferId:data.transferId,seq:data.seq}));return true;
   }
   if(pathname==='/api/v3/teacher/relay/complete'&&req.method==='POST'){
    if(!transferRelay)throw error(503,'Transferencias indisponiveis.');
    json(res,200,await transferRelay.teacherComplete({teacherId:await teacher(req),roomId:data.roomId,transferId:data.transferId,evidence:data.evidence}));return true;
   }
   if(pathname==='/api/v3/teacher/relay/error'&&req.method==='POST'){
    if(!transferRelay)throw error(503,'Transferencias indisponiveis.');
    json(res,200,transferRelay.teacherError({teacherId:await teacher(req),roomId:data.roomId,transferId:data.transferId,message:data.message}));return true;
   }
   if(pathname==='/api/v3/student/transfer/begin'&&req.method==='POST'){
    if(!transferRelay)throw error(503,'Transferencias indisponiveis.');
    const actor=await student(req);json(res,200,await transferRelay.beginFile({...actor,submissionId:data.submissionId,fileId:data.fileId}));return true;
   }
   if(pathname==='/api/v3/student/transfer/status'&&req.method==='POST'){
    if(!transferRelay)throw error(503,'Transferencias indisponiveis.');
    const actor=await student(req);json(res,200,transferRelay.studentStatus({...actor,transferId:data.transferId}));return true;
   }
   if(pathname==='/api/v3/student/transfer/chunk'&&req.method==='POST'){
    if(!transferRelay)throw error(503,'Transferencias indisponiveis.');
    const actor=await student(req);json(res,200,await transferRelay.studentChunk({...actor,transferId:data.transferId,seq:data.seq,data:data.data}));return true;
   }
   if(pathname==='/api/v3/student/transfer/finish'&&req.method==='POST'){
    if(!transferRelay)throw error(503,'Transferencias indisponiveis.');
    const actor=await student(req);json(res,200,transferRelay.finishFile({...actor,transferId:data.transferId}));return true;
   }
   if(pathname==='/api/v3/student/receipts'&&req.method==='GET'){
    const s=await student(req);json(res,200,{receipts:await store.listStudentReceipts(s)});return true;
   }
   if(pathname==='/api/v3/teacher/rooms'&&req.method==='GET'){
    json(res,200,{rooms:await store.listTeacherRooms({teacherId:await teacher(req)})});return true;
   }
   if(pathname==='/api/v3/teacher/rooms'&&req.method==='POST'){
    const teacherId=await teacher(req);json(res,201,await store.createRoom({teacherId,title:data.title}));return true;
   }
   if(pathname==='/api/v3/teacher/enrollments'&&req.method==='GET'){
    const teacherId=await teacher(req);const roomId=new URL(req.url,'http://localhost').searchParams.get('roomId');
    json(res,200,{students:await store.listEnrollments({teacherId,roomId})});return true;
   }
   if(pathname==='/api/v3/teacher/enrollments'&&req.method==='POST'){
    const teacherId=await teacher(req);json(res,201,await store.enrollStudent({teacherId,roomId:data.roomId,name:data.name,rm:data.rm}));return true;
   }
   if(pathname==='/api/v3/teacher/enrollments/deactivate'&&req.method==='POST'){
    const teacherId=await teacher(req);json(res,200,await store.deactivateStudent({teacherId,roomId:data.roomId,studentId:data.studentId}));return true;
   }
   if(pathname==='/api/v3/teacher/activities'&&req.method==='GET'){
    const teacherId=await teacher(req);const roomId=new URL(req.url,'http://localhost').searchParams.get('roomId');
    json(res,200,{activities:await store.listTeacherActivities({teacherId,roomId})});return true;
   }
   if(pathname==='/api/v3/teacher/activities'&&req.method==='POST'){
    const teacherId=await teacher(req);json(res,201,{activity:await store.createActivity({teacherId,roomId:data.roomId,title:data.title,description:data.description,deadlineAt:data.deadlineAt,allowedExtensions:data.allowedExtensions,acceptLate:data.acceptLate})});return true;
   }
   if(pathname==='/api/v3/teacher/activities/publish'&&req.method==='POST'){
    const teacherId=await teacher(req);json(res,200,{activity:await store.publishActivity({teacherId,roomId:data.roomId,activityId:data.activityId})});return true;
   }
   throw error(404,'Rota v3 nao encontrada.');
  }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'Erro interno no ETEC Web v3.'});return true;}
 }
 return route;
}
module.exports={createV3Api};
