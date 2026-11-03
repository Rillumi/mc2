const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/packs.js');
const P = globalThis.MC.packs;

function pack(uid, fileName, assets) {
  return { uid, fileName, size: 1, assets, project: null, url: '' };
}

test('资源包覆盖模组命名空间会被标出', () => {
  const mods = [{ uid: 'm1', id: 'create', name: 'Create', ids: ['create'], project: { id: 'p' } }];
  const packs = [pack('r1', 'x.zip', [
    'assets/create/textures/block/cog.png',
    'assets/minecraft/textures/ui/button.png'
  ])];
  const a = P.analyze(packs, mods);
  assert.equal(a.modOverlaps.length, 1);
  assert.equal(a.modOverlaps[0].modName, 'Create');
  assert.equal(a.modOverlaps[0].ns, 'create');
  assert.equal(a.modOverlaps[0].count, 1);
});

test('只改原版命名空间不算覆盖模组', () => {
  const mods = [{ uid: 'm1', id: 'create', name: 'Create', ids: ['create'] }];
  const packs = [pack('r1', 'x.zip', ['assets/minecraft/textures/block/stone.png'])];
  const a = P.analyze(packs, mods);
  assert.equal(a.modOverlaps.length, 0);
});

test('同路径冲突带最多 3 个样例路径', () => {
  const packs = [
    pack('a', 'A.zip', ['assets/minecraft/a.png', 'assets/minecraft/b.png', 'assets/minecraft/c.png', 'assets/minecraft/d.png']),
    pack('b', 'B.zip', ['assets/minecraft/a.png', 'assets/minecraft/b.png', 'assets/minecraft/c.png', 'assets/minecraft/d.png'])
  ];
  const a = P.analyze(packs, []);
  assert.equal(a.conflicts.length, 1);
  assert.equal(a.conflicts[0].count, 4);
  assert.equal(a.conflicts[0].samples.length, 3);
});
