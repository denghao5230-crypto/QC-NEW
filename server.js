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
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_KEY = process.env.ADMIN_KEY;

// ===== Simple JWT =====
function createToken(payload, expiresInHours = 72) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + expiresInHours * 3600 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + signature;
}

function verifyToken(token) {
  try {
    const [header, body, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
    if (signature !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function getAuthUser(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return verifyToken(auth.slice(7));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || stored.length === 0) return false;
  // Backward compatibility for old plaintext users.json entries.
  if (!stored.startsWith('scrypt$')) return String(password) === stored;

  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const salt = parts[1];
  const expectedHex = parts[2];
  if (!salt || !expectedHex) return false;

  try {
    const actualHex = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actualHex, 'hex'), Buffer.from(expectedHex, 'hex'));
  } catch {
    return false;
  }
}

function isHashedPassword(stored) {
  return typeof stored === 'string' && stored.startsWith('scrypt$');
}

function requireAuth(req, res) {
  const user = getAuthUser(req);
  if (!user) {
    json(res, 401, { error: '缺少或无效认证令牌' });
    return null;
  }
  return user;
}

function getReportOwner(report) {
  if (!report || typeof report !== 'object') return '';
  return String(report.createdBy || report.created_by || '');
}

function canAccessReport(currentUser, report) {
  if (!currentUser || !report) return false;
  if (currentUser.role === 'supervisor') return true;
  const owner = getReportOwner(report);
  return !!owner && owner === currentUser.username;
}

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
    admin:      { password: hashPassword('123456'), role: 'supervisor', name: '管理员' },
    inspector1: { password: hashPassword('123456'), role: 'inspector',  name: '质检员1' },
    inspector2: { password: hashPassword('123456'), role: 'inspector',  name: '质检员2' },
    supervisor1:{ password: hashPassword('123456'), role: 'supervisor',  name: '主管1' },
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ===== API Routes =====

  // GET /api/health
  if (pathname === '/api/health' && req.method === 'GET') {
    return json(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
  }

  // POST /api/login
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body?.username || !body?.password) return json(res, 400, { error: '请输入用户名和密码' });
    const users = loadJSON(USERS_FILE, {});
    const user = users[body.username];
    if (!user) return json(res, 401, { error: '用户不存在' });
    const valid = verifyPassword(body.password, user.password);
    if (!valid) return json(res, 401, { error: '密码错误' });
    // Transparent migration: plaintext -> hashed after first successful login.
    if (!isHashedPassword(user.password)) {
      users[body.username].password = hashPassword(body.password);
      saveJSON(USERS_FILE, users);
    }
    if (body.role && user.role !== body.role) return json(res, 401, { error: `角色不匹配，该用户角色为: ${user.role === 'supervisor' ? '主管' : '质检员'}` });
    const token = createToken({ username: body.username, role: user.role, name: user.name });
    return json(res, 200, { username: body.username, role: user.role, name: user.name, token });
  }

  // POST /api/register
  if (pathname === '/api/register' && req.method === 'POST') {
    const body = await readBody(req);
    const { username, password, name, role, adminKey } = body || {};
    if (!ADMIN_KEY || ADMIN_KEY.length < 16) {
      return json(res, 500, { error: '服务器配置错误：ADMIN_KEY 未设置或过短' });
    }
    if (!username || !password || !name || !role) {
      return json(res, 400, { error: '请填写所有字段' });
    }
    if (!['inspector', 'supervisor'].includes(role)) {
      return json(res, 400, { error: '角色无效，必须是 inspector 或 supervisor' });
    }
    if (adminKey !== ADMIN_KEY) {
      return json(res, 403, { error: '管理密钥错误' });
    }
    const users = loadJSON(USERS_FILE, {});
    if (users[username]) {
      return json(res, 409, { error: '用户名已存在' });
    }
    users[username] = { password: hashPassword(password), role, name };
    saveJSON(USERS_FILE, users);
    return json(res, 200, { success: true, username, role, name });
  }

  // GET /api/reports
  if (pathname === '/api/reports' && req.method === 'GET') {
    const currentUser = requireAuth(req, res);
    if (!currentUser) return;

    const reports = loadJSON(REPORTS_FILE, []);
    const visibleReports = currentUser.role === 'supervisor'
      ? reports
      : reports.filter(r => canAccessReport(currentUser, r));

    // Strip photo data from list view to save bandwidth
    const light = visibleReports.map(r => {
      const copy = { ...r };
      const photoKeys = Object.keys(r.photos || {});
      copy._photoCount = photoKeys.length;
      copy.photos = {};
      photoKeys.forEach(k => { copy.photos[k] = '__HAS_PHOTO__'; });
      return copy;
    });
    return json(res, 200, light);
  }

  // GET /api/reports/:id
  if (pathname.startsWith('/api/reports/') && req.method === 'GET') {
    const currentUser = requireAuth(req, res);
    if (!currentUser) return;

    const id = pathname.split('/api/reports/')[1];
    const reports = loadJSON(REPORTS_FILE, []);
    const report = reports.find(r => r.id === id);
    if (!report) return json(res, 404, { error: '报告不存在' });
    if (!canAccessReport(currentUser, report)) return json(res, 403, { error: '无权查看此报告' });
    return json(res, 200, report);
  }

  // POST /api/reports  (create or update)
  if (pathname === '/api/reports' && req.method === 'POST') {
    const currentUser = requireAuth(req, res);
    if (!currentUser) return;

    const body = await readBody(req);
    if (!body?.id) return json(res, 400, { error: '缺少报告ID' });
    let reports = loadJSON(REPORTS_FILE, []);
    const idx = reports.findIndex(r => r.id === body.id);

    if (idx >= 0 && !canAccessReport(currentUser, reports[idx])) {
      return json(res, 403, { error: '无权修改此报告' });
    }
    if ((body.status === 'approved' || body.status === 'rejected') && currentUser.role !== 'supervisor') {
      return json(res, 403, { error: '只有主管可以审批报告' });
    }

    const owner = idx >= 0 ? getReportOwner(reports[idx]) : '';
    if (currentUser.role !== 'supervisor') {
      body.createdBy = owner || currentUser.username;
    } else if (!body.createdBy) {
      body.createdBy = owner || currentUser.username;
    }

    body.updatedAt = new Date().toISOString();
    if (idx >= 0) reports[idx] = body;
    else reports.push(body);
    saveJSON(REPORTS_FILE, reports);
    return json(res, 200, { success: true, id: body.id });
  }

  // DELETE /api/reports/:id
  if (pathname.startsWith('/api/reports/') && req.method === 'DELETE') {
    const currentUser = requireAuth(req, res);
    if (!currentUser) return;

    const id = pathname.split('/api/reports/')[1];
    const reports = loadJSON(REPORTS_FILE, []);
    const target = reports.find(r => r.id === id);
    if (!target) return json(res, 404, { error: '报告不存在' });
    if (!canAccessReport(currentUser, target)) return json(res, 403, { error: '无权删除此报告' });

    const nextReports = reports.filter(r => r.id !== id);
    saveJSON(REPORTS_FILE, nextReports);
    return json(res, 200, { success: true });
  }

  // DELETE /api/reports?id=xxx (compat with app.js)
  if (pathname === '/api/reports' && req.method === 'DELETE') {
    const currentUser = requireAuth(req, res);
    if (!currentUser) return;

    const id = url.searchParams.get('id');
    if (!id) return json(res, 400, { error: '缺少报告ID' });
    const reports = loadJSON(REPORTS_FILE, []);
    const target = reports.find(r => r.id === id);
    if (!target) return json(res, 404, { error: '报告不存在' });
    if (!canAccessReport(currentUser, target)) return json(res, 403, { error: '无权删除此报告' });

    const nextReports = reports.filter(r => r.id !== id);
    saveJSON(REPORTS_FILE, nextReports);
    return json(res, 200, { success: true, deleted: id });
  }

  // GET /api/photos?reportId=xxx[&slot=0]
  if (pathname === '/api/photos' && req.method === 'GET') {
    const currentUser = requireAuth(req, res);
    if (!currentUser) return;

    const reportId = url.searchParams.get('reportId');
    const slot = url.searchParams.get('slot');
    if (!reportId) return json(res, 400, { error: '缺少 reportId' });

    const reports = loadJSON(REPORTS_FILE, []);
    const report = reports.find(r => r.id === reportId);
    if (!report) return json(res, 404, { error: '报告不存在' });
    if (!canAccessReport(currentUser, report)) return json(res, 403, { error: '无权查看此报告照片' });
    const photos = report.photos || {};

    if (slot !== null) {
      const dataUrl = photos[slot] || null;
      return json(res, 200, { dataUrl });
    }

    const slots = {};
    Object.keys(photos).forEach(k => {
      if (typeof photos[k] === 'string' && photos[k].startsWith('data:image/')) {
        slots[k] = { stored: true };
      }
    });
    return json(res, 200, { reportId, slots });
  }

  // POST /api/photos
  if (pathname === '/api/photos' && req.method === 'POST') {
    const currentUser = requireAuth(req, res);
    if (!currentUser) return;

    const body = await readBody(req);
    const { reportId, slotIndex, dataUrl } = body || {};
    if (!reportId) return json(res, 400, { error: '缺少 reportId' });
    if (slotIndex === undefined || slotIndex === null) return json(res, 400, { error: '缺少 slotIndex' });
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return json(res, 400, { error: '无效的照片数据格式，必须为 data:image/*' });
    }

    const reports = loadJSON(REPORTS_FILE, []);
    const idx = reports.findIndex(r => r.id === reportId);
    if (idx < 0) return json(res, 404, { error: '报告不存在' });
    if (!canAccessReport(currentUser, reports[idx])) return json(res, 403, { error: '无权修改此报告照片' });

    if (!reports[idx].photos || typeof reports[idx].photos !== 'object') reports[idx].photos = {};
    reports[idx].photos[String(slotIndex)] = dataUrl;
    reports[idx].updatedAt = new Date().toISOString();
    saveJSON(REPORTS_FILE, reports);
    return json(res, 200, { success: true, reportId, slotIndex });
  }

  // DELETE /api/photos?reportId=xxx[&slot=0]
  if (pathname === '/api/photos' && req.method === 'DELETE') {
    const currentUser = requireAuth(req, res);
    if (!currentUser) return;

    const reportId = url.searchParams.get('reportId');
    const slot = url.searchParams.get('slot');
    if (!reportId) return json(res, 400, { error: '缺少 reportId' });

    const reports = loadJSON(REPORTS_FILE, []);
    const idx = reports.findIndex(r => r.id === reportId);
    if (idx < 0) return json(res, 404, { error: '报告不存在' });
    if (!canAccessReport(currentUser, reports[idx])) return json(res, 403, { error: '无权删除此报告照片' });

    if (!reports[idx].photos || typeof reports[idx].photos !== 'object') reports[idx].photos = {};
    if (slot !== null) {
      delete reports[idx].photos[String(slot)];
    } else {
      reports[idx].photos = {};
    }
    reports[idx].updatedAt = new Date().toISOString();
    saveJSON(REPORTS_FILE, reports);
    return json(res, 200, { success: true, reportId, slot });
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
