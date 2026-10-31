/* ===== 整理视图：模组行 / 资源包与光影 / 行列表 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const R = (MC.render = MC.render || {});
  const { esc, tile, icon, IC, fmtSize, picker, scanBar, chosenOf } = R;

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
        '<div class="adaptbar">' + R.adaptState(s, group.id, attrs) +
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

  R.renderRows = renderRows;
})(globalThis);
