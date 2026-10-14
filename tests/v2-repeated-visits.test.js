'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const srv=fs.readFileSync(path.join(root,'server.js'),'utf8');
const js=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/professor.html'),'utf8');
test('every visit records its own online/offline timeline without a fixed cap',()=>{
 assert.doesNotMatch(srv,/MAX_ROOM_AUDIT_EVENTS/);
 assert.match(srv,/room\.audit\.entries\.push\(event\)/);
 assert.match(srv,/room\.audit\.visits\.push/);
 assert.match(srv,/roomAudit\(room,'EXIT'/);
 assert.match(srv,/disconnectStudent\(room,sess/);
 assert.match(srv,/disconnectStudent\(room,student,'TIMEOUT'\)/);
});
test('closing page tries exit webhook, and CSV includes status, entry and exit',()=>{
 assert.match(js,/addEventListener\('pagehide'/);
 assert.match(js,/sendBeacon/);
 assert.match(js,/roomCsvRows/);
 assert.match(js,/saveReportCsv/);
 assert.match(js,/America\/Sao_Paulo/);
 assert.match(html,/id="roomAccessCount"/);
 for(const s of ['Status','Entrada','Saída','Motivo da saída'])assert.ok(html.includes('>'+s+'<'),s);
});
