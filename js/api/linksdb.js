/* ===== 下载页仓库：优先 MySQL（server.js 提供接口），连不上就退回浏览器本地 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const LOCAL_KEY = 'modpilot.links.v1';

  const FALLBACK_SITES = [
    { key: 'afdian', label: '爱发电' },
    { key: 'modrinth', label: 'Modrinth' },
    { key: 'curseforge', label: 'CurseForge' },
    { key: 'github', label: 'GitHub' },
    { key: 'gitee', label: 'Gitee' },
    { key: 'planetminecraft', label: 'Planet MC' },
    { key: 'cloud', label: '网盘' },
    { key: 'personal', label: '作者网站' },
    { key: 'other', label: '其他' }
  ];

  const state = {
    mode: 'local',      // db | local
    ready: false,
    error: '',
    sites: FALLBACK_SITES.slice(),
    counts: {},         // site → 条数
    dbName: 'modpilot'
  };

  function S() { return MC.store.state; }

  async function json(url, opts) {
    const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    const data = await res.json();
    if (!res.ok || (data && data.ok === false)) throw new Error((data && data.reason) || ('HTTP ' + res.status));
    return data;
  }

  /* DB 行 → 按 modId 分组，和界面上原来的结构保持一致 */
  function applyLinks(links) {
    const st = S();
    const map = {};
    (links || []).forEach(l => {
      const key = l.modId || '未归属';
      (map[key] = map[key] || []).push({
        id: l.id, url: l.url, note: l.note || '', site: l.site || 'other', at: l.at || 0
      });
    });
    st.links = map;
  }

  function flatten(links) {
    const out = [];
    Object.keys(links || {}).forEach(id => {
      (links[id] || []).forEach(l => out.push({
        modId: id === '未归属' ? '' : id,
        url: l.url,
        note: l.note || '',
        site: l.site || ''
      }));
    });
    return out;
  }

  function siteLabel(key) {
    const hit = state.sites.find(s => s.key === key);
    return hit ? hit.label : '其他';
  }

  async function refresh() {
    if (state.mode !== 'db') return false;
    const d = await json('/api/links');
    applyLinks(d.links);
    state.sites = d.sites || state.sites;
    state.counts = {};
    (d.counts || []).forEach(c => { state.counts[c.site] = c.n; });
    return true;
  }

  /** 启动时调用：连数据库、必要时把浏览器里的老链接搬过去 */
  async function boot() {
    const st = S();
    let health = null;
    try { health = await json('/api/health'); } catch (err) { health = null; }

    if (!health || !health.db) {
      state.mode = 'local';
      state.ready = true;
      state.error = (health && health.dbError) || '没连上本地服务，链接先存浏览器';
      return state.mode;
    }

    state.mode = 'db';
    state.sites = health.sites || state.sites;
    state.dbName = health.dbName || state.dbName;
    state.error = '';
    try {
      let d = await json('/api/links');
      const local = flatten(st.links);
      if (!d.links.length && local.length) {
        await json('/api/links', { method: 'POST', body: JSON.stringify({ items: local }) });
        d = await json('/api/links');
      }
      applyLinks(d.links);
      state.counts = {};
      (d.counts || []).forEach(c => { state.counts[c.site] = c.n; });
      state.ready = true;
      return state.mode;
    } catch (err) {
      state.mode = 'local';
      state.ready = true;
      state.error = err.message || '数据库读取失败，先存浏览器';
      return state.mode;
    }
  }

  /** 批量写入；items: [{modId,name,url,note}] → {saved} */
  async function add(items) {
    const st = S();
    const list = (items || []).filter(x => x && /^https?:\/\//i.test(String(x.url || '')));
    if (state.mode === 'db') {
      const d = await json('/api/links', { method: 'POST', body: JSON.stringify({ items: list }) });
      await refresh();
      MC.store.saveLinks();   // 同时留一份本地缓存，断网时也能看
      return { saved: d.saved || 0, db: true };
    }
    // 本地兜底
    let saved = 0;
    list.forEach(x => {
      const id = x.modId || '未归属';
      st.links[id] = (st.links[id] || []).concat({ url: x.url, note: x.note || '', at: Date.now() });
      saved++;
    });
    MC.store.saveLinks();
    return { saved, db: false };
  }

  async function remove(item) {
    const st = S();
    if (state.mode === 'db' && item && item.id) {
      await json('/api/links/delete', { method: 'POST', body: JSON.stringify({ id: item.id }) });
      await refresh();
    } else {
      const id = item.modId || '未归属';
      st.links[id] = (st.links[id] || []).filter(l => l.url !== item.url);
      if (!st.links[id].length) delete st.links[id];
      MC.store.saveLinks();
    }
  }

  function savedLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) { /* 忽略 */ }
    return null;
  }

  MC.linksdb = { boot, refresh, add, remove, state, siteLabel, FALLBACK_SITES, savedLocal };
})(globalThis);
