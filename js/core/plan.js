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
    const rootFingerprint=JSON.stringify({env:st.env,rows:rows.map(r=>[r.uid,r.entry.sha1,r.entry.version,r.entry.deps,r.entry.optionalDeps]),
      online:directOnline.map(d=>[d.project.id,d.version]),includeOptional:st.includeOptional,
      sources:(st.packSources||[]).map(p=>[p.name,p.onlineList]),includePacks:st.includePacks});
    const graph=st.dependencyGraph?.rootFingerprint===rootFingerprint?st.dependencyGraph:null;
    const online=directOnline.concat(graph?.ok?graph.extra:[]);
    const virtual=graph?.ok?graph.entries:directOnline.map((d,i)=>({uid:'online-'+i,id:d.modId||d.id||d.project.slug,
      name:d.project.title,version:d.version.version_number,loader:st.env.loader,mcRange:st.env.mc,
      sha1:'online-'+d.project.id+'-'+d.version.id,allIds:[d.modId||d.id||d.project.slug],deps:[]}));
    const analysis=MC.analyzer.analyze(local.concat(virtual),st.env,{includeOptional:st.includeOptional});
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
    const fingerprint=JSON.stringify([rootFingerprint,graph?.ok?graph.entries.map(e=>e.sha1):null]);
    st.plan={rows,directOnline,online,analysis,uncertain,errors,fingerprint,rootFingerprint};
    // 候选目录保留供用户换版本；检查结果来自最终方案。
    st.analysis.missing=analysis.missing;
    st.analysis.versionIssues=analysis.versionIssues;
    st.analysis.overlaps=analysis.overlaps;
    st.analysis.uncertain=analysis.uncertain;
    const byUid=new Map(analysis.rows.map(r=>[r.uid,r]));
    st.analysis.rows.forEach(r=>{r.depInfo=byUid.get(r.uid)?.depInfo||[];});
    return st.plan;
  }
  MC.plan={refresh};
})(globalThis);
