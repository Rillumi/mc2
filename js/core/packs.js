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
  function analyze(packs, mods) {
    const order = [];
    const tips = [];
    const byUid = {};

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

    return { order, tips, conflicts, sameProject, byUid };
  }

  /** 按作者说明纠正顺序：写在前面的必须排在后面之前 */
  function applyOrder(packs, rules) {
    const uids = packs.map(p => p.uid);
    (rules || []).forEach(r => {
      let a = uids.indexOf(r.above);
      let b = uids.indexOf(r.below);
      if (a < 0 || b < 0 || a < b) return;
      uids.splice(a, 1);
      b = uids.indexOf(r.below);
      uids.splice(b >= 0 ? b : uids.length, 0, r.above);
    });
    return uids;
  }

  MC.packs = { analyze, applyOrder, orderSentences, resolveName };
})(globalThis);
