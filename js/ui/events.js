/* ===== 事件层：把用户操作翻译成状态变化 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();
  let gen = 0; // 环境切换后，作废旧的在途请求

  /* ---------- 小工具 ---------- */
  let toastTimer = null;
  function toast(text) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---------- 拖入文件夹 ---------- */
  function walkEntry(entry, out) {
    return new Promise(resolve => {
      if (!entry) return resolve();
      if (entry.isFile) {
        entry.file(f => { out.push(f); resolve(); }, () => resolve());
        return;
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        const next = () => reader.readEntries(async batch => {
          if (!batch.length) return resolve();
          for (const e of batch) await walkEntry(e, out);
          next();
        }, () => resolve());
        next();
        return;
      }
      resolve();
    });
  }

  async function collectDrop(dt) {
    if (!dt) return { files: [], fromFolder: false };
    const entries = [];
    let fromFolder = false;
    if (dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) {
      for (const item of dt.items) {
        const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
        if (entry) {
          if (entry.isDirectory) fromFolder = true;
          entries.push(entry);
        }
      }
    }
    if (entries.length) {
      const out = [];
      for (const e of entries) await walkEntry(e, out);
      if (out.length) return { files: out, fromFolder };
    }
    return { files: Array.from(dt.files || []), fromFolder };
  }

  /* ---------- 把文件读成条目（整理页 / 对比页共用） ---------- */
  async function buildEntries(files, note) {
    const out = [];
    let notMod = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      MC.store.state.progress = (note || '正在读取') + ' ' + (i + 1) + '/' + files.length + '：' + file.name;
      touch();
      const entry = {
        uid: 'u' + Date.now().toString(36) + '-' + i + '-' + Math.random().toString(36).slice(2, 6),
        file, fileName: file.name, size: file.size,
        kind: 'mod',
        id: '', name: file.name.replace(/\.(jar|zip)$/i, ''), version: '',
        loader: '', loaders: [], mc: '', mcRange: '',
        allIds: [], deps: [], optionalDeps: [], recipes: 0, error: null
      };
      try {
        const buf = await file.arrayBuffer();
        const res = await MC.metadata.inspect(buf);
        entry.kind = res.kind;
        if (res.info) Object.assign(entry, res.info);
        else if (res.kind === 'mod') entry.error = '没有找到模组元数据';
        else notMod++;
      } catch (err) {
        entry.error = '读不出来：' + (err && err.message ? err.message : err);
      }
      if (!entry.mc) entry.mc = MC.metadata.inferMcFromName(file.name);
      if (!entry.id) entry.id = file.name.replace(/\.(jar|zip)$/i, '').toLowerCase();
      out.push(entry);
    }
    return { entries: out, notMod };
  }

  /* ---------- 导入 + 解析 ---------- */
  async function importFiles(files, opts) {
    opts = opts || {};
    const st = S();
    let list = Array.from(files || []).filter(f => /\.(jar|zip)$/i.test(f.name));
    if (!list.length) return toast('没找到 .jar / .zip 文件，把 mods 文件夹拖进来就行');

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
    if (!fresh.length) return toast('这些文件已经在列表里了');

    const built = await buildEntries(fresh, '正在读取');
    st.mods.push(...built.entries);
    const notMod = built.notMod;
    st.progress = '';
    await analyzeAndResolve(true);

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

    for (const dep of st.deps) {
      if (my !== gen) return;
      if (dep.status === 'ok' && dep.version) continue;
      await matchDep(dep, null, my);
    }
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
    for (const dep of list) {
      if (my !== gen) return;
      await matchDep(dep, null, my);
    }
  }

  /* ---------- 导览：检查更新 ---------- */
  function chosenOf(st, g) {
    const rows = MC.selector.sortRows(g.usableRows || [], st.env);
    return rows.find(r => r.uid === st.selection[g.id]) || rows[0] || null;
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

    let cursor = 0;
    let netFails = 0;
    let aborted = false;
    const worker = async () => {
      while (cursor < groups.length && !aborted) {
        if (my !== gen) return;
        const g = groups[cursor++];
        const row = chosenOf(st, g);
        if (!row) { st.updates[g.id] = { status: 'skip' }; st.updateDone++; touch(); continue; }
        let res;
        try {
          res = await MC.updates.check(row.entry, st.env);
        } catch (err) {
          res = { status: 'error', reason: err && err.message ? err.message : String(err) };
        }
        if (my !== gen) return;
        st.updates[g.id] = res;
        st.updateDone++;
        if (res.status === 'error' && isNetworkError(res.reason)) {
          netFails++;
          if (netFails >= 3) aborted = true;
        }
        touch();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (my !== gen) return;
    st.updateBusy = false;
    if (aborted) {
      groups.forEach(g => {
        const u = st.updates[g.id];
        if (!u || u.status === 'checking') st.updates[g.id] = { status: 'error', reason: '连不上 Modrinth，已暂停检查' };
      });
      touch();
      st.updateError = '连不上 Modrinth，已暂停检查。本地整理和打包不受影响。';
      touch();
      toast('连不上 Modrinth，已暂停检查。网络恢复后再点一次；本地整理和打包不受影响。');
      return;
    }
    touch();
    const newer = groups.filter(g => st.updates[g.id] && st.updates[g.id].status === 'newer').length;
    const notFound = groups.filter(g => st.updates[g.id] && st.updates[g.id].status === 'notfound').length;
    const failed = groups.filter(g => st.updates[g.id] && st.updates[g.id].status === 'error').length;
    toast('检查完成：' + newer + ' 个有新版本' +
      (notFound ? '，' + notFound + ' 个 Modrinth 没收录' : '') +
      (failed ? '，' + failed + ' 个查询失败' : ''));
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
  async function importDiff(files) {
    const st = S();
    const list = Array.from(files || []).filter(f => /\.(jar|zip)$/i.test(f.name));
    if (!list.length) return toast('没找到 .jar / .zip 文件');
    const built = await buildEntries(list, '正在读取另一个包');
    st.progress = '';
    st.diff = {
      mods: built.entries.filter(e => (e.kind || 'mod') === 'mod'),
      others: built.entries.filter(e => e.kind === 'resourcepack' || e.kind === 'shader'),
      at: Date.now()
    };
    touch();
    const packs = st.diff.others.length;
    if (!st.diff.mods.length && !packs) return toast('这个文件夹里没有模组');
    toast('已导入另一个包：' + st.diff.mods.length + ' 个模组' + (packs ? ' / ' + packs + ' 个资源包、光影' : ''));
  }

  /* ---------- 工具：日志粗筛 ---------- */
  async function importLogs(files) {
    const st = S();
    const list = Array.from(files || []);
    if (!list.length) return;
    const names = [];
    let findings = [];
    let lines = 0;
    let errors = 0;
    for (const f of list) {
      let text = '';
      try { text = await f.text(); } catch (err) { toast('读不了 ' + f.name); continue; }
      const r = MC.logscan.scan(text, f.name);
      names.push(f.name);
      lines += r.lines;
      errors += r.errors;
      findings = findings.concat(r.findings);
      st.progress = '正在扫 ' + names.length + '/' + list.length;
      touch();
    }
    st.progress = '';
    findings.sort((a, b) => {
      const sev = { bad: 0, warn: 1 };
      return (sev[a.sev] === undefined ? 2 : sev[a.sev]) - (sev[b.sev] === undefined ? 2 : sev[b.sev]) || b.count - a.count;
    });
    st.logs = { name: names.join('、'), findings, lines, errors };
    touch();
    toast('日志扫完：' + (findings.length ? findings.length + ' 类问题' : '没匹配到已知问题'));
  }

  /* ---------- 工具：资源包顺序 ---------- */
  function movePack(uid, dir) {
    const st = S();
    const packs = MC.render.orderedPacks(st);
    const idx = packs.findIndex(p => p.uid === uid);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= packs.length) return;
    const arr = packs.map(p => p.uid);
    const tmp = arr[idx];
    arr[idx] = arr[to];
    arr[to] = tmp;
    st.rpOrder = arr;
    touch();
  }

  function exportPackOrder() {
    const st = S();
    const packs = MC.render.orderedPacks(st);
    if (!packs.length) return toast('这个包里没有资源包');
    const lines = ['# 资源包优先级（越靠上，游戏里优先级越高）', ''];
    packs.forEach((p, i) => lines.push((i + 1) + '. ' + p.fileName));
    lines.push('', '共 ' + packs.length + ' 个。把文件放进 .minecraft/resourcepacks/，再在游戏里按这个顺序调。');
    saveBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), '资源包顺序.txt');
    toast('已导出 资源包顺序.txt');
  }

  function exportPackOptions() {
    const st = S();
    const packs = MC.render.orderedPacks(st);
    if (!packs.length) return toast('这个包里没有资源包');
    const list = ['vanilla'].concat(packs.map(p => 'file/' + p.fileName));
    const line = 'resourcePacks:["' + list.join('","') + '"]';
    saveBlob(new Blob([line + '\n'], { type: 'text/plain;charset=utf-8' }), 'resourcepacks-options.txt');
    toast('已导出 options.txt 片段，贴到 .minecraft/options.txt 里');
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

  /* ---------- 工具：自动读取 .minecraft 最新日志 ---------- */
  async function autoLog() {
    const st = S();
    if (st.logBusy) return;
    st.logBusy = true;
    touch();
    try {
      const res = await fetch('/api/logs?kind=latest');
      const d = await res.json();
      if (!d.ok) { toast(d.reason || '没读到日志'); return; }
      const r = MC.logscan.scan(String(d.text || ''), d.name);
      st.logs = { name: d.name, path: d.path, at: d.at, findings: r.findings, lines: r.lines, errors: r.errors };
      touch();
      toast('已读取 ' + d.name + '：' + (r.findings.length ? r.findings.length + ' 类问题' : '没匹配到已知问题'));
    } catch (err) {
      toast('读不到日志：' + (err.message || '本地服务没开？'));
    } finally {
      st.logBusy = false;
      touch();
    }
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

  function handleAct(act, el) {
    const st = S();
    const key = el.dataset.key;
    const group = el.dataset.group;

    switch (act) {
      case 'close':
        st.detail = null;
        st.previewOpen = false;
        touch();
        return true;

      case 'tab':
        if (el.dataset.tab) {
          st.tab = el.dataset.tab;
          st.picker = null;
          touch();
          if (st.tab === 'tools' && !st.logs.name && !st.logAutoTried) {
            st.logAutoTried = true;
            autoLog();
          }
        }
        return true;

      case 'open-folder': {
        const inp = document.getElementById('fileInput');
        if (inp) inp.click();
        return true;
      }

      case 'guidecat':
        st.guideCat = el.dataset.cat || 'all';
        touch();
        return true;

      case 'checkupdates':
        checkAllUpdates();
        return true;

      case 'checkupdate':
        if (el.dataset.group) checkOneUpdate(el.dataset.group);
        return true;

      case 'guideexport':
        exportGuide();
        return true;

      case 'pick-diff': {
        const inp = document.getElementById('diffInput');
        if (inp) inp.click();
        return true;
      }

      case 'diffclear':
        st.diff = { mods: [], at: 0 };
        touch();
        return true;

      case 'diffsame':
        st.diffSameOpen = !st.diffSameOpen;
        touch();
        return true;

      case 'getconnector':
        findConnector();
        return true;

      case 'autolog':
        autoLog();
        return true;

      case 'siteset':
        st.siteFilter = el.dataset.site || 'all';
        touch();
        return true;

      case 'pick-log': {
        const inp = document.getElementById('logInput');
        if (inp) inp.click();
        return true;
      }

      case 'logclear':
        st.logs = { name: '', findings: [], lines: 0, errors: 0 };
        touch();
        return true;

      case 'rp-up':
        movePack(el.dataset.uid, -1);
        return true;

      case 'rp-down':
        movePack(el.dataset.uid, 1);
        return true;

      case 'rpexport-order':
        exportPackOrder();
        return true;

      case 'rpexport-options':
        exportPackOptions();
        return true;

      case 'detail':
        if (el.dataset.other) {
          st.detail = 'o:' + el.dataset.other;
          st.picker = null;
          touch();
        } else if (group) {
          st.detail = group;
          st.picker = null;
          touch();
          if ((st.descLang || 'zh') === 'zh') ensureDesc(group);
          ensureMrDesc(group);
        }
        return true;

      case 'desclang': {
        const lang = el.dataset.lang === 'en' ? 'en' : 'zh';
        st.descLang = lang;
        touch();
        const gid = st.detail;
        if (lang === 'zh' && gid && String(gid).indexOf('o:') !== 0) {
          const prev = st.descTr[gid];
          if (prev && prev.status === 'error') delete st.descTr[gid];
          ensureDesc(gid);
        }
        return true;
      }

      case 'bodylang': {
        const lang = el.dataset.lang === 'en' ? 'en' : 'zh';
        st.bodyLang = lang;
        touch();
        const gid = st.detail;
        if (lang === 'zh' && gid) {
          const prev = st.bodyTr[gid];
          if (prev && prev.status === 'error') delete st.bodyTr[gid];
          ensureBodyTr(gid);
        }
        return true;
      }

      case 'gotools':
        st.detail = null;
        st.previewOpen = false;
        st.tab = 'tools';
        touch();
        return true;

      case 'toggle-exclude':
        if (group) toggleExclude(group);
        return true;

      case 'exremove':
        if (group) toggleExclude(group);
        return true;

      case 'exinclude':
        if (group) toggleExclude(group);
        return true;

      case 'exit-single':
        st.mode = 'folder';
        st.detail = null;
        touch();
        toast('已退出单模组模式，现在可以拖 mods 文件夹');
        return true;

      case 'picktoggle': {
        const pk = el.dataset.pick;
        st.picker = st.picker === pk ? null : pk;
        touch();
        return true;
      }

      case 'pickset': {
        const pk = el.dataset.pick;
        const value = el.dataset.value;
        st.picker = null;
        if (pk === 'env:mc') {
          if (value && value !== st.env.mc) {
            st.env.mc = value;
            st.updates = {};
            st.updateBusy = false;
            st.updateError = '';
            st.connector = null;
            MC.store.saveEnv();
            touch();
            analyzeAndResolve(true);
            loadLoaderList();
          }
        } else if (pk === 'env:ld') {
          st.env.loaderVersion = value;
          MC.store.saveEnv();
          touch();
        } else if (pk.indexOf('g:') === 0) {
          st.selection[pk.slice(2)] = value;
        } else if (pk.indexOf('d:') === 0) {
          const dep = findDep(pk.slice(2));
          if (dep) dep.version = (dep.versions || []).find(v => v.id === value) || dep.version;
        } else if (pk.indexOf('a:') === 0) {
          const ad = st.adapt[pk.slice(2)];
          if (ad) ad.version = (ad.versions || []).find(v => v.id === value) || ad.version;
        } else if (pk.indexOf('p:') === 0) {
          st.rpPair[pk.slice(2)] = value;
        }
        touch();
        return true;
      }

      case 'toggle-select':
        st.selectMode = !st.selectMode;
        if (!st.selectMode) st.picker = null;
        touch();
        return true;

      case 'open-preview':
        st.previewOpen = true;
        st.detail = null;
        touch();
        return true;

      case 'add':
      case 'unadd': {
        const dep = findDep(key);
        if (dep) { dep.added = act === 'add'; touch(); }
        return true;
      }

      case 'depunadd': {
        const dep = findDep(key);
        if (dep) { dep.added = false; touch(); }
        return true;
      }

      case 'candmore': {
        const dep = findDep(key);
        if (dep) { dep.showCand = !dep.showCand; touch(); }
        return true;
      }

      case 'cand': {
        const dep = findDep(key);
        if (dep) chooseCandidate(dep, el.dataset.slug);
        return true;
      }

      case 'adapt': {
        const gid = el.dataset.group;
        if (gid) {
          const g = st.analysis && st.analysis.groups.find(x => x.id === gid);
          if (g) {
            const first = g.rows[0].entry;
            runAdapt(gid, {
              kind: 'group', groupId: gid,
              id: first.id || g.displayId,
              title: first.name || g.displayId
            });
          }
        } else if (el.dataset.id) {
          const id = el.dataset.id;
          runAdapt('i:' + id, { kind: 'issue', id, title: id }, el.dataset.range || '');
        }
        return true;
      }

      case 'adaptadd': {
        const ad = st.adapt[el.dataset.key];
        if (ad) addAdapt(ad);
        return true;
      }

      case 'adaptremove': {
        removeAdapt(st.adapt[el.dataset.key]);
        return true;
      }

      case 'research': {
        const dep = findDep(key);
        if (dep) {
          const input = document.querySelector('input[data-act="depword"][data-key="' + CSS.escape(key) + '"]');
          matchDep(dep, input ? input.value.trim() : '', gen);
        }
        return true;
      }

      case 'retryall':
        retryAll();
        return true;

      case 'pack':
        buildPack(el.dataset.format);
        return true;

      case 'toggle':
        if (el.dataset.what === 'optional') {
          st.includeOptional = !st.includeOptional;
          touch();
          analyzeAndResolve(true);
        } else if (el.dataset.what === 'packs') {
          st.includePacks = !st.includePacks;
          touch();
        }
        return true;

      case 'toggle-others':
        st.showOthers = !st.showOthers;
        touch();
        return true;

      case 'linkadd': {
        const id = el.dataset.id || '';
        const name = el.dataset.name || '';
        const url = ((document.getElementById('linkUrl') || {}).value || '').trim();
        const note = ((document.getElementById('linkNote') || {}).value || '').trim();
        if (!/^https?:\/\//i.test(url)) return toast('链接要以 http:// 或 https:// 开头');
        addLink(id, name, url, note);
        return true;
      }

      case 'linkdel': {
        removeLink({
          id: Number(el.dataset.row) || 0,
          modId: el.dataset.mod || '',
          url: el.dataset.url || ''
        });
        return true;
      }

      case 'linkbulk': {
        const ta = document.getElementById('linkBulk');
        if (ta) bulkLinks(ta);
        return true;
      }
    }
    return false;
  }

  /* ---------- 绑定 ---------- */
  function init() {
    const drop = document.getElementById('drop');
    const input = document.getElementById('fileInput');
    const singleInput = document.getElementById('singleInput');
    if (drop && input) {
      drop.addEventListener('click', () => input.click());
      drop.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
      });
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.value = '';
        if (files.length) importFiles(files, { fromFolder: true });
      });
      if (singleInput) {
        singleInput.addEventListener('change', () => {
          const files = Array.from(singleInput.files || []);
          singleInput.value = '';
          if (files.length) importFiles(files, { single: true });
        });
      }
      const pickFolder = document.getElementById('pickFolder');
      const pickOne = document.getElementById('pickOne');
      if (pickFolder) pickFolder.addEventListener('click', e => { e.stopPropagation(); input.click(); });
      if (pickOne) pickOne.addEventListener('click', e => {
        e.stopPropagation();
        if (singleInput) singleInput.click();
      });

      ['dragenter', 'dragover'].forEach(type => {
        drop.addEventListener(type, e => {
          e.preventDefault();
          drop.classList.add('over');
          const n = e.dataTransfer && e.dataTransfer.items ? e.dataTransfer.items.length : 0;
          if (S().dragCount !== n) { S().dragCount = n; touch(); }
        });
      });
      drop.addEventListener('dragleave', e => {
        if (!drop.contains(e.relatedTarget)) {
          drop.classList.remove('over');
          S().dragCount = 0;
          touch();
        }
      });
      drop.addEventListener('drop', async e => {
        e.preventDefault();
        drop.classList.remove('over');
        S().dragCount = 0;
        const got = await collectDrop(e.dataTransfer);
        if (got.files.length) importFiles(got.files, { fromFolder: got.fromFolder });
      });
    }
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => e.preventDefault());

    /* 页签 */
    const tabs = document.getElementById('tabs');
    if (tabs) {
      tabs.addEventListener('click', e => {
        const btn = e.target.closest('button[data-tab]');
        if (btn) handleAct('tab', btn);
      });
    }

    /* 左侧栏：游戏版本 / 加载器版本下拉 */
    const rail = document.querySelector('.rail');
    if (rail) {
      rail.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) handleAct(el.dataset.act, el);
      });
    }

    /* 导览 */
    const guideView = document.getElementById('guideView');
    if (guideView) {
      guideView.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) handleAct(el.dataset.act, el);
      });
      guideView.addEventListener('input', e => {
        const inp = e.target.closest('#guideQuery');
        if (!inp) return;
        S().guideQuery = inp.value;
        touch();
        const again = document.getElementById('guideQuery');
        if (again) {
          again.focus();
          const n = again.value.length;
          again.setSelectionRange(n, n);
        }
      });
      guideView.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.gcard');
        if (!card) return;
        e.preventDefault();
        handleAct('detail', card);
      });
    }

    /* 对比 */
    const diffView = document.getElementById('diffView');
    if (diffView) {
      diffView.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) handleAct(el.dataset.act, el);
      });
      diffView.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const z = e.target.closest('[data-drop]');
        if (!z) return;
        e.preventDefault();
        handleAct(z.dataset.act, z);
      });
    }

    /* 工具 */
    const toolsView = document.getElementById('toolsView');
    if (toolsView) {
      toolsView.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) handleAct(el.dataset.act, el);
      });
      toolsView.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const z = e.target.closest('[data-drop]');
        if (!z) return;
        e.preventDefault();
        handleAct(z.dataset.act, z);
      });
    }

    const diffInput = document.getElementById('diffInput');
    if (diffInput) {
      diffInput.addEventListener('change', () => {
        const files = Array.from(diffInput.files || []);
        diffInput.value = '';
        if (files.length) importDiff(files);
      });
    }

    const logInput = document.getElementById('logInput');
    if (logInput) {
      logInput.addEventListener('change', () => {
        const files = Array.from(logInput.files || []);
        logInput.value = '';
        if (files.length) importLogs(files);
      });
    }

    /* 对比 / 日志的拖入区（元素是渲染出来的，用委托） */
    document.addEventListener('dragover', e => {
      const z = e.target.closest && e.target.closest('[data-drop]');
      if (!z) return;
      e.preventDefault();
      z.classList.add('over');
    });
    document.addEventListener('dragleave', e => {
      const z = e.target.closest && e.target.closest('[data-drop]');
      if (z && !z.contains(e.relatedTarget)) z.classList.remove('over');
    });
    document.addEventListener('drop', async e => {
      const z = e.target.closest && e.target.closest('[data-drop]');
      if (!z) return;
      e.preventDefault();
      z.classList.remove('over');
      const got = await collectDrop(e.dataTransfer);
      if (!got.files.length) return;
      if (z.dataset.drop === 'diff') importDiff(got.files);
      else if (z.dataset.drop === 'log') importLogs(got.files);
    });

    const seg = document.getElementById('segLoader');
    if (seg) {
      seg.addEventListener('click', e => {
        const btn = e.target.closest('button[data-loader]');
        if (!btn) return;
        const st = S();
        const loader = btn.dataset.loader;
        if (st.env.loader === loader) return;
        const isDefault = st.env.loaderVersion === MC.store.DEFAULTS[st.env.loader] || !st.env.loaderVersion;
        st.env.loader = loader;
        if (isDefault) st.env.loaderVersion = MC.store.DEFAULTS[loader];
        st.updates = {};
        st.updateBusy = false;
        st.updateError = '';
        MC.store.saveEnv();
        syncEnvInputs();
        st.connector = null;
        touch();
        analyzeAndResolve(true);
        loadLoaderList();
      });
    }

    const filters = document.getElementById('filters');
    if (filters) {
      filters.addEventListener('click', e => {
        const btn = e.target.closest('button[data-filter]');
        if (!btn) return;
        S().filter = btn.dataset.filter;
        touch();
      });
    }

    const orgQuery = document.getElementById('orgQuery');
    const orgClear = document.getElementById('orgClear');
    if (orgQuery) {
      orgQuery.addEventListener('input', () => {
        if (orgClear) orgClear.hidden = !orgQuery.value;
        S().organizeQuery = orgQuery.value;
        touch();
      });
      orgQuery.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          orgQuery.value = '';
          if (orgClear) orgClear.hidden = true;
          S().organizeQuery = '';
          touch();
        }
      });
    }
    if (orgClear) {
      orgClear.addEventListener('click', () => {
        if (orgQuery) orgQuery.value = '';
        orgClear.hidden = true;
        S().organizeQuery = '';
        touch();
        if (orgQuery) orgQuery.focus();
      });
    }

    const orgSearchBtn = document.getElementById('orgSearchBtn');
    if (orgSearchBtn) {
      orgSearchBtn.addEventListener('click', () => {
        const q = document.getElementById('orgQuery');
        S().organizeQuery = q ? q.value.trim() : '';
        touch();
      });
    }

    const selectBtn = document.getElementById('selectBtn');
    if (selectBtn) {
      selectBtn.addEventListener('click', () => {
        S().selectMode = !S().selectMode;
        touch();
        toast(S().selectMode ? '勾选要进包的模组，不要的点掉' : '选择完成');
      });
    }

    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const st = S();
        if (!st.mods.length) return;
        if (!confirm('清空当前的扫描结果？只清页面，不会动你电脑里的 jar 文件。')) return;
        gen++;
        st.mods = [];
        st.analysis = null;
        st.selection = {};
        st.excluded = {};
        st.deps = [];
        st.adapt = {};
        st.connector = null;
        st.filter = 'all';
        st.mode = 'folder';
        st.selectMode = false;
        st.tab = 'organize';
        st.organizeQuery = '';
        const oq = document.getElementById('orgQuery');
        if (oq) oq.value = '';
        const oc = document.getElementById('orgClear');
        if (oc) oc.hidden = true;
        st.updates = {};
        st.updateBusy = false;
        st.updateError = '';
        st.diff = { mods: [], at: 0 };
        st.rpOrder = [];
        st.logs = { name: '', findings: [], lines: 0, errors: 0 };
        st.detail = null;
        st.previewOpen = false;
        st.progress = '';
        touch();
      });
    }

    // 行 / 面板 / 弹窗统一用事件委托
    const rows = document.getElementById('rows');
    if (rows) {
      rows.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) handleAct(el.dataset.act, el);
      });
      rows.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('.row');
        if (!row) return;
        e.preventDefault();
        handleAct('detail', row);
      });
    }

    const deps = document.getElementById('deps');
    if (deps) {
      deps.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el && el.dataset.act !== 'depword') handleAct(el.dataset.act, el);
      });
      deps.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        const input = e.target.closest('input[data-act="depword"]');
        if (!input) return;
        e.preventDefault();
        const dep = findDep(input.dataset.key);
        if (dep) matchDep(dep, input.value.trim(), gen);
      });
    }

    const pack = document.getElementById('pack');
    if (pack) {
      pack.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) handleAct(el.dataset.act, el);
      });
    }

    const overlay = document.getElementById('overlay');
    if (overlay) {
      overlay.addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (el) handleAct(el.dataset.act, el);
      });
      overlay.addEventListener('input', e => {
        const inp = e.target.closest('#previewQuery');
        if (!inp) return;
        S().previewQuery = inp.value;
        touch();
        const again = document.getElementById('previewQuery');
        if (again) {
          again.focus();
          const n = again.value.length;
          again.setSelectionRange(n, n);
        }
      });
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); handleAct('close', overlay); }
      });
    }

    document.addEventListener('click', e => {
      if (!S().picker) return;
      if (e.target.closest('.picker')) return;
      S().picker = null;
      touch();
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const st = S();
      if (st.detail || st.previewOpen) { st.detail = null; st.previewOpen = false; touch(); }
      else if (st.picker) { st.picker = null; touch(); }
    });

    syncEnvInputs();
    loadMcList();
    loadLoaderList();
    MC.linksdb.boot().then(syncDbState).catch(() => syncDbState());
  }

  MC.ui = { init, importFiles, analyzeAndResolve, buildPack, toast, saveBlob, syncEnvInputs };
})(globalThis);
