/* ===== 打包预览：包里有什么、逐项移除 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const R = (MC.render = MC.render || {});
  const { esc, tile, icon, IC, fmtSize, adaptAdded } = R;

  function packItemHtml(group, s) {
    const hl = t => MC.search.highlight(t, s.previewQuery);
    const rows = MC.selector.sortRows(group.usableRows, s.env);
    const chosen = rows.find(r => r.uid === s.selection[group.id]) || rows[0];
    const e = chosen ? chosen.entry : group.rows[0].entry;
    return '<div class="pitem">' + tile(e.nameZh || e.name || group.displayId, true) +
      '<div class="t"><b>' + hl(e.nameZh || e.name || group.displayId) + '</b><small>' + esc(e.version || '版本未知') +
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
    const chain = s.plan ? s.plan.online.filter(d=>!s.plan.directOnline.includes(d)) : [];
    const adaptedGroups = {};
    adapted.forEach(x => { if (x.kind === 'group' && x.groupId) adaptedGroups[x.groupId] = true; });
    const excluded = MC.selector.excludedGroups(s, a);
    const bad = a.groups.filter(g => !g.usableRows.length && !adaptedGroups[g.id]);
    const others = a.others || [];
    const q = MC.search.normalizeQuery(s.previewQuery);
    const hl = t => MC.search.highlight(t, s.previewQuery);

    const match = fields => MC.search.matches(fields, q);
    const entryOf = g => {
      const row = MC.selector.sortRows(g.usableRows, s.env).find(r => r.uid === s.selection[g.id]);
      return (row || g.rows[0]).entry;
    };
    const localGroups = a.groups.filter(g => {
      if (s.excluded[g.id] || !g.usableRows.length) return false;
      const e = entryOf(g);
      return match([g.displayId, e.name, e.nameZh, e.id, e.fileName]);
    });
    const addedShown = added.filter(d => match([(d.project && d.project.title) || d.modId]));
    const adaptedShown = adapted.filter(x => match([(x.project && x.project.title) || x.id]));
    const excludedShown = excluded.filter(g => match([g.displayId]));
    const badShown = bad.filter(g => match([g.displayId, g.rows[0].entry.name, g.rows[0].entry.nameZh, g.rows[0].entry.id]));
    const othersShown = others.filter(o => match([o.fileName]));

    const depSize = added.concat(adapted,chain).reduce((n, d) => {
      const f = d.version.files && d.version.files[0];
      return n + ((f && f.size) || 0);
    }, 0);
    const totalSize = picked.reduce((n, r) => n + (r.entry.size || 0), 0) + depSize;
    const totalCount = picked.length + added.length + adapted.length + chain.length;

    const sec = (title, count, hint, body) => count
      ? '<div class="psec"><div class="psec-head"><b>' + title + '</b><span>' + count + '</span>' +
        (hint ? '<small>' + hint + '</small>' : '') + '</div>' + body + '</div>'
      : '';

    const localBody = '<div class="plist">' + localGroups.map(g => packItemHtml(g, s)).join('') + '</div>';
    const chainShown=chain.filter(d=>match([d.project.title,d.id]));
    const chainBody='<div class="plist">'+chainShown.map(d=>'<div class="pitem"><div class="t"><b>'+esc(d.project.title+' '+d.version.version_number)+'</b><small>被 '+esc(d.requiredBy.join('、'))+' 需要；移除上层模组后会重新计算</small></div></div>').join('')+'</div>';
    const depBody = '<div class="plist">' + addedShown.map(d =>
      '<div class="pitem">' + tile(d.project.title || d.modId, true, d.project.icon_url) +
      '<div class="t"><b>' + hl(d.project.title || d.modId) + '</b><small>' + esc(d.version.version_number) +
      ' · ' + fmtSize((d.version.files && d.version.files[0] && d.version.files[0].size) || 0) + ' · 自动补的前置</small></div>' +
      '<button type="button" class="btn line xs" data-act="depunadd" data-key="' + esc(d.key) + '">移除</button>' +
      '</div>').join('') + '</div>';
    const adaptBody = '<div class="plist">' + adaptedShown.map(x =>
      '<div class="pitem">' + tile(x.project.title || x.id, true, x.project.icon_url) +
      '<div class="t"><b>' + hl(x.project.title || x.id) + '</b><small>' + esc(x.version.version_number) +
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
        '<div class="t"><b>' + hl(g.displayId) + '</b><small>' +
        (swapped ? '已换成适配版本，旧版不进包' : '你手动排除了，不进包') + '</small></div>' +
        '<button type="button" class="btn line xs" data-act="exinclude" data-group="' + esc(g.id) + '">恢复</button>' +
        '</div>';
    }).join('') + '</div>';
    const badBody = '<div class="plist">' + badShown.map(g =>
      '<div class="pitem muted">' + tile(g.rows[0].entry.nameZh || g.rows[0].entry.name || g.displayId, true) +
      '<div class="t"><b>' + hl(g.rows[0].entry.nameZh || g.rows[0].entry.name || g.displayId) + '</b><small>' +
      esc((g.rows[0].issues[0] && g.rows[0].issues[0].text) || '不可用') + '</small></div>' +
      '<span class="tag bad">不进包</span></div>').join('') + '</div>';
    const otherBody = '<div class="plist">' + othersShown.map(o =>
      '<div class="pitem muted">' + tile(o.fileName, true) +
      '<div class="t"><b>' + hl(o.fileName) + '</b><small>' +
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
            sec('间接前置',chainShown.length,'从实际 JAR 元数据继续展开',chainBody) +
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
        '<button type="button" class="btn grad" data-act="pack-pick"' + (totalCount ? '' : ' disabled') + '>就这样，生成整合包</button>' +
      '</div>' +
      '</div>';
  }

  R.previewHtml = previewHtml;
})(globalThis);
