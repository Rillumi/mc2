/* ===== 整理视图：右侧打包卡 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const R = (MC.render = MC.render || {});
  const { esc, icon, IC, fmtSize, adaptAdded } = R;

  function renderPack(s) {
    const el = document.getElementById('pack');
    if (!el) return;

    const a = s.analysis;
    const picked = MC.selector.selectedRows(s, a);
    const added = s.deps.filter(d => d.added && d.status === 'ok' && d.version);
    const adapted = adaptAdded(s);
    const total = picked.length + added.length + adapted.length;
    const packList = ((a && a.others) || []).filter(o => o.kind === 'resourcepack' || o.kind === 'shader');
    const packsOn = !!(s.includePacks && packList.length);
    const packBytes = packList.reduce((n, o) => n + (o.size || 0), 0);
    const hasOptional = picked.some(r => ((r.entry && r.entry.optionalDeps) || []).length);
    const size = picked.reduce((n, r) => n + (r.entry.size || 0), 0) +
      added.concat(adapted).reduce((n, d) => {
        const f = d.version.files && d.version.files[0];
        return n + ((f && f.size) || 0);
      }, 0) + (packsOn ? packBytes : 0);
    const hasContent = total + (packsOn ? packList.length : 0);

    const open = s.deps.filter(d => !(d.added && d.status === 'ok' && d.version));
    const excluded = MC.selector.excludedGroups(s, a).length;
    const checks = [
      ['加载器全部一致', true],
      ['游戏版本全部一致', true],
      ['同 modId 只留一份', true],
      ['缺前置已补齐', open.length === 0],
      ['前置版本满足要求', a ? a.versionIssues.every(w => s.adapt['i:' + w.id] && s.adapt['i:' + w.id].added) : true],
      ['modId 声明无冲突', a ? a.overlaps.length === 0 : true]
    ];

    const disabled = (!hasContent || s.busy) ? ' disabled' : '';
    const verLabel = s.env.loader === 'Fabric' ? 'Fabric Loader' : (s.env.loader + ' 版本');

    el.innerHTML =
      '<h3>打包成整合包</h3>' +
      '<div class="sum">包里 <b>' + total + '</b> 个模组 · 约 ' + fmtSize(size) +
      (added.length ? ' · 含 ' + added.length + ' 个前置' : '') +
      (adapted.length ? ' · 换 ' + adapted.length + ' 个版本' : '') +
      (excluded ? ' · 排除 ' + excluded + ' 个' : '') +
      (packsOn ? ' · 另带 ' + packList.length + ' 个资源包/光影' : '') + '</div>' +

      '<button type="button" class="btn line full preview-btn" data-act="open-preview"' + (s.analysis ? '' : ' disabled') + '>' +
      icon(IC.layers, '#7C63E8') + '预览包里有什么</button>' +

      '<button type="button" class="opt' + (s.selectMode ? '' : ' off') + '" data-act="toggle-select">' +
      '<span class="box">' + icon(IC.check, '#fff') + '</span>' +
      '<div>选择要进包的模组<br><span style="color:var(--ink-3)">' +
      (s.selectMode ? '列表里勾选，不要的点掉' : '打开后每行前面出现勾选框') + '</span></div></button>' +

      (hasOptional
        ? '<button type="button" class="opt' + (s.includeOptional ? '' : ' off') + '" data-act="toggle" data-what="optional">' +
          '<span class="box">' + icon(IC.check, '#fff') + '</span>' +
          '<div>也列出可选兼容项<br><span style="color:var(--ink-3)">作者标成非强制，不开也能正常启动</span></div></button>'
        : '') +

      (packList.length
        ? '<button type="button" class="opt' + (s.includePacks ? '' : ' off') + '" data-act="toggle" data-what="packs">' +
          '<span class="box">' + icon(IC.check, '#fff') + '</span>' +
          '<div>资源包 / 光影也一起打包<br><span style="color:var(--ink-3)">' +
          (s.includePacks ? '会放进 resourcepacks / shaderpacks' : '默认只打 mods，不带它们') + '</span></div></button>'
        : '') +

      (hasContent
        ? '<div class="checks">' + checks.map(([text, ok]) =>
          '<div' + (ok ? '' : ' class="bad"') + '>' +
          icon(ok ? IC.check : '<path d="M6 6l12 12M18 6L6 18"/>', ok ? null : '#DE5E84') +
          text + '</div>'
        ).join('') + '</div>'
        : '<div class="hint err" style="margin:12px 0">' + (a
          ? '还没有能进包的模组。给不兼容的模组找适配版本，或在列表里恢复被排除的。'
          : '先把 mods 文件夹拖进来。') + '</div>') +

      (s.busy ? '<div class="loading"><span class="spinner"></span>' + esc(s.progress || '正在打包…') + '</div>' : '') +

      '<div class="pack-actions">' +
      '<button type="button" class="btn grad full" data-act="pack" data-format="mrpack"' + disabled + '>' +
      icon('<path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M4 16v4h16v-4"/>', '#fff') + '生成 .mrpack</button>' +
      '<button type="button" class="btn line full" data-act="pack" data-format="zip"' + disabled + '>生成普通 zip（mods 文件夹）</button>' +
      '</div>' +

      '<div class="hintbox">.mrpack：PCL 2.13 以上直接导入，在线前置按清单自动下载，本地 jar 放进 overrides/mods。<br>' +
      '普通 zip：会把在线前置也下载好一起打包，离线也能用。<br>' +
      '写进清单的加载器版本：<b>' + esc(s.env.loaderVersion || '未填') + '</b>（顶部「' + esc(verLabel) + '」可改）</div>';
  }

  R.renderPack = renderPack;
})(globalThis);
