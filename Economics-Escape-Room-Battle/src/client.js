const OFFLINE_MODE = __MODE__;
const LOCAL_QUESTIONS = __QUESTIONS__;
const ROOMS = __ROOMS__;
const SETTINGS = __SETTINGS__;
__QUESTION_HELPERS__
const $ = s=>document.querySelector(s);
const esc = s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const memory={};let storageOK=true;
const storage={get(k,d){try{return JSON.parse(localStorage.getItem(k))??d;}catch{return memory[k]??d;}},set(k,v){memory[k]=v;try{localStorage.setItem(k,JSON.stringify(v));}catch{storageOK=false;}}};
let sessions=storage.get('econ:sessions:v2',storage.get('econ:sessions:v1',[]).filter(s=>!s.offline)), localPlayers=storage.get('econ:local:v2',[]);
let preferredLang=storage.get('econ:language','zh');
const lang=()=>current?.role==='player'?(current.lang||'zh'):preferredLang;
const t=(zh,en)=>lang()==='en'?en:zh;
const gameConfig=()=>latestBoard?.room?.count?latestBoard.room:(playData?.config||SETTINGS);
const count=()=>gameConfig().count;
const roundSize=()=>gameConfig().roundSize;
const isLive=()=>gameConfig().mode==='live';
let current=null,scene='home',activeTab='student',latestBoard=null,playData=null,selected=null,deadline=0,submitting=false,polling=false,hostBusy=false;
const app=$('#app');
const resetView=()=>{window.scrollTo(0,0);app.focus({preventScroll:true});};
const formatTime=ms=>{const s=Math.max(0,Math.ceil(ms/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
const toast=s=>{const t=$('#toast');t.textContent=s;t.hidden=false;setTimeout(()=>t.hidden=true,3500);};
const banner=s=>{$('#network').textContent=s;$('#network').hidden=!s;};
const saveSession=s=>{current=s;sessions=[s,...sessions.filter(x=>!(x.code===s.code&&x.role===s.role&&x.name===s.name))].slice(0,12);storage.set('econ:sessions:v2',sessions);if(!storageOK)banner('此瀏覽器未能保存進度。請保留本分頁，避免關閉或重新整理。');};
const pLocal=()=>localPlayers.find(p=>p.token===current?.token);
function localApi(path,body={}){
 let p=pLocal();const now=Date.now();
 if(path==='/api/board'){
  const sorted=localPlayers.map(p=>({name:p.name,score:p.score,correct:p.correct,progress:p.progress,elapsed:p.elapsed,created:p.created})).sort((a,b)=>b.score-a.score||b.correct-a.correct||a.elapsed-b.elapsed||a.created-b.created);
  let rank=1;sorted.forEach((p,i)=>{if(i&&!(p.score===sorted[i-1].score&&p.correct===sorted[i-1].correct&&p.elapsed===sorted[i-1].elapsed))rank=i+1;p.rank=rank;});return {room:{code:'LOCAL',title:'單機 Battle',status:'running',seconds:p?.seconds||75,...SETTINGS},players:sorted};
 }
 if(!p)throw Error('找不到單機進度，請重新輸入組名。');
 if(path==='/api/play'){
  if(p.feedback)return {feedback:localiseFeedback(p.feedback,lang()),config:SETTINGS,score:p.score,progress:p.progress,correct:p.correct};
  if(p.progress>=LOCAL_QUESTIONS.length)return {done:true,history:p.history.map(f=>localiseFeedback(f,lang())),config:SETTINGS,score:p.score,correct:p.correct,progress:p.progress};
  if(!p.start){p.start=now;storage.set('econ:local:v2',localPlayers);}
  const {answer,explain,trap,...q}=localiseQuestion(LOCAL_QUESTIONS[p.progress],lang());return {question:q,config:SETTINGS,index:p.progress,score:p.score,correct:p.correct,progress:p.progress,deadline:p.start+p.seconds*1000,serverNow:now};
 }
 if(path==='/api/answer'){
  if(p.feedback&&body.index===p.progress-1)return localiseFeedback(p.feedback,lang());
  if(body.index!==p.progress||p.feedback)throw Error('題目狀態已更新，請按重新連接。');
  const rawQ=LOCAL_QUESTIONS[p.progress],q=localiseQuestion(rawQ,lang()),elapsed=Math.max(0,now-p.start),timeout=elapsed>p.seconds*1000+1500||body.answer===null;
  const correct=!timeout&&(q.type==='mc'?body.answer===q.answer:/^-?\d+(\.\d+)?$/.test(String(body.answer).trim())&&Math.abs(Number(body.answer)-q.answer)<.000001);
  const speed=correct?Math.max(0,Math.floor(20*(1-Math.min(elapsed,p.seconds*1000)/(p.seconds*1000)))):0;
  p.roundCorrect+=correct?1:0;const roundBonus=(p.progress+1)%SETTINGS.roundSize===0&&p.roundCorrect===SETTINGS.roundSize?50:0;
  const points=(correct?100+speed:0)+roundBonus;
  const f={text:feedbackText(rawQ),index:p.progress,correct,timeout,answer:q.answer,options:q.options||null,explain:q.explain,trap:q.trap,title:q.title,points,speed,roundBonus,score:p.score+points,progress:p.progress+1};
  p.progress++;p.score+=points;p.correct+=correct?1:0;p.elapsed+=Math.min(elapsed,p.seconds*1000);if(p.progress%SETTINGS.roundSize===0)p.roundCorrect=0;p.feedback=f;p.history.push(f);storage.set('econ:local:v2',localPlayers);return localiseFeedback(f,lang());
 }
 if(path==='/api/next'){if(body.progress!==p.progress)throw Error('題目狀態已更新。');p.feedback=null;p.start=null;storage.set('econ:local:v2',localPlayers);return {ok:true};}
 throw Error('單機版不支援此操作。');
}
async function api(path,body){
 if(OFFLINE_MODE)return localApi(path,body);
 const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),12000);
 try{
  const code=body?.code||current?.code;
  const res=await fetch(path+(body?'':`?code=${encodeURIComponent(code||'')}&lang=${lang()}`),{method:body?'POST':'GET',headers:{'content-type':'application/json',...(current?.token?{authorization:`Bearer ${current.token}`}:{})},...(body?{body:JSON.stringify({...body,code:body.code||current?.code,lang:lang()})}:{}),signal:ctrl.signal});
  const data=await res.json();if(!res.ok)throw Error(data.error||'未能完成操作。');banner(storageOK?'':'此瀏覽器未能保存進度，請保留本分頁。');return data;
 }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error('連線中斷或伺服器未有回應。請重新連接，原有進度會保留。');throw e;}finally{clearTimeout(timeout);}
}
function mapMarkup(index=-1,side=false){return `<div class="${side?'side-map':'map'}">${ROOMS.map((r,i)=>`<div class="map-card ${index===i?'active':index>i?'cleared':''}"><span class="map-no">${index>i?'✓':r.code}</span><div><b>${t(r.name,r.en)}</b><small>${t(r.en,r.name)}</small></div></div>`).join('')}</div>`;}
function renderHome(){
 scene='home';deadline=0;document.body.classList.remove('projection');
 const saved=sessions.filter(s=>s.offline===OFFLINE_MODE);
 const roomInURL=new URLSearchParams(location.search).get('room')||'';
 app.innerHTML=`<section class="hero"><div class="hero-copy"><span class="edition">S4 ECONOMICS / CHAPTER 09</span><h1><span>ECON</span><span class="outline">ESCAPE</span><span>BATTLE<span style="display:inline;color:var(--orange)">.</span></span></h1><p class="intro">拯救你的企業。解開利潤密碼。<small>從成本表到 MR = MC，8 個決策，4 道密室。<br>${OFFLINE_MODE?'一部電腦，組組輪流挑戰。':'全班同答一題，老師講解後再繼續。'}</small></p><div class="mission-seal"><span><b>04</b>密室 ROOMS</span><span><b>08</b>雙語題 CHALLENGES</span><span><b>01</b>共同目標 ESCAPE</span></div></div><div class="join-card"><div class="tabs">${OFFLINE_MODE?'<button class="tab active" data-action="tab-student">單機挑戰</button><button class="tab" data-action="local-board">排行榜 ↗</button>':`<button class="tab ${activeTab==='student'?'active':''}" data-action="tab-student">我是學生 / Student</button><button class="tab ${activeTab==='teacher'?'active':''}" data-action="tab-teacher">我是老師 / Teacher</button>`}</div><h2>${OFFLINE_MODE?'準備入場？':activeTab==='student'?'你的團隊，準備好未？':'開一場課室 Battle。'}</h2><p class="form-note">${OFFLINE_MODE?'輸入個人暱稱或組名，完成後交給下一組。':activeTab==='student'?'個人或一組一部裝置；提交即知對錯，等老師開下一題。':'建立房間，全班同步作答；每題由你主持及講解。'}</p><form id="entry-form">${OFFLINE_MODE||activeTab==='student'?`<label for="question-language">題目語言 / Question language</label><select id="question-language" name="language"><option value="zh" ${preferredLang==='zh'?'selected':''}>繁體中文</option><option value="en" ${preferredLang==='en'?'selected':''}>English</option></select>`:''}${OFFLINE_MODE?`<label for="name">暱稱／組名 <small>TEAM NAME</small></label><input id="name" name="name" required maxlength="20" autocomplete="off" placeholder="例如：邊際高手"><label for="seconds">每題作答時間</label><select name="seconds" id="seconds"><option value="45">45 秒 · 快速挑戰</option><option value="75" selected>75 秒 · 標準</option><option value="120">120 秒 · 多點思考</option></select>`:activeTab==='student'?`<label for="code">六位房間碼 <small>ROOM CODE</small></label><input class="room-code" id="code" name="code" value="${esc(roomInURL.slice(0,6))}" maxlength="6" minlength="6" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC234"><label for="name">暱稱／組名 <small>TEAM NAME</small></label><input id="name" name="name" required maxlength="20" autocomplete="off" placeholder="例如：邊際高手">`:`<label for="title">課室名稱</label><input id="title" name="title" value="中四 Economics Battle" maxlength="40" required><label for="seconds">每題作答時間</label><select name="seconds" id="seconds"><option value="45">45 秒 · 快速挑戰</option><option value="75" selected>75 秒 · 標準（8 題）</option><option value="120">120 秒 · 多點思考</option></select>`}<button class="btn full orange" type="submit">${OFFLINE_MODE?'進入單機挑戰':activeTab==='student'?'加入 Battle':'建立新課室'} <span>↗</span></button><p class="error" id="entry-error" role="alert"></p><p class="tiny">${OFFLINE_MODE?'排行榜儲存在本瀏覽器，不跨裝置同步。':'毋須學生帳戶。請用暱稱，避免輸入個人資料。'}</p></form>${saved.length?`<div class="resume"><span class="tiny">返回現有進度 · THIS BROWSER</span>${saved.slice(0,5).map(s=>`<button data-action="resume" data-key="${esc(s.key)}">↪ ${esc(s.role==='host'?'老師控制台':s.name)} <span class="subtle">／${esc(s.code)}</span></button>`).join('')}</div>`:''}<div class="home-mini-art" aria-hidden="true">↗</div></div></section><div class="section-line"><span class="eyebrow">THE ESCAPE ROUTE / 逃生路線</span><span class="tiny">每關 2 題 · 解釋即時揭曉 · 答對累積積分</span></div>${mapMarkup()}<p class="tiny spacer">5 題依老師提供資料整理，另加 3 題原創補充。截圖來源標記不視作已核實的考試年份；詳見每題來源及解釋。</p>`;
}
function leaderMarkup(data,mini=false){
 if(!data?.players?.length)return '<p class="leader-empty">等候第一位挑戰者加入…</p>';
 return `<div class="leader-wrap"><table class="leader-table"><caption class="sr-only">課室排行榜</caption><thead><tr><th>#</th><th>挑戰者</th><th>積分</th>${mini?'':'<th>答對／進度</th><th class="mini-detail">作答時間</th>'}</tr></thead><tbody>${data.players.slice(0,mini?6:120).map(p=>`<tr class="${p.name===current?.name?'me':''}"><td class="rank">${p.rank===1?'★':p.rank}</td><td>${esc(p.name)}${mini?'':`<div class="tiny">${p.progress===(data.room.count||SETTINGS.count)?'已完成 ESCAPED':p.progress===0?'準備中 READY':`已答 ${p.progress} / ${data.room.count||SETTINGS.count}`}</div>`}</td><td class="score">${p.score}</td>${mini?'':`<td>${p.correct} / ${p.progress}</td><td class="mini-detail">${formatTime(p.elapsed)}</td>`}</tr>`).join('')}</tbody></table></div>`;
}
function boardNote(){return '<p class="tiny spacer">排名：總分 → 答對題數 → 作答時間。三項相同並列。每 2.5 秒更新。</p>';}
async function loadHost(){scene='host';deadline=0;latestBoard=await api('/api/board');renderHost();}
function renderHost(){if(latestBoard.room.mode==='live')return renderLiveHost();return renderSelfHost();}
function renderSelfHost(){
 const d=latestBoard,r=d.room,n=d.players.length,finished=d.players.filter(p=>p.progress===r.count).length;
 app.innerHTML=`<div class="page-top"><div><span class="eyebrow">TEACHER / MISSION CONTROL</span><h2>${esc(r.title)}</h2></div><div class="actions"><button class="btn light small" data-action="projection">⛶ 投影模式</button><button class="text-btn" data-action="home">返回首頁</button></div></div><div class="room-ticket"><div><span class="eyebrow">ROOM CODE / 房間碼</span><div class="code">${esc(r.code)}</div><span class="tiny">${r.status==='waiting'?'等全員加入後，再按開始。開始後不接受新參賽者。':r.status==='running'?'挑戰進行中 · 同學按自己的進度闖關':'Battle 已結束 · 以下是最終排行榜'}</span></div><div class="actions"><button class="btn light" data-action="copy-link">複製學生連結 ↗</button>${r.status==='waiting'?'<button class="btn orange" data-action="start" '+(!n?'disabled':'')+'>開始 Battle →</button>':r.status==='running'?'<button class="btn" data-action="end">結束及公布成績</button>':'<button class="btn light" data-action="new-room">開新一場 ↗</button>'}</div></div><div class="host-grid"><section class="panel"><div class="page-top"><h3>全班排行榜</h3><span class="tiny live-dot">${r.status==='ended'?'FINAL':'LIVE BATTLE'}</span></div><div id="full-board">${leaderMarkup(d)}</div>${boardNote()}<div class="actions spacer"><button class="text-btn" data-action="export">↓ 匯出成績 CSV</button></div></section><aside class="panel host-aside"><h3>任務概況</h3><div class="stat-grid"><div class="stat"><strong>${n}</strong><span>參賽者／組</span></div><div class="stat"><strong>${finished}</strong><span>已逃出</span></div><div class="stat"><strong>${r.seconds}s</strong><span>每題限時</span></div></div><div class="host-instructions"><p class="spacer"><b>老師小提示</b></p><p class="form-note">鼓勵學生先計算再作答。每關完成後，可暫停討論剛才的邊際決策。</p><p class="tiny">學生網址只提供加入入口。請在這個瀏覽器返回老師控制台。房間建立後 7 天到期。</p><p class="tiny spacer">答對 100 + 速度 0–20<br>每關 ${r.roundSize} 題全對額外 +50<br>最高 ${r.maxScore.toLocaleString()} 分</p></div></aside></div>`;
}
function renderWait(){scene='wait';deadline=0;app.innerHTML=`<section class="wait-stage"><span class="eyebrow">TEAM CHECKED IN / 已成功加入</span><div class="vault" aria-hidden="true"><div class="vault-inner">⊕</div></div><h2>${esc(current.name)}，已就位。</h2><p>房間 <b>${esc(current.code)}</b> · 等老師開始 Battle。<br>請保留此分頁，並準備紙筆及計算機。</p><span class="pill live-dot">WAITING FOR THE TEACHER</span><p class="tiny">只需一部裝置提交；每題只可作答一次。</p><div class="spacer"><button class="text-btn" data-action="reconnect">重新連接</button></div><div class="panel spacer"><h3>候場名單</h3><div id="wait-board">${leaderMarkup(latestBoard,true)}</div></div></section>`;}
async function loadPlay(){
 const d=await api('/api/play');playData=d;
 if(d.waiting){latestBoard=await api('/api/board');renderWait();return;}
 if(d.feedback){renderFeedback(d.feedback);return;}
 if(d.done){latestBoard=await api('/api/board');renderResults(d);return;}
 selected=null;deadline=Date.now()+d.deadline-d.serverNow;renderQuestion(d);updateTimer();
}
function scoreHeader(d){return `<div class="page-top"><div><span class="eyebrow">${OFFLINE_MODE?'LOCAL':esc(current.code)} / ${esc(current.name)}</span><div class="tiny">${t('已完成','COMPLETED')} ${d.progress||0} / ${count()}</div></div><div style="text-align:right"><button class="text-btn" data-action="language">${lang()==='en'?'中文題目':'English questions'} ⇄</button><br><span class="tiny">TOTAL SCORE</span><div class="game-score">${d.score||0}<small> PTS</small></div></div></div>`;}
function gameShell(content,index,d){return `${scoreHeader(d)}<div class="game-layout">${mapMarkup(index,true)}<section class="question-sheet">${content}</section><aside class="mini-board"><h3>${t('即時排行榜','Leaderboard')}</h3><p class="tiny live-dot">${OFFLINE_MODE?'本機成績':'LIVE CLASSROOM'}</p><div id="mini-board">${leaderMarkup(latestBoard,true)}</div><p class="tiny spacer">${t('答對','Correct')} +100<br>${t('速度','Speed')} +0–20<br>${roundSize()} ${t('題全對','correct per room')} +50</p></aside></div>`;}
function graphMarkup(){return `<svg class="cost-graph" viewBox="0 0 500 210" role="img" aria-label="MC 向上移動，水平 MR 不變；新交點產量 Q1 小於原來 Q0。示意圖非按比例。"><path d="M45 20V175H460" fill="none" stroke="#17382f" stroke-width="2"/><path d="M45 90H450" stroke="#147c68" stroke-width="3"/><path d="M100 165L365 30" stroke="#a9b4a6" stroke-width="3" stroke-dasharray="6 5"/><path d="M55 122L270 12" stroke="#ed633b" stroke-width="3"/><path d="M118 90V175M247 90V175" stroke="#60726a" stroke-dasharray="4 5"/><text x="418" y="80">MR</text><text x="370" y="29">MC₀</text><text x="275" y="20">MC₁ ↑</text><text x="108" y="194">Q₁</text><text x="237" y="194">Q₀</text><text x="460" y="194">Q</text><text x="10" y="20">$/件</text><text x="145" y="151">← 減產</text><text x="318" y="196" style="font-size:10px">延伸示意 · 非按比例</text></svg>`;}
function renderQuestion(d){
 scene='question';const q=d.question;
 const table=q.table?`<div style="overflow:auto"><table class="data-table"><thead><tr>${q.table.headers.map(s=>`<th>${esc(s)}</th>`).join('')}</tr></thead><tbody>${q.table.rows.map(row=>`<tr>${row.map(s=>`<td>${esc(s)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'';
 app.innerHTML=gameShell(`<div class="question-meta"><span class="tag">${esc(q.tag)}</span><span class="timer" id="timer" aria-label="剩餘作答時間">--:--</span></div><div class="time-track"><span id="time-bar" style="width:100%"></span></div><h2>${esc(q.title)}</h2><p class="source-note">${q.sourceType==='original'?t('原創增補題','Original supplementary question'):t('老師提供・整理題','Teacher-supplied · adapted')} ${esc(q.sourceLabel||'')}</p><p class="prompt">${esc(q.prompt)}</p>${q.graph?graphMarkup():''}${table}<form id="answer-form">${q.type==='mc'?`<div class="options" role="group" aria-label="Answer choices / 答案選項">${q.options.map((s,i)=>`<button class="option" type="button" data-action="select" data-value="${i}" aria-pressed="false"><span class="letter">${'ABCD'[i]}</span><span>${esc(s)}</span></button>`).join('')}</div>`:`<label for="numeric-answer" class="sr-only">輸入數值答案</label><div class="number-answer"><input id="numeric-answer" name="answer" type="text" inputmode="decimal" autocomplete="off" placeholder="輸入數值" maxlength="24"><span>${esc(q.unit)}<br><small class="subtle">不用輸入 $ 或逗號</small></span></div>`}<p class="error" id="answer-error" role="alert"></p><div class="question-foot"><span class="tiny">${t('選定後才提交','Choose before submitting')}<br>${t('每題只計分一次','One scored attempt per question')}</span><button class="btn orange" type="submit" id="submit-answer">${t('鎖定答案','Lock answer')} →</button></div></form><p class="tiny spacer" id="retry-line" hidden><button class="text-btn" data-action="reconnect">↻ 重新連接並恢復進度</button></p>`,q.room,d);
 resetView();
}
function renderFeedback(f){
 scene='feedback';deadline=0;playData={...playData,feedback:f};
 const answer=f.options?`${'ABCD'[f.answer]} · ${f.options[f.answer]}`:String(f.answer);
 const roundEnd=f.progress%roundSize()===0;
 app.innerHTML=gameShell(`<span class="eyebrow">${f.correct?'DECISION ACCEPTED':'LEARN & UNLOCK'} / ${f.progress} OF ${count()}</span><div class="feedback-icon ${f.correct?'':'wrong'}">${f.correct?'✓':'↻'}</div><h2>${f.correct?t('決策正確！','Correct decision!'):f.timeout?t('時間到，來看看關鍵。','Time is up. Review the key idea.'):t('再想一步，學會再前進。','Review, learn, and move on.')}</h2><div class="point-gain">+${f.points}<small> PTS</small></div><p class="tiny">${f.correct?`${t('答對','Correct')} +100 · ${t('速度','Speed')} +${f.speed}`:t('本題 0 分 · 不倒扣分數','0 points · No score deduction')}</p>${f.roundBonus?`<div class="round-bonus">★ ${t('本關全對！額外 +50','Perfect room! Bonus +50')}</div>`:''}<div class="explain-box"><b>${t('正確答案','ANSWER')}: ${esc(answer)}</b>${esc(f.explain)}</div><p class="trap"><b>${t('易錯位：','Watch out: ')}</b>${esc(f.trap)}</p><div class="question-foot"><span class="tiny">${t('閱讀解釋不計時','No timer while reviewing')}${roundEnd?`<br>${t('本關已完成','Room complete')} ✓`:''}</span><button class="btn orange" data-action="next" ${isLive()?'disabled':''}>${isLive()?t('等候老師開下一題','Waiting for the teacher'):f.progress===count()?t('查看逃生成績 ↗','View results ↗'):roundEnd?t('解鎖下一關 →','Unlock next room →'):t('下一個決策 →','Next decision →')}</button></div>${isLive()?`<div class="teacher-wait"><b>${t('已提交・請聽老師講解','Submitted · listen to your teacher')}</b><p>${t('下一題由老師開啟，畫面會自動更新。','The next question opens when your teacher is ready. This page updates automatically.')}</p></div>`:''}<p class="error" id="action-error" role="alert"></p>`,Math.floor(f.index/roundSize()),f);
 resetView();
}
function reviewMarkup(history=[]){return history.length?`<section class="review"><div class="section-line"><span class="eyebrow">DEBRIEF / 答題回顧</span><span class="tiny">點擊展開解釋</span></div>${history.map(f=>`<details><summary>${f.correct?'✓':'○'} ${esc(f.title)} <span class="subtle">+${f.points}</span></summary><p><b>正確答案：</b>${esc(f.options?`${'ABCD'[f.answer]} · ${f.options[f.answer]}`:f.answer)}</p><p>${esc(f.explain)}</p><p class="tiny">易錯位：${esc(f.trap)}</p></details>`).join('')}</section>`:'';}
function renderResults(d){
 scene='results';deadline=0;playData=d;const full=d.progress===count();
 app.innerHTML=`<section class="results"><div class="result-header"><span class="eyebrow">${full?'MISSION COMPLETE / 成功逃出':'BATTLE ENDED / 老師已結束'}</span><h1>${full?t('你已解開利潤密碼。','You cracked the profit code.'):t('每個決策，都是學習。','Every decision is a lesson.')}</h1><div class="big-score">${d.score||0}<small style="font-size:20px;letter-spacing:0"> PTS</small></div><p>${esc(current?.name||'全體挑戰者')} · ${t('答對','Correct')} ${d.correct||0} / ${d.progress||0}${full?' · 4 關已完成':''}</p><div class="actions" style="justify-content:center"><button class="btn orange" data-action="home">${OFFLINE_MODE?'換下一組 →':'回到首頁 →'}</button><button class="btn light" data-action="export">↓ 匯出排行榜</button></div></div><section class="panel"><div class="page-top"><h3>${OFFLINE_MODE?'本機最終排行榜':'課室排行榜'}</h3><span class="tiny live-dot">${OFFLINE_MODE?'LOCAL':latestBoard?.room.status==='ended'?'FINAL':'等待所有人完成'}</span></div><div id="full-board">${leaderMarkup(latestBoard)}</div>${boardNote()}</section>${reviewMarkup(d.history)}</section>`;
 resetView();
}
function renderLocalBoard(){latestBoard=localApi('/api/board');playData={score:0,correct:0,progress:0,history:[]};renderResults(playData);$('.result-header').innerHTML='<span class="eyebrow">LOCAL BATTLE / 共用教師電腦</span><h1>單機排行榜</h1><p>所有紀錄只保存在此瀏覽器。請先匯出備份。</p><div class="actions" style="justify-content:center"><button class="btn orange" data-action="home">下一組入場 →</button><button class="btn light" data-action="export">↓ 匯出成績</button><button class="text-btn" data-action="clear-local">清除單機紀錄</button></div>';}
function updateTimer(){
 if(scene==='host'){const el=$('#host-timer');if(el){const ms=Math.max(0,deadline-Date.now());el.textContent=formatTime(ms);el.classList.toggle('urgent',ms<=10000);}return;}
 if(scene!=='question'||!deadline)return;
 const ms=Math.max(0,deadline-Date.now()),el=$('#timer');if(el){el.textContent=formatTime(ms);el.classList.toggle('urgent',ms<=10000);}
 const bar=$('#time-bar');if(bar)bar.style.width=Math.max(0,Math.min(100,ms/((latestBoard?.room?.seconds||pLocal()?.seconds||75)*1000)*100))+'%';
 if(ms===0&&!submitting)submitAnswer(null,true);
}
async function submitAnswer(answer,timeout=false){
 if(submitting||scene!=='question')return;
 if(!timeout){if(playData.question.type==='mc'&&answer===null){$('#answer-error').textContent='請先選擇一個答案。';return;}if(playData.question.type==='number'&&!/^-?\d+(\.\d+)?$/.test(String(answer).trim())){$('#answer-error').textContent='請輸入數值，例如 1200，不用輸入 $ 或逗號。';return;}}
 submitting=true;$('#submit-answer').disabled=true;
 try{const f=await api('/api/answer',{index:playData.index,answer:timeout?null:answer});renderFeedback(f);}
 catch(e){deadline=0;$('#answer-error').textContent=e.message;$('#retry-line').hidden=false;$('#submit-answer').disabled=false;banner('未確認答案是否已收到。請重新連接；系統會保留原有進度，重試不會重複加分。');}
 finally{submitting=false;}
}
async function openSession(s){current=s;latestBoard=await api('/api/board');if(s.role==='host'){scene='host';renderHost();}else await loadPlay();}
function exportBoard(){
 const rows=[['名次','暱稱或組名','積分','答對題數','已答題數','累計作答秒數'],...(latestBoard?.players||[]).map(p=>[p.rank,p.name,p.score,p.correct,p.progress,(p.elapsed/1000).toFixed(1)])];
 const cell=v=>'"'+String(typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?"'"+v:v).replace(/"/g,'""')+'"';
 const csv='\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`ECON-Battle-${current?.code||'LOCAL'}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);
}
app.addEventListener('submit',async e=>{
 e.preventDefault();const form=e.target;
 if(form.id==='answer-form'){submitAnswer(playData.question.type==='mc'?selected:new FormData(form).get('answer'));return;}
 if(form.id!=='entry-form')return;const button=form.querySelector('button[type=submit]');button.disabled=true;
 const values=Object.fromEntries(new FormData(form));
 if(values.language){preferredLang=values.language;storage.set('econ:language',preferredLang);}current=null;latestBoard=null;
 try{
  if(OFFLINE_MODE){
   const name=values.name.trim();if(!name||name.length>20)throw Error('請填 1 至 20 字的組名。');if(localPlayers.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw Error('這個組名已有紀錄。請用另一組名，或按下方返回進度。');
   const t=crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random();localPlayers.push({name,token:t,seconds:Number(values.seconds),progress:0,score:0,correct:0,elapsed:0,roundCorrect:0,start:null,feedback:null,history:[],created:Date.now()});storage.set('econ:local:v2',localPlayers);saveSession({key:t,role:'player',code:'LOCAL',name,token:t,offline:true,lang:preferredLang});latestBoard=await api('/api/board');await loadPlay();
  }else if(activeTab==='teacher'){
   const d=await api('/api/create',{title:values.title,seconds:Number(values.seconds)});saveSession({key:d.code+'host',role:'host',code:d.code,token:d.hostToken,offline:false});await loadHost();
  }else{
   const d=await api('/api/join',{code:values.code.trim().toUpperCase(),name:values.name.trim()});saveSession({key:d.playerToken.slice(0,12),role:'player',code:d.code,name:d.name,token:d.playerToken,offline:false,lang:preferredLang});latestBoard=await api('/api/board');await loadPlay();
  }
 }catch(err){if($('#entry-error'))$('#entry-error').textContent=err.message;else toast(err.message);button.disabled=false;}
});
app.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;
 if(action==='select'){if(submitting)return;selected=Number(b.dataset.value);document.querySelectorAll('.option').forEach(o=>{const yes=o===b;o.classList.toggle('selected',yes);o.setAttribute('aria-pressed',String(yes));});$('#answer-error').textContent='';return;}
 b.disabled=true;
 try{
  if(action==='home'){current=null;latestBoard=null;renderHome();return;}
  if(action==='tab-student'||action==='tab-teacher'){activeTab=action==='tab-teacher'?'teacher':'student';renderHome();return;}
  if(action==='resume'){const s=sessions.find(s=>s.key===b.dataset.key);if(s)await openSession(s);}
  if(action==='local-board')renderLocalBoard();
  if(action==='reconnect')await loadPlay();
  if(action==='next'){if(isLive())return;await api('/api/next',{progress:playData.feedback.progress});await loadPlay();}
  if(['start','reveal','host-next','end'].includes(action))hostBusy=true;
  if(action==='reveal'){await api('/api/host',{action:'reveal'});await loadHost();}
  if(action==='host-next'){await api('/api/host',{action:'next',index:latestBoard.room.index});await loadHost();}
  if(action==='host-language'){preferredLang=preferredLang==='en'?'zh':'en';storage.set('econ:language',preferredLang);await loadHost();}
  if(action==='start'){await api('/api/host',{action:'start'});await loadHost();}
  if(action==='end'&&confirm('確定結束這場 Battle？未完成的同學將停止作答。')){await api('/api/host',{action:'end'});await loadHost();}
  if(action==='language'){const oldChoice=selected;const oldNumber=$('#numeric-answer')?.value;current.lang=lang()==='en'?'zh':'en';preferredLang=current.lang;storage.set('econ:language',preferredLang);saveSession(current);await loadPlay();if(scene==='question'){if(oldChoice!==null){selected=oldChoice;const option=app.querySelector(`[data-value="${oldChoice}"]`);if(option){option.classList.add('selected');option.setAttribute('aria-pressed','true');}}if(oldNumber!==undefined&&$('#numeric-answer'))$('#numeric-answer').value=oldNumber;}}
  if(action==='new-room'){activeTab='teacher';renderHome();}
  if(action==='copy-link'){
   const u=new URL(location.href);u.search='';u.hash='';u.searchParams.set('room',current.code);
   try{await navigator.clipboard.writeText(u.href);toast('已複製學生連結，貼到課堂群組即可。');}catch{prompt('複製以下學生連結：',u.href);}
  }
  if(action==='projection'){document.body.classList.toggle('projection');if(document.body.classList.contains('projection')){try{await document.documentElement.requestFullscreen();}catch{}}else if(document.fullscreenElement){try{await document.exitFullscreen();}catch{}}}
  if(action==='export')exportBoard();
  if(action==='clear-local'&&confirm('清除本機所有參賽紀錄？此操作無法復原，請先匯出成績。')){localPlayers=[];storage.set('econ:local:v2',[]);sessions=sessions.filter(s=>!s.offline);storage.set('econ:sessions:v2',sessions);current=null;renderHome();}
 }catch(err){const el=$('#action-error');if(el)el.textContent=err.message;else toast(err.message);}
 finally{hostBusy=false;if(b.isConnected)b.disabled=false;}
});
$('#home-link').addEventListener('click',e=>{e.preventDefault();current=null;latestBoard=null;renderHome();});
$('#help-btn').onclick=()=>$('#help').showModal();$('#close-help').onclick=()=>$('#help').close();
$('#download-btn').onclick=()=>{if(OFFLINE_MODE){toast('你正在使用完整單機 HTML，可以將此檔案交給其他老師。');return;}const a=document.createElement('a');a.href='/offline.html';a.download='Economics-Escape-Room-Battle.html';a.click();};
$('#mode-label').innerHTML=OFFLINE_MODE?'<i></i> OFFLINE / 單機版':'<i></i> ONLINE CLASSROOM';
setInterval(updateTimer,200);
setInterval(async()=>{
 if(polling||hostBusy||!current||scene==='home'||submitting)return;polling=true;const expected=scene,expectedKey=current.key;
 try{
  const d=await api('/api/board');if(current?.key!==expectedKey||scene!==expected)return;latestBoard=d;
  if(scene==='host'){renderHost();}
  else if(scene==='wait'){if(d.room.status!=='waiting'){await loadPlay();}else if($('#wait-board'))$('#wait-board').innerHTML=leaderMarkup(d,true);}
  else if(scene==='question'||scene==='feedback'||scene==='results'){
   if($('#mini-board'))$('#mini-board').innerHTML=leaderMarkup(d,true);if($('#full-board'))$('#full-board').innerHTML=leaderMarkup(d);
   if(isLive()&&scene!=='results'&&(d.room.status==='ended'||d.room.index!==playData?.room?.index||d.room.phase!==playData?.room?.phase))await loadPlay();
   else if(!isLive()&&scene==='question'&&d.room.status==='ended')await loadPlay();
  }
 }catch(err){banner(err.message+' 正在自動重試。');}finally{polling=false;}
},2500);
renderHome();
function tableMarkup(q){return q?.table?`<div class="table-scroll"><table class="data-table"><thead><tr>${q.table.headers.map(s=>`<th>${esc(s)}</th>`).join('')}</tr></thead><tbody>${q.table.rows.map(row=>`<tr>${row.map(s=>`<td>${esc(s)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'';}
function renderLiveHost(){
 const d=latestBoard,r=d.room,h=d.host,waiting=r.status==='waiting',ended=r.status==='ended',discuss=r.phase==='discussion';
 deadline=r.deadline?Date.now()+r.deadline-d.serverNow:0;
 const question=h?.question;
 const controls=waiting?`<button class="btn orange" data-action="start" ${d.players.length?'':'disabled'}>開始第 1 題 →</button>`:ended?'<button class="btn orange" data-action="new-room">開新一場 ↗</button>':discuss?`<button class="btn orange" data-action="host-next">${r.index===r.count-1?'完成講解・公布總榜 ↗':`已講解・開第 ${r.index+2} 題 →`}</button>`:'<button class="btn orange" data-action="reveal">結束作答・開始講解 →</button>';
 app.innerHTML=`<div class="page-top"><div><span class="eyebrow">LIVE HOST / 全班同步</span><h2>${esc(r.title)}</h2></div><div class="actions"><button class="btn light small" data-action="projection">⛶ 投影模式</button><button class="text-btn" data-action="home">返回首頁</button></div></div><div class="live-control"><div><span class="eyebrow">ROOM ${esc(r.code)} / ${waiting?'等候同學加入':ended?'FINAL RESULTS':`QUESTION ${r.index+1} OF ${r.count}`}</span><h3>${waiting?'全員到齊後開第一題':ended?'全場完成':discuss?'講解時間・全班暫停':'全班正在作答'}</h3></div><div class="actions"><button class="btn light" data-action="copy-link">複製學生連結 ↗</button>${controls}</div></div>${waiting?`<div class="room-ticket spacer"><div><span class="eyebrow">六位房間碼</span><div class="code">${esc(r.code)}</div></div><div><b>${d.players.length} 名／組已加入</b><p class="tiny">學生可各自選中文或英文，同題同時作答。</p></div></div>`:''}${question&&!ended?`<div class="live-question-grid"><section class="panel host-question"><div class="question-meta"><span class="tag">${esc(question.tag)}</span><button class="text-btn" data-action="host-language">中文 / English ⇄</button></div><h2>${esc(question.title)}</h2><p class="prompt spacer">${esc(question.prompt)}</p>${tableMarkup(question)}<div class="host-options">${question.options.map((o,i)=>`<div class="host-option ${discuss&&i===h.answer?'correct-option':''}"><b>${'ABCD'[i]}</b><span>${esc(o)}</span>${discuss?`<strong>${h.optionCounts[i]}</strong>`:''}</div>`).join('')}</div>${discuss?`<div class="explain-box"><b>正確答案 / ANSWER: ${'ABCD'[h.answer]}</b>${esc(h.explain)}</div><p class="trap">${esc(h.trap)}</p>`:''}</section><aside class="panel host-round"><span class="eyebrow">${discuss?'DISCUSS / 講解中':'TIME LEFT / 剩餘時間'}</span>${discuss?'<div class="discussion-mark">Ⅱ</div>':'<div class="host-countdown timer" id="host-timer">'+formatTime(Math.max(0,deadline-Date.now()))+'</div>'}<div class="answer-count"><strong>${h.submitted}<small> / ${h.total}</small></strong><span>已提交</span></div><p class="form-note">${discuss?'所有學生已停在本題。講解完，按上方按鈕開下一題。':'學生提交後即時看到對錯及解釋，之後等候你開下一題。'}</p>${discuss?`<p><b>答對 ${h.correctCount} 人／組</b><br>未作答／逾時 ${h.timeouts} 人／組</p><div class="distribution">${h.optionCounts.map((n,i)=>`<div><b>${'ABCD'[i]}</b><span><i style="width:${h.total?n/h.total*100:0}%;background:${i===h.answer?'var(--teal)':'var(--orange)'}"></i></span><strong>${n}</strong></div>`).join('')}</div>`:'<p class="tiny">倒數完後不會自動跳題。按「結束作答・開始講解」才進入講解階段。</p>'}</aside></div>`:''}<section class="panel spacer"><div class="page-top"><h3>${ended?'最終排行榜':'全班排行榜'}</h3><span class="tiny live-dot">${ended?'FINAL':'LIVE'}</span></div>${leaderMarkup(d)}${boardNote()}<div class="actions spacer"><button class="text-btn" data-action="export">↓ 匯出成績 CSV</button>${r.status==='running'?'<button class="text-btn" data-action="end">提前結束全場</button>':''}</div></section>`;
 updateTimer();
}
