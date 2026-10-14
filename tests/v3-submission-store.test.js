'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createSubmissionStore,policyFiles,privatePath,validateEvidence}=require('../v3/submission-store');
const teacherId=crypto.randomUUID(),studentId=crypto.randomUUID(),roomId=crypto.randomUUID(),activityId=crypto.randomUUID();
const sha=crypto.createHash('sha256').update('abc').digest('hex');
const docs=[{name:'Trabalho.pdf',size:3,sha256:sha}];
function mockDb(){
 const records=[],files=[],clock={value:'2026-10-13T21:00:00.000Z'}, activity={id:activityId,room_id:roomId,status:'PUBLISHED',deadline_at:'2026-10-14T02:59:00.000Z',allowed_extensions:['.pdf'],accept_late:false,max_files:10,max_file_bytes:41943040,max_total_bytes:104857600};
 const client={release(){},async query(sql,p=[]){
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rowCount:0,rows:[]};
  if(sql.includes('SELECT clock_timestamp()'))return {rows:[{now:new Date(clock.value)}],rowCount:1};
  if(sql.includes('FROM etec_v3_enrollments e JOIN etec_v3_rooms'))return {rows:[{...activity,enrollment_id:studentId,active:true}],rowCount:1};
  if(sql.includes('FROM etec_v3_activity_exceptions'))return {rows:[],rowCount:0};
  if(sql.includes('FROM etec_v3_submission_versions WHERE activity_id=')&&sql.includes('request_key=')){
   const r=records.find(x=>x.activity_id===p[0]&&x.enrollment_id===p[1]&&x.request_key===p[2]);return {rows:r?[r]:[],rowCount:r?1:0};
  }
  if(sql.includes('FROM etec_v3_submission_versions WHERE activity_id=')&&sql.includes("status='STAGING'")){
   const r=records.find(x=>x.activity_id===p[0]&&x.enrollment_id===p[1]&&x.status==='STAGING');return {rows:r?[r]:[],rowCount:r?1:0};
  }
  if(sql.includes('SELECT COALESCE(MAX(version)'))return {rows:[{n:Math.max(0,...records.filter(x=>x.activity_id===p[0]&&x.enrollment_id===p[1]).map(x=>x.version))}],rowCount:1};
  if(sql.includes('INSERT INTO etec_v3_submission_versions')){records.push({id:p[0],activity_id:p[1],enrollment_id:p[2],version:p[3],request_key:p[4],status:'STAGING',manifest:JSON.parse(p[5]),created_at:clock.value});return {rowCount:1,rows:[]};}
  if(sql.includes("SET status='FAILED'")){const r=records.find(x=>x.id===p[0]);r.status='FAILED';return {rowCount:1,rows:[]};}
  if(sql.includes('JOIN etec_v3_enrollments e ON e.id=s.enrollment_id')){
   const r=records.find(x=>x.id===p[0]);if(!r||p[1]!==teacherId)return {rowCount:0,rows:[]};return {rowCount:1,rows:[{...r,room_id:roomId,activity_status:activity.status,deadline_at:activity.deadline_at,allowed_extensions:activity.allowed_extensions,accept_late:activity.accept_late,max_files:10,max_file_bytes:41943040,max_total_bytes:104857600}]};
  }
  if(sql.includes('SELECT s.id,s.status,s.manifest')){
   const r=records.find(x=>x.id===p[0]);return {rowCount:r&&p[1]===teacherId?1:0,rows:r&&p[1]===teacherId?[r]:[]};
  }
  if(sql.includes("SET status='COMMITTED'")){const r=records.find(x=>x.id===p[0]);r.status='COMMITTED';r.physical_commit_ref=p[1];r.protocol=p[2];r.completed_at=p[3];r.deadline_snapshot_at=p[4];r.is_late=p[5];return {rowCount:1,rows:[]};}
  if(sql.includes('INSERT INTO etec_v3_submission_files')){files.push(p);return {rowCount:1,rows:[]};}
  throw Error('Unhandled query: '+sql.slice(0,180));
 }};
 return {pool:{connect:async()=>client,query:(...args)=>client.query(...args)},records,files,clock,activity};
}
test('strict manifests and safe private physical filenames',()=>{
 const a={allowed_extensions:['.pdf'],max_files:1,max_file_bytes:3,max_total_bytes:3};
 assert.equal(policyFiles(docs,a)[0].sha256,sha);
 assert.throws(()=>policyFiles([{name:'a.pdf',size:1,sha256:'fake'}],a));
 assert.throws(()=>policyFiles([{name:'a.pdf',size:4,sha256:sha}],a));
 const privateName=privatePath(roomId,activityId,studentId,crypto.randomUUID(),'PROVA.pdf');
 assert.match(privateName,/^ENTREGAS\/[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9]{32}\.pdf$/);
 assert.doesNotMatch(privateName,/PROVA/);
});
test('staging is idempotent, locked per student/activity, and isolated from teacher paths',async()=>{
 const db=mockDb(),store=createSubmissionStore(db.pool),requestKey=crypto.randomUUID();
 const args={studentId,roomId,activityId,requestKey,files:docs};
 const first=await store.begin(args);
 assert.equal(first.version,'V001');assert.equal(first.status,'STAGING');assert.ok(!JSON.stringify(first).includes('physicalPath'));
 const again=await store.begin(args);assert.equal(again.submissionId,first.submissionId);
 await assert.rejects(store.begin({...args,files:[{name:'Alterado.pdf',size:3,sha256:sha}]}),/reutilizada/);
 await assert.rejects(store.begin({...args,requestKey:crypto.randomUUID()}),/em andamento/);
 await assert.rejects(store.teacherPlan({teacherId:crypto.randomUUID(),submissionId:first.submissionId}),/nao encontrada/);
 const plan=await store.teacherPlan({teacherId,submissionId:first.submissionId});assert.equal(plan.files.length,1);assert.match(plan.files[0].physicalPath,/^ENTREGAS\//);
});
test('receipt appears only after full teacher physical ACK; commit is idempotent',async()=>{
 const db=mockDb(),store=createSubmissionStore(db.pool),staged=await store.begin({studentId,roomId,activityId,requestKey:crypto.randomUUID(),files:docs});
 const plan=await store.teacherPlan({teacherId,submissionId:staged.submissionId});
 const evidence=plan.files.map(f=>({fileId:f.fileId,size:f.size,sha256:f.sha256}));
 await assert.rejects(store.commit({teacherId,submissionId:staged.submissionId,evidence,edgeWriteVerified:false}),/nao confirmada/);
 await assert.rejects(store.commit({teacherId,submissionId:staged.submissionId,evidence:[{...evidence[0],sha256:'a'.repeat(64)}],edgeWriteVerified:true}),/divergente/);
 await assert.rejects(store.commit({teacherId:crypto.randomUUID(),submissionId:staged.submissionId,evidence,edgeWriteVerified:true}),/Sem permissao/);
 assert.equal(db.records[0].status,'STAGING');assert.equal(db.files.length,0);
 const done=await store.commit({teacherId,submissionId:staged.submissionId,evidence,edgeWriteVerified:true});
 assert.match(done.protocol,/^ETEC-\d{8}-[A-F0-9]{24}$/);assert.equal(done.status,'COMMITTED');assert.equal(db.records[0].status,'COMMITTED');assert.equal(db.files.length,1);
 const retry=await store.commit({teacherId,submissionId:staged.submissionId,evidence,edgeWriteVerified:true});assert.equal(retry.protocol,done.protocol);assert.equal(db.files.length,1);
 const later=await store.begin({studentId,roomId,activityId,requestKey:crypto.randomUUID(),files:docs});assert.equal(later.version,'V002');
});
test('late completion uses server clock; rejected if late is forbidden',async()=>{
 const db=mockDb(),store=createSubmissionStore(db.pool),s=await store.begin({studentId,roomId,activityId,requestKey:crypto.randomUUID(),files:docs});
 db.clock.value='2026-10-14T03:00:00.000Z';
 const p=await store.teacherPlan({teacherId,submissionId:s.submissionId});
 await assert.rejects(store.commit({teacherId,submissionId:s.submissionId,edgeWriteVerified:true,evidence:p.files.map(f=>({fileId:f.fileId,size:f.size,sha256:f.sha256}))}),/Prazo da atividade encerrado/);
 assert.equal(db.records[0].status,'STAGING');
 db.activity.accept_late=true;
 const ok=await store.commit({teacherId,submissionId:s.submissionId,edgeWriteVerified:true,evidence:p.files.map(f=>({fileId:f.fileId,size:f.size,sha256:f.sha256}))});
 assert.equal(ok.late,true);assert.equal(db.records[0].is_late,true);
});
test('stale staging becomes FAILED without removing physical file evidence',async()=>{
 const db=mockDb(),store=createSubmissionStore(db.pool),args={studentId,roomId,activityId,requestKey:crypto.randomUUID(),files:docs};
 const old=await store.begin(args);db.clock.value='2026-10-14T00:00:01.000Z';
 const next=await store.begin({...args,requestKey:crypto.randomUUID()});
 assert.equal(next.version,'V002');assert.equal(db.records[0].status,'FAILED');assert.equal(db.records[1].status,'STAGING');
 await assert.rejects(store.teacherPlan({teacherId,submissionId:old.submissionId}),/nao disponivel/);
});
