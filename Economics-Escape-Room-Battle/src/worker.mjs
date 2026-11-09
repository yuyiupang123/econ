import {QUESTIONS,SETTINGS,localiseQuestion,localiseFeedback,feedbackText} from './questions.mjs';
import {QUESTIONS as LEGACY_QUESTIONS} from './legacy-questions.mjs';
import legacyWorker from './legacy-worker.mjs';
const HTML = '__ONLINE_HTML__';
const OFFLINE = '__OFFLINE_HTML__';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const token=()=>crypto.randomUUID()+crypto.randomUUID();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const clean=s=>typeof s==='string'?s.trim().replace(/[\u0000-\u001f\u007f]/g,''):'';
const config={...SETTINGS,mode:'live'};
const publicQ=q=>{const {answer,explain,trap,...rest}=q;return rest;};
const playerById=(db,id)=>db.prepare('SELECT * FROM players WHERE id=?').bind(id).first();
const roomInfo=r=>({code:r.code,title:r.title,status:r.status,phase:r.phase,index:r.question_index,seconds:r.seconds,deadline:r.round_start===null?null:r.round_start+r.seconds*1000,expiresAt:r.expires_at,...config});
function resultFor(q,index,selection,correct,timeout,elapsed,room,p){
 const speed=correct?Math.max(0,Math.floor(20*(1-Math.min(elapsed,room.seconds*1000)/(room.seconds*1000)))):0;
 const roundCorrect=correct?p.round_correct+1:0;
 const roundBonus=(index+1)%SETTINGS.roundSize===0&&roundCorrect===SETTINGS.roundSize?50:0;
 const points=(correct?100+speed:0)+roundBonus;
 return {index,selected:selection,correct,timeout,answer:q.answer,text:feedbackText(q),points,speed,roundBonus,score:p.score+points,progress:index+1};
}
async function syncMissing(db,room,p){
 let target=room.question_index-1;
 if(room.phase==='discussion'||room.status==='ended'||(room.round_start!==null&&Date.now()>room.round_start+room.seconds*1000+1500))target=room.question_index;
 target=Math.min(target,QUESTIONS.length-1);
 if(p.progress>target)return p;
 const oldProgress=p.progress,history=JSON.parse(p.history);let last=null;
 for(let i=p.progress;i<=target;i++){
  last=resultFor(QUESTIONS[i],i,null,false,true,room.seconds*1000,room,p);history.push(last);p.progress=i+1;p.round_correct=0;p.elapsed+=room.seconds*1000;
 }
 const result=await db.prepare('UPDATE players SET progress=?,round_correct=0,elapsed=?,feedback=?,history=? WHERE id=? AND progress=?').bind(p.progress,p.elapsed,JSON.stringify(last),JSON.stringify(history),p.id,oldProgress).run();
 if(!result.meta.changes)return syncMissing(db,room,await playerById(db,p.id));
 p.history=JSON.stringify(history);p.feedback=JSON.stringify(last);return p;
}
async function settleRoom(db,room){
 const rows=(await db.prepare('SELECT * FROM players WHERE room=? AND progress<=?').bind(room.code,room.question_index).all()).results;
 for(let i=0;i<rows.length;i+=8)await Promise.all(rows.slice(i,i+8).map(p=>syncMissing(db,room,p)));
}
async function board(db,room,host,lang){
 const rows=(await db.prepare('SELECT * FROM players WHERE room=? ORDER BY score DESC,correct DESC,elapsed ASC,created_at ASC,id ASC LIMIT 120').bind(room.code).all()).results;
 let rank=1;const players=rows.map((p,i)=>{if(i&&!(p.score===rows[i-1].score&&p.correct===rows[i-1].correct&&p.elapsed===rows[i-1].elapsed))rank=i+1;return {name:p.name,score:p.score,correct:p.correct,progress:p.progress,elapsed:p.elapsed,rank};});
 const output={room:roomInfo(room),players,serverNow:Date.now()};
 if(host&&room.question_index>=0){
  const q=localiseQuestion(QUESTIONS[room.question_index],lang),answers=rows.map(p=>JSON.parse(p.history).find(f=>f.index===room.question_index)).filter(Boolean);
  output.host={question:publicQ(q),submitted:answers.length,total:rows.length,unanswered:rows.length-answers.length};
  if(room.phase!=='question')Object.assign(output.host,{answer:q.answer,explain:q.explain,trap:q.trap,optionCounts:q.options.map((_,i)=>answers.filter(f=>f.selected===i).length),correctCount:answers.filter(f=>f.correct).length,timeouts:answers.filter(f=>f.timeout).length});
 }
 return output;
}
export default {async fetch(req,env){
 const originalRequest=req.clone();
 const url=new URL(req.url),db=env.DB;
 try{
  if(url.pathname==='/offline.html')return new Response(OFFLINE,{headers:{'content-type':'text/html; charset=utf-8','content-disposition':'attachment; filename="Economics-Escape-Room-Battle.html"'}});
  if(!url.pathname.startsWith('/api/'))return new Response(HTML,{headers:{'content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
  if(!db)fail('課室資料庫未連接。',503);
  let body={};if(req.method==='POST'){const raw=await req.text();if(raw.length>4096)fail('內容過長。',413);try{body=JSON.parse(raw);}catch{fail('無效內容。');}}
  const bearer=(req.headers.get('authorization')||'').replace(/^Bearer /,''),code=clean(body.code||url.searchParams.get('code')).toUpperCase(),lang=(body.lang||url.searchParams.get('lang'))==='en'?'en':'zh';
  if(url.pathname==='/api/create'&&req.method==='POST'){
   const title=clean(body.title)||'中四 Economics Battle',seconds=Number(body.seconds);if(title.length>40||![45,75,120].includes(seconds))fail('請填有效課室名稱及作答時間。');
   const hostToken=token(),now=Date.now();let created;
   for(let i=0;i<5;i++){const c=Array.from(crypto.getRandomValues(new Uint8Array(6)),x=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x%32]).join('');try{await db.prepare('INSERT INTO rooms(code,host_hash,title,seconds,created_at,expires_at,question_set) VALUES(?,?,?,?,?,?,?)').bind(c,await hash(hostToken),title,seconds,now,now+7*86400000,SETTINGS.version).run();created=c;break;}catch(e){if(i===4)throw e;}}
   await db.batch([db.prepare('DELETE FROM players WHERE room IN (SELECT code FROM rooms WHERE expires_at < ?)').bind(now),db.prepare('DELETE FROM rooms WHERE expires_at < ?').bind(now)]);
   return json({code:created,hostToken,title,seconds});
  }
  if(!/^[A-Z2-9]{6}$/.test(code))fail('請輸入六位房間碼。');
  let room=await db.prepare('SELECT * FROM rooms WHERE code=?').bind(code).first();if(!room||room.expires_at<Date.now())fail('房間不存在或已到期。',404);
  if(room.question_set!==SETTINGS.version)return legacyWorker.fetch(originalRequest,env);
  const host=!!bearer&&await hash(bearer)===room.host_hash;
  if(url.pathname==='/api/board'&&req.method==='GET')return json(await board(db,room,host,lang));
  if(url.pathname==='/api/host'&&req.method==='POST'){
   if(!host)fail('只有建立房間的老師可主持。',403);
   const action=body.action;
   if(action==='start'){
    const r=await db.prepare("UPDATE rooms SET status='running',phase='question',question_index=0,round_start=? WHERE code=? AND status='waiting'").bind(Date.now(),code).run();if(!r.meta.changes)fail('此場已開始。',409);
   }else if(action==='reveal'){
    if(room.status!=='running'||room.phase!=='question')fail('此題已在講解階段。',409);
    await db.prepare("UPDATE rooms SET phase='discussion' WHERE code=? AND phase='question'").bind(code).run();room=await db.prepare('SELECT * FROM rooms WHERE code=?').bind(code).first();await settleRoom(db,room);
   }else if(action==='next'){
    if(room.status!=='running'||room.phase!=='discussion'||body.index!==room.question_index)fail('請先結束作答並講解當前題目。',409);
    if(room.question_index>=QUESTIONS.length-1)await db.prepare("UPDATE rooms SET status='ended',phase='ended' WHERE code=? AND phase='discussion' AND question_index=?").bind(code,room.question_index).run();
    else await db.prepare("UPDATE rooms SET phase='question',question_index=question_index+1,round_start=? WHERE code=? AND phase='discussion' AND question_index=?").bind(Date.now(),code,room.question_index).run();
   }else if(action==='end'){
    if(room.status!=='running')fail('此場尚未開始或已結束。',409);
    await db.prepare("UPDATE rooms SET status='ended',phase='ended' WHERE code=?").bind(code).run();room=await db.prepare('SELECT * FROM rooms WHERE code=?').bind(code).first();await settleRoom(db,room);
   }else fail('無效主持操作。');
   return json({ok:true});
  }
  if(url.pathname==='/api/join'&&req.method==='POST'){
   if(room.status!=='waiting')fail('此場已開始或結束。',409);const name=clean(body.name);if(!name||name.length>20)fail('暱稱／組名請填 1 至 20 字。');const playerToken=token();
   try{const r=await db.prepare('INSERT INTO players(id,room,name,token_hash,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM players WHERE room=?)<120').bind(crypto.randomUUID(),code,name,await hash(playerToken),Date.now(),code).run();if(!r.meta.changes)fail('此房已滿。',409);}catch(e){if(e.status)throw e;if(/UNIQUE/i.test(e.message))fail('此名字已有人使用。',409);throw e;}
   return json({code,name,playerToken});
  }
  if(!bearer)fail('請先加入房間。',401);
  let p=await db.prepare('SELECT * FROM players WHERE room=? AND token_hash=?').bind(code,await hash(bearer)).first();if(!p)fail('無效參賽憑證，請使用原來的瀏覽器。',401);
  p=await syncMissing(db,room,p);
  if(url.pathname==='/api/play'&&req.method==='GET'){
   const common={config,room:roomInfo(room),progress:p.progress,score:p.score,correct:p.correct,serverNow:Date.now()};
   if(room.status==='waiting')return json({...common,waiting:true,name:p.name});
   if(room.status==='ended')return json({...common,done:true,history:JSON.parse(p.history).map(f=>localiseFeedback(f,lang))});
   const feedback=JSON.parse(p.history).find(f=>f.index===room.question_index);
   if(feedback)return json({...common,feedback:localiseFeedback(feedback,lang),awaitTeacher:true});
   return json({...common,question:publicQ(localiseQuestion(QUESTIONS[room.question_index],lang)),index:room.question_index,deadline:room.round_start+room.seconds*1000});
  }
  if(url.pathname==='/api/next')fail('下一題由老師開啟，請等候老師。',403);
  if(url.pathname==='/api/answer'&&req.method==='POST'){
   if(!Number.isInteger(body.index)||body.index!==room.question_index)fail('題目已切換，請重新連接。',409);
   const prior=JSON.parse(p.history).find(f=>f.index===body.index);if(prior)return json(localiseFeedback(prior,lang));
   if(room.status!=='running'||room.phase!=='question')fail('此題已結束作答，請等老師開下一題。',409);
   const q=QUESTIONS[body.index],elapsed=Math.max(0,Date.now()-room.round_start),timeout=elapsed>room.seconds*1000+1500||body.answer===null;
   const valid=!timeout&&Number.isInteger(body.answer)&&body.answer===q.answer;
   const f=resultFor(q,body.index,timeout?null:body.answer,valid,timeout,elapsed,room,p),history=[...JSON.parse(p.history),f];
   const r=await db.prepare("UPDATE players SET progress=progress+1,score=score+?,correct=correct+?,elapsed=elapsed+?,round_correct=?,feedback=?,history=? WHERE id=? AND progress=? AND EXISTS(SELECT 1 FROM rooms WHERE code=? AND status='running' AND phase='question' AND question_index=?)").bind(f.points,valid?1:0,Math.min(elapsed,room.seconds*1000),(body.index+1)%SETTINGS.roundSize===0?0:(valid?p.round_correct+1:0),JSON.stringify(f),JSON.stringify(history),p.id,body.index,code,body.index).run();
   if(!r.meta.changes){const latest=await playerById(db,p.id),saved=JSON.parse(latest.history).find(a=>a.index===body.index);if(saved)return json(localiseFeedback(saved,lang));fail('題目狀態已更新，請重新連接。',409);}
   return json(localiseFeedback(f,lang));
  }
  fail('找不到此操作。',404);
 }catch(e){if(!e.status)console.error(e);return json({error:e.status?e.message:'伺服器暫未能完成操作，請重新連接。'},e.status||500);}
}};
