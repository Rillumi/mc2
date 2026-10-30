/* ===== 渲染层：只做「数据 → HTML」，不写业务判断 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  const PALETTE = [
    ['#F9C6DC', '#C7B4FA'], ['#BFD8FB', '#F6BBD7'], ['#FBD3E4', '#B9C7FA'],
    ['#C8E6F7', '#E4C8F5'], ['#F6D3C8', '#C9B6F7'], ['#D8C7F7', '#B7E3F0'],
    ['#F9DCC8', '#F3B9CE']
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function hue(text) {
    let h = 0;
    const str = String(text || '?');
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function tile(name, small) {
    const label = String(name || '?').trim()[0] || '?';
    const [a, b] = hue(name);
    return '<div class="tile' + (small ? ' sm' : '') + '" style="--a:' + a + ';--b:' + b + '">' + esc(label.toUpperCase()) + '</div>';
  }

  function icon(paths, color) {
    return '<svg viewBox="0 0 24 24"' + (color ? ' style="stroke:' + color + '"' : '') + '>' + paths + '</svg>';
  }

  const IC = {
    jar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    warn: '<path d="M12 4v10"/><circle cx="12" cy="18.5" r="1.4"/>',
    alert: '<path d="M12 3l9 16H3L12 3Z"/><path d="M12 9v5"/><circle cx="12" cy="16.6" r=".9"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    link: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    layers: '<path d="M4 7l8-4 8 4-8 4-8-4Z"/><path d="M4 12l8 4 8-4M4 17l8 4 8-4"/>',
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M19 18v3H6.5"/>',
    columns: '<rect x="3" y="4" width="8" height="16" rx="2"/><rect x="13" y="4" width="8" height="16" rx="2"/><path d="M7 9h0M7 13h0M17 9h0M17 13h0"/>',
    wrench: '<path d="M15.5 3a5 5 0 0 0-5.1 6.4L4 15.8V20h4.2l6.4-6.4A5 5 0 1 0 15.5 3Z"/><circle cx="15.5" cy="8.5" r="1.5"/>',
    pack: '<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>'
  };

  function fmtSize(bytes) {
    if (!bytes) return '0 MB';
    const mb = bytes / 1024 / 1024;
    if (mb < 1) return (bytes / 1024).toFixed(0) + ' KB';
    return (mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)) + ' MB';
  }

  /* ---------- 概览 ---------- */
  function renderStats(s) {
    const el = document.getElementById('stats');
    if (!el) return;
    const a = s.analysis;
    const stats = a ? a.stats : { total: s.mods.length, usable: 0, needChoose: 0 };
    const missing = s.deps.filter(d => !(d.added && d.status === 'ok' && d.version)).length;
    const cards = [
      [IC.jar, '#7C63E8', stats.total, '扫描到的模组'],
      [IC.check, '#40A87C', stats.usable, '可以直接用'],
      [IC.warn, '#D9963F', stats.needChoose, '需要你选一下'],
      [IC.alert, '#DE5E84', missing, '还缺的前置']
    ];
    el.innerHTML = cards.map(([p, c, n, t]) =>
      '<div class="stat"><div class="ic">' + icon(p, c) + '</div><div><b>' + n + '</b><small>' + t + '</small></div></div>'
    ).join('');
  }

  /* ---------- 筛选 ---------- */
  function countsOf(s) {
    const g = s.analysis ? s.analysis.groups : [];
    return {
      all: g.length,
      choose: g.filter(x => x.usableRows.length > 1).length,
      bad: g.filter(x => x.usableRows.length === 0).length,
      dup: g.filter(x => x.sizes > 1).length
    };
  }

  function renderFilters(s) {
    const el = document.getElementById('filters');
    if (!el) return;
    const c = countsOf(s);
    const items = [
      ['all', '全部 ' + c.all],
      ['choose', '需选择 ' + c.choose],
      ['bad', '不兼容 ' + c.bad],
      ['dup', '重复 ' + c.dup]
    ];
    el.innerHTML = items.map(([key, text]) =>
      '<button type="button" data-filter="' + key + '" aria-pressed="' + (s.filter === key) + '">' + text + '</button>'
    ).join('');
  }

  /* ---------- 自绘下拉 ---------- */
  function picker(s, key, currentText, items, cls) {
    const open = s.picker === key;
    return '<div class="picker' + (cls ? ' ' + cls : '') + '">' +
      '<button type="button" class="pick" data-act="picktoggle" data-pick="' + esc(key) + '"' +
      ' aria-haspopup="listbox" aria-expanded="' + open + '">' +
      '<span>' + esc(currentText) + '</span>' + icon(IC.chevron) + '</button>' +
      (open
        ? '<div class="menu" role="listbox">' + items.map(it =>
          '<button type="button" role="option" aria-selected="' + (it.value === it.current) + '"' +
          ' data-act="pickset" data-pick="' + esc(key) + '" data-value="' + esc(it.value) + '">' +
          '<span>' + esc(it.text) + '</span>' + (it.meta ? '<small>' + esc(it.meta) + '</small>' : '') +
          '</button>').join('') + '</div>'
        : '') +
      '</div>';
  }

  function versionItems(versions, currentId) {
    return (versions || []).map(v => ({
      value: v.id,
      current: currentId,
      text: v.version_number + (v.version_type !== 'release' ? '（' + v.version_type + '）' : ''),
      meta: v.date_published ? String(v.date_published).slice(0, 10) : ''
    }));
  }

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

  function compact(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
    return String(n);
  }

  /* ---------- 「找适配版本」控件 ---------- */
  function adaptAdded(s) {
    return Object.keys(s.adapt || {})
      .map(k => s.adapt[k])
      .filter(x => x.added && x.status === 'ok' && x.version && x.project);
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
        '<div class="main"><div class="name">' + esc(first.entry.nameZh || first.entry.name || group.displayId) +
        (first.entry.nameZh && first.entry.name ? '<i class="alias">' + esc(first.entry.name) + '</i>' : '') +
        ' <i>' + esc(first.entry.version || '') + '</i></div>' +
        '<div class="sub"><span class="tag bad">' + esc(reason) + '</span><span class="tag">不进打包</span></div></div>' +
        '<div class="side"><span class="dot bad"></span></div></div>' +
        '<div class="adaptbar">' + adaptState(s, group.id, attrs) + '</div>' +
        '</div>';
    }

    const e = chosen.entry;
    const multi = rows.length > 1;
    const tags = [
      '<span class="tag ok">' + esc(e.loader || '?') + '</span>',
      '<span class="tag">' + esc(e.mc || '?') + '</span>'
    ];
    if (group.sizes > 1) tags.push('<span class="tag">同 ID ' + group.sizes + ' 份</span>');
    if (s.filter === 'dup') tags.push('<span class="tag ok">已合并保留 1 份</span>');

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
      '<div class="main"><div class="name">' + esc(e.nameZh || e.name || group.displayId) +
      (e.nameZh && e.name ? '<i class="alias">' + esc(e.name) + '</i>' : '') +
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

    if (!s.mods.length) {
      el.innerHTML = '<div class="empty"><b>还没有扫描</b><br>把 mods 文件夹拖进来，或者点「只查一个模组」单独分析一个 jar。<br>全部在本地读取，文件不会上传。</div>';
      if (title) title.textContent = '整理方案';
      return;
    }

    if (!s.analysis) {
      el.innerHTML = '<div class="loading"><span class="spinner"></span>' + esc(s.progress || '正在分析…') + '</div>';
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

    const q = String(s.organizeQuery || '').trim().toLowerCase();
    if (q) {
      groups = groups.filter(g => {
        const row = chosenOf(s, g) || g.rows[0];
        const e = row.entry || {};
        return [g.displayId, e.name, e.nameZh, e.id, e.fileName].join(' ').toLowerCase().indexOf(q) >= 0;
      });
    }

    const extras = (s.mode === 'single'
      ? '<div class="extraline">单模组模式：只分析这一个 jar 的前置。' +
        '<button type="button" data-act="exit-single">退出，回到文件夹整理</button></div>'
      : '');

    const others = (a.others && a.others.length && s.mode === 'folder') ? othersSection(s, a.others) : '';

    el.innerHTML = '<div class="section-label">' + esc(label) + ' · ' + groups.length + ' 组' +
      (s.selectMode ? '<span class="selhint">点左边的方框取消进包</span>' : '') + '</div>' +
      extras +
      (s.progress ? '<div class="loading"><span class="spinner"></span>' + esc(s.progress) + '</div>' : '') +
      '<div class="rows">' + (groups.length
        ? groups.map(g => rowHtml(s, g)).join('')
        : '<div class="empty">' + (q
          ? '没有匹配「' + esc(s.organizeQuery) + '」的模组。'
          : others
            ? '这个文件夹里没有模组，只有下面的资源包与光影。'
            : '这个分类下没有内容。') + '</div>') + '</div>' +
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

  /* ---------- 详情抽屉 ---------- */
  function depLine(info) {
    const map = {
      env: ['ok', '游戏自带', ''],
      local: ['ok', '本地已有', info.version ? '本地版本 ' + info.version : '版本未知'],
      version: ['warn', '版本不够', '需要 ' + info.range + '，本地 ' + (info.version || '未知')],
      missing: ['bad', '缺失', info.range ? '需要 ' + info.range : '需要它但没有']
    };
    const [cls, word, note] = map[info.state] || ['', info.state, ''];
    return '<div class="dline">' +
      '<span class="tag ' + cls + '">' + esc(word) + '</span>' +
      '<b>' + esc(info.modId) + '</b>' +
      '<small>' + esc(note) + (info.state === 'local' && info.by ? '（' + esc(info.by) + '）' : '') +
      (info.mandatory ? '' : ' · 可选兼容') + '</small>' +
      '</div>';
  }

  /* ---------- 资源包 / 光影详情 ---------- */
  function otherDetailHtml(s) {
    const a = s.analysis;
    const uid = String(s.detail).slice(2);
    const o = a && (a.others || []).find(x => x.uid === uid);
    if (!o) return '';

    const isPack = o.kind === 'resourcepack';
    const counts = o.assetCounts || {};
    const ns = {};
    (o.assets || []).forEach(p => {
      const m = p.match(/^assets\/([^/]+)\//);
      if (m) ns[m[1]] = (ns[m[1]] || 0) + 1;
    });
    const nsTop = Object.keys(ns).sort((x, y) => ns[y] - ns[x]).slice(0, 10);

    let body = '';
    if (isPack) {
      body += '<div class="dsec-label">覆盖了多少东西</div>' +
        '<div class="statline">' +
        '<span><b>' + (o.assets ? o.assets.length.toLocaleString() : 0) + '</b> 个文件</span>' +
        '<span>贴图 <b>' + (counts.texture || 0).toLocaleString() + '</b></span>' +
        '<span>模型 <b>' + (counts.model || 0).toLocaleString() + '</b></span>' +
        '<span>语言 <b>' + (counts.lang || 0).toLocaleString() + '</b></span>' +
        '<span>声音 <b>' + (counts.sound || 0).toLocaleString() + '</b></span>' +
        '</div>' +
        (nsTop.length ? '<div class="nslist">' + nsTop.map(n =>
          '<span class="tag">' + esc(n) + ' · ' + ns[n].toLocaleString() + '</span>').join('') + '</div>' : '');

      const others = (a.others || []).filter(x => x.kind === 'resourcepack' && x.uid !== o.uid);
      if (!others.length) {
        body += '<div class="dsec-label">和别的资源包对比</div><div class="hint">目前只有这一个资源包，没法对比。</div>';
      } else {
        const items = others.map(x => ({
          value: x.uid,
          current: s.rpPair[o.uid] || '',
          text: x.fileName,
          meta: (x.assets ? x.assets.length.toLocaleString() + ' 个文件' : '')
        }));
        const pair = s.rpPair[o.uid];
        const other = pair ? others.find(x => x.uid === pair) : null;
        let cmp = '';
        if (other) {
          const bset = new Set((other.assets || []).map(x => x.toLowerCase()));
          const hit = (o.assets || []).filter(x => bset.has(x.toLowerCase()));
          cmp = hit.length
            ? '<div class="warnbox"><div class="warnbox-head">' + icon(IC.alert, '#DE5E84') +
              '和「' + esc(other.fileName) + '」重叠 ' + hit.length.toLocaleString() + ' 个文件</div>' +
              '<div class="wline"><span>重叠 = 两个包都替换同一个文件，游戏里只有优先级高的那个生效（资源包列表越靠上越高）。</span></div>' +
              '<div class="pathlist">' + hit.slice(0, 10).map(p => '<code>' + esc(p) + '</code>').join('') +
              (hit.length > 10 ? '<span>还有 ' + (hit.length - 10).toLocaleString() + ' 个…</span>' : '') + '</div></div>'
            : '<div class="hint okline">两份包完全没有重叠，改的是不同文件，可以同时启用。</div>';
        }
        body += '<div class="dsec-label">和别的资源包对比</div>' +
          picker(s, 'p:' + o.uid, other ? other.fileName : '选一个资源包', items, 'detail-picker') + cmp;
      }
    } else if (o.kind === 'shader') {
      body += '<div class="dsec-label">光影</div>' +
        '<div class="dmeta"><span>' + (o.shaderFiles ? o.shaderFiles + ' 个 shader 文件' : '没有可读的文件列表') + '</span>' +
        '<span>光影一次只会启用一个，多个光影包不冲突，选一个用就行。</span></div>';
    }

    return '<div class="sheet detail" role="dialog" aria-modal="true" aria-label="资源包详情">' +
      '<div class="sheet-head">' +
      '<div class="sheet-title">' + tile(o.fileName, true) +
      '<div><b>' + esc(o.fileName) + '</b><small>' +
      (isPack ? '资源包' : o.kind === 'shader' ? '光影' : '其他') + ' · ' + fmtSize(o.size) + '</small></div></div>' +
      '<button type="button" class="icon-btn" data-act="close" aria-label="关闭">' + icon(IC.close) + '</button>' +
      '</div>' +
      '<div class="sheet-body">' +
      '<div class="dsec-label">文件</div>' +
      '<div class="dmeta"><b>' + esc(o.fileName) + '</b><span>' + fmtSize(o.size) +
      (isPack ? ' · pack_format ' + esc(o.packFormat || '未知') : '') + '</span></div>' +
      (o.description ? '<div class="descbox">' + esc(o.description) + '</div>' : '') +
      body +
      '</div>' +
      '<div class="sheet-foot"><button type="button" class="btn grad" data-act="close">看完了</button></div>' +
      '</div>';
  }

  /* ---------- 简介：原文 + 机翻切换 ---------- */
  function descSection(s, gid, e) {
    if (!e.description) {
      return '<div class="dsec-label">这个模组是干什么的</div>' +
        '<div class="hint">这个 jar 里没写简介。说明可能在 Modrinth 页面或作者的网盘里，下面「找资源」可以直接跳过去。</div>';
    }
    const lang = s.descLang || 'zh';
    const tr = s.descTr && s.descTr[gid];
    const tabs = '<div class="desc-tabs">' +
      '<button type="button" data-act="desclang" data-lang="zh" aria-pressed="' + (lang === 'zh') + '">中文（机翻）</button>' +
      '<button type="button" data-act="desclang" data-lang="en" aria-pressed="' + (lang === 'en') + '">作者原文</button>' +
      '</div>';

    let body = '';
    let note = '';
    if (lang === 'en') {
      body = '<div class="descbox raw">' + esc(e.description) + '</div>';
      note = '这是 jar 里作者写的原文。';
    } else if (tr && tr.status === 'ok') {
      body = '<div class="descbox">' + esc(tr.text) + '</div>';
      note = '机翻只作参考，模组名和专有名词可能翻歪；想看原句点「作者原文」。';
    } else if (tr && tr.status === 'error') {
      body = '<div class="descbox raw">' + esc(e.description) + '</div>';
      note = '机翻没成功（' + (tr.reason || '网络问题') + '），先显示原文。点一下「中文（机翻）」可以再试。';
    } else {
      body = '<div class="descbox raw">' + esc(e.description) + '</div>';
      note = '正在机翻…（第一次要连一下翻译接口，文本会发给 Google 翻译）';
    }

    return '<div class="dsec-label">这个模组是干什么的<span class="dsrc">来源：jar 里作者写的说明</span></div>' +
      tabs + body + '<div class="descnote">' + esc(note) + '</div>';
  }

  function detailHtml(s) {
    const a = s.analysis;
    if (String(s.detail || '').indexOf('o:') === 0) return otherDetailHtml(s);
    const group = a && a.groups.find(g => g.id === s.detail);
    if (!group) return '';
    const rows = MC.selector.sortRows(group.usableRows, s.env);
    const chosen = rows.find(r => r.uid === s.selection[group.id]) || rows[0];
    const e = chosen ? chosen.entry : group.rows[0].entry;

    const items = rows.map(r => ({
      value: r.uid, current: chosen ? chosen.uid : '', text: MC.selector.label(r.entry), meta: r.entry.fileName
    }));
    const mrl = 'https://modrinth.com/mod/' + encodeURIComponent(String(e.id || '').toLowerCase());

    const depInfo = (chosen && chosen.depInfo) ? chosen.depInfo : [];
    const optCount = depInfo.filter(d => !d.mandatory).length;
    const depList = chosen && depInfo.length
      ? '<div class="dsec-label">前置（' +
        (optCount ? '必需 ' + (depInfo.length - optCount) + ' / 可选兼容 ' + optCount : depInfo.length) + '）</div>' +
        depInfo.map(depLine).join('') +
        (optCount ? '<div class="hint">带「可选兼容」的项不是启动必需，是作者给联动/兼容留的口子；不装也能正常运行。</div>' : '')
      : (chosen ? '<div class="dsec-label">前置</div><div class="hint">这个模组没有声明前置。</div>' : '');

    const bad = !chosen
      ? '<div class="warnbox"><div class="warnbox-head">' + icon(IC.alert, '#DE5E84') + '不能进包</div>' +
        '<div class="wline"><span>' + esc(group.rows[0].entry.error || '加载器或游戏版本不符') + '</span></div></div>'
      : '';

    const note = chosen
      ? '<div class="hint dnote">『语义冲突』（两个模组改同一个方块、抢同一个配方）没法从 jar 里读出来，' +
        '只能靠进游戏看日志。这里能确认的是加载器、游戏版本、前置是否齐、前置版本够不够、有没有 ID 撞车。</div>'
      : '';

    const savedLinks = s.links[e.id] || [];
    const links = '<div class="dsec-label">我存的下载页（' + savedLinks.length + '）</div>' +
      '<div class="linkbox">' +
      savedLinks.map(l =>
        '<div class="lrow"><span class="tag">' + siteTag(l.url) + '</span>' +
        '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
        esc(l.note || l.url) + '</a>' +
        '<button type="button" class="icon-btn sm" data-act="linkdel" data-id="' + esc(e.id) +
        '" data-url="' + esc(l.url) + '" aria-label="删除">×</button></div>').join('') +
      '<div class="ladd">' +
      '<input id="linkUrl" type="url" placeholder="Modrinth / CurseForge / 爱发电 / 网盘链接">' +
      '<input id="linkNote" placeholder="备注（可选）">' +
      '<button type="button" class="btn line xs" data-act="linkadd" data-id="' + esc(e.id) + '">存下</button>' +
      '</div>' +
      '<div class="hint">只存在这台电脑的浏览器里，下次打开还在。要一次存很多个，去「工具 → 下载页仓库」批量导入。</div>' +
      '<div class="actions"><button type="button" class="btn line xs" data-act="gotools">打开批量导入</button></div>' +
      '</div>';

    return '<div class="sheet detail" role="dialog" aria-modal="true" aria-label="模组详情">' +
      '<div class="sheet-head">' +
        '<div class="sheet-title">' + tile(e.nameZh || e.name || group.displayId, true) +
        '<div><b>' + esc(e.nameZh || e.name || group.displayId) +
        (e.nameZh && e.name ? '<i class="alias">' + esc(e.name) + '</i>' : '') + '</b><small>' + esc(e.version || '版本未知') +
        ' · ' + esc(e.loader || '?') + ' · ' + fmtSize(e.size) + '</small></div></div>' +
        '<button type="button" class="icon-btn" data-act="close" aria-label="关闭">' + icon(IC.close) + '</button>' +
      '</div>' +
      '<div class="sheet-body">' +
        '<div class="dsec-label">文件</div>' +
        '<div class="dmeta"><b>' + esc(e.fileName || '—') + '</b><span>' + fmtSize(e.size) + ' · modId ' +
        esc(e.id || '—') + '</span><span>MC 要求：' + esc(e.mcRange || e.mc || '未声明') + '</span></div>' +
        descSection(s, group.id, e) +
        recipeHtml(e) +
        (chosen ? updateSection(s, group.id, e) : '') +
        (rows.length > 1 ? '<div class="dsec-label">这个模组有 ' + rows.length + ' 份，进包的是</div>' +
          picker(s, 'g:' + group.id, MC.selector.label(chosen.entry), items, 'row-picker detail-picker') : '') +
        bad + depList + links + (chosen ? sourceSection(s, e) : '') + (chosen ? compatSection(s, e) : '') + note +
      '</div>' +
      '<div class="sheet-foot">' +
        '<button type="button" class="btn line" data-act="toggle-exclude" data-group="' + esc(group.id) + '">' +
        (s.excluded[group.id] ? '恢复进包' : '不要这个') + '</button>' +
        '<a class="btn line" href="' + esc(mrl) + '" target="_blank" rel="noopener">' + icon(IC.link) + 'Modrinth 页面</a>' +
        '<button type="button" class="btn grad" data-act="close">看完了</button>' +
      '</div>' +
      '</div>';
  }

  /* ---------- 打包预览 ---------- */
  function packItemHtml(group, s) {
    const rows = MC.selector.sortRows(group.usableRows, s.env);
    const chosen = rows.find(r => r.uid === s.selection[group.id]) || rows[0];
    const e = chosen ? chosen.entry : group.rows[0].entry;
    return '<div class="pitem">' + tile(e.nameZh || e.name || group.displayId, true) +
      '<div class="t"><b>' + esc(e.nameZh || e.name || group.displayId) + '</b><small>' + esc(e.version || '版本未知') +
      ' · ' + fmtSize(e.size) + '</small></div>' +
      '<button type="button" class="btn line xs" data-act="exremove" data-group="' + esc(group.id) + '">移除</button>' +
      '</div>';
  }

  function previewHtml(s) {
    const a = s.analysis;
    if (!a) return '';
    const picked = MC.selector.selectedRows(s, a);
    const added = s.deps.filter(d => d.added && d.status === 'ok' && d.version);
    const adapted = adaptAdded(s);
    const adaptedGroups = {};
    adapted.forEach(x => { if (x.kind === 'group' && x.groupId) adaptedGroups[x.groupId] = true; });
    const excluded = MC.selector.excludedGroups(s, a);
    const bad = a.groups.filter(g => !g.usableRows.length && !adaptedGroups[g.id]);
    const others = a.others || [];
    const q = String(s.previewQuery || '').trim().toLowerCase();

    const match = name => !q || String(name).toLowerCase().indexOf(q) >= 0;
    const localGroups = a.groups.filter(g => (s.excluded[g.id] ? false : g.usableRows.length) && match(g.displayId));
    const addedShown = added.filter(d => match(d.project.title || d.modId));
    const adaptedShown = adapted.filter(x => match(x.project.title || x.id));
    const excludedShown = excluded.filter(g => match(g.displayId));
    const badShown = bad.filter(g => match(g.displayId));
    const othersShown = others.filter(o => match(o.fileName));

    const depSize = added.concat(adapted).reduce((n, d) => {
      const f = d.version.files && d.version.files[0];
      return n + ((f && f.size) || 0);
    }, 0);
    const totalSize = picked.reduce((n, r) => n + (r.entry.size || 0), 0) + depSize;
    const totalCount = picked.length + added.length + adapted.length;

    const sec = (title, count, hint, body) => count
      ? '<div class="psec"><div class="psec-head"><b>' + title + '</b><span>' + count + '</span>' +
        (hint ? '<small>' + hint + '</small>' : '') + '</div>' + body + '</div>'
      : '';

    const localBody = '<div class="plist">' + localGroups.map(g => packItemHtml(g, s)).join('') + '</div>';
    const depBody = '<div class="plist">' + addedShown.map(d =>
      '<div class="pitem">' + tile(d.project.title || d.modId, true) +
      '<div class="t"><b>' + esc(d.project.title || d.modId) + '</b><small>' + esc(d.version.version_number) +
      ' · ' + fmtSize((d.version.files && d.version.files[0] && d.version.files[0].size) || 0) + ' · 自动补的前置</small></div>' +
      '<button type="button" class="btn line xs" data-act="depunadd" data-key="' + esc(d.key) + '">移除</button>' +
      '</div>').join('') + '</div>';
    const adaptBody = '<div class="plist">' + adaptedShown.map(x =>
      '<div class="pitem">' + tile(x.project.title || x.id, true) +
      '<div class="t"><b>' + esc(x.project.title || x.id) + '</b><small>' + esc(x.version.version_number) +
      ' · ' + fmtSize((x.version.files && x.version.files[0] && x.version.files[0].size) || 0) +
      ' · 替换掉本地不兼容的那份</small></div>' +
      '<button type="button" class="btn line xs" data-act="adaptremove" data-key="' + esc(x.key) + '">撤销</button>' +
      '</div>').join('') + '</div>';
    const exBody = '<div class="plist">' + excludedShown.map(g => {
      const swapped = Object.keys(s.adapt || {}).some(k => {
        const x = s.adapt[k];
        return x.added && (x.excludedGroups || []).some(o => o.id === g.id);
      });
      return '<div class="pitem">' + tile(g.displayId, true) +
        '<div class="t"><b>' + esc(g.displayId) + '</b><small>' +
        (swapped ? '已换成适配版本，旧版不进包' : '你手动排除了，不进包') + '</small></div>' +
        '<button type="button" class="btn line xs" data-act="exinclude" data-group="' + esc(g.id) + '">恢复</button>' +
        '</div>';
    }).join('') + '</div>';
    const badBody = '<div class="plist">' + badShown.map(g =>
      '<div class="pitem muted">' + tile(g.rows[0].entry.nameZh || g.rows[0].entry.name || g.displayId, true) +
      '<div class="t"><b>' + esc(g.rows[0].entry.nameZh || g.rows[0].entry.name || g.displayId) + '</b><small>' +
      esc((g.rows[0].issues[0] && g.rows[0].issues[0].text) || '不可用') + '</small></div>' +
      '<span class="tag bad">不进包</span></div>').join('') + '</div>';
    const otherBody = '<div class="plist">' + othersShown.map(o =>
      '<div class="pitem muted">' + tile(o.fileName, true) +
      '<div class="t"><b>' + esc(o.fileName) + '</b><small>' +
      (o.kind === 'shader' ? '光影包' : o.kind === 'resourcepack' ? '资源包 / 材质包' : '不是模组') +
      ' · ' + fmtSize(o.size) + ' · 不放进 mods</small></div></div>').join('') + '</div>';

    return '<div class="sheet preview" role="dialog" aria-modal="true" aria-label="整合包预览">' +
      '<div class="sheet-head">' +
        '<div class="sheet-title"><div class="ptitle">' +
        '<b>' + totalCount + ' 个模组</b><small>' + esc(s.env.loader) + ' ' + esc(s.env.mc) +
        ' · 约 ' + fmtSize(totalSize) + '</small></div></div>' +
        '<button type="button" class="icon-btn" data-act="close" aria-label="关闭">' + icon(IC.close) + '</button>' +
      '</div>' +
      '<div class="preview-bar">' + icon(IC.search) +
        '<input id="previewQuery" value="' + esc(s.previewQuery) + '" placeholder="在包里搜模组名" spellcheck="false" aria-label="搜索包内模组">' +
      '</div>' +
      '<div class="sheet-body">' +
        (function () {
          const sections = sec('本地模组', localGroups.length, '点移除就不进包', localBody) +
            sec('自动补的前置', addedShown.length, '从 Modrinth 下载，版本已按你的环境筛过', depBody) +
            sec('换成适配版本', adaptedShown.length, '本地那份不兼容，已从 Modrinth 找好替代', adaptBody) +
            sec('已排除', excludedShown.length, '', exBody) +
            sec('不兼容', badShown.length, '加载器或游戏版本不符，已在包里跳过', badBody) +
            sec('资源包 / 光影', othersShown.length,
              s.includePacks ? '会一起放进 resourcepacks / shaderpacks' : '原样保留在列表里，但不会进 mods 文件夹', otherBody);
          if (sections) return sections;
          return q
            ? '<div class="empty">包里没有匹配「' + esc(s.previewQuery) + '」的模组。</div>'
            : '<div class="empty">还没有东西可以进包。</div>';
        })() +
      '</div>' +
      '<div class="sheet-foot">' +
        '<button type="button" class="btn line" data-act="close">继续调整</button>' +
        '<button type="button" class="btn grad" data-act="pack" data-format="mrpack"' + (totalCount ? '' : ' disabled') + '>就这样，生成 .mrpack</button>' +
      '</div>' +
      '</div>';
  }

  function renderOverlay(s) {
    const el = document.getElementById('overlay');
    if (!el) return;
    let html = '';
    if (s.detail) html = detailHtml(s);
    else if (s.previewOpen) html = previewHtml(s);

    if (!html) {
      el.hidden = true;
      el.classList.remove('open');
      el.innerHTML = '';
      document.body.classList.remove('no-scroll');
      return;
    }

    // 预览里「移出」会重绘整个面板，先把滚动位置记下来，避免画面跳一下
    const prevBody = el.querySelector('.sheet-body');
    const keepTop = prevBody ? prevBody.scrollTop : 0;
    const sameSheet = !el.hidden && el.querySelector('.sheet');

    el.hidden = false;
    el.classList.add('open');
    el.innerHTML = '<div class="scrim" data-act="close"></div>' + html;
    document.body.classList.add('no-scroll');

    const body = el.querySelector('.sheet-body');
    if (body && sameSheet) body.scrollTop = keepTop;
    // 已经打开着的弹窗，内容刷新时不要再播一次入场动效，否则看起来像闪了一下
    if (sameSheet) {
      const sheet = el.querySelector('.sheet');
      if (sheet) sheet.style.animation = 'none';
    }
  }

  /* ---------- 页签 ---------- */
  function renderTabs(s) {
    const el = document.getElementById('tabs');
    if (!el) return;
    const items = [
      ['organize', '整理', '挑版本 / 补前置 / 打包', IC.grid],
      ['guide', '导览', '这个包有什么', IC.book],
      ['diff', '对比', '两个包差什么', IC.columns],
      ['tools', '工具', '日志 / 资源包顺序', IC.wrench]
    ];
    el.innerHTML = items.map(([id, label, hint, ic]) => {
      let n = 0;
      if (id === 'guide' && s.analysis) n = s.analysis.groups.length;
      if (id === 'diff' && s.diff && s.diff.mods.length) n = s.diff.mods.length;
      return '<button type="button" role="tab" data-tab="' + id + '" aria-selected="' + (s.tab === id) + '">' +
        '<span class="tic">' + icon(ic) + '</span>' +
        '<span class="tx"><b>' + label + '</b><small>' + hint + '</small></span>' +
        (n ? '<span class="tcount">' + n + '</span>' : '') + '</button>';
    }).join('');
  }

  function renderViews(s) {
    const map = { organize: 'organizeView', guide: 'guideView', diff: 'diffView', tools: 'toolsView' };
    let shown = null;
    Object.keys(map).forEach(k => {
      const el = document.getElementById(map[k]);
      if (!el) return;
      el.hidden = s.tab !== k;
      if (s.tab === k) shown = el;
    });
    if (s.tab === 'guide') renderGuide(s);
    else if (s.tab === 'diff') renderDiff(s);
    else if (s.tab === 'tools') renderTools(s);
    // 切页时重放一次进场动效（display 切换不会自动重启动画）
    if (shown) {
      shown.style.animation = 'none';
      void shown.offsetWidth;
      shown.style.animation = '';
    }
  }

  function chosenOf(s, g) {
    const rows = MC.selector.sortRows(g.usableRows || [], s.env);
    return rows.find(r => r.uid === s.selection[g.id]) || rows[0] || null;
  }

  /* ---------- 导览 ---------- */
  function updateChip(u) {
    if (!u) return '';
    if (u.status === 'checking') return '<span class="tag">查更新…</span>';
    if (u.status === 'newer') return '<span class="tag warn">新版 ' + esc(u.latest) + '</span>';
    if (u.status === 'current') return '<span class="tag ok">已是最新</span>';
    if (u.status === 'notfound') return '<span class="tag">Modrinth 未收录</span>';
    if (u.status === 'nomatch') return '<span class="tag">无适配版本</span>';
    if (u.status === 'skip') return '<span class="tag">已跳过（不可用）</span>';
    if (u.status === 'error') return '<span class="tag bad">查询失败</span>';
    return '';
  }

  function gcard(s, it) {
    const e = it.entry;
    const cat = MC.catalog.labelOf(MC.catalog.categoryOf(e));
    const rec = typeof e.recipes === 'number' ? (e.recipes ? e.recipes + ' 个配方' : '没找到配方') : '';
    return '<div class="gcard" data-act="detail" data-group="' + esc(it.groupId) + '" role="button" tabindex="0" title="' + esc(e.fileName || '') + '">' +
      tile(e.nameZh || e.name || e.id, true) +
      '<div class="gmain">' +
      '<div class="gname"><span class="namezh">' + esc(e.nameZh || e.name || e.id) + '</span>' +
      (e.nameZh && e.name ? '<i class="alias">' + esc(e.name) + '</i>' : '') +
      (e.version ? ' <i>' + esc(e.version) + '</i>' : '') +
      '<span class="tag">' + esc(cat) + '</span>' + updateChip(s.updates[it.groupId]) + '</div>' +
      '<div class="gdesc">' + esc(e.description || '这个 jar 没写简介。') + '</div>' +
      '<div class="gmeta"><span>' + esc(e.id || '') + '</span>' +
      (rec ? '<span>' + esc(rec) + '</span>' : '') +
      '<span>' + fmtSize(e.size) + '</span></div>' +
      '</div></div>';
  }

  function renderGuide(s) {
    const el = document.getElementById('guideView');
    if (!el) return;
    const a = s.analysis;
    if (!a) {
      el.innerHTML = '<div class="vpanel"><div class="vhead"><h3>导览</h3></div>' +
        '<div class="minidrop" data-act="open-folder" role="button" tabindex="0">' +
        '<b>先把 mods 文件夹拖进来</b><span>导览会列出每个模组的简介、大致分类和自带配方数，方便先认识这个包。</span></div>' +
        '<div class="vfoot">导览只是只读浏览，不会改动整理方案。</div></div>';
      return;
    }

    const items = a.groups.map(g => {
      const row = chosenOf(s, g);
      return row ? { groupId: g.id, entry: row.entry } : null;
    }).filter(Boolean);

    const cats = MC.catalog.counts(items.map(x => x.entry));
    const q = String(s.guideQuery || '').trim().toLowerCase();
    const filtered = items.filter(it => {
      const e = it.entry;
      if (s.guideCat !== 'all' && MC.catalog.categoryOf(e) !== s.guideCat) return false;
      if (!q) return true;
      return [e.name, e.nameZh, e.id, e.description, e.fileName].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort((x, y) => String(x.entry.nameZh || x.entry.name || x.entry.id).localeCompare(String(y.entry.nameZh || y.entry.name || y.entry.id), 'zh'));

    const head = '<div class="vhead">' +
      '<h3>导览 · ' + items.length + ' 个模组</h3>' +
      (s.updateBusy ? '<span class="adnote"><span class="spinner"></span>检查更新 ' + s.updateDone + '/' + s.updateTotal + '</span>' : '') +
      '<button type="button" class="btn line sm" data-act="checkupdates"' + (s.updateBusy ? ' disabled' : '') + '>检查更新</button>' +
      '<button type="button" class="btn line sm" data-act="guideexport">导出 Markdown</button>' +
      '</div>';

    const banner = s.updateError
      ? '<div class="vbanner">' + esc(s.updateError) +
        '<button type="button" class="btn line xs" data-act="checkupdates">重试</button></div>'
      : '';

    const search = '<div class="vsearch">' + icon(IC.search) +
      '<input id="guideQuery" value="' + esc(s.guideQuery) + '" placeholder="搜模组名、modId、简介" spellcheck="false" aria-label="导览搜索"></div>';

    const catIds = ['all'].concat(cats.map(c => c.id));
    const catbar = '<div class="catbar" role="group" aria-label="分类">' + catIds.map(id => {
      const c = cats.find(x => x.id === id);
      const label = id === 'all' ? '全部 ' + items.length : MC.catalog.labelOf(id) + ' ' + (c ? c.n : 0);
      return '<button type="button" data-act="guidecat" data-cat="' + id + '" aria-pressed="' + (s.guideCat === id) + '">' + esc(label) + '</button>';
    }).join('') + '</div>';

    const list = filtered.length
      ? '<div class="glist">' + filtered.map(it => gcard(s, it)).join('') + '</div>'
      : '<div class="empty">' + (items.length ? '没有匹配的模组。' : '这个文件夹里没有模组。') + '</div>';

    el.innerHTML = '<div class="vpanel">' + head + banner + search + catbar + list +
      '<div class="vfoot">分类是按模组名和简介里的关键词粗分的，只用来方便浏览。简介和配方数都是从 jar 里读出来的；更新检查只对 Modrinth 收录的模组有效。</div></div>';
  }

  /* ---------- 对比 ---------- */
  function diffDropHtml() {
    return '<div class="vpanel"><div class="vhead"><h3>对比两个整合包</h3></div>' +
      '<div class="minidrop" id="diffDrop" data-drop="diff" data-act="pick-diff" role="button" tabindex="0">' +
      '<b>拖入另一个整合包的 mods 文件夹</b>' +
      '<span>按 modId 对比模组：共有、只在当前、只在另一个、版本不同；资源包和光影按文件名对比。当前这份不会被改动。</span></div>' +
      '<div class="vfoot">只会读 jar 里的元数据，不上传文件；对比结果不保存，换文件夹重来就行。</div></div>';
  }

  function diffRow(s, x, kind) {
    const e = kind === 'same' ? x.a : x.entry;
    const vers = kind === 'verdiff'
      ? '<span class="tag warn">当前 ' + esc(x.va || '?') + ' / 另一个 ' + esc(x.vb || '?') + '</span>'
      : '<span class="tag">' + esc((e && e.version) || '版本未知') + '</span>';
    return '<div class="drow">' + tile(x.name, true) +
      '<div class="t"><b>' + esc(x.name) + '</b><small>' + esc(x.id) +
      (e && e.size ? ' · ' + fmtSize(e.size) : '') + '</small></div>' + vers + '</div>';
  }

  function renderDiff(s) {
    const el = document.getElementById('diffView');
    if (!el) return;
    const d = s.diff || { mods: [] };
    if (!d.mods.length) { el.innerHTML = diffDropHtml(); return; }

    const res = MC.diff.compare(s.mods, d.mods);
    const c = res.counts;
    const head = '<div class="vhead"><h3>对比结果</h3>' +
      '<button type="button" class="btn line sm" data-act="pick-diff">换一个文件夹</button>' +
      '<button type="button" class="btn line sm" data-act="diffclear">清空对比</button></div>';

    const stats = '<div class="dstats">' +
      '<div class="dstat"><b>' + c.common + '</b><small>两个包都有</small></div>' +
      '<div class="dstat"><b>' + c.onlyA + '</b><small>只在当前包</small></div>' +
      '<div class="dstat"><b>' + c.onlyB + '</b><small>只在另一个包</small></div>' +
      '<div class="dstat"><b>' + c.versionDiff + '</b><small>版本不同</small></div></div>';

    const warning = !s.mods.length
      ? '<div class="hint err" style="padding:0 20px">当前包还没有导入，先在「整理」里拖入一个 mods 文件夹。</div>'
      : '';

    const sec = (title, hint, list, body) => list.length
      ? '<div class="dsec"><div class="psec-head"><b>' + title + '</b><span>' + list.length + '</span><small>' + hint + '</small></div>' + body + '</div>'
      : '';

    const onlyB = sec('只在另一个包', '想补进当前包的话，先确认加载器和游戏版本', res.onlyB, res.onlyB.map(x => diffRow(s, x, 'only')).join(''));
    const onlyA = sec('只在当前包', '另一个包没有这些', res.onlyA, res.onlyA.map(x => diffRow(s, x, 'only')).join(''));
    const ver = sec('版本不同', '同一个模组，两边版本号不一样', res.versionDiff, res.versionDiff.map(x => diffRow(s, x, 'verdiff')).join(''));

    const sameList = res.common.filter(x => x.same);
    const sameBody = s.diffSameOpen
      ? '<div class="dlist">' + sameList.map(x => diffRow(s, x, 'same')).join('') + '</div>'
      : '';
    const same = sameList.length
      ? '<div class="dsec"><button type="button" class="foldhead" data-act="diffsame" aria-expanded="' + !!s.diffSameOpen + '">' +
        '<b>两个包都一样的模组</b><span class="tcount">' + sameList.length + '</span>' +
        '<small>' + (s.diffSameOpen ? '收起' : '展开看清单') + '</small></button>' + sameBody + '</div>'
      : '';

    // 资源包 / 光影对比
    const curPacks = (s.analysis && s.analysis.others) || [];
    const othPacks = d.others || [];
    const pk = MC.diff.comparePacks(curPacks, othPacks);
    const pkRow = (x, kind) => {
      if (kind === 'both') {
        return '<div class="drow">' + tile(x.name, true) +
          '<div class="t"><b>' + esc(x.name) + '</b><small>两个包都有 · 覆盖文件 ' +
          x.na.toLocaleString() + ' / ' + x.nb.toLocaleString() + '</small></div>' +
          '<span class="tag ' + (x.same ? 'ok' : 'warn') + '">' + (x.same ? '一样' : '不一样') + '</span></div>';
      }
      return '<div class="drow">' + tile(x.name, true) +
        '<div class="t"><b>' + esc(x.name) + '</b><small>' +
        (x.entry.kind === 'shader' ? '光影' : '资源包') + ' · ' +
        ((x.entry.assets && x.entry.assets.length) || 0).toLocaleString() + ' 个文件 · ' + fmtSize(x.entry.size) +
        '</small></div></div>';
    };
    const packSec = pk.count
      ? '<div class="dsec"><div class="psec-head"><b>资源包 / 光影</b><span>' + pk.count + '</span>' +
        '<small>按文件名配对，同名就并排比覆盖的文件数</small></div>' +
        (pk.common.length ? '<div class="dlist">' + pk.common.map(x => pkRow(x, 'both')).join('') + '</div>' : '') +
        (pk.onlyA.length ? '<div class="dlist">' + pk.onlyA.map(x => pkRow(x, 'a')).join('') + '</div>' : '') +
        (pk.onlyB.length ? '<div class="dlist">' + pk.onlyB.map(x => pkRow(x, 'b')).join('') + '</div>' : '') +
        '</div>'
      : '';

    el.innerHTML = '<div class="vpanel">' + head + stats + warning +
      '<div class="dlistwrap">' +
      (onlyB + onlyA + ver + same + packSec || '<div class="empty">两个包没有可对比的模组。</div>') +
      '</div>' +
      '<div class="vfoot">模组按 jar 里声明的主 modId 对比；资源包 / 光影按文件名对比，同名会并排比覆盖文件数。' +
      '如果某个模组在另一份里被拆成多个子模块，可能出现对不上的情况。</div></div>';
  }

  /* ---------- 工具 ---------- */
  function orderedPacks(s) {
    const list = ((s.analysis && s.analysis.others) || []).filter(o => o.kind === 'resourcepack');
    const pos = {};
    (s.rpOrder || []).forEach((uid, i) => { pos[uid] = i; });
    return list.slice().sort((a, b) => {
      const x = pos[a.uid] === undefined ? 1e9 : pos[a.uid];
      const y = pos[b.uid] === undefined ? 1e9 : pos[b.uid];
      return x - y;
    });
  }

  function rpCard(s) {
    const packs = orderedPacks(s);
    if (!packs.length) {
      return '<div class="vpanel toolcard"><div class="vhead"><h3>资源包顺序</h3></div>' +
        '<div class="vbody"><div class="hint">当前这份里没有资源包。拖入带材质包的文件夹后，这里会按优先级列出它们，并导出顺序文件。</div></div></div>';
    }
    const rows = packs.map((o, i) =>
      '<div class="rprow"><span class="rpnum">' + (i + 1) + '</span>' +
      '<div class="t"><b>' + esc(o.fileName) + '</b><small>' + fmtSize(o.size) + (o.description ? ' · ' + esc(o.description) : '') + '</small></div>' +
      '<div class="rpacts">' +
      '<button type="button" class="btn line xs" data-act="rp-up" data-uid="' + esc(o.uid) + '"' + (i === 0 ? ' disabled' : '') + '>上移</button>' +
      '<button type="button" class="btn line xs" data-act="rp-down" data-uid="' + esc(o.uid) + '"' + (i === packs.length - 1 ? ' disabled' : '') + '>下移</button>' +
      '</div></div>').join('');

    return '<div class="vpanel toolcard"><div class="vhead"><h3>资源包顺序</h3>' +
      '<button type="button" class="btn line sm" data-act="rpexport-order">导出顺序清单</button>' +
      '<button type="button" class="btn line sm" data-act="rpexport-options">导出 options.txt 片段</button></div>' +
      '<div class="vbody"><div class="rpnum-note">越靠上，优先级越高；两个包改同一个文件时，只有上面的生效。</div>' +
      '<div class="rplist">' + rows + '</div></div></div>';
  }

  function logCard(s) {
    const logs = s.logs || { findings: [] };
    if (!logs.name) {
      return '<div class="vpanel toolcard"><div class="vhead"><h3>日志诊断</h3></div>' +
        '<div class="minidrop" id="logDrop" data-drop="log" data-act="pick-log" role="button" tabindex="0">' +
        '<b>拖入 latest.log 或 crash-report</b>' +
        '<span>按行扫一遍，把「缺前置 / 重复 ID / Mixin 失败 / 找不到类」挑出来。</span></div>' +
        '<div class="vfoot">日志只在本地读，不会上传；这里只做粗筛，不能替代看原文。</div></div>';
    }

    const f = logs.findings || [];
    const list = f.length
      ? f.map(x => '<div class="logf ' + x.sev + '">' +
        '<h4>' + esc(x.label) + '<span>' + x.count + '</span></h4>' +
        x.samples.map(s2 => '<code>' + esc(s2.text) + '</code>').join('') +
        (x.file ? '<small>' + esc(x.file) + ' · 第 ' + x.samples[0].n + ' 行附近</small>' : '') +
        '</div>').join('')
      : '<div class="hint">没有匹配到已知的问题模式。日志共 ' + logs.lines + ' 行，含 ' + logs.errors + ' 条 ERROR，可能要看原文。</div>';

    return '<div class="vpanel toolcard"><div class="vhead"><h3>日志诊断</h3>' +
      '<span class="adnote">' + esc(logs.name) + ' · ' + logs.lines + ' 行 · ' + logs.errors + ' 个 ERROR</span>' +
      '<button type="button" class="btn line sm" data-act="pick-log">换一个日志</button>' +
      '<button type="button" class="btn line sm" data-act="logclear">清空</button></div>' +
      '<div class="vbody"><div class="loglist">' + list + '</div></div></div>';
  }

  /* ---------- 工具：下载页仓库 ---------- */
  function allLinks(s) {
    const out = [];
    Object.keys(s.links || {}).forEach(id => {
      (s.links[id] || []).forEach(l => out.push({ id, url: l.url, note: l.note || '', at: l.at || 0 }));
    });
    return out.sort((a, b) => b.at - a.at);
  }

  function entryById(s, id) {
    const a = s.analysis;
    if (!a) return null;
    const want = String(id || '').toLowerCase();
    for (const g of a.groups) {
      const row = chosenOf(s, g);
      if (!row) continue;
      const e = row.entry;
      if ([e.id, e.name, e.nameZh].some(x => String(x || '').toLowerCase() === want)) return e;
    }
    return null;
  }

  function linkCard(s) {
    const list = allLinks(s);
    const ids = Object.keys(s.links || {}).length;
    const whom = (id) => {
      const e = entryById(s, id);
      return e ? (e.nameZh || e.name || e.id) : id;
    };

    return '<div class="vpanel toolcard" style="margin-top:16px">' +
      '<div class="vhead"><h3>下载页仓库</h3>' +
      '<span class="adnote">' + list.length + ' 条 · ' + ids + ' 个模组</span></div>' +
      '<div class="vbody">' +
      '<div class="rpnum-note">存在这台电脑的浏览器里（localStorage），不是数据库；换浏览器或清缓存会丢。每条挂在模组下面，详情弹窗里也能单独加。' +
      '导出的整合包不会带这些链接。</div>' +
      (list.length
        ? '<div class="linklist">' + list.slice(0, 80).map(l =>
          '<div class="linkitem"><span class="tag">' + siteTag(l.url) + '</span>' +
          '<span class="lm">' + esc(whom(l.id)) + '</span>' +
          '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.note || l.url) + '</a>' +
          '<button type="button" class="icon-btn sm" data-act="linkdel" data-id="' + esc(l.id) +
          '" data-url="' + esc(l.url) + '" aria-label="删除">×</button></div>').join('') +
          (list.length > 80 ? '<div class="hint">只显示最近 80 条</div>' : '') + '</div>'
        : '<div class="hint">还没有存过链接。</div>') +
      '<div class="bulkbox">' +
      '<div class="bulk-label">批量导入 <small>一行一个，粘完点下面的按钮就行</small></div>' +
      '<textarea id="linkBulk" spellcheck="false" aria-label="批量导入下载页" placeholder="每行一条，用 | 分隔&#10;模组ID或名字 | 链接 | 备注&#10;例：jei | https://www.curseforge.com/minecraft/mc-mods/jei | CF 页面&#10;也可以只写：链接 | 备注（会存成「未归属」）"></textarea>' +
      '<div class="bulkrow"><button type="button" class="btn grad" data-act="linkbulk">批量存进仓库</button>' +
      '<span class="hint">名字对不上会存成「未归属」，之后也能在详情里补。</span></div>' +
      '</div>' +
      '</div></div>';
  }

  function renderTools(s) {
    const el = document.getElementById('toolsView');
    if (!el) return;
    el.innerHTML = '<div class="toolgrid">' + rpCard(s) + logCard(s) + '</div>' + linkCard(s);
  }

  /* ---------- 详情里的小节 ---------- */
  function recipeHtml(e) {
    if (typeof e.recipes !== 'number') return '';
    if (e.recipes) {
      return '<div class="dsec-label">配方</div><div class="hint">jar 里自带 <b>' + e.recipes +
        '</b> 个配方文件。这类方块/物品通常能在生存里按配方做出来。</div>';
    }
    return '<div class="dsec-label">配方</div><div class="hint">jar 里没找到配方文件。可能是创造模式专用、靠指令或结构获取，' +
      '或者配方写在别的模组里——建筑类模组里这种情况很常见。</div>';
  }

  function updateSection(s, gid, e) {
    const u = s.updates[gid];
    let chip = '';
    let text = '还没查。点一下去 Modrinth 看看有没有新版本。';
    if (u) {
      if (u.status === 'checking') { chip = '<span class="tag">查更新…</span>'; text = '正在查…'; }
      else if (u.status === 'newer') { chip = '<span class="tag warn">有新版 ' + esc(u.latest) + '</span>'; text = '本地 ' + esc(u.installed || e.version || '?') + '，Modrinth 最新 ' + esc(u.latest) + '。'; }
      else if (u.status === 'current') { chip = '<span class="tag ok">已是最新</span>'; text = 'Modrinth 上当前环境的最新版是 ' + esc(u.latest || '') + '。'; }
      else if (u.status === 'notfound') { chip = '<span class="tag">Modrinth 未收录</span>'; text = '这个 modId 在 Modrinth 查不到，可能只在 CurseForge 或作者自己的页面发布。'; }
      else if (u.status === 'nomatch') { chip = '<span class="tag">没有适配版本</span>'; text = '项目在 Modrinth，但没有 ' + esc(s.env.loader) + ' ' + esc(s.env.mc) + ' 的版本。'; }
      else if (u.status === 'skip') { chip = '<span class="tag">已跳过</span>'; text = '这个模组在当前加载器/游戏版本下不可用，没查更新。'; }
      else { chip = '<span class="tag bad">查询失败</span>'; text = friendlyReason(u.reason); }
    }
    return '<div class="dsec-label">更新</div><div class="uprow">' + chip + '<span class="hint">' + text + '</span></div>' +
      '<div class="actions upacts">' +
      '<button type="button" class="btn line xs" data-act="checkupdate" data-group="' + esc(gid) + '">检查这个模组</button>' +
      (u && u.url ? '<a class="btn line xs" href="' + esc(u.url) + '" target="_blank" rel="noopener">Modrinth 项目页</a>' : '') +
      '</div>';
  }

  function siteTag(url) {
    const u = String(url || '').toLowerCase();
    if (u.indexOf('afdian') >= 0) return '爱发电';
    if (u.indexOf('modrinth') >= 0) return 'Modrinth';
    if (u.indexOf('curseforge') >= 0) return 'CurseForge';
    if (/(pan\.baidu|lanzou|123pan|aliyundrive|quark|115\.com)/.test(u)) return '网盘';
    if (/(github\.com|gitee\.com)/.test(u)) return '仓库';
    return '链接';
  }

  function friendlyReason(reason) {
    const r = String(reason || '');
    if (/Failed to fetch|NetworkError|Load failed|ERR_/i.test(r)) {
      return '连不上 Modrinth——可能是网络、代理或浏览器拦截。本地整理和打包不受影响。';
    }
    if (/429|too many/i.test(r)) return 'Modrinth 请求太频繁被限流，过一会儿再点「检查更新」。';
    if (/50\d/.test(r)) return 'Modrinth 服务器暂时不可用，过一会儿再试。';
    return esc(r || '网络问题');
  }

  function sourceSection(s, e) {
    const q = String(e.name || e.id || '');
    if (!q) return '';
    const af = MC.links.afdianSearch(q);
    const bing = 'https://www.bing.com/search?q=' + encodeURIComponent(q + ' Minecraft 下载');
    return '<div class="dsec-label">找资源</div>' +
      '<div class="actions">' +
      '<a class="btn line sm" href="' + esc(af) + '" target="_blank" rel="noopener">爱发电搜「' + esc(q) + '」</a>' +
      '<a class="btn line sm" href="' + esc(bing) + '" target="_blank" rel="noopener">Bing 搜下载页</a>' +
      '</div>' +
      '<div class="hint">爱发电没有公开接口，只能跳到它的站内搜索。很多作者的发电页会写网盘和提取码；找到后把链接和备注存到下面的「我存的下载页」，下次就不用重找。</div>';
  }

  function compatSection(s, e) {
    const q = String(e.name || e.id || '');
    if (!q) return '';
    const bing = 'https://www.bing.com/search?q=' + encodeURIComponent(q + ' Minecraft 兼容补丁 compatibility patch');
    const cf = MC.links.curseforgeSearch(q + ' compat', s.env.mc);
    const mr = MC.links.modrinthSearch(q + ' compatibility', s.env);
    return '<div class="dsec-label">找兼容补丁</div>' +
      '<div class="actions">' +
      '<a class="btn line sm" href="' + esc(bing) + '" target="_blank" rel="noopener">Bing 搜「兼容补丁」</a>' +
      '<a class="btn line sm" href="' + esc(cf) + '" target="_blank" rel="noopener">CurseForge 搜 compat</a>' +
      '<a class="btn line sm" href="' + esc(mr) + '" target="_blank" rel="noopener">Modrinth 搜 compatibility</a>' +
      '</div>' +
      '<div class="hint">兼容补丁一般是第三方单独发布的 jar，名字里常带 compatibility / compat / patch。找到后把链接存到下面的「我存的下载页」，以后不用重找。工具没法自动认定哪个补丁适用于你这套组合。</div>';
  }

  /* ---------- 拖拽区状态 ---------- */
  function renderDrop(s) {
    const drop = document.getElementById('drop');
    const title = document.getElementById('dropTitle');
    const desc = document.getElementById('dropDesc');
    if (!drop || !title) return;
    const compact = s.mods.length > 0;
    drop.classList.toggle('compact', compact);
    if (s.dragCount > 0) {
      title.textContent = '松手就导入 ' + s.dragCount + ' 个文件';
      if (desc) desc.textContent = '拖进来的 .jar 会立刻解析，.zip 资源包/光影也会被认出来。';
      return;
    }
    if (s.mode === 'single') {
      title.textContent = '单模组检查';
      if (desc) desc.textContent = '现在只保留一个模组。拖一个新的 jar 进来会替换掉它，看它到底需要哪些前置。';
    } else if (compact) {
      title.textContent = '继续拖文件进来';
      if (desc) desc.textContent = '再拖一个 mods 文件夹或几个 jar 都可以，已经在列表里的会自动跳过。';
    } else {
      title.textContent = '把 mods 文件夹拖进来';
      if (desc) desc.textContent = '自动读取每个 jar 的模组信息，按你的加载器和游戏版本挑出合适的版本，缺前置自动去 Modrinth 配好，最后一键打包成可以直接安装的整合包。';
    }
  }

  function renderSelectBtn(s) {
    const btn = document.getElementById('selectBtn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(!!s.selectMode));
    btn.textContent = s.selectMode ? '完成选择' : '选择模组';
  }

  function all(s) {
    renderDrop(s);
    renderStats(s);
    renderTabs(s);
    renderViews(s);
    if (s.tab === 'organize') {
      renderFilters(s);
      renderSelectBtn(s);
      renderDeps(s);
      renderRows(s);
      renderPack(s);
    }
    renderOverlay(s);
  }

  MC.render = { all, esc, tile, fmtSize, countsOf, orderedPacks };
})(globalThis);
