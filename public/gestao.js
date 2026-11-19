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
    const actions=document.createElement('td');actions.className='teacher-row-actions';
    // Botões de ícone; title fornece a dica nativa no hover e aria-label identifica a ação.
    const action=(label,kind,handler)=>{
      const b=document.createElement('button');
      b.className='teacher-icon-action teacher-icon-'+kind;
      b.type='button';
      b.title=label;
      b.setAttribute('aria-label',label);
      b.addEventListener('click',handler);
      return b;
    };
    const group=document.createElement('div');
    group.className='teacher-action-group';
    group.append(
      action('Editar','edit',()=>editTeacher(t)),
      action(t.active?'Desativar':'Reativar',t.active?'disable':'enable',()=>changeStatus(t)),
      action('Redefinir senha','reset',()=>resetPassword(t)),
      action('Excluir','delete',()=>deleteTeacher(t))
    );
    actions.append(group);tr.append(actions);tbody.append(tr);
  }
}
async function consultTeacher(t){
 try{
  const {teacher}=await post('admin/teachers/detail',{id:t.id});
  const dl=$('teacherDetails');dl.replaceChildren();
  for(const [label,value] of [['Nome completo',teacher.name],['Usuário',teacher.username],['Unidade ETEC',teacher.school],['Situação',teacher.active?'Ativo':'Inativo'],['Conexão',teacher.online?'Online':'Offline'],['Salas criadas',teacher.roomsCreated],['Cadastro',timeBR(teacher.createdAt)]]){
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value??'—');dl.append(dt,dd);
  }
  $('teacherDetailDialog').showModal();
 }catch(e){flash(e.message,true);}
}
let editingId=null;
async function editTeacher(t){
 try{
  const {teacher}=await post('admin/teachers/detail',{id:t.id});
  editingId=teacher.id;$('editName').value=teacher.name;$('editSchool').value=teacher.school||'';$('editUsername').value=teacher.username;$('editError').textContent='';
  $('teacherEditDialog').showModal();
 }catch(e){flash(e.message,true);}
}
$('cancelEdit').addEventListener('click',()=>{$('teacherEditDialog').close();editingId=null;});
$('teacherEditForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!editingId)return;
 if(!confirm('Salvar alterações? As sessões e salas abertas deste professor serão encerradas.'))return;
 const button=$('saveEdit');button.disabled=true;
 try{
  await post('admin/teachers/update',{id:editingId,name:$('editName').value.trim(),school:$('editSchool').value.trim(),username:$('editUsername').value.trim().toLowerCase()});
  $('teacherEditDialog').close();editingId=null;flash('Dados do professor atualizados.');await refresh();
 }catch(e){$('editError').textContent=e.message;flash(e.message,true);}finally{button.disabled=false;}
});
async function deleteTeacher(t){
 if(!confirm('Excluir definitivamente '+t.name+' ('+t.username+')? O cadastro e o acesso serão removidos, e as salas abertas encerradas. Esta ação não pode ser desfeita.'))return;
 try{await post('admin/teachers/delete',{id:t.id,confirm:true});flash('Professor excluído.');await refresh();}
 catch(e){flash(e.message,true);}
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
  if(password.length<8){flash('A senha precisa ter pelo menos 8 caracteres.',true);return;}
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
let selectedTab='cadastro';
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
let transferLoaded=false,transferBusy=false;
function applyTransfer(t){$('transferMaxFile').value=String(t.maxFileMiB);$('transferBlock').value=String(t.downloadBlockKiB);}
async function loadTransfer(){
 if(transferBusy)return;
 transferBusy=true;transferLoaded=false;$('transferFields').disabled=true;$('transferStatus').textContent='Carregando configurações…';
 try{const data=await post('admin/transfer/get');applyTransfer(data.settings);transferLoaded=true;$('transferStatus').textContent='Configurações vigentes para novas salas.';}
 catch(e){$('transferStatus').textContent=e.message;flash(e.message,true);}finally{transferBusy=false;$('transferFields').disabled=!transferLoaded;}
}
$('transferForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!transferLoaded||transferBusy)return;
 transferBusy=true;$('transferFields').disabled=true;
 try{const data=await post('admin/transfer/save',{maxFileMiB:Number($('transferMaxFile').value),downloadBlockKiB:Number($('transferBlock').value)});applyTransfer(data.settings);$('transferStatus').textContent='Salvo. As novas salas usarão estes parâmetros.';flash('Configurações de transferência salvas.');}
 catch(e){$('transferStatus').textContent=e.message;flash(e.message,true);}finally{transferBusy=false;$('transferFields').disabled=false;}
});
$('defaultTransfer').addEventListener('click',()=>{if(!transferLoaded||transferBusy)return;applyTransfer({maxFileMiB:40,downloadBlockKiB:768});$('transferStatus').textContent='Valores padrão preenchidos. Clique em Salvar para aplicar.';});
function setAdminTab(tab){
 if(!['cadastro','professores','usuarios','transfer'].includes(tab))return;
 selectedTab=tab;
 for(const name of ['cadastro','professores','usuarios','transfer']){
  const suffix={cadastro:'Cadastro',professores:'Professores',usuarios:'Usuarios',transfer:'Transfer'}[name];
  const selected=tab===name;
  $('panel'+suffix).classList.toggle('hidden',!selected);
  $('tab'+suffix).classList.toggle('selected',selected);
  $('tab'+suffix).setAttribute('aria-selected',String(selected));
  $('tab'+suffix).tabIndex=selected?0:-1;
 }
 // Consulta apenas a guia solicitada, sem repetir requisicoes SQL entre guias.
 if(tab==='cadastro')refresh().catch(e=>flash(e.message,true));
 else if(tab==='professores')loadDashboard().catch(e=>flash(e.message,true));
 else if(tab==='usuarios')loadUsers().catch(e=>flash(e.message,true));
 else loadTransfer();
}
$('tabCadastro').addEventListener('click',()=>setAdminTab('cadastro'));
$('tabProfessores').addEventListener('click',()=>setAdminTab('professores'));
$('tabUsuarios').addEventListener('click',()=>setAdminTab('usuarios'));
$('tabTransfer').addEventListener('click',()=>setAdminTab('transfer'));
$('refreshDashboard').addEventListener('click',()=>loadDashboard().catch(e=>flash(e.message,true)));
$('refreshUsers').addEventListener('click',()=>loadUsers().catch(e=>flash(e.message,true)));
$('exportUsers').addEventListener('click',async()=>{try{await loadUsers();saveUsersCsv();}catch(e){flash(e.message,true);}});
refresh().catch(e=>flash(e.message,true));
// A sincronizacao ocorre apenas na guia visivel, sem recarregar toda a pagina.
setInterval(()=>{
 if(document.visibilityState==='hidden')return;
 if(selectedTab==='usuarios')loadUsers().catch(e=>flash(e.message,true));
 else if(selectedTab==='professores')loadDashboard().catch(e=>flash(e.message,true));
 else if(selectedTab==='cadastro')refresh().catch(e=>flash(e.message,true));
},20000);
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState!=='visible')return;
 if(selectedTab==='usuarios')loadUsers().catch(e=>flash(e.message,true));
 else if(selectedTab==='professores')loadDashboard().catch(e=>flash(e.message,true));
 else if(selectedTab==='cadastro')refresh().catch(e=>flash(e.message,true));
});
