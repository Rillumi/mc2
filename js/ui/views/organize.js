/* ===== 整理视图：模组行、前置、打包卡 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const R = (MC.render = MC.render || {});
  const { esc, tile, icon, IC, fmtSize, picker, versionItems, compact, chosenOf, scanBar, adaptAdded } = R;

  /* ---------- 缺前置卡片 ---------- */
  function depCard(s, dep) {
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
        tile(dep.project.title || dep.modId, true) +
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

    return '<div class="dep' + (dep.added && dep.status === 'ok' ? ' done' : '') + '">' + head + body + search + links + '</div>';
  }

  function candidateHtml(s, dep) {
    const list = dep.candidates || [];
    if (!list.length) return '';
    return '<div class="cands"><div class="cands-label">Modrinth 搜到的，点一个当结果：</div>' +
      list.map(c =>
        '<button type="button" class="cand" data-act="cand" data-key="' + esc(dep.key) + '" data-slug="' + esc(c.slug) + '">' +
        tile(c.title, true) +
        '<span class="t"><b>' + esc(c.title) + '</b><small>' + esc((c.description || '').slice(0, 62)) + '</small></span>' +
        '<span class="dl">' + (c.downloads ? compact(c.downloads) : '') + '</span>' +
        '</button>').join('') + '</div>';
  }

  /* Fabric 模组装不进 Forge 时的替代方案：装 Sinytra Connector */
  function connectorBar(s, gid) {
    const c = s.connector;
    const st = c && c.status;
    if (!st) {
      return '<button type="button" class="btn line xs" data-act="getconnector" data-group="' + esc(gid) + '">用 Sinytra Connector 兼容</button>';
    }
    if (st === 'loading') {
      return '<span class="hint adnote">正在找 ' + esc(c.mc || s.env.mc) + ' 能用的 Connector…</span>';
    }
    if (st === 'error') {
      return '<button type="button" class="btn line xs" data-act="getconnector" data-group="' + esc(gid) + '">再找一次 Connector</button>' +
        '<span class="hint err">' + esc(c.reason || 'Modrinth 查询失败') + '</span>';
    }
    if (st === 'none' || !(c.items || []).length) {
      return '<a class="btn line xs" href="https://modrinth.com/mod/sinytra-connector/versions" target="_blank" rel="noopener">去 Modrinth 手动找</a>';
    }
    return c.items.map(it =>
      '<a class="btn grad xs" href="' + esc(it.url || it.page) + '" target="_blank" rel="noopener">下载 ' + esc(it.name) + ' ' + esc(it.version) + '</a>'
    ).join('') +
      '<span class="hint adnote">装进包里再扫一次，Fabric 模组就会标成「经 Connector 兼容」。</span>';
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
    const head = (s.deps.length || a.versionIssues.length || a.overlaps.length)
      ? '<div class="section-label">前置与冲突 · ' +
        (open ? '还有 ' + open + ' 个没配好' : '前置已配齐') + '</div>'
      : '';

    const retry = open
      ? '<div class="deps-actions"><button type="button" class="btn line sm" data-act="retryall">重新匹配全部失败项</button></div>'
      : '';

    el.innerHTML = head + warn + retry + s.deps.map(d => depCard(s, d)).join('');
  }

  function warnHtml(s) {
    const a = s.analysis;
    const boxes = [];

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

  /* ---------- 模组行 ---------- */
  function rowHtml(s, group) {
    const hl = t => MC.search.highlight(t, s.organizeQuery);
    const rows = MC.selector.sortRows(group.usableRows, s.env);
    const chosen = rows.find(r => r.uid === s.selection[group.id]) || rows[0];
    const selectMode = s.selectMode;
    const check = selectMode
      ? '<button type="button" class="check" role="checkbox" aria-checked="' +
        (s.excluded[group.id] ? 'false' : 'true') + '" data-act="toggle-exclude" data-group="' + esc(group.id) + '"' +
        ' aria-label="是否把 ' + esc(group.displayId) + ' 放进整合包">' +
        icon(IC.check) + '</button>'
      : '';

    if (!chosen) {
      const first = group.rows[0];
      const issue = first.issues.find(i => i.type === 'loader') || first.issues.find(i => i.type === 'mc');
      const reason = first.entry.error || (issue && issue.text) || '不可用';
      const attrs = 'data-group="' + esc(group.id) + '" data-id="' + esc(first.entry.id || group.displayId) + '"';
      return '<div class="rowwrap">' +
        '<div class="row dead" data-act="detail" data-group="' + esc(group.id) + '" role="button" tabindex="0">' +
        tile(first.entry.nameZh || first.entry.name || group.displayId) +
        '<div class="main"><div class="name">' + hl(first.entry.nameZh || first.entry.name || group.displayId) +
        (first.entry.nameZh && first.entry.name ? '<i class="alias">' + hl(first.entry.name) + '</i>' : '') +
        ' <i>' + esc(first.entry.version || '') + '</i></div>' +
        '<div class="sub"><span class="tag bad">' + esc(reason) + '</span>' +
        (first.connectorFix
          ? '<span class="tag src">可用 Connector 兼容</span>'
          : '<span class="tag">不进打包</span>') + '</div></div>' +
        '<div class="side"><span class="dot bad"></span></div></div>' +
        '<div class="adaptbar">' + adaptState(s, group.id, attrs) +
        (first.connectorFix ? connectorBar(s, group.id) : '') + '</div>' +
        '</div>';
    }

    const e = chosen.entry;
    const multi = rows.length > 1;
    const tags = [
      '<span class="tag' + (e.loader ? ' ok' : '') + '"' + (e.loader ? '' : ' title="jar 里没写加载器"') + '>' +
      esc(e.loader || '加载器未知') + '</span>',
      '<span class="tag"' + (e.mc ? '' : ' title="jar 里没写支持的 MC 版本"') + '>' + esc(e.mc || 'MC 未知') + '</span>'
    ];
    if (group.sizes > 1) tags.push('<span class="tag">同 ID ' + group.sizes + ' 份</span>');
    if (s.filter === 'dup') tags.push('<span class="tag ok">已合并保留 1 份</span>');
    if (chosen.viaConnector) tags.push('<span class="tag src" title="Fabric 模组，通过 Sinytra Connector 在 Forge 上运行">经 Connector 兼容</span>');
    tags.push('<span class="tag filetag" data-act="copy-file" data-file="' + esc(e.filePath || e.fileName || '') +
      '" title="点击复制路径，去文件夹里搜这个文件">' + hl(e.fileName || '') + '</span>');

    const items = rows.map(r => ({
      value: r.uid,
      current: chosen.uid,
      text: MC.selector.label(r.entry),
      meta: r.entry.fileName
    }));
    const pk = multi ? picker(s, 'g:' + group.id, MC.selector.label(e), items, 'row-picker') : '';

    return '<div class="row' + (s.excluded[group.id] ? ' off' : '') + '" data-act="detail" data-group="' + esc(group.id) + '"' +
      ' role="button" tabindex="0" title="' + esc(e.fileName || '') + '">' +
      check + tile(e.nameZh || e.name || group.displayId) +
      '<div class="main"><div class="name">' + hl(e.nameZh || e.name || group.displayId) +
      (e.nameZh && e.name ? '<i class="alias">' + hl(e.name) + '</i>' : '') +
      ' <i>' + esc(e.version || '') + '</i></div>' +
      '<div class="sub">' + tags.join('') +
      (s.excluded[group.id] ? '<span class="tag bad">已排除</span>' : '') + '</div></div>' +
      '<div class="side">' + pk + '<span class="dot' + (s.excluded[group.id] ? ' bad' : multi ? ' warn' : '') + '"></span></div>' +
      '</div>';
  }

  /* ---------- 资源包 / 光影 ---------- */
  function otherMeta(o) {
    if (o.kind === 'shader') {
      return (o.shaderFiles ? o.shaderFiles + ' 个 shader 文件' : '光影') + ' · 由 Iris / OptiFine 加载';
    }
    if (o.kind === 'resourcepack') {
      const n = (o.assets && o.assets.length) || 0;
      return (o.packFormat ? '格式 ' + o.packFormat : '格式未知') + (n ? ' · 覆盖 ' + n.toLocaleString() + ' 个文件' : '');
    }
    return '不是模组 / 资源包';
  }

  function otherRow(s, o) {
    const kindLabel = o.kind === 'shader' ? '光影' : o.kind === 'resourcepack' ? '资源包' : '其他';
    return '<div class="row other" data-act="detail" data-other="' + esc(o.uid) + '" role="button" tabindex="0" title="' + esc(o.fileName) + '">' +
      tile(o.fileName) +
      '<div class="main"><div class="name">' + esc(o.fileName) + '</div>' +
      '<div class="sub"><span class="tag">' + kindLabel + '</span><span class="tag">' + esc(otherMeta(o)) + '</span>' +
      (o.description ? '<span class="odesc">' + esc(o.description) + '</span>' : '') + '</div></div>' +
      '<div class="side"><small class="osz">' + fmtSize(o.size) + '</small></div></div>';
  }

  function othersSection(s, list) {
    const open = !!s.showOthers;
    const rp = list.filter(o => o.kind === 'resourcepack').length;
    const sh = list.filter(o => o.kind === 'shader').length;
    return '<div class="othersec">' +
      '<button type="button" class="otherhead" data-act="toggle-others" aria-expanded="' + open + '">' +
      '<span class="oic">' + icon(IC.layers, '#7C63E8') + '</span>' +
      '<b>资源包与光影</b><span class="ocount">' + list.length + '</span>' +
      '<small>' + rp + ' 个资源包' + (sh ? ' · ' + sh + ' 个光影' : '') + ' · 不进 mods</small>' +
      '<span class="chev">' + icon('<path d="M6 9l6 6 6-6"/>', '#8E8AA6') + '</span></button>' +
      (open
        ? '<div class="otherlist">' + list.map(o => otherRow(s, o)).join('') + '</div>' +
          '<div class="hint othnote">资源包是按文件路径覆盖的：只有两个包改到同一个文件才会互相遮挡。游戏里资源包列表越靠上，优先级越高。</div>'
        : '') +
      '</div>';
  }

  function renderRows(s) {
    const el = document.getElementById('rows');
    const title = document.getElementById('listTitle');
    if (!el) return;

    const scanning = scanBar(s);

    if (!s.mods.length) {
      el.innerHTML = scanning || '<div class="empty"><b>还没有扫描</b><br>把 mods 文件夹拖进来，或者点「只查一个模组」单独分析一个 jar。<br>全部在本地读取，文件不会上传。</div>';
      if (title) title.textContent = s.scan ? '正在读取…' : '整理方案';
      return;
    }

    if (!s.analysis) {
      el.innerHTML = scanning || '<div class="loading"><span class="spinner"></span>' + esc(s.progress || '正在分析…') + '</div>';
      return;
    }

    const a = s.analysis;
    if (title) {
      title.textContent = s.mode === 'single'
        ? '单模组检查 · ' + (a.groups[0] ? a.groups[0].displayId : '')
        : '整理方案 · ' + a.groups.length + ' 个模组 / ' + s.mods.length + ' 个文件';
    }

    let groups = a.groups;
    let label = '全部模组 · 已按版本挑好';
    if (s.filter === 'choose') { groups = groups.filter(g => g.usableRows.length > 1); label = '需要你选版本的模组'; }
    if (s.filter === 'bad') { groups = groups.filter(g => g.usableRows.length === 0); label = '不兼容 · 已自动排除'; }
    if (s.filter === 'dup') { groups = groups.filter(g => g.sizes > 1); label = '同一模组多份 · 每组只留 1 份'; }

    const q = MC.search.normalizeQuery(s.organizeQuery);
    if (q) {
      groups = groups.filter(g => {
        const row = chosenOf(s, g) || g.rows[0];
        const e = row.entry || {};
        return MC.search.matches([g.displayId, e.name, e.nameZh, e.id, e.fileName], q);
      });
    }

    const extras = (s.mode === 'single'
      ? '<div class="extraline">单模组模式：只分析这一个 jar 的前置。' +
        '<button type="button" data-act="exit-single">退出，回到文件夹整理</button></div>'
      : '');

    const others = (a.others && a.others.length && s.mode === 'folder') ? othersSection(s, a.others) : '';

    const pg = MC.pager.slice('organize', groups.length);
    const pageGroups = groups.slice(pg.start, pg.end);
    const pagerHtml = MC.pager.html('organize', pg, { anchor: '#rows', unit: '组' });

    el.innerHTML = '<div class="section-label">' + esc(label) + ' · ' + groups.length + ' 组' +
      (s.selectMode ? '<span class="selhint">点左边的方框取消进包</span>' : '') + '</div>' +
      extras + scanning +
      (s.progress ? '<div class="loading"><span class="spinner"></span>' + esc(s.progress) + '</div>' : '') +
      '<div class="rows">' + (pageGroups.length
        ? pageGroups.map(g => rowHtml(s, g)).join('')
        : '<div class="empty">' + (q
          ? '没有匹配「' + esc(s.organizeQuery) + '」的模组。'
          : others
            ? '这个文件夹里没有模组，只有下面的资源包与光影。'
            : '这个分类下没有内容。') + '</div>') + '</div>' +
      pagerHtml +
      others;
  }

  /* ---------- 右侧打包卡 ---------- */
  function renderPack(s) {
    const el = document.getElementById('pack');
    if (!el) return;

    const a = s.analysis;
    const picked = MC.selector.selectedRows(s, a);
    const added = s.deps.filter(d => d.added && d.status === 'ok' && d.version);
    const adapted = adaptAdded(s);
    const total = picked.length + added.length + adapted.length;
    const packList = ((a && a.others) || []).filter(o => o.kind === 'resourcepack' || o.kind === 'shader');
    const packsOn = !!(s.includePacks && packList.length);
    const packBytes = packList.reduce((n, o) => n + (o.size || 0), 0);
    const hasOptional = picked.some(r => ((r.entry && r.entry.optionalDeps) || []).length);
    const size = picked.reduce((n, r) => n + (r.entry.size || 0), 0) +
      added.concat(adapted).reduce((n, d) => {
        const f = d.version.files && d.version.files[0];
        return n + ((f && f.size) || 0);
      }, 0) + (packsOn ? packBytes : 0);
    const hasContent = total + (packsOn ? packList.length : 0);

    const open = s.deps.filter(d => !(d.added && d.status === 'ok' && d.version));
    const excluded = MC.selector.excludedGroups(s, a).length;
    const checks = [
      ['加载器全部一致', true],
      ['游戏版本全部一致', true],
      ['同 modId 只留一份', true],
      ['缺前置已补齐', open.length === 0],
      ['前置版本满足要求', a ? a.versionIssues.every(w => s.adapt['i:' + w.id] && s.adapt['i:' + w.id].added) : true],
      ['modId 声明无冲突', a ? a.overlaps.length === 0 : true]
    ];

    const disabled = (!hasContent || s.busy) ? ' disabled' : '';
    const verLabel = s.env.loader === 'Fabric' ? 'Fabric Loader' : (s.env.loader + ' 版本');

    el.innerHTML =
      '<h3>打包成整合包</h3>' +
      '<div class="sum">包里 <b>' + total + '</b> 个模组 · 约 ' + fmtSize(size) +
      (added.length ? ' · 含 ' + added.length + ' 个前置' : '') +
      (adapted.length ? ' · 换 ' + adapted.length + ' 个版本' : '') +
      (excluded ? ' · 排除 ' + excluded + ' 个' : '') +
      (packsOn ? ' · 另带 ' + packList.length + ' 个资源包/光影' : '') + '</div>' +

      '<button type="button" class="btn line full preview-btn" data-act="open-preview"' + (s.analysis ? '' : ' disabled') + '>' +
      icon(IC.layers, '#7C63E8') + '预览包里有什么</button>' +

      '<button type="button" class="opt' + (s.selectMode ? '' : ' off') + '" data-act="toggle-select">' +
      '<span class="box">' + icon(IC.check, '#fff') + '</span>' +
      '<div>选择要进包的模组<br><span style="color:var(--ink-3)">' +
      (s.selectMode ? '列表里勾选，不要的点掉' : '打开后每行前面出现勾选框') + '</span></div></button>' +

      (hasOptional
        ? '<button type="button" class="opt' + (s.includeOptional ? '' : ' off') + '" data-act="toggle" data-what="optional">' +
          '<span class="box">' + icon(IC.check, '#fff') + '</span>' +
          '<div>也列出可选兼容项<br><span style="color:var(--ink-3)">作者标成非强制，不开也能正常启动</span></div></button>'
        : '') +

      (packList.length
        ? '<button type="button" class="opt' + (s.includePacks ? '' : ' off') + '" data-act="toggle" data-what="packs">' +
          '<span class="box">' + icon(IC.check, '#fff') + '</span>' +
          '<div>资源包 / 光影也一起打包<br><span style="color:var(--ink-3)">' +
          (s.includePacks ? '会放进 resourcepacks / shaderpacks' : '默认只打 mods，不带它们') + '</span></div></button>'
        : '') +

      (hasContent
        ? '<div class="checks">' + checks.map(([text, ok]) =>
          '<div' + (ok ? '' : ' class="bad"') + '>' +
          icon(ok ? IC.check : '<path d="M6 6l12 12M18 6L6 18"/>', ok ? null : '#DE5E84') +
          text + '</div>'
        ).join('') + '</div>'
        : '<div class="hint err" style="margin:12px 0">' + (a
          ? '还没有能进包的模组。给不兼容的模组找适配版本，或在列表里恢复被排除的。'
          : '先把 mods 文件夹拖进来。') + '</div>') +

      (s.busy ? '<div class="loading"><span class="spinner"></span>' + esc(s.progress || '正在打包…') + '</div>' : '') +

      '<div class="pack-actions">' +
      '<button type="button" class="btn grad full" data-act="pack" data-format="mrpack"' + disabled + '>' +
      icon('<path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M4 16v4h16v-4"/>', '#fff') + '生成 .mrpack</button>' +
      '<button type="button" class="btn line full" data-act="pack" data-format="zip"' + disabled + '>生成普通 zip（mods 文件夹）</button>' +
      '</div>' +

      '<div class="hintbox">.mrpack：PCL 2.13 以上直接导入，在线前置按清单自动下载，本地 jar 放进 overrides/mods。<br>' +
      '普通 zip：会把在线前置也下载好一起打包，离线也能用。<br>' +
      '写进清单的加载器版本：<b>' + esc(s.env.loaderVersion || '未填') + '</b>（顶部「' + esc(verLabel) + '」可改）</div>';
  }

  R.renderDeps = renderDeps;
  R.renderRows = renderRows;
  R.renderPack = renderPack;
})(globalThis);
