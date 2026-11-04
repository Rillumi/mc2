/* 最终导出方案：只分析实际选中的本地文件与已加入的在线前置。 */
(function(root){
  'use strict';
  const MC=root.MC=root.MC||{};
  function refresh(st){
    if(!st.analysis){st.plan=null;return null;}
    const rows=MC.selector.selectedRows(st,st.analysis);
    const local=rows.map(r=>r.entry);
    const base=MC.analyzer.analyze(local,st.env,{includeOptional:st.includeOptional});
    const previous=st.deps||[];
    st.deps=base.missing.map(m=>{
      const old=previous.find(d=>d.key===m.id && JSON.stringify(d.range)===JSON.stringify(m.range));
      return Object.assign(old||{status:'idle',added:false,version:null,versions:[],candidates:[],searchWord:m.modId},
        {key:m.id,id:m.id,modId:m.modId,range:m.range,requirements:m.requirements,requiredBy:m.requiredBy});
    });
    const directOnline=st.deps.concat(Object.values(st.adapt||{})).filter(d=>d.added&&d.status==='ok'&&d.version&&d.project);
    const rootFingerprint=JSON.stringify({env:st.env,rows:rows.map(r=>[r.uid,r.entry.sha1,r.entry.version,r.entry.deps,r.entry.optionalDeps,r.entry.conflicts,r.entry.declaredMods]),
      online:directOnline.map(d=>[d.project.id,d.version]),includeOptional:st.includeOptional,
      sources:(st.packSources||[]).map(p=>[p.name,p.onlineList]),includePacks:st.includePacks});
    const graph=st.dependencyGraph?.rootFingerprint===rootFingerprint?st.dependencyGraph:null;
    const online=directOnline.concat(graph?.ok?graph.extra:[]);
    const virtual=graph?.ok?graph.entries:directOnline.map((d,i)=>({uid:'online-'+i,id:d.modId||d.id||d.project.slug,
      name:d.project.title,version:d.version.version_number,loader:st.env.loader,mcRange:st.env.mc,
      sha1:'online-'+d.project.id+'-'+d.version.id,allIds:[d.modId||d.id||d.project.slug],deps:[]}));
    const inspected=local.concat(virtual).map(e=>({...e,platformVersion:MC.conflicts.versionFor(e,st.fileVersions)}));
    const analysis=MC.analyzer.analyze(inspected,st.env,{includeOptional:st.includeOptional});
    const uncertain=analysis.uncertain.slice();
    if(directOnline.length&&!graph?.ok) uncertain.push({reason:graph?'在线依赖链检查未通过':'正在等待检查在线模组的间接前置'});
    const sourceOnline=(st.packSources||[]).some(p=>(p.onlineList||[]).length);
    if(sourceOnline) uncertain.push({reason:'原包在线文件未在本机展开，无法核实其内部前置'});
    const errors=[];
    if(graph&&!graph.ok)errors.push(...graph.errors);
    analysis.missing.filter(d=>d.requiredBy.length).forEach(d=>{
      const detail=d.modId+'（'+d.requiredBy.join('、')+'）';
      if(sourceOnline) uncertain.push({reason:'前置 '+detail+' 需核实原包在线文件'});
      else errors.push('缺少前置 '+detail);
    });
    analysis.versionIssues.forEach(d=>errors.push('前置 '+d.modId+' 不满足 '+d.requirements.map(r=>r.by+': '+(r.range||'*')).join('；')));
    analysis.rows.filter(r=>!r.usable).forEach(r=>errors.push(r.entry.name+' 与目标环境不兼容'));
    analysis.overlaps.forEach(o=>errors.push('重复声明 '+o.id));
    const warnings=[];
    for(const c of analysis.conflicts) {
      if(c.severity==='error')errors.push('明确互斥：'+c.reason);
      else if(c.severity==='warning')warnings.push(c);
      else uncertain.push(c);
    }
    inspected.filter(e=>e.error).forEach(e=>uncertain.push({reason:(e.name||e.fileName)+' 元数据不完整：'+e.error}));
    const coverage={local:local.filter(e=>e.metadataRead).length,online:graph?.ok?graph.entries.length:0,
      platform:inspected.filter(e=>e.platformVersion).length,
      platformUnchecked:inspected.filter(e=>!e.platformVersion).length,
      sourceOnline:(st.packSources||[]).reduce((n,p)=>n+(p.onlineList||[]).filter(f=>!f.path||/^mods\//i.test(f.path)).length,0),
      limits:['平台互斥目前仅核对已识别的 Modrinth 文件','内嵌依赖尚未完整核实','未验证实际启动及游戏内行为'],platformStatus:st.platformCheck?.status||'idle'};
    const findings=errors.map(reason=>({severity:'error',reason})).concat(warnings,uncertain.map(x=>({...x,severity:'pending',reason:x.reason||x.modId+' 的版本无法比较'})));
    if(coverage.platformUnchecked)findings.push({severity:'pending',reason:'有 '+coverage.platformUnchecked+' 个所选模组尚无平台精确版本依据'+
      (st.platformCheck?.status==='error'?'（'+st.platformCheck.reason+'）':st.platformCheck?.status==='checking'?'（查询中）':'（未查询、未收录或返回信息不足）')});
    else if(st.platformCheck?.status==='error')findings.push({severity:'pending',reason:'平台刷新失败，当前沿用先前的精确版本资料：'+st.platformCheck.reason});
    const summary={errors:errors.length,warnings:warnings.length,pending:findings.filter(f=>f.severity==='pending').length};
    summary.status=summary.errors?'error':summary.pending?'pending':summary.warnings?'warning':'checked';
    summary.label=summary.errors?'发现明确问题，整合包导出已阻止':summary.pending?'检查尚有待确认项':summary.warnings?'发现警告，请核对声明':'已检查的声明未发现问题';
    const fingerprint=JSON.stringify([rootFingerprint,graph?.ok?graph.entries.map(e=>e.sha1):null,
      inspected.map(e=>e.platformVersion&&[e.platformVersion.id,e.platformVersion.project_id,e.platformVersion.dependencies]),findings]);
    st.plan={rows,directOnline,online,analysis,uncertain,errors,warnings,findings,summary,coverage,fingerprint,rootFingerprint};
    // 候选目录保留供用户换版本；检查结果来自最终方案。
    st.analysis.missing=analysis.missing;
    st.analysis.versionIssues=analysis.versionIssues;
    st.analysis.overlaps=analysis.overlaps;
    st.analysis.uncertain=analysis.uncertain;
    st.analysis.conflicts=analysis.conflicts;
    const byUid=new Map(analysis.rows.map(r=>[r.uid,r]));
    st.analysis.rows.forEach(r=>{r.depInfo=byUid.get(r.uid)?.depInfo||[];});
    return st.plan;
  }
  MC.plan={refresh};
})(globalThis);
