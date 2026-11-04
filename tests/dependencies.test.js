const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createApp}=require('./helpers/app.cjs');
const local=(id,deps=[])=>({uid:id,id,name:id,version:'1',sha1:id,loader:'Fabric',mcRange:'1.20.1',allIds:[id],deps});
const need=(id,range='*')=>({modId:id,versionRange:range,mandatory:true});

async function world(definitions){
 const app=createApp(),files=new Map(),items=new Map(),calls=[];
 for(const [id,def] of Object.entries(definitions)){
  const bytes=new Uint8Array(await (await app.MC.zipWriter.build([{path:'fabric.mod.json',data:new TextEncoder().encode(JSON.stringify({
   schemaVersion:1,id,name:id,version:def.version||'1',depends:Object.fromEntries((def.deps||[]).map(d=>[d.modId,d.versionRange])),
   recommends:Object.fromEntries((def.optional||[]).map(d=>[d.modId,d.versionRange]))
  }))}])).arrayBuffer());
  const url='https://example.invalid/'+id+'.jar';files.set(url,bytes);
  items.set(id,{id,modId:id,project:{id,slug:id,title:id},version:{id:id+'v1',version_number:def.version||'1',files:[{
   filename:id+'.jar',url,size:bytes.length,hashes:{sha1:createHash('sha1').update(bytes).digest('hex'),sha512:createHash('sha512').update(bytes).digest('hex')}
  }]},status:'ok',added:true});
 }
 const services={download:async url=>{calls.push(url);return files.get(url);},inspect:buf=>app.MC.metadata.inspect(buf),resolve:async d=>{
  const item=items.get(d.id);
  return item&&app.MC.version.mcMatches(d.range,item.version.version_number)?{ok:true,...item}:{ok:false,reason:'没有满足全部要求的版本'};
 }};
 const resolve=(roots=['b'],options={})=>app.MC.dependencies.resolve({local:[local('a',[need('b')])],online:roots.map(id=>items.get(id)),env:{loader:'Fabric',mc:'1.20.1'},...options},services);
 return {app,items,files,calls,services,resolve};
}

