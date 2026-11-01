/* ===== 爱发电公开映射表 =====
   这里存「模组 → 作者爱发电主页」，随仓库分发，谁打开都能用，不依赖你自己的爱发电账号。
   想补一条就往下面加一行（id 用 modId 或中文名都行，查的时候会自动归一化）：
     'parchwing': { name: 'parchwing', home: 'https://afdian.com/a/parchwing' },
   优先级：jar 里自带的链接 > 这张表 > 你自己账号的发电记录。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  const MAP = {
    // 例：'gardenersdream': { name: '作者名', home: 'https://afdian.com/a/xxx' },
  };

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
  }

  function isAfdian(url) {
    return /afdian\.(net|com)[/?#]/i.test(String(url || ''));
  }

  /** 按 modId / 别名 / 中文名 / 英文名 / 作者名匹配；命中返回 { name, home } */
  function find(entry) {
    if (!entry) return null;
    const keys = [
      entry.id, entry.nameZh, entry.name,
      ...(entry.allIds || []), ...(entry.authors || [])
    ].map(norm).filter(Boolean);
    if (!keys.length) return null;
    for (const k of Object.keys(MAP)) {
      const hit = MAP[k];
      if (!hit || !hit.home) continue;
      if (keys.indexOf(norm(k)) >= 0) return hit;
      if (hit.name && keys.indexOf(norm(hit.name)) >= 0) return hit;
    }
    return null;
  }

  /* 后端（MySQL）里的共用表：键和本地表同一种写法，读回来直接并进 MAP */
  let remote = {};

  async function load() {
    try {
      const r = await fetch('/api/afdian-map', { cache: 'no-store' });
      const j = await r.json();
      if (j && j.ok && j.map) {
        remote = j.map;
        Object.keys(remote).forEach(k => {
          if (!MAP[k]) MAP[k] = remote[k];
        });
      }
    } catch (err) { /* 静态打开、没起服务时忽略 */ }
    return remote;
  }

  async function save(items) {
    const r = await fetch('/api/afdian-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items || [] })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j.ok) throw new Error(j.reason || '写入失败');
    await load();
    return j;
  }

  MC.afdianMap = { find, isAfdian, MAP, load, save, norm };
})(globalThis);
