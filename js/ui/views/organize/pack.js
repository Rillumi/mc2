/* ===== 整理视图：右侧打包卡 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const R = (MC.render = MC.render || {});
  const { esc, icon, IC, fmtSize, adaptAdded } = R;

  function checkSummaryHtml(plan) {
    if(!plan)return '';
    const {summary:s,coverage:c}=plan;
    const blocks=[['error','明确错误',s.errors],['warning','警告',s.warnings],['pending','待确认',s.pending]];
    return '<div class="hintbox" role="status"><b>'+esc(s.label)+'</b><div>明确错误 '+s.errors+' · 警告 '+s.warnings+' · 待确认 '+s.pending+'</div>'+
      '<div>依据：本地 JAR '+c.local+' 个 · 已读取在线 JAR '+c.online+' 个 · Modrinth 精确版本 '+c.platform+' 个 · 原包在线模组 '+c.sourceOnline+' 项尚未展开</div>'+
      blocks.filter(([, ,n])=>n).map(([severity,label,n])=>'<details><summary>'+label+'（'+n+'）</summary>'+
        plan.findings.filter(f=>f.severity===severity).map(f=>'<div>'+esc(f.reason)+'</div>').join('')+'</details>').join('')+
      '<div>'+esc(c.limits.join('；'))+'。未发现问题仅指上述已检查的声明。</div></div>';
  }

  function renderPack(s) {
    const el = document.getElementById('pack');
    if (!el) return;

    const a = s.analysis;
    const picked = MC.selector.selectedRows(s, a);
    const added = s.deps.filter(d => d.added && d.status === 'ok' && d.version);
    const adapted = adaptAdded(s);
    const chain = s.plan ? s.plan.online.filter(d => !s.plan.directOnline.includes(d)) : [];
    const total = picked.length + added.length + adapted.length + chain.length;
    const packList = ((a && a.others) || []).filter(o => o.kind === 'resourcepack' || o.kind === 'shader');
    const packsOn = !!(s.includePacks && packList.length);
    const packBytes = packList.reduce((n, o) => n + (o.size || 0), 0);
    const hasOptional = picked.some(r => ((r.entry && r.entry.optionalDeps) || []).length);
    const size = picked.reduce((n, r) => n + (r.entry.size || 0), 0) +
      added.concat(adapted,chain).reduce((n, d) => {
        const f = d.version.files && d.version.files[0];
        return n + ((f && f.size) || 0);
      }, 0) + (packsOn ? packBytes : 0);
    const sourceOnline = (s.packSources || []).reduce((n, p) => n + (p.onlineList || []).length, 0);
    const hasContent = total + sourceOnline + (packsOn ? packList.length : 0);

    const open = s.deps.filter(d => !(d.added && d.status === 'ok' && d.version));
    const excluded = MC.selector.excludedGroups(s, a).length;

    const disabled = (!hasContent || s.busy) ? ' disabled' : '';
    const verLabel = s.env.loader === 'Fabric' ? 'Fabric Loader' : (s.env.loader + ' 版本');

    el.innerHTML =
      '<h3>打包成整合包</h3>' +
      '<div class="sum">包里 <b>' + total + '</b> 个模组 · 约 ' + fmtSize(size) +
      (added.length ? ' · 含 ' + added.length + ' 个前置' : '') +
      (adapted.length ? ' · 换 ' + adapted.length + ' 个版本' : '') +
      (chain.length ? ' · 间接前置 ' + chain.length + ' 个' : '') +
      (sourceOnline ? ' · 原包在线文件 ' + sourceOnline + ' 项' : '') +
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
        ? checkSummaryHtml(s.plan)
        : '<div class="hint err" style="margin:12px 0">' + (a
          ? '还没有能进包的模组。给不兼容的模组找适配版本，或在列表里恢复被排除的。'
          : '先把 mods 文件夹拖进来。') + '</div>') +

      (chain.length ? '<div class="hint">已补充间接前置：' + esc(chain.map(d=>d.project.title+' '+d.version.version_number+'（被 '+d.requiredBy.join('、')+' 需要）').join('；')) + '</div>' : '') +
      (s.plan ? '<button type="button" class="btn line sm" data-act="retryall">重新查询平台声明与依赖链</button>' : '') +
      (s.busy ? '<div class="loading"><span class="spinner"></span>' + esc(s.progress || '正在打包…') + '</div>' : '') +

      '<div class="pack-actions">' +
      '<button type="button" class="btn grad full" data-act="pack-pick"' + disabled + '>' +
      icon('<path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M4 16v4h16v-4"/>', '#fff') +
      '生成整合包</button>' +
      '<button type="button" class="btn line full" data-act="pack" data-format="manifest"' + (s.analysis ? '' : ' disabled') + '>' +
      icon(IC.book, '#7C63E8') + '生成下载清单</button>' +
      '</div>' +

      '<div class="hintbox">「生成整合包」会弹出格式选择：.mrpack / 离线 zip / CurseForge 包，点一行只生成那一份。<br>' +
      '「生成下载清单」只出 manifest.json + modlist.html（+说明），不含任何 jar。<br>' +
      'key 在「工具 → 设置」里填，只存本机。从整合包扫描进来的会带上 config、defaultconfigs、kubejs、emotes、资源包/光影和 options.txt（不带 PCL、存档和 ffmpeg）。<br>' +
      '写进清单的加载器版本：<b>' + esc(s.env.loaderVersion || '未填') + '</b>（顶部「' + esc(verLabel) + '」可改）</div>';
  }

  R.checkSummaryHtml = checkSummaryHtml;

  /* 选整合包格式：Modrinth 那种一行一个选项的弹窗 */
  function packPickHtml(s) {
    const hasKey = !!(MC.api.curseforge && MC.api.curseforge.hasKey());
    const row = (fmt, title, note, tag, off) =>
      '<button type="button" class="fmt-row" data-act="pack" data-format="' + fmt + '"' + (off ? ' disabled' : '') + '>' +
      '<span class="pk-ic">' + icon(IC.jar, '#7C63E8') + '</span>' +
      '<span class="pk-main"><b>' + title + '</b><small>' + note + '</small></span>' +
      (tag ? '<span class="pk-tag">' + tag + '</span>' : '') +
      '</button>';

    return '<div class="sheet packselect" role="dialog" aria-modal="true" aria-labelledby="pickTitle">' +
      '<header class="sheet-head">' +
      '<div class="sheet-title"><div><b id="pickTitle">选择整合包格式</b><small>点一行只生成这一份，不会一次出好几个</small></div></div>' +
      '<button type="button" class="icon-btn" data-act="close" aria-label="关闭">' +
      '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</header>' +
      '<div class="sheet-body"><div class="fmt-list">' +
      row('mrpack', '.mrpack', 'PCL 2.13+ / HMCL 直接导入，前置按清单在线下载', '推荐') +
      row('zip', '离线 zip', '前置也下载好放进 mods，解压就能用，不用联网', '离线') +
      row('curse', 'CurseForge 整合包', hasKey
        ? 'manifest.json + overrides，指纹反查，已进包的不重复下载'
        : '需要先在「工具 → 设置」里填 CurseForge 的 API key', hasKey ? 'CurseForge' : '需要 key', !hasKey) +
      '</div>' +
      '<p class="hintbox" style="margin:12px 0 0">' + (hasKey
        ? 'CurseForge 包：本地 jar 放 overrides/mods，清单只写没进包的 projectID/fileID。'
        : '没填 key 也能用前两个，CurseForge 包要先在「工具 → 设置」里填 key（只存本机）。') +
      '</div>' +
      '<footer class="sheet-foot"><button type="button" class="btn line sm" data-act="close">取消</button></footer>' +
      '</div>';
  }

  R.packPickHtml = packPickHtml;
  R.renderPack = renderPack;
})(globalThis);