test('A → B → C → D：读取真实元数据并补齐全部间接前置',async()=>{
 const w=await world({b:{deps:[need('c')]},c:{deps:[need('d')]},d:{}}),r=await w.resolve();
 assert.equal(r.ok,true,r.errors.join(';'));
 assert.deepEqual(Array.from(r.extra,d=>d.id),['c','d']);assert.equal(r.entries.length,3);assert.equal(w.calls.length,3);
});
test('循环依赖 B ↔ C 有限结束，不重复下载或重复加入',async()=>{
 const w=await world({b:{deps:[need('c')]},c:{deps:[need('b')]}}),r=await w.resolve();
 assert.equal(r.ok,true);assert.equal(r.entries.length,2);assert.equal(w.calls.length,2);
});
test('共享前置只加入一次，冲突要求同时保留来源',async()=>{
 const w=await world({b:{deps:[need('c','>=1')]},d:{deps:[need('c','<2')]},c:{}});
 let r=await w.resolve(['b','d']);assert.equal(r.ok,true);assert.equal(r.extra.length,1);
 const x=await world({b:{deps:[need('c','>=2')]},d:{deps:[need('c','<2')]},c:{version:'2'}});
 r=await x.resolve(['b','d']);assert.equal(r.ok,false);assert.match(r.errors[0],/b 要求 >=2.*d 要求 <2/);
});
test('可选前置默认不补；开启后纳入检查',async()=>{
 const w=await world({b:{optional:[need('c')]},c:{}});
 assert.equal((await w.resolve()).extra.length,0);
 assert.equal((await w.resolve(['b'],{includeOptional:true})).extra.length,1);
});
test('本地已有合格前置时不下载；旧版本阻止导出',async()=>{
 const w=await world({b:{deps:[need('c','>=2')]},c:{version:'2'}});
 let c={...local('c'),version:'2'};
 let r=await w.resolve(['b'],{local:[local('a',[need('b')]),c]});assert.equal(r.ok,true);assert.equal(r.extra.length,0);assert.equal(w.calls.length,1);
 c={...c,version:'1'};r=await w.resolve(['b'],{local:[local('a',[need('b')]),c]});assert.equal(r.ok,false);assert.match(r.errors[0],/所选前置 c/);
});
test('下载失败、哈希错误、错误内部 ID 均不报告依赖完整',async()=>{
 let w=await world({b:{}});w.services.download=async()=>{throw Error('offline');};assert.equal((await w.resolve()).ok,false);
 w=await world({b:{}});w.services.download=async()=>new Uint8Array([0]);assert.match((await w.resolve()).errors[0],/校验失败/);
 w=await world({b:{deps:[need('c')]},c:{},wrong:{}});w.services.resolve=async()=>({ok:true,...w.items.get('wrong')});
 assert.match((await w.resolve()).errors[0],/内部 ID 不符/);
});
test('图检查结果进入最终方案，导出带上 C；失败时不生成包',async()=>{
 const w=await world({b:{deps:[need('c')]},c:{}}),MC=w.app.MC,s=MC.store.state;
 s.env={loader:'Fabric',mc:'1.20.1',loaderVersion:'0.16.0'};s.mods=[local('a',[need('b')])];
 s.mods[0].file=new File([new Uint8Array([1,2,3])],'a.jar');s.mods[0].fileName='a.jar';s.mods[0].sha1=createHash('sha1').update(new Uint8Array([1,2,3])).digest('hex');
 s.analysis=MC.analyzer.analyze(s.mods,s.env);MC.selector.assign(s,s.analysis);MC.store.touch();Object.assign(s.deps[0],w.items.get('b'));MC.store.touch();
 MC.api.modrinth.download=w.services.download;MC.resolver={resolve:w.services.resolve};
 await MC.flowPack.buildPack('mrpack');assert.equal(w.app.saved.length,1,w.app.messages.join(';'));assert.equal(s.plan.online.length,2);assert.equal(s.plan.uncertain.length,0);
 const zip=MC.zip.parseCentral(await w.app.saved[0].blob.arrayBuffer());const index=JSON.parse(await MC.zip.readEntry(zip,'modrinth.index.json'));assert.equal(index.files.length,2);
 s.dependencyGraph=null;MC.api.modrinth.download=async()=>{throw Error('offline');};
 // 不同版本/文件键使缓存失效，模拟用户改选文件。
 s.deps[0].version={...s.deps[0].version,id:'new-version'};
 await MC.flowPack.buildPack('mrpack');assert.equal(w.app.saved.length,1);assert.match(w.app.messages.at(-1),/offline/);
});
function selectRoot(w){
 const MC=w.app.MC,s=MC.store.state;
 s.env={loader:'Fabric',mc:'1.20.1'};s.mods=[local('a',[need('b')])];
 s.analysis=MC.analyzer.analyze(s.mods,s.env);MC.selector.assign(s,s.analysis);MC.store.touch();
 Object.assign(s.deps[0],w.items.get('b'));MC.store.touch();
 MC.api.modrinth.download=w.services.download;MC.resolver={resolve:w.services.resolve};return s;
}
test('旧方案的依赖链请求完成后不写入新环境',async()=>{
 const w=await world({b:{}}),s=selectRoot(w);let complete;
 w.app.MC.api.modrinth.download=()=>new Promise(r=>complete=r);
 const pending=w.app.MC.dependencies.checkState(s);
 s.env.mc='1.21.1';w.app.MC.store.touch();complete(w.files.values().next().value);
 await pending;assert.equal(s.dependencyGraph,undefined);
});
test('失败结果保留，明确重试后可恢复',async()=>{
 const w=await world({b:{}}),s=selectRoot(w),MC=w.app.MC;
 MC.api.modrinth.download=async()=>{throw Error('offline');};assert.equal((await MC.dependencies.checkState(s)).ok,false);
 MC.api.modrinth.download=w.services.download;assert.equal((await MC.dependencies.checkState(s)).ok,false);
 assert.equal((await MC.dependencies.checkState(s,{force:true})).ok,true);assert.equal(s.plan.uncertain.length,0);
});
