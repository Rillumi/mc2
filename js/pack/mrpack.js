/* ===== 打包：.mrpack（PCL / HMCL / Prism 可导入）+ 普通 zip ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const enc = new TextEncoder();

  function loaderVersion(env) {
    return env.loaderVersion || (env.loader === 'Fabric' ? '0.18.4' : '47.4.0');
  }

  function dependencies(env) {
    const d = { minecraft: env.mc };
    if (env.loader === 'Fabric') d['fabric-loader'] = loaderVersion(env);
    else if (env.loader === 'NeoForge') d['neoforge'] = loaderVersion(env);
    else d.forge = loaderVersion(env);
    return d;
  }

  function baseName(env) {
    return 'ModPilot-' + env.loader + '-' + env.mc;
  }

  function uniqueName(name, used, ext) {
    let candidate = String(name || ('file' + ext)).replace(/[\\/:*?"<>|]/g, '_');
    const re = new RegExp('\\' + ext + '$', 'i');
    if (!re.test(candidate)) candidate += ext;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = candidate.replace(re, '') + '-' + n + ext;
      n++;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  function uniqueJarName(name, used) {
    return uniqueName(name, used, '.jar');
  }

  function packFolder(kind) {
    return kind === 'shader' ? 'shaderpacks' : 'resourcepacks';
  }

  function notice(env, localCount, onlineCount, skipped, overrideCount, offline) {
    const lines = [
      'ModPilot 导出的整合包',
      '',
      '目标环境：' + env.loader + ' ' + env.mc,
      '加载器版本：' + loaderVersion(env),
      '本地 jar：' + localCount + ' 个' + (offline ? '（含前置，全部在 overrides/mods）' : '')
    ];
    if (!offline) lines.push('在线前置：' + onlineCount + ' 个');
    if (overrideCount) lines.push('原包配置/资源包：' + overrideCount + ' 个文件');
    lines.push('');
    lines.push(offline
      ? '安装：把 .mrpack 拖进 PCL 2.13 以上（或 HMCL / Prism）直接导入，模组和配置都在包里，不用再联网下载。'
      : '安装：把 .mrpack 拖进 PCL 2.13 以上（或 HMCL / Prism）导入，在线前置会按清单自动下载。');
    if (skipped && skipped.length) {
      lines.push('下面这些没打进包，需要手动补：');
      skipped.forEach(s => lines.push(' - ' + s));
    }
    lines.push('', '生成时间：' + new Date().toLocaleString('zh-CN'));
    return lines.join('\n');
  }

  /** .mrpack：在线依赖只写清单不下载；本地 jar 放进 overrides/mods */
  async function buildMrpack(opts) {
    const env = opts.env;
    const used = new Set();
    const files = [];

    function addOnline(f) {
      const path = String(f.path || '').replace(/\\/g, '/');
      if (!path || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..') || /[:\x00]/.test(path)) {
        throw new Error('在线文件路径不合法：' + path);
      }
      if (!f.hashes || !/^[a-f0-9]{40}$/i.test(f.hashes.sha1 || '') || !/^[a-f0-9]{128}$/i.test(f.hashes.sha512 || '')) {
        throw new Error(path + ' 缺少有效 sha1/sha512，请重新导入原包');
      }
      if (!Array.isArray(f.downloads) || !f.downloads.length || f.downloads.some(u => !/^https:\/\//i.test(u))) {
        throw new Error(path + ' 缺少 HTTPS 下载地址');
      }
      if (!Number.isSafeInteger(f.fileSize) || f.fileSize < 0) throw new Error(path + ' 缺少有效文件大小');
      const old = files.find(x => x.path.toLowerCase() === path.toLowerCase());
      if (old) {
        if (old.hashes.sha1.toLowerCase() !== f.hashes.sha1.toLowerCase()) throw new Error('在线文件路径冲突：' + path);
        return;
      }
      files.push({ path, hashes: f.hashes, downloads: f.downloads.slice(), fileSize: f.fileSize,
        ...(f.env ? { env: f.env } : {}) });
      used.add(path.split('/').pop().toLowerCase());
    }

    (opts.onlineFiles || []).forEach(addOnline);

    (opts.deps || []).forEach(dep => {
      const f = dep.version && dep.version.files && dep.version.files[0];
      if (!f) throw new Error('前置缺少下载文件：' + dep.project.title);
      if (f.hashes && files.some(x => x.hashes.sha1.toLowerCase() === String(f.hashes.sha1).toLowerCase())) return;
      addOnline({
        path: 'mods/' + uniqueJarName(f.filename || ((dep.project.slug || 'mod') + '.jar'), used),
        hashes: { sha1: f.hashes.sha1, sha512: f.hashes.sha512 },
        env: { client: 'required', server: 'required' },
        downloads: [f.url],
        fileSize: f.size
      });
    });

    const index = {
      formatVersion: 1,
      game: 'minecraft',
      versionId: '1.0.0',
      name: 'ModPilot ' + env.loader + ' ' + env.mc,
      files,
      dependencies: dependencies(env)
    };

    const zipFiles = [{
      path: 'modrinth.index.json',
      data: enc.encode(JSON.stringify(index, null, 2))
    }];

    (opts.localJars || []).forEach(jar => {
      zipFiles.push({ path: 'overrides/mods/' + uniqueJarName(jar.name, used), data: jar.data });
    });

    (opts.extras || []).forEach(x => {
      zipFiles.push({
        path: 'overrides/' + packFolder(x.kind) + '/' + uniqueName(x.name, used, '.zip'),
        data: x.data
      });
    });

    // 原包里带过来的 config / defaultconfigs / kubejs / resourcepacks 等
    (opts.overrides || []).forEach(o => {
      zipFiles.push({ path: 'overrides/' + o.path, data: o.data });
    });

    zipFiles.push({
      path: 'overrides/ModPilot-说明.txt',
      data: enc.encode(notice(env, (opts.localJars || []).length, files.length, opts.skipped, (opts.overrides || []).length, opts.offline))
    });

    return {
      blob: await MC.zipWriter.build(zipFiles),
      filename: baseName(env) + '.mrpack',
      meta: { format: 'mrpack', jars: (opts.localJars || []).length, online: files.length }
    };
  }

  /** 普通 zip：所有 jar 实打实放进去，离线也能装 */
  async function buildPlainZip(opts) {
    const env = opts.env;
    const used = new Set();
    const jars = [];
    const skipped = [];
    let downloaded = 0;
    const originalFiles = [];

    for (const f of (opts.onlineFiles || [])) {
      if (!f.path || /(?:^|[\\/])\.\.?(?:[\\/]|$)|^[/\\]|[:\x00]/.test(f.path)) throw new Error('在线文件路径不合法');
      const url = (f.downloads || [])[0] || f.url;
      if (!/^https:\/\//i.test(url || '')) throw new Error(f.path + ' 没有可用的下载地址');
      if (opts.onProgress) opts.onProgress('正在下载原包文件 ' + f.path + '…');
      const bytes = await MC.api.modrinth.download(url);
      if (!f.hashes || !f.hashes.sha1) throw new Error(f.path + ' 缺少哈希，请重新导入原包');
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
      const hash = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== f.hashes.sha1.toLowerCase() || bytes.length !== f.fileSize) throw new Error(f.path + ' 下载内容校验失败');
      originalFiles.push({ path: f.path, data: bytes });
      used.add(f.path.split('/').pop().toLowerCase());
      downloaded++;
    }

    (opts.localJars || []).forEach(jar => {
      jars.push({ name: uniqueJarName(jar.name, used), data: jar.data });
    });

    for (const dep of (opts.deps || [])) {
      const f = dep.version && dep.version.files && dep.version.files[0];
      if (!f) throw new Error('前置缺少下载文件：' + dep.project.title);
      if (opts.onProgress) opts.onProgress('正在下载 ' + (dep.project.title || dep.project.slug) + '…');
      try {
        const bytes = await MC.api.modrinth.download(f.url);
        downloaded++;
        jars.push({ name: uniqueJarName(f.filename || ((dep.project.slug || 'mod') + '.jar'), used), data: bytes });
      } catch (err) {
        throw new Error('前置下载失败：' + (dep.project.title || dep.project.slug));
      }
    }

    const zipFiles = originalFiles.concat(jars.map(j => ({ path: 'mods/' + j.name, data: j.data })));
    (opts.extras || []).forEach(x => {
      zipFiles.push({
        path: packFolder(x.kind) + '/' + uniqueName(x.name, used, '.zip'),
        data: x.data
      });
    });
    (opts.overrides || []).forEach(o => {
      zipFiles.push({ path: o.path, data: o.data });
    });
    zipFiles.push({
      path: '安装说明.txt',
      data: enc.encode(notice(env, (opts.localJars || []).length, downloaded, skipped, (opts.overrides || []).length))
    });

    return {
      blob: await MC.zipWriter.build(zipFiles),
      filename: baseName(env) + '-普通包.zip',
      meta: { format: 'zip', jars: jars.length + originalFiles.filter(f => /^mods\/[^/]+\.jar$/i.test(f.path)).length, online: downloaded, skipped }
    };
  }

  MC.pack = { buildMrpack, buildPlainZip, dependencies, baseName };
})(globalThis);
