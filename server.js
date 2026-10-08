'use strict';
// Servidor intermediario: conecta navegadores, mas nao le pastas e nao armazena arquivos.
// Node 20+ - sem bibliotecas externas. Para publicar: npm start em uma hospedagem Node HTTPS.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 180 * 1024;
const MAX_FILE = 40 * 1024 * 1024;
const MAX_ROOMS = 30;
const MAX_STUDENTS = 45;
const MAX_QUEUE = 100;
const POLL_MS = 23000;
const TEACHER_GRACE_MS = 65000;
const ROOM_EXPIRY_MS = 5 * 60 * 60 * 1000;
const rooms = new Map();
const sessions = new Map();
const failures = new Map();
const digits = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(size) { let result = ''; for (let i = 0; i < size; i++) result += digits[crypto.randomInt(digits.length)]; return result; }
function token() { return crypto.randomBytes(32).toString('base64url'); }
function sendJson(res, status, obj) { if (res.writableEnded) return; res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(JSON.stringify(obj)); }
function error(res, status, detail) { sendJson(res, status, {error:detail}); }
function safePath(p) { return Array.isArray(p) && p.length <= 20 && p.every(part => typeof part === 'string' && part.length > 0 && part.length <= 180 && part !== '.' && part !== '..' && !/[\\/\0]/.test(part)); }
function safeName(s) { return typeof s === 'string' && s.length > 0 && s.length <= 180 && s !== '.' && s !== '..' && !/[\\/\0<>:"|?*]/.test(s) && !/[. ]$/.test(s); }
function cleanupSession(sess) { if (!sess) return; if (sess.timer) clearTimeout(sess.timer); sess.timer=null; if (sess.waiter && !sess.waiter.writableEnded) sendJson(sess.waiter, 200, {events:[]}); sess.waiter=null; sessions.delete(sess.token); }
function finishRoom(room) {
  if (!rooms.has(room.code)) return;
  rooms.delete(room.code);
  for (const sess of [room.teacher, ...room.students.values()]) {
    if (!sess) continue;
    enqueue(sess, {type:'closed',message:'O compartilhamento foi encerrado.'});
    // As mensagens de encerramento sao entregues ao poll atual, se houver.
    cleanupSession(sess);
  }
}
function enqueue(sess, evt) {
  if (!sess) return;
  // Contagem de alunos e um estado, nao precisa acumular notificacoes antigas.
  if (evt.type === 'student_count') sess.queue = sess.queue.filter(e=>e.type !== 'student_count');
  if (sess.queue.length >= MAX_QUEUE) { sess.queue.length = 0; sess.queue.push({type:'error',message:'Conexao lenta. Atualize a pagina e tente novamente.'}); }
  else sess.queue.push(evt);
  if (sess.waiter) { const res=sess.waiter; sess.waiter=null; clearTimeout(sess.timer); sess.timer=null; sendJson(res,200,{events:sess.queue.splice(0)}); }
}
function makeSession(role, room) { const sess = {role,room,token:token(),id:token().slice(0,12),queue:[],waiter:null,timer:null,lastPoll:Date.now()}; sessions.set(sess.token, sess); return sess; }
function isAlive(room) { return room && rooms.has(room.code) && Date.now() - room.teacher.lastPoll < TEACHER_GRACE_MS; }
function cleanExpired() {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (now-room.created > ROOM_EXPIRY_MS || now-room.teacher.lastPoll > TEACHER_GRACE_MS) {finishRoom(room);continue;}
    for (const student of [...room.students.values()]) {
      if(now-student.lastPoll > 85000) {
        room.students.delete(student.id);
        for (const [key,op] of room.inflight) if(op.student===student) {room.inflight.delete(key);enqueue(room.teacher,{type:'cancel',from:student.id,id:key.split(':').at(-1)});}
        cleanupSession(student);enqueue(room.teacher,{type:'student_count',count:room.students.size});
      }
    }
  }
  for (const [key, state] of failures) if (now-state.since > 60000) failures.delete(key);
}
setInterval(cleanExpired,15000).unref();
async function parseBody(req) {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.startsWith('application/json')) throw Object.assign(new Error('Requisicao JSON necessaria.'), {status:415});
  let content = ''; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Mensagem muito grande.'), {status:413});
    content += chunk;
  }
  try { const data=JSON.parse(content); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
  catch { throw Object.assign(new Error('JSON invalido.'), {status:400}); }
}
function serveStatic(req, res, pathname) {
  const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css'};
  const filename = files[pathname];
  if (!filename) return error(res,404,'Nao encontrado.');
  const type = filename.endsWith('.js') ? 'text/javascript; charset=utf-8' : filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
  res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','permissions-policy':'camera=(), microphone=(), geolocation=()', 'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
  fs.createReadStream(path.join(PUBLIC_DIR,filename)).pipe(res);
}
async function api(req,res,pathname) {
  const body = await parseBody(req);
  if (pathname === '/api/create') {
    if (rooms.size >= MAX_ROOMS) return error(res,503,'Limite de salas simultaneas atingido.');
    let code; do {code=randomCode(8)} while(rooms.has(code));
    const room={code,pin:randomCode(16),created:Date.now(),teacher:null,students:new Map(),inflight:new Map()};
    const teacher=makeSession('teacher',room); room.teacher=teacher; rooms.set(code,room);
    return sendJson(res,200,{code,pin:room.pin,token:teacher.token});
  }
  if (pathname === '/api/join') {
    const ip=String(req.socket.remoteAddress || 'unknown');
    const now=Date.now(); const rate=failures.get(ip) || {since:now,count:0};
    if (now-rate.since > 60000) {rate.since=now;rate.count=0;}
    if (rate.count >= 40) return error(res,429,'Muitas tentativas. Aguarde um minuto.');
    const code=String(body.code||'').trim().toUpperCase();
    const room=rooms.get(code);
    const incomingPin=String(body.pin||'').trim().toUpperCase();
    const correct=room && incomingPin.length===room.pin.length && crypto.timingSafeEqual(Buffer.from(incomingPin), Buffer.from(room.pin));
    if (!correct || !isAlive(room)) {rate.count++;failures.set(ip,rate);return error(res,401,'Codigo ou senha incorretos, ou sala encerrada.');}
    if (room.students.size >= MAX_STUDENTS) return error(res,429,'A sala ja atingiu o limite de alunos.');
    const student=makeSession('student',room);room.students.set(student.id,student);
    enqueue(room.teacher,{type:'student_count',count:room.students.size});
    return sendJson(res,200,{token:student.token,studentId:student.id});
  }
  const sess=sessions.get(body.token);
  if (!sess) return error(res,401,'Sessao expirada. Reabra o site.');
  const room=sess.room;
  if (!rooms.has(room.code)) return error(res,410,'A sala foi encerrada.');
  if (pathname === '/api/poll') {
    sess.lastPoll=Date.now();
    if (sess.waiter) {const old=sess.waiter;sess.waiter=null;clearTimeout(sess.timer);sendJson(old,200,{events:[]});}
    if(sess.queue.length) return sendJson(res,200,{events:sess.queue.splice(0)});
    sess.waiter=res;
    sess.timer=setTimeout(()=>{if(sess.waiter===res){sess.waiter=null;sess.timer=null;sendJson(res,200,{events:[]})}},POLL_MS);
    req.on('close',()=>{if(sess.waiter===res && res.destroyed){clearTimeout(sess.timer);sess.waiter=null;sess.timer=null}});
    return;
  }
  if (pathname === '/api/close') {
    if (sess.role === 'teacher') finishRoom(room);
    else {room.students.delete(sess.id);for (const [key,op] of room.inflight) {if(op.student===sess){room.inflight.delete(key);enqueue(room.teacher,{type:'cancel',from:sess.id,id:key.split(':').at(-1)});}}cleanupSession(sess);enqueue(room.teacher,{type:'student_count',count:room.students.size});}
    return sendJson(res,200,{ok:true});
  }
  if (pathname !== '/api/send') return error(res,404,'Operacao desconhecida.');
  const msg=body.message;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return error(res,400,'Mensagem invalida.');
  if (JSON.stringify(msg).length > MAX_BODY-4096) return error(res,413,'Mensagem muito grande.');
  if (sess.role==='student') {
    if (!isAlive(room)) return error(res,410,'Professor desconectado.');
    if (!/^[\w-]{1,32}$/.test(String(msg.id || ''))) return error(res,400,'Identificador invalido.');
    const key=sess.id+':'+msg.id;
    if(msg.type==='request'){
      if(!['list','download','upload'].includes(msg.op) || !safePath(msg.path||[]))return error(res,400,'Solicitacao invalida.');
      if(msg.op==='download' && !safeName(msg.name)) return error(res,400,'Nome invalido.');
      if(msg.op==='upload' && (!safeName(msg.name) || !Number.isSafeInteger(msg.size) || msg.size<0 || msg.size>MAX_FILE))return error(res,400,'Arquivo invalido ou acima de 40 MB.');
      if(room.inflight.has(key))return error(res,409,'Solicitacao repetida.');
      if([...room.inflight.keys()].filter(k=>k.startsWith(sess.id+':')).length>=3)return error(res,429,'Aguarde a transferencia anterior.');
      room.inflight.set(key,{student:sess,op:msg.op,started:Date.now()});
      enqueue(room.teacher,{...msg,from:sess.id});
      return sendJson(res,200,{ok:true});
    }
    const state=room.inflight.get(key);
    if(!state)return error(res,410,'Transferencia encerrada.');
    if(msg.type==='cancel') {room.inflight.delete(key);enqueue(room.teacher,{type:'cancel',id:msg.id,from:sess.id});return sendJson(res,200,{ok:true});}
    if(msg.type==='chunk' && state.op==='upload' && typeof msg.data==='string' && msg.data.length<=100000 && /^[A-Za-z0-9+/]*={0,2}$/.test(msg.data)) {
      enqueue(room.teacher,{type:'chunk',id:msg.id,from:sess.id,data:msg.data});return sendJson(res,200,{ok:true});
    }
    if(msg.type==='finish' && state.op==='upload') {enqueue(room.teacher,{type:'finish',id:msg.id,from:sess.id});return sendJson(res,200,{ok:true});}
    if(msg.type==='pull' && state.op==='download'){enqueue(room.teacher,{type:'pull',id:msg.id,from:sess.id});return sendJson(res,200,{ok:true});}
    return error(res,400,'Operacao invalida.');
  }
  // Professor: pode responder somente para solicitacoes de alunos autenticados.
  const target=room.students.get(String(msg.to || ''));
  if(!target)return error(res,404,'Aluno desconectado.');
  const key=target.id+':'+String(msg.id||'');
  const state=room.inflight.get(key);
  if(!state)return error(res,410,'Solicitacao inexistente ou encerrada.');
  if(!['answer','chunk','ack'].includes(msg.type))return error(res,400,'Resposta invalida.');
  if(msg.type==='chunk' && (state.op!=='download' || typeof msg.data!=='string' || msg.data.length>100000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(msg.data)))return error(res,400,'Chunk invalido.');
  if(msg.type==='ack' && state.op!=='upload')return error(res,400,'Confirmacao invalida.');
  if(msg.type==='answer' && !['ready','done','error'].includes(msg.phase))return error(res,400,'Resposta invalida.');
  const allowed={type:msg.type,id:msg.id};
  for (const key of ['phase','name','size','savedName','message','data','entries']) if (Object.hasOwn(msg,key)) allowed[key]=msg[key];
  if(msg.type==='answer' && ['done','error'].includes(msg.phase)) room.inflight.delete(key);
  enqueue(target,allowed);
  return sendJson(res,200,{ok:true});
}

const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET' && pathname==='/healthz')return sendJson(res,200,{ok:true,rooms:rooms.size});
  if(req.method==='GET')return serveStatic(req,res,pathname);
  if(req.method!=='POST'||!pathname.startsWith('/api/'))return error(res,404,'Nao encontrado.');
  api(req,res,pathname).catch(err=>{console.error('API',err.message);if(!res.headersSent)error(res,err.status||500,err.status?err.message:'Falha ao processar solicitacao.');});
});
server.requestTimeout=60000;
server.listen(PORT,'0.0.0.0',()=>console.log(`ETEC WEB: servidor HTTP local em http://127.0.0.1:${PORT} - HTTPS fornecido pela hospedagem`));
process.on('SIGTERM',()=>{for(const room of [...rooms.values()])finishRoom(room);server.close(()=>process.exit(0));});
