import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoContent,validateContent} from '../shared/data-loader.mjs';
test('UI placeholders are generated rather than distributed as vocabulary',()=>{
 {const data=demoContent();assert.equal(data.items.length,120);assert.deepEqual(data.phonetics,{});assert.equal(data.items.at(-1)[1],120);assert.equal(new Set(data.items.map(row=>row[2])).size,120);}
});
test('private imports require bounded, sequential, plain-text records',()=>{
 const data={schemaVersion:1,...demoContent(6)};
 assert.equal(validateContent(data).items.length,6);
 assert.throws(()=>validateContent({...data,schemaVersion:2}));
 assert.throws(()=>validateContent({...data,items:[]}));
 const unsafe=structuredClone(data);unsafe.items[0][2]='<img onerror=alert(1)>';
 assert.throws(()=>validateContent(unsafe));
 const duplicate=structuredClone(data);duplicate.items[1][1]=1;assert.throws(()=>validateContent(duplicate));
});
