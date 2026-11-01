/* ===== 下载清单包：manifest.json（给启动器看）+ modlist.html（给人看） =====
   只写清单，不装 jar，适合把“整合包 + 在线项”完整交代给别人。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const enc = new TextEncoder();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function loaderId(env) {
    const l = String((env && env.loader) || 'fabric').toLowerCase();
    return l + '-' + (env && env.loaderVersion ? env.loaderVersion : '');
  }

  /** CurseForge 结构：files 只放有 projectID/fileID 的在线项 */
  function manifest(opt) {
    const files = (opt.online || [])
      .filter(o => o && o.projectID && o.fileID)
      .map(o => ({ projectID: Number(o.projectID), fileID: Number(o.fileID), required: true }));
    return JSON.stringify({
      name: opt.title || 'ModPilot 清单',
      version: '1.0.0',
      author: 'ModPilot',
      manifestType: 'minecraftModpack',
      overrides: 'overrides',
      minecraft: {
        version: (opt.env && opt.env.mc) || '',
        modLoaders: [{ id: loaderId(opt.env), primary: true }]
      },
      files
    }, null, 2);
  }

  function html(opt) {
    const local = opt.local || [];
    const online = opt.online || [];
    const localRows = local.map(m =>
      '<tr><td>' + esc(m.name) + '</td><td>' + esc(m.version || '-') + '</td><td>' +
      (m.url ? '<a href="' + esc(m.url) + '" target="_blank" rel="noopener">' + esc(m.source || '链接') + '</a>' : esc(m.source || '本地 jar')) +
      '</td></tr>').join('');

    // 在线项：CurseForge 只有 projectID/fileID，Modrinth 有直链
    const onlineRows = online.map(o => {
      const name = o.path ? o.path.split('/').pop() : ('项目 ' + o.projectID + ' / 文件 ' + o.fileID);
      const link = o.url ? '<a href="' + esc(o.url) + '" target="_blank" rel="noopener">下载</a>' : '按 projectID/fileID 下载';
      return '<tr><td>' + esc(name) + '</td><td>' + link + '</td></tr>';
    }).join('');

    const original = opt.original
      ? '<p class="note">原包还带了一份 <a href="原包模组列表.html">原包模组列表</a>（含完整名称和链接）。</p>'
      : '';

    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + esc(opt.title || 'ModPilot 下载清单') + '</title><style>' +
      'body{margin:0;padding:28px 20px;font:14px/1.7 -apple-system,"Segoe UI","PingFang SC",sans-serif;color:#2C2A3A;background:#F6F4FB}' +
      '.wrap{max-width:820px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}' +
      '.meta{color:#6E6A85;margin-bottom:20px}section{margin:22px 0}' +
      'h2{font-size:15px;margin:0 0 8px}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}' +
      'th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #ECE9F4}' +
      'th{font-size:12px;color:#6E6A85;font-weight:600}tr:last-child td{border-bottom:0}' +
      'a{color:#7C63E8}.note,.foot{color:#6E6A85;font-size:12px;margin-top:14px}' +
      '</style></head><body><div class="wrap">' +
      '<h1>' + esc(opt.title || 'ModPilot 下载清单') + '</h1>' +
      '<div class="meta">' + esc((opt.env && opt.env.loader) || '') + ' ' + esc((opt.env && opt.env.loaderVersion) || '') +
      ' · Minecraft ' + esc((opt.env && opt.env.mc) || '') + '</div>' +
      '<section><h2>已打包的模组（' + local.length + '）</h2>' +
      (local.length ? '<table><thead><tr><th>模组</th><th>版本</th><th>来源</th></tr></thead><tbody>' + localRows + '</tbody></table>' : '<p class="note">这包里没有本地模组。</p>') +
      '</section>' +
      '<section><h2>在线项（' + online.length + '，由启动器按清单下载）</h2>' +
      (online.length ? '<table><thead><tr><th>项目</th><th>下载</th></tr></thead><tbody>' + onlineRows + '</tbody></table>' : '<p class="note">没有在线项。</p>') +
      '</section>' + original +
      '<p class="foot">由 ModPilot 生成。manifest.json 是 CurseForge 格式，只有 projectID/fileID 的项才写得进去；' +
      'Modrinth 模组的直链写在 .mrpack 的 modrinth.index.json 里。</p>' +
      '</div></body></html>';
  }

  function notice(opt) {
    return [
      'ModPilot 下载清单',
      '',
      '目标环境：' + ((opt.env && opt.env.loader) || '') + ' ' + ((opt.env && opt.env.mc) || ''),
      '加载器版本：' + (((opt.env && opt.env.loaderVersion) || '未填')),
      '',
      '本地已打包：' + (opt.local || []).length + ' 个（见 modlist.html）',
      '在线项：' + (opt.online || []).length + ' 个（原清单全部条目，本地已打包的也在里面，启动器会按清单下全量）',
      '',
      'manifest.json 是 CurseForge 格式：启动器会按 projectID + fileID 去下载。',
      'Modrinth 的模组没有 CurseForge ID，写不进 manifest.json，直链在 .mrpack 的 modrinth.index.json 里。'
    ].join('\n');
  }

  function baseName(env) {
    const l = env && env.loader ? env.loader.toLowerCase() : 'pack';
    return 'ModPilot-' + l + '-' + ((env && env.mc) || 'x');
  }

  async function buildListZip(opt) {
    const files = [
      { path: 'manifest.json', data: enc.encode(manifest(opt)) },
      { path: 'modlist.html', data: enc.encode(html(opt)) },
      { path: 'ModPilot-说明.txt', data: enc.encode(notice(opt)) }
    ];
    if (opt.original) files.push({ path: '原包模组列表.html', data: enc.encode(opt.original) });
    return {
      blob: await MC.zipWriter.build(files),
      filename: baseName(opt.env) + '-下载清单.zip'
    };
  }

  MC.pack = MC.pack || {};
  MC.pack.buildListZip = buildListZip;
  MC.pack.manifestText = manifest;
  MC.pack.modlistText = html;
})(globalThis);
