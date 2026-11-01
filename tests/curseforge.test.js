const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/murmur2.js');
require('../js/pack/modlist.js');
require('../js/pack/curseforge.js');

const M = globalThis.MC.murmur2;
const P = globalThis.MC.pack;

test('Murmur2 与参考实现一致（seed 0/1）', () => {
  const hello = new TextEncoder().encode('hello');
  assert.equal(M.hash(hello, 0), 3848350155);
  assert.equal(M.hash(hello, 1), 2788266382);
  assert.equal(M.hash(new Uint8Array(0), 1), 1540447798);
  assert.equal(M.hash(new Uint8Array([0, 1, 2]), 1), 1374027183);
});

test('CurseForge 指纹就是 seed=1 的 Murmur2', () => {
  assert.equal(M.fingerprint(new TextEncoder().encode('hello')), 2788266382);
});

test('CurseForge manifest 写加载器、游戏版本和 files', () => {
  const j = JSON.parse(P.curseManifest({
    title: '乌托邦',
    env: { loader: 'Fabric', mc: '1.20.1', loaderVersion: '0.18.4' },
    files: [{ projectID: 521480, fileID: 7668919 }]
  }));
  assert.equal(j.manifestType, 'minecraftModpack');
  assert.equal(j.overrides, 'overrides');
  assert.deepEqual(j.minecraft.modLoaders, [{ id: 'fabric-0.18.4', primary: true }]);
  assert.deepEqual(j.files, [{ projectID: 521480, fileID: 7668919, required: true }]);
});

test('Forge 的加载器 id 是 forge-版本', () => {
  const j = JSON.parse(P.curseManifest({
    title: 'x', env: { loader: 'Forge', mc: '1.20.1', loaderVersion: '47.4.0' }, files: []
  }));
  assert.equal(j.minecraft.modLoaders[0].id, 'forge-47.4.0');
});
