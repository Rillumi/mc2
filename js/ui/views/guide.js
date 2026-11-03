/* ===== 导览视图：卡片、分类、搜索 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const R = (MC.render = MC.render || {});
  const { esc, tile, icon, IC, fmtSize, chosenOf } = R;

  function updateChip(u) {
    if (!u) return '';
    if (u.status === 'checking') return '<span class="tag">查更新…</span>';
    if (u.status === 'newer') return '<span class="tag warn">新版 ' + esc(u.latest) + '</span>';
    if (u.status === 'current') return '<span class="tag ok">已是最新</span>';
    if (u.status === 'older') return '<span class="tag ok">本地更高</span>';
    if (u.status === 'ambiguous') return '<span class="tag">版本无法比较</span>';
    if (u.status === 'notfound') return '<span class="tag">Modrinth 未收录</span>';
    if (u.status === 'nomatch') return '<span class="tag">无适配版本</span>';
    if (u.status === 'skip') return '<span class="tag">已跳过（不可用）</span>';
    if (u.status === 'error') return '<span class="tag bad">查询失败</span>';
    return '';
  }

  function gcard(s, it) {
    const e = it.entry;
    const p = MC.flowCommon.projectForEntry(s, e, it.group);
    const hl = t => MC.search.highlight(t, s.guideQuery);
    const catTags = MC.catalog.tagsOf(e)
      .map(id => '<span class="tag">' + esc(MC.catalog.labelOf(id)) + '</span>').join('');
    const rec = typeof e.recipes === 'number' ? (e.recipes ? e.recipes + ' 个配方' : '没找到配方') : '';
    return '<div class="gcard" data-act="detail" data-group="' + esc(it.groupId) + '" role="button" tabindex="0" title="' + esc(e.fileName || '') + '">' +
      tile(e.nameZh || e.name || e.id, true, p && p.icon_url) +
      '<div class="gmain">' +
      '<div class="gname"><span class="namezh">' + hl(e.nameZh || e.name || e.id) + '</span>' +
      (e.nameZh && e.name ? '<i class="alias">' + hl(e.name) + '</i>' : '') +
      (e.version ? ' <i>' + esc(e.version) + '</i>' : '') +
      catTags + updateChip(s.updates[it.groupId]) + '</div>' +
      '<div class="gdesc">' + hl(e.description || '这个 jar 没写简介。') + '</div>' +
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
      return row ? { groupId: g.id, group: g, entry: row.entry } : null;
    }).filter(Boolean);

    const cats = MC.catalog.tagCounts(items.map(x => x.entry));
    const q = MC.search.normalizeQuery(s.guideQuery);
    const filtered = items.filter(it => {
      const e = it.entry;
      if (s.guideCat !== 'all' && MC.catalog.tagsOf(e).indexOf(s.guideCat) < 0) return false;
      if (!q) return true;
      return MC.search.matches([e.name, e.nameZh, e.id, e.description, e.fileName], q);
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

    const pg = MC.pager.slice('guide', filtered.length);
    const pageItems = filtered.slice(pg.start, pg.end);
    const pagerHtml = MC.pager.html('guide', pg, { anchor: '#guideView', unit: '个模组' });

    const list = filtered.length
      ? '<div class="glist">' + pageItems.map(it => gcard(s, it)).join('') + '</div>' + pagerHtml
      : '<div class="empty">' + (items.length ? '没有匹配的模组。' : '这个文件夹里没有模组。') + '</div>';

    el.innerHTML = '<div class="vpanel">' + head + banner + search + catbar + list +
      '<div class="vfoot">分类是按模组名和简介里的关键词粗分的，只用来方便浏览。简介和配方数都是从 jar 里读出来的；更新检查只对 Modrinth 收录的模组有效。</div></div>';
  }

  R.renderGuide = renderGuide;
})(globalThis);
