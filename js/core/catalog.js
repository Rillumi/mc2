/* ===== 导览：模组分类 =====
   分类优先用 Modrinth 官方的 categories（项目页上「分类」那一栏就是它），
   只有不在 Modrinth 上的模组才退回按关键词猜——关键词只当兜底，
   而且必须整词命中，避免 "car" 撞上 "carpet" 这种误判。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  const CATS = [
    { id: 'lib', label: '前置库' },
    { id: 'building', label: '建筑装饰' },
    { id: 'tech', label: '科技自动化' },
    { id: 'adventure', label: '冒险战斗' },
    { id: 'world', label: '世界生成' },
    { id: 'farming', label: '农业食物' },
    { id: 'transport', label: '交通载具' },
    { id: 'ui', label: '界面优化' },
    { id: 'misc', label: '其他' }
  ];

  const LABEL = {};
  CATS.forEach(c => { LABEL[c.id] = c.label; });

  /* Modrinth 的 19 个官方分类 → 我们的 8 个桶 */
  const MR_MAP = {
    library: 'lib',
    decoration: 'building',
    technology: 'tech',
    storage: 'tech',
    adventure: 'adventure',
    magic: 'adventure',
    mobs: 'adventure',
    equipment: 'adventure',
    worldgen: 'world',
    food: 'farming',
    transportation: 'transport',
    optimization: 'ui',
    utility: 'ui',
    cursed: 'misc',
    economy: 'misc',
    'game-mechanics': 'misc',
    management: 'misc',
    minigame: 'misc',
    social: 'misc'
  };

  /* 关键词兜底：英文必须整词命中，中文按包含即可 */
  const KW = {
    lib: ['api', 'lib', 'library', 'framework', '前置'],
    building: ['build', 'building', 'decor', 'furniture', 'chisel', 'architecture', 'roof', 'window', '建筑', '装饰', '家具', '屋顶'],
    tech: ['tech', 'machine', 'energy', 'industrial', 'automation', 'pipe', 'cable', 'reactor', '科技', '机械', '自动化', '能源', '电力'],
    adventure: ['adventure', 'dungeon', 'boss', 'combat', 'weapon', 'rpg', '冒险', '地牢', '战斗', '武器', '怪物'],
    world: ['worldgen', 'biome', 'terrain', 'dimension', 'ore', 'structure', '地形', '生物群系', '维度', '矿石', '结构'],
    farming: ['farm', 'crop', 'food', 'cook', 'kitchen', 'harvest', '农业', '食物', '烹饪', '作物'],
    transport: ['transport', 'vehicle', 'train', 'boat', 'plane', '交通', '载具', '汽车', '火车'],
    ui: ['hud', 'minimap', 'inventory', 'jei', 'rei', 'tooltip', 'optimiz', 'performance', '界面', '优化', '性能', '地图', '背包']
  };

  function escRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function hit(text, k) {
    if (!text) return false;
    if (/[\u4e00-\u9fff]/.test(k)) return text.indexOf(k) >= 0;
    // 短词要求整词（api/jei/hud），长词允许词首派生（tech→technology、build→building）
    const tail = k.length <= 3 ? '($|[^a-z0-9])' : '';
    return new RegExp('(^|[^a-z0-9])' + escRe(k) + tail).test(text);
  }

  /* 一个项目常常同时挂着多个分类（Create 是 decoration+technology+utility），
     按「最能说明它在玩什么」的顺序取第一个：玩法 > 库 > 装饰 > 杂项 */
  const MR_ORDER = ['food', 'technology', 'storage', 'magic', 'mobs', 'adventure', 'equipment',
    'worldgen', 'library', 'transportation', 'decoration', 'optimization', 'utility'];

  function primaryOf(slugs) {
    let best = '';
    let bestRank = 999;
    (slugs || []).forEach(s => {
      const slug = String(s || '').toLowerCase();
      const id = MR_MAP[slug];
      if (!id) return;
      const rank = MR_ORDER.indexOf(slug);
      const r = rank < 0 ? 500 : rank;
      if (r < bestRank) { bestRank = r; best = id; }
    });
    return best;
  }

  /** Modrinth 项目对象 → { cats: ['decoration', ...], primary: 'building' }；没有分类返回 null */
  function fromProject(p) {
    if (!p) return null;
    const list = ((p.categories || []).concat(p.additional_categories || []))
      .filter(Boolean).map(x => String(x).toLowerCase());
    if (!list.length) return null;
    return { cats: list, primary: primaryOf(list) || 'misc' };
  }

  /** 名称 / modId 命中权重 3，简介命中权重 1；返回所有命中的分类，按分数排序 */
  function guessAll(entry) {
    const id = String((entry && entry.id) || '').toLowerCase();
    const name = String((entry && entry.name) || '').toLowerCase();
    const desc = String((entry && entry.description) || '').toLowerCase();
    const scored = [];
    Object.keys(KW).forEach(cat => {
      let score = 0;
      KW[cat].forEach(k => {
        if (hit(id, k) || hit(name, k)) score += 3;
        else if (hit(desc, k)) score += 1;
      });
      if (score > 0) scored.push({ id: cat, score });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map(x => x.id);
  }

  /** 名称 / modId 命中权重 3，简介命中权重 1；取分最高的一类 */
  function guess(entry) {
    return guessAll(entry)[0] || 'misc';
  }

  /** 一个模组的所有分类桶：手动主分类最优先，其次 Modrinth 多分类，最后关键词 */
  function tagsOf(entry) {
    const out = [];
    const add = id => {
      if (!id || !LABEL[id] || out.indexOf(id) >= 0) return;
      out.push(id);
    };
    add(String((entry && entry.primary) || ''));
    const slugs = ((entry && entry.cats) || []).map(s => String(s || '').toLowerCase());
    if (slugs.length) {
      slugs.forEach(s => add(MR_MAP[s]));
      return out.length ? out : ['misc'];
    }
    const guessed = guessAll(entry);
    return out.length ? out : (guessed.length ? guessed : ['misc']);
  }

  function sourceOf(entry) {
    return ((entry && entry.cats) || []).length ? 'modrinth' : 'keyword';
  }

  /** entry.primary（后台手动设的）优先，其次 entry.cats（Modrinth 原始分类），最后关键词 */
  function categoryOf(entry) {
    const manual = String((entry && entry.primary) || '');
    if (manual && LABEL[manual]) return manual;
    const fromMr = primaryOf(entry && entry.cats);
    return fromMr || guess(entry);
  }

  function labelOf(id) {
    return LABEL[id] || '其他';
  }

  /** 分类计数，按预设顺序返回（不含 0 个的分类） */
  function counts(items) {
    const n = {};
    items.forEach(e => { const c = categoryOf(e); n[c] = (n[c] || 0) + 1; });
    return CATS.map(c => ({ id: c.id, label: c.label, n: n[c.id] || 0 })).filter(c => c.n);
  }

  /** 多标签计数：一个模组可以同时计入多个分类 */
  function tagCounts(items) {
    const n = {};
    items.forEach(e => tagsOf(e).forEach(c => { n[c] = (n[c] || 0) + 1; }));
    return CATS.map(c => ({ id: c.id, label: c.label, n: n[c.id] || 0 })).filter(c => c.n);
  }

  function mdEsc(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  /** 导出 Markdown：分类 + 每个模组的简介、配方数、版本 */
  function markdown(items, opts) {
    opts = opts || {};
    const env = opts.env || { loader: '?', mc: '?' };
    const updates = opts.updates || {};
    const groups = {};
    items.forEach(it => {
      const c = categoryOf(it.entry || it);
      (groups[c] = groups[c] || []).push(it);
    });
    const lines = [
      '# 整合包导览',
      '',
      '> ' + env.loader + ' · Minecraft ' + env.mc + ' · 共 ' + items.length + ' 个模组',
      ''
    ];
    CATS.forEach(c => {
      const list = groups[c.id];
      if (!list) return;
      lines.push('## ' + c.label + '（' + list.length + '）', '');
      list.sort((a, b) => String(a.entry.name || a.entry.id).localeCompare(String(b.entry.name || b.entry.id), 'zh'));
      list.forEach(it => {
        const e = it.entry;
        const u = updates[it.groupId];
        const bits = [];
        if (e.version) bits.push(e.version);
        if (typeof e.recipes === 'number') bits.push(e.recipes + ' 个配方');
        if (u && u.status === 'newer') bits.push('有新版 ' + u.latest);
        lines.push('- **' + mdEsc(e.name || e.id) + '**（' + e.id + '）' +
          (bits.length ? ' — ' + bits.join('，') : ''));
        if (e.description) lines.push('  ' + mdEsc(e.description).slice(0, 220));
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  MC.catalog = {
    CATS, MR_MAP, categoryOf, labelOf, fromProject, counts,
    guess, guessAll, tagsOf, tagCounts, sourceOf,
    markdown
  };
})(globalThis);
