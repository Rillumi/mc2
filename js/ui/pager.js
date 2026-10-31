/* ===== 通用分页：页码省略式 + 每页条数 + 跳页 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  const SIZES = [20, 30, 50, 100];
  const DEFAULT_SIZE = 30;

  // 页码只保留当前页附近几页，首尾固定，中间用 …
  function pageNums(page, pages) {
    if (pages <= 7) {
      const all = [];
      for (let i = 1; i <= pages; i++) all.push(i);
      return all;
    }
    const from = Math.max(2, page - 2);
    const to = Math.min(pages - 1, page + 2);
    const out = [1];
    if (from > 2) out.push('…');
    for (let i = from; i <= to; i++) out.push(i);
    if (to < pages - 1) out.push('…');
    out.push(pages);
    return out;
  }

  // 按当前状态把整表切成一页：页码越界时静默夹回合法范围
  function slice(key, total) {
    const st = MC.store.state;
    const size = st.pageSize || DEFAULT_SIZE;
    const count = Math.max(0, Number(total) || 0);
    const pages = Math.max(1, Math.ceil(count / size));
    let page = Number(st.pg && st.pg[key]) || 1;
    if (page > pages) page = pages;
    if (page < 1) page = 1;
    if (st.pg && st.pg[key] !== page) st.pg[key] = page;
    const start = (page - 1) * size;
    return { page, pages, size, total: count, start, end: Math.min(count, start + size) };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // opts: { anchor: 滚动回顶部的选择器, unit: 量的单位 }
  function html(key, pg, opts) {
    const o = opts || {};
    if (!pg || pg.pages <= 1) return '';
    const unit = o.unit || '个';
    const nav = [];
    nav.push('<button type="button" class="pgbtn" data-act="pg" data-pg="prev"' +
      (pg.page <= 1 ? ' disabled' : '') + '>‹ 上一页</button>');
    pageNums(pg.page, pg.pages).forEach(n => {
      nav.push(n === '…'
        ? '<span class="pgecl">…</span>'
        : '<button type="button" class="pgnum" data-act="pg" data-pg="' + n + '"' +
          (n === pg.page ? ' aria-current="true"' : '') + '>' + n + '</button>');
    });
    nav.push('<button type="button" class="pgbtn" data-act="pg" data-pg="next"' +
      (pg.page >= pg.pages ? ' disabled' : '') + '>下一页 ›</button>');

    const sizes = SIZES.map(n =>
      '<option value="' + n + '"' + (n === pg.size ? ' selected' : '') + '>' + n + '</option>'
    ).join('');

    return '<div class="pager" data-pgkey="' + esc(key) + '" data-pgpage="' + pg.page +
      '" data-pgpages="' + pg.pages + '"' + (o.anchor ? ' data-pganchor="' + esc(o.anchor) + '"' : '') + '>' +
      '<div class="pginfo">第 <b>' + pg.page + '</b> / ' + pg.pages + ' 页 · 共 ' + pg.total + ' ' + esc(unit) +
      '（' + (pg.start + 1) + '–' + pg.end + '）</div>' +
      '<div class="pgnav">' + nav.join('') + '</div>' +
      '<div class="pgtools">' +
      '<label class="pgsize">每页 <select data-act="pgsize">' + sizes + '</select></label>' +
      '<label class="pgjump">跳至 <input type="number" inputmode="numeric" min="1" max="' + pg.pages +
      '" data-act="pgjump" aria-label="跳到指定页"> 页</label>' +
      '</div></div>';
  }

  function reset(key) {
    const st = MC.store.state;
    if (st.pg) st.pg[key] = 1;
  }

  function resetAll() {
    const st = MC.store.state;
    if (!st.pg) return;
    Object.keys(st.pg).forEach(k => { st.pg[k] = 1; });
  }

  MC.pager = { SIZES, DEFAULT_SIZE, slice, html, reset, resetAll, pageNums };
})(globalThis);
