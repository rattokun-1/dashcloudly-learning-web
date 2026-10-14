import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFileSync,readdirSync} from 'node:fs';
import {Script} from 'node:vm';
import path from 'node:path';
import {audit,inspectText,inspectPath} from '../tools/audit-public.mjs';
test('published source never contains runtime teaching data or credentials',()=>{
 const result=audit(fileURLToPath(new URL('../',import.meta.url)));assert.deepEqual(result.failures,[]);
});
test('guard rejects teaching payloads and operational files',()=>{
 assert.ok(inspectText('app.js','const '+'WORDS_RAW'+' = [').length);
 assert.ok(inspectPath('apps/study/data/content.json').length);
 assert.ok(inspectPath('shared/config.local.json').length);
 assert.ok(inspectPath('backups/history.sqlite').length);
 assert.deepEqual(inspectPath('shared/config.example.json'),[]);
});
test('browser scripts compile as classic scripts',()=>{
 const root=fileURLToPath(new URL('../apps/',import.meta.url));
 for(const subject of ['study']){
  const folder=path.join(root,subject,'assets/js');
  for(const name of readdirSync(folder).filter(name=>name.endsWith('.js')))new Script(readFileSync(path.join(folder,name),'utf8'),{filename:name});
 }
});
