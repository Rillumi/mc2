/* ===== 事件层：把用户操作翻译成状态变化 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();
  const { toast, saveBlob, copyText, walkEntry, collectDrop, sha1Hex, esc } = MC.uiBase;
  let gen = 0; // 环境切换后，作废旧的在途请求
  const FT = MC.flowTools; // 日志 / 资源包顺序（js/ui/flow/tools.js）

  /* ---------- 把文件读成条目（整理页 / 对比页共用） ---------- */
  async function buildEntries(files, note) {
    const st = S();
    const out = [];
    let notMod = 0;
    const total = files.length;
    st.scan = { note: note || '正在读取', done: 0, total, name: '' };
    touch();
    // 先让进度条画出来，再开始啃 jar
    await new Promise(r => setTimeout(r, 40));
    let lastPaint = Date.now();
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        st.scan.done = i;
        st.scan.name = file.name;
        if (Date.now() - lastPaint > 90) { lastPaint = Date.now(); touch(); }
        // 每个文件之间让出一帧，进度条和文件名才动得起来
        await new Promise(r => setTimeout(r, 0));

        const entry = {
          uid: 'u' + Date.now().toString(36) + '-' + i + '-' + Math.random().toString(36).slice(2, 6),
          file, fileName: file.name, rel: file.webkitRelativePath || '',
          filePath: file.modpilotPath || file.webkitRelativePath || file.name,
          size: file.size,
          kind: 'mod',
          id: '', name: file.name.replace(/\.(jar|zip)$/i, ''), version: '',
          loader: '', loaders: [], mc: '', mcRange: '',
          allIds: [], deps: [], optionalDeps: [], recipes: 0, error: null, sha1: ''
        };
        try {
          const buf = await file.arrayBuffer();
          const res = await MC.metadata.inspect(buf);
          entry.kind = res.kind;
          if (res.info) Object.assign(entry, res.info);
          else if (res.kind === 'mod') entry.error = '没有找到模组元数据';
          else notMod++;
          if (res.kind === 'mod') {
            entry.sha1 = await sha1Hex(buf);
            // mods.toml 里写的版本常常是摆设（1.0.0），真实版本在文件名里
            entry.version = MC.metadata.resolveVersion(entry.version, file.name, entry.name);
          } else if (res.kind === 'resourcepack') {
            // 资源包也算哈希：才能认出它和哪个模组是同一个 Modrinth 项目
            entry.sha1 = await sha1Hex(buf);
          }
        } catch (err) {
          entry.error = '读不出来：' + (err && err.message ? err.message : err);
        }
        if (!entry.mc) entry.mc = MC.metadata.inferMcFromName(file.name);
        if (!entry.id) entry.id = file.name.replace(/\.(jar|zip)$/i, '').toLowerCase();
        out.push(entry);
        st.scan.done = i + 1;
      }
    } finally {
      st.scan = null;
      st.progress = '';
      touch();
    }
    return { entries: out, notMod };
  }

  /* ---------- 导入 + 解析 ---------- */
  async function importFiles(files, opts) {
    opts = opts || {};
    const st = S();
    // 一键重扫：整个替换，这样文件夹里删掉的模组也会从列表消失
    if (opts.replace) {
      st.mode = 'folder';
      st.mods = [];
      st.analysis = null;
      st.selection = {};
      st.excluded = {};
      st.deps = [];
      st.adapt = {};
      st.connector = null;
      st.detail = null;
      st.filter = 'all';
      st.rpOrder = [];
      st.rpPair = {};
      st.updates = {};
    }
    let list = Array.from(files || []).filter(f => /\.(jar|zip)$/i.test(f.name));
    if (!list.length) {
      st.scan = null;
      touch();
      return toast('没找到 .jar / .zip 文件，把 mods 文件夹拖进来就行');
    }

    // 拖进来的是文件夹 → 回到「整理整个文件夹」模式
    if (opts.fromFolder && st.mode === 'single') {
      st.mode = 'folder';
      st.mods = [];
      st.analysis = null;
      st.selection = {};
      st.excluded = {};
      st.deps = [];
      st.detail = null;
      toast('已切回文件夹模式');
    }

    const single = opts.single || st.mode === 'single';
    if (single) {
      st.mode = 'single';
      st.mods = [];
      st.analysis = null;
      st.selection = {};
      st.excluded = {};
      st.deps = [];
      st.detail = null;
      st.filter = 'all';
      if (list.length > 1) {
        toast('单模组模式只分析第一个文件');
        list = list.slice(0, 1);
      }
    }

    const seen = new Set(st.mods.map(m => m.fileName + ':' + m.size));
    const fresh = single ? list : list.filter(f => !seen.has(f.name + ':' + f.size));
    if (!fresh.length) {
      st.scan = null;
      touch();
      return toast('这些文件已经在列表里了');
    }

    const built = await buildEntries(fresh, '正在读取');
    st.mods.push(...built.entries);
    if (opts.handle && !single && MC.libraryPanel) MC.libraryPanel.save(opts.handle, st);
    MC.pager.resetAll();
    const notMod = built.notMod;
    st.progress = '';
    await analyzeAndResolve(true);
    // 读取完就把每个项目的资料（简介 / 正文 / 图标）批量拉回来，详情页不用再等网络
    prefetchProjects();
    // 顺便补上大家平时叫的中文名（MC百科），列表和搜索都能直接用
    prefetchZhNames();
    // 分类：先用本地库/Modrinth 填上，导览页不用等预取完成
    applyCats(st);

    if (notMod) {
      st.showOthers = true;
      toast('识别到 ' + notMod + ' 个资源包 / 光影，已放到「资源包与光影」里，不会进 mods');
    }
    if (single && st.analysis && st.analysis.groups.length) {
      st.detail = st.analysis.groups[0].id;
      touch();
    }
  }

  /* ---------- 分析 + 缺前置自动匹配 ---------- */
  async function analyzeAndResolve(resetDeps) {
    const st = S();
    const my = ++gen;
    const analysis = MC.analyzer.analyze(st.mods, st.env, { includeOptional: st.includeOptional });
    st.analysis = analysis;
    MC.selector.assign(st, analysis);

    if (resetDeps) {
      st.adapt = {};
      st.connector = null;
      st.deps = analysis.missing.map(m => ({
        key: m.id, id: m.id, modId: m.modId, range: m.range,
        requiredBy: m.requiredBy.slice(), searchWord: m.modId,
        status: 'idle', project: null, versions: [], version: null,
        candidates: [], showCand: false,
        added: false, via: '', reason: ''
      }));
    }
    touch();

    const pending = st.deps.filter(d => !(d.status === 'ok' && d.version));
    if (pending.length) {
      // 前置的 modId 大多就是 slug：先用一次批量项目请求全部命中，再并发补版本
      await preResolveDeps(pending);
      if (my !== gen) return;
      let cursor = 0;
      const worker = async () => {
        while (cursor < pending.length) {
          if (my !== gen) return;
          const dep = pending[cursor++];
          await matchDep(dep, null, my);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    }
    if (my !== gen) return;
    analyzePacks(st);
    touch();
  }

  /** 把一堆前置的 id / modId / 别名 / 记住的 slug 合成一次 /projects?ids= 批量请求 */
  async function preResolveDeps(deps) {
    const map = MC.resolver.loadMap();
    const keys = [];
    const lookup = dep => {
      const cached = map[dep.id] && map[dep.id].slug;
      const alias = MC.resolver.ALIASES[String(dep.id || '').toLowerCase()] ||
        MC.resolver.ALIASES[String(dep.modId || '').toLowerCase()];
      return [cached, alias, dep.id, dep.modId].filter(Boolean);
    };
    deps.forEach(dep => lookup(dep).forEach(k => {
      const low = String(k).toLowerCase();
      if (keys.indexOf(low) < 0) keys.push(low);
    }));
    if (!keys.length) return;
    let projects = [];
    try { projects = await MC.api.modrinth.projectsByIds(keys); } catch (err) { return; }
    const by = new Map();
    projects.forEach(p => {
      [p.slug, p.id].filter(Boolean).forEach(k => by.set(String(k).toLowerCase(), p));
    });
    deps.forEach(dep => {
      const hit = lookup(dep).map(k => by.get(String(k).toLowerCase())).find(Boolean);
      if (hit) dep.prematch = { id: hit.id, slug: hit.slug, title: hit.title };
    });
  }

  async function matchDep(dep, word, my) {
    const st = S();
    dep.status = 'loading';
    if (word) dep.searchWord = word;
    dep.reason = '';
    dep.showCand = false;
    touch();
    try {
      const res = await MC.resolver.resolve(dep, {
        env: st.env,
        range: dep.range,
        searchWord: word || ''
      });
      if (my && my !== gen) return;
      dep.via = res.via || '';
      dep.candidates = res.candidates || [];
      if (res.ok) {
        dep.project = res.project;
        dep.versions = res.versions;
        dep.version = res.version;
        dep.searchWord = res.searchWord || dep.searchWord;
        dep.added = true;
        dep.status = 'ok';
      } else {
        dep.project = res.project || null;
        dep.reason = res.reason || '没匹配上';
        dep.added = false;
        dep.status = 'none';
      }
    } catch (err) {
      if (my && my !== gen) return;
      dep.status = 'error';
      dep.reason = err && err.message ? err.message : String(err);
    }
    touch();
  }

  async function chooseCandidate(dep, slug) {
    const st = S();
    dep.status = 'loading';
    dep.reason = '';
    touch();
    try {
      const res = await MC.resolver.resolveSlug(slug, st.env, dep.range);
      if (res.ok) {
        dep.project = res.project;
        dep.versions = res.versions;
        dep.version = res.version;
        dep.added = true;
        dep.status = 'ok';
        dep.via = '你从候选里选的';
        dep.candidates = (dep.candidates || []).filter(c => c.slug !== slug);
        dep.candidates.unshift({
          slug,
          title: res.project.title,
          description: res.project.description || '',
          downloads: res.project.downloads || 0
        });
      } else {
        dep.status = 'none';
        dep.reason = res.reason || '这个项目用不了';
      }
    } catch (err) {
      dep.status = 'error';
      dep.reason = err && err.message ? err.message : String(err);
    }
    touch();
  }

  /* ---------- 不兼容 / 版本不够 → 找适配版本 ---------- */
  function providerGroups(st, id) {
    const target = MC.analyzer.normDep(id);
    return (st.analysis ? st.analysis.groups : []).filter(g =>
      g.usableRows.some(r => (r.entry.allIds || [r.entry.id]).some(x => MC.analyzer.normDep(x) === target)));
  }

  async function runAdapt(key, target, range) {
    const st = S();
    const my = gen;
    const ad = { key, status: 'loading', added: false, reason: '' };
    Object.assign(ad, target);
    st.adapt[key] = ad;
    touch();
    try {
      const res = await MC.resolver.resolve(
        { id: target.id, modId: target.title || target.id, searchWord: '' },
        { env: st.env, range: range || '' }
      );
      if (my !== gen || st.adapt[key] !== ad) return;
      if (res.ok) {
        ad.project = res.project;
        ad.versions = res.versions;
        ad.version = res.version;
        ad.status = 'ok';
        ad.reason = '';
      } else {
        ad.status = 'none';
        ad.reason = res.reason || '没找到适配版本';
      }
    } catch (err) {
      if (my !== gen || st.adapt[key] !== ad) return;
      ad.status = 'none';
      ad.reason = err && err.message ? err.message : String(err);
    }
    touch();
  }

  function addAdapt(ad) {
    const st = S();
    const ids = [];
    if (ad.kind === 'group' && ad.groupId) ids.push(ad.groupId);
    else if (ad.kind === 'issue') providerGroups(st, ad.id).forEach(g => ids.push(g.id));
    ad.excludedGroups = ids.map(id => ({ id, had: !!st.excluded[id] }));
    ids.forEach(id => { st.excluded[id] = true; });
    ad.added = true;
    touch();
  }

  function removeAdapt(ad) {
    if (!ad) return;
    const st = S();
    (ad.excludedGroups || []).forEach(o => { if (!o.had) delete st.excluded[o.id]; });
    ad.excludedGroups = [];
    ad.added = false;
    touch();
  }

  async function retryAll() {
    const my = gen;
    const list = S().deps.filter(d => !(d.status === 'ok' && d.version));
    if (!list.length) return toast('没有需要重试的');
    toast('重新匹配 ' + list.length + ' 个…');
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        if (my !== gen) return;
        const dep = list[cursor++];
        await matchDep(dep, null, my);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  /* ---------- 导览：检查更新 ---------- */
  function chosenOf(st, g) {
    const rows = MC.selector.sortRows(g.usableRows || [], st.env);
    return rows.find(r => r.uid === st.selection[g.id]) || rows[0] || null;
  }

  /* ---------- 批量预取 Modrinth 项目资料 ---------- */
  function packUrl(p) {
    if (!p) return '';
    return 'https://modrinth.com/' + (p.project_type === 'resourcepack' ? 'resourcepack' :
      p.project_type === 'shader' ? 'shader' : 'mod') + '/' + encodeURIComponent(p.slug || p.id);
  }

  async function prefetchProjects() {
    const st = S();
    if (!st.mods.length) return;
    const my = gen;
    const hashes = Array.from(new Set(st.mods.filter(e => e.sha1).map(e => e.sha1)));
    if (!hashes.length) return;
    st.prefetching = true;
    touch();
    try {
      // 一次请求：所有 jar / 资源包的哈希 → 所属项目 id（包括未在 Modrinth 上的会缺席）
      const map = await MC.api.modrinth.versionFiles(hashes);
      if (my !== gen) return;
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
        if (my !== gen) return;
        const next = Object.assign({}, st.projects || {});
        list.forEach(p => { next[p.id] = p; });
        st.projects = next;
      }
    } catch (err) {
      /* 预取失败不影响本地整理，详情页打开时还会再试一次 */
    } finally {
      if (my === gen) {
        st.prefetching = false;
        analyzePacks(st);
        applyCats(st);
        touch();
      }
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
      const fromMr = MC.catalog.fromProject(projectForEntry(st, e, g));
      if (fromMr) {
        e.cats = fromMr.cats;
        push.push({ id, cats: fromMr.cats.join(','), primary: fromMr.primary, source: 'modrinth' });
        return;
      }
      const saved = (st.catsDb || {})[id];
      if (saved && saved.cats) e.cats = String(saved.cats).split(',').filter(Boolean);
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
      const row = chosenOf(st, g);
      const e = row ? row.entry : (g.rows[0] && g.rows[0].entry);
      if (!e || e.nameZh) return;
      const id = String(e.id || '').trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      const p = projectForEntry(st, e, g);
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
        assets: o.assets || [], project, url: packUrl(project),
        description: o.description || '', packFormat: o.packFormat || 0
      };
    });
    const mods = [];
    (st.analysis.groups || []).forEach(g => {
      const row = chosenOf(st, g);
      if (!row) return;
      const pid = row.entry.sha1 ? (st.hashProject || {})[row.entry.sha1] : '';
      const project = pid ? (st.projects || {})[pid] : null;
      if (project) mods.push({
        uid: row.uid, id: row.entry.id, name: row.entry.name,
        version: row.entry.version, sha1: row.entry.sha1,
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
    const row = chosenOf(st, g);
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
    touch();
  }

  /* ---------- Modrinth 正文：打开详情时补一份完整介绍 ---------- */
  function mdToText(md) {
    return String(md || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_`>~|]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** 这个条目（或同组任意版本）已经预取到项目资料了吗 */
  function projectForEntry(st, e, g) {
    const byHash = h => h ? (st.projects || {})[(st.hashProject || {})[h]] : null;
    if (e && byHash(e.sha1)) return byHash(e.sha1);
    for (const r of ((g && g.rows) || [])) {
      const p = r.entry && byHash(r.entry.sha1);
      if (p) return p;
    }
    return null;
  }

  async function ensureMrDesc(gid) {
    const st = S();
    if (!st.analysis || !gid || String(gid).indexOf('o:') === 0) return;
    const prev = st.mr[gid];
    if (prev && (prev.status === 'loading' || prev.status === 'ok' || prev.status === 'notfound')) return;
    const g = st.analysis.groups.find(x => x.id === gid);
    if (!g) return;
    const row = chosenOf(st, g);
    const e = row ? row.entry : (g.rows[0] && g.rows[0].entry);
    if (!e) return;

    // 读取时已经批量拿回来了：直接用缓存，不再发请求
    const cached = projectForEntry(st, e, g);
    if (cached && cached.body) {
      const text = mdToText(cached.body);
      if (text) {
        st.mr[gid] = {
          status: 'ok',
          text: text.slice(0, 6000),
          title: cached.title || '',
          url: packUrl(cached),
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
      const text = mdToText(full && full.body);
      if (!text) {
        st.mr[gid] = { status: 'notfound' };
        touch();
        return;
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
      ? { status: 'ok', text: res.text }
      : { status: 'error', reason: res.reason || '连不上翻译接口' };
    touch();
  }

  async function checkOneUpdate(groupId) {
    const st = S();
    if (!st.analysis) return;
    const g = st.analysis.groups.find(x => x.id === groupId);
    if (!g) return;
    const row = chosenOf(st, g);
    if (!row) return;
    const my = gen;
    st.updates[groupId] = { status: 'checking' };
    touch();
    let res;
    try {
      res = await MC.updates.check(row.entry, st.env);
    } catch (err) {
      res = { status: 'error', reason: err && err.message ? err.message : String(err) };
    }
    if (my !== gen) return;
    st.updates[groupId] = res;
    if (res.status === 'error' && isNetworkError(res.reason)) {
      st.updateError = '连不上 Modrinth，可能是网络或代理问题。';
    }
    touch();
  }

  function isNetworkError(reason) {
    return /Failed to fetch|NetworkError|Load failed|ERR_|timeout|aborted/i.test(String(reason || ''));
  }

  async function checkAllUpdates() {
    const st = S();
    if (st.updateBusy) return;
    const groups = st.analysis ? st.analysis.groups.slice() : [];
    if (!groups.length) return toast('先把 mods 文件夹拖进来');
    const my = gen;
    st.updateBusy = true;
    st.updateDone = 0;
    st.updateTotal = groups.length;
    st.updateError = '';
    groups.forEach(g => { st.updates[g.id] = { status: 'checking' }; });
    touch();

    const targets = groups.map(g => ({ g, row: chosenOf(st, g) }));

    /* 一次性把能算哈希的 jar 交给 Modrinth：/version_files/update 一个请求查一堆，
       比逐个按 slug 查快得多；改名过的 jar 哈希不变，也照样能认出来。 */
    const hashed = targets.filter(t => t.row && t.row.entry.sha1);
    const noHash = targets.filter(t => t.row && !t.row.entry.sha1);
    st.updateTotal = hashed.length + noHash.length;
    const latestByHash = new Map();
    let batchError = null;
    const chunkSize = 80;
    try {
      for (let i = 0; i < hashed.length; i += chunkSize) {
        if (my !== gen) return;
        const chunk = hashed.slice(i, i + chunkSize);
        const data = await MC.api.modrinth.versionFilesUpdate(
          chunk.map(t => t.row.entry.sha1), st.env
        );
        Object.keys(data || {}).forEach(h => latestByHash.set(h, data[h]));
        st.updateDone = Math.min(i + chunkSize, hashed.length);
        touch();
      }
    } catch (err) {
      batchError = err;
    }
    if (my !== gen) return;

    let newer = 0;
    let notFound = 0;
    let skip = 0;
    for (const t of targets) {
      const gid = t.g.id;
      if (!t.row) { st.updates[gid] = { status: 'skip' }; skip++; continue; }
      // 没有哈希的留给下面按名字重查，先别判成“没收录”
      if (!t.row.entry.sha1) continue;
      const v = latestByHash.get(t.row.entry.sha1);
      if (!v) { st.updates[gid] = { status: 'notfound' }; notFound++; continue; }
      const latest = v.version_number || '';
      const cmp = t.row.entry.version ? MC.version.compare(latest, t.row.entry.version) : 1;
      const status = cmp > 0 ? 'newer' : 'current';
      st.updates[gid] = {
        status,
        latest,
        installed: t.row.entry.version || '',
        url: 'https://modrinth.com/mod/' + encodeURIComponent(v.project_id || ''),
        project: v.name || '',
        at: Date.now()
      };
      if (status === 'newer') newer++;
    }

    st.updateDone = hashed.length;

    // 没算成哈希的（非 Modrinth 文件 / 浏览器不支持 SHA-1）：只对这些少量文件按名字查一次
    const retry = noHash;
    if (retry.length) {
      let cursor = 0;
      const worker = async () => {
        while (cursor < retry.length) {
          if (my !== gen) return;
          const t = retry[cursor++];
          let res;
          try {
            res = await MC.updates.check(t.row.entry, st.env);
          } catch (err) {
            res = { status: 'error', reason: err && err.message ? err.message : String(err) };
          }
          if (my !== gen) return;
          st.updates[t.g.id] = res;
          st.updateDone++;
          touch();
        }
      };
      await Promise.all([worker(), worker()]);
    }

    if (my !== gen) return;
    st.updateBusy = false;
    st.updateDone = st.updateTotal;
    if (batchError) {
      st.updateError = isNetworkError(batchError.message)
        ? '连不上 Modrinth，可能是网络或代理问题。'
        : '批量查更新失败：' + (batchError.message || '未知错误');
    }
    touch();
    if (batchError) {
      toast('连不上 Modrinth，检查更新失败；本地整理和打包不受影响。');
      return;
    }
    toast('检查完成：' + newer + ' 个有新版本' +
      (notFound ? '，' + notFound + ' 个 Modrinth 没收录' : '') +
      (skip ? '，' + skip + ' 个没有可用版本' : '') +
      (retry.length ? '，' + retry.length + ' 个按名字查过' : ''));
  }

  function exportGuide() {
    const st = S();
    if (!st.analysis) return toast('先导入 mods 文件夹');
    const items = st.analysis.groups.map(g => {
      const row = chosenOf(st, g);
      return row ? { groupId: g.id, entry: row.entry } : null;
    }).filter(Boolean);
    const md = MC.catalog.markdown(items, { env: st.env, updates: st.updates });
    saveBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), '整合包导览.md');
    toast('已导出 整合包导览.md');
  }

  /* ---------- 对比：导入另一个包 ---------- */
  /** 拖进来的是整合包 .zip：把里面 mods/*.jar 解出来一起对比 */
  async function expandModpack(files) {
    const st = S();
    const out = [];
    for (const file of files) {
      if (!/\.zip$/i.test(file.name)) continue;
      let z;
      try { z = MC.zip.parseCentral(await file.arrayBuffer()); } catch (err) { continue; }
      const jarNames = [];
      z.map.forEach((_, n) => { if (/^mods\/[^/]+\.jar$/i.test(n)) jarNames.push(n); });

      if (!jarNames.length) {
        // .mrpack 本身不含 jar，只有 modrinth.index.json 清单
        if (z.map.has('modrinth.index.json')) {
          try {
            const idx = JSON.parse(await MC.zip.readEntry(z, 'modrinth.index.json') || '{}');
            (idx.files || []).forEach(f => {
              const path = String(f.path || '');
              if (!/^mods\//i.test(path)) return;
              const name = path.split('/').pop();
              out.push(newDiffEntry(name, path, 0, out.length));
            });
          } catch (err) { /* 清单坏了就跳过 */ }
          continue;
        }
        // CurseForge 整合包：manifest.json + modlist.html，名字只能从 modlist 里读
        if (z.map.has('modlist.html')) {
          try {
            const html = await MC.zip.readEntry(z, 'modlist.html') || '';
            const re = /<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
            let m;
            while ((m = re.exec(html))) {
              const name = m[2].replace(/\s*\(by[^)]*\)\s*$/i, '').trim();
              if (!name) continue;
              const pid = (m[1].match(/\/projects\/(\d+)/) || [])[1] || '';
              const entry = newDiffEntry(name.replace(/\s+/g, '_') + '.jar', 'mods/' + name, 0, out.length);
              entry.name = name;
              entry.id = pid ? 'cf' + pid : name.toLowerCase();
              out.push(entry);
            }
          } catch (err) { /* modlist 坏了就跳过 */ }
          continue;
        }
        continue;
      }

      st.scan = { note: '正在解开整合包', done: 0, total: jarNames.length, name: file.name };
      touch();
      for (let i = 0; i < jarNames.length; i++) {
        const name = jarNames[i];
        st.scan.done = i;
        st.scan.name = name;
        if (i % 10 === 0) { touch(); await new Promise(r => setTimeout(r, 0)); }
        try {
          const bytes = await MC.zip.readEntryBytes(z, name);
          if (!bytes) continue;
          const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          const res = await MC.metadata.inspect(buf);
          const fileName = name.split('/').pop();
          const entry = newDiffEntry(fileName, name, bytes.length, out.length);
          if (res.info) Object.assign(entry, res.info);
          if (entry.kind === 'mod') {
            entry.version = MC.metadata.resolveVersion(entry.version, fileName, entry.name);
          }
          out.push(entry);
        } catch (err) { /* 单个 jar 坏了不影响其他 */ }
        st.scan.done = i + 1;
      }
      st.scan = null;
      touch();
    }
    return out;
  }

  function newDiffEntry(fileName, rel, size, i) {
    return {
      uid: 'x' + Date.now().toString(36) + '-' + i + '-' + Math.random().toString(36).slice(2, 5),
      file: null, fileName, rel, size, kind: 'mod',
      id: '', name: fileName.replace(/\.(jar|zip)$/i, ''), version: '',
      loader: '', loaders: [], mc: '', mcRange: '',
      allIds: [], deps: [], optionalDeps: [], recipes: 0, error: null, sha1: ''
    };
  }

  async function importDiff(files) {
    const st = S();
    const list = Array.from(files || []).filter(f => /\.(jar|zip)$/i.test(f.name));
    if (!list.length) {
      st.scan = null;
      touch();
      return toast('没找到 .jar / .zip 文件');
    }
    const built = await buildEntries(list, '正在读取另一个包');
    const nested = await expandModpack(list);
    st.progress = '';
    st.diff = {
      mods: built.entries.filter(e => (e.kind || 'mod') === 'mod').concat(nested.filter(e => (e.kind || 'mod') === 'mod')),
      others: built.entries.filter(e => e.kind === 'resourcepack' || e.kind === 'shader'),
      at: Date.now()
    };
    st.scan = null;
    st.diffFilter = 'diff';
    MC.pager.reset('diff');
    MC.pager.reset('diffpacks');
    touch();
    const packs = st.diff.others.length;
    if (!st.diff.mods.length && !packs) {
      return toast('这个压缩包里没找到模组；整合包需要把 mods 文件夹一起打进去');
    }
    toast('已导入另一个包：' + st.diff.mods.length + ' 个模组' +
      (packs ? ' / ' + packs + ' 个资源包、光影' : '') +
      (nested.length ? '（其中 ' + nested.length + ' 个从整合包内解出）' : ''));
  }

  /* ---------- 打包 ---------- */
  async function buildPack(format) {
    const st = S();
    if (st.busy) return;
    if (!st.analysis) return toast('先拖入模组文件夹');
    st.busy = true;
    st.progress = '正在读取本地 jar…';
    touch();
    try {
      const picked = MC.selector.selectedRows(st, st.analysis);
      const localJars = [];
      for (const row of picked) {
        if (!row.entry.file) continue;
        localJars.push({
          name: row.entry.fileName,
          data: new Uint8Array(await row.entry.file.arrayBuffer())
        });
      }
      const adapted = Object.keys(st.adapt || {}).map(k => st.adapt[k])
        .filter(x => x.added && x.status === 'ok' && x.version && x.project);
      const deps = st.deps.filter(d => d.added && d.status === 'ok' && d.version && d.project).concat(adapted);

      const extras = [];
      if (st.includePacks) {
        for (const o of (st.analysis.others || [])) {
          if (!o.file || (o.kind !== 'resourcepack' && o.kind !== 'shader')) continue;
          extras.push({ kind: o.kind, name: o.fileName, data: new Uint8Array(await o.file.arrayBuffer()) });
        }
      }

      let result;
      if (format === 'mrpack') {
        st.progress = '正在生成 .mrpack…';
        touch();
        result = await MC.pack.buildMrpack({ env: st.env, localJars, deps, extras });
      } else {
        result = await MC.pack.buildPlainZip({
          env: st.env, localJars, deps, extras,
          onProgress: text => { st.progress = text; touch(); }
        });
      }
      saveBlob(result.blob, result.filename);
      toast('已生成 ' + result.filename);
    } catch (err) {
      console.error(err);
      toast('打包失败：' + (err && err.message ? err.message : err));
    } finally {
      st.busy = false;
      st.progress = '';
      touch();
    }
  }

  /* ---------- 环境输入 ---------- */
  function syncEnvInputs() {
    const st = S();
    document.querySelectorAll('#segLoader button').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.loader === st.env.loader));
    });
  }

  /* ---------- 环境下拉：版本列表 ---------- */
  async function loadMcList() {
    const st = S();
    st.verLoading = true;
    touch();
    try {
      const list = await MC.versions.mcVersions();
      const cur = st.env.mc;
      st.mcList = list.indexOf(cur) >= 0 ? list : [cur].concat(list);
    } catch (err) {
      st.mcList = [st.env.mc];
    } finally {
      st.verLoading = false;
      touch();
    }
  }

  async function loadLoaderList() {
    const st = S();
    st.verLoading = true;
    touch();
    try {
      const list = await MC.versions.loaderVersions(st.env.loader, st.env.mc);
      const cur = st.env.loaderVersion;
      st.loaderList = (cur && list.indexOf(cur) < 0) ? [cur].concat(list) : list;
    } catch (err) {
      st.loaderList = [];
    } finally {
      st.verLoading = false;
      touch();
    }
  }

  /* ---------- 爱发电：更新我发电过的作者名单 ---------- */
  async function refreshAfdian() {
    const st = S();
    if (st.afdian && st.afdian.busy) return;
    try {
      await MC.afdian.refresh();
      toast('爱发电名单已更新');
    } catch (err) {
      toast('爱发电更新失败：' + (err.message || err));
    }
    touch();
  }

  /* ---------- 下载页仓库：MySQL / 本地兜底 ---------- */
  function syncDbState() {
    const d = MC.linksdb.state;
    S().db = {
      mode: d.mode, ready: d.ready, error: d.error,
      sites: d.sites || [], counts: d.counts || {}, dbName: d.dbName || 'modpilot'
    };
    touch();
  }

  async function addLink(modId, modName, url, note) {
    try {
      const r = await MC.linksdb.add([{ modId, modName, url, note }]);
      syncDbState();
      toast(r.db ? '已存进 MySQL，换浏览器也还在' : '已存浏览器（数据库没连上）');
    } catch (err) {
      const st = S();
      const id = modId || '未归属';
      st.links[id] = (st.links[id] || []).concat({ url, note, at: Date.now() });
      MC.store.saveLinks();
      touch();
      toast('数据库写入失败，先存浏览器：' + (err.message || ''));
    }
  }

  async function removeLink(item) {
    try {
      await MC.linksdb.remove(item);
      syncDbState();
    } catch (err) {
      toast('删除失败：' + (err.message || ''));
    }
  }

  async function bulkLinks(ta) {
    const st = S();
    const lines = String(ta.value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (!lines.length) return toast('先把要存的链接贴进来');

    const known = [];
    if (st.analysis) {
      st.analysis.groups.forEach(g => {
        const row = chosenOf(st, g);
        if (!row) return;
        const e = row.entry;
        [e.id, e.name, e.nameZh].forEach(x => {
          if (x) known.push({ key: String(x).toLowerCase(), id: e.id || g.displayId, name: e.nameZh || e.name || '' });
        });
      });
    }

    const items = [];
    let bad = 0;
    lines.forEach(line => {
      const parts = line.split('|').map(x => x.trim());
      let key = '';
      let url = '';
      let note = '';
      if (parts.length >= 3) { key = parts[0]; url = parts[1]; note = parts.slice(2).join(' | '); }
      else if (parts.length === 2) { url = parts[0]; note = parts[1]; }
      else { url = parts[0]; }
      if (!/^https?:\/\//i.test(url)) { bad++; return; }
      let modId = '';
      let modName = '';
      if (key) {
        const hit = known.find(k => k.key === key.toLowerCase());
        if (hit) { modId = hit.id; modName = hit.name; }
      }
      items.push({ modId, modName, url, note });
    });

    if (!items.length) return toast('没有能存的链接（链接格式不对）');
    try {
      const r = await MC.linksdb.add(items);
      syncDbState();
      ta.value = '';
      toast('批量导入：存了 ' + r.saved + ' 条' + (bad ? '，跳过 ' + bad + ' 条（链接格式不对）' : '') +
        (r.db ? '' : '（数据库没连上，先存浏览器）'));
    } catch (err) {
      toast('批量写入失败：' + (err.message || ''));
    }
  }

  /* ---------- Fabric 转接：找当前环境下能用的 Sinytra Connector ---------- */
  async function findConnector() {
    const st = S();
    if (st.connector && st.connector.status === 'loading') return;
    st.connector = { status: 'loading', mc: st.env.mc, loader: st.env.loader };
    touch();
    try {
      const [conn, ffapi] = await Promise.all([
        MC.api.modrinth.project('sinytra-connector'),
        MC.api.modrinth.project('forgified-fabric-api')
      ]);
      const env = { loader: st.env.loader, mc: st.env.mc };
      const [cv, fv] = await Promise.all([
        conn ? MC.api.modrinth.versions(conn.id, env) : [],
        ffapi ? MC.api.modrinth.versions(ffapi.id, env) : []
      ]);
      const c = MC.api.modrinth.pickVersion(cv);
      const f = MC.api.modrinth.pickVersion(fv);
      const items = [];
      if (c) {
        items.push({
          name: 'Sinytra Connector', version: c.version_number,
          url: (c.files && c.files[0] && c.files[0].url) || '',
          page: 'https://modrinth.com/mod/sinytra-connector/version/' + c.id
        });
      }
      if (f) {
        items.push({
          name: 'Forgified Fabric API', version: f.version_number,
          url: (f.files && f.files[0] && f.files[0].url) || '',
          page: 'https://modrinth.com/mod/forgified-fabric-api/version/' + f.id
        });
      }
      st.connector = { status: items.length ? 'ok' : 'none', mc: st.env.mc, loader: st.env.loader, items };
    } catch (err) {
      st.connector = { status: 'error', reason: (err && err.message) || '连不上 Modrinth' };
    }
    touch();
  }

  /* ---------- 动作分发 ---------- */
  function findDep(key) {
    return S().deps.find(d => d.key === key);
  }

  function toggleExclude(groupId) {
    const st = S();
    if (st.excluded[groupId]) delete st.excluded[groupId];
    else st.excluded[groupId] = true;
    touch();
  }

  /* ---------- 分页 ---------- */
  function pagerGo(wrap, page) {
    if (!wrap) return;
    const st = S();
    const key = wrap.dataset.pgkey;
    const pages = Math.max(1, Number(wrap.dataset.pgpages) || 1);
    const cur = Number(wrap.dataset.pgpage) || 1;
    let p = Math.floor(Number(page) || 1);
    if (p < 1) p = 1;
    if (p > pages) p = pages;
    if (p === cur) return;
    if (!st.pg) st.pg = {};
    st.pg[key] = p;
    const anchor = wrap.dataset.pganchor;
    touch();
    const target = anchor ? document.querySelector(anchor) : null;
    if (target) {
      const y = target.getBoundingClientRect().top + window.pageYOffset - 14;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
  }

  function pagerFromEl(el) {
    const wrap = el.closest('.pager');
    if (!wrap) return;
    const cur = Number(wrap.dataset.pgpage) || 1;
    const to = el.dataset.pg;
    pagerGo(wrap, to === 'prev' ? cur - 1 : to === 'next' ? cur + 1 : Number(to));
  }

  /* 动作模块（js/ui/actions/）和绑定层（bind.js）加载时从这里取用内部函数 */
  MC.actionCtx = {
    S, touch, toast, copyText,
    getGen: () => gen,
    bumpGen: () => { gen++; },
    findDep, toggleExclude, pagerGo, pagerFromEl,
    autoLog: FT.autoLog, analyzeAndResolve, loadLoaderList, loadMcList, syncEnvInputs,
    checkAllUpdates, checkOneUpdate, exportGuide, findConnector,
    refreshAfdian, addLink, removeLink, bulkLinks,
    movePack: FT.movePack, exportPackOrder: FT.exportPackOrder, exportPackOptions: FT.exportPackOptions, buildPack,
    chosenOf, projectForEntry, applyZhNames,
    ensureDesc, ensureMrDesc, ensureBodyTr,
    matchDep, chooseCandidate, runAdapt, addAdapt, removeAdapt, retryAll,
    handleAct, importFiles, importDiff, importLogs: FT.importLogs, syncDbState
  };

  /* ---------- 动作分发：具体实现见 js/ui/actions/ ---------- */
  function handleAct(act, el) {
    const fn = MC.actions && MC.actions[act];
    if (!fn) return false;
    fn(el, S());
    return true;
  }

  MC.ui = { importFiles, analyzeAndResolve, buildPack, toast, saveBlob, syncEnvInputs };
})(globalThis);
