/* ===== 流程公共：选中行、项目缓存、正文纯文本 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  /* 环境切换后，用代数作废旧的在途请求 */
  let gen = 0;
  const getGen = () => gen;
  const bumpGen = () => ++gen;

  /** 一组模组里当前选中的版本行（默认第一个可用） */
  function chosenOf(st, g) {
    const rows = MC.selector.sortRows(g.usableRows || [], st.env);
    return rows.find(r => r.uid === st.selection[g.id]) || rows[0] || null;
  }

  /** 这个条目（或同组任意版本）已经预取到项目资料了吗 */
  function projectForEntry(st, e, g) {
    const byHash = h => h ? (st.projects || {})[(st.hashProject || {})[h]] : null;
    if (e && byHash(e.sha1)) return byHash(e.sha1);
    for (const r of ((g && g.rows) || [])) {
      const p = r.entry && byHash(r.entry.sha1);
      if (p) return p;
    }
    return null;
  }

  function packUrl(p) {
    if (!p) return '';
    return 'https://modrinth.com/' + (p.project_type === 'resourcepack' ? 'resourcepack' :
      p.project_type === 'shader' ? 'shader' : 'mod') + '/' + encodeURIComponent(p.slug || p.id);
  }

  /* ---------- Modrinth 正文：打开详情时补一份完整介绍 ---------- */
  function mdToText(md) {
    return String(md || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_`>~|]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function isNetworkError(reason) {
    return /Failed to fetch|NetworkError|Load failed|ERR_|timeout|aborted/i.test(String(reason || ''));
  }

  MC.flowCommon = { chosenOf, projectForEntry, packUrl, mdToText, isNetworkError, getGen, bumpGen };
})(globalThis);
