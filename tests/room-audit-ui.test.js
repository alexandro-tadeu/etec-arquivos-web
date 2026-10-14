'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/professor.html'),'utf8');
const srv=fs.readFileSync(path.join(root,'server.js'),'utf8');
test('teacher has room access table and button to save real CSV',()=>{
 for(const id of ['roomAccessRows','roomOnlineNames','refreshRoomReport','downloadRoomCsv'])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(js,/text\/csv;charset=utf-8/);
 assert.match(js,/createObjectURL/);
 assert.match(js,/etec_acessos_/);
 assert.match(js,/America\/Sao_Paulo/);
 assert.match(js,/csvCell/);
 assert.match(js,/downloadRoomCsv\(\)/);
});
test('access and upload events only returned to authenticated teacher',()=>{
 assert.match(srv,/pathname === '\/api\/room-report'/);
 assert.match(srv,/sess\.role!=='teacher'/);
 assert.match(srv,/roomAudit\(room,'ENTRY',name\)/);
 assert.match(srv,/roomAudit\(room,'UPLOAD',state\.student\.name,state\.pathParts,msg\.savedName\)/);
});
test('report shows relative path, not inaccessible Windows absolute location',()=>{
 assert.match(js,/state\.dir\?\.name/);
 assert.match(js,/\.\.\.\(record\.pathParts\|\|\[\]\),record\.filename/);
 assert.match(html,/relativo a pasta autorizada/);
});
