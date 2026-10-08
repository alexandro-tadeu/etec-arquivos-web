'use strict';
const form=document.getElementById('adminLoginForm');
form.addEventListener('submit', async event=>{
  event.preventDefault();
  const button=document.getElementById('loginButton');
  const alert=document.getElementById('message');
  alert.classList.add('hidden');
  button.disabled=true;
  try {
    const response=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({username:document.getElementById('username').value.trim(),password:document.getElementById('password').value})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Não foi possível autenticar.');
    document.getElementById('password').value='';
    location.replace('/professor');
  }catch(err){alert.textContent=err.message;alert.classList.add('bad');alert.classList.remove('hidden');}
  finally{button.disabled=false;}
});
