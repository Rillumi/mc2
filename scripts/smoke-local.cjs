// 只读取本机样本。产物写入指定目录，不上传或修改原始模组。
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {createApp} = require('../tests/helpers/app.cjs');

async function main() {
  if (!process.argv[2]) throw new Error('用法：npm run smoke:local -- <样本目录> [输出目录]');
  const root = path.resolve(process.argv[2]);
  const output = path.resolve(process.argv[3] || path.join(__dirname,'../.tmp/validation'));
  fs.mkdirSync(output,{recursive:true});
  const app = createApp(), MC = app.MC;
  function walk(dir) {
    return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'mod-checker') return [];
      const p = path.join(dir,e.name);
      return e.isDirectory() ? walk(p) : [p];
    });
  }
  const all = walk(root);
  const paths = all.filter(p=>/\.jar$/i.test(p));
  const entries = [], report = {jars:paths.length, parsed:0, failures:[], ambiguous:[], loaders:{}, roundtrips:[]};
  for (const [i,p] of paths.entries()) {
    const buf = fs.readFileSync(p);
    try {
      const result = await MC.metadata.inspect(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
      if (result.kind !== 'mod' || !result.info) throw new Error('没有读取到模组元数据');
      report.parsed++;
      const info = result.info;
      const version = MC.metadata.resolveVersion(info.version,path.basename(p),info.name);
      if (MC.version.parse(version).ambiguous) report.ambiguous.push({file:path.relative(root,p),version});
      report.loaders[info.loader] = (report.loaders[info.loader] || 0) + 1;
      entries.push({...info,version,uid:'local-'+i,fileName:path.basename(p),size:buf.length,sha1:createHash('sha1').update(buf).digest('hex'),sourcePath:p});
    } catch(e) {report.failures.push({file:path.relative(root,p),reason:e.message});}
    if ((i+1)%25===0) console.log('已读取',i+1,'/',paths.length);
  }
  const s = MC.store.state;
  const candidates = entries.filter(e=>e.size<8*1024*1024 && MC.analyzer.matchesEnv(e,s.env,false)).sort((a,b)=>a.size-b.size);
  const ids = new Set();
  const selected = candidates.filter(e=>!ids.has(e.id)&&ids.add(e.id)).slice(0,8);
  s.mods = selected.map(e=>({...e,file:new File([fs.readFileSync(e.sourcePath)],e.fileName)}));
  await MC.flowAnalysis.analyzeAndResolve();
  for (const format of ['mrpack','zip']) {
    const before = app.saved.length;
    await MC.flowPack.buildPack(format);
    if (app.saved.length===before) throw new Error(app.errors.at(-1) || app.messages.at(-1));
    const saved = app.saved.at(-1);
    fs.writeFileSync(path.join(output,saved.name),new Uint8Array(await saved.blob.arrayBuffer()));
    report.roundtrips.push({format,jars:s.lastPack.files[0].total,ok:s.lastPack.files[0].ok});
  }
  // 真实 mrpack 经过导入、回导，逐项核对在线记录和配置保留。
  for (const p of all.filter(p=>/\.mrpack$/i.test(p))) {
    const packApp = createApp();
    const file = new File([fs.readFileSync(p)],path.basename(p));
    const originalZip = MC.zip.parseCentral(await file.arrayBuffer());
    const original = JSON.parse(await MC.zip.readEntry(originalZip,'modrinth.index.json'));
    await packApp.MC.flowScan.importFiles([file]);
    await packApp.MC.flowPack.buildPack('mrpack');
    if (!packApp.saved.length) throw new Error(packApp.messages.at(-1));
    const result = packApp.saved[0];
    const zip = MC.zip.parseCentral(await result.blob.arrayBuffer());
    const index = JSON.parse(await MC.zip.readEntry(zip,'modrinth.index.json'));
    const configPaths = MC.overrides.plan([...originalZip.map.keys()]);
    for (const f of configPaths) {
      const actual = await MC.zip.readEntryBytes(zip,'overrides/'+f.path);
      const expected = await MC.zip.readEntryBytes(originalZip,f.src);
      if (!actual || !Buffer.from(actual).equals(Buffer.from(expected))) throw new Error('配置回导不一致：'+f.path);
    }
    if (index.files.length !== original.files.length) throw new Error('真实整合包在线项数量不一致');
    for (const f of original.files) {
      const actual = index.files.find(x=>x.path===f.path);
      if (!actual || JSON.stringify(actual.hashes)!==JSON.stringify(f.hashes) || JSON.stringify(actual.downloads)!==JSON.stringify(f.downloads)) throw new Error('在线文件回导不一致：'+f.path);
    }
    fs.writeFileSync(path.join(output,'回导-'+path.basename(p)),new Uint8Array(await result.blob.arrayBuffer()));
    report.roundtrips.push({file:path.relative(root,p),online:index.files.length,configFiles:configPaths.length,ok:packApp.MC.store.state.lastPack.files[0].ok});
  }
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if (report.failures.length) process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
