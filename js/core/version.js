/* ===== 版本号比较与 MC 版本区间 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  function vparts(v) {
    return String(v || '').replace(/[^\d.]/g, '').split('.').filter(Boolean).map(Number);
  }

  /** 返回 1 / 0 / -1（a 大于 / 等于 / 小于 b） */
  function cmp(a, b) {
    const x = vparts(a), y = vparts(b);
    const n = Math.max(x.length, y.length, 3);
    for (let i = 0; i < n; i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  function checkConstraint(token, target) {
    token = String(token).trim();
    if (!token || token === '*') return true;
    let op = '';
    const m = token.match(/^(>=|<=|>|<|=|~|\^)?\s*(.+)$/);
    if (m) { op = m[1] || ''; token = m[2].trim(); }
    const t = vparts(target), v = vparts(token);
    const c = cmp(target, token);
    switch (op) {
      case '>=': return c >= 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      case '<': return c < 0;
      case '=': return c === 0;
      case '~': return c >= 0 && t[0] === v[0] && t[1] === v[1];
      case '^': return c >= 0 && t[0] === v[0];
      default:
        if (String(token).split('.').length >= 3) return c === 0;
        return t[0] === v[0] && (t[1] === undefined || v[1] === undefined || t[1] === v[1]);
    }
  }

  /** range 支持 [1.20.1,1.21) / [1.20.1,) / >=1.20 / ~1.20.1 / 1.20.1 / * */
  function mcMatches(range, target) {
    if (!range || range === '*') return true;
    const r = String(range).trim();
    if (r.startsWith('[') || r.startsWith('(')) {
      const lowerInc = r.startsWith('[');
      const upperInc = r.endsWith(']');
      const parts = r.replace(/^[\[(]/, '').replace(/[)\]]$/, '').split(',').map(s => s.trim());
      if (parts.length === 2) {
        const lo = parts[0] || '0';
        const hi = parts[1] || '999';
        const cLo = cmp(target, lo);
        const cHi = cmp(target, hi);
        if (lowerInc ? cLo < 0 : cLo <= 0) return false;
        if (upperInc ? cHi > 0 : cHi >= 0) return false;
        return true;
      }
      if (parts.length === 1) return cmp(target, parts[0]) === 0;
      return true;
    }
    return r.split(/\s+/).every(tok => checkConstraint(tok, target));
  }

  function isPrerelease(v) {
    return /(alpha|beta|pre|rc\d?|snapshot|dev)/i.test(String(v || ''));
  }

  /** 候选排序：正式版优先 → 版本号高优先 */
  function compareForPick(versionA, versionB) {
    const pa = isPrerelease(versionA) ? 1 : 0;
    const pb = isPrerelease(versionB) ? 1 : 0;
    if (pa !== pb) return pa - pb;
    return cmp(versionB, versionA);
  }

  MC.version = { vparts, cmp, checkConstraint, mcMatches, isPrerelease, compareForPick };
})(globalThis);
