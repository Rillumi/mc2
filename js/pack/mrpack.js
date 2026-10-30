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

  function notice(env, localCount, onlineCount, skipped) {
    const lines = [
      'ModPilot 导出的整合包',
      '',
      '目标环境：' + env.loader + ' ' + env.mc,
      '加载器版本：' + loaderVersion(env),
      '本地 jar：' + localCount + ' 个',
      '在线前置：' + onlineCount + ' 个',
      '',
      '安装：把这个压缩包解压进 .minecraft，把 mods 文件夹和里面的 jar 放进版本目录的 mods 里。',
      '如果有启动器提示缺前置，说明在线前置没有下载成功，可按下面的链接手动下载：'
    ];
    if (skipped && skipped.length) {
      skipped.forEach(s => lines.push(' - ' + s));
    } else {
      lines.push(' （无）');
    }
    lines.push('', '生成时间：' + new Date().toLocaleString('zh-CN'));
    return lines.join('\n');
  }

  /** .mrpack：在线依赖只写清单不下载；本地 jar 放进 overrides/mods */
  async function buildMrpack(opts) {
    const env = opts.env;
    const used = new Set();
    const files = [];

    (opts.deps || []).forEach(dep => {
      const f = dep.version && dep.version.files && dep.version.files[0];
      if (!f || !f.hashes || !f.hashes.sha1 || !f.hashes.sha512) return;
      files.push({
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

    zipFiles.push({
      path: 'overrides/ModPilot-说明.txt',
      data: enc.encode(notice(env, (opts.localJars || []).length, files.length))
    });

    return { blob: await MC.zipWriter.build(zipFiles), filename: baseName(env) + '.mrpack' };
  }

  /** 普通 zip：所有 jar 实打实放进去，离线也能装 */
  async function buildPlainZip(opts) {
    const env = opts.env;
    const used = new Set();
    const jars = [];
    const skipped = [];
    let downloaded = 0;

    (opts.localJars || []).forEach(jar => {
      jars.push({ name: uniqueJarName(jar.name, used), data: jar.data });
    });

    for (const dep of (opts.deps || [])) {
      const f = dep.version && dep.version.files && dep.version.files[0];
      if (!f) continue;
      if (opts.onProgress) opts.onProgress('正在下载 ' + (dep.project.title || dep.project.slug) + '…');
      try {
        const bytes = await MC.api.modrinth.download(f.url);
        downloaded++;
        jars.push({ name: uniqueJarName(f.filename || ((dep.project.slug || 'mod') + '.jar'), used), data: bytes });
      } catch (err) {
        skipped.push((dep.project.title || dep.project.slug) + ' → ' + f.url);
      }
    }

    const zipFiles = jars.map(j => ({ path: 'mods/' + j.name, data: j.data }));
    (opts.extras || []).forEach(x => {
      zipFiles.push({
        path: packFolder(x.kind) + '/' + uniqueName(x.name, used, '.zip'),
        data: x.data
      });
    });
    zipFiles.push({
      path: '安装说明.txt',
      data: enc.encode(notice(env, (opts.localJars || []).length, downloaded, skipped))
    });

    return { blob: await MC.zipWriter.build(zipFiles), filename: baseName(env) + '-普通包.zip' };
  }

  MC.pack = { buildMrpack, buildPlainZip, dependencies, baseName };
})(globalThis);
