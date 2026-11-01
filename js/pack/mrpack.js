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

    // 原包里带过来的 config / defaultconfigs / kubejs / resourcepacks 等
    (opts.overrides || []).forEach(o => {
      zipFiles.push({ path: 'overrides/' + o.path, data: o.data });
    });

    zipFiles.push({
      path: 'overrides/ModPilot-说明.txt',
      data: enc.encode(notice(env, (opts.localJars || []).length, files.length, opts.skipped, (opts.overrides || []).length, opts.offline))
    });

    return { blob: await MC.zipWriter.build(zipFiles), filename: baseName(env) + '.mrpack' };
  }

  MC.pack = { buildMrpack, dependencies, baseName };
})(globalThis);
