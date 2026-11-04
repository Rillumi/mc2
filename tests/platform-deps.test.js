const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createApp}=require('./helpers/app.cjs');
function version(id,dependencies=[],extra={}) {
 const data=Buffer.from('file:'+id);
 return {id,project_id:'p'+id,version_number:'1.0.0',name:id,version_type:'release',date_published:'2026-01-01',
  dependencies,game_versions:['1.20.1'],loaders:['forge'],files:[{filename:id+'.jar',primary:true,url:'https://example.invalid/'+id+'.jar',size:data.length,
   hashes:{sha1:createHash('sha1').update(data).digest('hex'),sha512:createHash('sha512').update(data).digest('hex')}}],...extra};
}
const required=(id,project='p'+id)=>({dependency_type:'required',version_id:id,project_id:project});
const descriptor=v=>({path:'mods/'+v.files[0].filename,hashes:v.files[0].hashes,downloads:[v.files[0].url],fileSize:v.files[0].size});
async function world(versions,roots,options={}) {
 const app=createApp(),MC=app.MC,s=MC.store.state,calls=[],byId=new Map(versions.map(v=>[v.id,v]));
 MC.api.modrinth.versionFiles=async(hashes,algorithm='sha1')=>{
  calls.push({type:'hash',hashes,algorithm});
  return Object.fromEntries(hashes.flatMap(h=>{const v=versions.find(v=>v.files.some(f=>f.hashes[algorithm]===h));return v?[[h,v]]:[];}));
 };
 MC.api.modrinth.versionsByIds=async ids=>{calls.push({type:'ids',ids});return ids.map(id=>byId.get(id)).filter(Boolean);};
 MC.api.modrinth.versions=async project=>{calls.push({type:'project',project});return versions.filter(v=>v.project_id===project);};
 MC.api.modrinth.download=async()=>{calls.push({type:'download'});throw Error('快速检查不应下载 JAR');};
 const files=roots.map(r=>typeof r==='string'?descriptor(byId.get(r)):r);
 const index={formatVersion:1,game:'minecraft',versionId:'original',name:'original',files,dependencies:{minecraft:'1.20.1',forge:'47.4.0'}};
 const blob=await MC.zipWriter.build([{path:'modrinth.index.json',data:new TextEncoder().encode(JSON.stringify(index))},
  {path:'overrides/config/keep.txt',data:new TextEncoder().encode('keep original')}]);
 await MC.flowScan.importFiles([new File([blob],'original.mrpack')]);
 if(options.env)s.env={...s.env,...options.env};MC.store.touch();
 const check=opts=>MC.platformDeps.checkState(s,opts);
 return {app,MC,s,calls,byId,original:index,check};
}
const errors=r=>r.findings.filter(f=>f.severity==='error');

test('纯在线 A→B→C：哈希识别原包精确版本，递归关系全部核对且不下载 JAR',async()=>{
 const w=await world([version('a',[required('b')]),version('b',[required('c')]),version('c')],['a','b','c']);
 const r=await w.check();assert.equal(r.sourceIdentified,3);assert.equal(r.nodes,3);assert.equal(r.relations.length,2);
 assert.ok(r.relations.every(d=>d.state==='present-exact'));assert.equal(errors(r).length,0);
 assert.equal(w.calls.filter(c=>c.type==='hash').length,1);assert.equal(w.calls.filter(c=>c.type==='download').length,0);
 assert.equal(w.s.plan.coverage.sourceChecked,3);assert.match(w.s.plan.uncertain[0].reason,/内部 ID/);
 assert.deepEqual(JSON.parse(JSON.stringify(w.s.packSources[0].onlineList.map(f=>f.hashes))),w.original.files.map(f=>f.hashes));
});

test('循环引用、共享前置和重复文件复用版本节点，不无限展开',async()=>{
 const a=version('a',[required('b'),required('c')]),b=version('b',[required('a'),required('c')]),c=version('c');
 const w=await world([a,b,c],['a','b','c',{...descriptor(c),path:'mods/second-c.jar'}]);
 const r=await w.check();assert.equal(r.nodes,3);assert.equal(r.relations.length,4);assert.equal(r.sourceIdentified,4);
 assert.equal(w.calls.length,1);assert.equal(errors(r).length,0);
});

