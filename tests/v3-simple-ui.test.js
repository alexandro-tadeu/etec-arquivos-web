'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'public','atividades.html'),'utf8');
const js=fs.readFileSync(path.join(root,'public','atividades.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
test('v3 simple screen keeps basic teacher and student workflow',()=>{
 for(const id of ['teacherArea','studentArea','roomSelect','roomTitle','studentName','studentRm','activityTitle','activityDeadline','activityFormats','studentLoginForm','loginRoomCode','loginIndividualCode','studentActivities','studentReceipts']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(html,/\/style\.css/);
 assert.match(html,/\/atividades\.js/);
 assert.doesNotMatch(html,/cdn\.|bootstrap\.min|react|angular/i);
});
test('student and teacher actions use authenticated backend endpoints',()=>{
 for(const route of ['teacher/rooms','teacher/enrollments','teacher/activities','student/login','student/me','student/activities','student/receipts']){
  assert.ok(js.includes(route),'Expected endpoint: '+route);
 }
 assert.match(js,/textContent/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
 assert.doesNotMatch(js,/localStorage|sessionStorage/);
});
test('v3 screen not exposed by default or in production',()=>{
 assert.match(server,/V3_API_ENABLED\s*&&\s*process\.env\.NODE_ENV\s*!==\s*'production'/);
 assert.match(server,/files\['\/atividades'\]/);
 assert.match(server,/if\(process\.env\.NODE_ENV==='production'\)throw new Error/);
});
