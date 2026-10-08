'use strict';
// Toda a operacao no computador do professor usa a File System Access API.
// Nenhuma pasta e enviada integralmente ao servidor intermediario.
const MAX_FILE = 40 * 1024 * 1024;
const CHUNK_BYTES = 48 * 1024;
const $ = id => document.getElementById(id);
const state = {role:null,token:null,alive:false,room:null,pin:null,dir:null,path:[],jobs:new Map(),activeUploads:new Map(),reserved:new Set(),studentCount:0};
let requestCounter = 0;
let navigationSerial = 0;

function flash(message, bad=false) {const e=$('message');e.textContent=message;e.classList.remove('hidden');e.classList.toggle('bad',bad);}
function clearFlash(){ $('message').classList.add('hidden'); }
function show(id){$(id).classList.remove('hidden');}
function hide(id){$(id).classList.add('hidden');}
function rejectJobs(reason){for(const job of state.jobs.values())job.reject(new Error(reason));state.jobs.clear();}
function setProgress(label,percent){show('progress');$('progressLabel').textContent=label;$('progressBar').style.width=`${Math.max(0,Math.min(100,percent))}%`;$('progressValue').textContent=`${Math.round(percent)}%`;}
function formatSize(bytes){if(bytes<1024)return `${bytes} B`;if(bytes<1048576)return `${(bytes/1024).toFixed(1)} KB`;return `${(bytes/1048576).toFixed(1)} MB`;}
function validPart(s){return typeof s==='string' && s.length>0 && s.length<=180 && !['.','..'].includes(s) && !/[\\/\0]/.test(s);}
function allowedName(s){return validPart(s) && !/[<>:"|?*]/.test(s) && !/[. ]$/.test(s);}
function makeId(){return String(++requestCounter)+'-'+Math.random().toString(36).slice(2,8);}
function toBase64(bytes) { let binary=''; for (let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary); }
function fromBase64(s){const bin=atob(s);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}
async function api(route,params){
  const response = await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params),cache:'no-store'});
  let result;try{result=await response.json();}catch{throw new Error('O servidor nao respondeu corretamente.');}
  if(!response.ok)throw new Error(result.error||`Falha HTTP ${response.status}`);
  return result;
}
async function send(message){if(!state.token)throw new Error('Sessao desconectada.');return api('send',{token:state.token,message});}
async function poll(){
  while(state.alive){
    try{
      const response=await api('poll',{token:state.token});
      if(!state.alive)return;
      for(const event of response.events||[]){
        try {if(state.role==='teacher') await teacherEvent(event); else await studentEvent(event);}
        catch(err){console.error('Falha em evento',err);flash(err.message,true);}
      }
    }catch(err){
      if(!state.alive)return;
      flash('Conexao com o servidor interrompida: '+err.message,true);
      if(/Sessao expirada|sala foi encerrada/i.test(err.message)){rejectJobs('O compartilhamento terminou.');state.alive=false;break;}
      await new Promise(resolve=>setTimeout(resolve,2200));
    }
  }
}
function setTab(isTeacher){
  $('tabTeacher').classList.toggle('selected',isTeacher);$('tabStudent').classList.toggle('selected',!isTeacher);
  $('tabTeacher').setAttribute('aria-selected',String(isTeacher));$('tabStudent').setAttribute('aria-selected',String(!isTeacher));
  (isTeacher?show:hide)('teacherStart');(isTeacher?hide:show)('studentStart');
}
$('tabTeacher').addEventListener('click',()=>setTab(true));
$('tabStudent').addEventListener('click',()=>setTab(false));