test('缺失前置先给候选；手动加入 B 后继续发现 C；导出保持原包文件与配置',async()=>{
 const a=version('a',[required('b')]),b=version('b',[required('c')]),c=version('c');
 const w=await world([a,b,c],['a']);let r=await w.check();
 assert.equal(errors(r).length,1);assert.equal(r.candidates[0].version.id,'b');
 await w.MC.flowPack.buildPack('mrpack');assert.equal(w.app.saved.length,0);
 assert.equal(w.MC.platformDeps.add(w.s,'pb'),true);r=await w.check();
 assert.ok(errors(r).some(f=>/pc/.test(f.reason)));assert.equal(r.candidates[0].version.id,'c');
 assert.equal(w.MC.platformDeps.add(w.s,'pc'),true);r=await w.check();assert.equal(errors(r).length,0);
 await w.MC.flowPack.buildPack('mrpack');assert.equal(w.app.saved.length,1);
 const zip=w.MC.zip.parseCentral(await w.app.saved[0].blob.arrayBuffer());
 const index=JSON.parse(await w.MC.zip.readEntry(zip,'modrinth.index.json'));
 assert.equal(index.files.length,3);assert.deepEqual(index.files.find(f=>f.path==='mods/a.jar'),descriptor(a));
 assert.equal(await w.MC.zip.readEntry(zip,'overrides/config/keep.txt'),'keep original');
 assert.equal(w.calls.filter(c=>c.type==='download').length,0);
});

test('项目级依赖只证明存在，不伪造内部版本区间；候选再次筛选 MC / 加载器',async()=>{
 const dep={dependency_type:'required',project_id:'lib'};
 const a=version('a',[dep]),good=version('good',[],{project_id:'lib'});
 const old=version('old',[],{project_id:'lib',game_versions:['1.19.2'],date_published:'2026-11-01'});
 const wrongLoader=version('wrongloader',[],{project_id:'lib',loaders:['fabric'],date_published:'2026-12-01'});
 let w=await world([a,good,old,wrongLoader],['a']);let r=await w.check();
 assert.equal(r.candidates[0].version.id,'good');assert.equal(w.MC.platformDeps.add(w.s,'lib'),true);
 r=await w.check();assert.equal(errors(r).length,0);assert.ok(r.findings.some(f=>/内部版本区间/.test(f.reason)));
});

test('原包已有不同精确版本时报告要求不符，不替换也不另加一份掩盖',async()=>{
 const a=version('a',[required('b1','lib')]),b1=version('b1',[],{project_id:'lib'}),b2=version('b2',[],{project_id:'lib'});
 const w=await world([a,b1,b2],['a','b2']),r=await w.check();
 assert.equal(errors(r).length,1);assert.equal(r.candidates.length,0);assert.ok(r.findings.some(f=>/不会另加/.test(f.reason)));
 assert.equal(w.s.packSources[0].onlineList[1].hashes.sha1,b2.files[0].hashes.sha1);
});

test('多个上层的精确版本要求互相矛盾时不挑一个蒙混通过',async()=>{
 const a=version('a',[required('b1','lib')]),x=version('x',[required('b2','lib')]);
 const w=await world([a,x,version('b1',[],{project_id:'lib'}),version('b2',[],{project_id:'lib'})],['a','x']);
 const r=await w.check();assert.ok(errors(r).some(f=>/互不一致/.test(f.reason)));assert.equal(r.candidates.length,0);
});

test('有未识别文件时不能确定缺失，离线与没有哈希均列待确认',async()=>{
 const a=version('a',[required('b')]),unknown=descriptor(version('unknown'));
 let w=await world([a,version('b')],['a',unknown]),r=await w.check();
 assert.equal(errors(r).length,0);assert.equal(r.unresolved.length,1);assert.equal(r.relations[0].state,'unknown');
 w=await world([a],['a',{path:'mods/nohash.jar',downloads:['https://example.invalid/no.jar']}]);
 r=await w.check();assert.equal(errors(r).length,0);assert.equal(r.unresolved.length,1);
});

test('平台附加字段不能覆盖上层必需标记或关系来源',async()=>{
 const a=version('a',[{...required('b'),required:false,from:'forged',fromName:'forged'}]);
 const w=await world([a,version('b')],['a']),r=await w.check();
 assert.equal(errors(r).length,1);assert.notEqual(r.relations[0].fromName,'forged');assert.equal(r.relations[0].from,'a');
});

