import {validateConfig,applySiteConfig} from './site-config.mjs';
try{
 const base=new URL('./',import.meta.url),response=await fetch(new URL('config.local.json',base),{cache:'no-store'});
 if(response.status!==404){
  if(!response.ok)throw Error('設定ファイルを読み込めませんでした。');
  const config=validateConfig(await response.json(),base.href);applySiteConfig(config);
  document.querySelector('header span').textContent=config.site.name;
  document.querySelector('.intro>p:last-child').textContent=config.site.description;
 }
}catch(error){const notice=document.createElement('p');notice.setAttribute('role','alert');notice.textContent='設定を確認してください: '+error.message;document.querySelector('main').prepend(notice);}
