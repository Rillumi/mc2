/* ===== 事件层：把用户操作翻译成状态变化 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});
  const S = () => MC.store.state;
  const touch = () => MC.store.touch();
  const { toast, saveBlob, copyText } = MC.uiBase;
  const FT = MC.flowTools; // 日志 / 资源包顺序（js/ui/flow/tools.js）
  const FE = MC.flowEnv; // 环境 / 版本列表 / 分页（js/ui/flow/env.js）
  const FC = MC.flowCommon; // 选中行 / 项目缓存 / 正文纯文本（js/ui/flow/common.js）
  const FL = MC.flowLinks; // 链接库 / 爱发电（js/ui/flow/links.js）
  const FM = MC.flowMeta; // 项目资料 / 分类 / 翻译（js/ui/flow/metadata.js）
  const FU = MC.flowUpdates; // 检查更新 / 导出导览（js/ui/flow/updates.js）
  const FA = MC.flowAnalysis; // 分析 / 前置匹配 / 适配（js/ui/flow/analysis.js）
  const FS = MC.flowScan; // 读取 / 导入 / 对比包（js/ui/flow/scan.js）
  const FP = MC.flowPack; // 打包（js/ui/flow/pack.js）

  /* ---------- 动作分发 ---------- */
  /* 动作模块（js/ui/actions/）和绑定层（bind.js）加载时从这里取用内部函数 */
  MC.actionCtx = {
    S, touch, toast, copyText,
    getGen: FC.getGen,
    bumpGen: FC.bumpGen,
    findDep: FE.findDep, toggleExclude: FE.toggleExclude, pagerGo: FE.pagerGo, pagerFromEl: FE.pagerFromEl,
    autoLog: FT.autoLog, analyzeAndResolve: FA.analyzeAndResolve, loadLoaderList: FE.loadLoaderList, loadMcList: FE.loadMcList, syncEnvInputs: FE.syncEnvInputs,
    checkAllUpdates: FU.checkAllUpdates, checkOneUpdate: FU.checkOneUpdate, exportGuide: FU.exportGuide, findConnector: FE.findConnector,
    refreshAfdian: FL.refreshAfdian, syncAfdianMap: FL.syncAfdianMap, addLink: FL.addLink, removeLink: FL.removeLink, bulkLinks: FL.bulkLinks,
    movePack: FT.movePack, suggestOrder: FT.suggestOrder, exportPackOrder: FT.exportPackOrder, exportPackOptions: FT.exportPackOptions, buildPack: FP.buildPack,
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

  MC.ui = { importFiles: FS.importFiles, analyzeAndResolve: FA.analyzeAndResolve, buildPack: FP.buildPack, toast, saveBlob, syncEnvInputs: FE.syncEnvInputs };
})(globalThis);
