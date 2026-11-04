const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app.cjs');

async function fabric(app,id,extra={}) {
 const blob=await app.MC.zipWriter.build([{path:'fabric.mod.json',data:new TextEncoder().encode(JSON.stringify({schemaVersion:1,id,name:id,version:'1.2.3',...extra}))}]);
 return new File([blob],id+'.jar');
}
async function setup(files,env={loader:'Fabric',mc:'1.20.1',loaderVersion:'0.16.0'}) {
 const app=createApp();app.MC.store.state.env=env;
 const samples=await files(app);
 await app.MC.flowScan.importFiles(samples);
 app.MC.store.touch();return app;
}
function platform(e,id,project,deps=[]) {
 return {id,project_id:project,dependencies:deps,files:[{hashes:{sha1:e.sha1}}]};
}

test('Fabric 单向 breaks 阻止导出，来源与范围可见；排除对方后消失',async()=>{
 const a=await setup(async a=>[await fabric(a,'aa',{breaks:{bb:'>=1.0 <2.0'}}),await fabric(a,'bb')]);
 const s=a.MC.store.state;
 assert.equal(s.plan.analysis.conflicts.length,1);
 assert.match(s.plan.errors[0],/aa 与 bb.*fabric.mod.json breaks/);
 assert.equal(s.plan.summary.status,'error');
 await a.MC.flowPack.buildPack('mrpack');assert.equal(a.saved.length,0);
 s.excluded.bb=true;a.MC.store.touch();assert.equal(s.plan.errors.length,0);
});

test('Fabric conflicts 仅警告，仍可导出且回读不清除警告',async()=>{
 const a=await setup(async a=>[await fabric(a,'aa',{conflicts:{bb:'*'}}),await fabric(a,'bb')]);
 const s=a.MC.store.state;assert.equal(s.plan.errors.length,0);assert.equal(s.plan.warnings.length,1);
 await a.MC.flowPack.buildPack('mrpack');assert.equal(a.saved.length,1);
 assert.equal(s.lastPack.warnings.length,1);assert.match(a.messages.at(-1),/1 项警告.*文件与清单校验通过/);
});

test('冲突版本范围之外不误报，换到命中的版本后才出现',async()=>{
 const a=await setup(async a=>[await fabric(a,'aa',{breaks:{bb:'<2.0'}}),await fabric(a,'bb',{version:'2.0.0'})]);
 assert.equal(a.MC.store.state.plan.errors.length,0);
 const b=await setup(async a=>[await fabric(a,'aa',{breaks:{bb:'<2.0'}}),await fabric(a,'bb',{version:'1.9.9'})]);
 assert.equal(b.MC.store.state.plan.errors.length,1);
});

test('Fabric 版本数组按 OR；裸版本严格相等；0.x caret 按 Fabric 规则',()=>{
 const C=createApp().MC.conflicts;
 assert.equal(C.match(['<1','>=3'],'3.1'),true);
 assert.equal(C.match(['<1','>=3'],'2'),false);
 assert.equal(C.match('1.2','1.2.3'),false);
 assert.equal(C.match('^0.2.0','0.9.0'),true);
 assert.equal(C.match('~1.2.0','1.3.0'),false);
 assert.equal(C.match('>=1.0.0-beta.2 <1.0.0','1.0.0-beta.11'),true);
 assert.equal(C.match('1.2.x','1.2.3'),true);
});

test('未知版本与未知范围保留待确认；不套用含糊的数字提取',async()=>{
 const a=await setup(async a=>[await fabric(a,'aa',{breaks:{bb:'>=2'}}),await fabric(a,'bb',{version:'latest'})]);
 const p=a.MC.store.state.plan;
 assert.equal(p.errors.length,0);assert.equal(p.analysis.conflicts[0].severity,'pending');
 assert.match(p.analysis.conflicts[0].reason,/无法可靠比较/);
 assert.equal(a.MC.conflicts.match('nonsense','1.0'),null);
 assert.equal(a.MC.conflicts.match(null,'1.0'),null);
 assert.equal(a.MC.conflicts.match([],'1.0'),null);
});

test('Maven 区间边界、空端点、空格和并集；不支持的限定符待确认',()=>{
 const C=createApp().MC.conflicts;
 assert.equal(C.match('[1, 2)','1.9','maven'),true);
 assert.equal(C.match('[1,2)','2','maven'),false);
 assert.equal(C.match('(,1],[3,)','2','maven'),false);
 assert.equal(C.match('(,1],[3,)','3','maven'),true);
 assert.equal(C.match('[1.2]','1.2','maven'),true);
 assert.equal(C.match('[1,2)','1.5-custom','maven'),null);
});

