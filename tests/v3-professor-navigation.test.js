'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const view=fs.readFileSync(path.join(root,'public/atividades.html'),'utf8');
const legacy=fs.readFileSync(path.join(root,'public/professor.html'),'utf8');
const admin=fs.readFileSync(path.join(root,'public/gestao.html'),'utf8');
test('main professor entry redirects to v3 when enabled and legacy has a separate path',()=>{
 assert.match(server,/pathname==='\/professor'&&V3_API_ENABLED/);
 assert.match(server,/principal\.role==='admin'\?'\/gestao':'\/atividades'/);
 assert.match(server,/\/compartilhar':'professor\.html'/);
 assert.match(legacy,/href="\/professor"/);
});
test('v3 management has direct sections for class, enrollment, activities, and files',()=>{
 for(const id of ['gerenciarTurmas','gerenciarAlunos','gerenciarAtividades','receberEntregas']){
   assert.ok(view.includes('id="'+id+'"'),id);
 }
 assert.match(view,/href="\/compartilhar"/);
 assert.match(view,/Gerar novo código/);
});
test('administration offers real exit-and-sign-in to teacher role',()=>{
 const js=fs.readFileSync(path.join(root,'public/gestao.js'),'utf8');
 assert.match(admin,/id="switchToTeacher"/);
 assert.match(js,/switchToTeacher/);
 assert.match(js,/post\('admin\/logout'\)/);
});
