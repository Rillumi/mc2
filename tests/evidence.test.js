const test=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('./helpers/app.cjs');
const {createHash}=require('node:crypto');
const enc=new TextEncoder();
async function jar(a,fields={},name='demo-1.0.0.jar',extra=[]){
  const blob=await a.MC.zipWriter.build([{path:'fabric.mod.json',data:enc.encode(JSON.stringify({schemaVersion:1,id:'demo',version:'1.0.0',...fields}))},...extra]);
  const bytes=await blob.arrayBuffer(),res=await a.MC.metadata.inspect(bytes);
  return {...res.info,uid:name,kind:'mod',fileName:name,sha1:createHash('sha1').update(new Uint8Array(bytes)).digest('hex'),file:new File([blob],name)};
}
function platform(e,mc=['1.20.1'],id='release'){
  return {id,project_id:'project',version_number:'platform-9.9',game_versions:mc,loaders:['fabric'],dependencies:[],files:[{hashes:{sha1:e.sha1}}]};
}
const mcCheck=r=>r.records[0].checks.find(c=>c.dimension==='internal.minecraft');
test('平台未列出不伪造否定；内部声明满足及原值分别保留',async()=>{
  const a=createApp(),e=await jar(a,{depends:{minecraft:['1.20.1','1.20.2']}});
  const r=a.MC.evidence.review([e],{mc:'1.20.1',loader:'Fabric'},{versions:{[e.sha1]:platform(e,['1.20'])}});
  assert.equal(mcCheck(r).status,'satisfied');assert.deepEqual(Array.from(mcCheck(r).raw),['1.20.1','1.20.2']);
  assert.equal(r.records[0].checks.find(c=>c.dimension==='platform.minecraft').status,'not-listed');
  assert.ok(r.records[0].checks.some(c=>c.status==='coverage-gap'));
  assert.ok(!r.records[0].checks.some(c=>c.status==='violated'||c.status==='disagreement'));
});
test('内部排除且平台列出：保留声明不满足及来源差异；双方都未列支持不伪造差异',async()=>{
  const a=createApp(),e=await jar(a,{depends:{minecraft:'>=1.21'}}),env={mc:'1.20.1',loader:'Fabric'};
  const r=a.MC.evidence.review([e],env,{versions:{[e.sha1]:platform(e)}});
  assert.equal(mcCheck(r).status,'violated');assert.ok(mcCheck(r).reasons.includes('SOURCE_ENV_DISAGREEMENT'));
  const other=a.MC.evidence.review([e],env,{versions:{[e.sha1]:platform(e,['1.21'])}});
  assert.equal(mcCheck(other).status,'violated');assert.ok(!mcCheck(other).reasons.includes('SOURCE_ENV_DISAGREEMENT'));
});
test('平台离线不抹掉内部证据，尚未读取不冒充解析失败',async()=>{
  const a=createApp(),e=await jar(a,{depends:{minecraft:'1.20.1'}}),env={mc:'1.20.1',loader:'Fabric'};
  const r=a.MC.evidence.review([e],env,{platformStatus:'error'});
  assert.equal(mcCheck(r).status,'satisfied');assert.ok(r.records[0].checks.some(c=>c.reasons.includes('PLATFORM_REQUEST_FAILED')));
  const unread={uid:'remote',sha1:e.sha1,metadataRead:false,platformVersion:platform(e)};
  const q=a.MC.evidence.review([unread],env);assert.equal(mcCheck(q).status,'unchecked');
  assert.equal(q.records[0].checks.find(c=>c.dimension==='platform.minecraft').status,'listed');
});
test('不同文件哈希的旧版或移植版平台记录不得交叉比较',async()=>{
  const a=createApp(),e=await jar(a,{depends:{minecraft:'>=1.21'}}),v=platform(e);v.files[0].hashes.sha1='0'.repeat(40);
  const r=a.MC.evidence.review([e],{mc:'1.20.1',loader:'Fabric'},{versions:{[e.sha1]:v}});
  assert.equal(r.records[0].platform,null);assert.equal(mcCheck(r).status,'violated');
  assert.ok(!mcCheck(r).reasons.includes('SOURCE_ENV_DISAGREEMENT'));
  assert.ok(r.records[0].checks.some(c=>c.reasons.includes('IDENTITY_UNVERIFIED')));
  const fake={...e,sha1:'placeholder'};fake.platformVersion=platform(fake);
  assert.equal(a.MC.evidence.review([fake],{mc:'1.20.1',loader:'Fabric'}).records[0].platform,null);
});
test('平台不同加载器条件不构造同条件来源冲突；无匹配列表仍保留原始字段',async()=>{
  const a=createApp(),e=await jar(a,{depends:{minecraft:'>=1.21'}}),v=platform(e);v.loaders=['forge'];
  const r=a.MC.evidence.review([e],{mc:'1.20.1',loader:'Fabric'},{versions:{[e.sha1]:v}});
  assert.equal(mcCheck(r).status,'violated');assert.ok(!mcCheck(r).reasons.includes('SOURCE_ENV_DISAGREEMENT'));
  assert.equal(r.records[0].platform.loaders[0],'forge');
});
test('文件名兜底继续展示，但不会成为内部 MC 或提供者版本证据',async()=>{
  const a=createApp(),provider=await jar(a,{id:'lib',version:'1.0.0'},'lib-2.5.0-mc1.20.1.jar');
  await a.MC.flowScan.importFiles([provider.file]);const parsed=a.MC.store.state.mods[0];
  assert.equal(parsed.version,'2.5.0');assert.equal(parsed.versionEvidence.source,'filename');
  assert.equal(parsed.metadataEvidence[0].mods[0].rawVersion,'1.0.0');assert.equal(parsed.mcEvidence.source,'filename');
  const consumer=await jar(a,{id:'consumer',depends:{lib:'>=2'}},'consumer.jar');
  const r=a.MC.evidence.review([consumer,parsed],{mc:'1.20.1',loader:'Fabric'},{providersComplete:true});
  assert.equal(r.records[0].checks.find(c=>c.targetId==='lib').status,'violated');
  assert.equal(r.records[1].checks.find(c=>c.dimension==='internal.minecraft').status,'not-declared');
});
test('当前前置不满足某条要求，不误标范围无交集；不同平台发布号不代替内部版本',async()=>{
  const a=createApp(),p=await jar(a,{id:'lib',version:'1.5'},'lib.jar');
  p.platformVersion=platform(p);const x=await jar(a,{id:'a',depends:{lib:'>=1 <3'}},'a.jar');
  const y=await jar(a,{id:'b',depends:{lib:'>=2 <4'}},'b.jar');
  const r=a.MC.evidence.review([x,y,p],{mc:'1.20.1',loader:'Fabric'},{providersComplete:true});
  assert.equal(r.records[0].checks.find(c=>c.targetId==='lib').status,'satisfied');
  assert.equal(r.records[1].checks.find(c=>c.targetId==='lib').status,'violated');
  assert.ok(!JSON.stringify(r).includes('DEP_RANGES_DISJOINT'));
});
test('必需、可选、未知提供者和别名未知版本分开；通配符无需捏造版本号',async()=>{
  const a=createApp(),x=await jar(a,{depends:{lib:'>=2'},recommends:{optional:'*'}});
  const env={mc:'1.20.1',loader:'Fabric'};
  const r=a.MC.evidence.review([x],env,{providersComplete:true});
  assert.equal(r.records[0].checks.find(c=>c.targetId==='lib').status,'violated');
  assert.equal(r.records[0].checks.find(c=>c.targetId==='optional').status,'not-applicable');
  const unknown=a.MC.evidence.review([x],env);assert.equal(unknown.records[0].checks.find(c=>c.targetId==='lib').status,'insufficient');
  const alias=await jar(a,{id:'container',provides:['lib']},'container.jar');
  const q=a.MC.evidence.review([x,alias],env,{providersComplete:true});assert.equal(q.records[0].checks.find(c=>c.targetId==='lib').status,'insufficient');
  const any=await jar(a,{id:'any',depends:{lib:'*'}},'any.jar'),p=await jar(a,{id:'lib',version:'opaque-release'},'lib.jar');
  const w=a.MC.evidence.review([any,p],env,{providersComplete:true});assert.equal(w.records[0].checks.find(c=>c.targetId==='lib').status,'satisfied');
  const other=await jar(a,{id:'lib',version:'3'},'lib-other.jar');
  assert.ok(a.MC.evidence.review([any,p,other],env,{providersComplete:true}).records[0].checks.find(c=>c.targetId==='lib').reasons.includes('MULTIPLE_PROVIDERS'));
  p.metadataEvidence[0].mods[0].rawVersion=null;
  assert.equal(a.MC.evidence.review([any,p],env,{providersComplete:true}).records[0].checks.find(c=>c.targetId==='lib').status,'insufficient');
});
test('范围语法不支持、缺省未声明、错误值及未知 schema 不混淆',async()=>{
  const a=createApp(),env={mc:'1.20.1',loader:'Fabric'};
  for(const [fields,status,reason] of [[{depends:{minecraft:'banana'}},'insufficient','RANGE_UNSUPPORTED'],
    [{},'not-declared','MC_REQUIREMENT_NOT_DECLARED'],[{depends:{minecraft:17}},'insufficient','METADATA_VALUE_INVALID'],
    [{schemaVersion:999,depends:{minecraft:'*'}},'insufficient','METADATA_FORMAT_UNSUPPORTED'],
    [{depends:[]},'insufficient','METADATA_VALUE_INVALID']]){
    const e=await jar(a,fields),c=mcCheck(a.MC.evidence.review([e],env));assert.equal(c.status,status);assert.ok(c.reasons.includes(reason));
  }
});
test('Forge 多 owner 的 MC 条件、默认通配范围和 MANIFEST 版本保留来源',async()=>{
  const a=createApp();
  const toml='[[mods]]\nmodId="aa"\nversion="${file.jarVersion}"\n[[mods]]\nmodId="bb"\nversion="2"\n'+
    '[[dependencies.aa]]\nmodId="minecraft"\nmandatory=true\nversionRange="[1.20,1.21)"\n'+
    '[[dependencies.bb]]\nmodId="minecraft"\nmandatory=true\nversionRange="[1.21,)"\nside="SERVER"\n'+
    '[[dependencies.aa]]\nmodId="lib"\nmandatory=true\n';
  const blob=await a.MC.zipWriter.build([{path:'META-INF/mods.toml',data:enc.encode(toml)},
    {path:'META-INF/MANIFEST.MF',data:enc.encode('Implementation-Version: 4.5.6\n')}]);
  const res=await a.MC.metadata.inspect(await blob.arrayBuffer()),e={...res.info,uid:'forge'};
  const s=e.metadataEvidence[0];assert.equal(s.mods[0].rawVersion,'${file.jarVersion}');assert.equal(s.mods[0].version,'4.5.6');
  assert.match(s.mods[0].versionSource,/MANIFEST/);assert.equal(s.requirements.find(r=>r.modId==='lib').defaulted,true);
  const r=a.MC.evidence.review([e],{mc:'1.20.1',loader:'Forge'});
  const checks=r.records[0].checks.filter(c=>c.dimension==='internal.minecraft');
  assert.equal(checks[0].status,'satisfied');assert.equal(checks[1].status,'insufficient');assert.ok(checks[1].reasons.includes('TARGET_SIDE_UNKNOWN'));
  const invalid=await a.MC.zipWriter.build([{path:'META-INF/mods.toml',data:enc.encode('[[mods]]\nmodId="bad"\nversion="1"\n[[dependencies.bad]]\nmodId="minecraft"\n')}]);
  const missing=await a.MC.metadata.inspect(await invalid.arrayBuffer());
  assert.ok(mcCheck(a.MC.evidence.review([{...missing.info,uid:'bad'}],{mc:'1.20.1',loader:'Forge'})).reasons.includes('METADATA_STRUCTURE_UNVERIFIED'));
});
test('同包的其他加载器及无法解析文件不混入当前加载器结论',async()=>{
  const a=createApp(),forge='[[mods]]\nmodId="demo"\nversion="1"\n[[dependencies.demo]]\nmodId="minecraft"\nmandatory=true\nversionRange="[1.21,)"';
  const e=await jar(a,{depends:{minecraft:'1.20.1'}},'multi.jar',[{path:'META-INF/mods.toml',data:enc.encode(forge)}]);
  assert.equal(mcCheck(a.MC.evidence.review([e],{mc:'1.20.1',loader:'Fabric'})).status,'satisfied');
  assert.equal(mcCheck(a.MC.evidence.review([e],{mc:'1.20.1',loader:'Forge'})).status,'violated');
  e.metadataEvidence[0].state='parse-failed';assert.ok(mcCheck(a.MC.evidence.review([e],{mc:'1.20.1',loader:'Fabric'})).reasons.includes('METADATA_PARSE_FAILED'));
});
test('实际损坏 JSON 保留解析失败，不能报成尚未下载；端不确定的提供者不冒充已安装',async()=>{
  const a=createApp(),blob=await a.MC.zipWriter.build([{path:'fabric.mod.json',data:enc.encode('{broken')}]);
  const res=await a.MC.metadata.inspect(await blob.arrayBuffer());assert.equal(res.kind,'unknown');
  const r=a.MC.evidence.review([{uid:'bad',metadataEvidence:res.metadataEvidence}],{mc:'1.20.1',loader:'Fabric'});
  assert.ok(mcCheck(r).reasons.includes('METADATA_PARSE_FAILED'));
  const connector=await a.MC.zipWriter.build([{path:'META-INF/MANIFEST.MF',data:enc.encode('Automatic-Module-Name: org.sinytra.connector\nImplementation-Version: 1.0+1.20.1\n')}]);
  const derived=await a.MC.metadata.inspect(await connector.arrayBuffer());assert.equal(derived.info.metadataRead,true);
  assert.ok(mcCheck(a.MC.evidence.review([{...derived.info,uid:'connector'}],{mc:'1.20.1',loader:'Forge'})).reasons.includes('DECLARATION_DERIVED'));
  const x=await jar(a,{id:'consumer',depends:{lib:'>=1'}},'consumer.jar'),p=await jar(a,{id:'lib',environment:'client'},'lib.jar');
  const q=a.MC.evidence.review([x,p],{mc:'1.20.1',loader:'Fabric'},{providersComplete:true});
  assert.equal(q.records[0].checks.find(c=>c.targetId==='lib').status,'insufficient');
});
test('计划中的证据随环境更新，输出快照不被后来平台修改污染；导出判级暂不接管',async()=>{
  const a=createApp(),e=await jar(a,{depends:{minecraft:'1.20.1'}});
  Object.assign(a.MC.store.state.env,{mc:'1.20.1',loader:'Fabric'});
  await a.MC.flowScan.importFiles([e.file]);const s=a.MC.store.state,local=s.mods[0];
  const v=platform(local);s.fileVersions={[local.sha1]:v};a.MC.store.touch();
  const old=s.plan.evidence;assert.equal(mcCheck(old).status,'satisfied');
  v.game_versions.push('1.21');assert.deepEqual(Array.from(old.records[0].platform.game_versions),['1.20.1']);
  s.env.mc='1.21';a.MC.store.touch();assert.notEqual(s.plan.evidence,old);assert.equal(s.plan.evidence.environment.mc,'1.21');
  assert.equal(s.plan.evidence.mode,'diagnostic-only');assert.equal(old.environment.mc,'1.20.1');
});
test('诊断报告实际导出新依据，原有下载与内部强互斥阻止不被新模型绕开',async()=>{
  const a=createApp(),x=await jar(a,{id:'aa',breaks:{bb:'*'},depends:{unverified_provider:'*'}},'a.jar'),y=await jar(a,{id:'bb'},'b.jar');
  Object.assign(a.MC.store.state.env,{mc:'1.20.1',loader:'Fabric'});
  await a.MC.flowScan.importFiles([x.file,y.file]);a.MC.store.touch();const s=a.MC.store.state;assert.ok(s.plan.errors.length);
  assert.equal(s.plan.evidence.records[0].checks.find(c=>c.targetId==='unverified_provider').status,'insufficient');
  a.MC.actionCtx={touch:()=>a.MC.store.touch(),toast:()=>{}};
  a.load('js/ui/actions/organize.js');a.ctx.location={origin:'http://local',pathname:'/'};a.ctx.navigator={userAgent:'test'};
  await a.MC.actions.diag();const text=await a.saved.at(-1).blob.text();assert.match(text,/声明证据核对/);assert.match(text,/fabric.mod.json|MC_REQUIREMENT_NOT_DECLARED/);
  const before=a.saved.length;await a.MC.flowPack.buildPack('mrpack');assert.equal(a.saved.length,before);
});
