/* ===== 选版本：同一个 modId 的多份文件里，挑出最适合目标环境的那个 =====
   排序规则：MC 区间精确匹配优先 → 正式版优先 → 版本号高优先
   只有 1 个候选时直接选中；多个候选时前端显示下拉框，用户可改。 */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const V = MC.version;

  /** mcRange 是否就精确等于目标版本（[1.20.1] 或直接写 1.20.1） */
  function isExactMc(entry, mc) {
    const r = String(entry.mcRange || '').trim();
    if (!r) return String(entry.mc || '') === mc;
    if (r === mc) return true;
    const m = r.match(/^\[\s*([^,\]]+)\s*\]$/);
    return !!m && m[1] === mc;
  }

  function sortRows(rows, env) {
    return rows.slice().sort((a, b) => {
      const ea = isExactMc(a.entry, env.mc) ? 1 : 0;
      const eb = isExactMc(b.entry, env.mc) ? 1 : 0;
      if (ea !== eb) return eb - ea;
      const pa = V.isPrerelease(a.entry.version) ? 0 : 1;
      const pb = V.isPrerelease(b.entry.version) ? 0 : 1;
      if (pa !== pb) return pb - pa;
      return V.compare(b.entry.version, a.entry.version);
    });
  }

  function bestRow(group, env) {
    return sortRows(group.usableRows || [], env)[0] || null;
  }

  /** 给每一组写默认选择；用户已经选过且仍可用就保留 */
  function assign(state, analysis) {
    const env = state.env;
    const alive = new Set();
    analysis.groups.forEach(g => {
      alive.add(g.id);
      const cur = state.selection[g.id];
      const keep = cur && g.usableRows.some(r => r.uid === cur);
      if (!keep) {
        const best = bestRow(g, env);
        state.selection[g.id] = best ? best.uid : null;
      }
    });
    Object.keys(state.selection).forEach(id => {
      if (!alive.has(id)) delete state.selection[id];
    });
    if (state.excluded) {
      Object.keys(state.excluded).forEach(id => {
        if (!alive.has(id)) delete state.excluded[id];
      });
    }
  }

  /** 当前真正会进包的本地模组（每组一个，跳过被排除的） */
  function selectedRows(state, analysis) {
    if (!analysis) return [];
    const out = [];
    analysis.groups.forEach(g => {
      if (state.excluded && state.excluded[g.id]) return;
      const uid = state.selection[g.id];
      const row = g.usableRows.find(r => r.uid === uid) || bestRow(g, state.env);
      if (row) out.push(row);
    });
    return out.sort((a, b) => String(a.entry.name).localeCompare(String(b.entry.name), 'zh'));
  }

  /** 被用户手动排除、但本来能用的组 */
  function excludedGroups(state, analysis) {
    if (!analysis || !state.excluded) return [];
    return analysis.groups.filter(g => state.excluded[g.id] && g.usableRows.length);
  }

  /** 下拉框里的文字 */
  function label(entry) {
    const v = entry.version || '未知版本';
    return v + (V.isPrerelease(v) ? '（测试版）' : '');
  }

  MC.selector = { isExactMc, sortRows, bestRow, assign, selectedRows, excludedGroups, label };
})(globalThis);
