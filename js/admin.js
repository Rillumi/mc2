/* ModPilot 后台页：查看数据库三张表 + 两个文件缓存，支持导出 / 导入 / 删除 / 清空。
   接口都在 /api/admin/*，服务端只认 127.0.0.1。 */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const TABS = [
    { key: 'names', label: '中文名库' },
    { key: 'links', label: '链接库' },
    { key: 'cats', label: '分类库' },
    { key: 'afdian', label: '爱发电缓存' }
  ];
  const SITES = {
    afdian: '爱发电', modrinth: 'Modrinth', curseforge: 'CurseForge', github: 'GitHub',
    gitee: 'Gitee', planetminecraft: 'Planet MC', cloud: '网盘', personal: '作者网站', other: '其他'
  };

  const view = {
    tab: 'names',
    q: '',
    status: 'all',
    site: '',
    primary: '',
    overview: null,
    afdian: null,
    total: 0,
    rows: []
  };

  const st = MC.store.state;
  if (!st.pg) st.pg = {};
  TABS.forEach(t => { if (!st.pg[t.key]) st.pg[t.key] = 1; });

  /* ---------- 通用 ---------- */
  function fmtTime(ms) {
    const n = Number(ms) || 0;
    if (!n) return '—';
    const d = new Date(n);
    if (isNaN(d.getTime())) return '—';
    const p = x => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fmtSize(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    return (v / 1024 / 1024).toFixed(1) + ' MB';
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    let j = null;
    try { j = await res.json(); }
    catch (err) { throw new Error('接口返回异常（HTTP ' + res.status + '）'); }
    if (!j.ok) throw new Error(j.reason || '请求失败');
    return j;
  }

  async function postJson(path, obj) {
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj == null ? {} : obj)
    });
  }

  const tabLabel = key => (TABS.find(t => t.key === key) || {}).label || key;

  /* ---------- 头部 / 概览 ---------- */
  async function loadOverview() {
    const j = await api('/api/admin/overview');
    view.overview = j;
    const pill = $('#dbPill');
    pill.textContent = j.db ? ('MySQL 已连接 · ' + (j.database || '')) : ('MySQL 未连接 · ' + (j.dbError || ''));
    pill.className = 'adm-db ' + (j.db ? 'ok' : 'bad');
    renderStats();
    renderHint();
    setupFilter();
  }

  function renderStats() {
    const o = view.overview;
    if (!o) return;
    const cards = [
      { n: o.names.total, label: '中文名记录', sub: '已命中 ' + o.names.hit + ' · 没查到 ' + o.names.miss },
      { n: o.links, label: '下载链接', sub: '手动保存的条目' },
      { n: o.cats, label: '分类记录', sub: (o.pcats || []).length + ' 种主分类' },
      { n: o.afdian.creators, label: '爱发电作者', sub: o.afdian.posts + ' 条发电帖' }
    ];
    $('#stats').innerHTML = cards.map(c =>
      '<div class="adm-stat"><b>' + (Number(c.n) || 0) + '</b><span>' + esc(c.label) +
      '</span><small>' + esc(c.sub) + '</small></div>'
    ).join('');
  }

  function renderHint() {
    const o = view.overview;
    if (!o) return;
    const zh = o.files.zh || {};
    const af = o.files.afdian || {};
    const parts = [
      'MySQL ' + (o.db ? '已连接' : '未连接') + ' · ' + (o.database || ''),
      '中文名文件缓存 ' + fmtSize(zh.size) + (zh.at ? ' · 更新于 ' + fmtTime(zh.at) : ' · 还没有文件'),
      '爱发电缓存 ' + fmtSize(af.size) + (af.at ? ' · 更新于 ' + fmtTime(af.at) : ' · 还没有文件'),
      '爱发电令牌 ' + (o.afdian.token ? '已配置' : '没配置')
    ];
    if (!o.db && o.dbError) parts.push('数据库错误：' + o.dbError);
    $('#hint').innerHTML = parts.map(p => '<span>' + esc(p) + '</span>').join('');
  }

  /* ---------- 标签 / 筛选 / 按钮 ---------- */
  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(t =>
      '<button type="button" class="adm-tab" role="tab" data-tab="' + t.key + '" aria-current="' +
      (t.key === view.tab) + '">' + esc(t.label) + '</button>'
    ).join('');
  }

  function setupFilter() {
    const o = view.overview || {};
    const sel = $('#filter');
    const tab = view.tab;
    let opts = [];
    if (tab === 'names') {
      opts = [['all', '全部记录'], ['hit', '已命中中文名'], ['miss', '没查到'], ['file', '只在文件缓存里']];
    } else if (tab === 'links') {
      opts = [['', '全部站点']].concat((o.sites || []).map(s => [s.key, s.label]));
    } else if (tab === 'cats') {
      opts = [['', '全部主分类']].concat((o.pcats || []).map(p => [p.cat, p.cat + '（' + p.n + '）']));
    }
    sel.hidden = !opts.length;
    sel.innerHTML = opts.map(x =>
      '<option value="' + esc(x[0]) + '">' + esc(x[1]) + '</option>'
    ).join('');
    const cur = tab === 'names' ? view.status : tab === 'links' ? view.site : view.primary;
    sel.value = cur || '';
  }

  function syncButtons() {
    const t = view.tab;
    $('#clearBtn').textContent = t === 'names' ? '清空中文名库'
      : t === 'links' ? '清空链接库'
        : t === 'cats' ? '清空分类库' : '清空爱发电缓存';
    $('#missBtn').hidden = t !== 'names';
    $('#q').placeholder = t === 'names' ? '搜索 modId / 中文名 / 英文名 / 缩写'
      : t === 'links' ? '搜索模组名 / URL / 备注'
        : t === 'cats' ? '搜索 modId / 分类'
          : '搜索作者名 / user_id / 简介';
  }

  /* ---------- 列表 ---------- */
  async function load() {
    if (view.tab === 'afdian') return loadAfdian();
    const tab = view.tab;
    const qs = new URLSearchParams();
    qs.set('page', String(st.pg[tab] || 1));
    qs.set('size', String(st.pageSize || 30));
    if (view.q) qs.set('q', view.q);
    if (tab === 'names') qs.set('status', view.status);
    if (tab === 'links' && view.site) qs.set('site', view.site);
    if (tab === 'cats' && view.primary) qs.set('primary', view.primary);

    $('#list').innerHTML = '<div class="adm-empty">正在读取…</div>';
    try {
      const j = await api('/api/admin/' + tab + '?' + qs.toString());
      view.rows = j.rows || [];
      view.total = Number(j.total) || 0;
      st.pg[tab] = Number(j.page) || 1;
      renderTable();
      renderPager(view.total);
    } catch (err) {
      view.rows = [];
      view.total = 0;
      $('#list').innerHTML = '<div class="adm-empty">' + esc(err.message) + '</div>';
      $('#pager').innerHTML = '';
    }
  }

  function renderPager(total) {
    const pg = MC.pager.slice(view.tab, total);
    $('#pager').innerHTML = MC.pager.html(view.tab, pg, { unit: '条' });
  }

  function renderTable() {
    if (!view.rows.length) {
      $('#list').innerHTML = '<div class="adm-empty">没有记录</div>';
      return;
    }
    const html = view.tab === 'names' ? tableNames(view.rows)
      : view.tab === 'links' ? tableLinks(view.rows)
        : tableCats(view.rows);
    $('#list').innerHTML = html;
  }

  function tableNames(rows) {
    const head = '<tr><th>状态</th><th>中文名</th><th>英文名</th><th>modId</th><th>MC百科 / 来源</th><th>更新时间</th><th></th></tr>';
    const body = rows.map(n => {
      const tag = n.zh ? '<span class="tag ok">已命中</span>' : '<span class="tag bad">没查到</span>';
      const abbr = n.abbr ? '<span class="tag">' + esc(n.abbr) + '</span> ' : '';
      const link = n.url
        ? '<a class="adm-url" href="' + esc(n.url) + '" target="_blank" rel="noopener" title="' + esc(n.url) + '">' + esc(n.url) + '</a>'
        : '<span class="muted">—</span>';
      const src = n.origin === 'both' ? '数据库 + 文件' : n.origin === 'file' ? '只有文件缓存' : '只有数据库';
      return '<tr><td>' + tag + '</td>' +
        '<td class="cell-strong">' + abbr + (n.zh ? esc(n.zh) : '<span class="muted">—</span>') + '</td>' +
        '<td class="cell-en">' + esc(n.en || '—') + '</td>' +
        '<td class="mono">' + esc(n.id) + '</td>' +
        '<td>' + link + '<div class="muted small">' + esc(src) + '</div></td>' +
        '<td class="muted">' + fmtTime(n.at) + '</td>' +
        '<td class="cell-act"><button class="btn line xs danger" type="button" data-act="del-name" data-id="' + esc(n.id) + '">删除</button></td></tr>';
    }).join('');
    return '<table class="adm-table">' + head + body + '</table>';
  }

  function tableLinks(rows) {
    const head = '<tr><th>站点</th><th>模组</th><th>链接</th><th>备注</th><th>保存时间</th><th></th></tr>';
    const body = rows.map(l => {
      const site = '<span class="tag">' + esc(SITES[l.site] || l.site || '其他') + '</span>';
      return '<tr><td>' + site + '</td>' +
        '<td class="cell-strong">' + esc(l.modName || '—') + '<div class="mono muted">' + esc(l.modId || '') + '</div></td>' +
        '<td><a class="adm-url" href="' + esc(l.url) + '" target="_blank" rel="noopener" title="' + esc(l.url) + '">' + esc(l.url) + '</a></td>' +
        '<td class="cell-en">' + esc(l.note || '—') + '</td>' +
        '<td class="muted">' + fmtTime(l.at) + '</td>' +
        '<td class="cell-act"><button class="btn line xs danger" type="button" data-act="del-link" data-id="' + esc(l.id) + '">删除</button></td></tr>';
    }).join('');
    return '<table class="adm-table">' + head + body + '</table>';
  }

  function tableCats(rows) {
    const head = '<tr><th>modId</th><th>主分类</th><th>全部分类</th><th>来源</th><th>更新时间</th><th></th></tr>';
    const body = rows.map(c => {
      const cats = (c.cats || '').split(',').filter(Boolean)
        .map(x => '<span class="tag">' + esc(x) + '</span>').join(' ');
      const opts = '<option value="">未设置</option>' + MC.catalog.CATS.map(x =>
        '<option value="' + esc(x.id) + '"' + (x.id === c.primary ? ' selected' : '') + '>' +
        esc(x.label) + '</option>').join('');
      return '<tr><td class="mono">' + esc(c.id) + '</td>' +
        '<td><select class="adm-sel" data-act="set-cat" data-id="' + esc(c.id) + '" aria-label="设为主分类">' + opts + '</select></td>' +
        '<td>' + (cats || '<span class="muted">—</span>') + '</td>' +
        '<td class="muted">' + esc(c.source || '—') + '</td>' +
        '<td class="muted">' + fmtTime(c.at) + '</td>' +
        '<td class="cell-act"><button class="btn line xs danger" type="button" data-act="del-cat" data-id="' + esc(c.id) + '">删除</button></td></tr>';
    }).join('');
    return '<table class="adm-table">' + head + body + '</table>';
  }

  /* ---------- 爱发电 ---------- */
  async function loadAfdian() {
    $('#list').innerHTML = '<div class="adm-empty">正在读取…</div>';
    try {
      view.afdian = await api('/api/admin/afdian');
      renderAfdian();
    } catch (err) {
      $('#list').innerHTML = '<div class="adm-empty">' + esc(err.message) + '</div>';
      $('#pager').innerHTML = '';
    }
  }

  function afdianList() {
    const all = (view.afdian && view.afdian.creators) || [];
    const q = view.q.toLowerCase();
    if (!q) return all;
    return all.filter(c => [c.name, c.userId, c.doing, c.detail]
      .some(v => String(v || '').toLowerCase().indexOf(q) >= 0));
  }

  function renderAfdian() {
    const list = afdianList();
    if (!list.length) {
      $('#list').innerHTML = '<div class="adm-empty">' +
        (view.afdian && (view.afdian.creators || []).length ? '没有匹配的作者' : '还没有爱发电缓存') + '</div>';
      $('#pager').innerHTML = '';
      return;
    }
    const pg = MC.pager.slice('afdian', list.length);
    const rows = list.slice(pg.start, pg.end);
    const head = '<tr><th>作者</th><th>主页</th><th>发电帖</th><th>简介</th></tr>';
    const body = rows.map(c => {
      const posts = c.posts || [];
      const latest = posts.reduce((a, b) => (Number(b.created) || 0) > (Number(a.created) || 0) ? b : a, {});
      return '<tr>' +
        '<td class="cell-strong">' + esc(c.name || '—') + '<div class="mono muted">' + esc(c.userId || '') + '</div></td>' +
        '<td>' + (c.home
          ? '<a class="adm-url" href="' + esc(c.home) + '" target="_blank" rel="noopener">' + esc(c.home) + '</a>'
          : '<span class="muted">—</span>') + '</td>' +
        '<td>' + posts.length + ' 条' +
        (latest && latest.title ? '<div class="muted small">最新：' + esc(latest.title) + '</div>' : '') + '</td>' +
        '<td class="cell-en">' + esc(c.doing || '—') + '</td></tr>';
    }).join('');
    $('#list').innerHTML = '<table class="adm-table">' + head + body + '</table>';
    $('#pager').innerHTML = MC.pager.html('afdian', pg, { unit: '位' });
  }

  /* ---------- 操作 ---------- */
  async function refresh() {
    await loadOverview();
    if (view.tab === 'afdian') view.afdian = null;
    await load();
  }

  async function delName(id) {
    if (!confirm('删除「' + id + '」的中文名记录？数据库和文件缓存都会删掉。')) return;
    await postJson('/api/admin/names/delete', { id });
    toast('已删除 ' + id);
    await refresh();
  }

  async function delLink(id) {
    if (!confirm('删除这条链接？')) return;
    await postJson('/api/admin/links/delete', { id });
    toast('已删除');
    await refresh();
  }

  async function delCat(id) {
    if (!confirm('删除「' + id + '」的分类记录？')) return;
    await postJson('/api/admin/cats/delete', { id });
    toast('已删除');
    await refresh();
  }

  /* 人工设定的主分类记为 source=manual，主程序读库时优先用它，不再被 Modrinth 覆盖 */
  async function setCat(id, primary) {
    const row = view.rows.find(x => x.id === id) || {};
    await postJson('/api/mod-cats', { items: [{ id, cats: row.cats || '', primary, source: 'manual' }] });
    toast(primary ? '已设为主分类' : '已取消手动主分类');
    await refresh();
  }

  function clearFor(tab) {
    const map = {
      names: ['/api/admin/names/clear', { mode: 'all' }, '清空整个中文名库（数据库 + 文件缓存）？主程序下次会重新去 MC百科查。'],
      links: ['/api/admin/links/clear', {}, '清空全部下载链接？'],
      cats: ['/api/admin/cats/clear', {}, '清空整个分类库？主程序会重新从 Modrinth 拉。'],
      afdian: ['/api/admin/afdian/clear', {}, '清空爱发电作者缓存？登录令牌会保留。']
    };
    const hit = map[tab];
    if (!hit) return;
    if (!confirm(hit[2])) return;
    postJson(hit[0], hit[1]).then(async j => {
      toast(tab === 'names' && j.removed ? '已清空' : '已清空');
      await refresh();
    }).catch(err => toast(err.message));
  }

  async function clearMiss() {
    if (!confirm('清掉「没查到」的缓存？主程序下次遇到这些模组会重新查 MC百科。')) return;
    try {
      const j = await postJson('/api/admin/names/clear', { mode: 'miss' });
      toast('已清掉 ' + j.removed + ' 条没查到的记录');
      await refresh();
    } catch (err) { toast(err.message); }
  }

  async function importFile(file) {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (err) { toast('不是有效的 JSON 文件'); return; }
    if (!confirm('把「' + file.name + '」导入到' + tabLabel(view.tab) + '？同名记录会被覆盖。')) return;
    try {
      const j = await postJson('/api/admin/import?type=' + view.tab, data);
      toast('导入完成：' + j.saved + ' 条' + (j.skipped ? '，跳过 ' + j.skipped + ' 条' : ''));
      await refresh();
    } catch (err) { toast(err.message); }
  }

  /* ---------- 事件 ---------- */
  renderTabs();
  syncButtons();

  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    view.tab = b.dataset.tab;
    view.q = '';
    view.status = 'all';
    view.site = '';
    view.primary = '';
    $('#q').value = '';
    st.pg[view.tab] = 1;
    renderTabs();
    syncButtons();
    setupFilter();
    load();
  });

  let qTimer = null;
  function applyQuery() {
    view.q = $('#q').value.trim();
    st.pg[view.tab] = 1;
    load();
  }
  $('#q').addEventListener('input', () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(applyQuery, 320);
  });
  $('#q').addEventListener('keydown', e => {
    if (e.key === 'Enter') { clearTimeout(qTimer); applyQuery(); }
  });

  $('#filter').addEventListener('change', e => {
    const v = e.target.value;
    if (view.tab === 'names') view.status = v || 'all';
    else if (view.tab === 'links') view.site = v;
    else if (view.tab === 'cats') view.primary = v;
    st.pg[view.tab] = 1;
    load();
  });

  $('#expJson').addEventListener('click', () => {
    location.href = '/api/admin/export?type=' + view.tab + '&format=json';
  });
  $('#expCsv').addEventListener('click', () => {
    location.href = '/api/admin/export?type=' + view.tab + '&format=csv';
  });
  $('#impBtn').addEventListener('click', () => $('#impFile').click());
  $('#impFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) importFile(f);
  });
  $('#clearBtn').addEventListener('click', () => clearFor(view.tab));
  $('#missBtn').addEventListener('click', clearMiss);

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'del-name') return delName(el.dataset.id).catch(err => toast(err.message));
    if (act === 'del-link') return delLink(el.dataset.id).catch(err => toast(err.message));
    if (act === 'del-cat') return delCat(el.dataset.id).catch(err => toast(err.message));
    if (act === 'pg') {
      const total = view.tab === 'afdian' ? afdianList().length : view.total;
      const pg = MC.pager.slice(view.tab, total);
      let n = pg.page;
      if (el.dataset.pg === 'prev') n = pg.page - 1;
      else if (el.dataset.pg === 'next') n = pg.page + 1;
      else n = Number(el.dataset.pg) || pg.page;
      st.pg[view.tab] = Math.min(pg.pages, Math.max(1, n));
      load();
      document.getElementById('list').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  document.addEventListener('change', e => {
    if (e.target.matches('[data-act="set-cat"]')) {
      return setCat(e.target.dataset.id, e.target.value).catch(err => toast(err.message));
    }
    if (e.target.matches('[data-act="pgsize"]')) {
      const n = Number(e.target.value) || 30;
      st.pageSize = n;
      if (MC.store.savePageSize) MC.store.savePageSize();
      st.pg[view.tab] = 1;
      load();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.target.matches('[data-act="pgjump"]') && e.key === 'Enter') {
      const total = view.tab === 'afdian' ? afdianList().length : view.total;
      const pg = MC.pager.slice(view.tab, total);
      const n = Number(e.target.value);
      if (!n) return;
      st.pg[view.tab] = Math.min(pg.pages, Math.max(1, n));
      load();
    }
  });

  /* ---------- 启动 ---------- */
  (async function boot() {
    try {
      await loadOverview();
    } catch (err) {
      $('#dbPill').textContent = '后台接口不可用';
      $('#dbPill').className = 'adm-db bad';
      $('#hint').innerHTML = '<span>' + esc(err.message) + '</span>';
    }
    await load();
  })();
})();
