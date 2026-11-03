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
    const keys = [];
    [p.title, p.slug, baseName(pack.fileName)].filter(Boolean).forEach(name => {
      keys.push(norm(name));
      // 去掉 _v1.11.1 / _1.20+ 这类版本段，本地包没匹配到项目时也能认
      keys.push(norm(String(name).replace(/(?:^|[-_ .])v?\d+(?:[._]\d+)+/gi, ' ')));
    });
    return keys.filter(k => k.length >= 5);
  }

  const ROLE_LABEL = {
    base: '基础材质',
    modpatch: '模组补丁',
    patch: '局部补丁',
    ui: '界面/字体',
    sound: '音效',
    lang: '语言/汉化',
    unknown: '未分类'
  };
  const ROLE_RANK = { ui: 0, sound: 0, lang: 0, patch: 1, modpatch: 2, base: 3, unknown: 4 };

  /* pack_format ↔ 游戏版本，只是参考表；表里没有的版本一律说“无法判断” */
  const FMT_MC = [
    [1, '1.6.1', '1.8.9'], [2, '1.9', '1.10.2'], [3, '1.11', '1.12.2'],
    [4, '1.13', '1.14.4'], [5, '1.15', '1.16.1'], [6, '1.16.2', '1.16.5'],
    [7, '1.17', '1.17.1'], [8, '1.18', '1.18.2'], [9, '1.19', '1.19.2'],
    [12, '1.19.3', '1.19.3'], [13, '1.19.4', '1.19.4'], [15, '1.20', '1.20.1'],
    [18, '1.20.2', '1.20.2'], [22, '1.20.3', '1.20.4'], [32, '1.20.5', '1.20.6'],
    [34, '1.21', '1.21.1'], [42, '1.21.2', '1.21.3'], [46, '1.21.4', '1.21.4'],
    [55, '1.21.5', '1.21.5'], [63, '1.21.6', '1.21.6'], [64, '1.21.7', '1.21.8'],
    [69, '1.21.9', '1.21.10']
  ];

  function verKey(v) {
    const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v || ''));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
  }

  function cmpVer(a, b) {
    return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
  }

  function mcRow(mc) {
    const k = verKey(mc);
    if (!k) return null;
    return FMT_MC.find(row => {
      const lo = verKey(row[1]);
      const hi = verKey(row[2]);
      return lo && hi && cmpVer(k, lo) >= 0 && cmpVer(k, hi) <= 0;
    }) || null;
  }

  function fmtLabel(fmt) {
    const row = FMT_MC.find(r => r[0] === Number(fmt));
    return row ? row[1] + (row[1] === row[2] ? '' : '–' + row[2]) : '格式 ' + fmt;
  }

  /** 用 pack_format 粗判兼容：ok / old（包偏旧）/ new（包偏新）/ unknown */
  function compat(p, mc) {
    const lo = Number(p.fmtMin) || Number(p.packFormat) || 0;
    const hi = Number(p.fmtMax) || lo;
    if (!lo) return { state: 'unknown', text: '没有 pack.mcmeta 格式号' };
    const row = mcRow(mc);
    if (!row) return { state: 'unknown', text: fmtLabel(lo) + '，你的 ' + mc + ' 不在参考表里' };
    const target = row[0];
    if (target >= lo && target <= hi) {
      return { state: 'ok', text: fmtLabel(target) + ' 可用' };
    }
    if (target < lo) {
      return { state: 'new', text: '包是给 ' + fmtLabel(lo) + ' 的，比你的 ' + mc + ' 新' };
    }
    return { state: 'old', text: '包是给 ' + fmtLabel(hi) + ' 的，比你的 ' + mc + ' 旧' };
  }

  /** 按覆盖的文件猜它是什么角色：只做建议，不据此自动下结论 */
  function classify(p, modNs) {
    const assets = p.assets || [];
    const n = assets.length;
    if (!n) return { role: 'unknown', why: '没有读到资源文件' };
    const ns = {};
    let vanillaTex = 0, gui = 0, lang = 0, sound = 0, model = 0, font = 0;
    assets.forEach(path => {
      const m = /^assets\/([^/]+)\/(.*)$/i.exec(path);
      if (!m) return;
      const id = m[1].toLowerCase();
      const rest = m[2].toLowerCase();
      ns[id] = (ns[id] || 0) + 1;
      if (id !== 'minecraft') return;
      if (/^textures\/(block|item|entity|environment|particle|painting)\//.test(rest)) vanillaTex++;
      else if (/^textures\/gui\//.test(rest)) gui++;
      else if (/^lang\//.test(rest)) lang++;
      else if (/^sounds\//.test(rest)) sound++;
      else if (/^models\//.test(rest)) model++;
      else if (/^font\//.test(rest)) font++;
    });
    const modIds = Object.keys(ns).filter(id => id !== 'minecraft' && modNs.has(id));
    if (modIds.length) {
      return { role: 'modpatch', why: '改了模组 ' + modIds.slice(0, 2).join('、') + ' 的资源' };
    }
    if (sound / n > 0.6) return { role: 'sound', why: '大部分是音效文件' };
    if (lang / n > 0.5) return { role: 'lang', why: '大部分是语言文件，像是汉化' };
    if (font / n > 0.25 || gui / n > 0.4) return { role: 'ui', why: '主要是界面或字体' };
    const main = vanillaTex + model;
    const name = baseName(p.fileName).toLowerCase();
    const bigName = /(faithful|patrix|umso|stay\s*true|vanilla|default|原版|高清|32x|64x|128x|256x|512x)/.test(name);
    if (main >= 300 || (bigName && main >= 100)) {
      return { role: 'base', why: main.toLocaleString() + ' 个原版方块/物品/模型文件' };
    }
    if (main >= 40) return { role: 'patch', why: main.toLocaleString() + ' 个原版贴图，范围较小' };
    return { role: 'patch', why: n.toLocaleString() + ' 个文件，像是局部修改' };
  }

  /** 同一个资源包的多个版本：有 Modrinth 项目就按项目归组，没有就按去掉版本号的文件名 */
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
  const REL_WORDS = /(addon|add-on|add on|patch|compatibility|compat|requires?|needs?|depends?|补丁|扩展|附属|兼容|前置|需要|依赖|基于)/i;

  /** 作者自己写的文字：pack.mcmeta 描述、项目标题、简介、正文 */
  function textSources(p) {
    const proj = p.project || {};
    return [p.description, proj.title, proj.summary, proj.body].filter(Boolean);
  }

  /** 只从“含 addon/patch/requires 等词”的句子里找基础包，找不到就不猜 */
  function declaredBase(p, packs) {
    const others = packs.filter(x => x.uid !== p.uid);
    if (!others.length) return null;
    for (const src of textSources(p)) {
      const parts = plain(src).split(/[.!?。！？]+/).map(s => s.trim()).filter(Boolean);
      for (const s of parts) {
        if (!REL_WORDS.test(s)) continue;
        const hit = resolveName(s, others);
        if (!hit) continue;
        return {
          baseUid: hit.uid,
          baseName: (hit.project && hit.project.title) || baseName(hit.fileName),
          why: s.slice(0, 160)
        };
      }
    }
    return null;
  }

  /**
   * 只看重叠方向，不猜归属：
   * subset = 小包几乎全在大包内；peer = 两边大量互相覆盖（同类竞争）；partial = 少量交叉
   */
  function relations(packs) {
    const sets = new Map(packs.map(p => [p.uid, new Set(p.assets || [])]));
    const out = [];
    for (let i = 0; i < packs.length; i++) {
      for (let j = i + 1; j < packs.length; j++) {
        const a = packs[i];
        const b = packs[j];
        const sa = sets.get(a.uid).size;
        const sb = sets.get(b.uid).size;
        if (!sa || !sb) continue;
        let inter = 0;
        sets.get(b.uid).forEach(x => { if (sets.get(a.uid).has(x)) inter++; });
        if (!inter) continue;
        const ra = inter / sa;
        const rb = inter / sb;
        let kind = 'partial';
        if ((ra >= 0.85 && sa <= sb * 0.25) || (rb >= 0.85 && sb <= sa * 0.25)) kind = 'subset';
        else if (ra >= 0.5 && rb >= 0.5) kind = 'peer';
        out.push({ a: a.uid, b: b.uid, inter, ra, rb, kind });
      }
    }
    return out.sort((x, y) => y.inter - x.inter);
  }


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
  function analyze(packsAll, mods, opts) {
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

    // 多个包同时改同一个文件：按文件列出涉及哪些包，方便决定谁该在上面
    const pathGroups = Array.from(byPath.entries())
      .filter(([, uids]) => uids.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 40)
      .map(([path, uids]) => ({ path, uids }));

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

    // 资源包覆盖了某个已装模组的命名空间（assets/<modid>/…）
    // 只做路径级判断：可能是作者有意做的兼容/汉化补丁，也可能让模组贴图错乱
    const nsMap = new Map();
    mods.forEach(m => {
      (m.ids || [m.id]).forEach(ns => {
        if (ns) nsMap.set(String(ns).toLowerCase(), m);
      });
    });
    const modOverlaps = [];
    packs.forEach(p => {
      const hits = new Map();
      (p.assets || []).forEach(path => {
        const m = /^assets\/([^/]+)\//i.exec(path);
        if (!m) return;
        const mod = nsMap.get(m[1].toLowerCase());
        if (!mod) return;
        if (!hits.has(mod.uid)) {
          hits.set(mod.uid, {
            modUid: mod.uid, modName: mod.name || mod.id,
            ns: m[1], count: 0, samples: []
          });
        }
        const h = hits.get(mod.uid);
        h.count++;
        if (h.samples.length < 3) h.samples.push(path);
      });
      hits.forEach(h => {
        modOverlaps.push({
          packUid: p.uid,
          packName: (p.project && p.project.title) || baseName(p.fileName),
          modUid: h.modUid, modName: h.modName, ns: h.ns,
          count: h.count, samples: h.samples
        });
      });
    });

    // 按覆盖内容猜角色；归属只认作者原文，不靠路径重叠猜
    const advice = packs.map(p => {
      const c = classify(p, new Set(nsMap.keys()));
      return {
        uid: p.uid,
        role: c.role,
        label: ROLE_LABEL[c.role] || c.role,
        why: c.why,
        files: (p.assets || []).length,
        compat: compat(p, (opts && opts.mc) || ''),
        declared: declaredBase(p, packs)
      };
    });
    const rels = relations(packs);

    const roleOf = new Map(advice.map(a => [a.uid, a.role]));
    const posOf = new Map(packs.map((p, i) => [p.uid, i]));
    const roleSorted = packs.slice().sort((a, b) => {
      const ra = ROLE_RANK[roleOf.get(a.uid)] || 0;
      const rb = ROLE_RANK[roleOf.get(b.uid)] || 0;
      if (ra !== rb) return ra - rb;
      // 同类里，基础材质包越大越靠下；其余保持原顺序
      if (roleOf.get(a.uid) === 'base') {
        return (a.assets || []).length - (b.assets || []).length;
      }
      return posOf.get(a.uid) - posOf.get(b.uid);
    });
    // 作者明文写过的上下关系优先；作者声明的 addon 也要排在它的基础包上面
    const declaredRules = advice.filter(a => a.declared)
      .map(a => ({ above: a.uid, below: a.declared.baseUid, why: a.declared.why }));
    const rules = order.concat(declaredRules);
    const suggested = rules.length
      ? sortByRules(roleSorted, rules).order
      : roleSorted.map(p => p.uid);

    return {
      order, tips, conflicts, pathGroups, sameProject, byUid, packs, dups,
      modOverlaps, advice, suggested, relations: rels,
      sorted: sorted.order, applied: sorted.applied, ignored: sorted.ignored
    };
  }

  /** 作者声明“这是 X 的补丁”，但当前排在 X 下面 → 一定会被 X 盖住 */
  function checkOrder(packs, advice, uids) {
    const pos = new Map((uids || []).map((uid, i) => [uid, i]));
    const byUid = new Map((packs || []).map(p => [p.uid, p]));
    const out = [];
    (advice || []).forEach(a => {
      if (!a.declared || !pos.has(a.uid) || !pos.has(a.declared.baseUid)) return;
      if (pos.get(a.declared.baseUid) >= pos.get(a.uid)) return;
      const p = byUid.get(a.uid) || {};
      out.push({
        packUid: a.uid,
        packName: (p.project && p.project.title) || baseName(p.fileName),
        baseUid: a.declared.baseUid,
        baseName: a.declared.baseName,
        why: a.declared.why
      });
    });
    return out;
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

  MC.packs = { analyze, sortByRules, dedupe, orderSentences, resolveName, checkOrder, compat };
})(globalThis);
