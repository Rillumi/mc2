/* ===== 流程：读取条目、导入模组、导入对比包 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();
  const { toast, sha1Hex } = MC.uiBase;
  const FM = MC.flowMeta;
  const FA = MC.flowAnalysis;

  const packZips = new WeakMap();

  /** 整套清空，进入文件夹模式（重扫 / 拖入整合包都走这里） */
  function resetAll(st) {
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
    st.packSources = [];
  }

  /** 这个文件是整合包吗（.mrpack 或带 mods/ 清单的 .zip），是就返回类型 */
  async function packType(file) {
    if (!/\.(zip|mrpack)$/i.test(file.name)) return '';
    let z = packZips.get(file);
    if (!z) {
      try { z = MC.zip.parseCentral(await file.arrayBuffer()); } catch (err) { return ''; }
      packZips.set(file, z);
    }
    return MC.modpack.detect(z.map);
  }

  /** 从字节补齐条目信息：整理页的 jar 和整合包里解出的 jar 共用 */
  async function inspectInto(entry, buf) {
    const res = await MC.metadata.inspect(buf);
    entry.kind = res.kind;
    if (res.info) Object.assign(entry, res.info);
    else if (res.kind === 'mod') entry.error = '没有找到模组元数据';
    if (res.kind === 'mod' || res.kind === 'resourcepack') entry.sha1 = await sha1Hex(buf);
    if (res.kind === 'mod') {
      // mods.toml 里写的版本常常是摆设（1.0.0），真实版本在文件名里
      entry.version = MC.metadata.resolveVersion(entry.version, entry.fileName, entry.name);
    }
    if (!entry.mc) entry.mc = MC.metadata.inferMcFromName(entry.fileName);
    if (!entry.id) entry.id = entry.fileName.replace(/\.(jar|zip)$/i, '').toLowerCase();
    return res;
  }

  /** 扫一个整合包：解出 mods/*.jar，顺便读清单里的加载器 / MC 版本 */
  async function scanPack(file) {
    const st = S();
    let z = packZips.get(file);
    if (!z) {
      try { z = MC.zip.parseCentral(await file.arrayBuffer()); } catch (err) { return null; }
      packZips.set(file, z);
    }
    const type = MC.modpack.detect(z.map);
    if (!type) return null;

    const pack = { name: file.name, file, type, title: '', env: {}, online: 0, entries: [], skipped: 0, empty: false, onlineList: [], modlistHtml: '' };
    if (type === 'mrpack') {
      try {
        const idx = JSON.parse(await MC.zip.readEntry(z, 'modrinth.index.json') || '{}');
        pack.env = MC.modpack.envFromMrpack(idx);
        pack.title = idx.name || '';
        const mods = (idx.files || []).filter(f => /^mods\//i.test(String(f.path || '')));
        pack.online = mods.length;
        // 回导需要完整的哈希、下载地址、环境和大小，不能只留下展示用链接。
        pack.onlineList = (idx.files || []).map(f => Object.assign({}, f, {
          path: String(f.path || ''), url: (f.downloads || [])[0] || ''
        }));
      } catch (err) { /* 清单坏了也照样解 jar */ }
    } else if (type === 'curseforge') {
      try {
        const mf = JSON.parse(await MC.zip.readEntry(z, 'manifest.json') || '{}');
        pack.env = MC.modpack.envFromCurse(mf);
        pack.title = mf.title || mf.name || '';
        pack.online = (mf.files || []).length;
        pack.onlineList = (mf.files || []).map(f => ({ projectID: f.projectID, fileID: f.fileID }));
        pack.modlistHtml = await MC.zip.readEntry(z, 'modlist.html') || '';
      } catch (err) { /* 忽略 */ }
    }

    const jars = MC.modpack.jarPaths(z.map);
    if (!jars.length) {
      pack.empty = !pack.onlineList.length;
      return pack;
    }

    st.scan = { note: '正在解开整合包「' + (pack.title || file.name) + '」', done: 0, total: jars.length, name: '' };
    touch();
    for (let i = 0; i < jars.length; i++) {
      const name = jars[i];
      st.scan.done = i;
      st.scan.name = name.split('/').pop();
      if (i % 8 === 0) { touch(); await new Promise(r => setTimeout(r, 0)); }
      try {
        const bytes = await MC.zip.readEntryBytes(z, name);
        if (!bytes) continue;
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const entry = newDiffEntry(name.split('/').pop(), name, bytes.length, pack.entries.length);
        entry.filePath = file.name + ' / ' + name;
        entry.packName = file.name;
        entry.packPath = name;
        const res = await inspectInto(entry, buf);
        if (res.kind === 'mod' || res.kind === 'resourcepack' || res.kind === 'shader') pack.entries.push(entry);
        else pack.skipped++;
      } catch (err) { /* 单个 jar 坏了不影响其他 */ }
      st.scan.done = i + 1;
    }
    const localNames = new Set(jars.map(p => p.split('/').pop().toLowerCase()));
    pack.online = pack.onlineList.filter(f => !f.path ||
      (/^mods\//i.test(f.path) && !localNames.has(f.path.split('/').pop().toLowerCase()))).length;
    st.scan = null;
    touch();
    return pack;
  }

  /** PCL 等启动器导出的外壳 zip：里面恰好只有一个 .mrpack，拆出来当普通整合包 */
  async function unwrapPack(file) {
    if (!/\.zip$/i.test(file.name)) return file;
    let z = packZips.get(file);
    if (!z) {
      try { z = MC.zip.parseCentral(await file.arrayBuffer()); } catch (err) { return file; }
      packZips.set(file, z);
    }
    if (MC.modpack.detect(z.map)) return file;
    const inner = MC.modpack.wrapperPath(z.map);
    if (!inner) return file;
    const bytes = await MC.zip.readEntryBytes(z, inner);
    if (!bytes) return file;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    let iz;
    try { iz = MC.zip.parseCentral(buf); } catch (err) { return file; }
    if (MC.modpack.detect(iz.map) !== 'mrpack') return file;
    const name = inner.split('/').pop() || 'modpack.mrpack';
    const virtual = typeof File === 'function'
      ? new File([buf], name, { type: 'application/zip' })
      : Object.assign(new Blob([buf]), { name });
    packZips.set(virtual, iz);
    packZips.delete(file);
    toast('已从「' + file.name + '」里取出整合包：' + name);
    return virtual;
  }

  /** 打包时按「整合包名 + 内部路径」回读 jar，避免把整包字节一直留在内存里 */
  async function readPackedBytes(packName, path) {
    const src = (S().packSources || []).find(p => p.name === packName);
    if (!src || !src.file) return null;
    let z = packZips.get(src.file);
    if (!z) {
      try { z = MC.zip.parseCentral(await src.file.arrayBuffer()); } catch (err) { return null; }
      packZips.set(src.file, z);
    }
    return MC.zip.readEntryBytes(z, path);
  }

  /** 导出时列出原包里的条目路径（用来挑 config / 资源包这些非 mods 内容） */
  async function listPacked(packName) {
    const src = (S().packSources || []).find(p => p.name === packName);
    if (!src || !src.file) return [];
    let z = packZips.get(src.file);
    if (!z) {
      try { z = MC.zip.parseCentral(await src.file.arrayBuffer()); } catch (err) { return []; }
      packZips.set(src.file, z);
    }
    return Array.from(z.map.keys());
  }

  /** 把文件读成条目（整理页 / 对比页共用） */
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
          const res = await inspectInto(entry, buf);
          if (!res.info && res.kind !== 'mod') notMod++;
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
    let list = Array.from(files || []).filter(f => /\.(jar|zip|mrpack)$/i.test(f.name));
    if (!list.length) {
      st.scan = null;
      touch();
      return toast('没找到 .jar / .zip / .mrpack 文件，把 mods 文件夹或整合包拖进来就行');
    }

    // 拖进来的可能是整个整合包：先认出来，再解出里面的 jar
    // 文件夹里内嵌的整合包默认跳过（只扫 jar），不然会把包内在线清单混进来
    const unwrapped = [];
    for (const f of list) unwrapped.push(await unwrapPack(f));
    list = unwrapped;
    const packs = [];
    let plain = [];
    const nested = [];
    for (const f of list) {
      // 单独拖进来的文件也会带 modpilotPath，只有从文件夹里带出来的才算内嵌包
      const inFolder = !!(f.webkitRelativePath || (f.modpilotPath && opts.fromFolder));
      const type = await packType(f);
      if (!type) { plain.push(f); continue; }
      if (inFolder) { nested.push(f.name); continue; }
      packs.push(f);
    }
    const scanned = [];
    const emptyPacks = [];
    const packEnv = {};
    for (const f of packs) {
      const pack = await scanPack(f);
      if (!pack) continue;
      if (pack.empty) { emptyPacks.push(pack.title || f.name); continue; }
      scanned.push(pack);
      Object.assign(packEnv, pack.env || {});
    }
    st.scan = null;

    if (!scanned.length && emptyPacks.length && !plain.length) {
      touch();
      return toast('「' + emptyPacks[0] + '」只有整合包清单、没有 mods 文件，读不出前置和版本；在启动器里装好后拖 mods 文件夹就行');
    }

    const hasPack = scanned.length > 0;
    const single = !hasPack && (opts.single || st.mode === 'single');

    // 之前扫的是整合包，现在拖的是普通文件夹：整份换掉，
    // 否则旧包的在线清单会留在 packSources 里，导出清单时混进来（看着像重复项）
    if (!hasPack && !single && (st.packSources || []).length) {
      resetAll(st);
      toast('已从整合包切回文件夹，重新分析');
    }

    // 一键重扫 / 拖入整合包：整个替换，这样删掉的模组也会从列表消失
    if (hasPack) {
      resetAll(st);
      // 记下源整合包，打包时按路径回读 jar 字节（条目不保留 File 对象）
      st.packSources = scanned.map(p => ({
        name: p.name, file: p.file, type: p.type,
        onlineList: p.onlineList || [], modlistHtml: p.modlistHtml || ''
      }));
      // 整合包清单里写着加载器和 MC 版本，先套上再分析
      if (packEnv.loader && MC.store.DEFAULTS[packEnv.loader]) st.env.loader = packEnv.loader;
      if (packEnv.loaderVersion) st.env.loaderVersion = packEnv.loaderVersion;
      if (packEnv.mc) st.env.mc = packEnv.mc;
      if (packEnv.loader || packEnv.loaderVersion || packEnv.mc) {
        st.updates = {};
        st.connector = null;
        MC.store.saveEnv();
      }
    } else if (single) {
      resetAll(st);
      st.mode = 'single';
      if (plain.length > 1) {
        toast('单模组模式只分析第一个文件');
        plain = plain.slice(0, 1);
      }
    } else if (opts.replace) {
      resetAll(st);
    } else if (opts.fromFolder && st.mode === 'single') {
      resetAll(st);
      toast('已切回文件夹模式');
    }

    let packEntries = [];
    if (hasPack) {
      scanned.forEach(pack => { packEntries = packEntries.concat(pack.entries); });
    }

    let plainEntries = [];
    // 整合包里解出来的资源包 / 光影也放到「资源包与光影」里
    let notMod = packEntries.filter(e => e.kind === 'resourcepack' || e.kind === 'shader').length;
    if (plain.length) {
      let fresh = plain;
      if (!hasPack && !single) {
        const seen = new Set(st.mods.map(m => m.fileName + ':' + m.size));
        fresh = plain.filter(f => !seen.has(f.name + ':' + f.size));
        if (!fresh.length) {
          st.scan = null;
          touch();
          return toast('这些文件已经在列表里了');
        }
      }
      const built = await buildEntries(fresh, hasPack ? '正在读取另外的文件' : '正在读取');
      plainEntries = built.entries;
      notMod = built.notMod;
    }

    const entries = packEntries.concat(plainEntries);
    if (!entries.length) {
      st.scan = null;
      touch();
      // 纯在线清单也允许重新导出，无需先把所有 jar 下载到本地。
      if (!hasPack || !scanned.some(p => p.onlineList.length)) return toast('没有读到可分析的模组');
    }
    st.mods.push(...entries);
    if (opts.handle && !single && !hasPack && MC.libraryPanel) MC.libraryPanel.save(opts.handle, st);
    MC.pager.resetAll();
    st.progress = '';
    await FA.analyzeAndResolve(true);
    // 读取完就把每个项目的资料（简介 / 正文 / 图标）批量拉回来，详情页不用再等网络
    FM.prefetchProjects();
    // 哈希对不上的模组，按 modId 在后台补图标/链接（只拉元信息，默认关闭，可在设置里开）
    FM.prefetchLite();
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
    if (hasPack) {
      const online = scanned.reduce((n, p) => n + (p.online || 0), 0);
      const skipped = scanned.reduce((n, p) => n + (p.skipped || 0), 0);
      const modCount = packEntries.filter(e => e.kind === 'mod').length;
      toast('已扫描整合包：' + modCount + ' 个模组' +
        (online ? '（另有 ' + online + ' 个在线清单项不在包里）' : '') +
        (skipped ? '；有 ' + skipped + ' 个 jar 没读到模组信息，已跳过' : '') +
        (packEnv.loader ? ' · ' + packEnv.loader + ' ' + (packEnv.mc || st.env.mc) : ''));
    }
    if (nested.length) {
      toast('已跳过文件夹里内嵌的整合包 ' + nested.length + ' 个：' +
        nested.slice(0, 3).join('、') + (nested.length > 3 ? ' 等' : '') +
        '（只扫 jar，不带它们包内的在线清单）');
    }
  }

  /* ---------- 对比：导入另一个包 ---------- */
  /** 拖进来的是整合包 .zip：把里面 mods/*.jar 解出来一起对比 */
  async function expandModpack(files) {
    const st = S();
    const out = [];
    for (const raw of files) {
      const file = await unwrapPack(raw);
      if (!/\.(zip|mrpack)$/i.test(file.name)) continue;
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
    const list = Array.from(files || []).filter(f => /\.(jar|zip|mrpack)$/i.test(f.name));
    if (!list.length) {
      st.scan = null;
      touch();
      return toast('没找到 .jar / .zip / .mrpack 文件');
    }
    const jarOnly = list.filter(f => /\.jar$/i.test(f.name));
    const built = jarOnly.length ? await buildEntries(jarOnly, '正在读取另一个包') : { entries: [] };
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

  MC.flowScan = { buildEntries, importFiles, expandModpack, newDiffEntry, importDiff, readPackedBytes, listPacked };
})(globalThis);
