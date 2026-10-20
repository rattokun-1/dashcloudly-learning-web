// Optional browser regression, using only the generated Demo dataset.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.STUDY_URL||'http://127.0.0.1:3013/apps/study/';
(async()=>{
 const browser=await chromium.launch(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{channel:'chrome'});
 try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block',reducedMotion:width===1280?'reduce':'no-preference'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   if(window!==window.top)return;
   let startup;Object.defineProperty(window,'dashcloudlyStartup',{configurable:true,get:()=>startup,set:value=>{startup=value;const finish=value.finish;value.finish=function(phase){if(phase==='app')window.testAppReady=true;return finish.call(this,phase)}}});
   for(const key of ['dashcloudly_learning_welcome_terms_accepted_v1','dashcloudly_learning_onboarding_completed_v1','systan_welcome_terms_accepted_v1','systan_onboarding_completed_v1'])localStorage.setItem(key,'1');
  });
  await page.goto(base);await page.waitForFunction(()=>window.testAppReady);
  await page.evaluate(()=>{showHome();renderSet()});
  const bar=page.locator('#compact-study-bar');assert(await bar.isHidden());
  // A generated layout fixture makes the scroll transition independent of
  // how many optional panels the configured home screen currently contains.
  await page.evaluate(()=>{const fixture=document.createElement('div');fixture.style.height='1100px';fixture.setAttribute('aria-hidden','true');document.querySelector('#screen-home .content').append(fixture);document.body.scrollTop=350;document.documentElement.scrollTop=350;window.scrollTo(0,350);dispatchEvent(new Event('scroll'))});
  await bar.waitFor({state:'visible'});assert(await page.locator('.compact-study-quit').isHidden());assert(await bar.locator('progress').isHidden());assert.equal(await bar.locator('img').count(),0);
  if(width===390)assert(await bar.evaluate(e=>e.getAnimations().length>0),'collapse should animate unless reduced motion is requested');
  const before=await page.evaluate(()=>document.body.scrollTop);await page.locator('.compact-study-expand').click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert(await page.evaluate(()=>document.body.classList.contains('expanded-floating-header')));assert(Math.abs(await page.evaluate(()=>document.body.scrollTop)-before)<3);assert.equal(await page.locator('#screen-home>.header').evaluate(e=>e.inert),false);
  await page.keyboard.press('Escape');await bar.waitFor({state:'visible'});
  await page.evaluate(()=>{document.getElementById('quiz-range-start-input').value=1;document.getElementById('quiz-range-end-input').value=3;commitSetRangeInput();startNormalQuiz()});
  await bar.waitFor({state:'visible'});assert(await page.locator('.compact-study-quit').isVisible());assert(await bar.locator('progress').isVisible());assert.equal(await page.evaluate(()=>quiz.words.length),3);
  await page.evaluate(()=>document.getElementById('quiz-progress-fill').style.width='50%');await page.waitForFunction(()=>document.querySelector('#compact-study-bar progress').value===50);
  for(let i=0;i<4;i++){
   await page.locator('.compact-study-expand').click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert(await page.evaluate(()=>document.body.classList.contains('expanded-floating-header')));assert(await page.locator('#screen-quiz>.quiz-progress-bar').isVisible());assert.equal(await page.locator('#screen-quiz>.quiz-header').evaluate(e=>e.inert),false);
   await page.keyboard.press('Escape');await bar.waitFor({state:'visible'});
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  page.once('dialog',d=>d.accept());await page.locator('.compact-study-quit').click();await page.waitForFunction(()=>document.querySelector('.screen.active')?.id==='screen-home');
  assert.deepEqual(errors,[]);console.log(`PASS ${width}px: collapse, motion, tap/scroll stability, progress, interruption, four expand/Escape cycles`);await context.close();
 }
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
