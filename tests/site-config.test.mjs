import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateConfig} from '../shared/site-config.mjs';
import {validateContent} from '../shared/data-loader.mjs';
test('site and learning settings use validated defaults',()=>{
 const config=validateConfig({site:{name:'テスト学習',icon:'../icon.svg'},learning:{setSize:12,questionCount:6,mode:3,autoVoice:true}},'https://example.test/shared/');
 assert.equal(config.site.icon,'https://example.test/icon.svg');assert.equal(config.learning.mode,3);assert.equal(validateConfig().learning.setSize,50);
});
test('invalid settings and external icons are rejected',()=>{
 for(const value of [null,[],{mode:'invalid'},{site:{name:''}},{site:{icon:'javascript:alert(1)'}},{site:{icon:'https://other.test/icon.svg'}},{learning:{setSize:5}},{learning:{questionCount:0}},{learning:{mode:4}},{learning:{autoVoice:'true'}}])assert.throws(()=>validateConfig(value));
});
test('named content fields support additions without weakening validation',()=>{
 const items=Array.from({length:6},(_,i)=>({id:i+1,term:'項目'+(i+1),answer:'解答'+(i+1)}));
 const result=validateContent({schemaVersion:1,items});assert.equal(result.items[5][1],6);assert.equal(result.items[0][0],false);
 assert.throws(()=>validateContent({schemaVersion:1,items:[...items,{id:6,term:'重複',answer:'解答'}]}));
 assert.throws(()=>validateContent({schemaVersion:1,items:items.map(row=>({...row,answer:'<script>'}))}));
});
