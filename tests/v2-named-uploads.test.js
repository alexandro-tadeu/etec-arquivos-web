'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const browser=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
test('student full name is mandatory when joining',()=>{
 assert.match(index,/id="studentFullName" required/);
 assert.match(server,/const name=String\(body\.name/);
 assert.match(server,/student\.name=name/);
 assert.match(server,/studentName:sess\.name/);
 assert.match(browser,/api\('join',\{code,pin,name\}\)/);
});
test('teacher timestamps filename and preserves the original extension',()=>{
 assert.match(browser,/const extension=dot>0\?evt\.name\.slice\(dot\):''/);
 assert.match(browser,/const desired=safeStudent\+'_'\+stamp\+'_'\+stem\.slice\(0,maxStem\)\+extension/);
 assert.match(browser,/getFileHandle\(candidate,\{create:true\}\)/);
 assert.match(browser,/new Date\(\)/);
 assert.match(browser,/availableFilename\(dir,desired,evt\.path\)/);
});
