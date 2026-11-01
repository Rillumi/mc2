/* ===== 渲染层入口：左侧栏、页签、弹窗、按视图分发 =====
   具体视图在 js/ui/views/ 下，公共部件在 render-base.js */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const R = (MC.render = MC.render || {});
  const { icon, IC, picker, countsOf } = R;

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

  let lastTab = null;
  let animTimer = 0;

  function renderViews(s) {
    const map = { organize: 'organizeView', guide: 'guideView', diff: 'diffView', tools: 'toolsView' };
    let shown = null;
    Object.keys(map).forEach(k => {
      const el = document.getElementById(map[k]);
      if (!el) return;
      el.hidden = s.tab !== k;
      if (s.tab === k) shown = el;
    });
    if (s.tab === 'guide') R.renderGuide(s);
    else if (s.tab === 'diff') R.renderDiff(s);
    else if (s.tab === 'tools') R.renderTools(s);
    // 整页统一的果冻进场：只在真正换页时触发，边打字边筛不会一直晃
    if (shown && lastTab !== s.tab) {
      const wrapEl = document.querySelector('main.wrap');
      if (wrapEl) {
        clearTimeout(animTimer);
        wrapEl.classList.remove('anim');
        void wrapEl.offsetWidth;
        wrapEl.classList.add('anim');
        animTimer = setTimeout(() => wrapEl.classList.remove('anim'), 760);
      }
    }
    lastTab = s.tab;
  }

  let lastSheetKey = '';

  function renderOverlay(s) {
    const el = document.getElementById('overlay');
    if (!el) return;
    let html = '';
    if (s.detail) html = R.detailHtml(s);
    else if (s.previewOpen) html = R.previewHtml(s);
    else if (s.packPick) html = R.packPickHtml(s);

    if (!html) {
      el.hidden = true;
      el.classList.remove('open');
      el.innerHTML = '';
      document.body.classList.remove('no-scroll');
      lastSheetKey = '';
      return;
    }

    // 同一个弹窗里重新渲染（切中英文、预览移出、选版本）：保留滚动位置，也不重播入场动效
    const key = s.detail || (s.previewOpen ? 'preview' : 'packpick');
    const prevBody = el.querySelector('.sheet-body');
    const sameSheet = !el.hidden && !!el.querySelector('.sheet') && key === lastSheetKey;
    const keepTop = sameSheet && prevBody ? prevBody.scrollTop : 0;
    lastSheetKey = key;

    el.hidden = false;
    el.classList.add('open');
    el.innerHTML = '<div class="scrim' + (sameSheet ? '' : ' pop') + '" data-act="close"></div>' + html;
    document.body.classList.add('no-scroll');

    const body = el.querySelector('.sheet-body');
    if (body) body.scrollTop = keepTop;
    if (!sameSheet) {
      const sheet = el.querySelector('.sheet');
      if (sheet) sheet.classList.add('pop');
    }
  }

  /* ---------- 拖拽区状态 ---------- */
  function renderDrop(s) {
    const drop = document.getElementById('drop');
    const title = document.getElementById('dropTitle');
    const desc = document.getElementById('dropDesc');
    if (!drop || !title) return;
    const compact = s.mods.length > 0;
    drop.classList.toggle('compact', compact);
    drop.classList.toggle('reading', !!s.scan);
    if (s.scan) {
      const total = Math.max(0, s.scan.total || 0);
      const done = total ? Math.min(s.scan.done || 0, total) : 0;
      title.textContent = total ? '正在读取 ' + done + ' / ' + total : (s.scan.note || '正在扫描文件夹') + '…';
      if (desc) {
        desc.textContent = (s.scan.name ? s.scan.name + ' · ' : '') +
          '读完会自动分析前置、挑版本，不用管。';
      }
      return;
    }
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

  /* ---------- 左侧栏：游戏版本 / 加载器版本下拉 ---------- */
  function renderEnv(s) {
    const mcEl = document.getElementById('mcPick');
    if (mcEl) {
      const list = (s.mcList && s.mcList.length) ? s.mcList : [s.env.mc];
      const items = list.map(v => ({ value: v, current: s.env.mc, text: v }));
      mcEl.innerHTML = picker(s, 'env:mc', s.env.mc || (s.verLoading ? '加载版本…' : '选择版本'), items, 'rail-picker');
    }
    const ldEl = document.getElementById('loaderPick');
    if (ldEl) {
      const cur = s.env.loaderVersion || '';
      const items = [{ value: '', current: cur, text: '自动（不指定）' }]
        .concat((s.loaderList || []).map(v => ({ value: v, current: cur, text: v })));
      ldEl.innerHTML = picker(s, 'env:ld', cur || (s.verLoading ? '加载版本…' : '自动（不指定）'), items, 'rail-picker');
    }
  }

  function all(s) {
    renderDrop(s);
    renderStats(s);
    renderTabs(s);
    renderEnv(s);
    renderViews(s);
    if (s.tab === 'organize') {
      renderFilters(s);
      renderSelectBtn(s);
      R.renderDeps(s);
      R.renderRows(s);
      R.renderPack(s);
    }
    renderOverlay(s);
  }

  R.all = all;
})(globalThis);
