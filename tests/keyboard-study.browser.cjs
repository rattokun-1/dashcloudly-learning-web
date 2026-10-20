// Generated Demo only. Same optional browser setup as compact-header.browser.cjs.
const assert=require('node:assert/strict');
const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.STUDY_URL||'http://127.0.0.1:3015/apps/study/';
(async()=>{
 const browser=await chromium.launch(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{channel:'chrome'});
 try{for(const width of [1440,390])for(const mode of ['1','2','3']){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
  await page.addInitScript(()=>{
   if(window!==top)return;
   for(const key of ['dashcloudly_learning_welcome_terms_accepted_v1','dashcloudly_learning_onboarding_completed_v1'])localStorage.setItem(key,'1');
   let startup;Object.defineProperty(window,'dashcloudlyStartup',{configurable:true,get:()=>startup,set:value=>{startup=value;const finish=value.finish;value.finish=function(phase){if(phase==='app')window.testAppReady=true;return finish.call(this,phase)}}});
  });
  await page.goto(base);await page.waitForFunction(()=>window.testAppReady);
  // Configure the mode through the normal control; all learning actions below
  // use real Tab/Enter events, without focus() or invoking learning functions.
  if(await page.locator('#mode-select').isVisible())await page.locator('#mode-select').selectOption(mode);
  else await page.locator(`.mobile-study-choices [data-mode="${mode}"]`).click();
  async function tabTo(selector){for(let n=0;n<250;n++){if(await page.evaluate(s=>document.activeElement.matches(s),selector))return;await page.keyboard.press('Tab')}throw Error('Unreachable by Tab: '+selector)}
  async function focused(selector){await page.waitForFunction(s=>document.activeElement.matches(s),selector);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert(await page.evaluate(s=>document.activeElement.matches(s),selector));assert(await page.evaluate(()=>document.activeElement.matches(':focus-visible')),'keyboard focus must remain visible');}
  const answerSelector=mode==='3'?'#free-answer':'#choices-container .choice-btn';
  await tabTo('#btn-start-quiz');await page.keyboard.press('Enter');await focused(answerSelector);assert.equal(await page.evaluate(()=>quiz.idx),0);
  async function answer(){if(mode==='3')await page.keyboard.type('generated input');await page.keyboard.press('Enter');await focused('#next-btn')}
  await answer();assert.equal(await page.evaluate(()=>quiz.idx),0,'answer Enter must not advance');
  await page.keyboard.press('Enter');await focused(answerSelector);assert.equal(await page.evaluate(()=>quiz.idx),1,'next Enter advances once');
  // Native confirmation is handled by the browser API, not claimed as a
  // real-key Escape/Tab test of browser-owned dialog controls.
  await tabTo('.compact-study-quit');const before=await page.evaluate(()=>quiz.idx);let dialogs=0;
  page.once('dialog',async d=>{dialogs++;await d.dismiss()});await page.keyboard.press('Enter');await focused('.compact-study-quit');assert.equal(dialogs,1);assert.equal(await page.evaluate(()=>quiz.idx),before);
  await tabTo(answerSelector);await answer();
  // Focused bookmark and interrupt buttons must keep their native Enter action.
  await tabTo('#quiz-bm-btn');const bookmarked=await page.locator('#quiz-bm-btn').getAttribute('aria-pressed');await page.keyboard.press('Enter');assert.notEqual(await page.locator('#quiz-bm-btn').getAttribute('aria-pressed'),bookmarked);assert.equal(await page.evaluate(()=>quiz.idx),before);
  await tabTo('.compact-study-quit');page.once('dialog',async d=>{dialogs++;await d.accept()});await page.keyboard.press('Enter');await focused('#btn-start-quiz');assert.equal(dialogs,2);
  await page.keyboard.press('Enter');await focused(answerSelector);assert.equal(await page.evaluate(()=>quiz.idx),0);assert.deepEqual(errors,[]);
  console.log(`PASS ${width}px mode ${mode}: focus start/answer/next/restart, one-step Enter, bookmark and interruption, confirmation cancel/accept via API`);await context.close();
 }}finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
