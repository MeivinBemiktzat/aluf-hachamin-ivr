'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('../api/game');

test('recipes are assigned neutrally and contain 7 or 8 ingredients', () => {
  const g = game.newGame('123', 2, 'bots');
  g.players.push(game.newPlayer('a','א'), game.newPlayer('b','ב'));
  game.startGame(g);
  for (const p of g.players) assert.ok([7,8].includes(p.recipe.ingredients.length));
});
test('market bidding resolves only after every player submits', () => {
  const g = game.newGame('123',2,'bots');
  g.players.push(game.newPlayer('a','א'),game.newPlayer('b','ב'));
  game.startGame(g);
  game.openMarket(g);
  const before = g.ingredientIndex;
  const a = g.players[0], b = g.players[1];
  game.submitBid(g,a.id,0);
  assert.equal(g.ingredientIndex,before);
  game.submitBid(g,b.id,1);
  assert.equal(g.ingredientIndex,before+1);
});
test('random money cards are valued from one to four', () => {
  const p = game.newPlayer('a','א');
  game.addRandomMoney(p,100);
  assert.ok(p.coins.every(n => n >= 1 && n <= 4));
});