$('selectFolder').addEventListener('click',async()=>{
  clearFlash();
  if(!window.isSecureContext || typeof window.showDirectoryPicker!=='function'){
    flash('Este navegador nao permite selecionar pastas. Abra o endereco HTTPS no Microsoft Edge atualizado.',true);return;
  }
  let handle;
  try{handle=await window.showDirectoryPicker({id:'etec-pasta-aula',mode:'readwrite'});}
  catch(e){if(e.name==='AbortError')return;flash('Nao foi possivel autorizar a pasta: '+e.message,true);return;}
  $('selectFolder').disabled=true;
  try{
    const room=await api('create',{});
    state.role='teacher';state.token=room.token;state.room=room.code;state.pin=room.pin;state.dir=handle;state.alive=true;
    hide('startPanel');show('teacherPanel');
    $('roomCode').textContent=room.code;$('roomPin').textContent=room.pin;
    $('folderLabel').textContent='Pasta local: '+handle.name;
    await previewTeacher();
    poll();
  }catch(err){flash('Nao foi possivel iniciar: '+err.message,true);$('selectFolder').disabled=false;}
});

async function resolveDirectory(parts){
  if(!state.dir)throw new Error('Nenhuma pasta foi autorizada.');
  if(!Array.isArray(parts)||parts.length>20||parts.some(p=>!validPart(p)))throw new Error('Caminho de pasta invalido.');
  let folder=state.dir;
  for(const part of parts)folder=await folder.getDirectoryHandle(part,{create:false});
  return folder;
}
async function previewTeacher(){
  const preview=$('teacherPreview');preview.replaceChildren();
  try{
    const items=[];
    for await (const [name,handle] of state.dir.entries())items.push((handle.kind==='directory'?'📁 ':'📄 ')+name);
    items.sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const heading=document.createElement('strong');heading.textContent=`Conteudo da pasta (${items.length} itens)`;preview.append(heading);
    const desc=document.createElement('p');desc.className='muted';desc.textContent=items.slice(0,12).join('  •  ') || 'A pasta esta vazia.';preview.append(desc);
    if(items.length>12){const more=document.createElement('small');more.textContent=`Outros ${items.length-12} itens nao exibidos nesta visualizacao.`;preview.append(more);}
  }catch(e){flash('Pasta indisponivel: '+e.message,true);}
}
$('refreshTeacher').addEventListener('click',previewTeacher);
async function copyText(s){try{await navigator.clipboard.writeText(s);flash('Copiado para a area de transferencia.');}catch{flash('Nao foi possivel copiar automaticamente. Selecione e copie o texto exibido.');}}
$('copyCode').addEventListener('click',()=>copyText(state.room||''));
$('copyPin').addEventListener('click',()=>copyText(state.pin||''));
$('copyInvite').addEventListener('click',()=>copyText(`Acesse os arquivos da aula: ${location.origin}/?s=${state.room}\nCodigo da sala: ${state.room}\nSenha: ${state.pin}\nMantenha estes dados apenas com a turma.`));
$('stopShare').addEventListener('click',async()=>{
  if(!confirm('Encerrar a sala? Os alunos perderao acesso aos arquivos.'))return;
  const old=state.token;state.alive=false;state.token=null;
  if(old)try{await api('close',{token:old});}catch{}
  location.href=location.pathname;
});

