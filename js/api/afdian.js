/* ===== 爱发电：我发电过的作者 + 他们的发电帖（由 server.js 抓取并缓存） =====
   详情页按模组名/中文名匹配作者主页和发电帖，匹配不到就不显示。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  const STOP = new Set([
    'minecraft', 'mc', 'mod', 'mods', 'api', 'core', 'lib', 'library', 'config',
    'patch', 'compat', 'compatibility', 'resourcepack', 'resourcepacks', 'shader', 'shaders', 'pack', 'packs',
    '我的世界', '材质包', '资源包', '模组', '整合包', '存档', '地图', '建筑', '家具',
    '教程', '下载', '更新', '动态', '内容', '说明', '购买', '发电', '赞助', '汉化', '移植',
    '兼容', '补丁', '光影', '服务器', '基础版', '体验版', '公开版', '赞助版', '发电版'
  ]);

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
  }

  /** 能用来匹配的名字：去符号后，中文 ≥2 字或英文 ≥4 字，且不是泛词 */
  function useful(s) {
    const n = norm(s);
    if (!n || STOP.has(n)) return '';
    const cjk = (n.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (cjk >= 2) return n;
    if (cjk === 0 && n.length >= 4) return n;
    return '';
  }

  /** 作者名本身够不够独特（中文 ≥2 字或英文 ≥4 字），防止「灵」「xk」这种太短的乱配 */
  function strong(s) {
    if (!s) return false;
    const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
    return cjk >= 2 || (cjk === 0 && s.length >= 4);
  }

  function S() { return MC.store.state; }

  async function json(url, opts) {
    const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    const data = await res.json();
    if (!res.ok || (data && data.ok === false)) throw new Error((data && data.reason) || ('HTTP ' + res.status));
    return data;
  }

  async function boot() {
    const st = S();
    try {
      const d = await json('/api/afdian');
      st.afdian = {
        ready: true, at: d.updatedAt || 0, count: d.count || 0,
        creators: d.creators || [], busy: false, note: '', error: '', job: null
      };
    } catch (err) {
      st.afdian = { ready: false, at: 0, count: 0, creators: [], busy: false, note: '', error: '本地服务没启动，爱发电链接暂时读不到', job: null };
    }
    MC.store.touch();
    return st.afdian;
  }

  /** 重新抓取（服务端后台跑），轮询到结束再刷新列表 */
  async function refresh() {
    const st = S();
    const d = await json('/api/afdian/refresh', { method: 'POST' });
    if (!d.started) throw new Error('已经在更新了，稍等一下');
    st.afdian.busy = true;
    st.afdian.error = '';
    MC.store.touch();
    for (let i = 0; i < 600; i++) {
      await new Promise(r => setTimeout(r, 1200));
      let job;
      try { job = await json('/api/afdian/status'); } catch (err) { break; }
      st.afdian.job = job;
      st.afdian.note = job.note || '';
      MC.store.touch();
      if (!job.running) {
        if (job.error) { st.afdian.error = job.error; st.afdian.busy = false; MC.store.touch(); throw new Error(job.error); }
        break;
      }
    }
    st.afdian.busy = false;
    await boot();
    return st.afdian;
  }

  /** 一个本地模组/资源包能对上的爱发电作者和帖子 */
  function find(entry, limit) {
    const st = S();
    const data = st.afdian;
    if (!data || !data.creators || !data.creators.length || !entry) return [];
    const keys = [entry.nameZh, entry.name, entry.id, ...(entry.authors || [])]
      .map(useful).filter(Boolean);
    if (!keys.length) return [];
    const idKey = useful(entry.id);

    const out = [];
    data.creators.forEach(c => {
      let score = 0;
      let post = null;
      const cname = norm(c.name);
      const cslug = norm(c.slug);
      const cdoing = norm(c.doing);

      if (idKey && (cname === idKey || cslug === idKey)) score = Math.max(score, 85);
      keys.forEach(k => {
        // 同名，或「天鹅小镇」vs「天鹅小镇系列」这种一边包含另一边
        if (cname === k || cslug === k) score = Math.max(score, 88);
        else if (strong(cname) && cname.length >= 2 && k.length >= 2 &&
          (cname.indexOf(k) >= 0 || k.indexOf(cname) >= 0)) score = Math.max(score, 80);
        if (cdoing && cdoing.indexOf(k) >= 0) score = Math.max(score, 65);
      });

      // 只认帖子标题，正文摘要容易误伤（比如别的帖子顺口提了一句）
      (c.posts || []).forEach(p => {
        const title = norm(p.title);
        keys.forEach(k => {
          if (title && title.indexOf(k) >= 0) {
            const s = 90 + Math.min(k.length, 20) / 100;
            if (s > score) { score = s; post = p; }
          }
        });
      });

      if (score > 0) out.push({ creator: c, post, score });
    });

    return out.sort((a, b) => b.score - a.score).slice(0, limit || 3);
  }

  MC.afdian = { boot, refresh, find };
})(globalThis);
