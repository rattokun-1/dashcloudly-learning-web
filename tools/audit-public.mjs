import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export function inspectText(name,text){
 const problems=[];
 const checks=[
  ['embedded vocabulary rows',/\[\s*(?:true|false)\s*,\s*\d+\s*,\s*["']/],
  ['embedded vocabulary array',/const\s+WORDS_RAW\s*=\s*\[/],
  ['embedded pronunciation dictionary',/const\s+PHONETICS\s*=\s*\{\s*["']/],
  ['inline Firebase application identifier',/1:\d+:web:[a-f0-9]+/],
  ['Firebase production key',/AIza[A-Za-z0-9_-]{30,}/],
  ['personal Google address',/[A-Za-z0-9._%+-]+@gmail\.com/i],
  ['production project',new RegExp(['systan','app','v6'].join('-'))],
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub credential',/gh[pousr]_[A-Za-z0-9]{30,}/],
 ];
 for(const [reason,pattern] of checks)if(pattern.test(text))problems.push(name+': '+reason);
 return problems;
}
export function inspectPath(name){
 return /(?:^|\/)(?:data|private|private-data|backups)(?:\/|$)|(?:^|\/)config\.local\.json$|\.(?:csv|sqlite|age|pem|key|zip)$/i.test(name)?[name+': private data or credential path']:[];
}
function allFiles(root,prefix=''){
 return readdirSync(path.join(root,prefix),{withFileTypes:true}).flatMap(entry=>{
  if(['.git','node_modules'].includes(entry.name))return [];
  const name=prefix+entry.name;return entry.isDirectory()?allFiles(root,name+'/'):[name];
 });
}
export function audit(root){
 let files;try{files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).split('\0').filter(Boolean);}catch{files=allFiles(root);}
 const failures=[];
 for(const name of files){failures.push(...inspectPath(name));const file=path.join(root,name);if(lstatSync(file).isSymbolicLink()){failures.push(name+': symlink');continue;}if(/\.(?:js|mjs|cjs|json|html|css|md|yml|yaml|example|svg)$/.test(name))failures.push(...inspectText(name,readFileSync(file,'utf8')));}
 return {files:files.length,failures};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=audit(fileURLToPath(new URL('../',import.meta.url)));
 if(result.failures.length){console.error(result.failures.join('\n'));process.exitCode=1;}else console.log('Public-source boundary passed: '+result.files+' files; no embedded vocabulary, private data, or credentials.');
}
