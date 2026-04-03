// ===== 森雅验货系统 Senia Inspection PWA - Main Application =====

// ===== CONFIG =====
const API_BASE = '/api';

// ===== APP STATE =====
const APP = {
  user: null,
  token: null, // JWT token
  reports: [],
  currentReport: null,
  currentTab: 'list',
  editingPhotoSlot: null,
  db: null
};

// ===== XSS PROTECTION =====
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ===== API LAYER (with JWT) =====
async function apiFetch(endpoint, opts = {}) {
  const url = API_BASE + endpoint;
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  // Attach JWT token if available
  if (APP.token) {
    headers['Authorization'] = 'Bearer ' + APP.token;
  }
  const resp = await fetch(url, { ...opts, headers });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : null;
  if (!resp.ok) {
    // Token expired or invalid → auto logout
    if (resp.status === 401 && APP.user) {
      showToast('登录已过期，请重新登录', 'warning');
      logout();
      throw new Error('TOKEN_EXPIRED');
    }
    throw new Error((data && data.error) || 'API 请求失败: ' + resp.status);
  }
  return data;
}

let serverOnline = false;

// ===== OFFLINE AUTH (cached sessions) =====
const OFFLINE_USERS = {};

function cacheUserSession(username, role, name) {
  OFFLINE_USERS[username] = { role, name, cachedAt: Date.now() };
  try { localStorage.setItem('senia_cached_users', JSON.stringify(OFFLINE_USERS)); } catch (e) {}
}

function loadCachedUsers() {
  try {
    const cached = localStorage.getItem('senia_cached_users');
    if (cached) Object.assign(OFFLINE_USERS, JSON.parse(cached));
  } catch (e) {}
}
loadCachedUsers();

// Restore saved token
try {
  const savedToken = localStorage.getItem('senia_jwt');
  if (savedToken) APP.token = savedToken;
} catch (e) {}

// ===== CONSTANTS =====
const GLOSS_OPTIONS = ['7±1°', '3~5', '5~8', '6~10', '8~12', '自定义'];
const THICKNESS_STD_OPTIONS = ['±0.13mm', '±0.15mm', '±0.20mm', '±0.25mm', '±0.30mm', '±0.50mm', '自定义'];

const INSPECT_ITEMS = [
  { key: 'heightDiff', name: '高低差', en: 'Height Difference', my: 'အမြင့်အနိမ့်ခြားနားချက်', std: '≤0.10mm' },
  { key: 'jointGap', name: '拼接离缝', en: 'Joint Gap', my: 'ဆက်ကြောင်းကြားကွာဟချက်', std: '≤0.10mm' },
  { key: 'colorMatch', name: '颜色对比', en: 'Color Matching', my: 'အရောင်တိုက်စစ်ခြင်း', std: '签样' },
  { key: 'palletLabel', name: '托盘标', en: 'Pallet Label', my: 'ခံပြားအညွှန်း', std: '客户要求' },
  { key: 'inkjet', name: '喷码', en: 'Inkjet Printing', my: 'ကုဒ်ရိုက်နှိပ်ခြင်း', std: '客户要求' },
  { key: 'pallet', name: '托盘', en: 'Pallet', my: 'ခံပြား', std: '15%' },
  { key: 'boxWeight', name: '单包重', en: 'Box Weight', my: 'တစ်ပုံးအလေးချိန်', std: '订单要求' },
  { key: 'palletWeight', name: '单拖重', en: 'Weight/Pallet', my: 'ခံပြားအလေးချိန်', std: '订单要求' },
  { key: 'sampling', name: '抽样', en: 'Sampling', my: 'နမူနာယူခြင်း', std: '客户要求' },
  { key: 'frontSideMark', name: '正侧唛', en: 'Front/Side Mark', my: 'ရှေ့/ဘေးအမှတ်', std: '客户要求' },
  { key: 'shippingMark', name: '端唛', en: 'Shipping Mark', my: 'သင်္ဘောတင်အမှတ်', std: '客户要求' },
  { key: 'carton', name: '纸箱', en: 'Carton', my: 'စက္ကူပုံး', std: '客户要求' },
  { key: 'packing', name: '包装', en: 'Packing', my: 'ထုပ်ပိုးခြင်း', std: '客户要求' },
  { key: 'palletizing', name: '打托', en: 'Palletizing', my: 'ခံပြားတင်ခြင်း', std: '客户要求' },
  { key: 'manual', name: '说明书', en: 'Manual', my: 'လမ်းညွှန်စာအုပ်', std: '客户要求' },
];

const PHOTO_SLOTS = [
  '签字样板 Signed Sample နမူနာဓာတ်ပုံ',
  '纸盒标签 Box Label ပုံးအညွှန်း',
  '纸箱条形码 Barcode ဘားကုဒ်',
  '托盘标 Pallet Label ခံပြားအညွှန်း',
  '托盘标条形码 Pallet Barcode',
  '背面喷码 Backside Inkjet ကျောဘက်ကုဒ်',
  '整托照片 Full Pallet',
  '每包重量 Box Weight တစ်ပုံးအလေးချိန်',
  '托盘含水率 Moisture အစိုဓာတ်',
  '长度1 Length အလျား', '长度2 Length အလျား', '长度3 Length အလျား',
  '宽度1 Width အနံ', '宽度2 Width အနံ', '宽度3 Width အနံ',
  '厚度1 Thickness အထူ', '厚度2 Thickness အထူ', '厚度3 Thickness အထူ',
  '拼装1 Assembly တပ်ဆင်', '拼装2 Assembly တပ်ဆင်', '拼装3 Assembly တပ်ဆင်', '拼装4 Assembly တပ်ဆင်',
  '光泽度1 Gloss တောက်ပမှု', '光泽度2 Gloss တောက်ပမှု',
  '倒角-长边 Chamfer-Long', '倒角-短边 Chamfer-Short',
  '纸盒 Box ပုံးငယ်', '背膜花纹 Back Film Pattern', '其他 Others',
];

// ===== IndexedDB (offline fallback) =====
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('InspectionDB', 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('reports')) db.createObjectStore('reports', { keyPath: 'id' });
    };
    req.onsuccess = e => { APP.db = e.target.result; resolve(APP.db); };
    req.onerror = e => reject(e);
  });
}

async function localSave(report) {
  if (!APP.db) return;
  return new Promise(r => {
    const tx = APP.db.transaction('reports', 'readwrite');
    tx.objectStore('reports').put(report);
    tx.oncomplete = () => r();
  });
}

async function localGetAll() {
  if (!APP.db) return [];
  return new Promise(r => {
    const tx = APP.db.transaction('reports', 'readonly');
    const req = tx.objectStore('reports').getAll();
    req.onsuccess = () => r(req.result || []);
    req.onerror = () => r([]);
  });
}

