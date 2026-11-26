'use strict';
const data = require('./game-data.json');

const rand = n => Math.floor(Math.random() * n);
const pick = arr => arr[rand(arr.length)];
const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);
const moneyCard = () => 1 + rand(4);
const addLog = (game, text) => {
  game.log.push(text);
  if (game.log.length > 80) game.log.shift();
};

function newPlayer(id, name, isBot = false) {
  return {
    id, name, isBot, recipe: null, ingredients: [], coins: [],
    friends: [], lastBid: 0, lastSeenLog: 0, bankrupt: false
  };
}
function newGame(code, maxPlayers, mode) {
  return {
    code, createdAt: Date.now(), mode, maxPlayers, started: false, over: false,
    players: [], turn: 0, round: 0, marketCard: null, marketIngredients: [],
    ingredientIndex: 0, bidderIndex: 0, bids: {}, phase: 'lobby',
    log: [], winner: null
  };
}
function assignRecipe(game, player) {
  // Recipe assignment is random and neutral; no player chooses a recipe.
  const used = new Set(game.players.filter(p => p.recipe).map(p => p.recipe.id));
  const available = data.recipes.filter(r => !used.has(r.id));
  const recipe = pick(available.length ? available : data.recipes);
  player.recipe = JSON.parse(JSON.stringify(recipe));
}
function giveInitialCards(player) {
  player.coins = Array.from({length:4}, moneyCard);
  player.friends = [pick(data.friendCards).id];
}
function startGame(game) {
  game.players.forEach(p => {
    if (!p.recipe) assignRecipe(game, p);
    if (!p.coins.length) giveInitialCards(p);
  });
  game.started = true;
  game.phase = 'turn';
  game.turn = 0;
  game.round = 0;
  beginTurn(game);
  addLog(game, 'המשחק התחיל!');
}
function currentPlayer(game) { return game.players[game.turn]; }
function beginTurn(game) {
  game.phase = 'turn';
  game.marketCard = null;
  game.marketIngredients = [];
  game.ingredientIndex = 0;
  game.bidderIndex = 0;
  game.bids = {};
}
function openMarket(game) {
  game.marketCard = pick(data.marketCards);
  const card = game.marketCard;
  if (card.effect === 'draw_friend_all') {
    game.players.forEach(p => p.friends.push(pick(data.friendCards).id));
  } else if (card.effect === 'money_all') {
    game.players.forEach(p => p.coins.push(moneyCard()));
  } else if (card.effect === 'coin_all') {
    game.players.forEach(p => p.coins.push(1));
  }
  game.marketIngredients = Array.from({length:card.ingredientCount}, () => pick(data.ingredients));
  game.phase = 'bidding';
  game.ingredientIndex = 0;
  game.bidderIndex = 0;
  game.bids = {};
}
function coinTotal(player) { return player.coins.reduce((a,b) => a+b, 0); }
function awardIngredient(game) {
  const entries = Object.entries(game.bids).map(([id, amount]) => ({id, amount}));
  entries.sort((a,b) => b.amount - a.amount);
  const winning = entries[0];
  if (winning && winning.amount > 0) {
    const player = game.players.find(p => p.id === winning.id);
    player.ingredients.push(game.marketIngredients[game.ingredientIndex]);
    addLog(game, player.name + ' זכה במצרך ' + game.marketIngredients[game.ingredientIndex]);
  } else {
    addLog(game, 'המצרך ' + game.marketIngredients[game.ingredientIndex] + ' לא נקנה');
  }
  game.ingredientIndex++;
  game.bidderIndex = 0;
  game.bids = {};
  if (game.ingredientIndex >= game.marketIngredients.length) {
    const winner = game.players.find(p => p.recipe.ingredients.every(i => p.ingredients.includes(i)));
    if (winner) {
      game.over = true; game.phase = 'over'; game.winner = winner.id;
      addLog(game, winner.name + ' השלים את המתכון וניצח!');
    } else {
      game.turn = (game.turn + 1) % game.players.length;
      game.round++;
      beginTurn(game);
    }
  }
}
function submitBid(game, playerId, amount) {
  const player = game.players.find(p => p.id === playerId);
  if (!player || game.phase !== 'bidding') throw new Error('לא ניתן להגיש הצעה כרגע');
  if (!Number.isInteger(amount) || amount < 0 || amount > coinTotal(player)) throw new Error('סכום הצעה לא תקין');
  if (game.bids[playerId] !== undefined) throw new Error('כבר הוגשה הצעה');
  player.coins = spendCoins(player.coins, amount);
  game.bids[playerId] = amount;
  game.bidderIndex++;
  if (game.bidderIndex >= game.players.length) awardIngredient(game);
}
function spendCoins(cards, amount) {
  // Exact change is not required: the bid consumes the requested number of
  // zוזים from the player's total wallet, represented by 1-4 value cards.
  let left = amount;
  const result = [...cards].sort((a,b) => a-b);
  while (left > 0 && result.length) {
    const value = result.pop();
    if (value <= left) left -= value;
    else {
      left = 0;
    }
  }
  return result;
}
function addRandomMoney(player, count) {
  for (let i=0;i<count;i++) player.coins.push(moneyCard());
}
function activateFriend(game, playerId, cardIndex) {
  const player = game.players.find(p => p.id === playerId);
  if (!player || !Number.isInteger(cardIndex) || !player.friends[cardIndex]) throw new Error('קלף חבר\'ה לא נמצא');
  const id = player.friends.splice(cardIndex,1)[0];
  const card = data.friendCards.find(c => c.id === id);
  if (!card) throw new Error('קלף לא מוכר');
  if (card.effect === 'coins') for (let i=0;i<card.value;i++) player.coins.push(1);
  if (card.effect === 'draw') player.friends.push(pick(data.friendCards).id);
  if (card.effect === 'replace') player.friends.push(pick(data.friendCards).id);
  if (card.effect === 'boost' && game.phase === 'bidding') player.coins.push(card.value);
  if (card.effect === 'discount' && game.phase === 'bidding') player.coins.push(card.value);
  if (card.effect === 'protect') player.friends.push('protection');
  addLog(game, player.name + ' הפעיל את קלף ' + card.name);
  return card;
}
function recipeProgress(player) {
  const have = new Set(player.ingredients);
  return player.recipe.ingredients.filter(i => have.has(i)).length;
}
function nextPlayer(game) {
  const p = currentPlayer(game);
  return p;
}
module.exports = {
  data, newPlayer, newGame, startGame, beginTurn, openMarket, currentPlayer,
  coinTotal, submitBid, addRandomMoney, activateFriend, recipeProgress,
  addLog, nextPlayer, moneyCard
};