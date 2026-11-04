/* 声明互斥：只用准确身份匹配；不能判定的条件保留为待确认。 */
(function(root) {
  'use strict';
  const MC = root.MC = root.MC || {};
  const lower = v => String(v || '').toLowerCase();
  function numeric(v) {
    const m = String(v || '').match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    return m ? {core:m[1].split('.').map(Number), pre:m[2] == null ? null : m[2].split('.')} : null;
  }
  function compare(a,b) {
    const x=numeric(a), y=numeric(b);
    if(!x || !y) return null;
    for(let i=0;i<Math.max(x.core.length,y.core.length);i++) {
      const d=(x.core[i]||0)-(y.core[i]||0); if(d) return Math.sign(d);
    }
    if(x.pre===null || y.pre===null) return x.pre===y.pre?0:x.pre===null?1:-1;
    for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++) {
      if(x.pre[i]===undefined || y.pre[i]===undefined) return x.pre[i]===undefined?-1:1;
      const a=x.pre[i],b=y.pre[i]; if(a===b)continue;
      const an=/^\d+$/.test(a),bn=/^\d+$/.test(b);
      if(an&&bn)return Math.sign(Number(a)-Number(b));
      if(an!==bn)return an?-1:1;
      return a<b?-1:1;
    }
    return 0;
  }
  const and = values => values.includes(false)?false:values.includes(null)?null:true;
  const or = values => values.includes(true)?true:values.includes(null)?null:false;
  function atom(token,target) {
    if(token==='*')return true;
    const m=token.match(/^(>=|<=|>|<|=|~|\^)?(.+)$/);
    if(!m)return null;
    const op=m[1]||'=',v=m[2];
    const wildcard=v.match(/^(\d+(?:\.\d+)*)\.[xX*](?:\.[xX*])*$/);
    if(wildcard) {
      if(op!=='=')return null;
      const t=numeric(target);if(!t)return null;
      return wildcard[1].split('.').map(Number).every((n,i)=>(t.core[i]||0)===n);
    }
    if(op==='=' && v===target)return true;
    const c=compare(target,v);if(c===null)return null;
    if(op==='=')return c===0;
    if(op==='>=')return c>=0;if(op==='<=')return c<=0;
    if(op==='>')return c>0;if(op==='<')return c<0;
    const x=numeric(target), y=numeric(v);
    // Fabric 的 ^ 即使在 0.x 下也以主版本为边界。
    return c>=0 && x.core[0]===y.core[0] && (op==='^'||(x.core[1]||0)===(y.core[1]||0));
  }
  function match(range,target,syntax='fabric') {
    if(range==null)return null;
    if(Array.isArray(range))return range.length?or(range.map(r=>match(r,target,syntax))):null;
    const r=String(range).trim();
    if(r==='*')return true;
    if(!r || !target)return null;
    if(syntax==='maven') {
      // 数字版本的 Maven 区间及并集；不支持的限定符/语法不猜测。
      const parts=[...r.matchAll(/[\[(][^()[\]]*[\])]/g)];
      if(!parts.length || parts.map(m=>m[0].replace(/\s/g,'')).join(',')!==r.replace(/\s/g,''))return null;
      return or(parts.map(m=>{
        const s=m[0].replace(/\s/g,''), values=s.slice(1,-1).split(',');
        if(values.length===1)return s[0]==='['&&s.at(-1)===']'?atom('='+values[0],target):null;
        if(values.length!==2)return null;
        // Maven 的限定符排序与 semver 不同，此处只确认纯数字。
        if(!/^\d+(?:\.\d+)*$/.test(target)||values.some(v=>v&&!/^\d+(?:\.\d+)*$/.test(v)))return null;
        return and([values[0]?atom((s[0]==='['?'>=':'>')+values[0],target):true,
          values[1]?atom((s.at(-1)===']'?'<=':'<')+values[1],target):true]);
      }));
    }
    return or(r.split(/\s*\|\|\s*/).map(part=>and(part.replace(/(>=|<=|>|<|=|~|\^)\s+/g,'$1').split(/\s+/).map(t=>atom(t,target)))));
  }
  function versionFor(entry,map) {
    const hash=lower(entry.sha1),v=map?.[hash] || entry.platformVersion;
    return hash && v?.id && v.project_id && Array.isArray(v.dependencies) &&
      Array.isArray(v.files) && v.files.some(f=>lower(f?.hashes?.sha1)===hash) ? v : null;
  }
  function analyze(entries,env) {
    const checks=[], incomplete=[];
    function add(from,to,rule,result,origin,reason='') {
      const range=Array.isArray(rule.versionRange)?rule.versionRange.join(' || '):
        rule.versionRange??rule.version_id??(origin==='jar'?'（范围缺失或无效）':'*');
      checks.push({from:from.name||from.id,to:to.name||to.id,fromUid:from.uid,toUid:to.uid,
        range,severity:rule.severity||'error',
        source:rule.source||'Modrinth '+from.platformVersion?.id,origin,result,reason,
        declaration:rule.reason||''});
    }
    for(const from of entries) {
      for(const rule of from.conflicts||[]) {
        const active=(from.loaders||[from.loader]).includes(env.loader)?env.loader:from.loader;
        if(rule.loader && rule.loader!==active)continue;
        const owner=lower(rule.ownerId);
        if(owner && !(from.declaredMods||[{id:from.id}]).some(m=>lower(m.id)===owner))continue;
        for(const to of entries) {
          const ids=to.allIds?.length?to.allIds:[to.id];
          if(!ids.some(id=>lower(id)===lower(rule.modId)))continue;
          const targetLoader=(to.loaders||[to.loader]).includes(env.loader)?env.loader:to.loader;
          const declared=(to.declaredMods||[{id:to.id,version:to.version}]).find(m=>lower(m.id)===lower(rule.modId) && (!m.loader||m.loader===targetLoader));
          let result=match(rule.versionRange,declared?.version,rule.syntax);
          let reason=result===null?'目标版本或声明范围无法可靠比较':'';
          const side=lower(rule.side||'both');
          if(result!==false && side!=='both') {
            if(!['client','server'].includes(side)){result=null;reason='声明的目标端无法识别';}
            else if(!env.side){result=null;reason='声明仅适用于 '+side+'，尚未选择目标端';}
            else if(lower(env.side)!==side)continue;
          }
          add(from,to,rule,result,'jar',reason);
        }
      }
      const v=from.platformVersion;
      if(!v)continue;
      for(const d of v.dependencies||[]) {
        if(!d || d.dependency_type!=='incompatible')continue;
        if(!d.project_id&&!d.version_id) {
          incomplete.push({severity:'pending',reason:(from.name||from.id)+' 的平台互斥声明缺少目标身份；依据 Modrinth '+v.id});
          continue;
        }
        for(const to of entries) {
          const target=to.platformVersion;if(!target)continue;
          if(d.project_id && target.project_id!==d.project_id)continue;
          if(d.version_id && target.id!==d.version_id)continue;
          const conditional=from.platformConditional||to.platformConditional;
          add(from,to,{...d,severity:'error',source:'Modrinth '+v.id+' → '+(d.version_id||d.project_id)},conditional?null:true,'modrinth',
            conditional?'原包文件有可选或目标端条件，需先确认是否安装':'');
        }
      }
    }
    const findings=[];
    for(const c of checks.filter(c=>c.result!==false)) {
      const contrary=checks.filter(x=>x.fromUid===c.fromUid && x.toUid===c.toUid && x.origin!==c.origin && x.result===false);
      const uncertain=c.result===null||contrary.length>0;
      const reason=contrary.length?'平台与 JAR 的冲突范围不一致，需核实':c.reason;
      findings.push({...c,severity:uncertain?'pending':c.severity,
        reason:(reason?reason+'：':'')+c.from+' 与 '+c.to+'；范围 '+c.range+'；依据 '+c.source+
          (c.declaration?'；'+c.declaration:'')+(contrary.length?'；另一依据 '+contrary.map(x=>x.source+' '+x.range).join('、'):'' )});
    }
    return findings.concat(incomplete);
  }
  MC.conflicts={match,versionFor,analyze};
})(globalThis);
