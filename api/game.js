'use strict';
const data = require('./game-data.json');
const crypto = require('node:crypto');

const rand = n => crypto.randomInt(n);
const pick = a => a[rand(a.length)];
const clone = x => JSON.parse(JSON.stringify(x));
const addLog = (g,t) => { g.log.push({at:Date.now(),text:t}); if(g.log.length>100)g.log.shift(); };
const moneyCard = () => 1 + rand(4);
const cardById = id => data.friendCards.find(c=>c.id===id);

function newPlayer(id,name,isBot=false){
 return {id,name,isBot,recipe:null,ingredients:[],coins:[],friends:[],protections:0,nextBidBonus:0,nextBidDiscount:0,disconnectedAt:null,joinedAt:Date.now(),lastSeenLog:0};
}
function newGame(code,maxPlayers,mode){
 return {version:2,code,createdAt:Date.now(),mode,maxPlayers,started:false,over:false,players:[],turn:0,round:0,marketCard:null,marketIngredients:[],ingredientIndex:0,phase:'lobby',bids:{},bidOrder:[],tieCandidates:[],tieChoice:null,turnDeadline:0,log:[],winner:null,discard:{money:[],friends:[],market:[],ingredients:[]},deck:{market:[],friends:[],ingredients:[]},pendingEffects:[]};
}
function refillDeck(g,type){
 const source=type==='market'?data.marketCards:type==='friends'?data.friendCards:data.ingredients.map((name,i)=>({id:'ingredient_'+i,name}));
 const discard=g.discard[type]||[];
 const items=discard.length?discard.splice(0):source.map(x=>clone(x));
 for(let i=items.length-1;i>0;i--){const j=rand(i+1);[items[i],items[j]]=[items[j],items[i]];}
 g.deck[type]=items;
}
function draw(g,type){
 if(!g.deck[type]||!g.deck[type].length)refillDeck(g,type);
 return g.deck[type].pop();
}
function assignRecipes(g){
 const recipes=[...data.recipes];
 for(let i=recipes.length-1;i>0;i--){const j=rand(i+1);[recipes[i],recipes[j]]=[recipes[j],recipes[i]];}
 // neutral random dealing; no player choice
 g.players.forEach((p,i)=>p.recipe=clone(recipes[i%recipes.length]));
}
function giveMoney(p,n){for(let i=0;i<n;i++)p.coins.push(moneyCard());}
function giveFriend(g,p){const c=draw(g,'friends');p.friends.push(c.id);return c;}
function startGame(g){
 if(g.started||g.players.length<2||g.players.length>5)throw Error('מספר שחקנים או מצב משחק לא תקין');
 assignRecipes(g);
 for(const p of g.players){giveMoney(p,4);giveFriend(g,p);}
 g.started=true;g.phase='turn';g.turn=0;g.round=1;beginTurn(g);
 addLog(g,'המשחק התחיל');
}
function beginTurn(g){
 g.phase='turn';g.marketCard=null;g.marketIngredients=[];g.ingredientIndex=0;g.bids={};g.bidOrder=[];g.tieCandidates=[];g.tieChoice=null;g.pendingEffects=[];
 g.turnDeadline=Date.now()+120000;
}
function currentPlayer(g){return g.players[g.turn];}
function ingredientName(x){return typeof x==='string'?x:x.name;}
function openMarket(g){
 if(!g.started||g.over||g.phase!=='turn')throw Error('לא ניתן לפתוח קלף שוק כעת');
 const card=draw(g,'market');g.marketCard=card;g.discard.market.push(card);
 applyMarketEffect(g,card);
 const count=card.ingredientCount||1;
 g.marketIngredients=Array.from({length:count},()=>ingredientName(draw(g,'ingredients')));
 // Automatic assistance: if a player has no money when the market opens,
 // grant one random 1-4 zuz card per ingredient opened, except a card-specific
 // effect can define a different rule.
 for(const p of g.players)if(p.coins.length===0)giveMoney(p,count);
 g.phase='bidding';g.ingredientIndex=0;startAuction(g);
 addLog(g,'קלף השוק: '+card.name+'. נפתחו '+count+' מצרכים');
 return card;
}
function applyMarketEffect(g,c){
 switch(c.effect){
  case 'draw_friend_all': for(const p of g.players)giveFriend(g,p);break;
  case 'money_all': for(const p of g.players)giveMoney(p,1);break;
  case 'coin_all': for(const p of g.players)p.coins.push(1);break;
  case 'double_money_all': for(const p of g.players)giveMoney(p,2);break;
  case 'steal_one_coin': {
   const p=currentPlayer(g);
   for(const other of g.players)if(other!==p&&other.coins.length){p.coins.push(other.coins.splice(rand(other.coins.length),1)[0]);break;}
   break;
  }
  case 'none': default: break;
 }
}
function startAuction(g){
 g.bids={};g.bidOrder=g.players.filter(p=>!p.isBot).map(p=>p.id);
 g.tieCandidates=[];g.tieChoice=null;g.phase='bidding';
}
function coinTotal(p){return p.coins.reduce((a,b)=>a+b,0);}
function findPayment(cards,amount){
 if(amount===0)return [];
 const dp=new Map([[0,[]]]);
 for(let i=0;i<cards.length;i++){
  for(const [sum,idxs] of [...dp.entries()].sort((a,b)=>b[0]-a[0])){
   const next=sum+cards[i];
   if(next<=amount&&!dp.has(next))dp.set(next,[...idxs,i]);
  }
 }
 return dp.get(amount)||null;
}
function spendExact(p,amount){
 const indices=findPayment(p.coins,amount);
 if(!indices)throw Error('אין צירוף קלפי כסף מדויק לסכום ההצעה');
 const used=new Set(indices);
 const removed=p.coins.filter((_,i)=>used.has(i));
 p.coins=p.coins.filter((_,i)=>!used.has(i));
 return removed;
}
function submitSecretBid(g,playerId,amount){
 if(g.phase!=='bidding')throw Error('אין מכרז פעיל');
 const p=g.players.find(x=>x.id===playerId);
 if(!p)throw Error('שחקן לא נמצא');
 if(Object.prototype.hasOwnProperty.call(g.bids,playerId))throw Error('כבר הוגשה הצעה');
 if(!Number.isInteger(amount)||amount<0||amount>coinTotal(p))throw Error('הצעה לא תקינה');
 const cards=spendExact(p,amount);
 const finalAmount=Math.max(0,amount+(p.nextBidBonus||0)-(p.nextBidDiscount||0));p.nextBidBonus=0;p.nextBidDiscount=0;
 g.bids[playerId]={amount:finalAmount,cards,submittedAt:Date.now()};
 addLog(g,p.isBot?'הבוט הגיש הצעה':'הוגשה הצעה חסויה');
 return Object.keys(g.bids).length===g.players.length;
}
function settleIngredient(g,winnerId,high,tie){
 const ingredient=g.marketIngredients[g.ingredientIndex];
 const winner=g.players.find(p=>p.id===winnerId);
 if(winner){winner.ingredients.push(ingredient);addLog(g,winner.name+' זכה במצרך');}
 const result={winnerId:winner?winner.id:null,high,ingredient,tie};
 g.ingredientIndex++;g.bids={};g.tieCandidates=[];g.tieChoice=null;g.tieHigh=null;g.tieIngredient=null;g.lowestWins=false;
 if(g.ingredientIndex>=g.marketIngredients.length)finishMarket(g);else startAuction(g);
 return result;
}
function revealAuction(g,tieWinnerId){
 if(g.phase!=='bidding'||Object.keys(g.bids).length!==g.players.length)throw Error('עדיין חסרות הצעות');
 const entries=g.players.map(p=>({id:p.id,amount:g.bids[p.id].amount}));
 const high=g.lowestWins?Math.min(...entries.map(x=>x.amount)):Math.max(...entries.map(x=>x.amount));
 const candidates=entries.filter(x=>x.amount===high);
 // All committed money cards go to the discard/charity pile, including losing bids.
 for(const p of g.players){const bid=g.bids[p.id];g.discard.money.push(...bid.cards);}
 if(candidates.length>1&&!tieWinnerId){
  g.tieCandidates=candidates.map(x=>x.id);g.tieHigh=high;g.tieIngredient=g.marketIngredients[g.ingredientIndex];g.phase='tie';
  addLog(g,'יש תיקו במכרז. ממתינים להכרעת השחקן שתורו');
  return {tie:true,pending:true,high,ingredient:g.tieIngredient,candidates:g.tieCandidates};
 }
 let winnerId;
 if(tieWinnerId&&candidates.some(x=>x.id===tieWinnerId))winnerId=tieWinnerId;
 else if(candidates.length>1&&candidates.some(x=>x.id===currentPlayer(g).id))winnerId=currentPlayer(g).id;
 else winnerId=candidates[0].id;
 return settleIngredient(g,winnerId,high,candidates.length>1);
}
function resolveTie(g,winnerId){
 if(g.phase!=='tie'||!g.tieCandidates.includes(winnerId))throw Error('בחירת שובר שוויון לא תקינה');
 return settleIngredient(g,winnerId,g.tieHigh,true);
}
function finishMarket(g){
 const winner=g.players.find(p=>p.recipe.ingredients.every(i=>p.ingredients.includes(i)));
 if(winner){g.over=true;g.phase='over';g.winner=winner.id;addLog(g,winner.name+' השלים את המתכון וניצח');return;}
 g.turn=(g.turn+1)%g.players.length;g.round++;beginTurn(g);
}
function drawFriend(g,p){return giveFriend(g,p);}
function activateFriend(g,playerId,cardIndex,targetId){
 const p=g.players.find(x=>x.id===playerId);
 if(!p||!Number.isInteger(cardIndex)||cardIndex<0||cardIndex>=p.friends.length)throw Error('קלף חבר\'ה לא נמצא');
 const id=p.friends[cardIndex],card=cardById(id);
 if(!card)throw Error('קלף לא מוכר');
 if(card.timing==='auction'&&g.phase!=='bidding')throw Error('הקלף זמין רק במכרז');
 if(card.timing==='reaction'&&!['bidding','tie'].includes(g.phase))throw Error('הקלף אינו זמין כעת');
 p.friends.splice(cardIndex,1);g.discard.friends.push(id);
 const target=g.players.find(x=>x.id===targetId);
 const bid=g.bids[playerId];
 switch(card.effect){
  case 'coins': giveMoney(p,card.value||1);break;
  case 'draw': drawFriend(g,p);break;
  case 'peek': p.peekedIngredient=g.marketIngredients[g.ingredientIndex]||null;break;
  case 'boost': if(bid)bid.amount+=card.value||1;else p.nextBidBonus=(p.nextBidBonus||0)+(card.value||1);break;
  case 'discount': if(bid)bid.amount=Math.max(0,bid.amount-(card.value||1));else p.nextBidDiscount=(p.nextBidDiscount||0)+(card.value||1);break;
  case 'protect': p.protections++;break;
  case 'replace': if(p.friends.length){p.friends.splice(rand(p.friends.length),1);drawFriend(g,p);}break;
  case 'take_money': if(!target||!target.coins.length)throw Error('אין לשחקן היעד כסף לקחת');p.coins.push(target.coins.splice(rand(target.coins.length),1)[0]);break;
  case 'steal_bid': if(!target||!g.bids[target.id])throw Error('לשחקן היעד אין הצעה');bid.amount+=g.bids[target.id].amount;break;
  case 'double_one': if(!bid)throw Error('אין הצעה פעילה');bid.amount+=Math.max(1,card.value||1);break;
  case 'cancel_last': if(!g.pendingEffects.length)throw Error('אין השפעה לבטל');g.pendingEffects.pop();break;
  case 'force_zero': if(!target||!g.bids[target.id])throw Error('אין הצעה לבטל');g.bids[target.id].amount=0;break;
  case 'lowest_wins': g.lowestWins=true;break;
  case 'take_back_bid': if(!bid)throw Error('אין הצעה להחזיר');p.coins.push(...bid.cards);bid.cards=[];bid.amount=0;break;
  case 'protect_bid': if(!target)throw Error('שחקן יעד חסר');target.protections++;break;
  case 'exchange_bid': if(!target||!g.bids[target.id]||!bid)throw Error('אין שתי הצעות להחליף');[bid.amount,g.bids[target.id].amount]=[g.bids[target.id].amount,bid.amount];break;
  case 'discard_highest': if(!target||!target.coins.length)throw Error('ליעד אין כסף');target.coins.sort((a,b)=>b-a);g.discard.money.push(target.coins.shift());break;
  case 'modify_bid': if(!target||!g.bids[target.id])throw Error('אין הצעה לשנות');g.bids[target.id].amount=Math.max(0,g.bids[target.id].amount+(card.value||0));break;
  case 'steal_card': if(!target)throw Error('שחקן יעד חסר');if(target.friends.length)p.friends.push(target.friends.splice(rand(target.friends.length),1)[0]);else if(target.coins.length)p.coins.push(target.coins.splice(rand(target.coins.length),1)[0]);else throw Error('אין מה לקחת');break;
  case 'retrieve': if(!g.discard.friends.length)throw Error('אין קלף חבר\'ה בערימת המשומשים');p.friends.push(g.discard.friends.pop());break;
  case 'extra_ingredient': if(p.ingredients.length>=6)throw Error('שחקן עם שישה מצרכים חייב לזכות במצרך האחרון במכרז');p.ingredients.push(pick(data.ingredients));break;
  case 'reduce_all': if(!target||!g.bids[target.id])throw Error('אין הצעה להפחית');g.bids[target.id].amount=Math.max(0,g.bids[target.id].amount-2);break;
  case 'zero_all': if(!target||!g.bids[target.id])throw Error('אין הצעה לאפס');g.bids[target.id].amount=0;break;
  case 'take_two_money': giveMoney(p,2);break;
  default: throw Error('השפעת קלף לא מומשה: '+card.effect);
 }
 g.pendingEffects.push({card:id,playerId,targetId,at:Date.now()});
 addLog(g,p.name+' הפעיל קלף חבר\'ה: '+card.name);
 return card;
}
function sellIngredient(p,index,g,enhanced=false){
 if(!Number.isInteger(index)||!p.ingredients[index])throw Error('מצרך לא נמצא');
 p.ingredients.splice(index,1);giveMoney(p,enhanced?4:2);return enhanced?4:2;
}
function recipeProgress(p){return p.recipe?p.recipe.ingredients.filter(x=>p.ingredients.includes(x)).length:0;}
function autoMoneyIfEmpty(g){for(const p of g.players)if(!p.coins.length)giveMoney(p,g.marketIngredients.length);}
function nextTurn(g){if(g.over)return null;g.turn=(g.turn+1)%g.players.length;g.round++;beginTurn(g);return currentPlayer(g);}
module.exports={data,newPlayer,newGame,startGame,beginTurn,openMarket,currentPlayer,coinTotal,submitSecretBid,revealAuction,resolveTie,activateFriend,drawFriend,sellIngredient,recipeProgress,addLog,moneyCard,giveMoney,findPayment,spendExact,nextTurn};
