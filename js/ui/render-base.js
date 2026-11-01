/* ===== 渲染层公共部件：颜色、图标、转义、下拉、分页片段 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const R = (MC.render = MC.render || {});

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

  function tile(name, small, iconUrl) {
    const label = String(name || '?').trim()[0] || '?';
    const [a, b] = hue(name);
    const cls = 'tile' + (small ? ' sm' : '');
    const bg = '--a:' + a + ';--b:' + b;
    // 有 Modrinth 图标就盖在色块上；图片加载失败会自动移除，露出首字母
    if (iconUrl) {
      return '<div class="' + cls + ' hasimg" style="' + bg + '">' + esc(label.toUpperCase()) +
        '<img src="' + esc(iconUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' +
        '</div>';
    }
    return '<div class="' + cls + '" style="' + bg + '">' + esc(label.toUpperCase()) + '</div>';
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

  /* 自绘下拉 */
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

  function compact(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
    return String(n);
  }

  function countsOf(s) {
    const g = s.analysis ? s.analysis.groups : [];
    return {
      all: g.length,
      choose: g.filter(x => x.usableRows.length > 1).length,
      bad: g.filter(x => x.usableRows.length === 0).length,
      dup: g.filter(x => x.sizes > 1).length
    };
  }

  function chosenOf(s, g) {
    const rows = MC.selector.sortRows(g.usableRows || [], s.env);
    return rows.find(r => r.uid === s.selection[g.id]) || rows[0] || null;
  }

  /* 读取进度条：还在罗列文件夹、不知道总数时，用“来回跑”的不确定进度条 */
  function scanBar(s) {
    const sc = s.scan;
    if (!sc) return '';
    const total = Math.max(0, sc.total || 0);
    const done = total ? Math.min(sc.done || 0, total) : 0;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return '<div class="scanbar' + (total ? '' : ' list') + '" role="status" aria-live="polite">' +
      '<span class="spinner"></span>' +
      '<div class="scan-main">' +
      '<div class="scan-line"><b>' + esc(sc.note || '正在读取') +
      (total ? ' ' + done + ' / ' + total : '…') + '</b>' +
      (total ? '<span class="scan-pct">' + pct + '%</span>' : '') + '</div>' +
      '<div class="scan-track' + (total ? '' : ' running') + '"><i style="width:' + (total ? pct : 40) + '%"></i></div>' +
      (sc.name ? '<small>' + esc(sc.name) + '</small>' : '') +
      '</div></div>';
  }

  function adaptAdded(s) {
    return Object.keys(s.adapt || {})
      .map(k => s.adapt[k])
      .filter(x => x.added && x.status === 'ok' && x.version && x.project);
  }

  function siteTag(url, site) {
    if (site) {
      try { return MC.linksdb.siteLabel(site); } catch (err) { /* 用下面的兜底 */ }
    }
    const u = String(url || '').toLowerCase();
    if (u.indexOf('afdian') >= 0 || u.indexOf('ifdian') >= 0) return '爱发电';
    if (u.indexOf('modrinth') >= 0) return 'Modrinth';
    if (u.indexOf('curseforge') >= 0) return 'CurseForge';
    if (/(pan\.baidu|lanzou|123pan|aliyundrive|alipan|quark|115\.com|mediafire|mega\.nz|drive\.google)/.test(u)) return '网盘';
    if (/(github\.com|gitee\.com)/.test(u)) return '仓库';
    return '作者网站';
  }

  R.esc = esc;
  R.icon = icon;
  R.tile = tile;
  R.IC = IC;
  R.fmtSize = fmtSize;
  R.picker = picker;
  R.versionItems = versionItems;
  R.compact = compact;
  R.countsOf = countsOf;
  R.chosenOf = chosenOf;
  R.scanBar = scanBar;
  R.adaptAdded = adaptAdded;
  R.siteTag = siteTag;
})(globalThis);
