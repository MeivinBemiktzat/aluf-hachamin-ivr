'use strict';
const hf=require('./hf-storage');
const game=require('./game');
const bot=require('./bot');
const crypto=require('node:crypto');

const PREFIX='aluf:';
const TTL=8*60*60;
const WAIT=5;
const HOLD=process.env.YEMOT_HOLD_MUSIC||'';
const clean=s=>String(s||'').replace(/[.\-]/g,' ').slice(0,180);
const say=s=>'t-'+clean(s);
const readParams=(name,o={})=>[name,'',o.max??1,o.min??1,o.timeout??15,o.style||'Number','no','no','',o.allowed||'',1,o.onEmpty||'','','','no'].join(',');
const next=(f)=>'P'+(++f.seq);
const read=(f,text,o={})=>{const n=next(f);f.expect=n;return `read=${say(text)}=${readParams(n,o)}`;};
const wait=(f,text='ממתינים לעדכון המשחק')=>{const n=next(f);f.expect=n;return `read=${HOLD?'f-'+HOLD:say(text)}=${readParams(n,{max:'',min:'',timeout:WAIT,style:'NO',onEmpty:'Ok'})}`;};
const id=()=>crypto.randomBytes(8).toString('hex');
const phoneHash=phone=>crypto.createHash('sha256').update(String(phone)).digest('hex');
const phoneKey=phone=>key('phone',phoneHash(phone));
function log(event,details={}){console.log(JSON.stringify({service:'aluf-hachamin-ivr',ts:new Date().toISOString(),event,...details}));}
const code=()=>String(100+crypto.randomInt(900));
const key=(type,value)=>PREFIX+type+':'+value;
async function load(k){const x=await hf.get(k);return x?JSON.parse(x):null;}
async function save(k,v,ttl=TTL){await hf.set(k,JSON.stringify(v),ttl);}
const gameKey=c=>key('game',c),flowKey=c=>key('flow',c);
async function loadGame(c){return load(gameKey(c));}
async function saveGame(g){log('game.save.begin',{gameCode:g.code,started:g.started,phase:g.phase,players:g.players.length,round:g.round,turn:g.turn});return save(gameKey(g.code),g);}
async function registerResume(codeValue,playerId){
 for(let attempt=1;attempt<=5;attempt++){
  const g=await loadGame(codeValue);
  if(!g||g.over||!g.players.some(x=>x.id===playerId))return {ok:false,reason:'unavailable'};
  const now=Date.now();
  let session=g.resumeSession;
  if(!session||session.status==='complete'||now>session.expiresAt){
   session={id:id(),status:'waiting',startedAt:now,expiresAt:now+180000,ready:{}};
   g.resumeSession=session;
   log('resume.session_created',{gameCode:codeValue,sessionId:session.id,expiresAt:session.expiresAt});
  }
  session.ready=session.ready||{};
  session.ready[playerId]=now;
  const humans=g.players.filter(x=>!x.isBot);
  const ready=humans.filter(x=>session.ready[x.id]&&now-session.ready[x.id]<=180000).length;
  if(ready===humans.length){session.status='complete';session.completedAt=now;g.lastResumedAt=now;}
  try{
   await saveGame(g);
   log('resume.player_registered',{gameCode:codeValue,sessionId:session.id,playerId,ready,required:humans.length,status:session.status,attempt});
   return {ok:true,game:g,sessionId:session.id,ready,required:humans.length,complete:session.status==='complete'};
  }catch(e){
   if(!['HF_CONFLICT','HF_READ_REQUIRED'].includes(e.code)||attempt===5)throw e;
   log('resume.concurrent_retry',{gameCode:codeValue,playerId,attempt,errorCode:e.code});
  }
 }
 throw Object.assign(new Error('Could not register resume request'),{code:'HF_CONFLICT'});
}
async function loadFlow(c){return await load(flowKey(c))||{step:'menu',seq:0};}
async function saveFlow(c,f){return save(flowKey(c),f,4*60*60);}
function getInput(p,f){return p[f.expect]===undefined?'':String(p[f.expect]);}
function response(res,body){res.status(200).setHeader('Content-Type','text/plain; charset=utf-8');res.send(body);}
function playerOf(g,f){return g&&g.players.find(p=>p.id===f.playerId);}
function nextHuman(g){return g.players.find(p=>!p.isBot&&!Object.prototype.hasOwnProperty.call(g.bids,p.id));}
function runBots(g){for(const p of g.players.filter(x=>x.isBot))if(!Object.prototype.hasOwnProperty.call(g.bids,p.id))bot.playBot(g,p);}
function marketSummary(g){return 'קלף השוק '+g.marketCard.name+'. '+g.marketCard.description+'. המצרכים שנפתחו: '+g.marketIngredients.join(', ');}
function playerStatus(p){return 'המתכון שלכם '+p.recipe.name+'. אספתם '+game.recipeProgress(p)+' מתוך '+p.recipe.ingredients.length+' מצרכים. יתרתכם '+game.coinTotal(p)+' זוזים. בידכם '+p.friends.length+' קלפי חבר\'ה.';}
async function handle(req,res){
 try{
  const p={...(req.query||{}),...(req.body||{})};
  const callId=String(p.ApiCallId||p.api_call_id||p.callId||'');
  if(!callId){log('request.rejected',{reason:'missing_call_id'});return response(res,'id_list_message=t-מזהה שיחה חסר');}
  await hf.runWithContext(async()=>{
   let f=await loadFlow(callId);
   // A new call always starts at the main menu. Continuing an unfinished game is explicit (key 3).
   const answer=getInput(p,f);log('request.received',{call:phoneHash(callId).slice(0,10),step:f.step,gameCode:f.code||null,hasAnswer:answer!=='',answerLength:answer.length,queryKeys:Object.keys(req.query||{}),bodyKeys:Object.keys(req.body||{})});
   const send=async(body)=>{log('response.send',{call:phoneHash(callId).slice(0,10),step:f.step,expect:f.expect||null,gameCode:f.code||null,bodyLength:String(body).length});await saveFlow(callId,f);response(res,body);};
   const prompt=(text,o)=>send(read(f,text,o));
   const pause=(text)=>send(wait(f,text));
   if(f.step==='menu'){
    const resumeRef=p.ApiPhone?await load(phoneKey(p.ApiPhone)):null;
    const resumeGame=resumeRef?await loadGame(resumeRef.code):null;
    const resumePlayer=resumeGame&&!resumeGame.over?resumeGame.players.find(x=>x.id===resumeRef.playerId):null;
    const canResume=!!(resumeGame&&resumePlayer&&resumeGame.mode==='human'&&!resumeGame.over);
    if(!f.expect||answer===''){
     const options=canResume?'. להמשך משחק קודם הקישו שלוש':'';
     return prompt('ברוכים הבאים לאלוף החמין. למשחק חדש הקישו אחת. לכניסה למשחק קיים הקישו שתיים'+options,{allowed:canResume?'123':'12'});
    }
    if(answer==='1'){f.step='mode';return prompt('למשחק מול שחקנים אמיתיים הקישו אחת. למשחק מול בוטים הקישו שתיים',{allowed:'12'});}
    if(answer==='2'){f.step='join_code';return prompt('הקישו את קוד המשחק בן שלוש הספרות',{min:3,max:3,style:'Digits'});}
    if(answer==='3'){
     if(!canResume){f.expect=null;return prompt('לא נמצא משחק קודם שעדיין לא הסתיים. למשחק חדש הקישו אחת. להצטרפות הקישו שתיים',{allowed:'12'});}
     const joined=await registerResume(resumeGame.code,resumePlayer.id);
     if(!joined.ok){f.expect=null;return prompt('המשחק כבר הסתיים או אינו זמין. למשחק חדש הקישו אחת. להצטרפות הקישו שתיים',{allowed:'12'});}
     f.code=resumeGame.code;f.playerId=resumePlayer.id;f.resumeSessionId=joined.sessionId;f.step=joined.complete?'game':'resume_wait';
     log('game.resume_requested',{gameCode:resumeGame.code,playerId:resumePlayer.id,sessionId:joined.sessionId,ready:joined.ready,required:joined.required,complete:joined.complete});
     if(joined.complete)return prompt('כל השחקנים התחברו מחדש. ממשיכים מהנקודה שבה המשחק נעצר. '+playerStatus(resumePlayer)+'. '+(joined.game.phase==='turn'?'כעת תור '+joined.game.players[joined.game.turn].name:'כעת מתנהל מכרז על '+(joined.game.marketIngredients[joined.game.ingredientIndex]||'המצרך הבא')),{allowed:'12345'});
     return pause('בקשת ההמשך נקלטה. מחכים שכל השחקנים יחייגו ויקישו שלוש. התחברו '+joined.ready+' מתוך '+joined.required);
    }
    f.expect=null;return prompt('בחירה לא תקינה. למשחק חדש הקישו אחת. להצטרפות הקישו שתיים',{allowed:'12'});
   }
   if(f.step==='resume_wait'){
    const g=await loadGame(f.code),pl=playerOf(g,f);
    if(!g||!pl||g.over){f.step='menu';f.expect=null;f.resumeSessionId=null;return prompt('המשחק כבר הסתיים או אינו זמין. למשחק חדש הקישו אחת. להצטרפות הקישו שתיים',{allowed:'12'});}
    const session=g.resumeSession;
    if(session&&session.id===f.resumeSessionId&&session.status==='complete'){
     f.step='game';
     log('game.resume_observed',{gameCode:g.code,playerId:pl.id,sessionId:session.id,phase:g.phase,turn:g.turn});
     return prompt('כל השחקנים התחברו מחדש. המשחק ממשיך מאותה נקודה. '+playerStatus(pl)+'. '+(g.phase==='turn'?'כעת תור '+g.players[g.turn].name:'כעת מתנהל מכרז על '+(g.marketIngredients[g.ingredientIndex]||'המצרך הבא')),{allowed:'12345'});
    }
    if(!session||session.id!==f.resumeSessionId||Date.now()>session.expiresAt){
     f.step='menu';f.expect=null;f.resumeSessionId=null;
     return prompt('חלון ההתחברות מחדש הסתיים. חזרו לתפריט הראשי והקישו שלוש כדי להתחיל חיבור מחדש',{allowed:'123'});
    }
    const humans=g.players.filter(x=>!x.isBot);
    const ready=humans.filter(x=>session.ready&&session.ready[x.id]&&Date.now()-session.ready[x.id]<=180000).length;
    return pause('ממתינים לחזרת כל השחקנים. התחברו '+ready+' מתוך '+humans.length+'. כל שחקן צריך לחייג ולהקיש שלוש בתפריט הראשי');
   }
   if(f.step==='mode'){
    if(answer==='1'){f.mode='human';f.step='human_count';return prompt('כמה שחקנים ישתתפו במשחק כוללכם? הקישו מספר בין שתיים לחמש',{allowed:'2345'});}
    if(answer==='2'){f.mode='bots';f.step='bot_count';return prompt('כמה בוטים ישחקו מולכם? הקישו מספר בין אחת לארבע',{allowed:'1234'});}
    return prompt('הקישו אחת למשחק אנושי או שתיים למשחק מול בוטים',{allowed:'12'});
   }
   if(f.step==='human_count'){
    const count=Number(answer);if(![2,3,4,5].includes(count))return prompt('מספר לא תקין. הקישו בין שתיים לחמש',{allowed:'2345'});
    const c=code(),g=game.newGame(c,count,'human'),pl=game.newPlayer(id(),'');
    g.players.push(pl);if(await loadGame(c))return prompt('נוצרה התנגשות נדירה בקוד המשחק. נסו שוב');await saveGame(g);f.code=c;f.playerId=pl.id;f.step='name';
    return prompt('קוד המשחק שלכם '+c+'. הקלידו כעת את שמכם',{max:'',min:'',style:'HebrewKeyboard',timeout:30});
   }
   if(f.step==='bot_count'){
    const count=Number(answer);if(![1,2,3,4].includes(count))return prompt('מספר בוטים לא תקין. הקישו בין אחת לארבע',{allowed:'1234'});
    const c='B'+id().slice(0,7),g=game.newGame(c,count+1,'bots'),pl=game.newPlayer(id(),'');
    g.players.push(pl);for(let i=0;i<count;i++)g.players.push(game.newPlayer('bot'+i,['האופה','הקצב','הסוחר','השף'][i],true));
    if(await loadGame(c))return prompt('נוצרה התנגשות נדירה בקוד המשחק. נסו שוב');await saveGame(g);f.code=c;f.playerId=pl.id;f.step='name';
    return prompt('הקלידו את שמכם',{max:'',min:'',style:'HebrewKeyboard',timeout:30});
   }
   if(f.step==='join_code'){
    const c=answer.replace(/\D/g,'');const g=await loadGame(c);
    if(!g||g.started||g.mode!=='human') {f.step='menu';f.expect=null;return prompt('לא נמצא משחק פתוח עם הקוד הזה. חזרו לתפריט הראשי');}
    if(g.players.length>=g.maxPlayers)return prompt('המשחק מלא. הקישו קוד אחר או חזרו לתפריט');
    f.code=c;f.playerId=id();f.step='name';
    return prompt('הקלידו את שמכם',{max:'',min:'',style:'HebrewKeyboard',timeout:30});
   }
   if(f.step==='name'){
    const name=answer.trim().slice(0,24);if(!name)return prompt('לא התקבל שם. הקלידו את שמכם',{max:'',min:'',style:'HebrewKeyboard',timeout:30});
    const g=await loadGame(f.code);if(!g)return prompt('המשחק אינו זמין. חזרו לתפריט הראשי');
    let pl=playerOf(g,f);if(!pl){pl=game.newPlayer(f.playerId,name);g.players.push(pl);}pl.name=name;
    if(g.mode==='bots'){game.startGame(g);await saveGame(g);if(p.ApiPhone){const pk=phoneKey(p.ApiPhone);await load(pk);await save(pk,{code:g.code,playerId:pl.id},TTL);}f.step='game';return prompt('המשחק מתחיל. '+playerStatus(pl)+' לפתיחת קלף שוק הקישו אחת. למצב אישי הקישו שתיים',{allowed:'12'});}
    await saveGame(g);if(p.ApiPhone){const pk=phoneKey(p.ApiPhone);await load(pk);await save(pk,{code:g.code,playerId:pl.id},TTL);}f.step='lobby';return pause('נרשמתם למשחק. קוד המשחק '+g.code+'. ממתינים להצטרפות שאר השחקנים');
   }
   if(f.step==='lobby'){
    const g=await loadGame(f.code);if(!g){f.step='menu';return prompt('המשחק לא נמצא. חזרו לתפריט');}
    if(g.started){
     f.step='game';
     const me=playerOf(g,f);
     log('lobby.player_resumed',{gameCode:g.code,playerId:f.playerId,players:g.players.length,phase:g.phase,turn:g.turn});
     return prompt('כל השחקנים כבר הצטרפו. המשחק פעיל! '+playerStatus(me)+'. '+(g.phase==='turn'?'כעת תור '+g.players[g.turn].name+'. לפתיחת קלף שוק הקישו אחת':'כעת מתנהל מכרז על '+(g.marketIngredients[g.ingredientIndex]||'המצרך הבא')+'. הקישו אחת להמשך'),{allowed:'1'});
    }
    if(g.players.length===g.maxPlayers){
     game.startGame(g);await saveGame(g);f.step='game';
     log('game.started',{gameCode:g.code,players:g.players.length,startedBy:f.playerId,phase:g.phase,turn:g.turn});
     return prompt('כל השחקנים הצטרפו והמשחק מתחיל. '+playerStatus(playerOf(g,f))+' הקישו אחת להמשך',{allowed:'1'});
    }
    log('lobby.waiting',{gameCode:g.code,joined:g.players.length,required:g.maxPlayers,playerId:f.playerId});
    return pause('ממתינים לשחקנים. הצטרפו '+g.players.length+' מתוך '+g.maxPlayers);
   }
   if(f.step==='game'){
    const g=await loadGame(f.code),pl=playerOf(g,f);if(!g||!pl){f.step='menu';return prompt('לא נמצא משחק פעיל');}
    if(g.over){f.step='menu';f.expect=null;return prompt('המשחק הסתיים. המנצח הוא '+(g.players.find(x=>x.id===g.winner)?.name||'לא ידוע'));}
    if(g.phase==='tie'){
     if(g.players[g.turn].id!==pl.id)return pause('יש תיקו במכרז. ממתינים להכרעת '+g.players[g.turn].name);
     const choice=Number(answer);
     if(!Number.isInteger(choice)||choice<1||choice>g.tieCandidates.length){
      const options=g.tieCandidates.map((pid,i)=>(i+1)+' עבור '+g.players.find(x=>x.id===pid).name).join('. ');
      return prompt('יש תיקו על המצרך '+g.tieIngredient+'. '+options+'. הקישו את מספר השחקן שיזכה',{allowed:g.tieCandidates.map((_,i)=>String(i+1)).join('')});
     }
     const winnerId=g.tieCandidates[choice-1],result=game.resolveTie(g,winnerId);await saveGame(g);
     return prompt('ההכרעה נקלטה. '+g.players.find(x=>x.id===winnerId).name+' זכה במצרך. הקישו אחת להמשך',{allowed:'1'});
    }
    if(g.phase==='bidding'){
     if(answer==='5'){try{const card=game.buyFriend(g,pl.id);await saveGame(g);return prompt('רכשתם קלף חבר\'ה: '+card.name+'. להפעלת קלף הקישו ארבע. להמשך הקישו אחת',{allowed:'14'});}catch(e){return prompt(e.message+'. להמשך הקישו אחת',{allowed:'1'});}}
     runBots(g);
     if(g.bidDeadline&&Date.now()>g.bidDeadline){for(const missing of g.players)if(!Object.prototype.hasOwnProperty.call(g.bids,missing.id))g.bids[missing.id]={amount:0,cards:[],submittedAt:Date.now(),auto:true};game.addLog(g,'הצעות חסרות הושלמו אוטומטית באפס זוזים');}
     if(Object.keys(g.bids).length===g.players.length){
      log('auction.reveal.begin',{gameCode:g.code,bidCount:Object.keys(g.bids).length,players:g.players.length,ingredient:g.marketIngredients[g.ingredientIndex]});const result=game.revealAuction(g);log('auction.reveal.complete',{gameCode:g.code,pendingTie:!!result.pending,winnerId:result.winnerId||null,phase:g.phase,ingredientIndex:g.ingredientIndex,over:g.over});
      if(result.pending){await saveGame(g);if(g.players[g.turn].id!==pl.id)return pause('יש תיקו במכרז. ממתינים להכרעת '+g.players[g.turn].name);const options=g.tieCandidates.map((pid,i)=>(i+1)+' עבור '+g.players.find(x=>x.id===pid).name).join('. ');return prompt('יש תיקו על המצרך '+g.tieIngredient+'. '+options+'. הקישו את מספר השחקן שיזכה',{allowed:g.tieCandidates.map((_,i)=>String(i+1)).join('')});}
      if(g.over){await saveGame(g);return prompt('המשחק הסתיים. המנצח '+g.players.find(x=>x.id===g.winner).name);}
      await saveGame(g);
      return prompt('המכרז הסתיים. '+(result.winnerId?'המצרך זכה על ידי '+g.players.find(x=>x.id===result.winnerId).name:'לא היה זוכה')+'. '+(g.phase==='bidding'?'המצרך הבא '+g.marketIngredients[g.ingredientIndex]+'.':'התור הבא')+'. הקישו אחת להמשך',{allowed:'1'});
     }
     if(answer==='4'&&pl.friends.length){f.returnStep='game';f.step='friend_select';return prompt('קלפי החבר\'ה שלכם: '+pl.friends.map((id,i)=>(i+1)+' '+(game.data.friendCards.find(c=>c.id===id)?.name||'קלף')).join('. ')+'. הקישו מספר קלף להפעלה',{allowed:pl.friends.map((_,i)=>String(i+1)).join('')});}
     const waiting=nextHuman(g);
     if(waiting&&waiting.id!==pl.id)return pause('ממתינים להצעה הסודית של '+waiting.name+'. להפעלת קלף חבר\'ה הקישו ארבע. לרכישת קלף הקישו חמש');
     if(!Object.prototype.hasOwnProperty.call(g.bids,pl.id)){
      f.step='bid_menu';await saveGame(g);
      return prompt('המכרז על '+g.marketIngredients[g.ingredientIndex]+'. להגשת הצעה הקישו אחת. להפעלת קלף חבר\'ה הקישו שתיים. למצב אישי הקישו שלוש. לרכישת קלף חבר\'ה הקישו חמש',{allowed:'1235'});
     }
     await saveGame(g);return pause('ההצעה שלכם נקלטה בסתר. ממתינים לשאר השחקנים');
    }
    if(g.phase==='turn'){
     if(answer==='5'){try{const card=game.buyFriend(g,pl.id);await saveGame(g);return prompt('רכשתם קלף חבר\'ה: '+card.name+'. הקישו אחת להמשך',{allowed:'1'});}catch(e){return prompt(e.message+'. הקישו אחת להמשך',{allowed:'1'});}}
     if(answer==='4'&&pl.friends.length){f.returnStep='game';f.step='friend_select';return prompt('קלפי החבר\'ה שלכם: '+pl.friends.map((id,i)=>(i+1)+' '+(game.data.friendCards.find(c=>c.id===id)?.name||'קלף')).join('. ')+'. הקישו מספר קלף להפעלה',{allowed:pl.friends.map((_,i)=>String(i+1)).join('')});}
     if(answer==='3'){if(!pl.ingredients.length)return prompt('אין לכם מצרכים למכירה. לפתיחת קלף שוק הקישו אחת',{allowed:'1'});f.step='sell_select';return prompt('המצרכים שלכם: '+pl.ingredients.map((x,i)=>(i+1)+' '+x).join('. ')+'. הקישו את מספר המצרך למכירה',{allowed:pl.ingredients.map((_,i)=>String(i+1)).join('')});}
     if(g.turnDeadline&&Date.now()>g.turnDeadline){const skipped=g.players[g.turn];game.nextTurn(g);game.addLog(g,skipped.name+' לא פעל בזמן והתור עבר אוטומטית');await saveGame(g);return pause('התור הקודם דולג עקב חוסר פעילות. כעת תור '+g.players[g.turn].name);}
     if(g.players[g.turn].id!==pl.id)return pause('כעת תור '+g.players[g.turn].name+'. '+playerStatus(pl));
     if(answer==='2')return prompt(playerStatus(pl)+' הקישו אחת לחזרה',{allowed:'1'});
     if(answer==='1'){
      game.openMarket(g);log('market.opened',{gameCode:g.code,round:g.round,turn:g.turn,marketCard:g.marketCard?.id,ingredientCount:g.marketIngredients.length,phase:g.phase});runBots(g);await saveGame(g);f.step='game';
      return prompt(marketSummary(g)+'. '+playerStatus(pl)+' הקישו אחת להמשך למכרז',{allowed:'1'});
     }
     return prompt('לפתיחת קלף שוק הקישו אחת. למצב אישי הקישו שתיים. למכירת מצרך הקישו שלוש. להפעלת קלף חבר\'ה הקישו ארבע. לרכישת קלף חבר\'ה הקישו חמש',{allowed:'12345'});
    }
    if(g.phase==='over'){f.step='menu';f.expect=null;return prompt('המשחק הסתיים. המנצח '+g.players.find(x=>x.id===g.winner).name);}
    return pause('ממתינים לעדכון המשחק');
   }
   if(f.step==='sell_select'){
    const g=await loadGame(f.code),pl=playerOf(g,f);if(!g||!pl)return prompt('המשחק אינו זמין');
    const index=Number(answer)-1;
    if(!Number.isInteger(index)||index<0||index>=pl.ingredients.length)return prompt('בחירת מצרך לא תקינה');
    game.sellIngredient(pl,index,g,false);await saveGame(g);f.step='game';
    return prompt('מכרתם את המצרך וקיבלתם שני קלפי כסף. '+playerStatus(pl)+' הקישו אחת להמשך',{allowed:'1'});
   }
   if(f.step==='bid_menu'){
    if(answer==='5'){const g=await loadGame(f.code),pl=playerOf(g,f);try{const card=game.buyFriend(g,pl.id);await saveGame(g);return prompt('רכשתם קלף חבר\'ה: '+card.name+'. להצעה הקישו אחת. להפעלת קלף הקישו שתיים',{allowed:'12'});}catch(e){return prompt(e.message+'. להצעה הקישו אחת',{allowed:'1'});}}
    if(answer==='1'){f.step='bid';return prompt('הקישו את סכום ההצעה בזוזים. ההצעה נשמרת בסתר',{max:2,min:1,timeout:25});}
    if(answer==='2'){
     const g=await loadGame(f.code),pl=playerOf(g,f);if(!g||!pl)return prompt('המשחק אינו זמין');
     if(!pl.friends.length)return prompt('אין בידכם קלפי חבר\'ה. להגשת הצעה הקישו אחת',{allowed:'1'});
     f.step='friend_select';const options=pl.friends.map((id,i)=>{const c=game.data.friendCards.find(x=>x.id===id);return (i+1)+' '+(c?c.name:'קלף לא ידוע');}).join('. ');
     return prompt('קלפי החבר\'ה שלכם: '+options+'. הקישו את מספר הקלף להפעלה',{allowed:pl.friends.map((_,i)=>String(i+1)).join('')});
    }
    if(answer==='3'){const g=await loadGame(f.code),pl=playerOf(g,f);return prompt(playerStatus(pl)+' להגשת הצעה הקישו אחת',{allowed:'1'});}
    return prompt('להצעה הקישו אחת. לקלף חבר\'ה הקישו שתיים. למצב אישי הקישו שלוש',{allowed:'123'});
   }
   if(f.step==='friend_select'){
    const g=await loadGame(f.code),pl=playerOf(g,f);if(!g||!pl)return prompt('המשחק אינו זמין');
    const index=Number(answer)-1;
    if(!Number.isInteger(index)||index<0||index>=pl.friends.length)return prompt('בחירת קלף לא תקינה');
    try{const card=game.activateFriend(g,pl.id,index);await saveGame(g);f.step=f.returnStep||'game';return prompt('הפעלתם את קלף '+card.name+'. '+(card.effect==='peek'&&pl.peekedIngredient?'המצרך הבא הוא '+pl.peekedIngredient+'. ':'')+(g.phase==='bidding'?'להגשת הצעה הקישו אחת':'הקלף הופעל'),{allowed:'1'});}
    catch(e){f.step=f.returnStep||'game';return prompt('לא ניתן להפעיל את הקלף כעת: '+e.message+'. הקישו אחת להמשך',{allowed:'1'});}
   }
   if(f.step==='bid'){
    const g=await loadGame(f.code),pl=playerOf(g,f);if(!g||!pl){f.step='menu';return prompt('המשחק אינו זמין');}
    const amount=Number(answer);
    try{game.submitSecretBid(g,pl.id,amount);log('auction.bid_submitted',{gameCode:g.code,playerId:pl.id,phase:g.phase,bidCount:Object.keys(g.bids).length,totalPlayers:g.players.length});}catch(e){return prompt('הצעה לא תקינה. יש להקיש סכום שניתן לשלם באמצעות קלפי הכסף שבידכם',{max:2,min:1,timeout:25});}
    runBots(g);await saveGame(g);f.step='game';
    return pause('ההצעה נקלטה ונשמרה בסתר. ממתינים לשאר השחקנים');
   }
   f.step='menu';f.expect=null;return prompt('חזרתם לתפריט הראשי. למשחק חדש הקישו אחת. להצטרפות הקישו שתיים',{allowed:'12'});
  });
 }catch(e){
  log('request.error',{code:e.code||e.name||'UNKNOWN',message:String(e.message||e).slice(0,240),stack:String(e.stack||'').split('\n').slice(0,4).join(' | ')});
  if(!res.headersSent)response(res,e.code==='HF_CONFLICT'?'id_list_message=t-המשחק עודכן במקביל. אנא הקישו שוב':'id_list_message=t-אירעה שגיאה. נסו שוב');
 }
}
module.exports=handle;
