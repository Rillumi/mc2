/* ===== 动作：整理页（模组列表、依赖、打包） ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const C = MC.actionCtx;
  const touch = C.touch;
  const acts = (MC.actions = MC.actions || {});

  function setAdded(el, added) {
    const dep = C.findDep(el.dataset.key);
    if (dep) { dep.added = added; touch(); }
  }

  Object.assign(acts, {
    getconnector() {
      C.findConnector();
    },

    'toggle-exclude'(el) {
      if (el.dataset.group) C.toggleExclude(el.dataset.group);
    },

    exremove(el) {
      if (el.dataset.group) C.toggleExclude(el.dataset.group);
    },

    exinclude(el) {
      if (el.dataset.group) C.toggleExclude(el.dataset.group);
    },

    add(el) {
      setAdded(el, true);
    },

    unadd(el) {
      setAdded(el, false);
    },

    depunadd(el) {
      setAdded(el, false);
    },

    candmore(el) {
      const dep = C.findDep(el.dataset.key);
      if (dep) { dep.showCand = !dep.showCand; touch(); }
    },

    cand(el) {
      const dep = C.findDep(el.dataset.key);
      if (dep) C.chooseCandidate(dep, el.dataset.slug);
    },

    research(el) {
      const key = el.dataset.key;
      const dep = C.findDep(key);
      if (!dep) return;
      const input = document.querySelector('input[data-act="depword"][data-key="' + CSS.escape(key) + '"]');
      C.matchDep(dep, input ? input.value.trim() : '', C.getGen());
    },

    adapt(el, st) {
      const gid = el.dataset.group;
      if (gid) {
        const g = st.analysis && st.analysis.groups.find(x => x.id === gid);
        if (g) {
          const first = g.rows[0].entry;
          C.runAdapt(gid, {
            kind: 'group', groupId: gid,
            id: first.id || g.displayId,
            title: first.name || g.displayId
          });
        }
      } else if (el.dataset.id) {
        const id = el.dataset.id;
        C.runAdapt('i:' + id, { kind: 'issue', id, title: id }, el.dataset.range || '');
      }
    },

    adaptadd(el, st) {
      const ad = st.adapt[el.dataset.key];
      if (ad) C.addAdapt(ad);
    },

    adaptremove(el, st) {
      C.removeAdapt(st.adapt[el.dataset.key]);
    },

    retryall() {
      C.retryAll();
    },

    'pack-pick'(el, st) {
      st.packPick = true;
      st.detail = null;
      st.previewOpen = false;
      touch();
    },

    pack(el, st) {
      st.packPick = false;
      C.buildPack(el.dataset.format);
    },

    toggle(el, st) {
      if (el.dataset.what === 'optional') {
        st.includeOptional = !st.includeOptional;
        touch();
        C.analyzeAndResolve(true);
      } else if (el.dataset.what === 'packs') {
        st.includePacks = !st.includePacks;
        touch();
      }
    },

    'toggle-others'(el, st) {
      st.showOthers = !st.showOthers;
      touch();
    },

    cfkey() {
      const cf = MC.api && MC.api.curseforge;
      if (!cf) return;
      const v = window.prompt(
        '粘贴 CurseForge API key\n\n只存在这台电脑的 localStorage，不会上传、也不会进仓库。留空 = 清除。',
        cf.key()
      );
      if (v === null) return;
      cf.setKey(v);
      touch();
      C.toast(cf.hasKey() ? '已保存 key（只存在这台电脑）' : '已清除 key');
    },

    cftest() {
      const cf = MC.api && MC.api.curseforge;
      if (!cf) return;
      C.toast('正在测试 key…');
      cf.test().then(res => {
        C.toast(res.ok ? 'CurseForge key 可用' : 'CurseForge key 有问题：' + res.reason);
      });
    }
  });
})(globalThis);