test('接口失败结果可重试；普通读取复用当前结果，强制重查才恢复',async()=>{
 const w=await world([version('a')],['a']),normal=w.MC.api.modrinth.versionFiles;
 let failed=0;w.MC.api.modrinth.versionFiles=async()=>{failed++;throw Error('offline');};
 let r=await w.check();assert.equal(r.status,'partial');assert.match(r.findings[0].reason,/offline/);
 await w.check();assert.equal(failed,1);
 w.MC.api.modrinth.versionFiles=normal;r=await w.check({force:true});assert.equal(r.sourceIdentified,1);
});

test('可选缺失不阻止导出；开启可选项只提供候选，加入后才继续检查',async()=>{
 const a=version('a',[{...required('b'),dependency_type:'optional'}]),b=version('b',[required('c')]);
 const w=await world([a,b,version('c')],['a']);let r=await w.check();
 assert.equal(errors(r).length,0);assert.equal(r.candidates.length,0);
 w.s.includeOptional=true;w.MC.store.touch();r=await w.check();assert.equal(r.candidates[0].optional,true);
 assert.equal(errors(r).length,0);w.MC.platformDeps.add(w.s,'pb');r=await w.check();assert.ok(errors(r).some(f=>/pc/.test(f.reason)));
});

test('embedded 只记录待核实，不当作已验证提供者，也不自动重复下载',async()=>{
 const a=version('a',[required('b')]),x=version('x',[{...required('b'),dependency_type:'embedded'}]);
 const w=await world([a,x,version('b')],['a','x']),r=await w.check();
 assert.equal(errors(r).length,0);assert.equal(r.candidates.length,0);assert.ok(r.relations.some(d=>d.state==='embedded-unverified'));
 assert.ok(r.findings.some(f=>/声明内嵌/.test(f.reason)));assert.equal(w.calls.some(c=>c.type==='download'),false);
});

test('原包不兼容关系进入统一方案；可选 / 端条件未确定时不直接报致命冲突',async()=>{
 const a=version('a',[{...required('b'),dependency_type:'incompatible'}]),b=version('b');
 let w=await world([a,b],['a','b']);await w.check();assert.ok(w.s.plan.errors.some(e=>/明确互斥/.test(e)));
 w=await world([a,b],[{...descriptor(a),env:{client:'required',server:'unsupported'}},'b']);
 await w.check();assert.equal(w.s.plan.errors.length,0);assert.ok(w.s.plan.analysis.conflicts.some(c=>c.severity==='pending'));
});

test('SHA-512 识别和非 primary 文件；版本 ID 提示与哈希矛盾时拒绝冒认',async()=>{
 const a=version('a'),alt=version('alt');a.files.push(alt.files[0]);
 let f=descriptor(a);f={...f,hashes:{sha512:a.files[0].hashes.sha512}};
 let w=await world([a],[f]),r=await w.check();assert.equal(r.sourceIdentified,1);assert.equal(w.calls[0].algorithm,'sha512');
 w=await world([a],[{...descriptor(alt),version_id:'a'}]);r=await w.check();assert.equal(r.sourceIdentified,1);
 w=await world([a],[{...descriptor(a),version_id:'different'}]);r=await w.check();assert.equal(r.unresolved.length,1);
 w=await world([a],[{...descriptor(a),hashes:{sha1:a.files[0].hashes.sha1,sha512:'f'.repeat(128)}}]);r=await w.check();assert.equal(r.unresolved.length,1);
});

test('文件数 / 请求数 / 关系数边界给出未完成状态，不把截断当作检查通过',async()=>{
 const w=await world([version('a',[required('b'),required('c')]),version('b'),version('c')],['a','b','c']);
 const input=w.s.plan.quickInput,services={versionFiles:w.MC.api.modrinth.versionFiles,versionsByIds:w.MC.api.modrinth.versionsByIds,versions:w.MC.api.modrinth.versions};
 let r=await w.MC.platformDeps.resolve({...input,limits:{nodes:1}},services);assert.equal(r.limited,true);assert.equal(errors(r).length,0);
 r=await w.MC.platformDeps.resolve({...input,limits:{requests:0}},services);assert.equal(r.limited,true);assert.equal(r.sourceIdentified,0);
 r=await w.MC.platformDeps.resolve({...input,limits:{relations:1}},services);assert.equal(r.limited,true);assert.ok(r.findings.some(f=>/上限/.test(f.reason)));
});

