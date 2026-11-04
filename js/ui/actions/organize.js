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
        const issue = st.analysis.versionIssues.find(w => w.id === id);
        C.runAdapt('i:' + id, { kind: 'issue', id, title: id }, issue ? issue.range : el.dataset.range || '');
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
    },

    /** 导出诊断报告：只含文件名与统计，不写完整路径 */
    async diag() {
      const st = MC.store.state;
      const L = [];
      const d = new Date();
      const p2 = n => (n < 10 ? '0' : '') + n;
      const stamp = '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
        '-' + p2(d.getHours()) + p2(d.getMinutes());
      const unid = [];
      const noIcon = [];

      L.push('ModPilot 诊断报告');
      L.push('时间：' + d.toLocaleString('zh-CN'));
      L.push('页面：' + location.origin + location.pathname);
      L.push('浏览器：' + navigator.userAgent);
      L.push('');

      const an = st.analysis;
      if (!an) {
        L.push('【扫描】尚未分析任何文件。');
      } else {
        const env = st.env || {};
        L.push('【环境】');
        L.push('Minecraft ' + (env.mc || '?') + ' · ' + (env.loader || '?') + ' ' + (env.loaderVersion || ''));
        const mods = an.mods || [];
        mods.forEach(e => {
          const name = (e && (e.fileName || e.name)) || '?';
          const proj = MC.flowCommon && MC.flowCommon.projectForEntry
            ? MC.flowCommon.projectForEntry(st, e) : null;
          if (!proj) unid.push(name);
          else if (!proj.icon_url) noIcon.push(name);
        });
        L.push('【扫描】');
        L.push('模组 ' + mods.length + '，已识别 ' + (mods.length - unid.length) + '，未识别 ' + unid.length);
        L.push('其他文件 ' + (an.others || []).length + '，来源整合包 ' + (st.packSources || []).length);
      }

      const ups = st.updates || {};
      const cnt = { newer: 0, current: 0, older: 0, ambiguous: 0, other: 0 };
      const amb = [];
      Object.keys(ups).forEach(k => {
        const s = ups[k] && ups[k].status;
        if (cnt[s] === undefined) cnt.other++;
        else cnt[s]++;
        if (s === 'ambiguous') amb.push(k);
      });
      L.push('【更新检查】');
      L.push('有新版 ' + cnt.newer + ' · 最新 ' + cnt.current + ' · 本地更高 ' + cnt.older +
        ' · 无法比较 ' + cnt.ambiguous + (cnt.other ? ' · 未完成 ' + cnt.other : ''));

      L.push('【外部服务】');
      let backend = '离线';
      try {
        const r = await fetch('/api/project-map');
        backend = r.ok ? '在线' : ('HTTP ' + r.status);
      } catch (err) { backend = '离线'; }
      L.push('本地后端：' + backend);
      L.push('CurseForge key：' + (MC.api && MC.api.curseforge && MC.api.curseforge.hasKey() ? '已配置' : '未配置'));
      L.push('后台补图标：' + (MC.flowMeta && MC.flowMeta.liteOn && MC.flowMeta.liteOn() ? '开启' : '关闭'));

      L.push('【最近一次打包】');
      const lp = st.lastPack;
      if (!lp) {
        L.push('本次会话还没有打包过。');
      } else {
        (lp.files || []).forEach(f => {
          L.push('- ' + f.name + '：' + (f.ok ? '校验通过' : '校验有问题') +
            '（' + f.checked + '/' + f.total + '）');
        });
        if (lp.skipped) L.push('跳过：' + lp.skipped);
        if (lp.overrideFailed) L.push('原包内容没复制进来：' + lp.overrideFailed + ' 个');
        if (lp.depFailed) L.push('前置下载失败：' + lp.depFailed);
        (lp.problems || []).slice(0, 30).forEach(x => L.push('  ! ' + x));
      }

      L.push('【警告】');
      const warn = [];
      unid.slice(0, 40).forEach(n => warn.push('[未识别] ' + n));
      if (unid.length > 40) warn.push('…未识别还有 ' + (unid.length - 40) + ' 个');
      noIcon.slice(0, 20).forEach(n => warn.push('[没有图标] ' + n));
      amb.slice(0, 20).forEach(k => warn.push('[版本无法比较] ' + k));
      L.push.apply(L, warn.length ? warn : ['无']);

      MC.uiBase.saveBlob(
        new Blob([L.join('\r\n')], { type: 'text/plain;charset=utf-8' }),
        'ModPilot-诊断-' + stamp + '.txt'
      );
      C.toast('诊断报告已导出');
    },

    preflite() {
      const FM = MC.flowMeta;
      if (!FM || !FM.setLite) return;
      const on = !FM.liteOn();
      FM.setLite(on);
      touch();
      C.toast(on ? '已开启后台补图标，下次分析后生效' : '已关闭后台补图标');
    }
  });
})(globalThis);
