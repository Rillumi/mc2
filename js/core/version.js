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
    if (/^(?:\d+\.)*[x*]$/i.test(token)) {
      if (op && op !== '=') return false;
      const prefix = token.split('.').slice(0, -1).map(Number);
      const actual = vparts(target);
      return prefix.every((n, i) => actual[i] === n);
    }
    const t = vparts(target), v = vparts(token);
    const info = compareInfo(target, token);
    if (info.ambiguous) return false;
    const c = info.cmp;
    switch (op) {
      case '>=': return c >= 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      case '<': return c < 0;
      case '=': return c === 0;
      case '~': return c >= 0 && t[0] === v[0] && t[1] === v[1];
      case '^': return c >= 0 && t[0] === v[0] &&
        (v[0] !== 0 || (t[1] === v[1] && (v[1] !== 0 || t[2] === v[2])));
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
    return r.split(/\s*\|\|\s*/).some(part =>
      part.replace(/(>=|<=|>|<|=|~|\^)\s+/g, '$1').split(/\s+/).every(tok => checkConstraint(tok, target)));
  }

  function isPrerelease(v) {
    return /(alpha|beta|pre|rc\d?|snapshot|dev)/i.test(String(v || ''));
  }

  /* ---------- 语义版本：核心 / 预发布 / 修订 / 变体 ---------- */

  const MC_VER_RE = /^1\.(?:1[2-9]|2[0-9])(?:\.\d+)?x?$/;
  const LOADER_RE = /\b(forge|fabric|neoforge|quilt|fab)\b/g;
  const REV_RE = /(patch|hf|build|rev|revision|forge)[.\-_ ]?(\d+(?:\.\d+)*)/g;
  const PRE_RE = /(snapshot|alpha|beta|pre|rc|a|b)[.\-_ ]?(\d+)?/g;
  const PRE_RANK = { snapshot: 0, alpha: 1, a: 1, beta: 2, b: 2, pre: 3, rc: 4 };
  const VARIANT_RE = /(slim|all|english|birthday|non[-_ ]?official|client|server)/g;

  function cleanVer(v) {
    return String(v == null ? '' : v)
      .replace(/[＋]/g, '+')
      .replace(/[‐‑‒–—]/g, '-')
      .trim()
      .toLowerCase();
  }

  /**
   * 把版本字符串拆成：数字核心、预发布、修订、变体。
   * 只做“语义”，不管文件名；文件名解析在别的模块。
   */
  function parse(v) {
    const raw = String(v == null ? '' : v);
    let s = cleanVer(v);
    const out = { raw, core: [], pre: null, rev: null, variants: [], extra: [], ambiguous: false };
    if (!s) { out.ambiguous = true; return out; }

    // 1) 先抓修订段（forge.47 这种；forge1.20.1 是环境，跳过）
    let m;
    REV_RE.lastIndex = 0;
    while ((m = REV_RE.exec(s))) {
      const token = m[2];
      if (m[1] === 'forge' && MC_VER_RE.test(token)) continue;
      const num = Number(token.split('.')[0]);
      if (!out.rev || num > out.rev.num) out.rev = { name: m[1], num };
    }

    // 2) 去掉环境：mc1.20.1、mc 1.20.1、加载器字样
    s = s.replace(/mc[ ._-]?\d+(?:\.\d+)*x?/g, ' ');
    s = s.replace(LOADER_RE, ' ');

    // 3) 元数据版本可能恰好与 MC 版本相同，不能仅凭形状删掉核心。
    // 显式 mc 前缀已在上面移除；其余取第一个数字段，后续数字属于预发布/修订。
    const nums = [];
    const numRe = /\d+(?:\.\d+)*/g;
    while ((m = numRe.exec(s))) {
      nums.push({ text: m[0], index: m.index });
    }
    const pick = nums[0];
    if (!pick) { out.ambiguous = true; return out; }

    out.core = pick.text.split('.').map(Number);
    out.extra = nums.filter(n => n !== pick && !MC_VER_RE.test(n.text)).map(n => n.text);

    // 4) 核心之后的部分里找预发布 / 变体
    const tail = s.slice(pick.index + pick.text.length);

    PRE_RE.lastIndex = 0;
    while ((m = PRE_RE.exec(tail))) {
      // 避免把 "pre" 中间字母、"a" 这种误抓：要求前后是分隔符或串首尾
      const before = tail[m.index - 1] || '';
      const after = tail[m.index + m[0].length] || '';
      if (before && /[a-z0-9]/.test(before)) continue;
      if (after && /[a-z0-9]/.test(after)) continue;
      out.pre = { name: m[1], rank: PRE_RANK[m[1]] == null ? 2 : PRE_RANK[m[1]], num: m[2] ? Number(m[2]) : 0 };
      break;
    }

    VARIANT_RE.lastIndex = 0;
    while ((m = VARIANT_RE.exec(tail))) out.variants.push(m[1]);
    if (/re$/.test(tail.trim())) out.variants.push('re');

    return out;
  }

  function cmpCore(a, b) {
    const n = Math.max(a.length, b.length, 3);
    for (let i = 0; i < n; i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  /**
   * 语义比较：数字核心 → 预发布（正式版最大）→ 修订号。
   * 变体（slim/all/生日版等）不参与比较。
   */
  function cmpParsed(x, y) {
    const c = cmpCore(x.core, y.core);
    if (c) return c;

    const px = x.pre ? x.pre.rank : 5;
    const py = y.pre ? y.pre.rank : 5;
    if (px !== py) return px > py ? 1 : -1;
    if (x.pre && y.pre && x.pre.num !== y.pre.num) return x.pre.num > y.pre.num ? 1 : -1;

    const rx = x.rev ? x.rev.num : 0;
    const ry = y.rev ? y.rev.num : 0;
    if (rx !== ry) return rx > ry ? 1 : -1;
    return 0;
  }

  /**
   * 比较并带可信度：任何一边解析不出来就返回 ambiguous，不把“看不懂”当成相等。
   * @returns {{cmp: number, ambiguous: boolean}}
   */
  function compareInfo(a, b) {
    const x = parse(a), y = parse(b);
    if (x.ambiguous || y.ambiguous) return { cmp: 0, ambiguous: true };
    return { cmp: cmpParsed(x, y), ambiguous: false };
  }

  function compare(a, b) {
    return compareInfo(a, b).cmp;
  }

  function equals(a, b) {
    return compare(a, b) === 0;
  }

  /** 给存储 / 显示用的规范化字符串（不含环境与变体） */
  function canonical(v) {
    const p = parse(v);
    if (!p.core.length) return cleanVer(v);
    let s = p.core.join('.');
    if (p.pre) s += '-' + p.pre.name + (p.pre.num ? p.pre.num : '');
    if (p.rev) s += '+' + p.rev.name + p.rev.num;
    return s;
  }

  /** 候选排序：正式版优先 → 版本号高优先；判新旧和挑候选共用同一套 parse 语义 */
  function compareForPick(versionA, versionB) {
    const x = parse(versionA), y = parse(versionB);
    const ua = x.ambiguous ? 1 : 0;
    const ub = y.ambiguous ? 1 : 0;
    if (ua !== ub) return ua - ub;

    const pa = x.pre || isPrerelease(versionA) ? 1 : 0;
    const pb = y.pre || isPrerelease(versionB) ? 1 : 0;
    if (pa !== pb) return pa - pb;
    return -cmpParsed(x, y);
  }

  MC.version = {
    vparts, cmp, checkConstraint, mcMatches, isPrerelease, compareForPick,
    parse, compare, compareInfo, equals, canonical
  };
})(globalThis);
