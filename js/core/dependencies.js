/* 读取在线 JAR 元数据，展开必需前置闭包；只选择当前约束下的版本，不做无限回溯。 */
(function(root){
  'use strict';
  const MC=root.MC=root.MC||{};
  const norm=id=>MC.analyzer.normDep(id);
  const ids=e=>(e.allIds&&e.allIds.length?e.allIds:[e.id]).map(norm);
  const cache=new Map();
  function key(d){const f=d.version?.files?.[0];return JSON.stringify([d.project?.id,d.version?.id,f?.url,f?.hashes]);}
  async function inspect(d,services){
    const k=key(d);
    if(cache.has(k))return cache.get(k);
    const promise=(async()=>{
      const f=d.version?.files?.[0];
      if(!f?.url || !/^[a-f0-9]{40}$/i.test(f.hashes?.sha1||''))throw Error('缺少可信下载地址或 SHA-1：'+d.project?.title);
      const bytes=await services.download(f.url);
      if(bytes.length>64*1024*1024)throw Error('在线模组超过 64 MB 检查上限：'+f.filename);
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-1',bytes));
      const hash=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
      if(hash!==f.hashes.sha1.toLowerCase() || (f.size!=null&&bytes.length!==f.size))throw Error('在线模组下载校验失败：'+f.filename);
      const result=await services.inspect(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      if(result.kind!=='mod'||!result.info)throw Error('在线文件没有可解析的模组元数据：'+f.filename);
      return {...result.info,uid:'remote-'+hash,sha1:hash,fileName:f.filename,size:bytes.length};
    })();
    cache.set(k,promise);
    try {const e=await promise;if(cache.size>64)cache.delete(cache.keys().next().value);return e;}
    catch(e){cache.delete(k);throw e;}
  }

  async function resolve(opts,services){
    const local=opts.local||[], roots=[], automatic=new Map(), errors=[], edges=[];
    const env={...opts.env};
    const add=async d=>({item:d,entry:await inspect(d,services)});
    try{
      for(const d of opts.online||[])roots.push(await add(d));
      for(let pass=0;pass<24;pass++){
        const pool=roots.concat([...automatic.values()]);
        const reachable=new Map(local.map(e=>[e.uid,{entry:e}]));
        roots.forEach(n=>reachable.set(n.entry.uid,n));
        const queue=[...reachable.values()], requirements=new Map();edges.length=0;
        for(let i=0;i<queue.length;i++){
          if(queue.filter(n=>n.item).length>64)throw Error('在线依赖链超过 64 个模组，请缩小方案后检查');
          const e=queue[i].entry;
          for(const d of (e.deps||[]).concat(opts.includeOptional?e.optionalDeps||[]:[])){
            if(d.mandatory===false&&!opts.includeOptional)continue;
            const id=norm(d.modId);
            if(MC.analyzer.ENV_IDS.has(id))continue;
            if(!requirements.has(id))requirements.set(id,[]);
            requirements.get(id).push({by:e.name||e.id,range:d.versionRange||'*',modId:d.modId,local:local.includes(e)});
            edges.push({from:e.id,to:d.modId,range:d.versionRange||'*'});
            for(const n of pool.filter(n=>ids(n.entry).includes(id))){
              if(!reachable.has(n.entry.uid)){reachable.set(n.entry.uid,n);queue.push(n);}
            }
          }
        }
        let changed=false;
        for(const [id,reqs] of requirements){
          const providers=[...reachable.values()].filter(n=>ids(n.entry).includes(id));
          const ranges=reqs.map(r=>r.range);
          // 用户尚未加入的直接前置交由方案层提示，不越过其排除/取消选择。
          if(!providers.length&&reqs.every(r=>r.local))continue;
          if(providers.some(n=>!MC.version.parse(n.entry.version).ambiguous&&MC.version.mcMatches(ranges,n.entry.version)))continue;
          const detail=reqs.map(r=>r.by+' 要求 '+r.range).join('；');
          if(providers.some(n=>!n.item||roots.includes(n)))throw Error('所选前置 '+id+' 无法满足要求或版本未知：'+detail);
          const result=await services.resolve({id,modId:reqs[0].modId,range:ranges},{env,range:ranges});
          if(!result.ok||!result.version)throw Error('间接前置 '+id+' 没有可用版本：'+detail+'；'+(result.reason||'未匹配'));
          const item={key:'chain:'+id,id,modId:reqs[0].modId,project:result.project,version:result.version,status:'ok',added:true,requiredBy:reqs.map(r=>r.by)};
          const node=await add(item);
          if(!ids(node.entry).includes(id))throw Error('项目与前置内部 ID 不符：'+id+' → '+node.entry.id);
          if(!MC.version.mcMatches(ranges,node.entry.version))throw Error('前置实际版本不满足要求：'+id+'；'+detail);
          if(automatic.has(id)&&key(automatic.get(id).item)===key(item))throw Error('前置方案无法收敛：'+detail);
          automatic.set(id,node);changed=true;
        }
        if(changed)continue;
        const nodes=[...reachable.values()].filter(n=>n.item);
        const entries=nodes.map(n=>n.entry);
        const analysis=MC.analyzer.analyze(local.concat(entries),env);
        if(analysis.rows.some(r=>!r.usable))throw Error('在线前置的真实加载器或游戏版本不符合目标环境');
        if(analysis.uncertain.length)throw Error('依赖链包含无法比较的版本，尚未验证完整');
        if(analysis.overlaps.length)throw Error('依赖链存在重复 ID 声明');
        return {ok:true,entries,extra:nodes.filter(n=>!roots.includes(n)).map(n=>n.item),edges:edges.slice(),errors:[]};
      }
      throw Error('依赖版本要求反复变化，24 轮内无法收敛，请调整直接前置版本');
    }catch(e){errors.push(e.message);return {ok:false,entries:[],extra:[],edges:edges.slice(),errors};}
  }

  const pending=new WeakMap();
  async function checkState(st,{force=false}={}){
    const plan=MC.plan.refresh(st);
    if(!plan||!plan.directOnline.length)return null;
    const fingerprint=plan.rootFingerprint;
    if(!force&&st.dependencyGraph?.rootFingerprint===fingerprint)return st.dependencyGraph;
    const prior=pending.get(st);
    if(prior?.fingerprint===fingerprint)return prior.promise;
    const promise=(async()=>{
      const result=await resolve({local:plan.rows.map(r=>r.entry),online:plan.directOnline,env:st.env,includeOptional:st.includeOptional},{
        download:url=>MC.api.modrinth.download(url),inspect:buf=>MC.metadata.inspect(buf),resolve:(d,c)=>MC.resolver.resolve(d,c)
      });
      if(MC.plan.refresh(st)?.rootFingerprint===fingerprint){
        st.dependencyGraph={...result,rootFingerprint:fingerprint};MC.store.touch();
      }
      return result;
    })();
    pending.set(st,{fingerprint,promise});
    try{return await promise;}finally{if(pending.get(st)?.promise===promise)pending.delete(st);}
  }
  let timer;
  function schedule(st){
    if(!MC.dependencies.auto||st.busy||!st.analysis)return;
    const p=st.plan;
    if(!p?.directOnline.length||st.dependencyGraph?.rootFingerprint===p.rootFingerprint)return;
    clearTimeout(timer);timer=setTimeout(()=>checkState(st).catch(e=>MC.uiBase.toast('依赖链检查失败：'+e.message)),250);
  }
  MC.dependencies={resolve,checkState,schedule,auto:false};
})(globalThis);
