import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {database} from '../scripts/database.mjs';
import {QUESTIONS,SETTINGS} from '../src/questions.mjs';
const home=await worker.fetch(new Request('https://test.local/'),{});assert((await home.text()).includes('question-language'));
const download=await worker.fetch(new Request('https://test.local/offline.html'),{});assert((await download.text()).includes('const OFFLINE_MODE = true'));
const DB=database();let now=Date.now();const realNow=Date.now;Date.now=()=>now;
assert.equal(QUESTIONS.length,8);assert.equal(QUESTIONS.filter(q=>q.sourceType==='original').length,3);assert(QUESTIONS.every(q=>!q.pending));
async function call(path,data,token,lang='zh'){
 const target=path+(path.includes('?')?'&':'?')+'lang='+lang;
 const res=await worker.fetch(new Request('https://test.local'+target,{method:data?'POST':'GET',headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},...(data?{body:JSON.stringify({...data,lang})}:{})}),{DB});return {status:res.status,data:await res.json()};
}
const c=(await call('/api/create',{title:'Teacher-paced Battle',seconds:75})).data;
const alice=(await call('/api/join',{code:c.code,name:'English team'})).data;
const bob=(await call('/api/join',{code:c.code,name:'中文隊'})).data;
assert.equal((await call('/api/host',{code:c.code,action:'start'},alice.playerToken)).status,403);
assert.equal((await call('/api/play?code='+c.code,null,alice.playerToken)).data.waiting,true);
await call('/api/host',{code:c.code,action:'start'},c.hostToken);
assert.equal((await call('/api/join',{code:c.code,name:'Late'})).status,409);
let score=0;
for(let i=0;i<8;i++){
 const q=QUESTIONS[i];
 const zh=(await call('/api/play?code='+c.code,null,bob.playerToken,'zh')).data;
 const en=(await call('/api/play?code='+c.code,null,alice.playerToken,'en')).data;
 assert.equal(zh.index,i);assert.equal(en.index,i);assert.equal(zh.deadline,en.deadline,'All students share the same deadline');
 assert.equal(zh.question.prompt,q.zh.prompt);assert.equal(en.question.prompt,q.en.prompt);
 const switched=(await call('/api/play?code='+c.code,null,alice.playerToken,'zh')).data;assert.equal(switched.deadline,en.deadline,'Language switch must not restart timer');
 for(const text of [zh.question,en.question]){assert.equal(text.answer,undefined);assert.equal(text.explain,undefined);assert.equal(text.zh,undefined);assert.equal(text.en,undefined);}
 assert.equal(en.config.mode,'live');assert.equal(q.zh.options.length,4);assert.equal(q.en.options.length,4);
 now+=1000;
 const answer=(await call('/api/answer',{code:c.code,index:i,answer:q.answer},alice.playerToken,'en')).data;
 assert(answer.correct);assert.equal(answer.explain,q.en.explain);assert.equal(answer.roundBonus,i%2===1?50:0);
 score+=119+(i%2===1?50:0);assert.equal(answer.score,score);
 const feedback=(await call('/api/play?code='+c.code,null,alice.playerToken,'en')).data;
 assert.equal(feedback.awaitTeacher,true);assert.equal(feedback.feedback.index,i);
 assert.equal((await call('/api/next',{code:c.code,progress:i+1},alice.playerToken)).status,403,'Student cannot open the next question');
 const retry=(await call('/api/answer',{code:c.code,index:i,answer:null},alice.playerToken,'zh')).data;assert.equal(retry.score,score);assert.equal(retry.explain,q.zh.explain);
 // Bob intentionally misses the second question, even though Alice has answered it.
 if(i!==1)await call('/api/answer',{code:c.code,index:i,answer:(q.answer+1)%4},bob.playerToken);
 const ongoing=(await call('/api/board?code='+c.code,null,c.hostToken)).data;
 assert.equal(ongoing.room.index,i);assert.equal(ongoing.room.phase,'question');assert.equal(ongoing.host.answer,undefined,'Projection must not reveal the correct answer early');
 assert.equal((await call('/api/host',{code:c.code,action:'next',index:i},c.hostToken)).status,409,'Teacher must enter explanation phase first');
 await call('/api/host',{code:c.code,action:'reveal'},c.hostToken);
 const discuss=(await call('/api/board?code='+c.code,null,c.hostToken)).data;
 assert.equal(discuss.room.phase,'discussion');assert.equal(discuss.host.submitted,2);assert.equal(discuss.host.answer,q.answer);assert.equal(discuss.host.correctCount,1);
 assert.equal(discuss.host.timeouts,i===1?1:0);assert.equal(discuss.host.optionCounts[q.answer],1);
 // Explaining for five minutes must not start a new question or add points.
 now+=5*60000;
 const held=(await call('/api/play?code='+c.code,null,alice.playerToken)).data;assert.equal(held.feedback.index,i);assert.equal(held.score,score);
 const publicBoard=(await call('/api/board?code='+c.code,null,bob.playerToken)).data;assert.equal(publicBoard.host,undefined);
 await call('/api/host',{code:c.code,action:'next',index:i},c.hostToken);
}
const done=(await call('/api/play?code='+c.code,null,alice.playerToken,'en')).data;
assert(done.done);assert.equal(done.correct,8);assert.equal(done.history.length,8);assert.equal(done.score,1152);assert.equal(done.room.status,'ended');
const bobDone=(await call('/api/play?code='+c.code,null,bob.playerToken)).data;assert.equal(bobDone.progress,8);assert.equal(bobDone.score,0);assert.equal(bobDone.history[1].timeout,true);
const final=(await call('/api/board?code='+c.code)).data;assert.equal(final.room.count,8);assert.equal(final.room.maxScore,1160);assert.equal(final.players[0].name,'English team');
// A closed tab skips several rounds and must catch up without advancing the room.
const c2=(await call('/api/create',{title:'Reconnect test',seconds:45})).data,p2=(await call('/api/join',{code:c2.code,name:'Absent'})).data;
await call('/api/host',{code:c2.code,action:'start'},c2.hostToken);
for(let i=0;i<3;i++){await call('/api/host',{code:c2.code,action:'reveal'},c2.hostToken);await call('/api/host',{code:c2.code,action:'next',index:i},c2.hostToken);}
const resumed=(await call('/api/play?code='+c2.code,null,p2.playerToken)).data;assert.equal(resumed.index,3);assert.equal(resumed.progress,3);assert.equal(resumed.score,0);
now+=47000;const timed=(await call('/api/play?code='+c2.code,null,p2.playerToken)).data;assert(timed.feedback.timeout);assert.equal(timed.room.index,3);assert.equal(timed.room.phase,'question');
// Existing deployed classrooms keep the previous 12-question version.
const old=(await call('/api/create',{title:'Legacy fixture',seconds:75})).data;await DB.prepare('UPDATE rooms SET question_set=? WHERE code=?').bind('legacy12',old.code).run();
const legacy=(await call('/api/join',{code:old.code,name:'Legacy'})).data;await call('/api/host',{code:old.code,action:'start'},old.hostToken);
const oldQ=(await call('/api/play?code='+old.code,null,legacy.playerToken)).data;assert.equal(oldQ.config.count,12);assert.equal(oldQ.question.type,'number');
assert((await call('/api/answer',{code:old.code,index:0,answer:1200},legacy.playerToken)).data.correct);
// Independent schedule calculations, including ties and re-optimisation.
const maximise=(rows,p,average=false)=>{const profit=rows.map(([q,c])=>p*q-(average?q*c:c)),max=Math.max(...profit);return {profit:max,q:rows.filter((_,i)=>profit[i]===max).map(r=>r[0])};};
assert.deepEqual(maximise([[1,40],[2,65],[3,95],[4,130],[5,170]],35),{profit:10,q:[3,4]});
assert.deepEqual(maximise([[2,20],[3,21],[4,22],[5,23],[6,24],[7,25]],25,true),{profit:12,q:[3,4]});
const ac=[[5,10],[6,11],[7,12],[8,13],[9,14]],before=maximise(ac,20,true),after=maximise(ac.map(([q,c])=>[q,c+2]),20,true);assert.equal(after.profit-before.profit,-14);assert.deepEqual(after.q,[6,7]);
assert.deepEqual(maximise([[3,30],[4,60],[5,100],[6,150],[7,210]],50),{profit:150,q:[5,6]});assert.equal(20-15,5);assert.equal((700-200)/50,10);
for(const file of ['downloads/Economics-Escape-Room-Battle.html','downloads/online-preview.html']){const html=readFileSync(file,'utf8');new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);assert(!html.includes('__SETTINGS__'));assert(html.includes('question-language'));assert(html.includes('Teacher-supplied'));assert(!html.includes('15Q5'));}
Date.now=realNow;DB.close();console.log('PASS: 8 bilingual questions; teacher-paced rounds; instant feedback; shared countdown; no student skipping; discussion holds; answer distribution; unanswered/timeout settlement; reconnect; score/bonus/idempotency; legacy compatibility; economics checks; both HTML scripts.');