// ===== Debounce utility =====
function debounce(fn, delay = 500) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
const debouncedAutoSave = debounce(() => {
  if (APP.currentReport) localSave(APP.currentReport);
}, 1000);

// ===== DIMENSION VALIDATION =====

/**
 * Parse size string like "1219*182*4.0+1.0 IXPE" into nominal values
 */
function parseSizeNominals(sizeStr) {
  const result = { length: null, width: null, thickness: null };
  if (!sizeStr) return result;
  // Match patterns like "1219*182*4.0", "1220×183×5.0+1.0 IXPE"
  const m = String(sizeStr).match(/([\d.]+)\s*[*×x]\s*([\d.]+)\s*[*×x]\s*([\d.]+)/i);
  if (m) {
    result.length = parseFloat(m[1]);
    result.width = parseFloat(m[2]);
    result.thickness = parseFloat(m[3]);
  }
  return result;
}

/**
 * Parse tolerance string into structured format
 * "±0.5mm" → { type:'tolerance', tolerance:0.5 }
 * "7±1°"  → { type:'absoluteTolerance', target:7, tolerance:1 }
 * "3~5"   → { type:'range', min:3, max:5 }
 * "自定义" → null (skip validation)
 */
function parseTolerance(stdStr) {
  if (!stdStr || stdStr === '自定义') return null;

  // "7±1°" pattern (absolute target ± tolerance)
  let m = stdStr.match(/^([\d.]+)\s*[±]\s*([\d.]+)/);
  if (m) {
    return { type: 'absoluteTolerance', target: parseFloat(m[1]), tolerance: parseFloat(m[2]) };
  }

  // "±0.5mm" pattern (relative tolerance)
  m = stdStr.match(/[±]\s*([\d.]+)/);
  if (m) {
    return { type: 'tolerance', tolerance: parseFloat(m[1]) };
  }

  // "3~5" or "3-5" range pattern
  m = stdStr.match(/^([\d.]+)\s*[~\-]\s*([\d.]+)/);
  if (m) {
    return { type: 'range', min: parseFloat(m[1]), max: parseFloat(m[2]) };
  }

  return null;
}

/**
 * Evaluate dimension values against standard
 * Returns { result: 'PASS'|'FAIL'|'', outOfSpec: boolean[] }
 */
function evaluateDimension(values, stdStr, nominal) {
  const filled = values.filter(v => v !== '' && v !== null && v !== undefined);
  if (filled.length === 0) return { result: '', outOfSpec: values.map(() => false) };

  const parsed = parseTolerance(stdStr);
  if (!parsed) return { result: 'PASS', outOfSpec: values.map(() => false) };

  const outOfSpec = [];
  let anyFail = false;

  for (const v of values) {
    if (v === '' || v === null || v === undefined) {
      outOfSpec.push(false);
      continue;
    }
    const num = parseFloat(v);
    if (isNaN(num)) { outOfSpec.push(false); continue; }

    let isOut = false;
    if (parsed.type === 'tolerance' && nominal != null) {
      isOut = num < (nominal - parsed.tolerance) || num > (nominal + parsed.tolerance);
    } else if (parsed.type === 'absoluteTolerance') {
      isOut = num < (parsed.target - parsed.tolerance) || num > (parsed.target + parsed.tolerance);
    } else if (parsed.type === 'range') {
      isOut = num < parsed.min || num > parsed.max;
    }
    outOfSpec.push(isOut);
    if (isOut) anyFail = true;
  }

  return { result: anyFail ? 'FAIL' : 'PASS', outOfSpec };
}

// ===== Server helpers =====
async function checkServer() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(API_BASE + '/health', { signal: ctrl.signal });
    clearTimeout(timer);
    serverOnline = resp.ok;
  } catch (e) { serverOnline = false; console.warn('Server check:', e.message || 'offline'); }
  updateSyncUI();
}

function updateSyncUI() {
  const el = document.getElementById('syncStatus');
  const loginEl = document.getElementById('serverStatus');
  if (el) {
    el.innerHTML = serverOnline
      ? '<span class="sync-dot online"></span> 已同步 (云端)'
      : '<span class="sync-dot offline"></span> 离线';
  }
  if (loginEl) {
    loginEl.textContent = serverOnline ? '✅ 云端已连接 (多设备同步)' : '⚠️ 离线模式 (仅本机数据)';
    loginEl.style.color = serverOnline ? '#27ae60' : '#e67e22';
  }
}

async function syncReports() {
  if (serverOnline) {
    try {
      const cloudReports = await apiFetch('/reports');
      if (!cloudReports) { APP.reports = await localGetAll(); return; }
      const localReports = await localGetAll();
      const localMap = {};
      localReports.forEach(r => { localMap[r.id] = r; });

      // Merge: cloud data + preserve local photos
      for (const cr of cloudReports) {
        const local = localMap[cr.id];
        if (!cr.photos) cr.photos = {};

        // Step 1: Preserve all local photos (highest priority — never lose local data)
        if (local && local.photos) {
          Object.keys(local.photos).forEach(k => {
            if (local.photos[k] && local.photos[k] !== '__HAS_PHOTO__') {
              cr.photos[k] = local.photos[k];
            }
          });
        }

        // Step 2: For cloud photos that are placeholders and we don't have locally,
        // try to fetch from the new photos API (enables cross-device sync)
        const missingSlots = Object.keys(cr.photos).filter(k => cr.photos[k] === '__HAS_PHOTO__');
        if (missingSlots.length > 0) {
          // Lazy-load: fetch individual photos on demand, not during sync
          // Mark them so the UI can trigger lazy loading
          missingSlots.forEach(k => {
            cr.photos[k] = '__CLOUD_PHOTO__'; // distinguishable from local placeholder
          });
        }

        cr.syncStatus = 'synced';
        await localSave(cr);
      }

      // Also keep local-only reports (not yet synced)
      for (const lr of localReports) {
        if (!cloudReports.find(cr => cr.id === lr.id) && lr.syncStatus === 'pending') {
          cloudReports.push(lr);
        }
      }

      APP.reports = cloudReports;
    } catch (e) {
      if (e.message === 'TOKEN_EXPIRED') return;
      console.warn('Sync failed:', e.message);
      showToast('同步失败，使用本地数据', 'warning');
      APP.reports = await localGetAll();
    }
  } else {
    APP.reports = await localGetAll();
  }
}

/**
 * Lazy-load a single photo from cloud when user views it
 */
