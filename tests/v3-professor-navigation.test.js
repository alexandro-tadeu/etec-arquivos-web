'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const view=fs.readFileSync(path.join(root,'public/atividades.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public/atividades.js'),'utf8');
test('v3 login sends admin to /admin, teacher to /professor',()=>{
 assert.match(server,/V3_API_ENABLED\?'\/admin':'\/gestao'/);
 assert.match(server,/pathname==='\/admin'/);
 assert.match(server,/principal\.role==='admin'\?serveStatic\(req,res,'\/gestao'\):redirect\(res,'\/professor'\)/);
 assert.match(server,/principal\.role!=='teacher'/);
 assert.match(server,/pathname==='\/professor'\?'\/atividades':'\/compartilhar'/);
});
test('user portal /usuario shows student screen even when browser has teacher cookie',()=>{
 assert.match(server,/pathname==='\/usuario'/);
 assert.match(server,/pathname==='\/atividades'/);
 assert.match(server,/return redirect\(res,'\/usuario'\)/);
 assert.match(js,/here==='\/usuario'/);
 assert.match(js,/\$\('studentArea'\)\.classList\.remove\('hidden'\)/);
});
test('administrator management and teacher management have separate views',()=>{
 const admin=fs.readFileSync(path.join(root,'public/gestao.html'),'utf8');
 assert.match(admin,/Gestão de professores/);
 for(const id of ['gerenciarTurmas','gerenciarAlunos','gerenciarAtividades','receberEntregas'])assert.ok(view.includes('id="'+id+'"'),id);
 assert.match(view,/href="\/compartilhar"/);
});
test('teacher or admin role can be recovered through GET /api/auth/me',()=>{
 assert.match(server,/req\.method==='GET'&&pathname==='\/api\/auth\/me'/);
 assert.match(server,/role:principal\.role,name:principal\.name/);
});
