'use strict';
const hf = require('./hf-storage');
const engine = require('./game');
const crypto = require('node:crypto');

const PREFIX = 'aluf:';
const TTL = 60 * 60 * 8;
const WAIT_SECONDS = 5;
const HOLD = process.env.YEMOT_HOLD_MUSIC || '';

const clean = s => String(s || '').replace(/[.\-]/g, ' ').slice(0, 180);
const say = s => 't-' + clean(s);
const join = xs => xs.filter(Boolean).join('.');
const readParams = (name, {max=1,min=1,timeout=15,style='Number',allowed='',onEmpty=''}={}) =>
  [name,'',max,min,timeout,style,'no','no','',allowed,1,onEmpty,'','','no'].join(',');
const nextName = flow => 'P' + (++flow.seq);
const response = (message, name, opts={}) => `read=${join([say(message)])}=${readParams(name,opts)}`;
const waitResponse = name => `read=${join([HOLD ? 'f-'+HOLD : say('ממתינים לשחקנים')])}=${readParams(name,{timeout:WAIT_SECONDS,style:'NO',max:'',min:'',onEmpty:'Ok'})}`;
async function get(k) { return hf.get(PREFIX+k); }
async function set(k,v,ttl=TTL) { await hf.get(PREFIX+k); return hf.set(PREFIX+k,v,ttl); }
async function loadGame(code) { const v=await get('game:'+code); return v ? JSON.parse(v) : null; }
async function saveGame(g) { await set('game:'+g.code,JSON.stringify(g)); }
async function loadFlow(callId) { const v=await get('flow:'+callId); return v ? JSON.parse(v) : {step:'menu',seq:0}; }
async function saveFlow(callId,f) { await set('flow:'+callId,JSON.stringify(f),60*60*4); }
function input(params, name) { return params[name] === undefined ? null : String(params[name]); }
function code3() { return String(100+crypto.randomInt(900)); }
function makeId() { return crypto.randomBytes(5).toString('hex'); }

