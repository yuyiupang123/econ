import {QUESTIONS} from './legacy-questions.mjs';
const HTML = '__ONLINE_HTML__';
const OFFLINE = '__OFFLINE_HTML__';
const json = (value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const token=()=>crypto.randomUUID()+crypto.randomUUID();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const clean=s=>typeof s==='string'?s.trim().replace(/[\u0000-\u001f\u007f]/g,''):'';
const publicQ=q=>{const {answer,explain,trap,...rest}=q;return rest;};
async function roomFor(db,code){const r=await db.prepare('SELECT * FROM rooms WHERE code = ?').bind(code).first();if(!r||r.expires_at<Date.now())fail('找不到房間，或房間已到期。請向老師取得新房間碼。',404);return r;}
async function playerFor(db,code,bearer){if(!bearer)fail('請重新加入房間。',401);const p=await db.prepare('SELECT * FROM players WHERE room = ? AND token_hash = ?').bind(code,await hash(bearer)).first();if(!p)fail('參賽憑證無效。請用原來的瀏覽器重新進入。',401);return p;}
async function board(db,code){const rows=(await db.prepare('SELECT name,score,correct,progress,elapsed FROM players WHERE room = ? ORDER BY score DESC,correct DESC,elapsed ASC,created_at ASC,id ASC LIMIT 120').bind(code).all()).results;let rank=1;return rows.map((p,i)=>{if(i&&!(p.score===rows[i-1].score&&p.correct===rows[i-1].correct&&p.elapsed===rows[i-1].elapsed))rank=i+1;return {...p,rank};});}
export default {async fetch(req,env){
 const url=new URL(req.url);const db=env.DB;
 try{
  if(url.pathname==='/offline.html')return new Response(OFFLINE,{headers:{'content-type':'text/html; charset=utf-8','content-disposition':'attachment; filename="Economics-Escape-Room-Battle.html"'}});
  if(!url.pathname.startsWith('/api/'))return new Response(HTML,{headers:{'content-type':'text/html; charset=utf-8','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
  if(!db)fail('網上資料庫尚未連接，暫時可使用單機版。',503);
  const bearer=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
  let body={};if(req.method==='POST'){if(Number(req.headers.get('content-length'))>4096)fail('內容過長。',413);try{const raw=await req.text();if(raw.length>4096)fail('內容過長。',413);body=JSON.parse(raw);}catch(e){if(e.status)throw e;fail('請提交有效內容。');}}
  const code=clean(body.code||url.searchParams.get('code')).toUpperCase();
  if(url.pathname==='/api/create'&&req.method==='POST'){
   const title=clean(body.title)||'中四 Economics Battle';if(title.length>40)fail('課室名稱最多 40 字。');const seconds=Number(body.seconds);if(![45,75,120].includes(seconds))fail('請選擇有效的作答時間。');
   const h=token(), now=Date.now();let c;
   for(let n=0;n<5;n++){c=Array.from(crypto.getRandomValues(new Uint8Array(6)),x=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x%32]).join('');try{await db.prepare('INSERT INTO rooms(code,host_hash,title,seconds,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(c,await hash(h),title,seconds,now,now+7*86400000).run();break;}catch(e){if(n===4)throw e;}}
   // Bound retention: remove expired sessions when new classrooms are opened.
   await db.batch([db.prepare('DELETE FROM players WHERE room IN (SELECT code FROM rooms WHERE expires_at < ?)').bind(now),db.prepare('DELETE FROM rooms WHERE expires_at < ?').bind(now)]);
   return json({code:c,hostToken:h,title,seconds});
  }
  if(!/^[A-Z2-9]{6}$/.test(code))fail('房間碼應為 6 位英文字母或數字。');
  const room=await roomFor(db,code);
  if(url.pathname==='/api/board'&&req.method==='GET')return json({room:{code,title:room.title,status:room.status,seconds:room.seconds,expiresAt:room.expires_at,count:12,roundSize:3,maxScore:1640,mode:'self'},players:await board(db,code),serverNow:Date.now()});
  if(url.pathname==='/api/host'&&req.method==='POST'){
   if(await hash(bearer)!==room.host_hash)fail('只有建立此房間的老師可以操作。',403);
   if(!['start','end'].includes(body.action))fail('無效操作。');
   const result=await db.prepare('UPDATE rooms SET status = ? WHERE code = ? AND status = ?').bind(body.action==='start'?'running':'ended',code,body.action==='start'?'waiting':'running').run();
   if(!result.meta.changes)fail('房間狀態已變更，請重新整理。',409);return json({ok:true});
  }
  if(url.pathname==='/api/join'&&req.method==='POST'){
   if(room.status!=='waiting')fail('房間已開始或結束。請老師建立新房間。',409);
   const name=clean(body.name);if(!name||name.length>20)fail('暱稱／組名請填 1 至 20 字。');const t=token();
   try{const r=await db.prepare('INSERT INTO players(id,room,name,token_hash,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM players WHERE room = ?) < 120').bind(crypto.randomUUID(),code,name,await hash(t),Date.now(),code).run();if(!r.meta.changes)fail('房間已達 120 名／組上限。',409);}catch(e){if(e.status)throw e;if(/UNIQUE/i.test(e.message))fail('這個名字已有人使用，請加上組別或號碼。',409);throw e;}
   return json({code,name,playerToken:t});
  }
  let p=await playerFor(db,code,bearer);
  if(url.pathname==='/api/play'&&req.method==='GET'){
   if(p.feedback)return json({config:{count:12,roundSize:3,mode:'self'},feedback:JSON.parse(p.feedback),progress:p.progress,score:p.score,correct:p.correct});
   if(p.progress>=QUESTIONS.length||room.status==='ended')return json({config:{count:12,roundSize:3,mode:'self'},done:true,progress:p.progress,score:p.score,correct:p.correct,history:JSON.parse(p.history)});
   if(room.status==='waiting')return json({waiting:true,name:p.name});
   if(p.question_start===null){await db.prepare('UPDATE players SET question_start = ? WHERE id = ? AND question_start IS NULL').bind(Date.now(),p.id).run();p=await db.prepare('SELECT * FROM players WHERE id = ?').bind(p.id).first();}
   return json({config:{count:12,roundSize:3,mode:'self'},question:publicQ(QUESTIONS[p.progress]),index:p.progress,progress:p.progress,score:p.score,correct:p.correct,deadline:p.question_start+room.seconds*1000,serverNow:Date.now()});
  }
  if(url.pathname==='/api/next'&&req.method==='POST'){
   if(!Number.isInteger(body.progress)||body.progress!==p.progress)fail('題目狀態已更新，請重新載入。',409);
   await db.prepare('UPDATE players SET feedback = NULL, question_start = NULL WHERE id = ? AND progress = ? AND feedback IS NOT NULL').bind(p.id,p.progress).run();return json({ok:true});
  }
  if(url.pathname==='/api/answer'&&req.method==='POST'){
   if(!Number.isInteger(body.index)||body.index<0||body.index>=QUESTIONS.length)fail('無效題號。');
   // A retry of the last answer returns the exact same result and never adds points twice.
   if(p.feedback&&body.index===p.progress-1)return json(JSON.parse(p.feedback));
   if(room.status!=='running')fail('房間尚未開始或已結束。',409);
   if(body.index!==p.progress||p.feedback||p.question_start===null)fail('題目狀態已更新，請重新載入。',409);
   const q=QUESTIONS[p.progress];const elapsed=Math.max(0,Date.now()-p.question_start);const timeout=elapsed>room.seconds*1000+1500||body.answer===null;
   let valid=false;if(!timeout){if(q.type==='number'){const v=typeof body.answer==='string'?body.answer.trim():String(body.answer);valid=/^-?\d+(\.\d+)?$/.test(v)&&Math.abs(Number(v)-q.answer)<0.000001;}else valid=Number.isInteger(body.answer)&&body.answer===q.answer;}
   const speed=valid?Math.max(0,Math.floor(20*(1-Math.min(elapsed,room.seconds*1000)/(room.seconds*1000)))):0;
   const roundCorrect=p.round_correct+(valid?1:0);const roundBonus=(p.progress+1)%3===0&&roundCorrect===3?50:0;const points=(valid?100+speed:0)+roundBonus;
   const f={index:p.progress,correct:valid,timeout,answer:q.answer,options:q.options||null,explain:q.explain,trap:q.trap,title:q.title,points,speed,roundBonus,score:p.score+points,progress:p.progress+1};
   const history=[...JSON.parse(p.history),f];const result=await db.prepare('UPDATE players SET progress=progress+1, score=score+?, correct=correct+?, elapsed=elapsed+?, round_correct=?, feedback=?, history=? WHERE id=? AND progress=? AND feedback IS NULL').bind(points,valid?1:0,Math.min(elapsed,room.seconds*1000),(p.progress+1)%3===0?0:roundCorrect,JSON.stringify(f),JSON.stringify(history),p.id,p.progress).run();
   if(!result.meta.changes){const latest=await db.prepare('SELECT feedback FROM players WHERE id=?').bind(p.id).first();if(latest.feedback)return json(JSON.parse(latest.feedback));fail('答案已處理，請重新載入。',409);}return json(f);
  }
  fail('找不到此操作。',404);
 }catch(e){if(!e.status)console.error(e);return json({error:e.status?e.message:'伺服器暫時未能完成操作。請稍後再試，分數不會因重試而重複增加。'},e.status||500);}
}};