test('NeoForge 保留 owner、范围、reason、side，区分 incompatible / discouraged',async()=>{
 const a=createApp();
 const toml='[[mods]]\nmodId="aa"\nversion="1"\n[[dependencies.aa]]\nmodId="bb"\ntype="incompatible"\nversionRange="[1, 2)"\nreason="bad pair"\nside="CLIENT"\n[[dependencies.aa]]\nmodId="cc"\ntype="discouraged"\nversionRange="*"';
 const blob=await a.MC.zipWriter.build([{path:'META-INF/neoforge.mods.toml',data:new TextEncoder().encode(toml)}]);
 const r=await a.MC.metadata.inspect(await blob.arrayBuffer());
 assert.equal(r.info.conflicts.length,2);assert.equal(r.info.deps.length,0);
 assert.equal(r.info.conflicts[0].ownerId,'aa');assert.equal(r.info.conflicts[0].reason,'bad pair');
 const b={uid:'b',id:'bb',name:'bb',version:'1.5',loader:'NeoForge',allIds:['bb']};
 const c={...b,uid:'c',id:'cc',name:'cc',allIds:['cc']};
 const source={...r.info,uid:'a'};
 let found=a.MC.conflicts.analyze([source,b,c],{loader:'NeoForge'});
 assert.equal(found[0].severity,'pending');assert.equal(found[1].severity,'warning');
 found=a.MC.conflicts.analyze([source,b,c],{loader:'NeoForge',side:'client'});
 assert.equal(found[0].severity,'error');assert.match(found[0].reason,/bad pair/);
 found=a.MC.conflicts.analyze([source,b,c],{loader:'NeoForge',side:'server'});
 assert.equal(found.length,1);
});

test('冲突匹配不把不同内部 ID 归一成同一个，也不拿别名冒用主模组版本',()=>{
 const C=createApp().MC.conflicts;
 const a={uid:'a',id:'aa',name:'aa',loader:'Fabric',conflicts:[{modId:'fabric_xyz',versionRange:'*'}]};
 const b={uid:'b',id:'fabric_other',allIds:['fabric_other'],loader:'Fabric',version:'1'};
 assert.equal(C.analyze([a,b],{loader:'Fabric'}).length,0);
 a.conflicts=[{modId:'alias',versionRange:'>=2'}];b.allIds=['fabric_other','alias'];
 assert.equal(C.analyze([a,b],{loader:'Fabric'})[0].severity,'pending');
});

test('多模组 JAR 用被引用内部 ID 的实际版本，忽略其他加载器与不存在 owner 的声明',()=>{
 const C=createApp().MC.conflicts;
 const a={uid:'a',id:'aa',loader:'NeoForge',conflicts:[{modId:'bb',versionRange:'[2,)',syntax:'maven',loader:'NeoForge'}]};
 const b={uid:'b',id:'primary',version:'1',loader:'NeoForge',allIds:['primary','bb'],declaredMods:[{id:'primary',version:'1'},{id:'bb',version:'3'}]};
 assert.equal(C.analyze([a,b],{loader:'NeoForge'})[0].severity,'error');
 a.conflicts[0].loader='Fabric';assert.equal(C.analyze([a,b],{loader:'NeoForge'}).length,0);
 a.conflicts[0].loader='NeoForge';a.conflicts[0].ownerId='missing';
 assert.equal(C.analyze([a,b],{loader:'NeoForge'}).length,0);
});

test('Modrinth 项目级 / 精确版本互斥不会扩大到其他版本；必须有准确文件身份',async()=>{
 const a=await setup(async a=>[await fabric(a,'aa'),await fabric(a,'bb')]),s=a.MC.store.state;
 const [x,y]=s.mods;
 const vx=platform(x,'va','pa',[{dependency_type:'incompatible',project_id:'pb',version_id:'old-b'}]);
 const vy=platform(y,'new-b','pb');s.fileVersions={[x.sha1]:vx,[y.sha1]:vy};a.MC.store.touch();
 assert.equal(s.plan.errors.length,0);
 vx.dependencies[0].version_id='new-b';a.MC.store.touch();assert.equal(s.plan.errors.length,1);
 delete vx.dependencies[0].version_id;a.MC.store.touch();assert.equal(s.plan.errors.length,1);
 s.fileVersions[y.sha1]={...vy,files:[{hashes:{sha1:'wrong'}}]};a.MC.store.touch();
 assert.equal(s.plan.errors.length,0);assert.equal(s.plan.coverage.platformUnchecked,1);
 vx.dependencies=[{dependency_type:'incompatible',file_name:'unknown.jar'}];a.MC.store.touch();
 assert.ok(s.plan.findings.some(f=>/缺少目标身份/.test(f.reason)));
});

