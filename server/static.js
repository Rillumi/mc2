'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 只公开界面资源，运行数据、配置、测试和后端源码不属于静态站点。
function isPublicFile(relative) {
  const p = relative.split(path.sep).join('/');
  return /^(?:index|admin)\.html$/.test(p) ||
    /^js\/(?!.*(?:^|\/)\.)[\w/.-]+\.js$/.test(p) ||
    /^css\/[\w/-]+\.css$/.test(p);
}

function createStaticHandler(root, types) {
  function publicTarget(target) {
    const relative = path.relative(root, target);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) && isPublicFile(relative);
  }
  return (urlPath, req, res) => {
    const deny = () => { res.writeHead(403); res.end('Forbidden'); };
    const missing = () => { res.writeHead(404); res.end('Not found'); };
    const target = path.resolve(root, '.' + urlPath);
    if (!publicTarget(target)) return deny();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    // 校验真实路径，防止公开资源目录中的符号链接指向私有文件。
    fs.realpath(target, (err, real) => {
      if (err) return missing();
      if (!publicTarget(real)) return deny();
      fs.readFile(real, (err, data) => {
        if (err) return missing();
        res.writeHead(200, {
          'Content-Type': types[path.extname(real).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(req.method === 'HEAD' ? undefined : data);
      });
    });
  };
}

module.exports = { createStaticHandler };
