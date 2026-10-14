(async()=>{
 const shared=new URL('../../shared/',location.href),subject='learning';
 const script=src=>new Promise((resolve,reject)=>{const tag=document.createElement('script');tag.src=src;tag.onload=resolve;tag.onerror=()=>reject(Error('プログラムを読み込めませんでした。'));document.head.append(tag);});
 const read=async(url,optional=false)=>{const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(10000)});if(optional&&r.status===404)return null;if(!r.ok)throw Error('設定または教材を読み込めませんでした。');return r.json();};
 try{
  window.DASHCLOUDLY_CONFIG={};
  const transition=!!document.body.dataset.ssoPage||location.pathname.endsWith('logout-relay.html');
  if(!transition)await script('assets/js/startup.js');
  let config;
  try{config=await read(new URL('config.local.json',shared),true)||{};}
  catch(error){if(error instanceof SyntaxError||(localStorage.getItem('dashcloudly-public-mode')&&localStorage.getItem('dashcloudly-public-mode')!=='demo'))throw error;config={};}
  const {validateConfig,applySiteConfig}=await import(new URL('site-config.mjs',shared));
  config=validateConfig(config,shared.href);
  const mode=config.mode;
  localStorage.setItem('dashcloudly-public-mode',mode);
  window.DASHCLOUDLY_CONFIG={...config,mode,subject:config.courseId||subject};
  applySiteConfig(config);
  if(!transition){const content=await import(new URL('data-loader.mjs',shared));window.DASHCLOUDLY_CONTENT=mode==='demo'?content.demoContent():content.validateContent(await read(new URL(config.datasetUrl||'data/content.json',location.href)));}
  if(mode==='connected'){
   if(!config.firebase?.apiKey||!config.firebase.projectId||!config.hubUrl)throw Error('接続用のFirebase設定と学習ID URLが必要です。');
   const hub=new URL(config.hubUrl);if(hub.protocol!=='https:'&&hub.hostname!=='localhost')throw Error('学習IDの接続先にはHTTPSを指定してください。');
   for(const name of ['app','auth','firestore'])await script('https://www.gstatic.com/firebasejs/10.12.0/firebase-'+name+'-compat.js');
  }else{const {installLocalRuntime}=await import(new URL('demo-runtime.mjs',shared));installLocalRuntime();}
  if(location.pathname.endsWith('logout-relay.html')){await script('assets/js/logout-relay.js');return;}
  if(transition){firebase.initializeApp(window.DASHCLOUDLY_CONFIG.firebase||{projectId:'local-demo'});await script('assets/js/sso-client.js');return;}
  for(const name of ['app','sso-client','learning-compliance','results-dashboard'])await script('assets/js/'+name+'.js');
  if(mode==='demo'){const note=document.createElement('p');note.className='public-demo-notice';note.textContent='UIデモ · 教材データなし';note.style.cssText='position:fixed;top:0;left:50%;transform:translateX(-50%);margin:0;padding:3px 12px;z-index:2200;border-radius:0 0 10px 10px;background:#25272b;color:#fff;font:10px system-ui;pointer-events:none';document.body.append(note);}
 }catch(error){if(window.dashcloudlyStartup){window.dashcloudlyStartup.error(error.message);}else{const status=document.getElementById('loading-screen')||document.getElementById('sso-message')||document.getElementById('status');if(status){status.style.display='flex';status.textContent=error.message;}}console.error(error);}
})();