async function handler(req,res) {
  res.setHeader('Content-Type','text/plain; charset=utf-8');
  try {
    const p={...(req.query||{}),...(req.body||{})};
    if (p.hangup==='yes') return res.status(200).send('ok');
    const callId=String(p.ApiCallId||p.callId||'unknown');
    await hf.runWithContext(async()=>{
      let f=await loadFlow(callId);
      const reply=(text,opts={})=>{ const n=nextName(f); return saveFlow(callId,f).then(()=>res.status(200).send(response(text,n,opts))); };
      const wait=(text='')=>{ const n=nextName(f); return saveFlow(callId,f).then(()=>res.status(200).send(waitResponse(n))); };
      const answer=input(p,f.expect);
      if (!f.step || f.step==='menu') {
        f={step:'menu',seq:f.seq||0};
        const n=nextName(f); f.expect=n;
        await saveFlow(callId,f);
        return res.status(200).send(response('ברוכים הבאים לאלוף החמין. למשחק חדש הקישו אחת. לכניסה למשחק קיים הקישו שתיים',n,{allowed:'12'}));
      }
      if (f.step==='menu_answer') {}
      if (f.step==='menu') {
        // First menu response is identified by the stored expected parameter.
        if (answer==='1') { f.step='mode'; return reply('למשחק מול שחקנים אמיתיים הקישו אחת. למשחק מול בוטים הקישו שתיים',{allowed:'12'}); }
        if (answer==='2') { f.step='join_code'; return reply('הקישו את קוד המשחק בן שלוש הספרות'); }
        f.step='menu'; return reply('בחירה לא תקינה. להתחלת משחק הקישו אחת. להצטרפות הקישו שתיים',{allowed:'12'});
      }
      if (f.step==='mode') {
        if (answer==='1') { f.mode='human'; f.step='human_count'; return reply('כמה שחקנים ישתתפו במשחק כוללכם? הקישו מספר בין שתיים לחמש',{allowed:'2345'}); }
        if (answer==='2') { f.mode='bots'; f.step='bot_count'; return reply('כמה בוטים ישחקו מולכם? הקישו מספר בין אחת לארבע',{allowed:'1234'}); }
        return reply('בחירה לא תקינה. הקישו אחת או שתיים',{allowed:'12'});
      }
      if (f.step==='human_count') {
        const count=Number(answer);
        if (![2,3,4,5].includes(count)) return reply('מספר שחקנים לא תקין. הקישו מספר בין שתיים לחמש',{allowed:'2345'});
        const code=code3(); const g=engine.newGame(code,count,'human');
        const player=engine.newPlayer(makeId(),''); g.players.push(player); f.gameCode=code; f.playerId=player.id; f.step='name'; f.nameNext='creator';
        await saveGame(g); return reply('נוצר משחק. קוד המשחק שלכם הוא '+code+'. כעת הקלידו את שמכם',{max:'',min:'',style:'HebrewKeyboard',timeout:30});
      }
      if (f.step==='bot_count') {
        const count=Number(answer);
        if (![1,2,3,4].includes(count)) return reply('מספר בוטים לא תקין. הקישו מספר בין אחת לארבע',{allowed:'1234'});
        const g=engine.newGame('B'+makeId().slice(0,7),count+1,'bots');
        const player=engine.newPlayer(makeId(),''); g.players.push(player);
        for(let i=0;i<count;i++) g.players.push(engine.newPlayer('bot'+i,['אופה','קצב','סבתא','שף'][i%4],true));
        f.gameCode=g.code; f.playerId=player.id; f.step='name';
        await saveGame(g); return reply('הקלידו את שמכם',{max:'',min:'',style:'HebrewKeyboard',timeout:30});
      }
      if (f.step==='join_code') {
        const code=String(answer||'').replace(/\D/g,'');
        const g=await loadGame(code);
        if (!g || g.started || g.mode!=='human') { f.step='menu'; return reply('לא נמצא משחק פתוח עם הקוד הזה. חזרו לתפריט הראשי'); }
        if (g.players.length>=g.maxPlayers) { f.step='menu'; return reply('המשחק מלא'); }
        f.gameCode=code; f.playerId=makeId(); f.step='name';
        return reply('הקלידו את שמכם',{max:'',min:'',style:'HebrewKeyboard',timeout:30});
      }
      if (f.step==='name') {
        const name=String(answer||'').trim().slice(0,24);
        if (!name) return reply('לא התקבל שם. הקלידו את שמכם',{max:'',min:'',style:'HebrewKeyboard',timeout:30});
        const g=await loadGame(f.gameCode);
        if (!g) { f.step='menu'; return reply('המשחק לא נמצא. חזרו לתפריט הראשי'); }
        let player=g.players.find(x=>x.id===f.playerId);
        if (!player) { player=engine.newPlayer(f.playerId,name); g.players.push(player); }
        player.name=name;
        await saveGame(g);
        f.step='lobby';
        if (g.mode==='bots') { engine.startGame(g); await saveGame(g); f.step='turn_menu'; return reply('המשחק מול הבוטים מתחיל. '+player.name+', זה תורך. לפתיחת קלף שוק הקישו אחת. למצב אישי הקישו שתיים',{allowed:'12'}); }
        return wait('נרשמתם למשחק. ממתינים לשאר השחקנים');
      }
      if (f.step==='lobby') {
        const g=await loadGame(f.gameCode);
        if (!g) { f.step='menu'; return reply('המשחק לא נמצא'); }
        if (!g.started && g.players.length===g.maxPlayers) { engine.startGame(g); await saveGame(g); f.step='turn_menu'; return reply('כל השחקנים הצטרפו. המשחק מתחיל. לפתיחת קלף שוק הקישו אחת',{allowed:'1'}); }
        return wait();
      }
      if (f.step==='turn_menu') {
        const g=await loadGame(f.gameCode); if(!g) {f.step='menu';return reply('המשחק הסתיים או לא נמצא');}
        const player=g.players.find(x=>x.id===f.playerId);
        if (g.over) {f.step='menu';return reply('המשחק הסתיים. המנצח הוא '+(g.players.find(x=>x.id===g.winner)?.name||'לא ידוע'));}
        if (answer==='2') return reply('המתכון שלכם הוא '+player.recipe.name+'. אספתם '+engine.recipeProgress(player)+' מתוך '+player.recipe.ingredients.length+' מצרכים. יש לכם '+engine.coinTotal(player)+' זוזים. להמשך הקישו אחת',{allowed:'1'});
        if (answer==='1' && g.players[g.turn].id===player.id) {
          engine.openMarket(g); await saveGame(g); f.step='bid';
          return reply('קלף השוק: '+g.marketCard.name+'. '+g.marketCard.description+'. נפתחו המצרכים: '+g.marketIngredients.join(', ')+'. מתחיל המכרז. הקישו סכום הצעה בזוזים עבור '+g.marketIngredients[0],{max:2,min:1,timeout:20});
        }
        return reply('עדיין לא תורך או בחירה לא תקינה. הקישו אחת לפתיחת קלף שוק או שתיים למצב אישי',{allowed:'12'});
      }
      if (f.step==='bid') {
        const g=await loadGame(f.gameCode); const player=g&&g.players.find(x=>x.id===f.playerId);
        if(!g||!player) {f.step='menu';return reply('המשחק לא נמצא');}
        const amount=Number(answer);
        try { engine.submitBid(g,player.id,amount); } catch(e) { return reply('הצעה לא תקינה או שאין מספיק זוזים. הקישו הצעה מחדש',{max:2,min:1,timeout:20}); }
        await saveGame(g);
        f.step='turn_menu';
        return reply('ההצעה נקלטה. '+(g.over?'המשחק הסתיים. המנצח הוא '+player.name:'המכרז הסתיים או ממתין להצעות. למצב אישי הקישו שתיים. להמשך הקישו אחת'),{allowed:'12'});
      }
      f.step='menu'; return reply('חזרתם לתפריט הראשי. למשחק חדש הקישו אחת. להצטרפות הקישו שתיים',{allowed:'12'});
    });
  } catch(e) {
    console.error(JSON.stringify({service:'aluf-hachamin-ivr',event:'request_error',message:String(e.message||e).slice(0,180)}));
    if(!res.headersSent) res.status(200).send('id_list_message=t-אירעה שגיאה. נסו שוב מאוחר יותר');
  }
}
module.exports=handler;
