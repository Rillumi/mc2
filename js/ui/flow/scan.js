/* ===== 流程：读取条目、导入模组、导入对比包 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();
  const { toast, sha1Hex } = MC.uiBase;
  const FM = MC.flowMeta;
  const FA = MC.flowAnalysis;

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
    await FA.analyzeAndResolve(true);
    // 读取完就把每个项目的资料（简介 / 正文 / 图标）批量拉回来，详情页不用再等网络
    FM.prefetchProjects();
    // 顺便补上大家平时叫的中文名（MC百科），列表和搜索都能直接用
    FM.prefetchZhNames();
    // 分类：先用本地库/Modrinth 填上，导览页不用等预取完成
    FM.applyCats(st);

    if (notMod) {
      st.showOthers = true;
      toast('识别到 ' + notMod + ' 个资源包 / 光影，已放到「资源包与光影」里，不会进 mods');
    }
    if (single && st.analysis && st.analysis.groups.length) {
      st.detail = st.analysis.groups[0].id;
      touch();
    }
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

  MC.flowScan = { buildEntries, importFiles, expandModpack, newDiffEntry, importDiff };
})(globalThis);