test('旧环境的异步结果不回写，候选按钮也不能加入过期方案',async()=>{
 const w=await world([version('a',[required('b')]),version('b')],['a']);
 await w.check();w.s.env.mc='1.21.1';w.MC.store.touch();assert.equal(w.MC.platformDeps.add(w.s,'pb'),false);
 w.s.env.mc='1.20.1';w.MC.store.touch();let finish;
 const normal=w.MC.api.modrinth.versionFiles;w.MC.api.modrinth.versionFiles=(...args)=>new Promise(r=>finish=async()=>r(await normal(...args)));
 const pending=w.check({force:true});w.s.env.mc='1.21.1';w.MC.store.touch();await finish();await pending;
 assert.equal(w.s.plan.quick,null);assert.notEqual(w.s.platformGraph.fingerprint,w.s.plan.quickFingerprint);
});

test('同一方案并发检查共享请求；候选环境 / 文件格式无效时不能加入',async()=>{
 const a=version('a',[required('b')]),b=version('b');b.files[0].filename='../bad.jar';
 const w=await world([a,b],['a']);await Promise.all([w.check(),w.check()]);
 assert.equal(w.calls.filter(c=>c.type==='hash').length,1);assert.equal(w.s.plan.quick.candidates.length,0);
 assert.equal(w.MC.platformDeps.add(w.s,'pb'),false);
});

test('依赖的资源包已在原包中时不误报缺失，也不按 Forge / Fabric 加载器排除资源包',async()=>{
 const a=version('a',[required('resource')]),resource=version('resource',[],{loaders:['minecraft']});
 resource.files[0].filename='resource.zip';
 const w=await world([a,resource],['a',{...descriptor(resource),path:'resourcepacks/resource.zip'}]),r=await w.check();
 assert.equal(r.sourceIdentified,1);assert.equal(r.assetIdentified,1);assert.equal(errors(r).length,0);
 assert.equal(r.relations[0].state,'present-exact');
});

test('同一 JAR 在平台有多个发布版本时不误判字节相同的精确前置缺失',async()=>{
 const a=version('a',[required('b2','lib')]),b1=version('b1',[],{project_id:'lib'}),b2=version('b2',[],{project_id:'lib',files:b1.files});
 const w=await world([a,b1,b2],['a','b1']),r=await w.check();
 assert.equal(errors(r).length,0);assert.equal(r.relations[0].state,'same-file-unverified');
 assert.equal(r.candidates.length,0);
});

test('本地准确文件可满足平台前置，同名不同内容不能吞掉原包在线文件',async()=>{
 const a=version('a',[required('b')]),b=version('b'),w=await world([a,b],['a']);
 const file=new File(['file:b'],'b.jar');
 const local={uid:'localb',kind:'mod',id:'actual-b',name:'local b',fileName:'b.jar',version:'1',sha1:b.files[0].hashes.sha1,
  loader:'Forge',mcRange:'1.20.1',allIds:['actual-b'],deps:[],file};
 w.s.mods=[local];w.s.analysis=w.MC.analyzer.analyze(w.s.mods,w.s.env);w.MC.selector.assign(w.s,w.s.analysis);w.MC.store.touch();
 let r=await w.check();assert.equal(errors(r).length,0);assert.equal(r.relations[0].state,'present-exact');
 // 同名本地文件使用别的内容：原包 a.jar 必须仍在在线清单中。
 local.fileName='a.jar';local.file=new File(['different'],'a.jar');local.sha1=createHash('sha1').update('different').digest('hex');
 w.s.fileVersions[local.sha1]=version('local',[],{files:[{...version('local').files[0],hashes:{sha1:local.sha1}}]});
 w.MC.store.touch();await w.check();
 // 前置缺失时先不导出；去掉 a 的前置后复核文件保留。
 a.dependencies=[];w.MC.store.touch();await w.check({force:true});await w.MC.flowPack.buildPack('mrpack');
 assert.equal(w.app.saved.length,1);
 const zip=w.MC.zip.parseCentral(await w.app.saved[0].blob.arrayBuffer());const index=JSON.parse(await w.MC.zip.readEntry(zip,'modrinth.index.json'));
 assert.ok(index.files.some(f=>f.path==='mods/a.jar'&&f.hashes.sha1===a.files[0].hashes.sha1));
 assert.ok([...zip.map.keys()].some(p=>/^overrides\/mods\/a.*\.jar$/.test(p)));
});

