const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createStaticHandler } = require('../server/static');

test('静态服务通过真实 HTTP 公开界面资源并拦截私有文件和路径绕过', async t => {
  const serve = createStaticHandler(path.join(__dirname, '..'), { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' });
  const server = http.createServer((req, res) => serve(decodeURIComponent(req.url), req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  function request(url, method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = http.request({host:'127.0.0.1', port:server.address().port, path:url, method}, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({status:res.statusCode,body}));
      });
      req.on('error', reject);
      req.end();
    });
  }
  for (const p of ['/index.html', '/admin.html', '/js/core/version.js', '/css/base.css']) {
    assert.equal((await request(p)).status, 200, p);
  }
  for (const p of ['/db.config.json', '/%2e/db.config.json', '/js/../db.config.json', '/data/afdian.json', '/data/project-map.json', '/server.js', '/server/static.js', '/.git/config', '/js/%2e%2e/%2e%2e/secret.js', '/js/..%5cdb.config.json']) {
    const r = await request(p);
    assert.equal(r.status, 403, p);
    assert.equal(r.body, 'Forbidden');
  }
  assert.equal((await request('/index.html', 'POST')).status, 405);
  assert.equal((await request('/index.html', 'HEAD')).body, '');
});
