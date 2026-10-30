/* ===== 游戏版本 / 加载器版本列表：走本地服务代理，拿不到就用内置列表 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  const MC_FALLBACK = ['1.21.4', '1.21.3', '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.2', '1.20.1', '1.20',
    '1.19.4', '1.19.2', '1.18.2', '1.17.1', '1.16.5', '1.15.2', '1.14.4', '1.12.2', '1.12.1', '1.11.2', '1.10.2', '1.8.9', '1.7.10'];

  const LOADER_FALLBACK = {
    forge: {
      '1.20.1': ['47.4.0', '47.3.0', '47.2.0', '47.1.3', '47.1.0'],
      '1.19.2': ['43.4.12', '43.3.0', '43.2.0'],
      '1.18.2': ['40.2.21', '40.2.0', '40.1.0'],
      '1.16.5': ['36.2.39', '36.2.34', '36.2.20'],
      '1.12.2': ['14.23.5.2860', '14.23.5.2859']
    },
    fabric: {},
    neoforge: {}
  };
  const FABRIC_FALLBACK = ['0.16.10', '0.16.9', '0.16.5', '0.15.11', '0.15.7', '0.14.24'];

  const cache = new Map();

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function mcVersions() {
    if (cache.has('mc')) return cache.get('mc');
    try {
      const d = await getJson('/api/mc-versions');
      if (d && d.ok && d.list && d.list.length) {
        cache.set('mc', d.list);
        return d.list;
      }
    } catch (err) { /* 用内置 */ }
    cache.set('mc', MC_FALLBACK);
    return MC_FALLBACK;
  }

  async function loaderVersions(loader, mc) {
    const l = String(loader || 'forge').toLowerCase();
    const key = l + ':' + mc;
    if (cache.has(key)) return cache.get(key);
    try {
      const d = await getJson('/api/loader-versions?loader=' + encodeURIComponent(l) + '&mc=' + encodeURIComponent(mc));
      if (d && d.ok && Array.isArray(d.list) && d.list.length) {
        cache.set(key, d.list);
        return d.list;
      }
    } catch (err) { /* 用内置 */ }
    const list = l === 'fabric' ? FABRIC_FALLBACK : ((LOADER_FALLBACK[l] || {})[mc] || []);
    cache.set(key, list);
    return list;
  }

  MC.versions = { mcVersions, loaderVersions, MC_FALLBACK, FABRIC_FALLBACK, LOADER_FALLBACK };
})(globalThis);
