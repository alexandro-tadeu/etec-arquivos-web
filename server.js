'use strict';
// Servidor intermediario: conecta navegadores, mas nao le pastas e nao armazena arquivos.
// Node 20+ - sem bibliotecas externas. Para publicar: npm start em uma hospedagem Node HTTPS.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const {createUserStore} = require('./user-store');
const userStore=createUserStore();

// Academic API v3 is opt-in; production stays blocked until integrated technical validation.
const V3_API_ENABLED=process.env.ETEC_V3_API_ENABLED==='true';
let v3ApiRequest=null;
if(V3_API_ENABLED){
  if(process.env.NODE_ENV==='production')throw new Error('V3 API blocked in production until end-to-end transfer and security tests are complete.');
  if(!process.env.DATABASE_URL||!process.env.V3_STUDENT_CODE_HMAC_KEY)throw new Error('Missing v3 database/HMAC configuration.');
  const {Pool}=require('pg');
  const {createAcademicStore}=require('./v3/academic-store');
  const {createSubmissionStore}=require('./v3/submission-store');
  const {createV3Api}=require('./v3/api');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:12000,idleTimeoutMillis:30000});
  v3ApiRequest=createV3Api({store:createAcademicStore({pool,hmacKey:process.env.V3_STUDENT_CODE_HMAC_KEY}),submissionStore:createSubmissionStore(pool),getPrincipal});
}

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
// Administrador principal: senha por variavel do Render. Professores: PostgreSQL.
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const LOGIN_COOKIE = 'etec_login';
const LOGIN_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_LOCK_MS = 5 * 60 * 1000;
const loginSessions = new Map();
const loginFailures = new Map();
const usernameRule=/^[a-z][a-z0-9._-]{2,39}$/;
async function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')) {
  const raw=await scrypt(password,Buffer.from(salt,'hex'),64);
  return {salt,password_hash:raw.toString('hex')};
}
async function verifyPassword(password,teacher) {
  const raw=await scrypt(password,Buffer.from(teacher.salt,'hex'),64);
  return crypto.timingSafeEqual(raw,Buffer.from(teacher.password_hash,'hex'));
}
function closeRoomsBySession(sid) {
  for (const room of [...rooms.values()]) if(room.ownerSid===sid) finishRoom(room);
}
function invalidateTeacherSessions(id) {
  for(const [sid,session] of loginSessions){
    if(session.role==='teacher' && session.id===id){loginSessions.delete(sid);closeRoomsBySession(sid);}
  }
}
const digits = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(size) { let result = ''; for (let i = 0; i < size; i++) result += digits[crypto.randomInt(digits.length)]; return result; }
function token() { return crypto.randomBytes(32).toString('base64url'); }
function loginCookie(value,req,maxAge) {
  const secure=process.env.NODE_ENV==='production' || req.headers['x-forwarded-proto']==='https';
  return `${LOGIN_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` + (secure?'; Secure':'');
}
async function getPrincipal(req) {
  const cookies=String(req.headers.cookie||'').split(';');
  const found=cookies.map(x=>x.trim()).find(x=>x.startsWith(LOGIN_COOKIE+'='));
  if(!found)return null;
  const sid=found.slice(LOGIN_COOKIE.length+1);
  if(!/^[A-Za-z0-9_-]{40,100}$/.test(sid))return null;
  const session=loginSessions.get(sid);
  if(!session)return null;
  if(session.expires<Date.now()){loginSessions.delete(sid);closeRoomsBySession(sid);return null;}
  if(session.role==='teacher'){
    const record=await userStore.byId(session.id);
    if(!record||!record.active||record.version!==session.version){loginSessions.delete(sid);closeRoomsBySession(sid);return null;}
  }
  return session;
}
function equalSecret(a,b) {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA,hashB);
}
function redirect(res, loc) {
  res.writeHead(302, {'location':loc,'cache-control':'no-store','referrer-policy':'no-referrer'});
  res.end();
}
function sendJson(res, status, obj) { if (res.writableEnded) return; res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(JSON.stringify(obj)); }
function error(res, status, detail) { sendJson(res, status, {error:detail}); }
function safePath(p) { return Array.isArray(p) && p.length <= 20 && p.every(part => typeof part === 'string' && part.length > 0 && part.length <= 180 && part !== '.' && part !== '..' && !/[\\/\0]/.test(part) && !['ENTREGAS','RECUPERACAO_PRIVADA'].includes(part.toUpperCase())); }
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
function roomOwner(room){return room.ownerId;}
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
  for (const [sid, session] of loginSessions) {
    if (session.expires <= now) {loginSessions.delete(sid);closeRoomsBySession(sid);}
  }
  for (const [key, state] of loginFailures) if (now-state.since > LOGIN_LOCK_MS) loginFailures.delete(key);
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
  const files={'/':'index.html','/index.html':'index.html','/admin':'admin.html','/professor':'professor.html','/gestao':'gestao.html','/gestao.js':'gestao.js','/app.js':'app.js','/admin.js':'admin.js','/style.css':'style.css'};
  if (V3_API_ENABLED && process.env.NODE_ENV !== 'production') {
    files['/atividades'] = 'atividades.html';
    files['/atividades.js'] = 'atividades.js';
  }
  const filename = files[pathname];
  if (!filename) return error(res,404,'Nao encontrado.');
  const type = filename.endsWith('.js') ? 'text/javascript; charset=utf-8' : filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
  res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','permissions-policy':'camera=(), microphone=(), geolocation=()', 'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
  fs.createReadStream(path.join(PUBLIC_DIR,filename)).pipe(res);
}
async function api(req,res,pathname) {
  const body = await parseBody(req);
  if (pathname === '/api/admin/login') {
    if (ADMIN_PASSWORD.length<12)return error(res,503,'Configure ADMIN_PASSWORD (12 ou mais caracteres) no Render.');
    const username=String(body.username||'').trim().toLowerCase();
    const password=String(body.password||'');
    const ip=String(req.socket.remoteAddress||'unknown');
    const key=ip+':'+username.slice(0,40);
    const now=Date.now(); const limit=loginFailures.get(key)||{since:now,count:0};
    if(now-limit.since>LOGIN_LOCK_MS){limit.since=now;limit.count=0;}
    if(limit.count>=8)return error(res,429,'Muitas tentativas. Aguarde cinco minutos.');
    let session=null;
    if(password.length<=256 && username===ADMIN_USER && equalSecret(password,ADMIN_PASSWORD)){
      session={sid:token(),role:'admin',id:'admin',name:'Administrador',expires:Date.now()+LOGIN_TTL_MS};
    } else if(password.length<=256 && usernameRule.test(username) && username!==ADMIN_USER){
      const teacher=await userStore.byUsername(username);
      if(teacher && teacher.active && await verifyPassword(password,teacher)){
        session={sid:token(),role:'teacher',id:teacher.id,name:teacher.name,version:teacher.version,expires:Date.now()+LOGIN_TTL_MS};
      }
    }
    if(!session){limit.count++;loginFailures.set(key,limit);return error(res,401,'Usuario ou senha incorretos, ou conta desativada.');}
    loginFailures.delete(key);loginSessions.set(session.sid,session);
    res.setHeader('set-cookie',loginCookie(session.sid,req,LOGIN_TTL_MS/1000));
    return sendJson(res,200,{ok:true,role:session.role,next:session.role==='admin'?'/gestao':'/professor'});
  }
  if(pathname==='/api/auth/me') {
    const session=await getPrincipal(req);
    if(!session)return error(res,401,'Entre com seu usuario e senha.');
    return sendJson(res,200,{role:session.role,name:session.name,storage:userStore.mode});
  }
  if (pathname === '/api/admin/logout') {
    const session=await getPrincipal(req);
    if(session){loginSessions.delete(session.sid);closeRoomsBySession(session.sid);}
    res.setHeader('set-cookie',loginCookie('',req,0));
    return sendJson(res,200,{ok:true});
  }
  if(pathname.startsWith('/api/admin/teachers/')) {
    const admin=await getPrincipal(req);
    if(!admin||admin.role!=='admin')return error(res,403,'Apenas o administrador pode gerenciar professores.');
    if(pathname==='/api/admin/teachers/list')return sendJson(res,200,{teachers:await userStore.list(),storage:userStore.mode});
    if(pathname==='/api/admin/teachers/create'){
      const username=String(body.username||'').trim().toLowerCase();
      const name=String(body.name||'').trim();
      const school=String(body.school||'').trim();
      const password=String(body.password||'');
      if(!usernameRule.test(username)||username===ADMIN_USER)return error(res,400,'Usuario invalido (3-40 caracteres, letras minusculas, numeros, ponto, _ ou -).');
      if(name.length<3||name.length>80||school.length>100||password.length<12||password.length>128)return error(res,400,'Informe nome, unidade e senha de 12 a 128 caracteres.');
      if(await userStore.byUsername(username))return error(res,409,'Usuario ja cadastrado.');
      const hashed=await hashPassword(password);
      try{const saved=await userStore.create({id:crypto.randomUUID(),username,name,school,...hashed});return sendJson(res,201,{teacher:saved});}
      catch(err){if(err.code==='23505')return error(res,409,'Usuario ja cadastrado.');throw err;}
    }
    if(pathname==='/api/admin/teachers/status' || pathname==='/api/admin/teachers/reset'){
      const id=String(body.id||'');
      const teacher=await userStore.byId(id);
      if(!teacher)return error(res,404,'Professor nao encontrado.');
      let updated;
      if(pathname.endsWith('/status')){
        if(typeof body.active!=='boolean')return error(res,400,'Situacao invalida.');
        updated=await userStore.setActive(id,body.active);
      }else{
        const password=String(body.password||'');
        if(password.length<12||password.length>128)return error(res,400,'Senha deve ter de 12 a 128 caracteres.');
        const hashed=await hashPassword(password);
        updated=await userStore.setPassword(id,hashed.salt,hashed.password_hash);
      }
      invalidateTeacherSessions(id);
      return sendJson(res,200,{teacher:updated});
    }
    return error(res,404,'Operacao administrativa nao encontrada.');
  }
  if (pathname === '/api/create') {
    const principal=await getPrincipal(req);
    if(!principal)return error(res,403,'Entre como professor ou administrador em /admin.');
    if(rooms.size >= MAX_ROOMS)return error(res,503,'Limite de salas simultaneas atingido.');
    let code;do{code=randomCode(8)}while(rooms.has(code));
    const room={code,pin:randomCode(16),created:Date.now(),teacher:null,ownerSid:principal.sid,ownerId:principal.id,students:new Map(),inflight:new Map()};
    const teacher=makeSession('teacher',room);teacher.ownerSid=principal.sid;room.teacher=teacher;rooms.set(code,room);
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
  if (sess.role === 'teacher') {
    const owner=await getPrincipal(req);
    if(!owner||owner.sid!==sess.ownerSid||owner.id!==roomOwner(sess.room))return error(res,403,'Sessao do professor expirada ou sem permissao. Entre novamente.');
  }
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

async function handleRequest(req,res) {
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname.startsWith('/api/v3/')){
    if(!v3ApiRequest)return error(res,404,'Nao encontrado.');
    return v3ApiRequest(req,res,pathname);
  }
  if(req.method==='GET'&&pathname==='/healthz')return sendJson(res,200,{ok:true,rooms:rooms.size,storage:userStore.mode});
  if(req.method==='GET') {
    if(pathname==='/professor' || pathname==='/gestao'){
      const principal=await getPrincipal(req);
      if(!principal)return redirect(res,'/admin');
      if(pathname==='/gestao'&&principal.role!=='admin')return redirect(res,'/professor');
    }
    if(pathname==='/admin'){
      const principal=await getPrincipal(req);
      if(principal)return redirect(res,principal.role==='admin'?'/gestao':'/professor');
    }
    return serveStatic(req,res,pathname);
  }
  if(req.method!=='POST'||!pathname.startsWith('/api/'))return error(res,404,'Nao encontrado.');
  return api(req,res,pathname);
}
const server=http.createServer((req,res)=>{
  handleRequest(req,res).catch(err=>{
    console.error('ERRO',err.message);
    if(!res.headersSent)error(res,err.status||500,err.status?err.message:'Falha no servidor. Verifique a configuracao de DATABASE_URL.');
  });
});
server.requestTimeout=60000;
server.listen(PORT,'0.0.0.0',()=>{
  if(ADMIN_PASSWORD.length<12)console.warn('Configure ADMIN_PASSWORD (12+ caracteres) nas variaveis de ambiente.');
  if(userStore.mode==='unconfigured')console.warn('CADASTRO DE PROFESSORES BLOQUEADO: Configure DATABASE_URL com um PostgreSQL persistente.');
  console.log(`ETEC Web multi-professor: http://127.0.0.1:${PORT} (HTTPS via Render, armazenamento: ${userStore.mode})`);
});
