const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app.cjs');
const mod=(id,version,deps=[])=>({uid:id+version,id,name:id,version,kind:'mod',loader:'Forge',mcRange:'1.20.1',fileName:id+version+'.jar',sha1:id+version,allIds:[id],deps});
function setup(mods){const a=createApp(),s=a.MC.store.state;s.mods=mods;s.analysis=a.MC.analyzer.analyze(mods,s.env);a.MC.selector.assign(s,s.analysis);return a;}
test('前置约束全部保留并取交集',()=>{
 const a=setup([mod('a','1',[{modId:'lib',versionRange:'>=1'}]),mod('b','1',[{modId:'lib',versionRange:'>=2'}])]);
 a.MC.store.touch();const d=a.MC.store.state.deps[0];
 assert.equal(d.requirements.length,2);
 assert.equal(a.MC.version.mcMatches(d.range,'1.5'),false);
 assert.equal(a.MC.version.mcMatches(d.range,'2.1'),true);
});
test('切旧版本、排除前置和排除消费者都即时改变最终方案',()=>{
 const a=setup([mod('consumer','1',[{modId:'lib',versionRange:'>=2'}]),mod('lib','1'),mod('lib','2')]),s=a.MC.store.state;
 a.MC.store.touch();assert.equal(s.plan.analysis.versionIssues.length,0);
 s.selection.lib='lib1';a.MC.store.touch();assert.equal(s.plan.analysis.versionIssues.length,1);
 s.excluded.lib=true;a.MC.store.touch();assert.equal(s.plan.analysis.missing.length,1);
 s.excluded.consumer=true;a.MC.store.touch();assert.equal(s.plan.analysis.missing.length,0);assert.equal(s.deps.length,0);
});
test('未知版本不得判相等或满足约束',()=>{
 const a=setup([mod('consumer','1',[{modId:'lib',versionRange:'>=2'}]),mod('lib','Latest')]);
 assert.equal(a.MC.version.equals('Latest','Unknown'),false);
 a.MC.store.touch();assert.equal(a.MC.store.state.plan.uncertain.length,1);
});
test('冲突的前置要求保留来源，任何单个版本都不能冒充满足',()=>{
 const a=setup([mod('a','1',[{modId:'lib',versionRange:'<2'}]),mod('b','1',[{modId:'lib',versionRange:'>=2'}])]);
 a.MC.store.touch();const d=a.MC.store.state.deps[0];
 for(const v of ['1','2','3'])assert.equal(a.MC.version.mcMatches(d.range,v),false);
 assert.deepEqual(Array.from(d.requirements,r=>r.by),['a','b']);
});
test('已加入前置同时满足所有要求；要求变化时废弃旧匹配',()=>{
 const a=setup([mod('a','1',[{modId:'lib',versionRange:'>=2'}])]),s=a.MC.store.state;
 a.MC.store.touch();Object.assign(s.deps[0],{added:true,status:'ok',project:{id:'project',title:'Library'},version:{id:'v2',version_number:'2'}});
 a.MC.store.touch();assert.equal(s.plan.errors.length,0);assert.equal(s.plan.uncertain.length,1);
 s.mods[0].deps[0].versionRange='>=3';a.MC.store.touch();
 assert.equal(s.deps[0].added,false);assert.equal(s.plan.errors.length,1);
});
test('明确缺前置时导出前阻止，不产生文件',async()=>{
 const a=setup([mod('a','1',[{modId:'lib',versionRange:'>=2'}])]);
 await a.MC.flowPack.buildPack('mrpack');assert.equal(a.saved.length,0);
 assert.match(a.messages.at(-1),/缺少前置 lib/);
});
test('同名但不同内部 ID 的模组不自动合并丢弃',()=>{
 const x=mod('one','1'),y=mod('other','1');x.name=y.name='Shared Name';
 const a=setup([x,y]);a.MC.store.touch();assert.equal(a.MC.store.state.plan.rows.length,2);
});
test('手动候选请求过期后不覆盖新方案',async()=>{
 const a=setup([mod('a','1',[{modId:'lib',versionRange:'>=2'}])]);a.MC.store.touch();
 let generation=1,complete;a.MC.flowCommon.getGen=()=>generation;
 a.MC.resolver={resolveSlug:()=>new Promise(r=>complete=r)};
 a.load('js/ui/flow/analysis.js');const dep=a.MC.store.state.deps[0];
 const pending=a.MC.flowAnalysis.chooseCandidate(dep,'example');generation++;
 complete({ok:true,project:{title:'Wrong'},versions:[],version:{version_number:'2'}});await pending;
 assert.equal(dep.added,false);
});
