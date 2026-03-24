/**
 * 森雅验货系统 - 后端同步服务器
 * 启动: node server.js
 * 默认端口 3000, 可用环境变量 PORT 修改
 *
 * 功能: 多设备数据同步、用户管理、报告存储
 * 数据持久化到本地 data/ 目录 (JSON文件)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ===== Data Layer =====
function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// Init default users if not exist
if (!fs.existsSync(USERS_FILE)) {
  saveJSON(USERS_FILE, {
    admin:      { password: '123456', role: 'supervisor', name: '管理员' },
    inspector1: { password: '123456', role: 'inspector',  name: '质检员1' },
    inspector2: { password: '123456', role: 'inspector',  name: '质检员2' },
    supervisor1:{ password: '123456', role: 'supervisor',  name: '主管1' },
  });
}
if (!fs.existsSync(REPORTS_FILE)) saveJSON(REPORTS_FILE, []);

// ===== MIME Types =====
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// ===== Helpers =====
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve(null); }
    });
    req.on('error', reject);
  });
}

function json(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

// ===== Server =====
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ===== API Routes =====

  // POST /api/login
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body?.username || !body?.password) return json(res, 400, { error: '请输入用户名和密码' });
    const users = loadJSON(USERS_FILE, {});
    const user = users[body.username];
    if (!user) return json(res, 401, { error: '用户不存在' });
    if (user.password !== body.password) return json(res, 401, { error: '密码错误' });
    if (body.role && user.role !== body.role) return json(res, 401, { error: `角色不匹配，该用户角色为: ${user.role === 'supervisor' ? '主管' : '质检员'}` });
    return json(res, 200, { username: body.username, role: user.role, name: user.name });
  }

  // GET /api/reports
  if (pathname === '/api/reports' && req.method === 'GET') {
    const reports = loadJSON(REPORTS_FILE, []);
    // Strip photo data from list view to save bandwidth
    const light = reports.map(r => ({ ...r, photos: undefined, _photoCount: Object.keys(r.photos || {}).length }));
    return json(res, 200, light);
  }

  // GET /api/reports/:id
  if (pathname.startsWith('/api/reports/') && req.method === 'GET') {
    const id = pathname.split('/api/reports/')[1];
    const reports = loadJSON(REPORTS_FILE, []);
    const report = reports.find(r => r.id === id);
    if (!report) return json(res, 404, { error: '报告不存在' });
    return json(res, 200, report);
  }

  // POST /api/reports  (create or update)
  if (pathname === '/api/reports' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body?.id) return json(res, 400, { error: '缺少报告ID' });
    let reports = loadJSON(REPORTS_FILE, []);
    const idx = reports.findIndex(r => r.id === body.id);
    body.updatedAt = new Date().toISOString();
    if (idx >= 0) reports[idx] = body;
    else reports.push(body);
    saveJSON(REPORTS_FILE, reports);
    return json(res, 200, { success: true, id: body.id });
  }

  // DELETE /api/reports/:id
  if (pathname.startsWith('/api/reports/') && req.method === 'DELETE') {
    const id = pathname.split('/api/reports/')[1];
    let reports = loadJSON(REPORTS_FILE, []);
    reports = reports.filter(r => r.id !== id);
    saveJSON(REPORTS_FILE, reports);
    return json(res, 200, { success: true });
  }

  // ===== Static Files =====
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Fallback: serve index.html for SPA
  if (!pathname.startsWith('/api/')) {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  // Get local IP for display
  const nets = require('os').networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) { localIP = cfg.address; break; }
    }
  }
  console.log(`\n========================================`);
  console.log(`  森雅验货系统服务器已启动`);
  console.log(`  本机访问: http://localhost:${PORT}`);
  console.log(`  局域网访问: http://${localIP}:${PORT}`);
  console.log(`  (其他手机/平板用局域网地址访问)`);
  console.log(`========================================\n`);
});
