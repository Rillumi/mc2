/* ===== 对比视图：两个整合包差什么 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const R = (MC.render = MC.render || {});
  const { esc, tile, fmtSize, scanBar } = R;

  function diffDropHtml() {
    return '<div class="vpanel"><div class="vhead"><h3>对比两个整合包</h3></div>' +
      '<div class="minidrop" id="diffDrop" data-drop="diff" data-act="pick-diff" role="button" tabindex="0">' +
      '<b>拖入另一个整合包的 mods 文件夹</b>' +
      '<span>按 modId 对比模组：共有、只在当前、只在另一个、版本不同；资源包和光影按文件名对比。当前这份不会被改动。</span></div>' +
      '<div class="vfoot">只会读 jar 里的元数据，不上传文件；对比结果不保存，换文件夹重来就行。</div></div>';
  }

  const DIFF_GROUPS = {
    onlyB: { title: '只在另一个包', hint: '当前包缺这些，想补进来先确认加载器和游戏版本', cls: 'gb' },
    verdiff: { title: '版本不同', hint: '同一个模组，两边版本号不一样', cls: 'gw' },
    onlyA: { title: '只在当前包', hint: '另一个包没有这些，保留就行', cls: 'ga' },
    same: { title: '两边一致', hint: '模组和版本都对得上', cls: 'gs' }
  };

  function dGroupHead(cls, title, n, hint) {
    return '<div class="dgroup ' + cls + '"><b>' + title + '</b><span>' + n + '</span><small>' + hint + '</small></div>';
  }

  function verTag(v, cls) {
    const s = String(v || '').trim();
    return s
      ? '<span class="tag' + (cls ? ' ' + cls : '') + '">' + esc(s) + '</span>'
      : '<span class="dno">版本未知</span>';
  }

  function dSide(entry, version, changed) {
    if (!entry) return '<div class="dcell muted">—</div>';
    return '<div class="dcell' + (changed ? ' change' : '') + '">' +
      verTag(version, changed ? 'warn' : '') +
      (entry.size ? '<small>' + fmtSize(entry.size) + '</small>' : '') +
      '</div>';
  }

  function diffRow(it) {
    const x = it.x;
    const k = it.kind;
    const a = k === 'onlyB' ? null : (k === 'onlyA' ? x.entry : x.a);
    const b = k === 'onlyA' ? null : (k === 'onlyB' ? x.entry : x.b);
    const va = k === 'verdiff' ? x.va : (a && a.version);
    const vb = k === 'verdiff' ? x.vb : (b && b.version);
    const e = a || b;
    const tag = k === 'verdiff' ? '<span class="tag warn">版本不同</span>'
      : k === 'onlyA' ? '<span class="tag">只在当前包</span>'
        : k === 'onlyB' ? '<span class="tag src">只在另一个包</span>'
          : '<span class="tag ok">一致</span>';
    const mob = '当前 ' + (va || '—') + ' · 另一个 ' + (vb || '—');
    return '<div class="drow' + (k === 'verdiff' ? ' dv' : '') + '">' +
      '<div class="dmod">' + tile(x.name, true) +
      '<div class="t"><b>' + esc(x.name) + '</b><small>' + esc(x.id || '') +
      (e && e.size ? ' · ' + fmtSize(e.size) : '') + '</small>' +
      '<small class="dmod-m">' + esc(mob) + '</small></div></div>' +
      dSide(a, va, k === 'verdiff') + dSide(b, vb, k === 'verdiff') +
      '<div class="dstate">' + tag + '</div></div>';
  }

  function diffItems(res, filter) {
    const out = [];
    const put = (kind, arr) => arr.forEach(x => out.push({ kind, x }));
    if (filter === 'same') put('same', res.common.filter(x => x.same));
    else if (filter === 'onlyB') put('onlyB', res.onlyB);
    else if (filter === 'verdiff') put('verdiff', res.versionDiff);
    else if (filter === 'onlyA') put('onlyA', res.onlyA);
    else {
      put('onlyB', res.onlyB);
      put('verdiff', res.versionDiff);
      put('onlyA', res.onlyA);
    }
    return out;
  }

  function packItems(pk) {
    const out = [];
    pk.onlyA.forEach(x => out.push({ kind: 'onlyA', x }));
    pk.onlyB.forEach(x => out.push({ kind: 'onlyB', x }));
    pk.common.forEach(x => out.push({ kind: 'both', x }));
    return out;
  }

  function packRow(it) {
    const x = it.x;
    const a = it.kind === 'onlyB' ? null : (it.kind === 'onlyA' ? x.entry : x.a);
    const b = it.kind === 'onlyA' ? null : (it.kind === 'onlyB' ? x.entry : x.b);
    const e = a || b;
    const cell = en => !en
      ? '<div class="dcell muted">—</div>'
      : '<div class="dcell"><span class="tag">' + ((en.assets && en.assets.length) || 0).toLocaleString() + ' 个文件</span>' +
        '<small>' + fmtSize(en.size) + '</small></div>';
    const tag = it.kind === 'both'
      ? (x.same ? '<span class="tag ok">一样</span>' : '<span class="tag warn">不一样</span>')
      : it.kind === 'onlyA' ? '<span class="tag">只在当前包</span>' : '<span class="tag src">只在另一个包</span>';
    const mob = '当前 ' + (a ? ((a.assets && a.assets.length) || 0) + ' 个文件' : '—') +
      ' · 另一个 ' + (b ? ((b.assets && b.assets.length) || 0) + ' 个文件' : '—');
    return '<div class="drow">' +
      '<div class="dmod">' + tile(x.name, true) +
      '<div class="t"><b>' + esc(x.name) + '</b><small>' +
      (e && e.kind === 'shader' ? '光影' : '资源包') +
      (e && e.size ? ' · ' + fmtSize(e.size) : '') + '</small>' +
      '<small class="dmod-m">' + esc(mob) + '</small></div></div>' +
      cell(a) + cell(b) + '<div class="dstate">' + tag + '</div></div>';
  }

  function renderDiff(s) {
    const el = document.getElementById('diffView');
    if (!el) return;
    const d = s.diff || { mods: [] };
    if (!d.mods.length) { el.innerHTML = scanBar(s) + diffDropHtml(); return; }

    const res = MC.diff.compare(s.mods, d.mods);
    const c = res.counts;
    const filter = s.diffFilter || 'diff';
    const sameN = res.common.length - c.versionDiff;
    const allN = c.onlyA + c.onlyB + c.versionDiff;

    const head = '<div class="vhead"><h3>对比结果</h3>' +
      '<small class="dhint">当前包 ' + s.mods.length + ' 个模组 · 另一个包 ' + d.mods.length + ' 个模组</small>' +
      '<button type="button" class="btn line sm" data-act="pick-diff">换一个文件夹</button>' +
      '<button type="button" class="btn line sm" data-act="diffclear">清空对比</button></div>';

    const chip = (id, n, label) => '<button type="button" class="dchip" data-act="diffFilter" data-df="' + id + '"' +
      (filter === id ? ' aria-pressed="true"' : '') + '><b>' + n + '</b>' + label + '</button>';
    const chips = '<div class="dtoolbar">' +
      chip('diff', allN, '全部差异') +
      chip('onlyB', c.onlyB, '只在另一个包') +
      chip('verdiff', c.versionDiff, '版本不同') +
      chip('onlyA', c.onlyA, '只在当前包') +
      chip('same', sameN, '两边一致') + '</div>';

    const warning = !s.mods.length
      ? '<div class="hint err" style="padding:0 20px">当前包还没有导入，先在「整理」里拖入一个 mods 文件夹。</div>'
      : '';

    const items = diffItems(res, filter);
    const pg = MC.pager.slice('diff', items.length);
    const counts = { onlyB: c.onlyB, verdiff: c.versionDiff, onlyA: c.onlyA, same: sameN };
    let body;
    if (!items.length) {
      body = '<div class="dempty">这一组没有条目</div>';
    } else {
      body = '<div class="dthead"><span>模组</span><span>当前包</span><span>另一个包</span><span>状态</span></div>';
      let last = '';
      items.slice(pg.start, pg.end).forEach(it => {
        if (it.kind !== last) {
          last = it.kind;
          const g = DIFF_GROUPS[it.kind];
          body += dGroupHead(g.cls, g.title, counts[it.kind], g.hint);
        }
        body += diffRow(it);
      });
    }
    const pager = MC.pager.html('diff', pg, { anchor: '#diffTable', unit: '个模组' });

    // 资源包 / 光影对比
    const pk = MC.diff.comparePacks((s.analysis && s.analysis.others) || [], d.others || []);
    let packSec = '';
    if (pk.count) {
      const pitems = packItems(pk);
      const ppg = MC.pager.slice('diffpacks', pitems.length);
      const pcounts = { onlyA: pk.onlyA.length, onlyB: pk.onlyB.length, both: pk.common.length };
      let pbody = '<div class="dthead"><span>文件</span><span>当前包</span><span>另一个包</span><span>状态</span></div>';
      let last = '';
      pitems.slice(ppg.start, ppg.end).forEach(it => {
        if (it.kind !== last) {
          last = it.kind;
          const g = it.kind === 'both'
            ? { cls: 'gs', title: '两边都有', hint: '同名资源包，内容一致或覆盖文件数不同' }
            : DIFF_GROUPS[it.kind];
          pbody += dGroupHead(g.cls, g.title, pcounts[it.kind], g.hint);
        }
        pbody += packRow(it);
      });
      packSec = '<div class="dpacks" id="diffPacks">' +
        '<div class="psec-head"><b>资源包 / 光影</b><span>' + pk.count + '</span>' +
        '<small>按文件名配对，同名会并排比覆盖的文件数；这部分固定显示全部，不随上方筛选变化</small></div>' +
        pbody + MC.pager.html('diffpacks', ppg, { anchor: '#diffPacks', unit: '个资源包' }) + '</div>';
    }

    el.innerHTML = scanBar(s) + '<div class="vpanel">' + head + chips + warning +
      '<div class="dtablewrap" id="diffTable">' + body + pager + '</div>' +
      packSec +
      '<div class="vfoot">模组按 jar 里声明的主 modId 对比；资源包 / 光影按文件名对比，同名会并排比覆盖文件数。' +
      '如果某个模组在另一份里被拆成多个子模块，可能出现对不上的情况。</div></div>';
  }

  R.renderDiff = renderDiff;
})(globalThis);
