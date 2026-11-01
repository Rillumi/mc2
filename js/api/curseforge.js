/* ===== CurseForge 接口：key 只存本机 + 指纹反查 =====
   key 放 localStorage，不写进代码、不提交仓库；界面里可以随时清掉。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const KEY = 'modpilot.cf.key';
  const API = 'https://api.curseforge.com/v1';
  const GAME_MC = 432;
  const TIMEOUT = 12000;

  function key() {
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
  }

  function hasKey() {
    return !!key();
  }

  function setKey(k) {
    try {
      const v = String(k == null ? '' : k).trim();
      if (v) localStorage.setItem(KEY, v);
      else localStorage.removeItem(KEY);
    } catch { /* 隐私模式存不了就算了 */ }
  }

  async function request(path, opts) {
    const k = key();
    if (!k) return { ok: false, status: 0, reason: '还没填 CurseForge key' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const r = await fetch(API + path, {
        method: (opts && opts.method) || 'GET',
        headers: Object.assign({ Accept: 'application/json', 'x-api-key': k }, (opts && opts.headers) || {}),
        body: opts && opts.body,
        signal: ctrl.signal
      });
      if (r.status === 401) return { ok: false, status: 401, reason: 'key 无效或已过期' };
      if (r.status === 403) return { ok: false, status: 403, reason: '没有权限（也可能是 CDN 临时拒绝，稍后再试）' };
      if (r.status === 429) return { ok: false, status: 429, reason: '请求太频繁，等一会儿再试' };
      if (!r.ok) return { ok: false, status: r.status, reason: 'CurseForge 返回 ' + r.status };
      return { ok: true, data: await r.json() };
    } catch (err) {
      const timeout = err && err.name === 'AbortError';
      return { ok: false, status: 0, reason: timeout ? '连接超时' : '连不上 CurseForge 接口' };
    } finally {
      clearTimeout(timer);
    }
  }

  function test() {
    return request('/games');
  }

  /* items: [{ fp, name, size, sha1 }] → { ok, matches: { fp: { projectID, fileID } } } */
  async function lookup(items) {
    const map = {};
    const list = (items || []).filter(it => it && typeof it.fp === 'number');
    const bySha = {};
    const byName = {};
    list.forEach(it => {
      if (it.sha1) bySha[String(it.sha1).toLowerCase()] = it.fp;
      byName[String(it.name || '').toLowerCase() + '|' + (it.size || 0)] = it.fp;
    });
    let failed = 0;
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const res = await request('/fingerprints/' + GAME_MC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprints: chunk.map(it => it.fp) })
      });
      if (!res.ok) return { ok: false, reason: res.reason, matches: map, failed: list.length - i };
      const d = (res.data && res.data.data) || {};
      const exact = d.exactMatches || [];
      exact.forEach(m => {
        const f = (m && m.file) || {};
        let fp = m && m.fingerprint != null ? Number(m.fingerprint) : null;
        if (fp == null && f.hashes && f.hashes.sha1) fp = bySha[String(f.hashes.sha1).toLowerCase()] || null;
        if (fp == null) fp = byName[String(f.fileName || '').toLowerCase() + '|' + (f.fileLength || 0)] || null;
        // 一次只查一个时，结果必然对应它
        if (fp == null && chunk.length === 1) fp = chunk[0].fp;
        if (fp == null) { failed++; return; }
        map[fp] = { projectID: m.id, fileID: f.id, fileName: f.fileName || '' };
      });
      failed += Math.max(0, chunk.length - exact.length);
    }
    return { ok: true, matches: map, failed };
  }

  /* 批量拿项目详情：用来判断 allowModDistribution（作者是否禁止第三方分发） */
  async function modsInfo(ids) {
    const out = {};
    const uniq = [];
    const seen = {};
    (ids || []).forEach(id => {
      if (!id || seen[id]) return;
      seen[id] = 1;
      uniq.push(id);
    });
    for (let i = 0; i < uniq.length; i += 50) {
      const part = uniq.slice(i, i + 50);
      const qs = part.map(id => 'modIds=' + encodeURIComponent(id)).join('&');
      const res = await request('/mods?' + qs);
      if (!res.ok) return { ok: false, reason: res.reason, mods: out };
      ((res.data && res.data.data) || []).forEach(m => { out[m.id] = m; });
    }
    return { ok: true, mods: out };
  }

  MC.api = MC.api || {};
  MC.api.curseforge = { key, hasKey, setKey, test, lookup, modsInfo, request };
})(globalThis);
