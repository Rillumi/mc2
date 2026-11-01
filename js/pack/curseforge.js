/* ===== 导出 CurseForge 整合包：manifest.json + modlist.html + overrides ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const enc = new TextEncoder();

  function loaderId(env) {
    const l = String((env && env.loader) || 'fabric').toLowerCase();
    const v = env && env.loaderVersion ? String(env.loaderVersion) : '';
    return l + (v ? '-' + v : '');
  }

  function uniqueName(name, used, ext) {
    const suffix = ext || '.jar';
    const re = new RegExp('\\' + suffix + '$', 'i');
    let n = String(name || ('file' + suffix)).replace(/[\\/:*?"<>|]/g, '_');
    if (!re.test(n)) n += suffix;
    let i = 2;
    while (used.has(n.toLowerCase())) {
      n = n.replace(re, '') + '-' + i + suffix;
      i++;
    }
    used.add(n.toLowerCase());
    return n;
  }

  /* files 只放 CurseForge 上能按 projectID + fileID 下载的项 */
  function manifest(opt) {
    return JSON.stringify({
      manifestType: 'minecraftModpack',
      manifestVersion: 1,
      name: opt.title || 'ModPilot 整合包',
      version: '1.0.0',
      author: 'ModPilot',
      overrides: 'overrides',
      minecraft: {
        version: (opt.env && opt.env.mc) || '',
        modLoaders: [{ id: loaderId(opt.env), primary: true }]
      },
      files: (opt.files || []).map(f => ({
        projectID: Number(f.projectID),
        fileID: Number(f.fileID),
        required: true
      }))
    }, null, 2);
  }

  function notice(opt) {
    return [
      'ModPilot 导出的 CurseForge 整合包',
      '',
      '目标环境：' + ((opt.env && opt.env.loader) || '') + ' ' + ((opt.env && opt.env.mc) || ''),
      '加载器版本：' + ((opt.env && opt.env.loaderVersion) || '未填'),
      '',
      '已经打进 overrides 的模组：' + (opt.jars || []).length + ' 个（含 Modrinth 前置和本地 jar）',
      '交给启动器下载的清单：' + (opt.files || []).length + ' 个（projectID + fileID）',
      '指纹反查命中并去掉的重复项：' + (opt.matched || 0) + ' 个',
      '',
      '安装：PCL 2.13 以上可以直接拖入这个 zip；其它启动器解压后是「manifest.json + overrides」的标准结构。',
      '启动器会按清单去 CurseForge 下载在线项，overrides 里的文件原样覆盖进版本目录。'
    ].join('\n');
  }

  async function build(opt) {
    const used = new Set();
    const zip = [];

    (opt.jars || []).forEach(j => {
      zip.push({ path: 'overrides/mods/' + uniqueName(j.name, used, '.jar'), data: j.data });
    });

    (opt.extras || []).forEach(x => {
      zip.push({
        path: 'overrides/' + (x.kind === 'shader' ? 'shaderpacks' : 'resourcepacks') + '/' + uniqueName(x.name, used, '.zip'),
        data: x.data
      });
    });

    (opt.overrides || []).forEach(o => {
      zip.push({ path: 'overrides/' + o.path, data: o.data });
    });

    zip.push({ path: 'manifest.json', data: enc.encode(manifest(opt)) });
    if (MC.pack && MC.pack.modlistText) {
      zip.push({
        path: 'modlist.html',
        data: enc.encode(MC.pack.modlistText({
          title: opt.title, env: opt.env, local: opt.local || [], online: opt.online || []
        }))
      });
    }
    zip.push({ path: 'ModPilot-说明.txt', data: enc.encode(notice(opt)) });

    const base = 'ModPilot-' + String((opt.env && opt.env.loader) || 'pack').toLowerCase() +
      '-' + ((opt.env && opt.env.mc) || 'x');
    return { blob: await MC.zipWriter.build(zip), filename: base + '-CurseForge.zip' };
  }

  MC.pack = MC.pack || {};
  MC.pack.buildCurse = build;
  MC.pack.curseManifest = manifest;
})(globalThis);
