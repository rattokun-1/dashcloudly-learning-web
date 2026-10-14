import {copyFile,mkdir,writeFile} from 'node:fs/promises';
import {demoContent} from '../shared/data-loader.mjs';
const root=new URL('../',import.meta.url);
try{await copyFile(new URL('shared/config.example.json',root),new URL('shared/config.local.json',root),1);console.log('設定ファイルを作成しました: shared/config.local.json');}
catch(error){if(error.code!=='EEXIST')throw error;console.log('既存の設定ファイルを保持しました。');}
await mkdir(new URL('apps/study/data/',root),{recursive:true});
const items=demoContent(12).items.map(([isNew,id,term,answer])=>({id,term,answer,isNew}));
try{await writeFile(new URL('apps/study/data/content.json',root),JSON.stringify({schemaVersion:1,items},null,2)+'\n',{flag:'wx'});console.log('編集用の生成項目を作成しました: apps/study/data/content.json');}
catch(error){if(error.code!=='EEXIST')throw error;console.log('既存の教材ファイルを保持しました。');}
console.log('設定と項目を編集して npm start を実行してください。実教材や個別設定はコミットしないでください。');
