/* ModPilot 本地启动器：只用 Node 自带模块，启动后自动打开浏览器。
   用法：node server.js [端口]（默认 8737，被占用时自动往后找） */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const START_PORT = Number(process.argv[2]) || 8737;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function send(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

const server = http.createServer((req, res) => {
  let urlPath = '/';
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
  } catch (err) {
    return send(res, 400, 'Bad request');
  }
  if (urlPath === '/') urlPath = '/index.html';

  const target = path.resolve(ROOT, '.' + (urlPath.startsWith('/') ? urlPath : '/' + urlPath));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden');
  }

  fs.readFile(target, (err, data) => {
    if (err) return send(res, 404, 'Not found: ' + urlPath);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

function openBrowser(url) {
  if (process.platform === 'win32') {
    exec('start "" "' + url + '"');
  } else if (process.platform === 'darwin') {
    exec('open "' + url + '"');
  } else {
    exec('xdg-open "' + url + '"');
  }
}

function listen(port, left) {
  const onError = err => {
    server.removeListener('error', onError);
    if (err && err.code === 'EADDRINUSE' && left > 0) {
      listen(port + 1, left - 1);
    } else {
      console.error('启动失败：' + (err && err.message ? err.message : err));
      process.exit(1);
    }
  };
  server.once('error', onError);
  server.listen(port, '127.0.0.1', () => {
    server.removeListener('error', onError);
    const url = 'http://127.0.0.1:' + port + '/index.html';
    console.log('');
    console.log('  ModPilot 已启动：' + url);
    console.log('  关闭这个窗口就会停止本地服务。');
    console.log('');
    if (process.env.MODPILOT_NO_OPEN !== '1') openBrowser(url);
  });
}

listen(START_PORT, 10);
