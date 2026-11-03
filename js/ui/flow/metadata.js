/* ===== 流程：项目资料预取、分类、中文名、资源包分析、翻译 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();
  const FC = MC.flowCommon;

  /* ---------- 批量预取 Modrinth 项目资料 ---------- */
  async function prefetchProjects() {
    const st = S();
    if (!st.mods.length) return;
    const my = FC.getGen();
    const hashes = Array.from(new Set(st.mods.filter(e => e.sha1).map(e => e.sha1)));
    if (!hashes.length) return;
    st.prefetching = true;
    touch();
    try {
      // 一次请求：所有 jar / 资源包的哈希 → 所属项目 id（包括未在 Modrinth 上的会缺席）
      const map = await MC.api.modrinth.versionFiles(hashes);
      if (my !== FC.getGen()) return;
      const pidByHash = {};
      const pids = [];
      Object.keys(map || {}).forEach(h => {
        const v = map[h];
        const pid = v && v.project_id;
        if (!pid) return;
        pidByHash[h] = pid;
        if (pids.indexOf(pid) < 0) pids.push(pid);
      });
      const old = st.hashProject || {};
      st.hashProject = Object.assign({}, old, pidByHash);
      if (pids.length) {
        // 再按项目 id 批量拿标题、简介、正文（资源包顺序说明就在正文里）
        const list = await MC.api.modrinth.projectsByIds(pids);
        if (my !== FC.getGen()) return;
        const next = Object.assign({}, st.projects || {});
        list.forEach(p => { next[p.id] = p; });
        st.projects = next;
      }
    } catch (err) {
      /* 预取失败不影响本地整理，详情页打开时还会再试一次 */
    } finally {
      if (my === FC.getGen()) {
        st.prefetching = false;
        analyzePacks(st);
        applyCats(st);
        touch();
      }
    }
  }

  /* ---------- 轻量预取：只补项目元信息（图标 / 标题 / 链接），不拉正文 ---------- */
  const LITE_KEY = 'modpilot.prefetchLite';

  function liteOn() {
    try { return localStorage.getItem(LITE_KEY) === '1'; } catch (err) { return false; }
  }

  function setLite(on) {
    try { localStorage.setItem(LITE_KEY, on ? '1' : '0'); } catch (err) { /* ignore */ }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function prefetchLite() {
    if (!liteOn()) return;
    const st = S();
    const my = FC.getGen();
    if (!st.mods || !st.mods.length) return;

    const seen = {};
    const targets = (st.mods || []).filter(e => {
      if (!e || !e.fileName || !/\.jar$/i.test(e.fileName)) return false;
      if (e.sha1 && (st.hashProject || {})[e.sha1]) return false;   // 哈希已认出的不用补
      const key = String(e.id || '').toLowerCase();
      if (!key || seen[key]) return false;
      seen[key] = 1;
      if ((st.modProject || {})[key]) return false;                  // 上次已经补过
      return true;
    });
    if (!targets.length) return;

    for (const e of targets) {
      if (my !== FC.getGen()) return;   // 换了一批文件就停下
      try {
        const p = await MC.updates.findProject(e);
        if (p && p.id) {
          st.projects = Object.assign({}, st.projects || {}, { [p.id]: {
            id: p.id, slug: p.slug, title: p.title, project_type: p.project_type,
            icon_url: p.icon_url, downloads: p.downloads, followers: p.followers, updated: p.updated
          } });
          st.modProject = Object.assign({}, st.modProject || {}, { [String(e.id).toLowerCase()]: p.id });
          touch();
        }
      } catch (err) { /* 失败就跳过，打开详情时还会再试 */ }
      await sleep(320);
    }
  }

  /* ---------- 分类库：Modrinth 官方分类优先，本地 MySQL 兜底 ---------- */
  async function applyCats(st) {
    if (!st.analysis) return;
    if (!st.catsTried) {
      st.catsTried = true;
      try {
        const data = await fetch('/api/mod-cats').then(r => r.json());
        st.catsDb = (data && data.ok && data.cats) || {};
      } catch (err) {
        st.catsDb = {};   // 本地服务没开：只用 Modrinth + 关键词
      }
    }

    const push = [];
    const seen = {};
    const fill = (e, g) => {
      if (!e || !e.id) return;
      const id = String(e.id).toLowerCase();
      if (seen[id]) return;
      seen[id] = true;
      const saved = (st.catsDb || {})[id];
      const savedCats = saved && saved.cats ? String(saved.cats).split(',').filter(Boolean) : [];
      // 后台手动设过主分类就听人的，不再让 Modrinth 结果把它盖回去
      const manual = saved && saved.source === 'manual' ? String(saved.primary || '') : '';
      const fromMr = MC.catalog.fromProject(FC.projectForEntry(st, e, g));
      if (fromMr) {
        e.cats = fromMr.cats;
        e.primary = manual || fromMr.primary;
        if (!manual) push.push({ id, cats: fromMr.cats.join(','), primary: fromMr.primary, source: 'modrinth' });
        return;
      }
      if (savedCats.length) e.cats = savedCats;
      if (manual || (saved && saved.primary)) e.primary = manual || String(saved.primary);
    };
    (st.analysis.groups || []).forEach(g => (g.rows || []).forEach(r => fill(r.entry, g)));
    (st.analysis.others || []).forEach(o => fill(o, null));
    if (!push.length) return;

    // 写进 MySQL，下次没网/不在 Modrinth 上的也能用同一套分类
    fetch('/api/mod-cats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: push })
    }).catch(() => { /* 本地服务没开就算了 */ });
    touch();
  }

  /* ---------- 中文名库：读取后后台补齐，不挡任何操作 ---------- */
  let zhGen = 0;

  async function prefetchZhNames() {
    const st = S();
    if (!st.analysis || !MC.zhNames) return;
    const my = ++zhGen;
    const wanted = [];
    const seen = {};
    (st.analysis.groups || []).forEach(g => {
      const row = FC.chosenOf(st, g);
      const e = row ? row.entry : (g.rows[0] && g.rows[0].entry);
      if (!e || e.nameZh) return;
      const id = String(e.id || '').trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      const p = FC.projectForEntry(st, e, g);
      wanted.push({
        id,
        title: String(e.name || (p && p.title) || ''),
        slug: String((p && p.slug) || '')
      });
    });
    if (!wanted.length) return;

    const chunk = 15;
    let cursor = 0;
    const worker = async () => {
      while (cursor < wanted.length) {
        if (my !== zhGen) return;
        const part = wanted.slice(cursor, cursor + chunk);
        cursor += chunk;
        try {
          const names = await MC.zhNames.lookup(part);
          if (my !== zhGen) return;
          // 查一批就先显示一批，不用等全部回来
          applyZhNames(st, names);
        } catch (err) {
          // 本地服务没开 / MC百科连不上：只是少了中文名，不影响整理和打包
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  /** 把查到的中文名填进所有版本行（同一个模组可能有多个 id） */
  function applyZhNames(st, byId) {
    const ids = Object.keys(byId || {});
    if (!ids.length) return;
    let hit = 0;
    const fill = e => {
      if (!e || e.nameZh) return;
      const keys = [e.id].concat(e.allIds || []).map(x => String(x || '')).filter(Boolean);
      const rec = keys.map(k => byId[k]).find(x => x && x.zh);
      if (!rec) return;
      e.nameZh = rec.zh;
      e.nameZhFrom = rec.url || '';
      if (!e.name && rec.en) e.name = rec.en;
      hit++;
    };
    (st.mods || []).forEach(fill);
    if (st.analysis) {
      (st.analysis.groups || []).forEach(g => (g.rows || []).forEach(r => fill(r.entry)));
      (st.analysis.others || []).forEach(fill);
    }
    if (hit) touch();
  }

  /** 资源包：作者建议顺序 / 同路径冲突 / 和模组是同一个项目 */
  function analyzePacks(st) {
    if (!st.analysis || !MC.packs) return;
    const others = st.analysis.others || [];
    const packs = others.filter(o => o.kind === 'resourcepack').map(o => {
      const pid = o.sha1 ? (st.hashProject || {})[o.sha1] : '';
      const project = pid ? (st.projects || {})[pid] : null;
      return {
        uid: o.uid, fileName: o.fileName, size: o.size,
        assets: o.assets || [], project, url: FC.packUrl(project),
        description: o.description || '', packFormat: o.packFormat || 0
      };
    });
    const mods = [];
    (st.analysis.groups || []).forEach(g => {
      const row = FC.chosenOf(st, g);
      if (!row) return;
      const pid = row.entry.sha1 ? (st.hashProject || {})[row.entry.sha1] : '';
      const project = pid ? (st.projects || {})[pid] : null;
      if (project) mods.push({
        uid: row.uid, id: row.entry.id, name: row.entry.name,
        version: row.entry.version, sha1: row.entry.sha1,
        ids: row.entry.allIds || [row.entry.id],
        project, groupId: g.id
      });
    });
    const advice = MC.packs.analyze(packs, mods);
    st.packAdvice = advice;
    if (advice.sorted && advice.sorted.length) st.rpOrder = advice.sorted;
  }

  /* ---------- 简介机翻：打开详情时自动翻一次 ---------- */
  async function ensureDesc(gid) {
    const st = S();
    if (!st.analysis || !gid) return;
    const g = st.analysis.groups.find(x => x.id === gid);
    if (!g) return;
    const row = FC.chosenOf(st, g);
    const e = row ? row.entry : (g.rows[0] && g.rows[0].entry);
    if (!e || !e.description) return;
    const prev = st.descTr[gid];
    if (prev && (prev.status === 'loading' || prev.status === 'ok')) return;
    st.descTr[gid] = { status: 'loading' };
    touch();
    let res;
    try {
      res = await MC.translate.zh(e.description);
    } catch (err) {
      res = { ok: false, reason: err && err.message ? err.message : String(err) };
    }
    st.descTr[gid] = res.ok
      ? { status: 'ok', text: res.text }
      : { status: 'error', reason: res.reason || '连不上翻译接口' };
    if (!res.ok && MC.uiBase) MC.uiBase.toast('机翻没成功：' + (res.reason || '连不上翻译接口'));
    touch();
  }

  /* ---------- Modrinth 正文：打开详情时补一份完整介绍 ---------- */
  async function ensureMrDesc(gid) {
    const st = S();
    if (!st.analysis || !gid || String(gid).indexOf('o:') === 0) return;
    const prev = st.mr[gid];
    if (prev && (prev.status === 'loading' || prev.status === 'ok' || prev.status === 'notfound')) return;
    const g = st.analysis.groups.find(x => x.id === gid);
    if (!g) return;
    const row = FC.chosenOf(st, g);
    const e = row ? row.entry : (g.rows[0] && g.rows[0].entry);
    if (!e) return;

    // 读取时已经批量拿回来了：直接用缓存，不再发请求
    const cached = FC.projectForEntry(st, e, g);
    if (cached && cached.body) {
      const text = FC.mdToText(cached.body);
      if (text) {
        st.mr[gid] = {
          status: 'ok',
          text: text.slice(0, 6000),
          title: cached.title || '',
          url: FC.packUrl(cached),
          downloads: cached.downloads || 0,
          follows: cached.followers || 0,
          updated: cached.updated || ''
        };
        touch();
        if ((st.bodyLang || 'zh') === 'zh') ensureBodyTr(gid);
        return;
      }
    }

    st.mr[gid] = { status: 'loading' };
    touch();
    try {
      const proj = await MC.updates.findProject(e);
      if (!proj) {
        st.mr[gid] = { status: 'notfound' };
        touch();
        return;
      }
      const full = await MC.api.modrinth.project(proj.id || proj.slug);
      const text = FC.mdToText(full && full.body);
      if (!text) {
        st.mr[gid] = { status: 'notfound' };
        touch();
        return;
      }
      /* 哈希没对上、靠 modId/名字找到的项目也存进缓存，标题图标和作者页才能用 */
      const pid = full && (full.id || full.project_id);
      if (pid) {
        st.projects = Object.assign({}, st.projects || {}, { [pid]: full });
        st.hashProject = Object.assign({}, st.hashProject || {});
        [e].concat((g.rows || []).map(r => r.entry)).forEach(r => {
          if (r && r.sha1) st.hashProject[r.sha1] = pid;
        });
      }
      st.mr[gid] = {
        status: 'ok',
        text: text.slice(0, 6000),
        title: full.title || proj.title || '',
        url: 'https://modrinth.com/mod/' + encodeURIComponent(full.slug || full.id || ''),
        downloads: full.downloads || 0,
        follows: full.followers || 0,
        updated: full.updated || ''
      };
      touch();
      if ((st.bodyLang || 'zh') === 'zh') ensureBodyTr(gid);
    } catch (err) {
      st.mr[gid] = { status: 'error', reason: (err && err.message) || '连不上 Modrinth' };
      touch();
    }
  }

  async function ensureBodyTr(gid) {
    const st = S();
    const m = st.mr[gid];
    if (!m || m.status !== 'ok' || !m.text) return;
    const prev = st.bodyTr[gid];
    if (prev && (prev.status === 'loading' || prev.status === 'ok')) return;
    st.bodyTr[gid] = { status: 'loading' };
    touch();
    let res;
    try { res = await MC.translate.zh(m.text.slice(0, 3000)); }
    catch (err) { res = { ok: false, reason: (err && err.message) || '翻译失败' }; }
    st.bodyTr[gid] = res.ok
      ? { status: 'ok', text: res.text, partial: !!res.partial }
      : { status: 'error', reason: res.reason || '连不上翻译接口' };
    if (!res.ok && MC.uiBase) MC.uiBase.toast('机翻没成功：' + (res.reason || '连不上翻译接口'));
    else if (res.partial && MC.uiBase) MC.uiBase.toast('网络不太稳，有几段没翻出来（先保留英文）');
    touch();
  }

  MC.flowMeta = {
    prefetchProjects, prefetchLite, liteOn, setLite, applyCats, prefetchZhNames, applyZhNames,
    analyzePacks, ensureDesc, ensureMrDesc, ensureBodyTr
  };
})(globalThis);
