const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/core/zip-writer.js');
require('../js/core/zip-reader.js');
require('../js/pack/verify.js');

const W = globalThis.MC.zipWriter;
const verify = globalThis.MC.pack.verify;
const enc = new TextEncoder();

async function sha1(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function makeMrpack(jar, hash, indexOverride) {
  const index = indexOverride || {
    formatVersion: 1,
    game: 'minecraft',
    name: 'fixture',
    versionId: '1.0.0',
    dependencies: { minecraft: '1.20.1', forge: '47.2.0' },
    files: [{
      path: 'mods/online.jar',
      hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
      downloads: ['https://example.com/online.jar'],
      fileSize: 10
    }]
  };
  const entries = [];
  if (index !== 'skip') {
    entries.push({
      path: 'modrinth.index.json',
      data: enc.encode(typeof index === 'string' ? index : JSON.stringify(index))
    });
  }
  entries.push({ path: 'overrides/mods/local.jar', data: jar });
  entries.push({ path: 'overrides/ModPilot-说明.txt', data: enc.encode('ok') });
  return W.build(entries);
}

function cursePack(jar, manifestOverride) {
  const mf = manifestOverride || {
    manifestType: 'minecraftModpack',
    manifestVersion: 1,
    name: 'fixture',
    version: '1.0.0',
    author: 'test',
    files: [{ projectID: 123, fileID: 456, required: true }],
    overrides: 'overrides',
    minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.0', primary: true }] }
  };
  return W.build([
    { path: 'manifest.json', data: enc.encode(typeof mf === 'string' ? mf : JSON.stringify(mf)) },
    { path: 'modlist.html', data: enc.encode('<html><body>list</body></html>') },
    { path: 'overrides/mods/local.jar', data: jar },
    { path: 'ModPilot-说明.txt', data: enc.encode('ok') }
  ]);
}

test('.mrpack 正常包通过校验并逐个核对 sha1', async () => {
  const jar = enc.encode('fake jar bytes');
  const blob = await makeMrpack(jar, null);
  const h = await sha1(jar);

  const seen = [];
  const r = await verify(blob, { format: 'mrpack', jars: 1, online: 1, hashes: [h] }, (i, n, name) => seen.push(name));
  assert.equal(r.ok, true);
  assert.equal(r.checked, 1);
  assert.equal(r.total, 1);
  assert.deepEqual(seen, ['local.jar']);
});

test('.mrpack 包内 jar 数量对不上会被发现', async () => {
  const jar = enc.encode('fake jar bytes');
  const blob = await makeMrpack(jar, null);
  const r = await verify(blob, { format: 'mrpack', jars: 2, online: 1 });
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /jar 数量不对/);
});

test('.mrpack 哈希对不上会被发现', async () => {
  const jar = enc.encode('fake jar bytes');
  const blob = await makeMrpack(jar, null);
  const r = await verify(blob, { format: 'mrpack', jars: 1, online: 1, hashes: ['0'.repeat(40)] });
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /sha1 和源文件对不上/);
});

test('.mrpack 缺清单或 JSON 坏了会被发现', async () => {
  const jar = enc.encode('fake jar bytes');
  const missing = await makeMrpack(jar, null, 'skip');
  const bad = await makeMrpack(jar, null, '{oops');

  const r1 = await verify(missing, { format: 'mrpack', jars: 1 });
  assert.match(r1.problems.join('\n'), /缺少 modrinth.index.json/);

  const r2 = await verify(bad, { format: 'mrpack', jars: 1 });
  assert.match(r2.problems.join('\n'), /不是合法 JSON/);
});

test('.mrpack 在线项缺哈希会被发现', async () => {
  const jar = enc.encode('fake jar bytes');
  const index = {
    formatVersion: 1,
    game: 'minecraft',
    dependencies: { minecraft: '1.20.1' },
    files: [{ path: 'mods/online.jar', downloads: ['https://example.com/a.jar'] }]
  };
  const blob = await makeMrpack(jar, null, index);
  const r = await verify(blob, { format: 'mrpack', jars: 1, online: 1 });
  assert.match(r.problems.join('\n'), /缺少 sha1\/sha512/);
});

test('CurseForge 正常包通过校验', async () => {
  const jar = enc.encode('fake jar bytes');
  const blob = await cursePack(jar);
  const r = await verify(blob, { format: 'curseforge', jars: 1, online: 1, hashes: [await sha1(jar)] });
  assert.equal(r.ok, true);
  assert.equal(r.checked, 1);
});

test('CurseForge 在线项缺 projectID/fileID 会被发现', async () => {
  const jar = enc.encode('fake jar bytes');
  const mf = {
    manifestType: 'minecraftModpack',
    manifestVersion: 1,
    files: [{ fileID: 456 }],
    overrides: 'overrides',
    minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.0' }] }
  };
  const blob = await cursePack(jar, mf);
  const r = await verify(blob, { format: 'curseforge', jars: 1, online: 1 });
  assert.match(r.problems.join('\n'), /缺少 projectID\/fileID/);
});

test('下载清单里出现 jar 会被发现', async () => {
  const jar = enc.encode('fake jar bytes');
  const mf = {
    manifestType: 'minecraftModpack',
    manifestVersion: 1,
    files: [],
    overrides: 'overrides',
    minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.0' }] }
  };
  const blob = await W.build([
    { path: 'manifest.json', data: enc.encode(JSON.stringify(mf)) },
    { path: 'modlist.html', data: enc.encode('list') },
    { path: 'ModPilot-说明.txt', data: enc.encode('ok') },
    { path: 'mods/extra.jar', data: jar }
  ]);
  const r = await verify(blob, { format: 'list', jars: 0, online: 0 });
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /不应该有 jar/);
});

test('离线 zip 检查说明文件和 jar 数量', async () => {
  const jar = enc.encode('fake jar bytes');
  const blob = await W.build([
    { path: 'mods/local.jar', data: jar },
    { path: '安装说明.txt', data: enc.encode('ok') }
  ]);
  const r = await verify(blob, { format: 'zip', jars: 1, hashes: [await sha1(jar)] });
  assert.equal(r.ok, true);

  const noDoc = await W.build([{ path: 'mods/local.jar', data: jar }]);
  const r2 = await verify(noDoc, { format: 'zip', jars: 1 });
  assert.match(r2.problems.join('\n'), /缺少 安装说明.txt/);
});

test('不是 zip 的文件会直接报错而不是崩掉', async () => {
  const r = await verify(new Blob([new Uint8Array([1, 2, 3])]), { format: 'zip' });
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /压缩包读不出来/);
});
