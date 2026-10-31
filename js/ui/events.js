/* ===== 事件层：把用户操作翻译成状态变化 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();
  const { toast, saveBlob, copyText, walkEntry, collectDrop, sha1Hex, esc } = MC.uiBase;
  const FT = MC.flowTools; // 日志 / 资源包顺序（js/ui/flow/tools.js）
  const FE = MC.flowEnv; // 环境 / 版本列表 / 分页（js/ui/flow/env.js）
  const FC = MC.flowCommon; // 选中行 / 项目缓存 / 正文纯文本（js/ui/flow/common.js）
  const FL = MC.flowLinks; // 链接库 / 爱发电（js/ui/flow/links.js）
  const FM = MC.flowMeta; // 项目资料 / 分类 / 翻译（js/ui/flow/metadata.js）
  const FU = MC.flowUpdates; // 检查更新 / 导出导览（js/ui/flow/updates.js）
  const FA = MC.flowAnalysis; // 分析 / 前置匹配 / 适配（js/ui/flow/analysis.js）
  const FS = MC.flowScan; // 读取 / 导入 / 对比包（js/ui/flow/scan.js）

  /* ---------- 打包 ---------- */
  async function buildPack(format) {
    const st = S();
    if (st.busy) return;
    if (!st.analysis) return toast('先拖入模组文件夹');
    st.busy = true;
    st.progress = '正在读取本地 jar…';
    touch();
    try {
      const picked = MC.selector.selectedRows(st, st.analysis);
      const localJars = [];
      for (const row of picked) {
        if (!row.entry.file) continue;
        localJars.push({
          name: row.entry.fileName,
          data: new Uint8Array(await row.entry.file.arrayBuffer())
        });
      }
      const adapted = Object.keys(st.adapt || {}).map(k => st.adapt[k])
        .filter(x => x.added && x.status === 'ok' && x.version && x.project);
      const deps = st.deps.filter(d => d.added && d.status === 'ok' && d.version && d.project).concat(adapted);

      const extras = [];
      if (st.includePacks) {
        for (const o of (st.analysis.others || [])) {
          if (!o.file || (o.kind !== 'resourcepack' && o.kind !== 'shader')) continue;
          extras.push({ kind: o.kind, name: o.fileName, data: new Uint8Array(await o.file.arrayBuffer()) });
        }
      }

      let result;
      if (format === 'mrpack') {
        st.progress = '正在生成 .mrpack…';
        touch();
        result = await MC.pack.buildMrpack({ env: st.env, localJars, deps, extras });
      } else {
        result = await MC.pack.buildPlainZip({
          env: st.env, localJars, deps, extras,
          onProgress: text => { st.progress = text; touch(); }
        });
      }
      saveBlob(result.blob, result.filename);
      toast('已生成 ' + result.filename);
    } catch (err) {
      console.error(err);
      toast('打包失败：' + (err && err.message ? err.message : err));
    } finally {
      st.busy = false;
      st.progress = '';
      touch();
    }
  }

  /* ---------- 动作分发 ---------- */
  /* 动作模块（js/ui/actions/）和绑定层（bind.js）加载时从这里取用内部函数 */
  MC.actionCtx = {
    S, touch, toast, copyText,
    getGen: FC.getGen,
    bumpGen: FC.bumpGen,
    findDep: FE.findDep, toggleExclude: FE.toggleExclude, pagerGo: FE.pagerGo, pagerFromEl: FE.pagerFromEl,
    autoLog: FT.autoLog, analyzeAndResolve: FA.analyzeAndResolve, loadLoaderList: FE.loadLoaderList, loadMcList: FE.loadMcList, syncEnvInputs: FE.syncEnvInputs,
    checkAllUpdates: FU.checkAllUpdates, checkOneUpdate: FU.checkOneUpdate, exportGuide: FU.exportGuide, findConnector: FE.findConnector,
    refreshAfdian: FL.refreshAfdian, addLink: FL.addLink, removeLink: FL.removeLink, bulkLinks: FL.bulkLinks,
    movePack: FT.movePack, exportPackOrder: FT.exportPackOrder, exportPackOptions: FT.exportPackOptions, buildPack,
    chosenOf: FC.chosenOf, projectForEntry: FC.projectForEntry,
    applyZhNames: FM.applyZhNames,
    ensureDesc: FM.ensureDesc, ensureMrDesc: FM.ensureMrDesc, ensureBodyTr: FM.ensureBodyTr,
    matchDep: FA.matchDep, chooseCandidate: FA.chooseCandidate, runAdapt: FA.runAdapt, addAdapt: FA.addAdapt, removeAdapt: FA.removeAdapt, retryAll: FA.retryAll,
    handleAct, importFiles: FS.importFiles, importDiff: FS.importDiff, importLogs: FT.importLogs, syncDbState: FL.syncDbState
  };

  /* ---------- 动作分发：具体实现见 js/ui/actions/ ---------- */
  function handleAct(act, el) {
    const fn = MC.actions && MC.actions[act];
    if (!fn) return false;
    fn(el, S());
    return true;
  }

  MC.ui = { importFiles: FS.importFiles, analyzeAndResolve: FA.analyzeAndResolve, buildPack, toast, saveBlob, syncEnvInputs: FE.syncEnvInputs };
})(globalThis);
