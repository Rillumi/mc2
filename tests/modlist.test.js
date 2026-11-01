const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/pack/modlist.js');
const P = globalThis.MC.pack;

const env = { loader: 'Fabric', loaderVersion: '0.18.4', mc: '1.20.1' };

test('manifest.json 只写有 projectID/fileID 的在线项', () => {
  const text = P.manifestText({
    title: '乌托邦',
    env,
    online: [
      { projectID: 521480, fileID: 7668919 },
      { path: 'mods/a.jar', url: 'https://cdn.modrinth.com/a.jar' }
    ]
  });
  const j = JSON.parse(text);
  assert.equal(j.minecraft.version, '1.20.1');
  assert.equal(j.minecraft.modLoaders[0].id, 'fabric-0.18.4');
  assert.deepEqual(j.files, [{ projectID: 521480, fileID: 7668919, required: true }]);
});

test('modlist.html 给出本地和在线两张表', () => {
  const text = P.modlistText({
    title: '乌托邦',
    env,
    local: [{ name: '园丁的梦想', version: '1', source: '本地 jar', url: '' }],
    online: [{ projectID: 521480, fileID: 7668919 }]
  });
  assert.match(text, /已打包的模组（1）/);
  assert.match(text, /在线项（1/);
  assert.match(text, /园丁的梦想/);
  assert.match(text, /项目 521480/);
});

test('清单里的文本会转义', () => {
  const text = P.modlistText({ title: '<b>x</b>', env, local: [], online: [] });
  assert.match(text, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('在线项去重：已打包的同名去掉，重复项只留一条', () => {
  const online = [
    { path: 'mods/a.jar', url: 'u1' },
    { path: 'mods/a.jar', url: 'u1' },
    { projectID: 1, fileID: 2 },
    { projectID: 1, fileID: 2 }
  ];
  assert.deepEqual(P.dedupe(online, ['a.jar']), [{ projectID: 1, fileID: 2 }]);
});

test('清单会单独列出 CF 上没有、以及禁止分发的模组', () => {
  const t = P.modlistText({
    title: 'x', env, local: [], online: [],
    unmatched: ['a.jar', 'b.jar'], blocked: ['c.jar']
  });
  assert.match(t, /CurseForge 上没有记录.*（2）/);
  assert.match(t, /a\.jar、b\.jar/);
  assert.match(t, /CurseForge 上禁止第三方分发.*（1）/);
  assert.match(t, /c\.jar/);
});