test('候选加入、移除和快速检查依据在整理区与预览一致显示',async()=>{
 const w=await world([version('a',[required('b')]),version('b')],['a']);await w.check();
 const nodes={deps:{innerHTML:''},pack:{innerHTML:''}};w.app.ctx.document={getElementById:id=>nodes[id]};
 w.app.load('js/ui/render-base.js');w.app.load('js/core/search.js');w.app.load('js/ui/views/organize/deps.js');
 w.app.load('js/ui/views/organize/pack.js');w.app.load('js/ui/views/preview.js');
 w.MC.render.renderDeps(w.s);assert.match(nodes.deps.innerHTML,/加入此候选/);assert.match(nodes.deps.innerHTML,/精确发布版本/);
 w.MC.actionCtx={touch:()=>w.MC.store.touch(),toast:()=>{}};w.app.load('js/ui/actions/organize.js');
 w.MC.actions['platform-add']({dataset:{project:'pb'}});await w.check();
 w.MC.render.renderPack(w.s);assert.match(nodes.pack.innerHTML,/平台候选 1/);
 assert.match(w.MC.render.previewHtml(w.s),/未读取 JAR 内部信息/);
 w.MC.actions['platform-remove']({dataset:{project:'pb'}});assert.equal(w.s.plan.platformOnline.length,0);
});

test('81 个哈希按 80 + 1 批量查询；相同文件共享识别结果',async()=>{
 const versions=Array.from({length:81},(_,i)=>version('v'+i));
 const w=await world(versions,versions.map(v=>v.id)),r=await w.check();
 assert.equal(r.sourceIdentified,81);assert.deepEqual(w.calls.filter(c=>c.type==='hash').map(c=>c.hashes.length),[80,1]);
});

test('整体检查时间上限可结束不返回的接口，结果明确待确认',async()=>{
 const w=await world([version('a')],['a']);
 const r=await w.MC.platformDeps.resolve({...w.s.plan.quickInput,limits:{ms:20}},
  {versionFiles:()=>new Promise(()=>{}),versionsByIds:async()=>[],versions:async()=>[]});
 assert.equal(r.status,'partial');assert.match(r.findings[0].reason,/时间上限/);assert.equal(errors(r).length,0);
});

test('Modrinth 封装发送正确的 SHA-512 算法和去重精确版本 ID',async()=>{
 const app=createApp(),requests=[];app.ctx.AbortSignal=AbortSignal;
 app.ctx.fetch=async(url,opts)=>{requests.push({url,opts});return new Response(JSON.stringify(url.includes('/versions?')?[]:{}),{headers:{'Content-Type':'application/json'}});};
 app.load('js/api/modrinth.js');await app.MC.api.modrinth.versionFiles(['a','a'],'sha512');
 await app.MC.api.modrinth.versionsByIds(['v1','v1','v2']);
 const body=JSON.parse(requests[0].opts.body);assert.equal(body.algorithm,'sha512');assert.deepEqual(body.hashes,['a']);
 const ids=new URL(requests[1].url).searchParams.get('ids');assert.deepEqual(JSON.parse(ids),['v1','v2']);
});

test('自动检查会处理纯在线包，完成后不因状态刷新无限重复请求',async()=>{
 const w=await world([version('a')],['a']);w.MC.platformDeps.auto=true;w.MC.store.touch();
 await new Promise(r=>setTimeout(r,380));assert.equal(w.s.plan.quick.sourceIdentified,1);
 w.MC.store.touch();await new Promise(r=>setTimeout(r,330));
 assert.equal(w.calls.filter(c=>c.type==='hash').length,1);w.MC.platformDeps.auto=false;
});

test('导出等待快速检查期间切换目标环境，停止旧方案导出',async()=>{
 const w=await world([version('a')],['a']),normal=w.MC.api.modrinth.versionFiles;
 let finish;w.MC.api.modrinth.versionFiles=(...args)=>new Promise(r=>finish=async()=>r(await normal(...args)));
 const building=w.MC.flowPack.buildPack('mrpack');
 await new Promise(r=>setTimeout(r,0));assert.equal(typeof finish,'function');
 w.s.env.mc='1.21.1';w.MC.store.touch();await finish();await building;
 assert.equal(w.app.saved.length,0);assert.match(w.app.messages.at(-1),/方案已改变/);
});
