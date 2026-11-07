/* 声明证据核对：只读当前方案，不下载文件，不决定导出是否放行。 */
(function(root){
  'use strict';
  const MC=root.MC=root.MC||{};
  const lower=v=>String(v||'').toLowerCase();
  const clone=v=>JSON.parse(JSON.stringify(v));
  const validRange=v=>typeof v==='string'&&!!v.trim()||Array.isArray(v)&&v.length>0&&v.every(x=>typeof x==='string'&&!!x.trim());
  function condition(rule,env){
    const side=lower(rule.side||'both');
    if(side==='both'||side==='*')return true;
    if(!['client','server'].includes(side)||!env.side)return null;
    return side===lower(env.side);
  }
  function evaluate(rule,version,present=!!version){
    if(!validRange(rule.value))return {status:'insufficient',reason:'METADATA_VALUE_INVALID'};
    if(present&&(rule.value==='*'||Array.isArray(rule.value)&&rule.value.includes('*')))
      return {status:'satisfied',reason:'DECLARED_RANGE_SATISFIED'};
    if(!version)return {status:'insufficient',reason:'TARGET_VERSION_MISSING'};
    const hit=MC.conflicts.match(rule.value,version,rule.syntax);
    return hit===null?{status:'insufficient',reason:'RANGE_UNSUPPORTED'}:
      {status:hit?'satisfied':'violated',reason:hit?'DECLARED_RANGE_SATISFIED':'DEP_VERSION_OUT_OF_RANGE'};
  }
  function review(entries,env,{versions={},platformStatus='idle',providersComplete=false}={}){
    const records=[];
    const complete=providersComplete&&entries.every(e=>e.metadataRead===true&&(e.metadataEvidence||[])
      .some(s=>s.loader===env.loader&&s.state==='parsed'&&s.schemaSupported!==false&&s.requirementsValid!==false&&condition(s,env)!==null));
    for(const entry of entries){
      const sources=clone(entry.metadataEvidence||[]),checks=[];
      const add=(dimension,status,reason,detail={})=>checks.push({dimension,status,reasons:[reason],...detail});
      const active=entry.metadataRead===true?sources.filter(s=>s.loader===env.loader):[];
      const platform=/^[a-f0-9]{40}$/i.test(entry.sha1||'')?MC.conflicts.versionFor(entry,versions):null;
      const candidate=versions[lower(entry.sha1)]||entry.platformVersion;
      const file={uid:entry.uid||'',name:entry.name||entry.fileName||entry.id||'',sha1:entry.sha1||'',
        metadataRead:entry.metadataRead===true,sources,checks,
        inferences:clone({version:entry.versionEvidence||null,minecraft:entry.mcEvidence||null}),
        platform:platform?clone({id:platform.id,project_id:platform.project_id,version_number:platform.version_number,
          game_versions:platform.game_versions??null,loaders:platform.loaders??null,dependencies:platform.dependencies,
          identity:'sha1-matched'}):null};
      if(!entry.metadataRead){
        const failed=sources.some(s=>s.state==='parse-failed');
        add('internal.minecraft',failed?'insufficient':'unchecked',failed?'METADATA_PARSE_FAILED':entry.kind==='resource'?'PACK_FORMAT_NOT_REVIEWED':'JAR_NOT_READ');
      }
      else if(!sources.length)add('internal.minecraft','insufficient','SOURCE_EVIDENCE_MISSING');
      else if(!active.length)add('internal.minecraft','insufficient','LOADER_SCOPE_UNVERIFIED');
      for(const source of active){
        const ref={source:source.path,loader:source.loader};
        if(source.state!=='parsed'){
          add('internal.minecraft','insufficient',source.state==='parse-failed'?'METADATA_PARSE_FAILED':'DECLARATION_DERIVED',ref);continue;
        }
        if(source.schemaSupported===false||!['Fabric','Forge','NeoForge'].includes(source.loader)){
          add('internal.minecraft','insufficient','METADATA_FORMAT_UNSUPPORTED',ref);continue;
        }
        if(source.requirementsValid===false){
          add('internal.minecraft','insufficient','METADATA_VALUE_INVALID',ref);continue;
        }
        const mods=source.mods||[];
        const rules=(source.requirements||[]).filter(d=>mods.some(m=>lower(m.id)===lower(d.ownerId)));
        const mc=rules.filter(d=>lower(d.modId)==='minecraft');
        if(!mc.length)add('internal.minecraft','not-declared','MC_REQUIREMENT_NOT_DECLARED',ref);
        for(const rule of rules){
          const isMc=lower(rule.modId)==='minecraft',dimension=isMc?'internal.minecraft':'internal.dependency';
          const detail={...ref,ownerId:rule.ownerId,targetId:rule.modId,field:rule.field,raw:clone(rule.raw??null),
            range:clone(rule.value??null),syntax:rule.syntax,defaulted:!!rule.defaulted,side:rule.side,type:rule.type};
          if(rule.structureValid===false){add(dimension,'insufficient','METADATA_STRUCTURE_UNVERIFIED',detail);continue;}
          const scope=condition(rule,env);
          if(scope===false){add(dimension,'not-applicable','TARGET_SIDE_NOT_APPLICABLE',detail);continue;}
          if(scope===null){add(dimension,'insufficient','TARGET_SIDE_UNKNOWN',detail);continue;}
          if(!['required','optional'].includes(rule.type)){
            add(dimension,'insufficient','REQUIREMENT_TYPE_UNSUPPORTED',detail);continue;
          }
          if(isMc){
            const result=evaluate(rule,env.mc);
            add(dimension,result.status,result.status==='violated'?'INTERNAL_MC_EXCLUDED':result.reason,detail);
            continue;
          }
          if(MC.analyzer.ENV_IDS.has(MC.analyzer.normDep(rule.modId))){
            add(dimension,'unchecked','ENV_REQUIREMENT_NOT_CHECKED',detail);continue;
          }
          // 只认已读声明中的准确内部 ID；不拿平台版本号或文件名推测冒充提供者版本。
          const providers=[];
          let possible=false;
          for(const target of entries){
            const applicable=(target.metadataEvidence||[]).filter(s=>target.metadataRead===true&&s.loader===env.loader&&s.state==='parsed'&&s.schemaSupported!==false&&condition(s,env)===true);
            for(const s of applicable)for(const mod of s.mods||[]){
              if(lower(mod.id)!==lower(rule.modId))continue;
              const value=mod.versionSource?.startsWith('META-INF/MANIFEST.MF')&&mod.rawVersion==='${file.jarVersion}'?mod.version:mod.rawVersion;
              const version=typeof value==='string'?value:null;
              providers.push({uid:target.uid,id:mod.id,version,source:s.path});
            }
            if((target.allIds||[]).some(id=>lower(id)===lower(rule.modId))&&!providers.some(p=>p.uid===target.uid))possible=true;
          }
          detail.providers=providers;
          if(!providers.length){
            const absent=complete&&!possible;
            add(dimension,rule.type==='optional'&&absent?'not-applicable':absent?'violated':'insufficient',
              rule.type==='optional'&&absent?'OPTIONAL_DEP_ABSENT':absent?'REQUIRED_DEP_MISSING':'PROVIDER_UNVERIFIED',detail);
          }else{
            const results=providers.map(p=>typeof p.version==='string'&&p.version.trim()?evaluate(rule,p.version,true):
              {status:'insufficient',reason:'PROVIDER_VERSION_UNVERIFIED'});
            // 多个提供者不能替加载器假定它会选中合格的那个。
            if(providers.length>1)add(dimension,'insufficient','MULTIPLE_PROVIDERS',detail);
            else add(dimension,results[0].status,results[0].reason,detail);
          }
        }
      }
      if(platform){
        const values=platform.game_versions;
        if(!Array.isArray(values)||!values.length||values.some(v=>typeof v!=='string'))
          add('platform.minecraft','insufficient','METADATA_VALUE_INVALID');
        else if(!env.mc)add('platform.minecraft','insufficient','TARGET_VERSION_MISSING');
        else add('platform.minecraft',values.includes(env.mc)?'listed':'not-listed',
          values.includes(env.mc)?'PLATFORM_MC_LISTED':'PLATFORM_MC_NOT_LISTED',
          {source:'Modrinth '+platform.id,raw:clone(values)});
      }else{
        add('platform.minecraft',candidate?'insufficient':platformStatus==='idle'||platformStatus==='checking'?'unchecked':'insufficient',
          candidate?'IDENTITY_UNVERIFIED':platformStatus==='error'?'PLATFORM_REQUEST_FAILED':platformStatus==='idle'||platformStatus==='checking'?'PLATFORM_NOT_CHECKED':'PLATFORM_NOT_FOUND');
      }
      const platformCheck=checks.find(c=>c.dimension==='platform.minecraft');
      const loaderTag=({Fabric:'fabric',Forge:'forge',NeoForge:'neoforge'})[env.loader]||lower(env.loader);
      const samePlatformScope=platform&&Array.isArray(platform.loaders)&&platform.loaders.includes(loaderTag);
      for(const internal of checks.filter(c=>c.dimension==='internal.minecraft')){
        if(!samePlatformScope)continue;
        if(internal.status==='violated'&&platformCheck?.status==='listed'){
          internal.reasons.push('SOURCE_ENV_DISAGREEMENT');
          add('cross.minecraft','disagreement','SOURCE_ENV_DISAGREEMENT',
            {source:internal.source,platformVersionId:platform.id,primary:'violated'});
        }else if(internal.status==='satisfied'&&platformCheck?.status==='not-listed'){
          add('cross.minecraft','coverage-gap','PLATFORM_MC_NOT_LISTED',{source:internal.source,primary:'satisfied'});
        }
      }
      records.push(file);
    }
    return {schemaVersion:1,reviewedAt:Date.now(),environment:{...env},mode:'diagnostic-only',records,
      scope:['内部 MC 与必需/可选依赖声明','准确 SHA-1 对应的平台 MC 列表'],
      limits:['不替代现有导出判级','不推断完整版本范围交集','未核实内嵌、转接及实际运行','资源包格式不适用本轮 JAR 范围判断']};
  }
  const labels={satisfied:'声明满足',violated:'声明要求不满足',insufficient:'证据不足',unchecked:'未检查',
    'not-declared':'未声明该要求','not-applicable':'条件不适用',listed:'平台已列出','not-listed':'平台未列出',
    disagreement:'来源说法不一致','coverage-gap':'平台标注范围待核对'};
  function reportLines(result){
    const lines=['【声明证据核对（尚未接管打包判级）】','仅核对：'+result.scope.join('；')];
    for(const r of result.records){
      lines.push(r.name+'；SHA-1 '+(r.sha1||'未知'));
      if(r.inferences.version?.source==='filename')lines.push('  文件名推测版本 '+r.inferences.version.value+'；原声明 '+JSON.stringify(r.inferences.version.declared));
      if(r.inferences.minecraft?.source==='filename')lines.push('  文件名推测 MC '+r.inferences.minecraft.value+'（未作为内部声明证据）');
      for(const c of r.checks)lines.push('  ['+(labels[c.status]||c.status)+'] '+c.dimension+' '+(c.targetId||'')+
        '；'+c.reasons.join('、')+(c.source?'；来源 '+c.source:'')+('raw' in c?'；原值 '+JSON.stringify(c.raw):''));
    }
    lines.push('边界：'+result.limits.join('；'));
    return lines;
  }
  MC.evidence={review,reportLines};
})(globalThis);
