'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public/gestao.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public/gestao.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
test('user tab and refresh hooks are installed even when old switch-to-teacher control is absent',async()=>{
 const elements=new Map();
 function el(id){
  if(!elements.has(id)){
   const s=new Set(['panelUsuarios','panelProfessores'].includes(id)?['hidden']:id==='tabCadastro'?['selected']:[]);
   const node={
    id,children:[],handlers:new Map(),classList:{add:x=>s.add(x),remove:x=>s.delete(x),toggle:(x,on)=>on?s.add(x):s.delete(x),contains:x=>s.has(x)},
    setAttribute(){},addEventListener(name,cb){this.handlers.set(name,cb)},replaceChildren(){this.children=[]},
    append(...xs){this.children.push(...xs)},querySelector(){return null},textContent:'',disabled:false,reset(){},style:{}
   };
   elements.set(id,node);
  }
  return elements.get(id);
 }
 const document={
  visibilityState:'visible',
  getElementById(id){return id==='switchToTeacher'?null:el(id)},
  createElement(){return el('new'+elements.size)},
  addEventListener(){},
 };
 const requests=[];
 const context={document,location:{replace(){}},window:{},Blob:function(){},URL:{},confirm:()=>false,
  setInterval(){return 1},
  fetch:async url=>{
   requests.push(url);
   const value=url.endsWith('auth/me')?{role:'admin',storage:'postgres'}:
    url.endsWith('teachers/list')?{teachers:[{id:'t1',name:'Ana',username:'ana',school:'ETEC',active:true,online:true,activeRooms:1,roomsCreated:3}]}:
    url.endsWith('teachers/users')?{rooms:[]}:{teachers:[]};
   return {ok:true,json:async()=>value};
  }
 };
 vm.runInNewContext(js,context,{filename:'gestao.js'});
 for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.filter(s=>s.endsWith('teachers/list')).length,1);
 assert.equal(requests.some(s=>s.endsWith('teachers/dashboard')),false,'initial render must not run duplicate query');
 assert.equal(el('professorDashboard').children.length,1);
 assert.equal(el('panelCadastro').classList.contains('hidden'),false);
 assert.equal(el('panelProfessores').classList.contains('hidden'),true);
 const openMonitor=el('tabProfessores').handlers.get('click');
 assert.equal(typeof openMonitor,'function');
 openMonitor();
 assert.equal(el('panelProfessores').classList.contains('hidden'),false);
 assert.equal(el('panelCadastro').classList.contains('hidden'),true);
 assert.equal(el('panelUsuarios').classList.contains('hidden'),true);
 for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.filter(s=>s.endsWith('teachers/dashboard')).length,1);
 const click=el('tabUsuarios').handlers.get('click');
 assert.equal(typeof click,'function');
 click();
 assert.equal(el('panelUsuarios').classList.contains('hidden'),false);
 assert.equal(el('panelProfessores').classList.contains('hidden'),true);
 assert.equal(el('panelCadastro').classList.contains('hidden'),true);
 for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.filter(s=>s.endsWith('teachers/users')).length,1);
 el('tabCadastro').handlers.get('click')();
 assert.equal(el('panelCadastro').classList.contains('hidden'),false);
 assert.equal(el('panelUsuarios').classList.contains('hidden'),true);
 assert.equal(el('panelProfessores').classList.contains('hidden'),true);
});
test('admin monitor APIs stay restricted to admin and share one teacher snapshot function',()=>{
 assert.match(server,/function summarizeTeachers\(teachers\)/);
 assert.match(server,/pathname==='\/api\/admin\/teachers\/list'/);
 assert.match(server,/pathname==='\/api\/admin\/teachers\/users'/);
 assert.match(server,/admin\.role!=='admin'/);
 for(const name of ['tabCadastro','tabProfessores','tabUsuarios','panelCadastro','panelProfessores','panelUsuarios','adminStudentEvents'])
  assert.ok(html.includes('id="'+name+'"'),name);
});

test('cada uma das tres guias tem conteudo exclusivo e formulario preservado',()=>{
 const cadastro=html.slice(html.indexOf('<section id="panelCadastro"'),html.indexOf('<section id="panelProfessores"'));
 const online=html.slice(html.indexOf('<section id="panelProfessores"'),html.indexOf('<section id="panelUsuarios"'));
 const usuarios=html.slice(html.indexOf('<section id="panelUsuarios"'));
 assert.match(cadastro,/id="teacherForm"/);
 assert.match(cadastro,/id="teachers"/);
 assert.doesNotMatch(cadastro,/id="professorDashboard"/);
 assert.match(online,/id="professorDashboard"/);
 assert.doesNotMatch(online,/id="teacherForm"/);
 assert.match(usuarios,/id="adminStudentEvents"/);
 assert.match(usuarios,/id="exportUsers"/);
});
