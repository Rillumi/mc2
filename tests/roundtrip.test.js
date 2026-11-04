const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {createApp} = require('./helpers/app.cjs');
const enc = new TextEncoder();
const remoteBytes = enc.encode('online fixture bytes');
const remote = {
  path:'mods/remote.jar', fileSize:remoteBytes.length,
  hashes: {sha1:createHash('sha1').update(remoteBytes).digest('hex'),sha512:createHash('sha512').update(remoteBytes).digest('hex')},
  downloads:['https://example.invalid/remote.jar'],env:{client:'required',server:'unsupported'}
};

async function fixture(app, {local = true, online = remote} = {}) {
  const W = app.MC.zipWriter;
  const jar = await W.build([{path:'fabric.mod.json',data:enc.encode(JSON.stringify({schemaVersion:1,id:'fixture',name:'Fixture',version:'1.20.1-beta.2',depends:{minecraft:'1.20.1'}}))}]);
  const entries = [
    {path:'modrinth.index.json', data:enc.encode(JSON.stringify({formatVersion:1,game:'minecraft',name:'fixture',versionId:'1',dependencies:{minecraft:'1.20.1','fabric-loader':'0.16.0'},files:[online]}))},
    {path:'overrides/config/example.json', data:enc.encode('{"fixture":true}')}
  ];
  if (local) entries.push({path:'overrides/mods/local.jar',data:new Uint8Array(await jar.arrayBuffer())});
  return new File([await W.build(entries)], 'fixture.mrpack');
}

async function indexOf(app, blob) {
  const zip = app.MC.zip.parseCentral(await blob.arrayBuffer());
  return {zip,index:JSON.parse(await app.MC.zip.readEntry(zip,'modrinth.index.json'))};
}

test('混合整合包经过真实导入与导出，保留在线描述、本地 jar 和配置', async () => {
  const app = createApp();
  await app.MC.flowScan.importFiles([await fixture(app)]);
  assert.equal(app.MC.store.state.mods.length, 1);
  await app.MC.flowPack.buildPack('mrpack');
  assert.equal(app.saved.length, 1, app.messages.join('\n'));
  const {zip,index} = await indexOf(app, app.saved[0].blob);
  assert.deepEqual(index.files, [remote]);
  assert.ok(zip.map.has('overrides/mods/local.jar'));
  assert.equal(await app.MC.zip.readEntry(zip,'overrides/config/example.json'), '{"fixture":true}');
  assert.equal(app.MC.store.state.lastPack.files[0].ok, true);
});

test('纯在线清单也能导入并重新导出，保留非模组在线文件', async () => {
  const app = createApp();
  const online = {...remote,path:'resourcepacks/remote.zip'};
  await app.MC.flowScan.importFiles([await fixture(app,{local:false,online})]);
  await app.MC.flowPack.buildPack('mrpack');
  assert.equal(app.saved.length, 1, app.messages.join('\n'));
  assert.deepEqual((await indexOf(app,app.saved[0].blob)).index.files,[online]);
});

test('在线清单转离线 zip 实际下载并校验原包文件', async () => {
  const app = createApp();
  await app.MC.flowScan.importFiles([await fixture(app)]);
  app.MC.api.modrinth.download = async () => remoteBytes;
  await app.MC.flowPack.buildPack('zip');
  assert.equal(app.saved.length,1,app.messages.join('\n'));
  const zip = app.MC.zip.parseCentral(await app.saved[0].blob.arrayBuffer());
  assert.deepEqual(await app.MC.zip.readEntryBytes(zip,'mods/remote.jar'),remoteBytes);
  assert.equal(app.MC.store.state.lastPack.files[0].total,2);
});

test('下载失败或下载内容损坏时停止导出', async () => {
  for (const download of [async()=>{throw new Error('offline');},async()=>enc.encode('wrong content')]) {
    const app = createApp();
    await app.MC.flowScan.importFiles([await fixture(app)]);
    app.MC.api.modrinth.download = download;
    await app.MC.flowPack.buildPack('zip');
    assert.equal(app.saved.length,0);
    assert.ok(app.MC.store.state.lastPack.problems.length);
    assert.equal(app.MC.store.state.busy,false);
  }
});

test('缺失哈希或跨平台清单无法转换时明确失败，不生成缺文件的包', async () => {
  const app = createApp();
  await app.MC.flowScan.importFiles([await fixture(app,{online:{...remote,hashes:{}}})]);
  await app.MC.flowPack.buildPack('mrpack');
  assert.equal(app.saved.length,0);
  assert.match(app.messages.at(-1),/缺少有效 sha1/);
  app.MC.store.state.packSources[0].onlineList = [{projectID:1,fileID:2}];
  await app.MC.flowPack.buildPack('mrpack');
  assert.equal(app.saved.length,0);
  assert.match(app.messages.at(-1),/不能直接转换/);
});

test('回读校验失败时不触发下载，不显示成功', async () => {
  const app = createApp();
  await app.MC.flowScan.importFiles([await fixture(app)]);
  app.MC.pack.verify = async()=>({ok:false,problems:['fixture error'],total:1,checked:0});
  await app.MC.flowPack.buildPack('mrpack');
  assert.equal(app.saved.length,0);
  assert.match(app.messages.at(-1),/校验未通过/);
});

test('首次从普通 jar 导入后直接打包，不依赖先导入整合包初始化状态', async () => {
  const app = createApp();
  app.MC.store.state.env = {loader:'Fabric',mc:'1.20.1',loaderVersion:'0.16.0'};
  const original = await fixture(app);
  const zip = app.MC.zip.parseCentral(await original.arrayBuffer());
  const bytes = await app.MC.zip.readEntryBytes(zip,'overrides/mods/local.jar');
  await app.MC.flowScan.importFiles([new File([bytes],'local.jar')]);
  await app.MC.flowPack.buildPack('mrpack');
  assert.equal(app.saved.length,1,app.messages.join('\n'));
  assert.equal(app.MC.store.state.lastPack.files[0].total,1);
});

test('打包期间切换环境会停止下载，避免导出混合状态',async()=>{
 const app=createApp();await app.MC.flowScan.importFiles([await fixture(app)]);
 const original=app.MC.pack.verify;
 app.MC.pack.verify=async(...args)=>{const r=await original(...args);app.MC.store.state.env.mc='1.21.1';return r;};
 await app.MC.flowPack.buildPack('mrpack');assert.equal(app.saved.length,0);assert.match(app.messages.at(-1),/已改变/);
});