async function fetchCloudPhoto(reportId, slotIndex, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await apiFetch(`/photos?reportId=${reportId}&slot=${slotIndex}`);
      if (result && result.dataUrl && result.dataUrl.startsWith('data:')) {
        // Save to current report and local DB
        if (APP.currentReport && APP.currentReport.id === reportId) {
          APP.currentReport.photos[slotIndex] = result.dataUrl;
          await localSave(APP.currentReport);
        }
        // Also update in reports array
        const report = APP.reports.find(r => r.id === reportId);
        if (report) {
          report.photos[slotIndex] = result.dataUrl;
          await localSave(report);
        }
        return result.dataUrl;
      }
      // 如果返回的不是有效图片数据，不要重试
      if (result && result.dataUrl === null) return null;
    } catch (e) {
      console.warn(`Failed to fetch photo ${slotIndex} for ${reportId} (attempt ${attempt + 1}):`, e.message);
      if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

/**
 * UI handler: lazy-load a cloud photo and refresh the slot
 */
async function loadCloudPhoto(reportId, slotIndex) {
  const slot = document.getElementById(`photo-slot-${slotIndex}`);
  if (slot) {
    slot.innerHTML = '<div class="icon" style="color:#3498db">⏳</div><div style="font-size:.6rem;color:#999">加载中...</div>';
  }
  const dataUrl = await fetchCloudPhoto(reportId, slotIndex);
  if (dataUrl && slot) {
    slot.innerHTML = `<img src="${dataUrl}"><button class="delete-photo" onclick="event.stopPropagation();delPhoto(${slotIndex})">✕</button><div class="label">${PHOTO_SLOTS[slotIndex] || ''}</div>`;
    slot.classList.remove('cloud-pending');
    slot.setAttribute('onclick', `openPhotoMenu(${slotIndex})`);
  } else if (slot) {
    slot.innerHTML = '<div class="icon" style="color:#e74c3c">⚠</div><div style="font-size:.6rem;color:#e74c3c">加载失败</div><div class="label">' + (PHOTO_SLOTS[slotIndex] || '') + '</div>';
  }
}

async function saveReport(report) {
  report.updatedAt = new Date().toISOString();
  await localSave(report);
  if (serverOnline) {
    try {
      // Clone report and ALWAYS strip photos from the main payload
      // Photos are uploaded separately via /api/photos endpoint
      const cloudReport = JSON.parse(JSON.stringify(report));
      const photosToSync = cloudReport.photos || {};
      cloudReport.photos = {}; // Always strip photos from report JSON

      await apiFetch('/reports', { method: 'POST', body: JSON.stringify(cloudReport) });

      // Upload photos individually (each within Netlify's body limit)
      let photoErrors = 0;
      const photoKeys = Object.keys(photosToSync).filter(k =>
        photosToSync[k] &&
        photosToSync[k] !== '__HAS_PHOTO__' &&
        photosToSync[k] !== '__CLOUD_PHOTO__' &&
        photosToSync[k].startsWith('data:')  // 只上传真正的base64数据
      );
      for (const slotIdx of photoKeys) {
        try {
          await apiFetch('/photos', {
            method: 'POST',
            body: JSON.stringify({
              reportId: report.id,
              slotIndex: parseInt(slotIdx),
              dataUrl: photosToSync[slotIdx]
            })
          });
        } catch (photoErr) {
          console.warn(`Photo ${slotIdx} upload failed:`, photoErr.message);
          photoErrors++;
        }
      }
      if (photoErrors > 0) {
        showToast(`${photoErrors}张照片上传失败，将在下次自动重试`, 'warning');
      }

      // Sync photo deletions to cloud
      if (report._deletedPhotoSlots && report._deletedPhotoSlots.length > 0) {
        for (const slot of report._deletedPhotoSlots) {
          try {
            await apiFetch(`/photos?reportId=${report.id}&slot=${slot}`, { method: 'DELETE' });
          } catch (delErr) {
            console.warn(`Photo ${slot} cloud delete failed:`, delErr.message);
          }
        }
        delete report._deletedPhotoSlots;
      }

      // 只有所有照片都上传成功才标记为synced
      report.syncStatus = photoErrors > 0 ? 'pending' : 'synced';
      await localSave(report);
    } catch (e) {
      if (e.message === 'TOKEN_EXPIRED') return;
      console.warn('Cloud save failed:', e.message);
      report.syncStatus = 'pending';
      await localSave(report);
      showToast('云端保存失败，已保存到本地', 'warning');
    }
  } else {
    report.syncStatus = 'pending';
    await localSave(report);
  }
}

async function syncPendingReports() {
  const local = await localGetAll();
  const pending = local.filter(r => r.syncStatus === 'pending');
  let synced = 0;
  for (const r of pending) {
    try {
      const cloudReport = JSON.parse(JSON.stringify(r));
      const photosToSync = cloudReport.photos || {};
      cloudReport.photos = {}; // Strip photos, upload separately
      await apiFetch('/reports', { method: 'POST', body: JSON.stringify(cloudReport) });

      // Upload photos individually
      const photoKeys = Object.keys(photosToSync).filter(k =>
        photosToSync[k] &&
        photosToSync[k] !== '__HAS_PHOTO__' &&
        photosToSync[k] !== '__CLOUD_PHOTO__' &&
        photosToSync[k].startsWith('data:')  // 只上传真正的base64数据
      );
      for (const slotIdx of photoKeys) {
        try {
          await apiFetch('/photos', {
            method: 'POST',
            body: JSON.stringify({
              reportId: r.id,
              slotIndex: parseInt(slotIdx),
              dataUrl: photosToSync[slotIdx]
            })
          });
        } catch (photoErr) {
          console.warn(`Photo ${slotIdx} sync failed for ${r.id}:`, photoErr.message);
        }
      }

      r.syncStatus = 'synced';
      await localSave(r);
      synced++;
    } catch (e) {
      if (e.message === 'TOKEN_EXPIRED') return;
      console.warn('Sync failed for', r.id, e.message);
    }
  }
  if (synced > 0) showToast(`已同步 ${synced} 份报告`, 'success');
  if (synced < pending.length) {
    showToast(`${pending.length - synced} 份报告同步失败`, 'warning');
  }
}

// ===== INIT =====
async function init() {
  try { await openDB(); } catch (e) { console.warn('IndexedDB failed:', e); }
  await checkServer();
  APP.reports = await localGetAll();
}
init();

// ===== ONLINE/OFFLINE LISTENERS =====
window.addEventListener('online', async () => {
  serverOnline = true;
  updateSyncUI();
  showToast('网络已恢复，正在同步...', 'info');
  await syncPendingReports();
});

window.addEventListener('offline', () => {
  serverOnline = false;
  updateSyncUI();
  showToast('已切换到离线模式', 'warning');
});

// ===== LOGIN =====
async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const role = document.getElementById('loginRole').value;
  if (!username) { showToast('请输入用户名', 'error'); return; }
  if (!password) { showToast('请输入密码', 'error'); return; }

  if (serverOnline) {
    try {
      const resp = await apiFetch('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      if (!resp || !resp.username) { showToast('用户名或密码错误', 'error'); return; }
      if (resp.role !== role) {
        showToast('角色不匹配，该用户角色为: ' + (resp.role === 'supervisor' ? '主管' : '质检员'), 'error');
        return;
      }
      APP.user = { username: resp.username, role: resp.role, name: resp.name };
      // Store JWT token
      if (resp.token) {
        APP.token = resp.token;
        try { localStorage.setItem('senia_jwt', resp.token); } catch (e) {}
      }
      cacheUserSession(resp.username, resp.role, resp.name);
    } catch (e) {
      showToast('登录失败: ' + e.message, 'error'); return;
    }
  } else {
    const cached = OFFLINE_USERS[username];
    if (cached) {
      if (cached.role !== role) { showToast('角色不匹配', 'error'); return; }
      APP.user = { username, role: cached.role, name: cached.name };
    } else {
      showToast('离线模式下无法登录新用户，请联网后再试', 'error'); return;
    }
  }

  await syncReports();
  document.getElementById('loginPage').classList.remove('active');
  document.getElementById('mainApp').classList.add('active');
  document.getElementById('userBadge').textContent = APP.user.name;
  switchTab('list');
  window.scrollTo(0, 0);
}

function logout() {
  APP.user = null;
  APP.token = null;
  APP.currentReport = null;
  try { localStorage.removeItem('senia_jwt'); } catch (e) {}
  document.getElementById('mainApp').classList.remove('active');
  document.getElementById('loginPage').classList.add('active');
  window.scrollTo(0, 0);
}

// ===== TABS =====
function switchTab(tab) {
  APP.currentTab = tab;
  document.querySelectorAll('#bottomNav button').forEach(b => b.classList.remove('active'));
  const tabEl = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (tabEl) tabEl.classList.add('active');
  if (tab === 'list') renderReportList();
  else if (tab === 'new') startNewReport();
  else if (tab === 'me') renderProfile();
  else if (tab === 'trash') renderTrash();
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast toast-' + type + ' show';
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ===== NEW REPORT =====
function createEmptyReport() {
  const now = new Date();
  return {
    id: 'RPT-' + Date.now(), date: now.toISOString().slice(0, 10),
    poOrderNo: '', colorFilmModel: '', productType: 'SPC', size: '', wearLayerThickness: '',
    lockType: 'I4F', embossedTexture: '', model: '',
    appearance: { testCount: 24, defectCount: 0, testValue: '', result: 'PASS' },
    dimensions: {
      length: Array(6).fill(''), width: Array(6).fill(''), thickness: Array(6).fill(''), gloss: Array(6).fill(''),
      lengthStd: '±0.5mm', widthStd: '±0.10mm', thicknessStd: '±0.13mm', glossStd: '7±1°'
    },
    inspectItems: {}, inspectRemarks: {},
    packaging: { pcsPerBox: 12, layersPerBox: 1, boxesPerPallet: 5, layersPerPallet: 10, manualsPerBox: 0 },
    boxWeightKg: '', palletWeightKg: '', finalResult: 'pass', photos: {},
    inspector: APP.user ? APP.user.name : '', reviewer: '',
    status: 'draft', createdAt: now.toISOString(), updatedAt: now.toISOString(),
    createdBy: APP.user ? APP.user.username : ''
  };
}

function startNewReport() {
  if (APP.user.role === 'supervisor') { showToast('主管无法新建报告', 'error'); switchTab('list'); return; }
  APP.currentReport = createEmptyReport();
  renderReportForm();
}

async function editReport(id) {
  const r = APP.reports.find(r => r.id === id);
  if (!r) return;
  APP.currentReport = JSON.parse(JSON.stringify(r));
  // Migrate old 10-element arrays to 6
  ['length', 'width', 'thickness', 'gloss'].forEach(k => {
    if (APP.currentReport.dimensions[k] && APP.currentReport.dimensions[k].length > 6) {
      APP.currentReport.dimensions[k] = APP.currentReport.dimensions[k].slice(0, 6);
    }
  });
  renderReportForm();
}

// ===== FORM UPDATE FUNCTIONS (renamed from UF/UN/UP/UD/UDS) =====
function updateField(key, val) {
  debouncedAutoSave();
  APP.currentReport[key] = val;
  // Re-validate dimensions when size changes (nominals depend on it)
  if (key === 'size') updateDimensionUI();
}

function updateNested(obj, key, val) {
  debouncedAutoSave();
  if (!APP.currentReport[obj]) APP.currentReport[obj] = {};
  const numKeys = ['testCount', 'defectCount', 'pcsPerBox', 'layersPerBox', 'boxesPerPallet', 'layersPerPallet'];
  APP.currentReport[obj][key] = numKeys.some(nk => key.includes(nk)) ? (parseInt(val) || 0) : val;
}

function updatePackaging(key, val) {
  updateNested('packaging', key, val);
}

function updateDimension(key, idx, val) {
  debouncedAutoSave();
  if (!APP.currentReport.dimensions) APP.currentReport.dimensions = {};
  if (!APP.currentReport.dimensions[key]) APP.currentReport.dimensions[key] = [];
  APP.currentReport.dimensions[key][idx] = val;
  updateDimensionUI();
}

function updateDimStandard(key, val) {
  debouncedAutoSave();
  if (!APP.currentReport.dimensions) APP.currentReport.dimensions = {};
  APP.currentReport.dimensions[key] = val;
  updateDimensionUI();
}

/**
 * Update dimension validation UI (highlight out-of-spec inputs)
 */
function updateDimensionUI() {
  const r = APP.currentReport;
  if (!r) return;
  const nominals = parseSizeNominals(r.size);
  const dimConfigs = [
    { key: 'length', std: r.dimensions.lengthStd, nominal: nominals.length },
    { key: 'width', std: r.dimensions.widthStd, nominal: nominals.width },
    { key: 'thickness', std: r.dimensions.thicknessStd, nominal: nominals.thickness },
    { key: 'gloss', std: r.dimensions.glossStd, nominal: null },
  ];

  dimConfigs.forEach(cfg => {
    const result = evaluateDimension(r.dimensions[cfg.key], cfg.std, cfg.nominal);
    // Update input styling
    const inputs = document.querySelectorAll(`[data-dim="${cfg.key}"]`);
    inputs.forEach((input, i) => {
      if (result.outOfSpec[i]) {
        input.classList.add('out-of-spec');
      } else {
        input.classList.remove('out-of-spec');
      }
    });
    // Update result badge
    const badge = document.getElementById(`dimResult-${cfg.key}`);
    if (badge) {
      if (result.result === '') {
        badge.textContent = '';
        badge.className = 'dim-result';
      } else if (result.result === 'PASS') {
        badge.textContent = '✅ PASS';
        badge.className = 'dim-result pass';
      } else {
        badge.textContent = '❌ FAIL';
        badge.className = 'dim-result fail';
      }
    }
  });
}

function setInspect(key, val) {
  debouncedAutoSave();
  if (!APP.currentReport.inspectItems) APP.currentReport.inspectItems = {};
  APP.currentReport.inspectItems[key] = val;
  renderReportForm();
  showStep(2, document.querySelectorAll('.tabs button')[2]);
}

function setFinalResult(val) {
  debouncedAutoSave();
  APP.currentReport.finalResult = val;
}

function showStep(n, btn) {
  if (btn) btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.form-step').forEach(el => el.style.display = 'none');
  const el = document.getElementById('step' + n);
  if (el) el.style.display = 'block';
}

// ===== RENDER FORM =====
function renderReportForm() {
  const r = APP.currentReport;
  const isReadOnly = APP.user.role === 'supervisor' || r.status === 'approved';
  const ro = isReadOnly ? 'readonly' : '';
  const dis = isReadOnly ? 'disabled' : '';

  document.getElementById('headerTitle').textContent = r.status === 'draft' ? '编辑报告 Edit' : '查看报告 View';

  const glossOptions = GLOSS_OPTIONS.map(o =>
    `<option value="${o}" ${r.dimensions.glossStd === o ? 'selected' : ''}>${o}</option>`
  ).join('');
  const thicknessStdOptions = THICKNESS_STD_OPTIONS.map(o =>
    `<option value="${o}" ${r.dimensions.thicknessStd === o ? 'selected' : ''}>${o}</option>`
  ).join('');

  let html = `
  <div class="tabs">
    <button class="active" onclick="showStep(0,this)">基本信息</button>
    <button onclick="showStep(1,this)">尺寸检测</button>
    <button onclick="showStep(2,this)">检验项目</button>
    <button onclick="showStep(3,this)">照片</button>
  </div>

  <!-- STEP 0: Basic Info -->
  <div class="form-step" id="step0">
    <div class="card"><div class="card-header">📋 基本信息 Basic Info</div><div class="card-body">
      <div class="form-row">
        <div class="field"><label>日期 Date</label><input type="date" value="${r.date}" onchange="updateField('date',this.value)" ${ro}></div>
        <div class="field"><label>PO订单号 Order No.</label><input value="${escapeHtml(r.poOrderNo)}" onchange="updateField('poOrderNo',this.value)" placeholder="816529" ${ro}></div>
      </div>
      <div class="form-row">
        <div class="field"><label>彩膜型号 Color Film</label><input value="${escapeHtml(r.colorFilmModel)}" onchange="updateField('colorFilmModel',this.value)" placeholder="LQ15179-1" ${ro}></div>
        <div class="field"><label>产品类别 Product</label>
          <select onchange="updateField('productType',this.value)" ${dis}>${['SPC', 'LSPC', 'WPC', 'LVT'].map(o => `<option ${r.productType === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="field"><label>尺寸 Size</label><input value="${escapeHtml(r.size)}" onchange="updateField('size',this.value)" placeholder="1219*182*4.0+1.0 IXPE" ${ro}></div>
        <div class="field"><label>耐磨层 Wear Layer</label><input value="${escapeHtml(r.wearLayerThickness)}" onchange="updateField('wearLayerThickness',this.value)" placeholder="0.5" ${ro}></div>
      </div>
      <div class="form-row">
        <div class="field"><label>扣型 Lock Type</label>
          <select onchange="updateField('lockType',this.value)" ${dis}>${['I4F', 'Unilin', 'Other'].map(o => `<option ${r.lockType === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
        </div>
        <div class="field"><label>压纹 Embossed</label><input value="${escapeHtml(r.embossedTexture)}" onchange="updateField('embossedTexture',this.value)" placeholder="ST01-B" ${ro}></div>
      </div>
      <div class="form-row">
        <div class="field"><label>型号 Model</label><input value="${escapeHtml(r.model)}" onchange="updateField('model',this.value)" placeholder="P20_400" ${ro}></div>
      </div>
    </div></div>
    <div class="card"><div class="card-header">👁 外观 Appearance</div><div class="card-body">
      <div class="form-row">
        <div class="field"><label>检测数量(片) Test Count</label><input type="number" value="${r.appearance.testCount}" onchange="updateNested('appearance','testCount',this.value)" ${ro}></div>
        <div class="field"><label>不合格(片) Defects</label><input type="number" value="${r.appearance.defectCount}" onchange="updateNested('appearance','defectCount',this.value)" ${ro}></div>
      </div>
    </div></div>
    <div class="card"><div class="card-header">📦 包装 Packing</div><div class="card-body">
      <div class="pkg-row"><span>(</span><input type="number" value="${r.packaging.pcsPerBox}" onchange="updatePackaging('pcsPerBox',this.value)" ${ro}><span>)片/箱 ×(</span>
        <input type="number" value="${r.packaging.layersPerBox}" onchange="updatePackaging('layersPerBox',this.value)" ${ro}><span>)层/箱</span></div>
      <div class="pkg-row"><span>(</span><input type="number" value="${r.packaging.boxesPerPallet}" onchange="updatePackaging('boxesPerPallet',this.value)" ${ro}><span>)箱 ×(</span>
        <input type="number" value="${r.packaging.layersPerPallet}" onchange="updatePackaging('layersPerPallet',this.value)" ${ro}><span>)层/托</span></div>
      <div class="form-row" style="margin-top:10px">
        <div class="field"><label>单包重 Box Wt (kg)</label><input type="number" step="0.01" value="${r.boxWeightKg}" onchange="updateField('boxWeightKg',this.value)" ${ro}></div>
        <div class="field"><label>单拖重 Pallet Wt (kg)</label><input type="number" step="0.01" value="${r.palletWeightKg}" onchange="updateField('palletWeightKg',this.value)" ${ro}></div>
      </div>
    </div></div>
  </div>

  <!-- STEP 1: Dimensions with real-time validation -->
  <div class="form-step" id="step1" style="display:none">
    <div class="card"><div class="card-header">📏 尺寸检测 Dimensions</div><div class="card-body">
      <div class="dim-section">
        <div class="dim-label">长度 Length <span class="std">${r.dimensions.lengthStd}</span> <span id="dimResult-length" class="dim-result"></span></div>
        <div class="measure-grid cols-6">${r.dimensions.length.map((v, i) => `<input class="measure-input" data-dim="length" type="number" step="0.01" inputmode="decimal" placeholder="${i + 1}" value="${v}" onchange="updateDimension('length',${i},this.value)" ${ro}>`).join('')}</div>
      </div>
      <div class="dim-section">
        <div class="dim-label">宽度 Width <span class="std">${r.dimensions.widthStd}</span> <span id="dimResult-width" class="dim-result"></span></div>
        <div class="measure-grid cols-6">${r.dimensions.width.map((v, i) => `<input class="measure-input" data-dim="width" type="number" step="0.01" inputmode="decimal" placeholder="${i + 1}" value="${v}" onchange="updateDimension('width',${i},this.value)" ${ro}>`).join('')}</div>
      </div>
      <div class="dim-section">
        <div class="dim-label">厚度 Thickness
          <select style="font-size:.78rem;padding:2px 6px;border:1px solid #ccc;border-radius:4px" onchange="updateDimStandard('thicknessStd',this.value)" ${dis}>${thicknessStdOptions}</select>
          <span id="dimResult-thickness" class="dim-result"></span>
        </div>
        <div class="measure-grid cols-6">${r.dimensions.thickness.map((v, i) => `<input class="measure-input" data-dim="thickness" type="number" step="0.01" inputmode="decimal" placeholder="${i + 1}" value="${v}" onchange="updateDimension('thickness',${i},this.value)" ${ro}>`).join('')}</div>
      </div>
      <div class="dim-section">
        <div class="dim-label">光泽度 Gloss
          <select style="font-size:.78rem;padding:2px 6px;border:1px solid #ccc;border-radius:4px" onchange="updateDimStandard('glossStd',this.value)" ${dis}>${glossOptions}</select>
          <span id="dimResult-gloss" class="dim-result"></span>
        </div>
        <div class="measure-grid cols-6">${r.dimensions.gloss.map((v, i) => `<input class="measure-input" data-dim="gloss" type="number" step="0.1" inputmode="decimal" placeholder="${i + 1}" value="${v}" onchange="updateDimension('gloss',${i},this.value)" ${ro}>`).join('')}</div>
      </div>
    </div></div>
  </div>

  <!-- STEP 2: Inspection Items -->
  <div class="form-step" id="step2" style="display:none">
    <div class="card"><div class="card-header">✅ 检验项目 Inspection</div><div class="card-body">
      <div class="inspect-list">${INSPECT_ITEMS.map(it => {
        const res = r.inspectItems[it.key] || '';
        const rem = r.inspectRemarks?.[it.key] || '';
        return `<div class="inspect-item">
        <div class="item-name"><strong>${it.name}</strong><small>${it.en}</small><small style="color:#e67e22;font-size:.65rem">${it.std}</small></div>
        <div class="inspect-result">
          <button onclick="setInspect('${it.key}','PASS')" ${dis} style="background:${res === 'PASS' ? '#27ae60' : '#fff'};color:${res === 'PASS' ? '#fff' : '#333'};border-color:${res === 'PASS' ? '#27ae60' : '#ddd'}">✅ PASS</button>
          <button onclick="setInspect('${it.key}','FAIL')" ${dis} style="background:${res === 'FAIL' ? '#e74c3c' : '#fff'};color:${res === 'FAIL' ? '#fff' : '#333'};border-color:${res === 'FAIL' ? '#e74c3c' : '#ddd'}">❌ FAIL</button>
          <button onclick="setInspect('${it.key}','')" ${dis} style="background:${res === '' ? '#95a5a6' : '#fff'};color:${res === '' ? '#fff' : '#333'};border-color:${res === '' ? '#95a5a6' : '#ddd'}">N/A</button>
        </div>
      </div>
      <div style="padding:6px 0;margin-bottom:8px;display:${res ? 'block' : 'none'}"><input type="text" placeholder="备注 Remark" value="${escapeHtml(rem)}" onchange="updateNested('inspectRemarks','${it.key}',this.value)" ${ro} style="width:100%;padding:6px;border:1px solid #ddd;border-radius:6px;font-size:.8rem"></div>`;
      }).join('')}</div>
    </div></div>
  </div>

  <!-- STEP 3: Photos & Final Result -->
  <div class="form-step" id="step3" style="display:none">
    <div class="card"><div class="card-header">📷 照片 Photos</div><div class="card-body">
      <div class="photo-grid">${PHOTO_SLOTS.map((lbl, i) => {
        const img = r.photos[i];
        const isCloudPending = img === '__CLOUD_PHOTO__' || img === '__HAS_PHOTO__';
        const hasRealPhoto = img && !isCloudPending;
        return `<div class="photo-slot ${isCloudPending ? 'cloud-pending' : ''}" onclick="${isCloudPending ? `loadCloudPhoto('${r.id}',${i})` : `openPhotoMenu(${i})`}" style="cursor:${dis && !isCloudPending ? 'default' : 'pointer'}" id="photo-slot-${i}">
        ${hasRealPhoto ? `<img src="${img}">` : isCloudPending ? '<div class="icon" style="color:#3498db">⏳</div><div style="font-size:.6rem;color:#3498db">点击加载</div>' : '<div class="icon">📷</div>'}
        ${!dis && hasRealPhoto ? `<button class="delete-photo" onclick="event.stopPropagation();delPhoto(${i})">✕</button>` : ''}
        <div class="label">${lbl}</div>
      </div>`;
      }).join('')}</div>
    </div></div>

    <div class="card"><div class="card-header">✅ 终检结果 Final Result</div><div class="card-body">
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn btn-success" onclick="setFinalResult('pass')" ${dis} style="flex:1;opacity:${r.finalResult === 'pass' ? 1 : 0.5}">✅ 合格 PASS</button>
        <button class="btn btn-danger" onclick="setFinalResult('fail')" ${dis} style="flex:1;opacity:${r.finalResult === 'fail' ? 1 : 0.5}">❌ 不合格 FAIL</button>
      </div>
    </div></div>
  </div>

  <div class="card" style="margin-bottom:80px"><div class="card-body">
    <div class="form-button-row ${isReadOnly ? 'full' : ''}">
      ${!isReadOnly ? `<button class="btn btn-primary" onclick="saveDraft()">💾 保存草稿</button>` : ''}
      ${r.status === 'draft' ? `<button class="btn btn-success" onclick="submitReport()">📤 提交审核</button>` : ''}
      ${r.status === 'submitted' && APP.user.role === 'supervisor' ? `<button class="btn btn-success" onclick="approveReport()">✅ 通过</button>` : ''}
      ${r.status === 'submitted' && APP.user.role === 'supervisor' ? `<button class="btn btn-danger" onclick="rejectReport()">❌ 驳回</button>` : ''}
    </div>
    <div class="form-button-row" style="margin-top:8px">
      <button class="btn btn-pdf" onclick="generatePDF()">📄 生成PDF</button>
      ${!isReadOnly ? `<button class="btn btn-danger" onclick="trashReport()">🗑 删除</button>` : ''}
    </div>
  </div></div>
  `;

  document.getElementById('formContent').innerHTML = html;
  document.getElementById('reportForm').style.display = 'block';
  window.scrollTo(0, 0);
  showStep(0);
  // Trigger initial dimension validation display
  setTimeout(updateDimensionUI, 50);
}

// ===== PHOTO =====
function openPhotoMenu(i) {
  if (document.getElementById('reportForm').querySelector('[readonly]')) return;
  APP.editingPhotoSlot = i;
  document.getElementById('photoOverlay').classList.add('show');
  document.getElementById('photoSheet').classList.add('show');
}

function closePhotoSheet() {
  document.getElementById('photoOverlay').classList.remove('show');
  document.getElementById('photoSheet').classList.remove('show');
}

function chooseCamera() { closePhotoSheet(); document.getElementById('photoCam').click(); }
function chooseGallery() { closePhotoSheet(); document.getElementById('photoGallery').click(); }

/**
 * Compress image before storing
 * Max dimension: 1200px, JPEG quality: adaptive based on size
 * Target: each photo < 200KB base64
 */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function (ev) {
      const img = new Image();
      img.onload = function () {
        try {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          const MAX_DIM = 1200;
          if (w > MAX_DIM || h > MAX_DIM) {
            if (w > h) { h = h * MAX_DIM / w; w = MAX_DIM; }
            else { w = w * MAX_DIM / h; h = MAX_DIM; }
          }
          canvas.width = Math.round(w);
          canvas.height = Math.round(h);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          // Adaptive quality: try higher quality first, reduce if too large
          let quality = 0.7;
          let dataUrl = canvas.toDataURL('image/jpeg', quality);
          const TARGET_SIZE = 200 * 1024; // 200KB in base64 chars (~150KB binary)
          while (dataUrl.length > TARGET_SIZE && quality > 0.3) {
            quality -= 0.1;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }

          const sizeKB = Math.round(dataUrl.length * 0.75 / 1024);
          console.log(`Photo compressed: ${img.width}x${img.height} → ${canvas.width}x${canvas.height}, q=${quality.toFixed(1)}, ~${sizeKB}KB`);
          resolve(dataUrl);
        } catch (canvasErr) {
          reject(new Error('照片压缩失败: ' + canvasErr.message));
        }
      };
      img.onerror = () => reject(new Error('图片加载失败，请重试'));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error('文件读取失败，请重试'));
    reader.readAsDataURL(file);
  });
}

async function handlePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await compressImage(file);
    APP.currentReport.photos[APP.editingPhotoSlot] = dataUrl;
    debouncedAutoSave(); // Auto-save to IndexedDB immediately

    renderReportForm();
    showStep(3, document.querySelectorAll('.tabs button')[3]);
    showToast('照片已添加 Photo added', 'success');
  } catch (err) {
    showToast(err.message || '照片处理失败', 'error');
  }
  e.target.value = '';
}

