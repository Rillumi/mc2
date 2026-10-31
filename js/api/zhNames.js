/* ===== 中文名库：由本地 server.js 代理 MC百科，结果在服务端缓存 =====
   浏览器直接抓 MC百科会被跨域拦住，所以统一走 /api/zh-names（同源）。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  /** items = [{ id, title, slug }] → { 命中的 id: { zh, en, abbr, url } } */
  async function lookup(items) {
    const list = (items || []).filter(x => x && x.id);
    if (!list.length) return {};
    const res = await fetch('/api/zh-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: list })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || data.ok === false) throw new Error((data && data.reason) || '中文名库查询失败');
    return data.names || {};
  }

  MC.zhNames = { lookup };
})(globalThis);
