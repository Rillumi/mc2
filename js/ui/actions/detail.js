/* ===== 动作：详情弹窗（打开、语言切换、中文名重查） ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const C = MC.actionCtx;
  const touch = C.touch;
  const acts = (MC.actions = MC.actions || {});

  Object.assign(acts, {
    /* 详情页手动重查中文名：忽略服务端 24 小时缓存，立刻去 MC百科再搜一遍 */
    'zh-recheck'(el, st) {
      const group = el.dataset.group;
      const g = st.analysis && st.analysis.groups.find(x => x.id === group);
      if (!g || !MC.zhNames) return;
      const row = C.chosenOf(st, g);
      const e = row ? row.entry : (g.rows[0] && g.rows[0].entry);
      if (!e) return;
      const p = C.projectForEntry(st, e, g);
      C.toast('正在重新查中文名…');
      MC.zhNames
        .lookup([{ id: String(e.id || ''), title: String(e.name || ''), slug: String((p && p.slug) || '') }], { force: true })
        .then(names => {
          C.applyZhNames(st, names);
          const rec = names[String(e.id || '')];
          C.toast(rec && rec.zh ? '查到中文名：' + rec.zh : 'MC百科上也查不到这个模组的中文名');
        })
        .catch(err => C.toast('查不到：' + ((err && err.message) || '本地服务没开')));
    },

    detail(el, st) {
      const group = el.dataset.group;
      if (el.dataset.other) {
        st.detail = 'o:' + el.dataset.other;
        st.picker = null;
        touch();
      } else if (group) {
        st.detail = group;
        st.picker = null;
        touch();
        if ((st.descLang || 'zh') === 'zh') C.ensureDesc(group);
        C.ensureMrDesc(group);
      }
    },

    desclang(el, st) {
      const lang = el.dataset.lang === 'en' ? 'en' : 'zh';
      st.descLang = lang;
      touch();
      const gid = st.detail;
      if (lang === 'zh' && gid && String(gid).indexOf('o:') !== 0) {
        const prev = st.descTr[gid];
        if (prev && prev.status === 'error') delete st.descTr[gid];
        C.ensureDesc(gid);
      }
    },

    bodylang(el, st) {
      const lang = el.dataset.lang === 'en' ? 'en' : 'zh';
      st.bodyLang = lang;
      touch();
      const gid = st.detail;
      if (lang === 'zh' && gid) {
        const prev = st.bodyTr[gid];
        if (prev && prev.status === 'error') delete st.bodyTr[gid];
        C.ensureBodyTr(gid);
      }
    }
  });
})(globalThis);
