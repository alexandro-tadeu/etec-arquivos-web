'use strict';
const $=id=>document.getElementById(id);
function flash(text,bad=false){const e=$('message');e.textContent=text;e.classList.remove('hidden');e.classList.toggle('bad',bad);}
async function post(route,body={}){
  const r=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({error:'Falha na resposta do servidor.'}));
  if(!r.ok)throw new Error(data.error||`Erro ${r.status}`);
  return data;
}
let teachers=[];
async function refresh(){
  const profile=await post('auth/me');
  if(profile.role!=='admin'){location.replace('/professor');return;}
  if(profile.storage!=='postgres'){
    $('storageNote').textContent=profile.storage==='unconfigured'?'Banco de dados não configurado. Adicione DATABASE_URL ao Render antes de cadastrar professores.':'Modo de desenvolvimento: cadastros locais não são adequados para o Render. Configure DATABASE_URL.';
    $('storageNote').classList.remove('hidden');
    $('addTeacher').disabled=true;
  }else {$('storageNote').classList.add('hidden');$('addTeacher').disabled=false;}
  // A mesma resposta alimenta as duas tabelas, sem repetir a consulta SQL.
  const data=await post('admin/teachers/list');teachers=data.teachers;
  renderTeachers();
  renderDashboard(teachers);
}
function renderTeachers(){
  const tbody=$('teachers');tbody.replaceChildren();
  if(!teachers.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=5;td.textContent='Nenhum professor cadastrado.';tr.append(td);tbody.append(tr);return;}
  for(const t of teachers){
    const tr=document.createElement('tr');
    for(const field of [t.name,t.username,t.school]){const td=document.createElement('td');td.textContent=field||'—';tr.append(td);}
    const status=document.createElement('td');status.textContent=t.active?'Ativo':'Inativo';status.className=t.active?'status-on':'status-off';tr.append(status);
    const actions=document.createElement('td');actions.className='management-actions';
    const toggle=document.createElement('button');toggle.className='minor';toggle.type='button';toggle.textContent=t.active?'Desativar':'Reativar';
    toggle.addEventListener('click',()=>changeStatus(t));
    const reset=document.createElement('button');reset.className='minor';reset.type='button';reset.textContent='Redefinir senha';reset.addEventListener('click',()=>resetPassword(t));
    actions.append(toggle,reset);tr.append(actions);tbody.append(tr);
  }
}
async function changeStatus(t){
  if(!confirm(`${t.active?'Desativar':'Reativar'} ${t.name}? As salas abertas serão encerradas.`))return;
  try{await post('admin/teachers/status',{id:t.id,active:!t.active});flash('Situação atualizada: '+t.name);await refresh();}
  catch(e){flash(e.message,true);}
}
let resetTeacherId=null;
function resetPassword(t){
  resetTeacherId=t.id;
  $('resetTitle').textContent='Redefinir senha — '+t.name;
  $('newPassword').value='';
  $('resetDialog').showModal();
  $('newPassword').focus();
}
$('cancelReset').addEventListener('click',()=>{$('resetDialog').close();resetTeacherId=null;});
$('resetForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const password=$('newPassword').value;
  if(password.length<12){flash('A senha precisa ter pelo menos 12 caracteres.',true);return;}
  if(!confirm('Confirmar alteração? A sessão e a sala do professor serão encerradas.'))return;
  try{
    await post('admin/teachers/reset',{id:resetTeacherId,password});
    $('resetDialog').close();$('newPassword').value='';resetTeacherId=null;
    flash('Senha atualizada. Entregue a nova senha ao professor por canal privado.');await refresh();
  }catch(e){flash(e.message,true);}
});
$('teacherForm').addEventListener('submit',async e=>{
  e.preventDefault();$('addTeacher').disabled=true;
  const data={name:$('name').value.trim(),school:$('school').value.trim(),username:$('username').value.trim().toLowerCase(),password:$('password').value};
  try{await post('admin/teachers/create',data);$('teacherForm').reset();flash('Professor cadastrado! Informe o nome de usuário e a senha inicial de forma privada.');await refresh();}
  catch(err){flash(err.message,true);}finally{$('addTeacher').disabled=false;}
});
$('refresh').addEventListener('click',()=>refresh().catch(e=>flash(e.message,true)));
$('switchToTeacher')?.addEventListener('click',async()=>{
 try{await post('admin/logout');location.replace('/admin');}
 catch(e){flash(e.message,true);}
});
$('logout').addEventListener('click',async()=>{try{await post('admin/logout');location.replace('/admin');}catch(e){flash(e.message,true);}});
// Monitoramento administrativo separado do login das salas.
let adminRooms=[];
let selectedTab='professores';
function makeCell(value){const cell=document.createElement('td');cell.textContent=String(value??'—');return cell;}
function timeBR(v){return v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—';}
function renderDashboard(items){
 const body=$('professorDashboard');body.replaceChildren();
 for(const t of items){
  const tr=document.createElement('tr');
  [t.name,t.username,t.online?'Online':'Offline',t.activeRooms,t.roomsCreated].forEach(x=>tr.append(makeCell(x)));
  body.append(tr);
 }
 if(!items.length){const tr=document.createElement('tr');const td=makeCell('Nenhum professor');td.colSpan=5;tr.append(td);body.append(tr);}
 $('dashboardSyncedAt').textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'});
}
let dashboardPending=null;
async function loadDashboard(){
 if(dashboardPending)return dashboardPending;
 dashboardPending=(async()=>{
  const data=await post('admin/teachers/dashboard');
  renderDashboard(data.teachers);
 })().finally(()=>{dashboardPending=null;});
 return dashboardPending;
}
function studentEventRows(){
 const rows=[];
 for(const room of adminRooms){
  const visits=new Map((room.visits||[]).map(x=>[x.studentId,x]));
  for(const e of room.entries||[]){
   const v=visits.get(e.studentId);
   rows.push([room.teacherName,room.roomCode,e.studentName,v?.status==='ONLINE'?'Online':'Offline',
     e.event==='ENTRY'?'Entrada':e.event==='EXIT'?'Saída':'Arquivo recebido',
     timeBR(v?.joinedAt),timeBR(v?.leftAt),timeBR(e.at),
     e.filename?[...(e.pathParts||[]),e.filename].join('/'):'—']);
  }
 }
 return rows;
}
let usersPending=null;
async function loadUsers(){
 if(usersPending)return usersPending;
 usersPending=(async()=>{
 $('usersSyncedAt').textContent='Atualizando acessos…';
 const data=await post('admin/teachers/users');adminRooms=data.rooms;
 const body=$('adminStudentEvents');body.replaceChildren();
 for(const row of studentEventRows()){const tr=document.createElement('tr');row.forEach(x=>tr.append(makeCell(x)));body.append(tr);}
 if(!body.children.length){const tr=document.createElement('tr');const cell=makeCell('Nenhum acesso em salas abertas.');cell.colSpan=9;tr.append(cell);body.append(tr);}
 $('usersSyncedAt').textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo'});
 })().finally(()=>{usersPending=null;});
 return usersPending;
}
function adminCsvCell(value){
 let v=String(value??'');
 if(/^[\s]*[=+@\-\t\r]/u.test(v))v="'"+v;
 return '"'+v.replace(/"/g,'""')+'"';
}
function saveUsersCsv(){
 const header=['Professor','Sala','Aluno','Status','Registro','Entrada','Saída','Data / hora','Arquivo'];
 const csv='\uFEFF'+[header,...studentEventRows()].map(row=>row.map(adminCsvCell).join(';')).join('\r\n')+'\r\n';
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='etec_usuarios_salas_'+new Date().toISOString().slice(0,10)+'.csv';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function setAdminTab(tab){
 selectedTab=tab;
 const users=tab==='usuarios';
 $('panelProfessores').classList.toggle('hidden',users);
 $('panelUsuarios').classList.toggle('hidden',!users);
 $('tabProfessores').classList.toggle('selected',!users);
 $('tabUsuarios').classList.toggle('selected',users);
 $('tabProfessores').setAttribute('aria-selected',String(!users));
 $('tabUsuarios').setAttribute('aria-selected',String(users));
 if(users)loadUsers().catch(e=>flash(e.message,true));
 else loadDashboard().catch(e=>flash(e.message,true));
}
$('tabProfessores').addEventListener('click',()=>setAdminTab('professores'));
$('tabUsuarios').addEventListener('click',()=>setAdminTab('usuarios'));
$('refreshDashboard').addEventListener('click',()=>loadDashboard().catch(e=>flash(e.message,true)));
$('refreshUsers').addEventListener('click',()=>loadUsers().catch(e=>flash(e.message,true)));
$('exportUsers').addEventListener('click',async()=>{try{await loadUsers();saveUsersCsv();}catch(e){flash(e.message,true);}});
refresh().catch(e=>flash(e.message,true));
// A sincronizacao ocorre apenas na guia visivel, sem recarregar toda a pagina.
setInterval(()=>{
 if(document.visibilityState==='hidden')return;
 if(selectedTab==='usuarios')loadUsers().catch(e=>flash(e.message,true));
 else loadDashboard().catch(e=>flash(e.message,true));
},20000);
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState!=='visible')return;
 if(selectedTab==='usuarios')loadUsers().catch(e=>flash(e.message,true));
 else loadDashboard().catch(e=>flash(e.message,true));
});
