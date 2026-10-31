/* ===== 绑定：把 DOM 事件接到动作分发上 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  // 具体绑定按职责拆在 js/ui/bind/ 下，这里只负责顺序编排
  function init() {
    MC.bindDrop.init();     // 文件选择 / 拖入
    MC.bindViews.init();    // 页签 / 视图点击 / 行操作
    MC.bindControls.init(); // 工具栏 / 筛选 / 搜索框 / 清空
    MC.bindGlobal.init();   // 全局兜底 / 分页 / 启动
  }

  MC.ui.init = init;
})(globalThis);
