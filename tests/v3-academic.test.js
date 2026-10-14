'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {LIMITS,comparableName,normalizeRm,createStudentSecret,validateManifest,evaluateSubmission,versionLabel,receiptView}=require('../v3/academic');
const deadlineAt='2026-10-13T23:59:00-03:00';
const activity={id:'act-1',roomId:'r1',title:'Exercício',status:'PUBLISHED',deadlineAt,acceptLate:false,allowedExtensions:['.pdf','.zip']};
const files=[{name:'Tarefa.pdf',size:34}];
const input=(o={})=>({activity,studentId:'a1',at:'2026-10-13T22:00:00-03:00',files,...o});
test('nomes e RM preservam identidade sem perder zeros',()=>{
 assert.equal(comparableName('  João    da  SILVA '),'joao da silva');
 assert.equal(normalizeRm('000124'),'000124');
 assert.throws(()=>normalizeRm(124));assert.throws(()=>comparableName('João'));
 assert.notEqual(createStudentSecret(),createStudentSecret());
});
test('manifests enforce file count, size, sum, extensions and unsafe names',()=>{
 assert.equal(validateManifest(files,['.pdf']).length,1);
 assert.throws(()=>validateManifest([]));
 assert.throws(()=>validateManifest(Array.from({length:11},(_,i)=>({name:'f'+i+'.pdf',size:1}))));
 assert.throws(()=>validateManifest([{name:'oversized.pdf',size:LIMITS.bytesPerFile+1}]));
 assert.throws(()=>validateManifest(Array.from({length:3},(_,i)=>({name:'f'+i+'.pdf',size:35*1024*1024}))));
 for(const name of ['../test.pdf','virus.exe','foto.exe.pdf','batch.ps1.zip','A?.pdf','file.PDF.exe'])assert.throws(()=>validateManifest([{name,size:10}]));
 assert.throws(()=>validateManifest([{name:'a.pdf',size:1},{name:'A.pdf',size:1}]));
 assert.throws(()=>validateManifest([{name:'x.png',size:1}],['.pdf']));
});
test('accepts on-time, rejects late unless published accepts it',()=>{
 assert.equal(evaluateSubmission(input()).late,false);
 assert.throws(()=>evaluateSubmission(input({at:'2026-10-14T01:00:00-03:00'})));
 assert.equal(evaluateSubmission(input({activity:{...activity,acceptLate:true},at:'2026-10-14T01:00:00-03:00'})).late,true);
});
test('closed activity requires individual approved reopening with strict deadline',()=>{
 const closed={...activity,status:'CLOSED',acceptLate:true};
 assert.throws(()=>evaluateSubmission(input({activity:closed})));
 const exception={studentId:'a1',activityId:'act-1',approved:true,reopenClosed:true,personalDeadlineAt:'2026-10-15T00:00:00-03:00'};
 assert.equal(evaluateSubmission(input({activity:closed,exception})).closedReopening,true);
 assert.throws(()=>evaluateSubmission(input({activity:closed,exception:{...exception,studentId:'a2'}})));
 assert.throws(()=>evaluateSubmission(input({activity:closed,exception,at:'2026-10-15T00:00:01-03:00'})));
});
test('draft and archived activities forbid submissions',()=>{
 for(const status of ['DRAFT','ARCHIVED'])assert.throws(()=>evaluateSubmission(input({activity:{...activity,status}})));
});
test('version and receipt derives from committed metadata only',()=>{
 assert.equal(versionLabel(1),'V001');assert.equal(versionLabel(128),'V128');
 const student={id:'a1',name:'João Silva',rm:'0012'},room={id:'r1',title:'Sala 2 DS'};
 const submission={status:'COMMITTED',activityId:activity.id,studentId:student.id,version:2,completedAt:'2026-10-13T23:00:00.000Z',late:false,files};
 const receipt=receiptView({submission,activity,student,room,protocol:'PROT-123456'});
 assert.equal(receipt.version,'V002');assert.equal(receipt.rm,'0012');
 assert.throws(()=>receiptView({submission:{...submission,status:'STAGING'},activity,student,room,protocol:'PROT-123456'}));
 assert.throws(()=>receiptView({submission:{...submission,studentId:'a9'},activity,student,room,protocol:'PROT-123456'}));
});