document.getElementById('photoCam').addEventListener('change', handlePhoto);
document.getElementById('photoGallery').addEventListener('change', handlePhoto);

function delPhoto(i) {
  delete APP.currentReport.photos[i];
  // Track deleted photo slots for cloud sync
  if (!APP.currentReport._deletedPhotoSlots) APP.currentReport._deletedPhotoSlots = [];
  if (!APP.currentReport._deletedPhotoSlots.includes(i)) APP.currentReport._deletedPhotoSlots.push(i);
  debouncedAutoSave();
  renderReportForm();
  showStep(3, document.querySelectorAll('.tabs button')[3]);
}

// ===== SAVE / SUBMIT / APPROVE =====
async function saveDraft() {
  const r = APP.currentReport;
  r.status = 'draft';
  await saveReport(r);
  APP.reports = await localGetAll();
  showToast('已保存 Saved', 'success');
}

async function submitReport() {
  const r = APP.currentReport;
  if (!r.poOrderNo?.trim()) { showToast('请填写PO订单号', 'error'); return; }
  if (!r.colorFilmModel?.trim()) { showToast('请填写彩膜型号', 'error'); return; }
  r.status = 'submitted';
  r.inspector = APP.user.name;
  await saveReport(r);
  APP.reports = await localGetAll();
  showToast('已提交审核 Submitted', 'success');
  switchTab('list');
}

