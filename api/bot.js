'use strict';
const game=require('./game');
const data=game.data;
function decideBid(g,p){
 const ingredient=g.marketIngredients[g.ingredientIndex];
 const missing=p.recipe.ingredients.filter(x=>!p.ingredients.includes(x));
 const urgent=missing.includes(ingredient);
 const wealth=game.coinTotal(p);
 const desired=Math.min(wealth,urgent?Math.max(3,Math.ceil(wealth*.55)):Math.ceil(wealth*.2));
 const possible=[];for(let n=0;n<=desired;n++)if(game.findPayment(p.coins,n))possible.push(n);
 return possible.length?possible[possible.length-1]:0;
}
function chooseFriend(g,p){
 let best={index:-1,score:0};
 p.friends.forEach((id,index)=>{
  const c=data.friendCards.find(x=>x.id===id);if(!c)return;
  let score=0;
  if(['coins','take_two_money'].includes(c.effect))score=game.coinTotal(p)<5?9:2;
  if(['boost','double_one','steal_bid'].includes(c.effect))score=g.phase==='bidding'?8:0;
  if(c.effect==='extra_ingredient')score=p.ingredients.length<5?7:0;
  if(c.effect==='draw')score=5;
  if(c.effect==='protect')score=4;
  if(score>best.score)best={index,score};
 });
 return best.index;
}
function playBot(g,p){
 const index=chooseFriend(g,p);
 if(index>=0){try{game.activateFriend(g,p.id,index);}catch{}}
 if(g.phase==='bidding'&&!Object.prototype.hasOwnProperty.call(g.bids,p.id)){
  game.submitSecretBid(g,p.id,decideBid(g,p));
 }
}
module.exports={decideBid,chooseFriend,playBot};
