'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createSubmissionStore,policyFiles,privatePath,validateEvidence}=require('../v3/submission-store');
const id=()=>crypto.randomUUID(),teacherId=id(),studentId=id(),roomId=id(),activityId=id();
const sha=crypto.createHash('sha256').update('abc').digest('hex');
const docs=[{name:'Trabalho.pdf',size:3,sha256:sha}];
function mockDb(){
 const records=[],files=[],clock={value:'2026-10-13T21:00:00.000Z'},activity={id:activityId,room_id:roomId,status:'PUBLISHED',deadline_at:'2026-10-14T02:59:00.000Z',allowed_extensions:['.pdf'],accept_late:false,max_files:10,max_file_bytes:41943040,max_total_bytes:104857600};
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
  if(sql.includes('SELECT s.id,s.status,s.manifest')){const r=records.find(x=>x.id===p[0]);return {rowCount:r&&p[1]===teacherId?1:0,rows:r&&p[1]===teacherId?[r]:[]};}
  if(sql.includes("SET status='COMMITTED'")){const r=records.find(x=>x.id===p[0]);r.status='COMMITTED';r.physical_commit_ref=p[1];r.protocol=p[2];r.completed_at=p[3];r.deadline_snapshot_at=p[4];r.is_late=p[5];return {rowCount:1,rows:[]};}
  if(sql.includes('INSERT INTO etec_v3_submission_files')){files.push(p);return {rowCount:1,rows:[]};}
  throw Error('Unhandled query: '+sql.slice(0,180));
 }};
 return {pool:{connect:async()=>client,query:(...args)=>client.query(...args)},records,files,clock,activity};
}
test('strict file manifest and private filename',()=>{
 const a={allowed_extensions:['.pdf'],max_files:1,max_file_bytes:3,max_total_bytes:3};
 assert.equal(policyFiles(docs,a)[0].sha256,sha);
 assert.throws(()=>policyFiles([{name:'a.pdf',size:1,sha256:'bad'}],a));
 assert.throws(()=>policyFiles([{name:'a.pdf',size:4,sha256:sha}],a));
 assert.doesNotMatch(privatePath(roomId,activityId,studentId,id(),'PROVA.pdf'),/PROVA/);
});
test('staging is idempotent, blocks overlaps, restricts teacher paths',async()=>{
 const db=mockDb(),store=createSubmissionStore(db.pool),requestKey=id();
 const args={studentId,roomId,activityId,requestKey,files:docs};
 const first=await store.begin(args);assert.equal(first.version,'V001');assert.equal(first.status,'STAGING');
 assert.ok(!JSON.stringify(first).includes('physicalPath'));
 assert.equal((await store.begin(args)).submissionId,first.submissionId);
 await assert.rejects(store.begin({...args,files:[{name:'Changed.pdf',size:3,sha256:sha}]}),/reutilizada/);
 await assert.rejects(store.begin({...args,requestKey:id()}),/em andamento/);
 await assert.rejects(store.teacherPlan({teacherId:id(),submissionId:first.submissionId}),/nao encontrada/);
 const plan=await store.teacherPlan({teacherId,submissionId:first.submissionId});assert.match(plan.files[0].physicalPath,/^ENTREGAS\//);
});
test('teacher physical ACK gates committed receipt, replay keeps protocol',async()=>{
 const db=mockDb(),store=createSubmissionStore(db.pool),s=await store.begin({studentId,roomId,activityId,requestKey:id(),files:docs});
 const p=await store.teacherPlan({teacherId,submissionId:s.submissionId});
 const evidence=p.files.map(f=>({fileId:f.fileId,size:f.size,sha256:f.sha256}));
 await assert.rejects(store.commit({teacherId,submissionId:s.submissionId,evidence,edgeWriteVerified:false}),/nao confirmada/);
 await assert.rejects(store.commit({teacherId,submissionId:s.submissionId,evidence:[{...evidence[0],sha256:'a'.repeat(64)}],edgeWriteVerified:true}),/divergente/);
 await assert.rejects(store.commit({teacherId:id(),submissionId:s.submissionId,evidence,edgeWriteVerified:true}),/Sem permissao/);
 assert.equal(db.records[0].status,'STAGING');
 const done=await store.commit({teacherId,submissionId:s.submissionId,evidence,edgeWriteVerified:true});
 assert.match(done.protocol,/^ETEC-\d{8}-[A-F0-9]{24}$/);assert.equal(db.records[0].status,'COMMITTED');assert.equal(db.files.length,1);
 assert.equal((await store.commit({teacherId,submissionId:s.submissionId,evidence,edgeWriteVerified:true})).protocol,done.protocol);
 assert.equal((await store.begin({studentId,roomId,activityId,requestKey:id(),files:docs})).version,'V002');
});
test('completion time comes from database and prevents unauthorized lateness',async()=>{
 const db=mockDb(),store=createSubmissionStore(db.pool),s=await store.begin({studentId,roomId,activityId,requestKey:id(),files:docs});
 const p=await store.teacherPlan({teacherId,submissionId:s.submissionId}),evidence=p.files.map(f=>({fileId:f.fileId,size:f.size,sha256:f.sha256}));
 db.clock.value='2026-10-14T03:00:00.000Z';
 await assert.rejects(store.commit({teacherId,submissionId:s.submissionId,edgeWriteVerified:true,evidence}),/Prazo da atividade encerrado/);
 db.activity.accept_late=true;
 assert.equal((await store.commit({teacherId,submissionId:s.submissionId,edgeWriteVerified:true,evidence})).late,true);
});
test('stale staging invalidated without destructive file cleanup',async()=>{
 const db=mockDb(),store=createSubmissionStore(db.pool),args={studentId,roomId,activityId,requestKey:id(),files:docs};
 const first=await store.begin(args);db.clock.value='2026-10-14T00:00:01.000Z';
 assert.equal((await store.begin({...args,requestKey:id()})).version,'V002');
 assert.equal(db.records[0].status,'FAILED');await assert.rejects(store.teacherPlan({teacherId,submissionId:first.submissionId}),/nao disponivel/);
});
