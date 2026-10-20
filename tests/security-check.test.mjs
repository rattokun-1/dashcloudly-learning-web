import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

function fixture(run){
 const parent=path.resolve(tmpdir()),root=mkdtempSync(path.join(parent,'learning-security-check-'));
 try{
  for(const dir of ['tools','shared','tests'])mkdirSync(path.join(root,dir));
  for(const file of ['tools/security-check.mjs','tools/audit-public.mjs','shared/data-loader.mjs'])copyFileSync(fileURLToPath(new URL('../'+file,import.meta.url)),path.join(root,file));
  writeFileSync(path.join(root,'package.json'),JSON.stringify({type:'module'}));
  writeFileSync(path.join(root,'package-lock.json'),JSON.stringify({packages:{'':{}}}));
  writeFileSync(path.join(root,'tests/fixture.test.mjs'),"import {test} from 'node:test';test('generated fixture',()=>{});");
  return run(root);
 }finally{
  const relative=path.relative(parent,path.resolve(root));
  if(!relative.startsWith('learning-security-check-')||relative.includes(path.sep))throw Error('Unexpected fixture cleanup target');
  rmSync(root,{recursive:true,force:true});
 }
}
function execute(root){
 const result=spawnSync(process.execPath,[path.join(root,'tools/security-check.mjs')],{cwd:root,encoding:'utf8',timeout:30000});
 const report=JSON.parse(readFileSync(path.join(root,'security-reports',readdirSync(path.join(root,'security-reports'))[0]),'utf8'));
 return {result,report};
}
test('offline checker passes a clean generated repository',()=>fixture(root=>{
 const {result,report}=execute(root);assert.equal(result.status,0);assert.equal(report.result,'PASS_LIMITED');
}));
test('offline checker detects generated secret pattern without copying it into report',()=>fixture(root=>{
 const synthetic='gh'+'p_'+'a'.repeat(40);writeFileSync(path.join(root,'fixture.json'),JSON.stringify({synthetic}));
 const {result,report}=execute(root);assert.equal(result.status,1);assert.equal(report.result,'FAIL');assert.equal(JSON.stringify(report).includes(synthetic),false);
 assert(report.checks.find(c=>c.name.startsWith('Public-source')).details.findings.some(f=>f.file==='fixture.json'));
}));
test('offline checker fails when repository tests fail',()=>fixture(root=>{
 writeFileSync(path.join(root,'tests/fixture.test.mjs'),"import {test} from 'node:test';test('generated failing fixture',()=>{throw Error('expected')});");
 const {result,report}=execute(root);assert.equal(result.status,1);assert.equal(report.checks.find(c=>c.name==='Repository tests').status,'FAIL');
}));