test('平台与 JAR 范围矛盾时保留双方证据，降为待核实',async()=>{
 const a=await setup(async a=>[await fabric(a,'aa',{breaks:{bb:'<1'}}),await fabric(a,'bb')]),s=a.MC.store.state;
 const [x,y]=s.mods;s.fileVersions={[x.sha1]:platform(x,'va','pa',[{dependency_type:'incompatible',project_id:'pb'}]),[y.sha1]:platform(y,'vb','pb')};
 a.MC.store.touch();assert.equal(s.plan.errors.length,0);
 assert.match(s.plan.analysis.conflicts[0].reason,/平台与 JAR.*Modrinth.*另一依据 fabric.mod.json/);
 assert.equal(s.plan.analysis.conflicts[0].severity,'pending');
});

test('平台预取保存精确版本；项目简介失败不丢失关系；旧请求不回写',async()=>{
 const a=await setup(async a=>[await fabric(a,'aa')]),s=a.MC.store.state,x=s.mods[0];
 let gen=1,finish;a.MC.flowCommon.getGen=()=>gen;
 a.MC.api.modrinth.versionFiles=async()=>({[x.sha1]:platform(x,'va','pa')});
 a.MC.api.modrinth.projectsByIds=async()=>{throw Error('description unavailable');};
 a.load('js/core/catalog.js');s.catsTried=true;s.catsDb={};
 a.load('js/ui/flow/metadata.js');await a.MC.flowMeta.prefetchProjects();
 assert.equal(s.fileVersions[x.sha1].id,'va');assert.equal(s.platformCheck.status,'done');
 a.MC.api.modrinth.versionFiles=()=>new Promise(r=>finish=r);
 const pending=a.MC.flowMeta.prefetchProjects();gen++;
 s.fileVersions={};s.platformCheck={status:'idle'};
 finish({[x.sha1]:platform(x,'stale','pa')});await pending;
 assert.equal(Object.keys(s.fileVersions).length,0);assert.equal(s.platformCheck.status,'idle');
});

test('平台请求失败如实显示覆盖范围；重新查询可以恢复',async()=>{
 const a=await setup(async a=>[await fabric(a,'aa')]),s=a.MC.store.state,x=s.mods[0];
 a.MC.flowCommon.getGen=()=>1;a.MC.api.modrinth.versionFiles=async()=>{throw Error('offline');};
 a.load('js/core/catalog.js');s.catsTried=true;s.catsDb={};
 a.load('js/ui/flow/metadata.js');await a.MC.flowMeta.prefetchProjects();
 assert.equal(s.plan.summary.status,'pending');assert.match(s.plan.findings.at(-1).reason,/offline/);
 a.MC.api.modrinth.versionFiles=async()=>({[x.sha1]:platform(x,'va','pa')});
 a.MC.api.modrinth.projectsByIds=async()=>[];await a.MC.flowMeta.prefetchProjects();
 assert.equal(s.plan.coverage.platform,1);assert.equal(s.plan.summary.status,'checked');
 a.MC.api.modrinth.versionFiles=async()=>{throw Error('refresh offline');};await a.MC.flowMeta.prefetchProjects();
 assert.equal(s.plan.summary.status,'pending');assert.match(s.plan.findings.at(-1).reason,/沿用先前/);
 a.MC.api.modrinth.versionFiles=async()=>({});await a.MC.flowMeta.prefetchProjects();
 assert.equal(s.plan.coverage.platform,0);assert.equal(s.plan.summary.status,'pending');
});

