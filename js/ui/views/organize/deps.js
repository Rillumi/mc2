/* ===== 整理视图：缺前置卡片 / 冲突警告 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const R = (MC.render = MC.render || {});
  const { esc, tile, icon, IC, picker, versionItems, compact } = R;

  /* ---------- 缺前置卡片 ---------- */
  function depCard(s, dep) {
    const requirementText = (dep.requirements || []).map(r => r.by + '：' + (r.range || '*')).join('；');
    const cf = MC.links.curseforgeSearch(dep.modId, s.env.mc);
    const pm = MC.links.planetMinecraftSearch(dep.modId);
    const mrl = MC.links.modrinthSearch(dep.modId, s.env);

    const head = '<div class="dep-head">' +
      '<strong>' + esc(dep.modId) + '</strong>' +
      (dep.range ? '<span class="range">需要 ' + esc(dep.range) + '</span>' : '') +
      '<span class="need">被 ' + esc(dep.requiredBy.join('、')) + ' 需要</span>' +
      '</div>';

    let body = '';
    if (dep.status === 'loading') {
      body = '<div class="loading"><span class="spinner"></span>正在 Modrinth 里找 “' + esc(dep.searchWord || dep.modId) + '”…</div>';
    } else if (dep.status === 'ok' && dep.project && dep.version) {
      const ver = dep.version;
      const items = versionItems(dep.versions, ver.id);
      const pick = items.length > 1
        ? picker(s, 'd:' + dep.key, ver.version_number, items, 'dep-picker')
        : '';
      body = '<div class="resolve">' +
        tile(dep.project.title || dep.modId, true, dep.project.icon_url) +
        '<div class="t"><b>' + esc(dep.project.title || dep.modId) + '</b><small>' +
        esc(ver.version_number) + ' · ' + esc(s.env.loader) + ' · ' + esc(s.env.mc) +
        (dep.via ? ' · ' + esc(dep.via) : '') + '</small></div>' +
        pick +
        '<button type="button" class="btn ' + (dep.added ? 'soft' : 'grad') + '" data-act="' +
        (dep.added ? 'unadd' : 'add') + '" data-key="' + esc(dep.key) + '">' +
        (dep.added ? '已加入' : '加入') + '</button>' +
        '</div>' +
        (dep.added ? '<div class="hint okline">' + icon(IC.check, '#40A87C') + '已放进整合包</div>' : '');
    } else if (dep.status === 'none') {
      body = '<div class="hint err">' + esc(dep.reason || '没自动匹配上') +
        ' —— Modrinth 的搜索只认项目名/slug，依赖里写的常常是内部 ID。</div>';
    } else if (dep.status === 'error') {
      body = '<div class="hint err">查询失败：' + esc(dep.reason || '网络问题') + '，可以点「重新匹配」再试。</div>';
    } else {
      body = '<div class="hint">等待匹配…</div>';
    }

    const showCands = dep.showCand || dep.status === 'none' || dep.status === 'error';
    const search = '<div class="searchline">' +
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#8C85A6" stroke-width="2">' + IC.search + '</svg>' +
      '搜索词' +
      '<input data-act="depword" data-key="' + esc(dep.key) + '" value="' + esc(dep.searchWord || dep.modId) + '" spellcheck="false" aria-label="Modrinth 搜索词">' +
      '<button type="button" class="btn line sm" data-act="research" data-key="' + esc(dep.key) + '">重新匹配</button>' +
      (dep.status === 'ok' && dep.candidates && dep.candidates.length > 1
        ? '<button type="button" class="btn line sm" data-act="candmore" data-key="' + esc(dep.key) + '">不是这个</button>'
        : '') +
      '</div>' +
      (showCands ? candidateHtml(s, dep) : '');

    const links = '<div class="actions">' +
      '<a class="btn line sm" href="' + esc(cf) + '" target="_blank" rel="noopener">CurseForge 搜</a>' +
      '<a class="btn line sm" href="' + esc(pm) + '" target="_blank" rel="noopener">Planet Minecraft 搜</a>' +
      '<a class="btn line sm" href="' + esc(mrl) + '" target="_blank" rel="noopener">Modrinth 页面</a>' +
      '</div>';

    return '<div class="dep' + (dep.added && dep.status === 'ok' ? ' done' : '') + '">' + head +
      (requirementText ? '<div class="hint">需同时满足：' + esc(requirementText) + '</div>' : '') + body + search + links + '</div>';
  }

  function candidateHtml(s, dep) {
    const list = dep.candidates || [];
    if (!list.length) return '';
    return '<div class="cands"><div class="cands-label">Modrinth 搜到的，点一个当结果：</div>' +
      list.map(c =>
        '<button type="button" class="cand" data-act="cand" data-key="' + esc(dep.key) + '" data-slug="' + esc(c.slug) + '">' +
        tile(c.title, true, c.icon) +
        '<span class="t"><b>' + esc(c.title) + '</b><small>' + esc((c.description || '').slice(0, 62)) + '</small></span>' +
        '<span class="dl">' + (c.downloads ? compact(c.downloads) : '') + '</span>' +
        '</button>').join('') + '</div>';
  }

  function adaptState(s, key, attrs) {
    const ad = s.adapt && s.adapt[key];
    if (!ad) {
      return '<button type="button" class="btn line xs" data-act="adapt" ' + attrs + '>找适配版本</button>';
    }
    if (ad.status === 'loading') {
      return '<span class="adnote"><span class="spinner"></span>正在找 ' + esc(s.env.loader) + ' ' + esc(s.env.mc) + ' 的版本…</span>';
    }
    if (ad.status !== 'ok' || !ad.version) {
      return '<span class="adnote bad">' + esc(ad.reason || '没找到适配版本') + '</span>' +
        '<button type="button" class="btn line xs" data-act="adapt" ' + attrs + '>再试一次</button>';
    }
    return picker(s, 'a:' + key, ad.version.version_number, versionItems(ad.versions, ad.version.id), 'adapt-picker') +
      '<button type="button" class="btn ' + (ad.added ? 'soft' : 'grad') + ' xs" data-act="adapt' +
      (ad.added ? 'remove' : 'add') + '" data-key="' + esc(key) + '">' +
      (ad.added ? '已替换本地那份' : '换用这个') + '</button>';
  }

  function renderDeps(s) {
    const el = document.getElementById('deps');
    if (!el) return;
    const a = s.analysis;
    if (!a) { el.innerHTML = ''; return; }

    const open = s.deps.filter(d => !(d.added && d.status === 'ok' && d.version)).length;
    const warn = warnHtml(s);
    const head = (s.deps.length || a.versionIssues.length || a.overlaps.length || a.conflicts?.length)
      ? '<div class="section-label">前置与冲突 · ' +
        (open ? '还有 ' + open + ' 个没配好' : s.plan?.summary.label || '等待检查') + '</div>'
      : '';

    const retry = open
      ? '<div class="deps-actions"><button type="button" class="btn line sm" data-act="retryall">重新匹配全部失败项</button></div>'
      : '';

    el.innerHTML = head + warn + retry + platformHtml(s) + s.deps.map(d => depCard(s, d)).join('');
  }

  function platformHtml(s) {
    const p=s.plan;if(!p?.quickEnabled)return '';
    const q=p.quick;
    const progress=s.platformProgress;
    let html='<div class="warnbox"><div class="warnbox-head">原包在线依赖 · 平台快速检查</div>';
    if(!q)html+='<div class="hint">'+(s.platformGraph?.fingerprint===p.quickFingerprint&&s.platformGraph?.status==='checking'
      ?'正在查询'+(progress?'：已识别 '+progress.identified+' / '+progress.total+' 项，已发起 '+progress.requests+' 次请求':'')
      :'等待检查；原包指定的文件版本会保留')+'</div>';
    else {
      html+='<div class="hint">原包在线模组 '+q.sourceIdentified+' / '+q.sourceTotal+' 项、资源文件 '+q.assetIdentified+' / '+q.assetTotal+' 项已定位精确发布版本；检查 '+q.relations.length+' 条关系。只查接口，不下载 JAR。</div>';
      const labels={required:'必需',optional:'可选',incompatible:'不兼容',embedded:'内嵌'};
      const states={'present-exact':'精确版本存在','present-project':'项目存在，内部版本区间待核实',missing:'缺失',unknown:'待确认',
        'optional-absent':'可选，未加入','embedded':'声明内嵌，待核实','embedded-unverified':'可能由内嵌提供，待核实','same-file-unverified':'同一文件的发布版本身份待核实',conflict:'命中互斥',absent:'未命中'};
      html+='<details><summary>查看文件与关系依据</summary>'+q.identified.filter(r=>r.kind==='source'||r.kind==='asset').map(r=>
        '<div>'+esc(r.name)+' → '+esc(r.projectId)+' / '+esc(r.versionId)+'</div>').join('')+
        q.relations.map(r=>'<div>'+esc(r.fromName)+' → '+esc(r.targetName||r.project_id||r.version_id||'?')+'：'+esc(labels[r.dependency_type])+' · '+esc(states[r.state]||'未完成')+'</div>').join('')+'</details>';
      html+=q.candidates.map(c=>'<div class="wline"><b>'+esc(c.project.title)+' '+esc(c.version.version_number||c.version.id)+'</b>'+
        '<small>'+esc(c.optional?'可选候选':'缺失前置候选')+' · 被 '+esc(c.requiredBy.join('、'))+' 需要；加入后继续检查其前置</small>'+
        '<a class="btn line xs" target="_blank" rel="noopener" href="https://modrinth.com/mod/'+encodeURIComponent(c.project.id)+'">查看平台项目</a>'+
        '<button type="button" class="btn line sm" data-act="platform-add" data-project="'+esc(c.key)+'">加入此候选</button></div>').join('');
    }
    html+=Object.entries(s.platformSelections||{}).map(([id,c])=>'<div class="wline"><b>已加入 '+esc(c.project.title)+' '+esc(c.version.version_number||c.version.id)+'</b>'+
      '<button type="button" class="btn line xs" data-act="platform-remove" data-project="'+esc(id)+'">移除</button></div>').join('');
    return html+'</div>';
  }

  function warnHtml(s) {
    const a = s.analysis;
    const boxes = [];
    if(a.conflicts?.length) {
      boxes.push('<div class="warnbox"><div class="warnbox-head">模组互斥声明（'+a.conflicts.length+'）</div>'+
        a.conflicts.map(c=>'<div class="wline"><b>'+esc(c.severity==='error'?'明确错误':c.severity==='warning'?'警告':'待确认')+'</b><span>'+esc(c.reason)+'</span></div>').join('')+'</div>');
    }

    if (a.versionIssues.length) {
      boxes.push('<div class="warnbox">' +
        '<div class="warnbox-head">' + icon(IC.warn, '#D9963F') + '前置版本不够（' + a.versionIssues.length + '）</div>' +
        a.versionIssues.map(w =>
          '<div class="wline"><b>' + esc(w.modId) + '</b><span>需要 ' + esc(w.range) + '，本地是 ' +
          esc(w.have || '未知') + '（' + esc(w.by) + '）</span>' +
          '<small>被 ' + esc(w.requiredBy.slice(0, 3).join('、')) + ' 需要</small>' +
          '<div class="wact">' + adaptState(s, 'i:' + w.id, 'data-id="' + esc(w.id) + '" data-range="' + esc(w.range) + '"') + '</div>' +
          '</div>').join('') +
        '</div>');
    }

    if (a.overlaps.length) {
      boxes.push('<div class="warnbox overlap">' +
        '<div class="warnbox-head">' + icon(IC.alert, '#DE5E84') + 'ID 声明冲突（' + a.overlaps.length + '）</div>' +
        a.overlaps.slice(0, 6).map(o =>
          '<div class="wline"><b>' + esc(o.id) + '</b><span>' + o.owners.length + ' 个模组都声明了这个 ID</span>' +
          '<small>' + esc(o.owners.slice(0, 4).join(' / ')) + '</small></div>').join('') +
        '<div class="wfoot">这种冲突 Forge 启动时会直接抱错，建议只留一个。</div>' +
        '</div>');
    }

    return boxes.join('');
  }

  R.renderDeps = renderDeps;
  R.adaptState = adaptState; // 行视图也要拼这段适配按钮
})(globalThis);
