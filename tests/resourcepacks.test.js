const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/packs.js');
const P = globalThis.MC.packs;

function pack(uid, fileName, assets, extra) {
  return Object.assign({ uid, fileName, size: 1, assets, project: null, url: '' }, extra || {});
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

test('作者描述写明 addon 时才认补丁归属', () => {
  const faAssets = tex(477);
  const addonAssets = faAssets.slice(0, 19).concat(
    Array.from({ length: 199 }, (_, i) => 'assets/minecraft/optifine/random/entity/horse/r' + i + '.png'));
  const packs = [
    pack('fa', 'FreshAnimations_v1.11.1_1.20+.zip', faAssets),
    pack('ad', 'Fresh Better Horses v1.0 1.21.zip', addonAssets, {
      description: 'Made By CanineGray Fresh Animations addon!'
    })
  ];
  const a = P.analyze(packs, []);
  const ai = a.advice.find(x => x.uid === 'ad');
  assert.equal(ai.declared.baseUid, 'fa');
  assert.ok(a.suggested.indexOf('ad') < a.suggested.indexOf('fa'));
  assert.equal(P.checkOrder(a.packs, a.advice, ['ad', 'fa']).length, 0);
  assert.equal(P.checkOrder(a.packs, a.advice, ['fa', 'ad']).length, 1);
});

test('重叠只分单向包含和同类竞争，不写谁的补丁', () => {
  const big = tex(320);
  const small = big.slice(0, 60);
  const a = P.analyze([pack('big', 'Big.zip', big), pack('small', 'SmallFix.zip', small)], []);
  assert.equal(a.relations[0].kind, 'subset');
  assert.equal(a.relations[0].inter, 60);
  assert.equal(a.relations[0].a, 'big');
  assert.equal(a.relations[0].b, 'small');

  const x = tex(300);
  const y = x.slice(0, 280).concat(tex(20, 'z'));
  const b = P.analyze([pack('x', 'XPack.zip', x), pack('y', 'YPack.zip', y)], []);
  assert.equal(b.relations[0].kind, 'peer');
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
