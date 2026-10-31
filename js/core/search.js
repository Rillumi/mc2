/* ===== 搜索：拆词、字段匹配、命中高亮 =====
   与页面无关；整理 / 导览 / 打包预览共用同一套规则。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  function normalizeQuery(q) {
    return String(q == null ? '' : q)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function tokens(q) {
    const s = normalizeQuery(q);
    return s ? s.split(' ') : [];
  }

  function textOf(v) {
    if (v == null) return '';
    if (String(v).trim() === '' || v === 0) return '';
    return String(v).toLowerCase();
  }

  /* 所有词都命中任意一个字段（AND，顺序无关） */
  function matches(fields, q) {
    const list = tokens(q);
    if (!list.length) return true;
    const hay = (Array.isArray(fields) ? fields : [fields]).map(textOf);
    return list.every(t => hay.some(f => f.indexOf(t) >= 0));
  }

  function matchItem(q, fields) {
    return matches(fields, q);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* 先按原文本找位置，再分段转义，避免把 &amp; 这类实体误标 */
  function highlight(text, q) {
    const src = String(text == null ? '' : text);
    const list = tokens(q);
    if (!src || !list.length) return escapeHtml(src);

    const lower = src.toLowerCase();
    const ranges = [];
    for (const t of list) {
      let from = 0;
      while (true) {
        const i = lower.indexOf(t, from);
        if (i < 0) break;
        const end = i + t.length;
        if (!ranges.some(r => i < r.end && end > r.start)) ranges.push({ start: i, end });
        from = end;
      }
    }
    if (!ranges.length) return escapeHtml(src);

    ranges.sort((a, b) => a.start - b.start);
    let out = '';
    let at = 0;
    for (const r of ranges) {
      out += escapeHtml(src.slice(at, r.start));
      out += '<mark>' + escapeHtml(src.slice(r.start, r.end)) + '</mark>';
      at = r.end;
    }
    out += escapeHtml(src.slice(at));
    return out;
  }

  MC.search = { normalizeQuery, tokens, matches, matchItem, highlight, escapeHtml };
})(globalThis);
