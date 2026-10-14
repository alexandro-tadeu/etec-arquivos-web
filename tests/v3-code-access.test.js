'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'public/atividades.html'),'utf8'),js=fs.readFileSync(path.join(root,'public/atividades.js'),'utf8');
test('administrator sees teacher guidance, not student login by default',()=>{
 assert.match(html,/id="adminArea"/);assert.match(html,/id="switchToTeacher"/);
 assert.match(html,/Gerenciar professores/);assert.match(js,/identity\?\.role==='admin'/);
});
test('individual code reissue uses teacher endpoint, not local browser storage',()=>{
 const api=fs.readFileSync(path.join(root,'v3/api.js'),'utf8');
 assert.match(api,/teacher\/enrollments\/reset-code/);
 assert.match(api,/const teacherId=await teacher\(req\)/);
 assert.match(js,/Gerar novo código/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML\s*=/);
});
test('refreshing a room does not disconnect its Edge file receiver',()=>{
 assert.match(js,/receiverRoom!==teacherRoom/);
 assert.doesNotMatch(js,/async function loadTeacherData\(\)\{teacherRoom=\$\('roomSelect'\)\.value;relayEpoch\+\+;/);
});
