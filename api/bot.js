'use strict';
const game=require('./game');
function decideBid(g,p){
 const ingredient=g.marketIngredients[g.ingredientIndex];
 const missing=p.recipe.ingredients.filter(x=>!p.ingredients.includes(x));
 const urgent=missing.includes(ingredient);
 const wealth=game.coinTotal(p);
 const target=Math.min(wealth,urgent?Math.max(3,Math.ceil(wealth*.55)):Math.ceil(wealth*.2));
 let best=0;
 for(let n=0;n<=target;n++)if(game.findPayment(p.coins,n))best=n;
 return best;
}
function chooseFriend(g,p){
 const cards=p.friends.map((id,index)=>({index,card:game.data.friendCards.find(c=>c.id===id)})).filter(x=>x.card);
 const rank=c=>c.effect==='coins'&&game.coinTotal(p)<5?9:c.effect==='draw'?5:c.effect==='protect'?4:0;
 cards.sort((a,b)=>rank(b.card)-rank(a.card));
 return cards.length&&rank(cards[0].card)>=5?cards[0].index:-1;
}
function playBot(g,p){
 if(g.phase!=='bidding'||Object.prototype.hasOwnProperty.call(g.bids,p.id))return;
 const amount=decideBid(g,p);
 game.submitSecretBid(g,p.id,amount);
}
module.exports={decideBid,chooseFriend,playBot};
