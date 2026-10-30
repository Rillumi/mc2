/* ===== 启动 ===== */
(function (root) {
  'use strict';
  const MC = (root.MC = root.MC || {});

  function boot() {
    if (!document.getElementById('drop')) return; // 单测页面不需要初始化

    MC.store.subscribe(state => MC.render.all(state));
    MC.ui.init();
    MC.render.all(MC.store.state);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(globalThis);
