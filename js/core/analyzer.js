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

  function isFabricEntry(entry) {
    return loadersOf(entry).some(l => /fabric/i.test(String(l || '')));
  }

  /** 包里有没有 Sinytra Connector（以及它需要的 Forgified Fabric API） */
  function detectConnector(modFiles) {
    const ids = new Set(modFiles.map(m => String(m.id || '').toLowerCase()));
    return {
      has: ids.has('connectormod'),
      ffapi: ids.has('fabric_api') || ids.has('forgified-fabric-api')
    };
  }

  /**
   * 能不能装进这个环境。
   * connector = true 时，Forge 环境里的 Fabric 模组也算能装（由 Sinytra Connector 转接）
   */
  function matchesEnv(entry, env, connector) {
    const direct = loadersOf(entry).indexOf(env.loader) >= 0;
    const via = !!connector && env.loader === 'Forge' && isFabricEntry(entry);
    if (!direct && !via) return false;
    return V.mcMatches(entry.mcRange || entry.mc, env.mc);
  }

  function rangeOf(d) {
    const r = String(d.versionRange || '').trim();
    return !r || r === '*' ? '' : r;
  }

  /* 依赖声明里只有 modId，所以前置判重只认 MOD 级（含 jar 里 provides 声明的其他 id） */
  const DEP_LEVELS = [MC.identity.LEVELS.MOD];

  /** 本地有哪些条目提供了这个依赖：先按归一化 ID 查表，再按统一判重扫一遍 allIds */
  function providerList(d, providers) {
    const out = (providers.get(normDep(d.modId)) || []).slice();
    const probe = { id: d.modId };
    providers.forEach(list => list.forEach(e => {
      if (out.some(x => x.uid === e.uid)) return;
      const ids = (e.allIds && e.allIds.length) ? e.allIds : [e.id];
      if (ids.some(raw => MC.identity.same(probe, { id: raw }, DEP_LEVELS))) out.push(e);
    }));
    return out;
  }

  /** 一个依赖在本地是否被满足：env / local / version / missing */
  function depStatus(d, providers) {
    const id = normDep(d.modId);
    const base = { modId: d.modId, range: rangeOf(d), mandatory: d.mandatory !== false, key: id };
    if (ENV_IDS.has(id)) return Object.assign(base, { state: 'env' });
    const list = providerList(d, providers);
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

    // 同一个 jar 经常被复制到多个文件夹里备份，按内容哈希（没有哈希时按文件名+大小）去重，
    // 避免同一个版本在列表里出现好几次
    const uniqueMods = [];
    const seenCopy = new Map();
    mods.forEach(m => {
      const key = m.sha1
        ? 'h:' + m.sha1
        : 'f:' + String(m.fileName || '').toLowerCase() + '|' + (m.size || 0);
      const hit = seenCopy.get(key);
      if (hit) {
        hit.copies = (hit.copies || 1) + 1;
        return;
      }
      m.copies = m.copies || 1;
      seenCopy.set(key, m);
      uniqueMods.push(m);
    });

    const modFiles = uniqueMods.filter(m => (m.kind || 'mod') === 'mod');
    const others = uniqueMods.filter(m => (m.kind || 'mod') !== 'mod');
    const connector = opts.connector || detectConnector(modFiles);

    // 同一模组的不同打包常把 ID 写成 mizunoky_mod / mizunoky-mod，去掉分隔符再分组
    const groupKey = entry => String(entry.id || '').toLowerCase().replace(/[_-]/g, '');
    const nameKey = entry => String(entry.name || entry.nameZh || entry.id || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
    // 显示名完全相同（例如 ID 从 nti_ziran 改成 ntileriaziran）也当作同一个模组
    const sameDisplayName = (a, b) => {
      const na = nameKey(a), nb = nameKey(b);
      return !!na && na === nb && na.length >= 4;
    };

    const byKey = new Map();
    modFiles.forEach(m => {
      const k = groupKey(m);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(m);
    });

    // 同名、且两个 ID 互为包含（cocricot / cocricotmod）→ 当作同一个模组的两个版本；
    // 显示名完全一致也合并（作者改过 modId 但名字没变）
    const pooled = [...byKey.entries()];
    const dropped = new Set();
    for (let i = 0; i < pooled.length; i++) {
      if (dropped.has(i)) continue;
      for (let j = i + 1; j < pooled.length; j++) {
        if (dropped.has(j)) continue;
        const ka = pooled[i][0], kb = pooled[j][0];
        const na = nameKey(pooled[i][1][0]), nb = nameKey(pooled[j][1][0]);
        if (!na || na !== nb) continue;
        const idRelated = kb.length >= 5 && (ka.indexOf(kb) >= 0 || kb.indexOf(ka) >= 0);
        if (idRelated || sameDisplayName(pooled[i][1][0], pooled[j][1][0])) {
          pooled[i][1] = pooled[i][1].concat(pooled[j][1]);
          dropped.add(j);
        }
      }
    }

    const groupOf = new Map(); // uid → 这一组的所有文件
    const groupMeta = [];
    pooled.forEach(([key, entries], i) => {
      if (dropped.has(i)) return;
      entries.forEach(e => groupOf.set(e.uid, entries));
      groupMeta.push({ key, entries });
    });

    const rows = modFiles.map(entry => {
      const issues = [];
      const direct = loadersOf(entry).indexOf(env.loader) >= 0;
      const usable = matchesEnv(entry, env, connector.has);
      const viaConnector = usable && !direct;
      // 这个模组本身装不上，但可以靠 Sinytra Connector 转接（Fabric → Forge）
      const connectorFix = !direct && isFabricEntry(entry) && env.loader === 'Forge';
      if (!usable) {
        if (!direct) {
          issues.push({ type: 'loader', text: '加载器不符（' + loadersOf(entry).join('/') + '）' });
        } else {
          issues.push({ type: 'mc', text: 'MC 版本不符（' + (entry.mc || '?') + '）' });
        }
      }
      if (entry.error) issues.push({ type: 'meta', text: entry.error });
      const peer = groupOf.get(entry.uid) || [entry];
      const groupSize = peer.length;
      if (groupSize > 1) issues.push({ type: 'dup', text: '同 ID 共 ' + groupSize + ' 份' });
      return { uid: entry.uid, entry, usable, viaConnector, connectorFix, issues, groupSize, depInfo: [] };
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

    const rowByUid = new Map(rows.map(r => [r.uid, r]));
    const groups = groupMeta.map(gm => {
      const groupRows = gm.entries.map(e => rowByUid.get(e.uid)).filter(Boolean);
      const usableRows = groupRows.filter(r => r.usable);
      const first = usableRows[0] || groupRows[0];
      return {
        id: gm.key,
        displayId: first ? first.entry.id : gm.key,
        rows: groupRows,
        usableRows,
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
      connector,
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

  MC.analyzer = { analyze, matchesEnv, normDep, depStatus, ENV_IDS, detectConnector };
})(globalThis);