async function approveReport() {
  const r = APP.currentReport;
  r.status = 'approved';
  r.reviewer = APP.user.name;
  await saveReport(r);
  APP.reports = await localGetAll();
  showToast('已通过 Approved', 'success');
  switchTab('list');
}

async function rejectReport() {
  const r = APP.currentReport;
  r.status = 'rejected';
  r.reviewer = APP.user.name;
  await saveReport(r);
  APP.reports = await localGetAll();
  showToast('已驳回 Rejected', 'error');
  switchTab('list');
}

// ===== RECYCLE BIN =====
async function trashReport() {
  if (!confirm('确定删除此报告？\nDelete this report?')) return;
  const r = APP.currentReport;
  r.status = 'trashed';
  r.trashedAt = new Date().toISOString();
  await saveReport(r);
  APP.reports = await localGetAll();
  showToast('已移入回收站 Moved to trash', 'info');
  switchTab('list');
}

async function restoreReport(id) {
  const r = APP.reports.find(x => x.id === id);
  if (!r) return;
  r.status = 'draft';
  delete r.trashedAt;
  await saveReport(r);
  APP.reports = await localGetAll();
  showToast('已恢复 Restored', 'success');
  switchTab('trash');
}

async function permanentDelete(id) {
  if (!confirm('永久删除此报告？此操作不可恢复！\nPermanently delete? This cannot be undone!')) return;
  if (APP.db) {
    await new Promise(res => {
      const tx = APP.db.transaction('reports', 'readwrite');
      tx.objectStore('reports').delete(id);
      tx.oncomplete = () => res();
    });
  }
  if (serverOnline) {
    try { await apiFetch('/reports?id=' + encodeURIComponent(id), { method: 'DELETE' }); }
    catch (e) { console.warn('Cloud delete failed:', e.message); }
  }
  APP.reports = APP.reports.filter(x => x.id !== id);
  showToast('已永久删除 Permanently deleted', 'info');
  switchTab('trash');
}

