'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {ensureV3Schema,MIGRATIONS} = require('../v3/migrate');
test('migrations are additive and executed only after teacher table is ready',async()=>{
 const statements=[];
 const client={query:async(sql)=>{statements.push(sql); if(sql.includes('information_schema.tables'))return {rows:[{present:5}]};return {rows:[]};},release(){statements.push('released');}};
 const pool={connect:async()=>client};const userStore={ready:async()=>{statements.push('teachers ready');}};
 assert.equal(await ensureV3Schema({pool,userStore}),true);
 assert.equal(statements[0],'teachers ready');
 assert.match(statements[1],/pg_advisory_lock/);
 assert.equal(MIGRATIONS.length,2);
 for(const stmt of statements.filter(x=>x.startsWith('--')))assert.match(stmt,/CREATE TABLE IF NOT EXISTS/);
 assert.equal(statements.at(-1),'released');
});
test('migration must fail closed on database error',async()=>{
 let released=false;
 const pool={connect:async()=>({query:async()=>{throw new Error('database offline');},release:()=>{released=true;}})};
 await assert.rejects(()=>ensureV3Schema({pool,userStore:{ready:async()=>{}}}),/offline/);
 assert.equal(released,true);
});
