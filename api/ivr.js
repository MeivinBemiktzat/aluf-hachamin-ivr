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
const code=()=>String(100+crypto.randomInt(900));
const key=(type,value)=>PREFIX+type+':'+value;
async function load(k){const x=await hf.get(k);return x?JSON.parse(x):null;}
async function save(k,v,ttl=TTL){await hf.set(k,JSON.stringify(v),ttl);}
const gameKey=c=>key('game',c),flowKey=c=>key('flow',c);
async function loadGame(c){return load(gameKey(c));}
async function saveGame(g){return save(gameKey(g.code),g);}
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
  if(!callId)return response(res,'id_list_message=t-מזהה שיחה חסר');
  await hf.runWithContext(async()=>{
   let f=await loadFlow(callId);
   if(f.step==='menu'&&!f.expect&&p.ApiPhone){const ref=await load(phoneKey(p.ApiPhone));if(ref){const oldGame=await loadGame(ref.code);if(oldGame&&oldGame.started&&!oldGame.over&&playerOf(oldGame,{playerId:ref.playerId})){f={step:'game',seq:f.seq||0,code:ref.code,playerId:ref.playerId};}}}
   const answer=getInput(p,f);
   const send=async(body)=>{await saveFlow(callId,f);response(res,body);};
   const prompt=(text,o)=>send(read(f,text,o));
   const pause=(text)=>send(wait(f,text));
   if(f.step==='menu'){
    if(!f.expect||answer===''){
     return prompt('ברוכים הבאים לאלוף החמין. למשחק חדש הקישו אחת. לכניסה למשחק קיים הקישו שתיים',{allowed:'12'});
    }
    if(answer==='1'){f.step='mode';return prompt('למשחק מול שחקנים אמיתיים הקישו אחת. למשחק מול בוטים הקישו שתיים',{allowed:'12'});}
    if(answer==='2'){f.step='join_code';return prompt('הקישו את קוד המשחק בן שלוש הספרות',{min:3,max:3,style:'Digits'});}
    f.expect=null;return prompt('בחירה לא תקינה. למשחק חדש הקישו אחת. להצטרפות הקישו שתיים',{allowed:'12'});
   }
   if(f.step==='mode'){
    if(answer==='1'){f.mode='human';f.step='human_count';return prompt('כמה שחקנים ישתתפו במשחק כוללכם? הקישו מספר בין שתיים לחמש',{allowed:'2345'});}
    if(answer==='2'){f.mode='bots';f.step='bot_count';return prompt('כמה בוטים ישחקו מולכם? הקישו מספר בין אחת לארבע',{allowed:'1234'});}
    return prompt('הקישו אחת למשחק אנושי או שתיים למשחק מול בוטים',{allowed:'12'});
   }
   if(f.step==='human_count'){
    const count=Number(answer);if(![2,3,4,5].includes(count))return prompt('מספר לא תקין. הקישו בין שתיים לחמש',{allowed:'2345'});
    const c=code(),g=game.newGame(c,count,'human'),pl=game.newPlayer(id(),'');
    g.players.push(pl);await loadGame(c);await loadGame(c);await saveGame(g);f.code=c;f.playerId=pl.id;f.step='name';
    return prompt('קוד המשחק שלכם '+c+'. הקלידו כעת את שמכם',{max:'',min:'',style:'HebrewKeyboard',timeout:30});
   }
   if(f.step==='bot_count'){
    const count=Number(answer);if(![1,2,3,4].includes(count))return prompt('מספר בוטים לא תקין. הקישו בין אחת לארבע',{allowed:'1234'});
    const c='B'+id().slice(0,7),g=game.newGame(c,count+1,'bots'),pl=game.newPlayer(id(),'');
    g.players.push(pl);for(let i=0;i<count;i++)g.players.push(game.newPlayer('bot'+i,['האופה','הקצב','הסוחר','השף'][i],true));
    await saveGame(g);f.code=c;f.playerId=pl.id;f.step='name';
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
    if(!g.started&&g.players.length===g.maxPlayers){game.startGame(g);await saveGame(g);f.step='game';return prompt('כל השחקנים הצטרפו והמשחק מתחיל. '+playerStatus(playerOf(g,f))+' הקישו אחת להמשך',{allowed:'1'});}
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
     runBots(g);
     if(g.bidDeadline&&Date.now()>g.bidDeadline){for(const missing of g.players)if(!Object.prototype.hasOwnProperty.call(g.bids,missing.id))g.bids[missing.id]={amount:0,cards:[],submittedAt:Date.now(),auto:true};game.addLog(g,'הצעות חסרות הושלמו אוטומטית באפס זוזים');}
     if(Object.keys(g.bids).length===g.players.length){
      const result=game.revealAuction(g);
      if(result.pending){await saveGame(g);if(g.players[g.turn].id!==pl.id)return pause('יש תיקו במכרז. ממתינים להכרעת '+g.players[g.turn].name);const options=g.tieCandidates.map((pid,i)=>(i+1)+' עבור '+g.players.find(x=>x.id===pid).name).join('. ');return prompt('יש תיקו על המצרך '+g.tieIngredient+'. '+options+'. הקישו את מספר השחקן שיזכה',{allowed:g.tieCandidates.map((_,i)=>String(i+1)).join('')});}
      if(g.over){await saveGame(g);return prompt('המשחק הסתיים. המנצח '+g.players.find(x=>x.id===g.winner).name);}
      await saveGame(g);
      return prompt('המכרז הסתיים. '+(result.winnerId?'המצרך זכה על ידי '+g.players.find(x=>x.id===result.winnerId).name:'לא היה זוכה')+'. '+(g.phase==='bidding'?'המצרך הבא '+g.marketIngredients[g.ingredientIndex]+'.':'התור הבא')+'. הקישו אחת להמשך',{allowed:'1'});
     }
     const waiting=nextHuman(g);
     if(waiting&&waiting.id!==pl.id)return pause('ממתינים להצעה הסודית של '+waiting.name);
     if(!Object.prototype.hasOwnProperty.call(g.bids,pl.id)){
      f.step='bid_menu';await saveGame(g);
      return prompt('המכרז על '+g.marketIngredients[g.ingredientIndex]+'. להגשת הצעה הקישו אחת. להפעלת קלף חבר\'ה הקישו שתיים. למצב אישי הקישו שלוש',{allowed:'123'});
     }
     await saveGame(g);return pause('ההצעה שלכם נקלטה בסתר. ממתינים לשאר השחקנים');
    }
    if(g.phase==='turn'){
     if(g.turnDeadline&&Date.now()>g.turnDeadline){const skipped=g.players[g.turn];game.nextTurn(g);game.addLog(g,skipped.name+' לא פעל בזמן והתור עבר אוטומטית');await saveGame(g);return pause('התור הקודם דולג עקב חוסר פעילות. כעת תור '+g.players[g.turn].name);}
     if(g.players[g.turn].id!==pl.id)return pause('כעת תור '+g.players[g.turn].name+'. '+playerStatus(pl));
     if(answer==='2')return prompt(playerStatus(pl)+' הקישו אחת לחזרה',{allowed:'1'});
     if(answer==='3'){if(!pl.ingredients.length)return prompt('אין לכם מצרכים למכירה. לפתיחת קלף שוק הקישו אחת',{allowed:'1'});f.step='sell_select';return prompt('המצרכים שלכם: '+pl.ingredients.map((x,i)=>(i+1)+' '+x).join('. ')+'. הקישו את מספר המצרך למכירה',{allowed:pl.ingredients.map((_,i)=>String(i+1)).join('')});}
     if(answer==='1'){
      game.openMarket(g);runBots(g);await saveGame(g);f.step='game';
      return prompt(marketSummary(g)+'. '+playerStatus(pl)+' הקישו אחת להמשך למכרז',{allowed:'1'});
     }
     return prompt('לפתיחת קלף שוק הקישו אחת. למצב אישי הקישו שתיים. למכירת מצרך הקישו שלוש',{allowed:'123'});
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
    try{const card=game.activateFriend(g,pl.id,index);await saveGame(g);f.step='game';return prompt('הפעלתם את קלף '+card.name+'. '+(g.phase==='bidding'?'להגשת הצעה הקישו אחת':'הקלף הופעל'),{allowed:'1'});}
    catch(e){f.step='bid_menu';return prompt('לא ניתן להפעיל את הקלף כעת: '+e.message+'. להגשת הצעה הקישו אחת',{allowed:'1'});}
   }
   if(f.step==='bid'){
    const g=await loadGame(f.code),pl=playerOf(g,f);if(!g||!pl){f.step='menu';return prompt('המשחק אינו זמין');}
    const amount=Number(answer);
    try{game.submitSecretBid(g,pl.id,amount);}catch(e){return prompt('הצעה לא תקינה. יש להקיש סכום שניתן לשלם באמצעות קלפי הכסף שבידכם',{max:2,min:1,timeout:25});}
    runBots(g);await saveGame(g);f.step='game';
    return pause('ההצעה נקלטה ונשמרה בסתר. ממתינים לשאר השחקנים');
   }
   f.step='menu';f.expect=null;return prompt('חזרתם לתפריט הראשי. למשחק חדש הקישו אחת. להצטרפות הקישו שתיים',{allowed:'12'});
  });
 }catch(e){
  console.error(JSON.stringify({service:'aluf-hachamin-ivr',event:'error',message:String(e.message||e).slice(0,160)}));
  if(!res.headersSent)response(res,'id_list_message=t-אירעה שגיאה. נסו שוב');
 }
}
module.exports=handle;