function renderTrash() {
  document.getElementById('headerTitle').textContent = '回收站 Recycle Bin';
  const trashed = APP.reports.filter(r => r.status === 'trashed');
  trashed.sort((a, b) => new Date(b.trashedAt || b.updatedAt) - new Date(a.trashedAt || a.updatedAt));

  if (!trashed.length) {
    document.getElementById('mainContent').innerHTML = `<div class="empty-state"><div class="icon">🗑</div><p>回收站为空 Recycle bin is empty</p></div>`;
    return;
  }

  document.getElementById('mainContent').innerHTML = `<div id="trashList">${trashed.map(r => `
    <div class="report-item" style="opacity:0.8">
      <div style="width:40px;height:40px;background:#f0f0f0;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem">🗑</div>
      <div class="report-info"><h3>PO: ${escapeHtml(r.poOrderNo || '--')} ${escapeHtml(r.colorFilmModel || '')}</h3><p>${r.date} · ${r.inspector || ''}</p></div>
      <div style="display:flex;gap:4px;flex-direction:column">
        <button class="btn btn-sm btn-outline" style="padding:4px 8px;font-size:.7rem" onclick="event.stopPropagation();restoreReport('${r.id}')">恢复</button>
        <button class="btn btn-sm btn-danger" style="padding:4px 8px;font-size:.7rem" onclick="event.stopPropagation();permanentDelete('${r.id}')">永删</button>
      </div>
    </div>`).join('')}</div>`;
}

