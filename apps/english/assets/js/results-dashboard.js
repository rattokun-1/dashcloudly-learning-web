(()=>{
 const statsNode=document.getElementById('home-stats');if(!statsNode)return;
 const number=value=>Math.max(0,Math.floor(Number(value)||0));
 function render(){
  const stats=getTotalStats(),total=WORDS.length,correct=number(stats['○'])+number(stats['◎']),wrong=number(stats['×']),done=Math.min(total,correct+wrong),remaining=Math.max(0,total-done),percent=total?Math.round(done/total*1000)/10:0;
  const answered=number(leaderboardStats.totalAnswered),answersCorrect=Math.min(answered,number(leaderboardStats.totalCorrect)),accuracy=answered?Math.round(answersCorrect/answered*100):null;
  const correctAngle=total?correct/total*360:0,doneAngle=total?done/total*360:0;
  const state=[total,correct,wrong,answered,answersCorrect].join(':');if(statsNode.firstElementChild?.classList.contains('results-overview')&&statsNode.dataset.dashboardState===state)return;
  const markup='<section class="results-overview" aria-label="学習状況"><div class="results-hero"><div><p class="results-eyebrow">LEARNING PROGRESS</p><h2>学習進捗</h2><p class="results-summary"><strong>'+done.toLocaleString()+'</strong> / '+total.toLocaleString()+' 語を学習</p><div class="results-actions"><button class="btn btn-primary" type="button" onclick="continueLearning()">学習を続ける</button><button class="btn btn-secondary" type="button" '+(!wrong?'disabled':'')+' onclick="'+'startReviewQuiz()'+'">要復習 '+wrong.toLocaleString()+' 語</button></div></div><div class="results-ring" role="img" aria-label="学習済み'+percent+'パーセント。正解'+correct+'語、要復習'+wrong+'語、未学習'+remaining+'語" style="--ring:conic-gradient(#25272b 0deg '+correctAngle+'deg,#9a9fa7 '+correctAngle+'deg '+doneAngle+'deg,#e7e9ed '+doneAngle+'deg 360deg)"><div><strong>'+percent+'<small>%</small></strong><span>学習済み</span></div></div></div><div class="results-legend"><div><i class="legend-correct"></i><span>正解</span><strong>'+correct.toLocaleString()+'<small>語</small></strong></div><div><i class="legend-review"></i><span>要復習</span><strong>'+wrong.toLocaleString()+'<small>語</small></strong></div><div><i class="legend-unseen"></i><span>未学習</span><strong>'+remaining.toLocaleString()+'<small>語</small></strong></div></div><div class="results-metrics"><article><span>累計回答</span><strong>'+answered.toLocaleString()+'<small>問</small></strong></article><article><span>累計正解</span><strong>'+answersCorrect.toLocaleString()+'<small>回</small></strong></article><article><span>正答率</span><strong>'+(accuracy===null?'—':accuracy+'<small>%</small>')+'</strong><span class="metric-track" aria-hidden="true"><i style="width:'+(accuracy||0)+'%"></i></span></article></div></section>';
  statsNode.dataset.dashboardState=state;statsNode.innerHTML=markup;
 }
 const observer=new MutationObserver(render);observer.observe(statsNode,{childList:true});render();
 const oldSummary=document.getElementById('home-ranking-panel');if(oldSummary)oldSummary.hidden=true;
 const side=document.querySelector('#screen-ranking .ranking-side-grid');if(side)side.hidden=true;
 const rankTitle=document.querySelector('#screen-ranking .ranking-meta-title');if(rankTitle)rankTitle.textContent='週間ランキング';
})();

// Keep a checkpoint per subject and signed-in account; answered questions resume at the next word.
function learningCheckpointKey(){return STORAGE_KEY+'-resume-'+(auth.currentUser?.uid||'guest');}
const checkpointRenderQuestion=renderQuestion;
renderQuestion=function(){
 try{if(quiz.idx<quiz.words.length)localStorage.setItem(learningCheckpointKey(),JSON.stringify({ids:quiz.words.map(w=>w.id),idx:quiz.idx,mode:quiz.mode,type:quiz.type,results:quiz.results,answered:!!quiz.answered}));else localStorage.removeItem(learningCheckpointKey());}catch{}
 return checkpointRenderQuestion.apply(this,arguments);
};
const checkpointNextButton=showNextBtn;
showNextBtn=function(){const value=checkpointNextButton.apply(this,arguments);try{localStorage.setItem(learningCheckpointKey(),JSON.stringify({ids:quiz.words.map(w=>w.id),idx:quiz.idx,mode:quiz.mode,type:quiz.type,results:quiz.results,answered:true}));}catch{}return value;};
function continueLearning(){
 try{const saved=JSON.parse(localStorage.getItem(learningCheckpointKey())||'null');
 if(saved&&Array.isArray(saved.ids)&&Number.isInteger(saved.idx)&&[1,2,3].includes(saved.mode)){
 const byId=new Map(WORDS.map(w=>[w.id,w])),words=saved.ids.map(id=>byId.get(id));
 const idx=saved.idx+(saved.answered?1:0);
 if(words.every(Boolean)&&idx>=0&&idx<words.length){quiz={words,idx,mode:saved.mode,type:['normal','review','bookmark'].includes(saved.type)?saved.type:'normal',results:Array.isArray(saved.results)?saved.results:[],choices:null,answered:false};updateQuizHeader();showScreen('screen-quiz');renderQuestion();scrollQuizToTop();return;}
 }
 }catch{}
 startNormalQuiz();
}
