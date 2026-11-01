const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/api/afdianMap.js');

const M = globalThis.MC.afdianMap;

test('公开表按 modId / 别名 / 作者名都能命中', () => {
  M.MAP.gardenersdream = { name: '园丁作者', home: 'https://afdian.com/a/gardener' };
  assert.equal(M.find({ id: 'gardeners_dream' }).home, 'https://afdian.com/a/gardener');
  assert.equal(M.find({ allIds: ['gardenersdream'] }).home, 'https://afdian.com/a/gardener');
  assert.equal(M.find({ authors: ['园丁作者'] }).home, 'https://afdian.com/a/gardener');
  assert.equal(M.find({ id: 'other_mod' }), null);
  delete M.MAP.gardenersdream;
});

test('只把爱发电域名认成爱发电链接', () => {
  assert.equal(M.isAfdian('https://afdian.net/a/x'), true);
  assert.equal(M.isAfdian('https://afdian.com/a/x'), true);
  assert.equal(M.isAfdian('https://github.com/a/b'), false);
  assert.equal(M.isAfdian(''), false);
});