// ===== REPORT LIST =====
async function renderReportList() {
  await syncReports();
  document.getElementById('headerTitle').textContent = APP.user.role === 'supervisor' ? '审核中心 Review' : '我的报告 Reports';
  let reports = APP.reports.filter(r => r.status !== 'trashed');
  if (APP.user.role === 'inspector') reports = reports.filter(r => r.createdBy === APP.user.username);
  reports.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const sLabel = { draft: '草稿', submitted: '待审核', approved: '已通过', rejected: '已驳回' };
  const sClass = { draft: 'badge-draft', submitted: 'badge-submitted', approved: 'badge-approved', rejected: 'badge-rejected' };

  const filterHtml = `<div class="tabs"><button class="active" onclick="filterList('all',this)">全部</button><button onclick="filterList('submitted',this)">待审核</button><button onclick="filterList('approved',this)">已通过</button><button onclick="filterList('rejected',this)">已驳回</button></div>`;

  if (!reports.length) {
    document.getElementById('mainContent').innerHTML = filterHtml + `<div class="empty-state"><div class="icon">📋</div><p>${APP.user.role === 'supervisor' ? '暂无报告' : '点击"新建报告"开始'}</p></div>`;
    return;
  }

  document.getElementById('mainContent').innerHTML = filterHtml + `<div id="rptList">${reports.map(r => `
    <div class="report-item" onclick="editReport('${r.id}')" data-status="${r.status}">
      <div style="width:40px;height:40px;background:${r.finalResult === 'pass' ? '#d4edda' : '#f8d7da'};border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem">${r.finalResult === 'pass' ? '✅' : '❌'}</div>
      <div class="report-info"><h3>PO: ${escapeHtml(r.poOrderNo || '--')} ${escapeHtml(r.colorFilmModel || '')}</h3><p>${r.date} · ${r.inspector || ''} · ${r.productType || ''}</p></div>
      <span class="badge ${sClass[r.status]}">${sLabel[r.status]}</span>
    </div>`).join('')}</div>`;
}

