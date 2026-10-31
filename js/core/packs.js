/* ===== 资源包：作者建议顺序 + 同路径冲突 + 和模组重复 =====
   Modrinth 的正文里，作者常写「X 要放在 Y 上面」；这里把这类句子抓出来，
   能对上已加载的资源包就自动调整顺序，对不上就原样显示给用户看。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
  }

  function baseName(fileName) {
    return String(fileName || '').replace(/\.(zip|jar)$/i, '');
  }

  function plain(md) {
    return String(md || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_`>~|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function namesOf(pack) {
    const p = pack.project || {};
    return [p.title, p.slug, baseName(pack.fileName)]
      .filter(Boolean).map(norm).filter(k => k.length >= 5);
  }

  /* 同一个资源包的多个版本：有 Modrinth 项目就按项目归组，没有就按去掉版本号的文件名 */
  function stripVer(name) {
    return String(name || '')
      .replace(/(?:^|[-_ ])(?:v|ver|version)?\s*\d+(?:[._]\d+)*(?:[-_ ]*(?:release|beta|alpha)\d*)?$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function packKey(p) {
    const pid = p.project && p.project.id;
    if (pid) return 'p:' + pid;
    let base = stripVer(baseName(p.fileName)).toLowerCase();
    base = base.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!base) base = String(p.fileName || '').toLowerCase();
    return 'n:' + base;
  }

  function formatOf(p) {
    return Number(p.packFormat) || 0;
  }

  /** 每个资源包只留一个版本：优先格式更高（更新），其次体积更大 */
  function dedupe(packs) {
    const groups = new Map();
    (packs || []).forEach(p => {
      const k = packKey(p);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    });
    const keep = [];
    const dups = [];
    groups.forEach(list => {
      if (list.length === 1) { keep.push(list[0]); return; }
      const pick = list.slice().sort((a, b) =>
        formatOf(b) - formatOf(a) || (b.size || 0) - (a.size || 0)
      )[0];
      keep.push(pick);
      dups.push({ keep: pick, others: list.filter(x => x !== pick) });
    });
    const pos = new Map((packs || []).map((p, i) => [p.uid, i]));
    keep.sort((a, b) => pos.get(a.uid) - pos.get(b.uid));
    dups.sort((a, b) => pos.get(a.keep.uid) - pos.get(b.keep.uid));
    return { packs: keep, dups };
  }

  /** 一句话里提到的是哪个已加载资源包（Better Horses ⊂ Better Horses x Fresh Animations，取更短的） */
  function resolveName(text, packs) {
    const n = norm(text);
    if (n.length < 4) return null;
    let best = null;
    let bestLen = Infinity;
    packs.forEach(p => {
      namesOf(p).forEach(k => {
        if ((k.indexOf(n) >= 0 || n.indexOf(k) >= 0) && k.length < bestLen) {
          best = p;
          bestLen = k.length;
        }
      });
    });
    return best;
  }

  const ORDER_WORDS = /(above|below|on top of|under|放在|覆盖在)/i;
  const PACK_WORDS = /(resource\s*pack|resourcepack|pack list|pack order|packs?\b|资源包)/i;

  function orderSentences(body) {
    return plain(body)
      .split(/(?:[.!?。！？]\s+|\n+)/)
      .map(s => s.trim())
      .filter(s => s.length >= 12 && ORDER_WORDS.test(s) && PACK_WORDS.test(s))
      .slice(0, 3);
  }

  /**
   * @param packs [{uid, fileName, size, assets, project, url}]
   * @param mods  [{uid, id, name, groupId, project}]
   */
  function analyze(packsAll, mods) {
    const order = [];
    const tips = [];
    const byUid = {};
    const { packs, dups } = dedupe(packsAll);

    packs.forEach(p => {
      const sents = orderSentences(p.project && p.project.body);
      if (!sents.length) return;
      tips.push({
        uid: p.uid,
        name: (p.project && p.project.title) || baseName(p.fileName),
        sentences: sents,
        url: p.url || ''
      });
      byUid[p.uid] = byUid[p.uid] || {};
      byUid[p.uid].tips = sents;

      sents.forEach(sentence => {
        const m = sentence.match(/(.{1,60}?)\s+(?:should|must|needs? to|has to)\s+be\s+(above|below|on top of|under)\s+(.{1,60}?)\s+in\s+(?:your\s+)?(?:resource\s*)?pack/i);
        if (!m) return;
        const dir = m[2].toLowerCase();
        const aboveName = (dir === 'below' || dir === 'under') ? m[3] : m[1];
        const belowName = (dir === 'below' || dir === 'under') ? m[1] : m[3];
        const above = resolveName(aboveName, packs);
        const below = resolveName(belowName, packs);
        if (!above || !below || above.uid === below.uid) return;
        if (order.some(r => r.above === above.uid && r.below === below.uid)) return;
        order.push({
          above: above.uid,
          below: below.uid,
          why: sentence,
          from: (p.project && p.project.title) || p.fileName,
          url: p.url || ''
        });
      });
    });

    // 两个包改到同一个文件 → 在游戏里会被上面的那个盖住
    const byPath = new Map();
    packs.forEach(p => {
      (p.assets || []).forEach(path => {
        if (!byPath.has(path)) byPath.set(path, []);
        const arr = byPath.get(path);
        if (arr.indexOf(p.uid) < 0) arr.push(p.uid);
      });
    });
    const pairMap = new Map();
    byPath.forEach((uids, path) => {
      if (uids.length < 2) return;
      for (let i = 0; i < uids.length; i++) {
        for (let j = i + 1; j < uids.length; j++) {
          const key = uids[i] + '|' + uids[j];
          if (!pairMap.has(key)) pairMap.set(key, { a: uids[i], b: uids[j], count: 0, samples: [] });
          const rec = pairMap.get(key);
          rec.count++;
          if (rec.samples.length < 3) rec.samples.push(path);
        }
      }
    });
    const conflicts = Array.from(pairMap.values()).sort((x, y) => y.count - x.count);

    // 模组和资源包属于同一个 Modrinth 项目 → 装重了
    const modByPid = new Map();
    mods.forEach(m => {
      if (m.project && m.project.id) modByPid.set(m.project.id, m);
    });
    const sameProject = [];
    packs.forEach(p => {
      const pid = p.project && p.project.id;
      const m = pid && modByPid.get(pid);
      if (!m) return;
      sameProject.push({
        modUid: m.uid,
        modName: m.name || m.id,
        modGroup: m.groupId || '',
        packUid: p.uid,
        packName: (p.project && p.project.title) || baseName(p.fileName),
        title: (p.project && p.project.title) || '',
        url: p.url || ''
      });
    });

    const sorted = sortByRules(packs, order);
    return {
      order, tips, conflicts, sameProject, byUid, packs, dups,
      sorted: sorted.order, applied: sorted.applied, ignored: sorted.ignored
    };
  }

  /**
   * 按作者说明排优先级：拓扑排序，同层保持原文件顺序；
   * 规则之间互相矛盾（成环）时不硬移，把冲突的规则标出来交给用户判断。
   */
  function sortByRules(packs, rules) {
    const ids = packs.map(p => p.uid);
    const pos = new Map(ids.map((id, i) => [id, i]));
    const edges = new Map();   // above → [below]
    const indeg = new Map(ids.map(id => [id, 0]));

    (rules || []).forEach(r => {
      if (!pos.has(r.above) || !pos.has(r.below) || r.above === r.below) return;
      if (!edges.has(r.above)) edges.set(r.above, []);
      const list = edges.get(r.above);
      if (list.indexOf(r.below) >= 0) return;   // 同一对关系重复出现
      list.push(r.below);
      indeg.set(r.below, indeg.get(r.below) + 1);
    });

    const out = [];
    const done = new Set();
    while (out.length < ids.length) {
      let pick = -1;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (!done.has(id) && indeg.get(id) === 0) { pick = i; break; }
      }
      if (pick < 0) break;                      // 剩下的在环里
      const id = ids[pick];
      done.add(id);
      out.push(id);
      (edges.get(id) || []).forEach(b => indeg.set(b, indeg.get(b) - 1));
    }
    // 成环的点：保持原文件顺序追加
    ids.forEach(id => { if (!done.has(id)) out.push(id); });

    // 按最终顺序回看：没被满足的规则就是和别的规则打架了
    const finalPos = new Map(out.map((id, i) => [id, i]));
    const applied = [];
    const ignored = [];
    (rules || []).forEach(r => {
      if (!finalPos.has(r.above) || !finalPos.has(r.below)) return;
      if (finalPos.get(r.above) < finalPos.get(r.below)) applied.push(r);
      else ignored.push(r);
    });
    return { order: out, applied, ignored };
  }

  MC.packs = { analyze, sortByRules, dedupe, orderSentences, resolveName };
})(globalThis);
