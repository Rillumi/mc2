/* ===== 工具视图：资源包顺序、日志、爱发电、下载页仓库 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const R = (MC.render = MC.render || {});
  const { esc, fmtSize, chosenOf, siteTag } = R;

  function orderedPacks(s) {
    const adv = s.packAdvice || {};
    const list = Array.isArray(adv.packs)
      ? adv.packs
      : ((s.analysis && s.analysis.others) || []).filter(o => o.kind === 'resourcepack');
    const pos = {};
    (s.rpOrder || []).forEach((uid, i) => { pos[uid] = i; });
    return list.slice().sort((a, b) => {
      const x = pos[a.uid] === undefined ? 1e9 : pos[a.uid];
      const y = pos[b.uid] === undefined ? 1e9 : pos[b.uid];
      return x - y;
    });
  }

  function rpRow(s, o, index, total) {
    const adv = s.packAdvice || {};
    const tips = (adv.byUid && adv.byUid[o.uid] && adv.byUid[o.uid].tips) || [];
    const meta = [
      o.packFormat ? '格式 ' + o.packFormat : '',
      fmtSize(o.size),
      o.assets && o.assets.length ? '覆盖 ' + o.assets.length.toLocaleString() + ' 个文件' : ''
    ].filter(Boolean).join(' · ');
    return '<div class="rprow">' +
      '<span class="rpnum">' + (index + 1) + '</span>' +
      '<div class="rpbody">' +
      '<div class="rpname">' + esc(o.fileName) +
      (o.project ? '<span class="tag src">Modrinth</span>' : '') + '</div>' +
      '<div class="rpmeta">' + esc(meta) + '</div>' +
      (o.description ? '<div class="rpdesc">' + esc(o.description) + '</div>' : '') +
      tips.map(t => '<div class="ript"><span>作者原话</span>' + esc(t) + '</div>').join('') +
      '</div>' +
      '<div class="rpacts">' +
      '<div class="rpbtns">' +
      '<button type="button" class="icon-btn sm" data-act="rp-up" data-uid="' + esc(o.uid) + '"' +
      (index === 0 ? ' disabled' : '') + ' aria-label="上移">↑</button>' +
      '<button type="button" class="icon-btn sm" data-act="rp-down" data-uid="' + esc(o.uid) + '"' +
      (index === total - 1 ? ' disabled' : '') + ' aria-label="下移">↓</button>' +
      '</div>' +
      (o.project && o.url ? '<a class="btn line xs" href="' + esc(o.url) + '" target="_blank" rel="noopener">项目页</a>' : '') +
      '</div></div>';
  }

  function rpCard(s) {
    const packs = orderedPacks(s);
    if (!packs.length) {
      return '<div class="vpanel toolcard"><div class="vhead"><h3>资源包顺序</h3></div>' +
        '<div class="vbody"><div class="hint">当前这份里没有资源包。拖入带材质包的文件夹后，这里会按优先级列出它们，并导出顺序文件。</div></div></div>';
    }
    const adv = s.packAdvice || {};
    const nameOf = uid => {
      const p = packs.find(x => x.uid === uid);
      return p ? p.fileName : '（不在本次清单里）';
    };

    const pg = MC.pager.slice('packs', packs.length);
    const pagePacks = packs.slice(pg.start, pg.end);
    const pagerHtml = MC.pager.html('packs', pg, { anchor: '#rpList', unit: '个资源包' });
    const rows = pagePacks.map((o, i) => rpRow(s, o, pg.start + i, packs.length)).join('');

    const rules = adv.order || [];
    const logic = '<div class="rplogic">' +
      '<b>排序依据</b>' +
      '<span>' +
      (rules.length
        ? '先用 Modrinth 正文里作者写明的上下关系（' + rules.length + ' 条）排出先后，没写到的保持扫描顺序。'
        : '没有从 Modrinth 正文找到排序说明，当前按扫描到的文件顺序排列；你可以按自己的需要上下调。') +
      '两个包改到同一个文件时，只有上面的生效。' +
      '</span></div>';

    const ignored = adv.ignored || [];
    const ignoredNote = ignored.length
      ? '<div class="rpconf"><b>规则互相冲突 ' + ignored.length + ' 条</b>' +
        ignored.map(r => '<div class="riptline">【' + esc(nameOf(r.above)) + '】要排在【' + esc(nameOf(r.below)) +
          '】上面，但和另一条规则对不上，这里没有硬调。</div>').join('') + '</div>'
      : '';

    const orderNote = rules.length
      ? '<div class="rptips"><b>已按作者说明排序</b>' + rules.map(r =>
        '<div class="riptline">【' + esc(nameOf(r.above)) + '】在【' + esc(nameOf(r.below)) + '】之上' +
        (r.url ? ' <a href="' + esc(r.url) + '" target="_blank" rel="noreferrer">来源</a>' : '') +
        '</div>').join('') + '</div>'
      : '';

    const dups = adv.dups || [];
    const dupsNote = dups.length
      ? '<div class="rpdups"><b>同款资源包的其它版本已隐藏</b>' + dups.map(d =>
        '<div class="riptline">保留【' + esc(d.keep.fileName) + '】；隐藏 ' +
        d.others.map(o => '【' + esc(o.fileName) + '】').join('、') +
        '。同款只留一个版本，免得自己和自己抢文件。</div>').join('') + '</div>'
      : '';

    const conf = (adv.conflicts || []).length
      ? '<div class="rpconf"><b>同文件冲突 ' + adv.conflicts.length + ' 对</b>' +
        adv.conflicts.slice(0, 8).map(c =>
          '<div class="riptline">' + esc(nameOf(c.a)) + ' 与 ' + esc(nameOf(c.b)) + ' 都改了 ' +
          c.count + ' 个文件，例如 <code>' + esc(c.samples[0] || '') + '</code>。上面的会盖住下面的。</div>').join('') +
        '</div>'
      : '<div class="rpconf ok"><b>没有发现资源包互相覆盖的文件</b><span class="hint">按文件路径逐条比对过，各改各的就不会冲突。</span></div>';

    const same = (adv.sameProject || []).length
      ? '<div class="rpsame"><b>可能装重了</b>' + adv.sameProject.map(x =>
        '<div class="riptline">模组「' + esc(x.modName) + '」和资源包「' + esc(x.packName) + '」是同一个 Modrinth 项目，通常只需要装其中一个。</div>').join('') +
        '</div>'
      : '';

    return '<div class="vpanel toolcard"><div class="vhead"><h3>资源包顺序</h3>' +
      '<span class="adnote">' + packs.length + ' 个' + (dups.length ? ' · 合并 ' + dups.length + ' 组同款' : '') + '</span>' +
      '<button type="button" class="btn line sm" data-act="rpexport-order">导出顺序清单</button>' +
      '<button type="button" class="btn line sm" data-act="rpexport-options">导出 options.txt 片段</button></div>' +
      '<div class="vbody"><div class="rpnum-note">越靠上，游戏里优先级越高；两个包改同一个文件时，只有上面的生效。</div>' +
      logic + orderNote + '<div class="rplist" id="rpList">' + rows + '</div>' + pagerHtml +
      dupsNote + ignoredNote + conf + same + '</div></div>';
  }

  function logCard(s) {
    const logs = s.logs || { findings: [] };
    const auto = '<div class="actions logauto">' +
      '<button type="button" class="btn grad sm" data-act="autolog"' + (s.logBusy ? ' disabled' : '') + '>' +
      (s.logBusy ? '正在读取…' : '自动读取最新日志') + '</button>' +
      '<span class="hint">读 .minecraft/logs/latest.log（或最新的 crash-report），不用自己拖。读不到再手动拖。</span></div>';

    if (!logs.name) {
      return '<div class="vpanel toolcard"><div class="vhead"><h3>日志诊断</h3></div>' +
        '<div class="minidrop" id="logDrop" data-drop="log" data-act="pick-log" role="button" tabindex="0">' +
        '<b>拖入 latest.log 或 crash-report</b>' +
        '<span>按行扫一遍，把「缺前置 / 重复 ID / Mixin 失败 / 找不到类」挑出来。</span></div>' +
        auto +
        '<div class="vfoot">日志只在本地读，不会上传；这里只做粗筛，不能替代看原文。</div></div>';
    }

    const f = logs.findings || [];
    const list = f.length
      ? f.map(x => '<div class="logf ' + x.sev + '">' +
        '<h4>' + esc(x.label) + '<span>' + x.count + '</span></h4>' +
        x.samples.map(s2 => '<code>' + esc(s2.text) + '</code>').join('') +
        (x.file ? '<small>' + esc(x.file) + ' · 第 ' + x.samples[0].n + ' 行附近</small>' : '') +
        '</div>').join('')
      : '<div class="hint">没有匹配到已知的问题模式。日志共 ' + logs.lines + ' 行，含 ' + logs.errors + ' 条 ERROR，可能要看原文。</div>';

    return '<div class="vpanel toolcard"><div class="vhead"><h3>日志诊断</h3>' +
      '<span class="adnote">' + esc(logs.name) + ' · ' + logs.lines + ' 行 · ' + logs.errors + ' 个 ERROR</span>' +
      '<button type="button" class="btn line sm" data-act="autolog"' + (s.logBusy ? ' disabled' : '') + '>' +
      (s.logBusy ? '读取中…' : '重新自动读取') + '</button>' +
      '<button type="button" class="btn line sm" data-act="pick-log">换一个日志</button>' +
      '<button type="button" class="btn line sm" data-act="logclear">清空</button></div>' +
      '<div class="vbody"><div class="loglist">' + list + '</div></div>' +
      '<div class="vfoot">' + esc(logs.path || '手动导入的日志') + '</div></div>';
  }

  /* ---------- 工具：下载页仓库 ---------- */
  function allLinks(s) {
    const out = [];
    Object.keys(s.links || {}).forEach(modId => {
      (s.links[modId] || []).forEach(l => out.push({
        modId: modId === '未归属' ? '' : modId,
        rowId: l.id || 0,
        url: l.url,
        note: l.note || '',
        site: l.site || '',
        at: l.at || 0
      }));
    });
    return out.sort((a, b) => b.at - a.at);
  }

  function entryById(s, id) {
    const a = s.analysis;
    if (!a) return null;
    const want = String(id || '').toLowerCase();
    for (const g of a.groups) {
      const row = chosenOf(s, g);
      if (!row) continue;
      const e = row.entry;
      if ([e.id, e.name, e.nameZh].some(x => String(x || '').toLowerCase() === want)) return e;
    }
    return null;
  }

  function afdianCard(s) {
    const a = s.afdian || { ready: false, at: 0, creators: [], busy: false, note: '', error: '' };
    const list = a.creators || [];
    const when = a.at ? new Date(a.at).toLocaleString('zh-CN', { hour12: false }) : '还没更新过';
    const status = a.busy
      ? (a.note || '正在更新…')
      : a.error
        ? a.error
        : a.ready
          ? '更新于 ' + when
          : '本地服务没启动，暂时读不到名单';
    const rows = list.map(c => {
      const n = (c.posts || []).length;
      return '<div class="afdrow">' +
        (c.avatar ? '<img class="afdava" src="' + esc(c.avatar) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
        '<div class="afdt"><a class="afdname" href="' + esc(c.home) + '" target="_blank" rel="noopener">' +
        esc(c.name || '未命名作者') + '</a>' +
        (c.doing ? '<small>' + esc(c.doing) + '</small>' : '') + '</div>' +
        '<span class="hint">' + n + ' 条发电帖</span>' +
        '<a class="btn line xs" href="' + esc(c.home) + '" target="_blank" rel="noopener">主页</a>' +
        '</div>';
    }).join('');

    return '<div class="vpanel toolcard">' +
      '<div class="vhead"><h3>我发电过的爱发电作者</h3>' +
      '<span class="adnote">' + list.length + ' 位 · ' + esc(status) + '</span></div>' +
      '<div class="vbody">' +
      '<div class="hint">名单来自你爱发电主页的「TA 发电的」，只保存公开主页、作者简介和帖子标题，不存金额。' +
      '模组详情里如果名字对得上，会直接出现「作者主页」按钮。</div>' +
      (rows || '<div class="hint">还没有数据。点下面的按钮抓一次；需要 data/afdian.json 里放登录后的 auth_token。</div>') +
      '<div class="actions" style="margin-top:8px">' +
      '<button type="button" class="btn grad sm" data-act="afdianrefresh"' + (a.busy ? ' disabled' : '') + '>' +
      (a.busy ? '更新中…' : '更新爱发电') + '</button>' +
      '<span class="hint">抓一次大约十几秒，会顺便拉到每位作者最近的发电帖。</span></div>' +
      '</div></div>';
  }

  function linkCard(s) {
    const db = s.db || { mode: 'local', ready: false, error: '' };
    const sites = (db.sites && db.sites.length) ? db.sites : MC.linksdb.FALLBACK_SITES;
    const list = allLinks(s);
    const ids = Object.keys(s.links || {}).length;
    const counts = {};
    list.forEach(l => { const k = l.site || 'other'; counts[k] = (counts[k] || 0) + 1; });
    const filter = s.siteFilter || 'all';
    const shown = filter === 'all' ? list : list.filter(l => (l.site || 'other') === filter);
    const whom = (id) => {
      const e = entryById(s, id);
      return e ? (e.nameZh || e.name || e.id) : (id || '未归属');
    };

    const badge = db.mode === 'db'
      ? '<span class="dbbadge"><i></i>已连 MySQL · ' + esc(db.dbName || 'modpilot') + '</span>'
      : '<span class="dbbadge off"><i></i>数据库未连接，先存浏览器</span>';

    const chips = '<div class="sitechips">' +
      [['all', '全部', list.length]].concat(sites.map(x => [x.key, x.label, counts[x.key] || 0]))
        .filter(x => x[0] === 'all' || x[2])
        .map(x => '<button type="button" data-act="siteset" data-site="' + esc(x[0]) +
          '" aria-pressed="' + (filter === x[0]) + '">' + esc(x[1]) +
          '<span class="n">' + x[2] + '</span></button>').join('') + '</div>';

    const tip = db.mode === 'db'
      ? '<div class="rpnum-note">存在本机 MySQL 的 modpilot.links 表里，换浏览器、清缓存都还在；按站点自动分类。'
      : '<div class="rpnum-note">数据库没连上' + (db.error ? '（' + esc(db.error) + '）' : '') +
        '，链接先存在浏览器里。填好项目目录下的 db.config.json（MySQL 账号密码），重启 启动.bat 就会自动切到数据库。</div>';

    const pg = MC.pager.slice('links', shown.length);
    const pageItems = shown.slice(pg.start, pg.end);
    const pagerHtml = MC.pager.html('links', pg, { anchor: '#linkList', unit: '条' });

    return '<div class="vpanel toolcard">' +
      '<div class="vhead"><h3>下载页仓库</h3>' + badge +
      '<span class="adnote">' + list.length + ' 条 · ' + ids + ' 个模组</span></div>' +
      '<div class="vbody">' + tip + chips +
      (shown.length
        ? '<div class="linklist" id="linkList">' + pageItems.map(l =>
          '<div class="linkitem"><span class="tag">' + esc(siteTag(l.url, l.site)) + '</span>' +
          '<span class="lm">' + esc(whom(l.modId)) + '</span>' +
          '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.note || l.url) + '</a>' +
          '<button type="button" class="icon-btn sm" data-act="linkdel" data-row="' + esc(l.rowId) +
          '" data-mod="' + esc(l.modId) + '" data-url="' + esc(l.url) + '" aria-label="删除">×</button></div>').join('') + '</div>' +
          pagerHtml
        : '<div class="hint">' + (list.length ? '这个站点下还没有存过链接。' : '还没有存过链接。') + '</div>') +
      '<div class="bulkbox">' +
      '<div class="bulk-label">批量导入 <small>一行一个，粘完点下面的按钮就行</small></div>' +
      '<textarea id="linkBulk" spellcheck="false" aria-label="批量导入下载页" placeholder="每行一条，用 | 分隔&#10;模组ID或名字 | 链接 | 备注&#10;例：jei | https://www.curseforge.com/minecraft/mc-mods/jei | CF 页面&#10;也可以只写：链接 | 备注（会存成「未归属」）"></textarea>' +
      '<div class="bulkrow"><button type="button" class="btn grad" data-act="linkbulk">批量存进仓库</button>' +
      '<span class="hint">站点（爱发电 / Modrinth / CurseForge / 网盘 / 作者网站…）按链接自动分类。</span></div>' +
      '</div>' +
      '</div></div>';
  }

  function renderTools(s) {
    const el = document.getElementById('toolsView');
    if (!el) return;
    el.innerHTML = '<div class="toolstack">' + rpCard(s) + logCard(s) + afdianCard(s) + linkCard(s) + '</div>';
  }

  R.orderedPacks = orderedPacks;
  R.renderTools = renderTools;
})(globalThis);
