import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoContent,validateContent} from '../shared/data-loader.mjs';
test('UI placeholders are generated rather than distributed as vocabulary',()=>{
 for(const subject of ['english','kobun']){const data=demoContent(subject);assert.equal(data.words.length,120);assert.deepEqual(data.phonetics,{});assert.equal(data.words.at(-1)[1],120);assert.equal(new Set(data.words.map(row=>row[2])).size,120);}
});
test('private imports require bounded, sequential, plain-text records',()=>{
 const data={schemaVersion:1,...demoContent('english',6)};
 assert.equal(validateContent(data).words.length,6);
 assert.throws(()=>validateContent({...data,schemaVersion:2}));
 assert.throws(()=>validateContent({...data,words:[]}));
 const unsafe=structuredClone(data);unsafe.words[0][2]='<img onerror=alert(1)>';
 assert.throws(()=>validateContent(unsafe));
 const duplicate=structuredClone(data);duplicate.words[1][1]=1;assert.throws(()=>validateContent(duplicate));
});
