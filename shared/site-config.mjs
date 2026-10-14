const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function validateConfig(value={},base='http://localhost/shared/'){
 if(!object(value))throw Error('設定ファイルはJSONオブジェクトにしてください。');
 const config={...value};
 config.mode=value.mode??'demo';
 if(!['demo','local','connected'].includes(config.mode))throw Error('modeはdemo・local・connectedから選んでください。');
 for(const section of ['site','learning'])if(value[section]!==undefined&&!object(value[section]))throw Error(section+'はJSONオブジェクトにしてください。');
 const site={name:'学習',description:'自分の教材で、自分のペースで。',...(value.site||{})};
 for(const [key,max] of [['name',60],['description',200]])if(typeof site[key]!=='string'||!site[key].trim()||site[key].length>max)throw Error('site.'+key+'の文字数を確認してください。');
 if(site.icon!==undefined){
  if(typeof site.icon!=='string'||!site.icon.trim())throw Error('site.iconに画像のパスを指定してください。');
  const url=new URL(site.icon,base),origin=new URL(base).origin;
  if(url.origin!==origin||!['http:','https:'].includes(url.protocol))throw Error('アイコンは同じサイト内の画像を指定してください。');
  if(!/\.(svg|png|webp|ico)$/i.test(url.pathname))throw Error('アイコンはSVG・PNG・WebP・ICOにしてください。');
  site.icon=url.href;
 }
 const learning={setSize:50,questionCount:10,mode:1,autoVoice:false,...(value.learning||{})};
 for(const [key,min,max] of [['setSize',6,500],['questionCount',1,500],['mode',1,3]])if(!Number.isInteger(learning[key])||learning[key]<min||learning[key]>max)throw Error('learning.'+key+'は'+min+'〜'+max+'の整数にしてください。');
 if(typeof learning.autoVoice!=='boolean')throw Error('learning.autoVoiceはtrueまたはfalseにしてください。');
 if(config.speechLanguage!==undefined&&(typeof config.speechLanguage!=='string'||!config.speechLanguage.trim()))throw Error('speechLanguageを確認してください。');
 return {...config,site,learning};
}
export function applySiteConfig(config){
 const {site}=config;
 document.title=site.name;
 const header=document.querySelector('.app-header .header-title');
 if(header&&!header.querySelector('.school-brand-logo'))header.textContent=site.name;
 for(const name of ['description','apple-mobile-web-app-title']){
  let meta=document.querySelector('meta[name="'+name+'"]');
  if(!meta){meta=document.createElement('meta');meta.name=name;document.head.append(meta);}
  meta.content=name==='description'?site.description:site.name;
 }
 if(site.icon){
  if(!document.querySelector('link[rel="icon"]')){const link=document.createElement('link');link.rel='icon';document.head.append(link);}
  for(const link of document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]'))link.href=site.icon;
  const refresh=()=>{for(const img of document.querySelectorAll('img'))if((img.getAttribute('src')||'').endsWith('assets/icons/dashcloudly.svg'))img.src=site.icon;};
  refresh();new MutationObserver(refresh).observe(document.body,{childList:true,subtree:true});
 }
 const manifestLink=document.querySelector('link[rel="manifest"]');
 if(manifestLink){
  const icon=site.icon||new URL('assets/icons/icon-512.png',location.href).href;
  const type=/\.svg(?:\?|$)/i.test(icon)?'image/svg+xml':/\.webp(?:\?|$)/i.test(icon)?'image/webp':/\.ico(?:\?|$)/i.test(icon)?'image/x-icon':'image/png';
  const manifest={name:site.name,short_name:site.name,description:site.description,start_url:new URL('./index.html',location.href).href,scope:new URL('./',location.href).href,display:'standalone',background_color:'#eeeeee',theme_color:'#eeeeee',icons:[{src:icon,sizes:'any',type,purpose:'any'}]};
  manifestLink.href=URL.createObjectURL(new Blob([JSON.stringify(manifest)],{type:'application/manifest+json'}));
 }
}
