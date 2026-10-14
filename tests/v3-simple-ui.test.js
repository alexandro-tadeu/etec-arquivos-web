'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'public/atividades.html'),'utf8'),js=fs.readFileSync(path.join(root,'public/atividades.js'),'utf8'),srv=fs.readFileSync(path.join(root,'server.js'),'utf8');
test('teacher and student use simple v2-style single academic screen',()=>{
 for(const id of ['teacherArea','studentArea','roomSelect','roomTitle','studentName','studentRm','activityTitle','activityDeadline','selectFolderV3','studentActivities','receipts','studentLoginForm'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/\/style.css/);assert.match(html,/\/edge-storage.js/);
 assert.doesNotMatch(js,/innerHTML\s*=/);assert.doesNotMatch(js,/localStorage|sessionStorage/);
});
test('browser sends chunks and waits for teacher confirmation',()=>{
 for(const p of ['student/submissions/begin','student/transfer/begin','student/transfer/chunk','student/transfer/finish','student/transfer/status','teacher/relay/poll','teacher/relay/ack','teacher/relay/complete'])assert.ok(js.includes(p),p);
 assert.match(js,/createChunkReceiver/);assert.match(js,/showDirectoryPicker/);assert.match(js,/fileHash/);
 assert.match(srv,/ETEC_V3_API_ENABLED/);assert.match(srv,/\/atividades/);
});