const forbiddenUpload=/\.(exe|msi|bat|cmd|ps1|scr|vbs|lnk)$/i;
async function availableFilename(dir,wanted,pathParts){
  const found=new Set();for await(const name of dir.keys())found.add(name.toLowerCase());
  const dot=wanted.lastIndexOf('.');const base=dot>0?wanted.slice(0,dot):wanted;const ext=dot>0?wanted.slice(dot):'';
  for(let n=0;n<1000;n++){
    const candidate=n===0?wanted:`${base} (${n})${ext}`;
    const mark=JSON.stringify([...pathParts,candidate.toLowerCase()]);
    if(!found.has(candidate.toLowerCase())&&!state.reserved.has(mark)){
      state.reserved.add(mark);return {candidate,mark};
    }
  }
  throw new Error('Nao foi possivel escolher um nome novo.');
}
const teacherJobs=new Map();
function jobKey(from,id){return from+'|'+id;}
async function reply(to,id,phase,extra={}){await send({type:'answer',to,id,phase,...extra});}
async function teacherEvent(evt){
  if(evt.type==='student_count'){$('studentCount').textContent=String(evt.count);return;}
  if(evt.type==='closed'){flash(evt.message,true);state.alive=false;return;}
  if(!evt.from||!evt.id)return;
  const key=jobKey(evt.from,evt.id);
  try{
    if(evt.type==='request'){
      if(!Array.isArray(evt.path)||evt.path.some(p=>!validPart(p)))throw new Error('Caminho invalido.');
      const dir=await resolveDirectory(evt.path);
      if(evt.op==='list'){
        const entries=[];
        for await(const [name,handle] of dir.entries()){
          if(entries.length>=400)throw new Error('A pasta possui mais de 400 itens. Divida os arquivos em subpastas.');
          entries.push({name,kind:handle.kind});
        }
        entries.sort((a,b)=>a.kind===b.kind?a.name.localeCompare(b.name,'pt-BR'):(a.kind==='directory'?-1:1));
        await reply(evt.from,evt.id,'done',{entries});return;
      }
      if(!allowedName(evt.name))throw new Error('Nome de arquivo invalido.');
      if(evt.op==='download'){
        const fileHandle=await dir.getFileHandle(evt.name,{create:false});
        const file=await fileHandle.getFile();
        if(file.size>MAX_FILE)throw new Error('Arquivo acima do limite de 40 MB do prototipo.');
        teacherJobs.set(key,{kind:'download',file,offset:0,to:evt.from,id:evt.id});
        await reply(evt.from,evt.id,'ready',{name:evt.name,size:file.size});return;
      }
      if(evt.op==='upload'){
        if(forbiddenUpload.test(evt.name))throw new Error('Por seguranca, este tipo de arquivo nao pode ser enviado.');
        if(!Number.isSafeInteger(evt.size)||evt.size>MAX_FILE||evt.size<0)throw new Error('Arquivo acima do limite permitido.');
        const {candidate,mark}=await availableFilename(dir,evt.name,evt.path);
        try{
          const handle=await dir.getFileHandle(candidate,{create:true});
          const writer=await handle.createWritable({keepExistingData:false});
          teacherJobs.set(key,{kind:'upload',writer,size:evt.size,received:0,to:evt.from,id:evt.id,candidate,mark});
          await reply(evt.from,evt.id,'ready',{savedName:candidate});return;
        }catch(err){state.reserved.delete(mark);throw err;}
      }
      throw new Error('Operacao desconhecida.');
    }
    const job=teacherJobs.get(key);
    if(!job)return;
    if(evt.type==='cancel'){
      if(job.kind==='upload'){await job.writer.abort().catch(()=>{});state.reserved.delete(job.mark);}
      teacherJobs.delete(key);return;
    }
    if(evt.type==='chunk'&&job.kind==='upload'){
      const bytes=fromBase64(evt.data);
      if(bytes.length>CHUNK_BYTES || job.received+bytes.length>job.size)throw new Error('Tamanho de upload inconsistente.');
      await job.writer.write(bytes);job.received+=bytes.length;
      await send({type:'ack',to:evt.from,id:evt.id});return;
    }
    if(evt.type==='finish'&&job.kind==='upload'){
      if(job.received!==job.size)throw new Error('Arquivo incompleto. Envio cancelado.');
      await job.writer.close();state.reserved.delete(job.mark);teacherJobs.delete(key);
      await reply(evt.from,evt.id,'done',{savedName:job.candidate});return;
    }
    if(evt.type==='pull'&&job.kind==='download'){
      if(job.offset>=job.file.size){teacherJobs.delete(key);await reply(evt.from,evt.id,'done');return;}
      const buf=await job.file.slice(job.offset,job.offset+CHUNK_BYTES).arrayBuffer();
      job.offset+=buf.byteLength;
      await send({type:'chunk',to:evt.from,id:evt.id,data:toBase64(new Uint8Array(buf))});return;
    }
  }catch(err){
    const job=teacherJobs.get(key);
    if(job?.kind==='upload'){await job.writer.abort().catch(()=>{});state.reserved.delete(job.mark);}
    teacherJobs.delete(key);
    await reply(evt.from,evt.id,'error',{message:err.message||'Falha de acesso ao arquivo.'}).catch(()=>{});
  }
}

