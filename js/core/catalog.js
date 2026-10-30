/* ===== 导览：按关键词把模组粗分到玩法分类，并导出 Markdown =====
   只做「大概属于哪类」，不追求准确；分类判断只用于看的方便，不影响打包。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  const CATS = [
    { id: 'lib', label: '前置库', kw: ['api', 'lib', 'library', 'framework', 'loader', '前置'] },
    { id: 'building', label: '建筑装饰', kw: ['build', 'building', 'decor', 'furniture', 'chisel', 'architecture', 'roof', 'window', 'stairs', 'slab', '建筑', '装饰', '家具', '屋顶', '方块'] },
    { id: 'tech', label: '科技自动化', kw: ['tech', 'machine', 'energy', 'power', 'industrial', 'automation', 'pipe', 'cable', 'reactor', 'mekanism', 'thermal', 'create', '科技', '机械', '自动化', '能源', '电力'] },
    { id: 'adventure', label: '冒险战斗', kw: ['adventure', 'dungeon', 'boss', 'combat', 'weapon', 'gear', 'mob', 'rpg', '冒险', '地牢', '战斗', '武器', '怪物'] },
    { id: 'world', label: '世界生成', kw: ['worldgen', 'biome', 'terrain', 'dimension', 'ore', 'structure', '地形', '生物群系', '维度', '矿石', '结构'] },
    { id: 'farming', label: '农业食物', kw: ['farm', 'crop', 'food', 'cook', 'kitchen', 'harvest', '农业', '食物', '烹饪', '作物'] },
    { id: 'transport', label: '交通载具', kw: ['transport', 'vehicle', 'car', 'train', 'boat', 'plane', 'road', '交通', '载具', '汽车', '火车'] },
    { id: 'ui', label: '界面优化', kw: ['ui', 'hud', 'minimap', 'map', 'inventory', 'jei', 'rei', 'tooltip', 'optimiz', 'performance', 'fps', '界面', '优化', '性能', '地图', '背包'] },
    { id: 'misc', label: '其他', kw: [] }
  ];

  const LABEL = {};
  CATS.forEach(c => { LABEL[c.id] = c.label; });

  /** 名称 / modId 命中权重 3，简介命中权重 1；取分最高的一类 */
  function categoryOf(entry) {
    const id = String((entry && entry.id) || '').toLowerCase();
    const name = String((entry && entry.name) || '').toLowerCase();
    const desc = String((entry && entry.description) || '').toLowerCase();
    let best = 'misc';
    let bestScore = 0;
    CATS.forEach(c => {
      if (c.id === 'misc') return;
      let score = 0;
      c.kw.forEach(k => {
        if (id.indexOf(k) >= 0 || name.indexOf(k) >= 0) score += 3;
        else if (desc.indexOf(k) >= 0) score += 1;
      });
      if (score > bestScore) { bestScore = score; best = c.id; }
    });
    return best;
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

  MC.catalog = { CATS, categoryOf, labelOf, counts, markdown };
})(globalThis);
