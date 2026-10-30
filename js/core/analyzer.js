/* ===== 分析：可用性 / 缺前置 / 版本是否够 / 重复 / 声明冲突 =====
   能自动判断的只有「文件里写得出来的东西」：
   - 加载器、MC 区间是否命中
   - 依赖有没有被某个会加载的 jar 提供（含 provides 声明）
   - 提供者的版本号满不满足依赖写的 versionRange
   - 两个不同模组是否声明了同一个 ID
   语义冲突（某个方块 ID 冲突、配方抢同一个物品）没法从元数据看出来，界面里要说明。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const V = MC.version;

  // 这些依赖由启动器/游戏本身提供，不算“缺前置”
  const ENV_IDS = new Set([
    'minecraft', 'forge', 'neoforge', 'fabricloader', 'java',
    'mod_minecraftforge', 'minecraftforge', 'mod_mcp'
  ]);

  /** 依赖 ID 归一化：Fabric API 的子模块统一算 fabric-api */
  function normDep(id) {
    const l = String(id || '').toLowerCase();
    if (l === 'fabric' || l === 'fabric-api' || /^fabric_/.test(l)) return 'fabric-api';
    return l;
  }

  function loadersOf(entry) {
    return entry.loaders && entry.loaders.length ? entry.loaders : [entry.loader];
  }

  function matchesEnv(entry, env) {
    if (loadersOf(entry).indexOf(env.loader) < 0) return false;
    return V.mcMatches(entry.mcRange || entry.mc, env.mc);
  }

  function rangeOf(d) {
    const r = String(d.versionRange || '').trim();
    return !r || r === '*' ? '' : r;
  }

  /** 一个依赖在本地是否被满足：env / local / version / missing */
  function depStatus(d, providers) {
    const id = normDep(d.modId);
    const base = { modId: d.modId, range: rangeOf(d), mandatory: d.mandatory !== false, key: id };
    if (ENV_IDS.has(id)) return Object.assign(base, { state: 'env' });
    const list = providers.get(id);
    if (!list || !list.length) return Object.assign(base, { state: 'missing' });
    const range = base.range;
    if (!range) return Object.assign(base, { state: 'local', by: list[0].name, version: list[0].version });
    const hit = list.find(e => e.version && V.mcMatches(range, e.version));
    if (hit) return Object.assign(base, { state: 'local', by: hit.name, version: hit.version });
    if (list.every(e => !e.version)) {
      return Object.assign(base, { state: 'local', by: list[0].name, version: '', uncertain: true });
    }
    return Object.assign(base, { state: 'version', by: list[0].name, version: list[0].version });
  }

  function analyze(mods, env, opts) {
    opts = opts || {};
    const includeOptional = !!opts.includeOptional;

    const modFiles = mods.filter(m => (m.kind || 'mod') === 'mod');
    const others = mods.filter(m => (m.kind || 'mod') !== 'mod');

    const byId = new Map();
    modFiles.forEach(m => {
      const k = String(m.id || '').toLowerCase();
      if (!byId.has(k)) byId.set(k, []);
      byId.get(k).push(m);
    });

    const rows = modFiles.map(entry => {
      const issues = [];
      const usable = matchesEnv(entry, env);
      if (!usable) {
        if (loadersOf(entry).indexOf(env.loader) < 0) {
          issues.push({ type: 'loader', text: '加载器不符（' + loadersOf(entry).join('/') + '）' });
        } else {
          issues.push({ type: 'mc', text: 'MC 版本不符（' + (entry.mc || '?') + '）' });
        }
      }
      if (entry.error) issues.push({ type: 'meta', text: entry.error });
      const groupSize = byId.get(String(entry.id || '').toLowerCase()).length;
      if (groupSize > 1) issues.push({ type: 'dup', text: '同 ID 共 ' + groupSize + ' 份' });
      return { uid: entry.uid, entry, usable, issues, groupSize, depInfo: [] };
    });

    // 只有“真的会被加载”的 jar 才算提供前置
    const providers = new Map(); // 归一化 ID → [entry]
    rows.forEach(r => {
      if (!r.usable) return;
      (r.entry.allIds || [r.entry.id]).forEach(raw => {
        const id = normDep(raw);
        if (!providers.has(id)) providers.set(id, []);
        const list = providers.get(id);
        if (!list.some(e => e.uid === r.entry.uid)) list.push(r.entry);
      });
    });

    const groups = [...byId.entries()].map(([id, entries]) => {
      const groupRows = rows.filter(r => String(r.entry.id).toLowerCase() === id);
      return {
        id,
        displayId: groupRows[0].entry.id,
        rows: groupRows,
        usableRows: groupRows.filter(r => r.usable),
        sizes: groupRows.length
      };
    }).sort((a, b) => b.sizes - a.sizes);

    const missingMap = new Map();
    const issueMap = new Map();

    rows.forEach(r => {
      if (!r.usable) return;
      // 详情里要把可选前置也列出来，但缺前置清单只算必需项
      r.depInfo = (r.entry.deps || []).concat(r.entry.optionalDeps || []).map(d => depStatus(d, providers));

      r.depInfo.forEach(info => {
        if (!info.mandatory && !includeOptional) return;
        if (info.state === 'missing') {
          if (!missingMap.has(info.key)) {
            missingMap.set(info.key, {
              id: info.key,
              modId: info.modId,
              range: info.range,
              requiredBy: [],
              optionalIn: []
            });
          }
          const item = missingMap.get(info.key);
          if (info.mandatory) {
            if (item.requiredBy.indexOf(r.entry.name) < 0) item.requiredBy.push(r.entry.name);
          } else if (item.optionalIn.indexOf(r.entry.name) < 0) {
            item.optionalIn.push(r.entry.name);
          }
        } else if (info.state === 'version') {
          if (!issueMap.has(info.key)) {
            issueMap.set(info.key, {
              id: info.key,
              modId: info.modId,
              range: info.range,
              by: info.by,
              have: info.version,
              requiredBy: []
            });
          }
          const item = issueMap.get(info.key);
          if (item.requiredBy.indexOf(r.entry.name) < 0) item.requiredBy.push(r.entry.name);
        }
      });
    });

    // 同一个 ID 被多个不同模组声明（provides 撞车），Forge 启动会直接报 Duplicate mod
    const claim = new Map();
    rows.forEach(r => {
      if (!r.usable) return;
      (r.entry.allIds || [r.entry.id]).forEach(raw => {
        const id = String(raw).toLowerCase();
        if (!claim.has(id)) claim.set(id, new Map());
        const owners = claim.get(id);
        owners.set(String(r.entry.id).toLowerCase(), r.entry.name || r.entry.id);
      });
    });
    const overlaps = [...claim.entries()]
      .filter(([, owners]) => owners.size > 1)
      .map(([id, owners]) => ({ id, owners: [...owners.values()] }));

    const missing = [...missingMap.values()]
      .filter(m => m.requiredBy.length || includeOptional)
      .sort((a, b) => a.id.localeCompare(b.id));
    const versionIssues = [...issueMap.values()].sort((a, b) => a.id.localeCompare(b.id));
    const dups = groups.filter(g => g.sizes > 1);
    const needChoose = groups.filter(g => g.usableRows.length > 1);

    return {
      rows,
      groups,
      others,
      missing,
      versionIssues,
      overlaps,
      dups,
      stats: {
        total: rows.length,
        usable: rows.filter(r => r.usable).length,
        groups: groups.length,
        needChoose: needChoose.length,
        missing: missing.length,
        dups: dups.length,
        versionIssues: versionIssues.length,
        overlaps: overlaps.length,
        others: others.length
      }
    };
  }

  MC.analyzer = { analyze, matchesEnv, normDep, depStatus, ENV_IDS };
})(globalThis);
