(()=>{
 if(window.DASHCLOUDLY_CONFIG.mode!=='connected'){
  window.startDashcloudlyLogin=()=>{const text='この公開版は端末内のデモです。ログイン・同期には個別の接続設定が必要です。';if(document.getElementById('sso-message'))document.getElementById('sso-message').textContent=text;else if(typeof showSyncStatus==='function')showSyncStatus(text);};
  window.dashcloudlyStartup?.finish('session');window.dashcloudlyStartup?.finish('consent');
  if(document.body.dataset.ssoPage)window.startDashcloudlyLogin();return;
 }

 const hub=`${window.DASHCLOUDLY_CONFIG.hubUrl || location.origin}`;
 const site=window.DASHCLOUDLY_CONFIG.subject;
 const nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
 const appQuery=new URLSearchParams(location.search);
 if(appQuery.get('app')==='android')sessionStorage.setItem('dashcloudly-android','1');
 const androidApp=sessionStorage.getItem('dashcloudly-android')==='1';
 const paths={home:'./index.html',account:'./index.html?view=account',admin:'./admin.html',teacher:'./teacher.html'};
 window.startDashcloudlyLogin=(method='',preferredReturn='')=>{sessionStorage.removeItem('dashcloudly-sso-signed-out');const state=nonce();sessionStorage.setItem('dashcloudly-login-state',state);const p=new URLSearchParams(location.search);const target=Object.hasOwn(paths,preferredReturn)?preferredReturn:Object.hasOwn(paths,p.get('return'))?p.get('return'):(['admin','teacher'].includes(document.body.dataset.rolePage)?document.body.dataset.rolePage:'account');if(window.dashcloudlyStartup){window.dashcloudlyStartup.redirect();}else if(!document.getElementById('dc-route-loading')){const overlay=document.createElement('div');overlay.id='dc-route-loading';overlay.setAttribute('role','status');overlay.innerHTML='<img class="dc-loading-mark" src="assets/icons/dashcloudly.svg" alt=""><span>ログインページへ接続しています</span><span class="dc-loading-track" aria-hidden="true"></span>';document.body.append(overlay);}const destination=hub+'/?'+new URLSearchParams({site,state,return:target,method:method||p.get('method')||(androidApp?'google':''),app:androidApp?'android':''});requestAnimationFrame(()=>requestAnimationFrame(()=>location.assign(destination)));};
 const exchange=async ticket=>{const r=await fetch(hub+'/api/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});if(!r.ok)throw Error('Session exchange failed');const session=await r.json();await firebase.auth().setPersistence(session.keepSession===true?firebase.auth.Auth.Persistence.LOCAL:firebase.auth.Auth.Persistence.SESSION);return session.customToken;};
 if(document.body.dataset.ssoPage==='redirect'){window.startDashcloudlyLogin();return;}
 if(document.body.dataset.ssoPage==='callback'){
  const p=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'',location.pathname);
  const state=sessionStorage.getItem('dashcloudly-login-state');sessionStorage.removeItem('dashcloudly-login-state');
  if(!state||state!==p.get('state')){document.body.setAttribute('data-sso-failed','');document.getElementById('sso-message').textContent='接続の有効期限が切れました。学習サイトから再度ログインしてください。';return;}
  (async()=>{try{await firebase.auth().signInWithCustomToken(await exchange(p.get('ticket')));location.replace(paths[p.get('return')]||paths.account);}catch{document.body.setAttribute('data-sso-failed','');document.getElementById('sso-message').textContent='ログインを引き継げませんでした。学習サイトからもう一度お試しください。';}})();return;
 }
 if(androidApp){
  const header=document.querySelector('.app-header');
  if(header){
   const home=document.createElement('a');home.textContent='科目変更';home.setAttribute('aria-label','アプリの科目選択に戻る');
   home.href='intent://home#Intent;scheme=dashcloudly-study;package=com.dashcloudly.study;S.browser_fallback_url='+encodeURIComponent('https://'+site+'.dashcloudly.com/index.html?app=android')+';end';
   home.style.cssText='display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 12px;margin-left:auto;border-radius:16px;background:#eee;color:#222;text-decoration:none;font:600 13px system-ui;white-space:nowrap;flex-shrink:0';
   header.insertBefore(home,header.querySelector('#header-account-button'));
  }
 }
 // Keep cached pre-upgrade pages fail-closed when the coordinator is unavailable.
 function legacyConsentGate(message,error=false){if(window.dashcloudlyStartup)return;let gate=document.getElementById('learning-consent-check');if(!gate){gate=document.createElement('div');gate.id='learning-consent-check';gate.style.cssText='position:fixed;inset:0;z-index:2147483640;display:grid;place-items:center;background:#f3f5f8;padding:24px';const card=document.createElement('section');gate.append(card);document.body.append(gate);}const card=gate.firstElementChild;card.replaceChildren();const text=document.createElement('p');text.textContent=message;card.append(text);if(error){const retry=document.createElement('button');retry.type='button';retry.textContent='再読み込み';retry.onclick=()=>location.reload();card.append(retry);}}
 let consentGeneration=0;
 firebase.auth().onAuthStateChanged(async user=>{
  const generation=++consentGeneration;
  document.getElementById('learning-consent-check')?.remove();
  if(!user||user.isAnonymous){window.dashcloudlyStartup?.finish('consent');return;}
  window.dashcloudlyStartup?.wait('consent');legacyConsentGate('学習を準備しています');
  try{
   const response=await fetch(hub+'/api/consent/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:await user.getIdToken()}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('Consent unavailable');const result=await response.json();if(generation!==consentGeneration)return;
   if(result.accepted){document.getElementById('learning-consent-check')?.remove();window.dashcloudlyStartup?.finish('consent');return;}
   window.startDashcloudlyLogin('', 'home');
  }catch{
   if(generation!==consentGeneration)return;
   window.dashcloudlyStartup?.error('利用条件を確認できませんでした。接続を確認して再読み込みしてください。');legacyConsentGate('利用条件を確認できませんでした。接続を確認して再読み込みしてください。',true);
  }
 });
 if(sessionStorage.getItem('dashcloudly-sso-signed-out')){window.dashcloudlyStartup?.finish('session');return;}
 const frame=document.createElement('iframe');frame.hidden=true;frame.title='DashCloudly 学習ID 接続';
 let started=false;
 const stop=(ready=true)=>{if(ready)window.dashcloudlyStartup?.finish('session');removeEventListener('message',receive);frame.remove();};
 const state=nonce();
 async function receive(event){if(event.origin!==hub||event.source!==frame.contentWindow||event.data?.type!=='dashcloudly-sso'||event.data.state!==state)return;const ticket=event.data.ticket;stop(false);try{if(ticket&&!firebase.auth().currentUser)await firebase.auth().signInWithCustomToken(await exchange(ticket));}catch{console.warn('DashCloudly session unavailable');}finally{window.dashcloudlyStartup?.finish('session');}}
 firebase.auth().onAuthStateChanged(user=>{if(started)return;started=true;if(user){window.dashcloudlyStartup?.finish('session');return;}addEventListener('message',receive);frame.src=hub+'/bridge.html?'+new URLSearchParams({site,state});document.body.append(frame);setTimeout(stop,15000);});
})();
