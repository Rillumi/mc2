const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/packs.js');
const P = globalThis.MC.packs;

function pack(uid, fileName, assets) {
  return { uid, fileName, size: 1, assets, project: null, url: '' };
}

function tex(n, prefix) {
  const out = [];
  for (let i = 0; i < n; i++) out.push('assets/minecraft/textures/block/' + (prefix || 'b') + i + '.png');
  return out;
}

test('资源包按覆盖内容分出角色', () => {
  const mods = [{ uid: 'm1', id: 'create', name: 'Create', ids: ['create'] }];
  const packs = [
    pack('base', 'Base32x.zip', tex(320)),
    pack('patch', 'TinyFix.zip', tex(50, 'p')),
    pack('ui', 'UiPack.zip', tex(10, 'g').map(x => x.replace('/block/', '/gui/'))),
    pack('sound', 'SoundPack.zip', tex(2, 's').map(x => x.replace('textures/block', 'sounds'))),
    pack('lang', 'ZhPack.zip', tex(2, 'l').map(x => x.replace('textures/block', 'lang'))),
    pack('mod', 'CreateFix.zip', ['assets/create/textures/block/cog.png', 'assets/create/lang/zh_cn.json'])
  ];
  const a = P.analyze(packs, mods);
  const role = uid => a.advice.find(x => x.uid === uid).role;
  assert.equal(role('base'), 'base');
  assert.equal(role('patch'), 'patch');
  assert.equal(role('ui'), 'ui');
  assert.equal(role('sound'), 'sound');
  assert.equal(role('lang'), 'lang');
  assert.equal(role('mod'), 'modpatch');
});

test('建议排序把基础材质压在最下面', () => {
  const packs = [
    pack('base', 'Base64x.zip', tex(320)),
    pack('patch', 'TinyFix.zip', tex(50, 'p')),
    pack('ui', 'UiPack.zip', tex(10, 'g').map(x => x.replace('/block/', '/gui/'))),
    pack('sound', 'SoundPack.zip', tex(2, 's').map(x => x.replace('textures/block', 'sounds')))
  ];
  const a = P.analyze(packs, []);
  const at = uid => a.suggested.indexOf(uid);
  assert.ok(at('base') > at('patch'));
  assert.ok(at('patch') > at('ui'));
  assert.ok(at('patch') > at('sound'));
});

test('能认出局部补丁属于哪个基础材质包', () => {
  const baseAssets = tex(320);
  const patchAssets = baseAssets.slice(0, 40);
  const packs = [
    pack('base', 'Base32x.zip', baseAssets),
    pack('patch', 'TinyFix.zip', patchAssets)
  ];
  const a = P.analyze(packs, []);
  const ai = a.advice.find(x => x.uid === 'patch');
  assert.equal(ai.target.baseUid, 'base');
  assert.equal(ai.target.hit, 40);
  assert.ok(a.suggested.indexOf('patch') < a.suggested.indexOf('base'));
});

test('基础包压在补丁上面时会提示顺序反了', () => {
  const baseAssets = tex(320);
  const packs = [
    pack('base', 'Base32x.zip', baseAssets),
    pack('patch', 'TinyFix.zip', baseAssets.slice(0, 40))
  ];
  const a = P.analyze(packs, []);
  const bad = P.checkOrder(a.packs, a.advice, ['base', 'patch']);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].packUid, 'patch');
  assert.equal(P.checkOrder(a.packs, a.advice, ['patch', 'base']).length, 0);
});

test('pack_format 能粗判版本新旧，未知版本不硬下结论', () => {
  const p = (uid, fileName, fmt, mc) => ({ uid, fileName, size: 1, assets: tex(3), project: null, fmtMin: fmt, fmtMax: fmt, mc });
  assert.equal(P.compat(p('a', 'A.zip', 15), '1.20.1').state, 'ok');
  assert.equal(P.compat(p('b', 'B.zip', 18), '1.20.1').state, 'new');
  assert.equal(P.compat(p('c', 'C.zip', 9), '1.20.1').state, 'old');
  assert.equal(P.compat(p('d', 'D.zip', 15), '1.22.0').state, 'unknown');
  assert.equal(P.compat(p('e', 'E.zip', 0), '1.20.1').state, 'unknown');
});

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
