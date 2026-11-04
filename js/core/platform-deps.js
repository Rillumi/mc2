/* 原包在线文件的接口检查。只检查当前方案，不替换原包版本，不下载 JAR。 */
(function(root) {
  'use strict';
  const MC=root.MC=root.MC||{};
  const lower=v=>String(v||'').toLowerCase();
  const validVersion=v=>v&&typeof v.id==='string'&&typeof v.project_id==='string'&&Array.isArray(v.dependencies)&&Array.isArray(v.files);
  const slug=loader=>({Forge:'forge',Fabric:'fabric',NeoForge:'neoforge'}[loader]||lower(loader));
  function hashOf(hashes) {
    if(/^[a-f0-9]{40}$/i.test(hashes?.sha1||''))return {algorithm:'sha1',hash:lower(hashes.sha1)};
    if(/^[a-f0-9]{128}$/i.test(hashes?.sha512||''))return {algorithm:'sha512',hash:lower(hashes.sha512)};
    return null;
  }
  function matchesFile(record,v) {
    const h=hashOf(record.hashes);
    return validVersion(v)&&h&&v.files.some(f=>lower(f?.hashes?.[h.algorithm])===h.hash&&
      ['sha1','sha512'].every(a=>!record.hashes[a]||!f.hashes[a]||lower(record.hashes[a])===lower(f.hashes[a])))&&
      (!record.versionId||record.versionId===v.id);
  }
  function certain(file,env) {
    if(!file.env)return true;
    if(env.side)return file.env[lower(env.side)]==='required';
    return file.env.client==='required'&&file.env.server==='required';
  }
  function input(st,local,online) {
    const compact=v=>v?Object.fromEntries(['id','project_id','version_number','name','version_type','date_published','dependencies','game_versions','loaders','files'].map(k=>[k,v[k]])):null;
    const records=[];
    (st.packSources||[]).forEach((p,i)=>(p.onlineList||[]).forEach((f,j)=>{
      const asset=!!f.path&&!/^mods\//i.test(f.path);
      records.push({key:'source:'+i+':'+j,kind:asset?'asset':'source',asset,name:p.name+' / '+(f.path||'CurseForge '+f.projectID+':'+f.fileID),
        hashes:f.hashes||{},versionId:f.version_id||f.versionId,required:certain(f,st.env)});
    }));
    local.forEach(e=>records.push({key:e.uid,kind:'local',name:e.name||e.fileName,hashes:{sha1:e.sha1},required:true,
      known:compact(MC.conflicts.versionFor(e,st.fileVersions))}));
    if(st.includePacks)(st.analysis?.others||[]).filter(e=>e.kind==='resourcepack'||e.kind==='shader').forEach(e=>
      records.push({key:e.uid,kind:'localasset',asset:true,name:e.name||e.fileName,hashes:{sha1:e.sha1},required:true,
        known:compact(MC.conflicts.versionFor(e,st.fileVersions))}));
    online.forEach((d,i)=>{const f=d.version?.files?.[0];records.push({key:'chosen:'+i,kind:'chosen',name:d.project?.title||d.id,
      hashes:f?.hashes||{},versionId:d.version?.id,required:true,known:compact(d.version)});});
    return {records,env:{...st.env},includeOptional:!!st.includeOptional,
      connector:MC.analyzer.detectConnector(local).has};
  }
  const fingerprint=opts=>JSON.stringify(opts);
  function environment(v,opts,asset=false) {
    if(!Array.isArray(v.game_versions)||!v.game_versions.length||!Array.isArray(v.loaders)||!v.loaders.length)return null;
    if(!v.game_versions.includes(opts.env.mc))return false;
    if(asset)return true;
    if(v.loaders.includes(slug(opts.env.loader)))return true;
    if(opts.connector&&opts.env.loader==='Forge'&&v.loaders.includes('fabric'))return null;
    return false;
  }
  function candidate(v,opts) {
    if(!validVersion(v)||environment(v,opts)!==true)return null;
    const f=v.files.find(f=>f?.primary)||v.files[0];
    if(!f||!/^[^\\/:*?"<>|\x00-\x1f]+\.jar$/i.test(f.filename||'')||!/^https:\/\//i.test(f.url||'')||
      !/^[a-f0-9]{40}$/i.test(f.hashes?.sha1||'')||!/^[a-f0-9]{128}$/i.test(f.hashes?.sha512||'')||!Number.isSafeInteger(f.size)||f.size<0)return null;
    return {...v,files:[f,...v.files.filter(x=>x!==f)]};
  }
  async function resolve(opts,services) {
    const limits={nodes:1024,relations:8192,requests:100,ms:90000,...opts.limits};
    const started=Date.now(),findings=[],relations=[],candidates=[],identified=[],unresolved=[],byHash={},versions=new Map();
    const nodes=new Map(),catalogs=new Map();let requests=0,limited=false;
    const pending=reason=>findings.push({severity:'pending',reason});
    function guard(){
      if(opts.isCurrent&&!opts.isCurrent())throw Error('检查方案已改变');
      if(Date.now()-started>limits.ms||requests>=limits.requests)throw Error('平台检查达到请求数或时间上限');
    }
    async function request(fn){
      guard();requests++;opts.onProgress?.({requests,identified:identified.length,total:opts.records.length});
      let timer;
      try{return await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('平台检查达到时间上限')),Math.max(1,limits.ms-(Date.now()-started)));})]);}
      finally{clearTimeout(timer);}
    }
    const records=opts.records.slice(0,limits.nodes);
    if(records.length<opts.records.length){limited=true;pending('平台检查超过 '+limits.nodes+' 个文件上限，剩余项未检查');}
    const accept=(r,v)=>{
      identified.push({key:r.key,kind:r.kind,name:r.name,versionId:v.id,projectId:v.project_id});
      if(r.hashes.sha1)byHash[lower(r.hashes.sha1)]=v;
      versions.set(v.id,v);
      let node=nodes.get(v.id);
      if(!node){node={version:v,name:r.name,required:false,records:[]};nodes.set(v.id,node);}
      node.required||=r.required;node.records.push(r);
    };
    try {
      const waiting=[];
      for(const r of records){
        if(matchesFile(r,r.known))accept(r,r.known);
        else if(hashOf(r.hashes))waiting.push(r);
        else unresolved.push(r);
      }
      for(const algorithm of ['sha1','sha512']) {
        const pool=waiting.filter(r=>hashOf(r.hashes).algorithm===algorithm);
        const hashes=[...new Set(pool.map(r=>hashOf(r.hashes).hash))];
        for(let i=0;i<hashes.length;i+=80) {
          const chunk=hashes.slice(i,i+80),map=await request(()=>services.versionFiles(chunk,algorithm));
          for(const r of pool.filter(r=>chunk.includes(hashOf(r.hashes).hash))) {
            const v=map?.[hashOf(r.hashes).hash];
            if(matchesFile(r,v))accept(r,v);else unresolved.push(r);
          }
        }
      }
    } catch(e) {
      limited=true;pending('平台文件识别未完成：'+e.message);
      const seen=new Set(identified.map(r=>r.key).concat(unresolved.map(r=>r.key)));
      records.filter(r=>!seen.has(r.key)).forEach(r=>unresolved.push(r));
    }
    if(unresolved.length)pending('有 '+unresolved.length+' 个文件无法定位 Modrinth 精确版本，不能据此断言缺少前置：'+unresolved.slice(0,4).map(r=>r.name).join('、'));
    const complete=!limited&&!unresolved.length;
    try {
      const wanted=new Set();
      for(const n of nodes.values())for(const d of n.version.dependencies) {
        if(relations.length>=limits.relations){limited=true;throw Error('依赖关系超过 '+limits.relations+' 条上限');}
        if(!d||!['required','optional','incompatible','embedded'].includes(d.dependency_type)) {
          pending(n.name+' 的平台依赖条目缺少有效类型');continue;
        }
        const edge={from:n.version.id,fromName:n.name,required:n.required,dependency_type:d.dependency_type,
          project_id:typeof d.project_id==='string'?d.project_id:null,version_id:typeof d.version_id==='string'?d.version_id:null,
          file_name:typeof d.file_name==='string'?d.file_name:null};relations.push(edge);
        if(edge.version_id&&!versions.has(edge.version_id)&&edge.dependency_type!=='incompatible'&&(edge.dependency_type!=='optional'||opts.includeOptional))wanted.add(edge.version_id);
      }
      const ids=[...wanted];
      for(let i=0;i<ids.length;i+=80) {
        const chunk=ids.slice(i,i+80),list=await request(()=>services.versionsByIds(chunk));
        if(!Array.isArray(list))throw Error('精确版本查询返回格式无效');
        list.filter(v=>validVersion(v)&&chunk.includes(v.id)).forEach(v=>versions.set(v.id,v));
      }
    } catch(e){limited=true;pending('平台依赖展开未完成：'+e.message);}
    const requestsByProject=new Map();
    const embedded=relations.filter(d=>d.dependency_type==='embedded');
    for(const n of nodes.values()) {
      const matches=environment(n.version,opts,n.records.every(r=>r.asset));
      if(matches!==true)findings.push({severity:matches===false&&n.required?'error':'pending',reason:n.name+
        (matches===false?' 的平台声明不支持目标 '+opts.env.mc+' / '+opts.env.loader:' 的平台环境信息不足或需要转接，需核实')});
    }
    for(const d of relations) {
      const type=d.dependency_type;
      const exact=d.version_id?versions.get(d.version_id):null;
      const project=d.project_id||exact?.project_id;
      const label=project||d.version_id||d.file_name||'未知目标';
      d.targetName=label;
      if(d.project_id&&exact&&d.project_id!==exact.project_id){d.state='unknown';pending(d.fromName+' 的依赖项目与精确版本身份矛盾：'+label);continue;}
      if(!project&&!d.version_id){d.state='unknown';pending(d.fromName+' 的 '+type+' 关系缺少目标项目 / 版本 ID');continue;}
      if(type==='embedded'){d.state='embedded';pending(d.fromName+' 声明内嵌 '+label+'，需读取 JAR 核实，暂不当作外部缺失项');continue;}
      const providers=[...nodes.values()].filter(n=>(!project||n.version.project_id===project)&&(!d.version_id||n.version.id===d.version_id));
      if(type==='incompatible'){d.state=providers.length?'conflict':'absent';continue;}
      if(providers.length) {
        d.state=d.version_id?'present-exact':'present-project';
        if(!providers.some(n=>n.required))pending(d.fromName+' 需要 '+label+'，但对应文件在原包中为可选或受目标端限制');
        if(!d.version_id)pending(d.fromName+' 的平台关系只指定项目 '+label+'，存在性已核对，内部版本区间仍需 JAR 核实');
        continue;
      }
      if(exact&&identified.some(r=>r.versionId!==exact.id&&records.some(file=>file.key===r.key&&matchesFile({...file,versionId:null},exact)))) {
        d.state='same-file-unverified';pending(d.fromName+' 的精确前置 '+label+' 与已选文件字节身份相同，但对应多个平台发布版本，需核实');continue;
      }
      if(type==='optional'){d.state='optional-absent';if(!opts.includeOptional)continue;}
      else {
        const bundled=embedded.some(e=>{
          const p=e.project_id||versions.get(e.version_id)?.project_id;
          return (project&&p===project)||(d.version_id&&e.version_id===d.version_id);
        });
        if(bundled){d.state='embedded-unverified';pending(d.fromName+' 需要 '+label+'，其他文件声明内嵌它；需先核实内嵌内容');continue;}
        const known=complete&&!limited;
        d.state=known?'missing':'unknown';
        findings.push({severity:known&&d.required?'error':'pending',reason:d.fromName+' 的平台必需前置 '+label+
          (d.version_id?'（精确版本 '+d.version_id+'）':'')+(known?' 不在当前方案中':' 尚未确认是否在未识别文件中')+
          (!d.required?'；上层文件本身有可选 / 目标端条件':'')});
      }
      if(!project){pending('无法取得 '+label+' 的项目身份，未生成可加入候选');continue;}
      if(!requestsByProject.has(project))requestsByProject.set(project,[]);
      requestsByProject.get(project).push(d);
    }
    for(const [project,needs] of requestsByProject) {
      const exacts=[...new Set(needs.filter(d=>d.dependency_type==='required'&&d.version_id).map(d=>d.version_id))];
      if(exacts.length>1) {
        findings.push({severity:needs.filter(d=>d.dependency_type==='required').every(d=>d.required)?'error':'pending',
          reason:'项目 '+project+' 有互不一致的精确版本要求：'+exacts.join('、')+'；不会自动替换原包版本'});continue;
      }
      if([...nodes.values()].some(n=>n.version.project_id===project)) {
        pending('项目 '+project+' 已有其他发布版本，需手动调整原包；不会另加一份版本掩盖冲突');continue;
      }
      try {
        let v;
        const pinned=exacts[0]||needs.find(d=>d.version_id)?.version_id;
        if(pinned)v=versions.get(pinned);
        else {
          if(!catalogs.has(project)) {
            const list=await request(()=>services.versions(project,opts.env));
            if(!Array.isArray(list)||list.length>500)throw Error('候选列表无效或超过 500 项上限');
            catalogs.set(project,list);
          }
          const list=catalogs.get(project).filter(v=>v.project_id===project&&candidate(v,opts));
          v=list.slice().sort((a,b)=>(a.version_type==='release'?0:1)-(b.version_type==='release'?0:1)||String(b.date_published||'').localeCompare(String(a.date_published||'')))[0];
        }
        const chosen=candidate(v,opts);
        if(!chosen||chosen.project_id!==project){pending('项目 '+project+' 未取得文件身份和目标环境均有效的候选');continue;}
        candidates.push({key:project,id:project,project:{id:project,title:chosen.name||project},version:chosen,
          requiredBy:[...new Set(needs.map(d=>d.fromName))],optional:needs.every(d=>d.dependency_type==='optional')});
      } catch(e){pending('项目 '+project+' 的候选查询未完成：'+e.message);}
    }
    const sourceEntries=[];
    for(const n of nodes.values()) {
      const r=n.records.find(r=>['source','asset','localasset','chosen'].includes(r.kind));if(!r)continue;
      const f=n.version.files.find(f=>matchesFile(r,{...n.version,files:[f]}));
      sourceEntries.push({uid:'platform:'+n.version.id,id:'platform:'+n.version.id,name:n.name,
        sha1:f?.hashes?.sha1||'',allIds:[],platformVersion:n.version,platformConditional:!n.required});
    }
    return {findings,relations,candidates,identified,unresolved:unresolved.map(r=>({key:r.key,name:r.name})),byHash,sourceEntries,
      sourceTotal:opts.records.filter(r=>r.kind==='source').length,sourceIdentified:identified.filter(r=>r.kind==='source').length,
      assetTotal:opts.records.filter(r=>r.kind==='asset').length,assetIdentified:identified.filter(r=>r.kind==='asset').length,
      nodes:nodes.size,requests,limited,status:limited||unresolved.length?'partial':'done'};
  }
  const running=new WeakMap();let timer;
  async function checkState(st,{force=false}={}) {
    const plan=MC.plan.refresh(st);if(!plan?.quickEnabled)return null;
    const key=plan.quickFingerprint;
    const active=running.get(st);if(active?.key===key)return active.promise;
    if(!force&&st.platformGraph?.fingerprint===key&&st.platformGraph.status!=='checking')return st.platformGraph.result;
    const snapshot=JSON.parse(JSON.stringify(plan.quickInput));
    st.platformGraph={fingerprint:key,status:'checking'};
    const promise=(async()=>{
      const result=await resolve({...snapshot,isCurrent:()=>MC.plan.refresh(st)?.quickFingerprint===key,
        onProgress:p=>{if(MC.plan.refresh(st)?.quickFingerprint===key){st.platformProgress=p;MC.store.touch();}}},{
          versionFiles:(hashes,algorithm)=>MC.api.modrinth.versionFiles(hashes,algorithm),
          versionsByIds:ids=>MC.api.modrinth.versionsByIds(ids),versions:(id,env)=>MC.api.modrinth.versions(id,env)});
      if(MC.plan.refresh(st)?.quickFingerprint===key){st.platformGraph={fingerprint:key,status:result.status,result};st.platformProgress=null;MC.store.touch();}
      return result;
    })();
    running.set(st,{key,promise});MC.store.touch();
    try{return await promise;}finally{if(running.get(st)?.promise===promise)running.delete(st);}
  }
  function schedule(st) {
    if(!MC.platformDeps.auto||st.busy||!st.plan?.quickEnabled)return;
    if(st.platformGraph?.fingerprint===st.plan.quickFingerprint)return;
    clearTimeout(timer);timer=setTimeout(()=>checkState(st).catch(e=>MC.uiBase.toast('平台依赖检查未完成：'+e.message)),300);
  }
  function add(st,project) {
    const plan=MC.plan.refresh(st);
    if(st.platformGraph?.fingerprint!==plan?.quickFingerprint||st.platformGraph?.status==='checking')return false;
    const c=st.platformGraph.result?.candidates.find(c=>c.key===project);if(!c)return false;
    st.platformSelections={...st.platformSelections,[project]:{...c,added:true,status:'ok',origin:'platform'}};
    MC.store.touch();return true;
  }
  MC.platformDeps={input,fingerprint,resolve,checkState,schedule,add,auto:false};
})(globalThis);
