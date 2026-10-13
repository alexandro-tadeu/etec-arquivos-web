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
  const data=await post('admin/teachers/list');teachers=data.teachers;
  renderTeachers();
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
$('logout').addEventListener('click',async()=>{try{await post('admin/logout');location.replace('/admin');}catch(e){flash(e.message,true);}});
refresh().catch(e=>flash(e.message,true));
