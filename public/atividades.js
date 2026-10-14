'use strict';
const $=id=>document.getElementById(id);
const teacher=$('teacherArea'),student=$('studentArea');
let selectedRoom='',latestRoomCredentials='',latestStudentCredentials='';
function showError(e){const msg=$('message');msg.textContent=e.message||String(e);msg.classList.remove('hidden');msg.classList.add('bad');}
function showMessage(text){const msg=$('message');msg.textContent=text;msg.classList.remove('hidden');msg.classList.remove('bad');}
async function http(route,{method='GET',data}={}){
 const res=await fetch('/api/v3/'+route,{method,headers:method==='POST'?{'content-type':'application/json'}:undefined,credentials:'same-origin',cache:'no-store',body:method==='POST'?JSON.stringify(data||{}):undefined});
 let result;try{result=await res.json();}catch{throw Error('Resposta invalida do servidor.');}
 if(!res.ok)throw Error(result.error||'Falha na comunicação.');
 return result;
}
function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}
function td(row,value){const cell=document.createElement('td');cell.textContent=String(value??'—');row.append(cell);return cell;}
function empty(tbody,span,message){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=span;cell.textContent=message;row.append(cell);tbody.replaceChildren(row);}
function localDate(value){return value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—';}
async function copy(value){try{await navigator.clipboard.writeText(value);showMessage('Copiado.');}catch{showError(Error('Não foi possível copiar. Selecione o texto exibido.'));}}
async function rooms(){
 const data=await http('teacher/rooms');const select=$('roomSelect'),remember=selectedRoom;select.replaceChildren();option(select,'','Escolha uma turma');
 for(const room of data.rooms||[])option(select,room.id,room.title+' · '+room.code);
 if((data.rooms||[]).some(x=>x.id===remember))select.value=remember;
 selectedRoom=select.value;
 await loadRoom();
}
async function loadRoom(){
 selectedRoom=$('roomSelect').value;
 $('newRoomCredentials').classList.add('hidden');$('newStudentCredentials').classList.add('hidden');
 if(!selectedRoom){empty($('studentRows'),3,'Selecione uma turma.');empty($('activityRows'),4,'Selecione uma turma.');return;}
 const [st,ac]=await Promise.all([
   http('teacher/enrollments?roomId='+encodeURIComponent(selectedRoom)),
   http('teacher/activities?roomId='+encodeURIComponent(selectedRoom))
 ]);
 $('studentRows').replaceChildren();
 for(const item of st.students||[]){const row=document.createElement('tr');td(row,item.full_name);td(row,item.rm);td(row,item.active?'Ativo':'Inativo');$('studentRows').append(row);}
 if(!(st.students||[]).length)empty($('studentRows'),3,'Nenhum aluno cadastrado.');
 $('activityRows').replaceChildren();
 for(const item of ac.activities||[]){
  const row=document.createElement('tr');td(row,item.title);td(row,localDate(item.deadline_at));td(row,item.status);
  const cell=document.createElement('td');
  if(item.status==='DRAFT'){
   const button=document.createElement('button');button.type='button';button.className='minor';button.textContent='Publicar';
   button.addEventListener('click',()=>run(async()=>{await http('teacher/activities/publish',{method:'POST',data:{roomId:selectedRoom,activityId:item.id}});await loadRoom();showMessage('Atividade publicada.');}));cell.append(button);
  }
  row.append(cell);$('activityRows').append(row);
 }
 if(!(ac.activities||[]).length)empty($('activityRows'),4,'Nenhuma atividade cadastrada.');
}
async function run(task){try{await task();}catch(e){showError(e);}}
$('roomSelect').addEventListener('change',()=>run(loadRoom));
$('refreshRooms').addEventListener('click',()=>run(rooms));
$('createRoom').addEventListener('click',()=>run(async()=>{
 const title=$('roomTitle').value.trim();if(title.length<3)throw Error('Informe o nome da turma.');
 const r=await http('teacher/rooms',{method:'POST',data:{title}});
 latestRoomCredentials='Turma: '+r.room.title+'\nCódigo: '+r.room.code+'\nSenha: '+r.pin;
 await rooms();selectedRoom=r.room.id;$('roomSelect').value=selectedRoom;await loadRoom();
 $('roomCredentialsText').textContent=latestRoomCredentials;$('newRoomCredentials').classList.remove('hidden');
 showMessage('Turma criada. Guarde a senha: ela não será exibida novamente.');
}));
$('copyRoomCredentials').addEventListener('click',()=>copy(latestRoomCredentials));
$('enrollStudent').addEventListener('click',()=>run(async()=>{
 if(!selectedRoom)throw Error('Selecione uma turma.');
 const name=$('studentName').value.trim(),rm=$('studentRm').value.trim();
 const r=await http('teacher/enrollments',{method:'POST',data:{roomId:selectedRoom,name,rm}});
 latestStudentCredentials='Aluno: '+r.student.full_name+'\nRM: '+r.student.rm+'\nCódigo individual: '+r.individualCode;
 await loadRoom();$('studentCredentialsText').textContent=latestStudentCredentials;
 $('newStudentCredentials').classList.remove('hidden');$('studentName').value='';$('studentRm').value='';
 showMessage('Aluno cadastrado. Entregue o código individual em particular.');
}));
$('copyStudentCredentials').addEventListener('click',()=>copy(latestStudentCredentials));
$('createActivity').addEventListener('click',()=>run(async()=>{
 if(!selectedRoom)throw Error('Selecione uma turma.');
 const title=$('activityTitle').value.trim(),description=$('activityDescription').value;
 const chosen=$('activityDeadline').value;
 if(!chosen)throw Error('Informe o prazo de entrega.');
 // Converte horario informado pelo usuario no fuso civil de Sao Paulo.
 const deadlineAt=new Date(chosen+':00-03:00').toISOString();
 const allowedExtensions=$('activityFormats').value.split(',');
 const acceptLate=$('activityAcceptLate').checked;
 await http('teacher/activities',{method:'POST',data:{roomId:selectedRoom,title,description,deadlineAt,allowedExtensions,acceptLate}});
 $('activityTitle').value='';$('activityDescription').value='';
 await loadRoom();showMessage('Atividade criada. Clique em Publicar para liberar aos alunos.');
}));
async function studentDashboard(){
 const [me,activities,receipts]=await Promise.all([
  http('student/me'),http('student/activities'),http('student/receipts')
 ]);
 $('studentIdentity').textContent=me.student.name+' · RM '+me.student.rm;
 $('studentActivities').replaceChildren();
 for(const a of activities.activities||[]){
  const line=document.createElement('div');line.className='fileitem';
  const p=document.createElement('p'),b=document.createElement('strong');b.textContent=a.title;
  p.append(b,document.createTextNode(' — prazo: '+localDate(a.deadline_at)));
  const d=document.createElement('small');d.textContent=a.description||'Atividade publicada.';
  line.append(p,d);$('studentActivities').append(line);
 }
 if(!(activities.activities||[]).length)$('studentActivities').textContent='Nenhuma atividade publicada.';
 $('studentReceipts').replaceChildren();
 for(const r of receipts.receipts||[]){
  const line=document.createElement('div');line.className='fileitem';
  line.textContent=r.activityTitle+' · '+r.protocol+' · V'+String(r.version).padStart(3,'0')+' · '+localDate(r.completedAt);
  $('studentReceipts').append(line);
 }
 if(!(receipts.receipts||[]).length)$('studentReceipts').textContent='Nenhuma entrega confirmada.';
 $('studentLoginPanel').classList.add('hidden');$('studentDashboard').classList.remove('hidden');
}
$('studentLoginForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
 const data={roomCode:$('loginRoomCode').value.trim().toUpperCase(),pin:$('loginRoomPin').value.trim().toUpperCase(),
 name:$('loginStudentName').value.trim(),rm:$('loginStudentRm').value.trim(),individualCode:$('loginIndividualCode').value.trim()};
 await http('student/login',{method:'POST',data});$('loginIndividualCode').value='';await studentDashboard();
});});
$('studentLogout').addEventListener('click',()=>run(async()=>{
 await http('student/logout',{method:'POST',data:{}});
 $('studentDashboard').classList.add('hidden');$('studentLoginPanel').classList.remove('hidden');showMessage('Você saiu da turma.');
}));
(async()=>{
 try{const res=await fetch('/api/auth/me',{cache:'no-store'});const me=res.ok?await res.json():null;
  if(me?.role==='teacher'){teacher.classList.remove('hidden');await rooms();}
  else{student.classList.remove('hidden');try{await studentDashboard();}catch{}}
 }catch(e){showError(e);}
})();