function filterList(status, btn) {
  btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#rptList .report-item').forEach(el => {
    el.style.display = (status === 'all' || el.dataset.status === status) ? 'flex' : 'none';
  });
}

// ===== PROFILE =====
function renderProfile() {
  document.getElementById('headerTitle').textContent = '个人中心 Profile';
  const myR = APP.reports.filter(r => r.status !== 'trashed' && (APP.user.role === 'inspector' ? r.createdBy === APP.user.username : true));
  document.getElementById('mainContent').innerHTML = `
    <div class="card"><div class="card-header">👤 个人信息</div><div class="card-body">
      <p style="margin-bottom:6px"><strong>用户名：</strong>${escapeHtml(APP.user.username)}</p>
      <p style="margin-bottom:6px"><strong>姓名：</strong>${escapeHtml(APP.user.name)}</p>
      <p><strong>角色：</strong>${APP.user.role === 'supervisor' ? '主管 Supervisor' : '质检员 Inspector'}</p>
    </div></div>
    <div class="card"><div class="card-header">📊 统计</div><div class="card-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:center">
        <div onclick="showFilteredReports('all')" style="padding:10px;background:#e8f0fe;border-radius:10px;cursor:pointer;transition:transform .15s" onpointerdown="this.style.transform='scale(0.95)'" onpointerup="this.style.transform=''"><div style="font-size:1.5rem;font-weight:700;color:#1a5276">${myR.length}</div><div style="font-size:.75rem;color:#666">总数 Total</div></div>
        <div onclick="showFilteredReports('submitted')" style="padding:10px;background:#cce5ff;border-radius:10px;cursor:pointer;transition:transform .15s" onpointerdown="this.style.transform='scale(0.95)'" onpointerup="this.style.transform=''"><div style="font-size:1.5rem;font-weight:700;color:#004085">${myR.filter(x => x.status === 'submitted').length}</div><div style="font-size:.75rem;color:#666">待审核</div></div>
        <div onclick="showFilteredReports('approved')" style="padding:10px;background:#d4edda;border-radius:10px;cursor:pointer;transition:transform .15s" onpointerdown="this.style.transform='scale(0.95)'" onpointerup="this.style.transform=''"><div style="font-size:1.5rem;font-weight:700;color:#155724">${myR.filter(x => x.status === 'approved').length}</div><div style="font-size:.75rem;color:#666">已通过</div></div>
        <div onclick="showFilteredReports('rejected')" style="padding:10px;background:#f8d7da;border-radius:10px;cursor:pointer;transition:transform .15s" onpointerdown="this.style.transform='scale(0.95)'" onpointerup="this.style.transform=''"><div style="font-size:1.5rem;font-weight:700;color:#721c24">${myR.filter(x => x.status === 'rejected').length}</div><div style="font-size:.75rem;color:#666">已驳回</div></div>
      </div>
    </div></div>
    <div class="card"><div class="card-body">
      <p style="font-size:.72rem;color:#999">v4.0 · 森雅国际有限公司 Senia International</p>
      <p style="font-size:.72rem;color:#999;margin-top:4px">服务器: ${serverOnline ? '✅ 在线 (多设备同步)' : '⚠️ 离线 (仅本机)'}</p>
    </div></div>
    <div class="card" onclick="switchTab('trash')" style="cursor:pointer"><div class="card-body" style="display:flex;align-items:center;justify-content:space-between">
      <span>🗑 回收站 Recycle Bin</span>
      <span style="background:#f0f0f0;padding:2px 10px;border-radius:10px;font-size:.85rem;font-weight:600">${APP.reports.filter(r => r.status === 'trashed').length}</span>
    </div></div>`;
}

function showFilteredReports(status) {
  switchTab('list');
  setTimeout(() => {
    if (status !== 'all') {
      document.querySelectorAll('#rptList .report-item').forEach(el => {
        el.style.display = (el.dataset.status === status) ? 'flex' : 'none';
      });
    }
    const sNames = { all: '全部报告', submitted: '待审核报告', approved: '已通过报告', rejected: '已驳回报告' };
    document.getElementById('headerTitle').textContent = sNames[status] || '报告列表';
  }, 100);
}

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            showToast('新版本已就绪，请刷新页面', 'info');
          }
        });
      });
    }).catch(e => console.warn('SW registration failed:', e));
  });
}
