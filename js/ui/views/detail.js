/* ===== 详情抽屉：模组 / 资源包详情与各小节 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const R = (MC.render = MC.render || {});
  const { esc, tile, icon, IC, fmtSize, picker, siteTag } = R;

  function depLine(info) {
    const map = {
      env: ['ok', '游戏自带', ''],
      local: ['ok', '本地已有', info.version ? '本地版本 ' + info.version : '版本未知'],
      version: ['warn', '版本不够', '需要 ' + info.range + '，本地 ' + (info.version || '未知')],
      missing: ['bad', '缺失', info.range ? '需要 ' + info.range : '需要它但没有']
    };
    const [cls, word, note] = map[info.state] || ['', info.state, ''];
    return '<div class="dline">' +
      '<span class="tag ' + cls + '">' + esc(word) + '</span>' +
      '<b>' + esc(info.modId) + '</b>' +
      '<small>' + esc(note) + (info.state === 'local' && info.by ? '（' + esc(info.by) + '）' : '') +
      (info.mandatory ? '' : ' · 可选兼容') + '</small>' +
      '</div>';
  }

  /* ---------- 资源包 / 光影详情 ---------- */
  function otherDetailHtml(s) {
    const a = s.analysis;
    const uid = String(s.detail).slice(2);
    const o = a && (a.others || []).find(x => x.uid === uid);
    if (!o) return '';

    const isPack = o.kind === 'resourcepack';
    const counts = o.assetCounts || {};
    const ns = {};
    (o.assets || []).forEach(p => {
      const m = p.match(/^assets\/([^/]+)\//);
      if (m) ns[m[1]] = (ns[m[1]] || 0) + 1;
    });
    const nsTop = Object.keys(ns).sort((x, y) => ns[y] - ns[x]).slice(0, 10);

    let body = '';
    if (isPack) {
      body += '<div class="dsec-label">覆盖了多少东西</div>' +
        '<div class="statline">' +
        '<span><b>' + (o.assets ? o.assets.length.toLocaleString() : 0) + '</b> 个文件</span>' +
        '<span>贴图 <b>' + (counts.texture || 0).toLocaleString() + '</b></span>' +
        '<span>模型 <b>' + (counts.model || 0).toLocaleString() + '</b></span>' +
        '<span>语言 <b>' + (counts.lang || 0).toLocaleString() + '</b></span>' +
        '<span>声音 <b>' + (counts.sound || 0).toLocaleString() + '</b></span>' +
        '</div>' +
        (nsTop.length ? '<div class="nslist">' + nsTop.map(n =>
          '<span class="tag">' + esc(n) + ' · ' + ns[n].toLocaleString() + '</span>').join('') + '</div>' : '');

      const others = (a.others || []).filter(x => x.kind === 'resourcepack' && x.uid !== o.uid);
      if (!others.length) {
        body += '<div class="dsec-label">和别的资源包对比</div><div class="hint">目前只有这一个资源包，没法对比。</div>';
      } else {
        const items = others.map(x => ({
          value: x.uid,
          current: s.rpPair[o.uid] || '',
          text: x.fileName,
          meta: (x.assets ? x.assets.length.toLocaleString() + ' 个文件' : '')
        }));
        const pair = s.rpPair[o.uid];
        const other = pair ? others.find(x => x.uid === pair) : null;
        let cmp = '';
        if (other) {
          const bset = new Set((other.assets || []).map(x => x.toLowerCase()));
          const hit = (o.assets || []).filter(x => bset.has(x.toLowerCase()));
          cmp = hit.length
            ? '<div class="warnbox"><div class="warnbox-head">' + icon(IC.alert, '#DE5E84') +
              '和「' + esc(other.fileName) + '」重叠 ' + hit.length.toLocaleString() + ' 个文件</div>' +
              '<div class="wline"><span>重叠 = 两个包都替换同一个文件，游戏里只有优先级高的那个生效（资源包列表越靠上越高）。</span></div>' +
              '<div class="pathlist">' + hit.slice(0, 10).map(p => '<code>' + esc(p) + '</code>').join('') +
              (hit.length > 10 ? '<span>还有 ' + (hit.length - 10).toLocaleString() + ' 个…</span>' : '') + '</div></div>'
            : '<div class="hint okline">两份包完全没有重叠，改的是不同文件，可以同时启用。</div>';
        }
        body += '<div class="dsec-label">和别的资源包对比</div>' +
          picker(s, 'p:' + o.uid, other ? other.fileName : '选一个资源包', items, 'detail-picker') + cmp;
      }
    } else if (o.kind === 'shader') {
      body += '<div class="dsec-label">光影</div>' +
        '<div class="dmeta"><span>' + (o.shaderFiles ? o.shaderFiles + ' 个 shader 文件' : '没有可读的文件列表') + '</span>' +
        '<span>光影一次只会启用一个，多个光影包不冲突，选一个用就行。</span></div>';
    }

    return '<div class="sheet detail" role="dialog" aria-modal="true" aria-label="资源包详情">' +
      '<div class="sheet-head">' +
      '<div class="sheet-title">' + tile(o.fileName, true) +
      '<div><b>' + esc(o.fileName) + '</b><small>' +
      (isPack ? '资源包' : o.kind === 'shader' ? '光影' : '其他') + ' · ' + fmtSize(o.size) + '</small></div></div>' +
      '<button type="button" class="icon-btn" data-act="close" aria-label="关闭">' + icon(IC.close) + '</button>' +
      '</div>' +
      '<div class="sheet-body">' +
      '<div class="dsec-label">文件</div>' +
      '<div class="dmeta"><b>' + esc(o.fileName) + '</b><span>' + fmtSize(o.size) +
      (isPack ? ' · pack_format ' + esc(o.packFormat || '未知') : '') + '</span></div>' +
      (o.description ? '<div class="descbox">' + esc(o.description) + '</div>' : '') +
      body +
      afdianSection({ name: o.fileName, id: (o.fileName || '').replace(/\.(zip|jar)$/i, '') }) +
      '</div>' +
      '<div class="sheet-foot"><button type="button" class="btn grad" data-act="close">看完了</button></div>' +
      '</div>';
  }

  /* ---------- 简介：原文 + 机翻切换 ---------- */
  function descSection(s, gid, e) {
    if (!e.description) {
      return '<div class="dsec-label">这个模组是干什么的</div>' +
        '<div class="hint">这个 jar 里没写简介。说明可能在 Modrinth 页面或作者的网盘里，下面「找资源」可以直接跳过去。</div>';
    }
    const lang = s.descLang || 'zh';
    const tr = s.descTr && s.descTr[gid];
    const tabs = '<div class="desc-tabs">' +
      '<button type="button" data-act="desclang" data-lang="zh" aria-pressed="' + (lang === 'zh') + '">中文（机翻）</button>' +
      '<button type="button" data-act="desclang" data-lang="en" aria-pressed="' + (lang === 'en') + '">作者原文</button>' +
      '</div>';

    let body = '';
    let note = '';
    if (lang === 'en') {
      body = '<div class="descbox raw">' + esc(e.description) + '</div>';
      note = '这是 jar 里作者写的原文。';
    } else if (tr && tr.status === 'ok') {
      body = '<div class="descbox">' + esc(tr.text) + '</div>';
      note = '机翻只作参考，模组名和专有名词可能翻歪；想看原句点「作者原文」。';
    } else if (tr && tr.status === 'error') {
      body = '<div class="descbox raw">' + esc(e.description) + '</div>';
      note = '机翻没成功（' + (tr.reason || '网络问题') + '），先显示原文；点「中文（机翻）」可以重试。';
    } else {
      body = '<div class="descbox raw">' + esc(e.description) + '</div>';
      note = '正在机翻…（第一次要连一下在线翻译接口，文本会发给 Google 翻译或备用源）';
    }

    return '<div class="dsec-label">这个模组是干什么的<span class="dsrc">来源：jar 里作者写的说明</span></div>' +
      tabs + body + '<div class="descnote">' + esc(note) + '</div>';
  }

  /* ---------- Modrinth 完整简介 ---------- */
  function mrSection(s, gid, e) {
    const m = (s.mr || {})[gid];
    const head = '<div class="dsec-label">Modrinth 简介<span class="dsrc">来源：Modrinth 项目正文</span></div>';
    if (!m || m.status === 'loading') {
      return head + '<div class="hint">正在从 Modrinth 拉作者写的完整介绍（比 jar 里那段长）…</div>';
    }
    if (m.status === 'notfound') {
      return head + '<div class="hint">Modrinth 上没找到这个项目（可能只在 CurseForge 或爱发电发布），补不了正文。</div>';
    }
    if (m.status === 'error') {
      return head + '<div class="hint">读取失败：' + esc(m.reason || '网络问题') + '。不影响本地整理。</div>';
    }

    const lang = s.bodyLang || 'zh';
    const tr = (s.bodyTr || {})[gid];
    const tabs = '<div class="desc-tabs">' +
      '<button type="button" data-act="bodylang" data-lang="zh" aria-pressed="' + (lang === 'zh') + '">中文（机翻）</button>' +
      '<button type="button" data-act="bodylang" data-lang="en" aria-pressed="' + (lang === 'en') + '">英文原文</button>' +
      '</div>';

    let body = '';
    let note = '';
    if (lang === 'en' || !tr || tr.status !== 'ok') {
      body = '<div class="descbox raw">' + esc(m.text || '（空）') + '</div>';
      if (lang === 'zh') note = tr && tr.status === 'error'
        ? '机翻没成功（' + (tr.reason || '网络问题') + '），先看英文；点「中文（机翻）」可以重试。'
        : '正在机翻…（长文要分几段翻译，稍等一会儿）';
      else note = '这是 Modrinth 上的英文原文。';
    } else {
      body = '<div class="descbox">' + esc(tr.text) + '</div>';
      note = tr.partial
        ? '机翻只作参考；网络不稳，有几段没翻出来（保留英文原文），点「中文（机翻）」可以重试。'
        : '机翻只作参考；想看原句点「英文原文」。';
    }

    const stats = [];
    if (m.downloads) stats.push('下载 ' + Number(m.downloads).toLocaleString());
    if (m.follows) stats.push('关注 ' + Number(m.follows).toLocaleString());
    if (m.updated) stats.push('更新于 ' + String(m.updated).slice(0, 10));

    return head +
      '<div class="mrhead">' +
        (m.url ? '<a class="btn line xs" href="' + esc(m.url) + '" target="_blank" rel="noopener">打开 Modrinth 项目页</a>' : '') +
        (stats.length ? '<span class="hint">' + esc(m.title || '') + ' · ' + esc(stats.join(' · ')) + '</span>' : '') +
      '</div>' + tabs + body + '<div class="descnote">' + esc(note) + '</div>';
  }

  /* 存的下载页按统一判重归属：库里的写法（大小写、下划线、中文名）可能与 jar 里的 modId 不同 */
  const LINK_LEVELS = [MC.identity.LEVELS.MOD, MC.identity.LEVELS.NAME];
  function savedLinksOf(s, e) {
    const out = [];
    const zh = MC.identity.normalizeName(e.nameZh || '');
    Object.keys(s.links || {}).forEach(key => {
      if (key === '未归属') return;
      const sameZh = zh.length >= 4 && MC.identity.normalizeName(key) === zh;
      if (!sameZh && !MC.identity.same({ id: key, name: key }, e, LINK_LEVELS)) return;
      (s.links[key] || []).forEach(l => {
        if (out.some(x => x.url === l.url)) return;
        out.push(Object.assign({}, l, { modKey: key }));
      });
    });
    return out;
  }

  function detailHtml(s) {
    const a = s.analysis;
    if (String(s.detail || '').indexOf('o:') === 0) return otherDetailHtml(s);
    const group = a && a.groups.find(g => g.id === s.detail);
    if (!group) return '';
    const rows = MC.selector.sortRows(group.usableRows, s.env);
    const chosen = rows.find(r => r.uid === s.selection[group.id]) || rows[0];
    const e = chosen ? chosen.entry : group.rows[0].entry;

    const items = rows.map(r => ({
      value: r.uid, current: chosen ? chosen.uid : '', text: MC.selector.label(r.entry), meta: r.entry.fileName
    }));
    const mrl = 'https://modrinth.com/mod/' + encodeURIComponent(String(e.id || '').toLowerCase());
    // 有 MC百科条目地址就用它；没查到中文名就退回站内搜索（modId 比中文名更容易命中）
    const mcmod = e.nameZhFrom || ('https://www.mcmod.cn/s?key=' + encodeURIComponent(e.id || e.name || ''));

    const depInfo = (chosen && chosen.depInfo) ? chosen.depInfo : [];
    const optCount = depInfo.filter(d => !d.mandatory).length;
    const depList = chosen && depInfo.length
      ? '<div class="dsec-label">前置（' +
        (optCount ? '必需 ' + (depInfo.length - optCount) + ' / 可选兼容 ' + optCount : depInfo.length) + '）</div>' +
        depInfo.map(depLine).join('') +
        (optCount ? '<div class="hint">带「可选兼容」的项不是启动必需，是作者给联动/兼容留的口子；不装也能正常运行。</div>' : '')
      : (chosen ? '<div class="dsec-label">前置</div><div class="hint">这个模组没有声明前置。</div>' : '');

    const bad = !chosen
      ? '<div class="warnbox"><div class="warnbox-head">' + icon(IC.alert, '#DE5E84') + '不能进包</div>' +
        '<div class="wline"><span>' + esc(group.rows[0].entry.error || '加载器或游戏版本不符') + '</span></div></div>'
      : '';

    const note = chosen
      ? '<div class="hint dnote">『语义冲突』（两个模组改同一个方块、抢同一个配方）没法从 jar 里读出来，' +
        '只能靠进游戏看日志。这里能确认的是加载器、游戏版本、前置是否齐、前置版本够不够、有没有 ID 撞车。</div>'
      : '';

    const savedLinks = savedLinksOf(s, e);
    const links = '<div class="dsec-label">我存的下载页（' + savedLinks.length + '）</div>' +
      '<div class="linkbox">' +
      savedLinks.map(l =>
        '<div class="lrow"><span class="tag">' + esc(siteTag(l.url, l.site)) + '</span>' +
        '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
        esc(l.note || l.url) + '</a>' +
        '<button type="button" class="icon-btn sm" data-act="linkdel" data-row="' + esc(l.id || 0) +
        '" data-mod="' + esc(l.modKey || e.id) + '" data-url="' + esc(l.url) + '" aria-label="删除">×</button></div>').join('') +
      '<div class="ladd">' +
      '<input id="linkUrl" type="url" placeholder="Modrinth / CurseForge / 爱发电 / 网盘链接">' +
      '<input id="linkNote" placeholder="备注（可选）">' +
      '<button type="button" class="btn line xs" data-act="linkadd" data-id="' + esc(e.id) +
      '" data-name="' + esc(e.name || '') + '">存下</button>' +
      '</div>' +
      '<div class="hint">' + (s.db && s.db.mode === 'db'
        ? '存在本机 MySQL 里，换浏览器也还在，按站点自动分类。'
        : '数据库没连上，先存在浏览器里；填好 db.config.json 后重启会自动搬进 MySQL。') +
      '要一次存很多个，去「工具 → 下载页仓库」批量导入。</div>' +
      '<div class="actions"><button type="button" class="btn line xs" data-act="gotools">打开批量导入</button></div>' +
      '</div>';

    const mproj = MC.flowCommon.projectForEntry(s, e, group);

    return '<div class="sheet detail" role="dialog" aria-modal="true" aria-label="模组详情">' +
      '<div class="sheet-head">' +
        '<div class="sheet-title">' + tile(e.nameZh || e.name || group.displayId, true, mproj && mproj.icon_url) +
        '<div><b>' + esc(e.nameZh || e.name || group.displayId) +
        (e.nameZh && e.name ? '<i class="alias">' + esc(e.name) + '</i>' : '') +
        (e.nameZhFrom ? ' <a class="zsrc" href="' + esc(e.nameZhFrom) + '" target="_blank" rel="noopener">中文名来自 MC百科</a>' : '') +
        (!e.nameZh ? ' <button type="button" class="zsrc" data-act="zh-recheck" data-group="' + esc(group.id) + '">没有中文名？重新查</button>' : '') +
        '</b><small>' + esc(e.version || '版本未知') +
        ' · ' + esc(e.loader || '?') + ' · ' + fmtSize(e.size) + '</small></div></div>' +
        '<button type="button" class="icon-btn" data-act="close" aria-label="关闭">' + icon(IC.close) + '</button>' +
      '</div>' +
      '<div class="sheet-body">' +
        '<div class="dsec-label">文件</div>' +
        '<div class="dmeta"><b>' + esc(e.fileName || '—') + '</b><span>' + fmtSize(e.size) + ' · modId ' +
        esc(e.id || '—') + '</span><span>MC 要求：' + esc(e.mcRange || e.mc || '未声明') + '</span>' +
        '<div class="fpath-row"><span class="fpath">' + esc(e.filePath || e.fileName || '—') + '</span>' +
        '<button type="button" class="btn line xs" data-act="copy-file" data-file="' +
        esc(e.filePath || e.fileName || '') + '">复制路径</button></div></div>' +
        descSection(s, group.id, e) +
        mrSection(s, group.id, e) +
        recipeHtml(e) +
        (chosen ? updateSection(s, group.id, e) : '') +
        (rows.length > 1 ? '<div class="dsec-label">这个模组有 ' + rows.length + ' 份，进包的是</div>' +
          picker(s, 'g:' + group.id, MC.selector.label(chosen.entry), items, 'row-picker detail-picker') : '') +
        bad + depList + links + (chosen ? afdianSection(e) : '') + (chosen ? sourceSection(s, e) : '') + (chosen ? compatSection(s, e) : '') + note +
      '</div>' +
      '<div class="sheet-foot">' +
        '<button type="button" class="btn line" data-act="toggle-exclude" data-group="' + esc(group.id) + '">' +
        (s.excluded[group.id] ? '恢复进包' : '不要这个') + '</button>' +
        '<a class="btn line" href="' + esc(mrl) + '" target="_blank" rel="noopener">' + icon(IC.link) + 'Modrinth 页面</a>' +
        '<a class="btn line" href="' + esc(mcmod) + '" target="_blank" rel="noopener" title="' +
        esc(e.nameZhFrom ? 'MC百科条目' : '在 MC百科搜索') + '">' + icon(IC.link) + '在 MC百科查看</a>' +
        '<button type="button" class="btn grad" data-act="close">看完了</button>' +
      '</div>' +
      '</div>';
  }

  /* ---------- 详情里的小节 ---------- */
  function recipeHtml(e) {
    if (typeof e.recipes !== 'number') return '';
    if (e.recipes) {
      return '<div class="dsec-label">配方</div><div class="hint">jar 里自带 <b>' + e.recipes +
        '</b> 个配方文件。这类方块/物品通常能在生存里按配方做出来。</div>';
    }
    return '<div class="dsec-label">配方</div><div class="hint">jar 里没找到配方文件。可能是创造模式专用、靠指令或结构获取，' +
      '或者配方写在别的模组里——建筑类模组里这种情况很常见。</div>';
  }

  function updateSection(s, gid, e) {
    const u = s.updates[gid];
    let chip = '';
    let text = '还没查。点一下去 Modrinth 看看有没有新版本。';
    if (u) {
      if (u.status === 'checking') { chip = '<span class="tag">查更新…</span>'; text = '正在查…'; }
      else if (u.status === 'newer') { chip = '<span class="tag warn">有新版 ' + esc(u.latest) + '</span>'; text = '本地 ' + esc(u.installed || e.version || '?') + '，Modrinth 最新 ' + esc(u.latest) + '。'; }
      else if (u.status === 'current') { chip = '<span class="tag ok">已是最新</span>'; text = 'Modrinth 上当前环境的最新版是 ' + esc(u.latest || '') + '。'; }
      else if (u.status === 'notfound') { chip = '<span class="tag">Modrinth 未收录</span>'; text = '这个 modId 在 Modrinth 查不到，可能只在 CurseForge 或作者自己的页面发布。'; }
      else if (u.status === 'nomatch') { chip = '<span class="tag">没有适配版本</span>'; text = '项目在 Modrinth，但没有 ' + esc(s.env.loader) + ' ' + esc(s.env.mc) + ' 的版本。'; }
      else if (u.status === 'skip') { chip = '<span class="tag">已跳过</span>'; text = '这个模组在当前加载器/游戏版本下不可用，没查更新。'; }
      else { chip = '<span class="tag bad">查询失败</span>'; text = friendlyReason(u.reason); }
    }
    return '<div class="dsec-label">更新</div><div class="uprow">' + chip + '<span class="hint">' + text + '</span></div>' +
      '<div class="actions upacts">' +
      '<button type="button" class="btn line xs" data-act="checkupdate" data-group="' + esc(gid) + '">检查这个模组</button>' +
      (u && u.url ? '<a class="btn line xs" href="' + esc(u.url) + '" target="_blank" rel="noopener">Modrinth 项目页</a>' : '') +
      '</div>';
  }

  function friendlyReason(reason) {
    const r = String(reason || '');
    if (/Failed to fetch|NetworkError|Load failed|ERR_/i.test(r)) {
      return '连不上 Modrinth——可能是网络、代理或浏览器拦截。本地整理和打包不受影响。';
    }
    if (/429|too many/i.test(r)) return 'Modrinth 请求太频繁被限流，过一会儿再点「检查更新」。';
    if (/50\d/.test(r)) return 'Modrinth 服务器暂时不可用，过一会儿再试。';
    return esc(r || '网络问题');
  }

  /* ---------- 爱发电：匹配到的作者主页 / 相关发电帖 ---------- */
  function afdianSection(e) {
    let hits = [];
    try { hits = MC.afdian.find(e, 3); } catch (err) { hits = []; }
    if (!hits.length) return '';
    const rows = hits.map(h => {
      const c = h.creator;
      return '<div class="afdrow">' +
        '<span class="tag">爱发电</span>' +
        (c.avatar ? '<img class="afdava" src="' + esc(c.avatar) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
        '<div class="afdt">' +
        '<a class="afdname" href="' + esc(c.home) + '" target="_blank" rel="noopener">' + esc(c.name || '作者主页') + '</a>' +
        (c.doing ? '<small>' + esc(c.doing) + '</small>' : '') +
        (h.post ? '<a class="afdpost" href="' + esc(h.post.url) + '" target="_blank" rel="noopener">相关发电帖：' +
          esc(h.post.title || '打开帖子') + '</a>' : '') +
        '</div>' +
        '<a class="btn line xs" href="' + esc(c.home) + '" target="_blank" rel="noopener">作者主页</a>' +
        '</div>';
    }).join('');
    return '<div class="dsec-label">爱发电<span class="dsrc">你发电过的作者</span></div>' + rows +
      '<div class="hint">按模组名/中文名匹配到的作者；公开主页可以直接打开，付费内容还是要在爱发电里解锁。</div>';
  }

  function sourceSection(s, e) {
    const q = String(e.name || e.id || '');
    if (!q) return '';
    const af = MC.links.afdianSearch(q);
    const bing = 'https://www.bing.com/search?q=' + encodeURIComponent(q + ' Minecraft 下载');
    return '<div class="dsec-label">找资源</div>' +
      '<div class="actions">' +
      '<a class="btn line sm" href="' + esc(af) + '" target="_blank" rel="noopener">爱发电搜「' + esc(q) + '」</a>' +
      '<a class="btn line sm" href="' + esc(bing) + '" target="_blank" rel="noopener">Bing 搜下载页</a>' +
      '</div>' +
      '<div class="hint">你发电过的作者会出现在上面的「爱发电」小节，名字对得上就能直接跳作者主页；没匹配到的再用站内搜索。很多作者的发电页会写网盘和提取码；找到后把链接和备注存到下面的「我存的下载页」，下次就不用重找。</div>';
  }

  function compatSection(s, e) {
    const q = String(e.name || e.id || '');
    if (!q) return '';
    const bing = 'https://www.bing.com/search?q=' + encodeURIComponent(q + ' Minecraft 兼容补丁 compatibility patch');
    const cf = MC.links.curseforgeSearch(q + ' compat', s.env.mc);
    const mr = MC.links.modrinthSearch(q + ' compatibility', s.env);
    return '<div class="dsec-label">找兼容补丁</div>' +
      '<div class="actions">' +
      '<a class="btn line sm" href="' + esc(bing) + '" target="_blank" rel="noopener">Bing 搜「兼容补丁」</a>' +
      '<a class="btn line sm" href="' + esc(cf) + '" target="_blank" rel="noopener">CurseForge 搜 compat</a>' +
      '<a class="btn line sm" href="' + esc(mr) + '" target="_blank" rel="noopener">Modrinth 搜 compatibility</a>' +
      '</div>' +
      '<div class="hint">兼容补丁一般是第三方单独发布的 jar，名字里常带 compatibility / compat / patch。找到后把链接存到下面的「我存的下载页」，以后不用重找。工具没法自动认定哪个补丁适用于你这套组合。</div>';
  }

  R.detailHtml = detailHtml;
})(globalThis);
