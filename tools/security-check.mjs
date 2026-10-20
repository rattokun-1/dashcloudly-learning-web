// Offline checks only. Run only in a repository whose code you trust:
// the test phase executes this repository's own test files.
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
import path from 'node:path';
import {inspectText,inspectPath} from './audit-public.mjs';
import {validateContent,demoContent} from '../shared/data-loader.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const checks=[];
const add=(name,status,details)=>checks.push({name,status,details});
const major=Number(process.versions.node.split('.')[0]);
add('Node.js runtime',major>=22?'PASS':'FAIL',`Node ${process.versions.node}; 22 or newer required`);
const ignored=new Set(['.git','node_modules','security-reports','.cache']);
function walk(folder,prefix=''){
 return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
  if(ignored.has(entry.name))return [];
  const relative=prefix+entry.name;
  // Never follow directory links, including Windows junctions.
  const stat=lstatSync(path.join(folder,entry.name));
  return stat.isSymbolicLink()?[relative]:stat.isDirectory()?walk(path.join(folder,entry.name),relative+'/'):[relative];
 });
}
let files;
try{files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean);}
catch{files=walk(root);}
files=[...new Set(files)].filter(name=>!name.startsWith('security-reports/'));
const findings=[];
const inside=file=>{const relative=path.relative(realpathSync(root),realpathSync(file));return relative!== '..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
for(const name of files){
 const file=path.join(root,name);
 try{
  const stat=lstatSync(file);
  if(stat.isSymbolicLink()||!inside(file)){findings.push({file:name,reason:'Link or path outside project; not read'});continue;}
  if(!stat.isFile())continue;
  for(const reason of inspectPath(name))findings.push({file:name,reason:reason.slice(name.length+2)});
  if(/\.(?:js|mjs|cjs|json|html|css|md|cmd|yml|yaml|example|svg)$/.test(name)){
   if(stat.size>4*1024*1024){findings.push({file:name,reason:'Text file exceeds 4 MiB; manual review required'});continue;}
   for(const reason of inspectText(name,readFileSync(file,'utf8')))findings.push({file:name,reason:reason.slice(name.length+2)});
  }
 }catch{findings.push({file:name,reason:'Unable to inspect file'});}
}
add('Public-source / secret-pattern scan',findings.length?'FAIL':'PASS',{files:files.length,findings});

const syntaxFailures=[];
for(const name of files.filter(name=>/\.(?:js|mjs|cjs)$/.test(name))){
 const file=path.join(root,name);
 try{
  if(!inside(file)||lstatSync(file).isSymbolicLink())continue;
  if(name.endsWith('.mjs')){
   const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',timeout:15000,windowsHide:true});
   if(result.status!==0)syntaxFailures.push(name);
  }else new Script(readFileSync(file,'utf8'),{filename:name});
 }catch{syntaxFailures.push(name);}
}
add('JavaScript syntax',syntaxFailures.length?'FAIL':'PASS',{failures:syntaxFailures});

try{
 for(const value of ['<script>generated</script>','<img src=x onerror=generated()>','あ'.repeat(501)]){
  const data={schemaVersion:1,...demoContent(6)};data.items[0][2]=value;
  let rejected=false;try{validateContent(data);}catch{rejected=true;}if(!rejected)throw Error('Unsafe generated input was accepted');
 }
 add('Generated unsafe-input rejection','PASS','Markup and oversized input rejected; no real teaching data used');
}catch{add('Generated unsafe-input rejection','FAIL','Inspect shared/data-loader.mjs');}

const tests=readdirSync(path.join(root,'tests')).filter(name=>name.endsWith('.test.mjs')).map(name=>path.join(root,'tests',name)).filter(file=>!lstatSync(file).isSymbolicLink()&&inside(file));
const testEnvironment={...process.env};
// A checker launched from a test must start an independent test runner.
delete testEnvironment.NODE_TEST_CONTEXT;
const result=spawnSync(process.execPath,['--test',...tests],{cwd:root,env:testEnvironment,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024,windowsHide:true});
add('Repository tests',tests.length&&result.status===0?'PASS':'FAIL',{testFiles:tests.length,exitCode:result.status,detail:result.status===0?'All tests passed':'Run node --test tests/*.test.mjs to inspect failures'});

try{
 const pkg=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
 const lock=JSON.parse(readFileSync(path.join(root,'package-lock.json'),'utf8'));
 const dependencies=Object.keys({...pkg.dependencies,...pkg.devDependencies,...pkg.optionalDependencies});
 const lockedPackages=Object.keys(lock.packages||{}).filter(name=>name!=='');
 add('Third-party dependency inventory',dependencies.length||lockedPackages.length?'WARN':'PASS',{declared:dependencies.length,locked:lockedPackages.length,detail:'Offline inventory only; no CVE database queried. Dependencies require a separate advisory check.'});
}catch{add('Third-party dependency inventory','WARN','Dependency manifest unavailable; manual check required');}

add('Live auth / server / browser assessment','NOT_RUN','No live scanning, authentication, account writes, npm install, or network calls by this checker. Browser regressions and server-side authorization need separate checks.');
const failed=checks.some(check=>check.status==='FAIL');
const report={createdAt:new Date().toISOString(),result:failed?'FAIL':'PASS_LIMITED',scope:'Offline source checks; not a complete vulnerability assessment',checks};
const out=path.join(root,'security-reports');
if(existsSync(out)&&(lstatSync(out).isSymbolicLink()||!inside(out)))throw Error('Report directory must be a normal folder inside this project');
mkdirSync(out,{recursive:true});
const destination=path.join(out,'security-check-'+report.createdAt.replace(/[:.]/g,'-')+'.json');
writeFileSync(destination,JSON.stringify(report,null,2)+'\n',{mode:0o600});
for(const check of checks)console.log(`[${check.status}] ${check.name}`);
console.log(`Report: ${destination}`);
console.log('PASS means these checks passed, not that the application has no vulnerabilities.');
process.exitCode=failed?1:0;