test('纯在线清单、元数据错误和未知版本不显示全部通过；结果 HTML 转义声明',async()=>{
 const a=await setup(async a=>[await fabric(a,'aa',{conflicts:{bb:'*'},name:'<script>bad</script>'}),await fabric(a,'bb')]);
 a.load('js/ui/render-base.js');a.load('js/ui/views/organize/pack.js');
 const html=a.MC.render.checkSummaryHtml(a.MC.store.state.plan);
 assert.match(html,/明确错误 0 · 警告 1 · 待确认 1/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 const nodes={pack:{innerHTML:''},deps:{innerHTML:''}};a.ctx.document={getElementById:id=>nodes[id]};
 a.load('js/core/search.js');a.load('js/ui/views/organize/deps.js');a.load('js/ui/views/preview.js');
 a.MC.render.renderPack(a.MC.store.state);a.MC.render.renderDeps(a.MC.store.state);
 assert.match(nodes.pack.innerHTML,/明确错误 0 · 警告 1 · 待确认 1/);
 assert.match(nodes.deps.innerHTML,/警告.*&lt;script&gt;/);
 assert.match(a.MC.render.previewHtml(a.MC.store.state),/明确错误 0 · 警告 1 · 待确认 1/);
 const s=a.MC.store.state;s.mods[0].error='broken';a.MC.store.touch();assert.match(s.plan.findings.map(f=>f.reason).join(';'),/元数据不完整/);
 s.mods=[];s.packSources=[{name:'online',onlineList:[{path:'mods/aa.jar'}]}];s.analysis=a.MC.analyzer.analyze([],s.env);a.MC.store.touch();
 assert.equal(s.plan.summary.status,'pending');assert.equal(s.plan.coverage.sourceOnline,1);
 assert.match(a.MC.render.checkSummaryHtml(s.plan),/原包在线模组 1 项尚未展开/);
});

test('导出期间新增平台互斥结果会中止，不能下载过期方案',async()=>{
 const a=await setup(async a=>[await fabric(a,'aa'),await fabric(a,'bb')]),s=a.MC.store.state;
 const [x,y]=s.mods,original=x.file.arrayBuffer.bind(x.file);
 x.file={arrayBuffer:async()=>{
   s.fileVersions={[x.sha1]:platform(x,'va','pa',[{dependency_type:'incompatible',project_id:'pb'}]),[y.sha1]:platform(y,'vb','pb')};
   a.MC.store.touch();return original();
 }};
 await a.MC.flowPack.buildPack('mrpack');assert.equal(a.saved.length,0);
 assert.match(a.messages.at(-1),/方案已改变|选择或目标环境已改变/);
});

test('新增在线 JAR 的互斥进入最终方案；文件缓存不冻结平台声明',async()=>{
 const {createHash}=require('node:crypto');
 const a=await setup(async a=>[await fabric(a,'aa',{depends:{bb:'*'}}),await fabric(a,'cc')]),s=a.MC.store.state;
 const remote=await fabric(a,'bb',{breaks:{cc:'<1'}}),bytes=new Uint8Array(await remote.arrayBuffer());
 const hash=createHash('sha1').update(bytes).digest('hex');
 const cc=s.mods.find(e=>e.id==='cc');s.fileVersions[cc.sha1]=platform(cc,'vc','pc');
 let calls=0;a.MC.api.modrinth.download=async()=>{calls++;return bytes;};
 const version={id:'vb',project_id:'pb',version_number:'1.2.3',dependencies:[],files:[{
   url:'https://example.invalid/bb.jar',filename:'bb.jar',hashes:{sha1:hash},size:bytes.length}]};
 Object.assign(s.deps[0],{added:true,status:'ok',project:{id:'pb',title:'bb'},version});
 await a.MC.dependencies.checkState(s);assert.equal(s.plan.errors.length,0);
 version.dependencies=[{dependency_type:'incompatible',project_id:'pc'}];
 await a.MC.dependencies.checkState(s,{force:true});
 assert.equal(calls,1);assert.equal(s.plan.analysis.conflicts[0].severity,'pending');
 assert.match(s.plan.analysis.conflicts[0].reason,/平台与 JAR/);
 // 再将 JAR 的明确冲突换为另一份真实文件，导出必须阻止。
 const bad=await fabric(a,'bb',{breaks:{cc:'*'}}),badBytes=new Uint8Array(await bad.arrayBuffer());
 version.files[0]={...version.files[0],url:'https://example.invalid/bad.jar',size:badBytes.length,
   hashes:{sha1:createHash('sha1').update(badBytes).digest('hex')}};
 a.MC.api.modrinth.download=async()=>badBytes;
 await a.MC.dependencies.checkState(s,{force:true});assert.ok(s.plan.errors.some(e=>/bb 与 cc/.test(e)));
 await a.MC.flowPack.buildPack('mrpack');assert.equal(a.saved.length,0);
});

test('诊断报告包含当前方案的错误级别、范围、依据与未检查边界',async()=>{
 const a=await setup(async a=>[await fabric(a,'aa',{breaks:{bb:'*'}}),await fabric(a,'bb')]);
 a.MC.actionCtx={touch:()=>{},toast:()=>{}};
 a.ctx.location={origin:'http://localhost',pathname:'/'};a.ctx.navigator={userAgent:'test'};
 a.load('js/ui/actions/organize.js');await a.MC.actions.diag();
 const report=await a.saved.at(-1).blob.text();
 assert.match(report,/明确错误 1.*警告 0/);assert.match(report,/fabric.mod.json breaks/);
 assert.match(report,/内嵌依赖尚未完整核实/);assert.match(report,/模组 2/);
});
