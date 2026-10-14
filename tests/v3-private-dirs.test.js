'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
test('private delivery folders stay hidden from v2 student file listing and navigation',()=>{
  assert.match(server,/!\['ENTREGAS','RECUPERACAO_PRIVADA'\]\.includes\(part\.toUpperCase\(\)\)/);
  assert.match(app,/\['ENTREGAS','RECUPERACAO_PRIVADA'\]\.includes\(name\.toUpperCase\(\)\)/);
});
test('v3 production still requires explicit enablement, postgres and HMAC secret',()=>{
  assert.match(server,/ETEC_V3_API_ENABLED === 'true'/);
  assert.match(server,/!process\.env\.DATABASE_URL \|\| !process\.env\.V3_STUDENT_CODE_HMAC_KEY/);
  assert.match(server,/files\['\/atividades'\]/);
});