$('joinForm').addEventListener('submit',async(ev)=>{
  ev.preventDefault();clearFlash();
  const code=$('roomInput').value.trim().toUpperCase();const pin=$('pinInput').value.trim().toUpperCase();
  const button=$('joinForm').querySelector('button');button.disabled=true;
  try{
    const result=await api('join',{code,pin});
    state.role='student';state.token=result.token;state.room=code;state.alive=true;state.path=[];
    hide('startPanel');show('studentPanel');$('studentRoom').textContent='Sala '+code;
    poll();await listFolder();
  }catch(err){flash(err.message,true);button.disabled=false;}
});
$('leaveRoom').addEventListener('click',async()=>{
  const old=state.token;state.alive=false;state.token=null;
  try{await api('close',{token:old})}catch{}
  location.href=location.pathname;
});
function beginRequest(op,extra={}){
  const id=makeId();let resolve,reject;
  const result=new Promise((a,b)=>{resolve=a;reject=b;});
  const job={op,id,resolve,reject,...extra};state.jobs.set(id,job);
  send({type:'request',id,op,path:[...state.path],...(extra.name?{name:extra.name}:{}),...(extra.file?{size:extra.file.size}:{})})
    .catch(err=>{state.jobs.delete(id);reject(err)});
  return result;
}
async function listFolder(){
  const current=++navigationSerial;
  $('files').textContent='Carregando pasta…';
  renderBreadcrumbs();
  try{
    const answer=await beginRequest('list');
    if(current!==navigationSerial)return;
    renderFiles(answer.entries||[]);
  }catch(err){if(current===navigationSerial){$('files').textContent='Nao foi possivel listar arquivos.';flash(err.message,true);}}
}
function renderBreadcrumbs(){
  const nav=$('breadcrumbs');nav.replaceChildren();
  const parts=['Inicio',...state.path];
  for(let i=0;i<parts.length;i++){
    const button=document.createElement('button');button.type='button';button.textContent=parts[i];
    button.addEventListener('click',()=>{state.path=state.path.slice(0,i);listFolder()});
    nav.append(button);if(i<parts.length-1){const s=document.createElement('span');s.textContent='›';nav.append(s);}
  }
}
function renderFiles(entries){
  const target=$('files');target.replaceChildren();
  if(!entries.length){target.textContent='Esta pasta esta vazia.';return;}
  for(const entry of entries){
    const row=document.createElement('div');row.className='fileitem';
    const icon=document.createElement('span');icon.className='fileicon';icon.textContent=entry.kind==='directory'?'📁':'📄';
    const desc=document.createElement('div');desc.className='filedesc';
    const label=document.createElement('div');label.className='filename';label.textContent=entry.name;desc.append(label);
    const btn=document.createElement('button');btn.type='button';btn.className='minor';
    if(entry.kind==='directory'){
      btn.textContent='Abrir';btn.addEventListener('click',()=>{if(!validPart(entry.name))return;state.path.push(entry.name);listFolder()});
    } else {
      btn.textContent='⬇ Baixar';btn.addEventListener('click',()=>downloadFile(entry.name));
    }
    row.append(icon,desc,btn);target.append(row);
  }
}
$('refreshList').addEventListener('click',listFolder);
$('uploadButton').addEventListener('click',async()=>{
  clearFlash();const file=$('uploadFile').files?.[0];
  if(!file)return flash('Selecione um arquivo para enviar.',true);
  if(file.size>MAX_FILE)return flash('Este prototipo aceita arquivos ate 40 MB.',true);
  if(!allowedName(file.name)||forbiddenUpload.test(file.name))return flash('Nome ou tipo de arquivo nao permitido.',true);
  $('uploadButton').disabled=true;setProgress('Preparando envio: '+file.name,0);
  try{
    const result=await beginRequest('upload',{file,name:file.name,offset:0});
    hide('progress');$('uploadFile').value='';flash('Arquivo enviado para a pasta do professor: '+result.savedName);
    await listFolder();
  }catch(err){hide('progress');flash('Erro no envio: '+err.message,true);}
  finally{$('uploadButton').disabled=false;}
});
async function downloadFile(name){
  clearFlash();setProgress('Baixando '+name,0);
  try{
    const result=await beginRequest('download',{name,parts:[],received:0,size:0});
    const objectUrl=URL.createObjectURL(new Blob(result.parts,{type:'application/octet-stream'}));
    const anchor=document.createElement('a');anchor.href=objectUrl;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
    hide('progress');flash('Download preparado: '+name);
  }catch(err){hide('progress');flash('Erro no download: '+err.message,true);}
}
async function sendNextChunk(job){
  if(job.offset>=job.file.size){await send({type:'finish',id:job.id});return;}
  const bytes=new Uint8Array(await job.file.slice(job.offset,job.offset+CHUNK_BYTES).arrayBuffer());
  job.offset+=bytes.byteLength;
  setProgress('Enviando: '+job.file.name,100*job.offset/Math.max(1,job.file.size));
  await send({type:'chunk',id:job.id,data:toBase64(bytes)});
}
async function studentEvent(evt){
  if(evt.type==='closed'){state.alive=false;rejectJobs(evt.message);flash(evt.message,true);return;}
  const job=state.jobs.get(evt.id);if(!job)return;
  if(evt.type==='answer'){
    if(evt.phase==='error'){state.jobs.delete(evt.id);job.reject(new Error(evt.message||'Falha no computador do professor.'));return;}
    if(evt.phase==='ready'){
      if(job.op==='upload'){job.savedName=evt.savedName;sendNextChunk(job).catch(err=>{state.jobs.delete(job.id);job.reject(err);send({type:'cancel',id:job.id}).catch(()=>{})});}
      if(job.op==='download'){job.size=evt.size;send({type:'pull',id:job.id}).catch(err=>{state.jobs.delete(job.id);job.reject(err)});}
      return;
    }
    if(evt.phase==='done'){
      state.jobs.delete(evt.id);
      if(job.op==='list')job.resolve({entries:evt.entries});
      else if(job.op==='upload')job.resolve({savedName:evt.savedName||job.savedName});
      else if(job.op==='download')job.resolve({parts:job.parts});
      return;
    }
  }
  if(evt.type==='ack' && job.op==='upload'){
    sendNextChunk(job).catch(err=>{state.jobs.delete(job.id);job.reject(err);send({type:'cancel',id:job.id}).catch(()=>{})});
    return;
  }
  if(evt.type==='chunk'&&job.op==='download'){
    const bytes=fromBase64(evt.data);job.received+=bytes.byteLength;
    if(job.received>MAX_FILE||job.received>job.size){state.jobs.delete(job.id);job.reject(new Error('Arquivo maior que o tamanho esperado.'));await send({type:'cancel',id:job.id}).catch(()=>{});return;}
    job.parts.push(bytes);setProgress('Baixando '+job.name,job.size?100*job.received/job.size:100);
    await send({type:'pull',id:job.id});
  }
}
(function boot(){
  const params=new URLSearchParams(location.search);const code=params.get('s');
  if(code){setTab(false);$('roomInput').value=code.trim().toUpperCase().slice(0,8);}
})();
