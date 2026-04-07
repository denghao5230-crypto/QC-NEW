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
  db: null,
  syncState: { mode: 'idle', text: '初始化中...' },
  syncInProgress: false
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
  const { timeoutMs = 20000, ...fetchOpts } = opts;
  const headers = { 'Content-Type': 'application/json', ...(fetchOpts.headers || {}) };
  // Attach JWT token if available
  if (APP.token) {
    headers['Authorization'] = 'Bearer ' + APP.token;
  }
  let timer = null;
  let abortController = null;
  if (!fetchOpts.signal && timeoutMs > 0) {
    abortController = new AbortController();
    fetchOpts.signal = abortController.signal;
    timer = setTimeout(() => abortController.abort(), timeoutMs);
  }

  let resp;
  try {
    resp = await fetch(url, { ...fetchOpts, headers });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('请求超时，请检查网络后重试');
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const text = await resp.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = { error: text }; }
  }
  if (!resp.ok) {
    // Token expired or invalid → auto logout
    if (resp.status === 401 && APP.user) {
      showToast('登录已过期，请重新登录', 'warning');
      logout();
      throw new Error('TOKEN_EXPIRED');
    }
    throw new Error((data && data.error ? `${data.error} (HTTP ${resp.status})` : 'API 请求失败: ' + resp.status));
  }
  return data;
}

function isRetryableUploadError(error) {
  const msg = String(error && error.message ? error.message : error || '');
  return /超时|timeout|Failed to fetch|NetworkError|HTTP 429|HTTP 5\d\d|API 请求失败: 5\d\d/i.test(msg);
}

async function apiFetchWithRetry(endpoint, opts = {}, conf = {}) {
  const retries = conf.retries ?? 2;
  const baseDelayMs = conf.baseDelayMs ?? 900;
  const timeoutMs = conf.timeoutMs ?? 25000;
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await apiFetch(endpoint, { ...opts, timeoutMs });
    } catch (e) {
      if (e.message === 'TOKEN_EXPIRED') throw e;
      lastErr = e;
      const canRetry = attempt < retries && isRetryableUploadError(e);
      if (!canRetry) throw e;
      await new Promise(r => setTimeout(r, baseDelayMs * (attempt + 1)));
    }
  }
  throw lastErr || new Error('请求失败');
}

let serverOnline = false;

// ===== OFFLINE AUTH (cached sessions) =====
const OFFLINE_USERS = {};

function isPhotoPlaceholder(value) {
  return value === '__HAS_PHOTO__' || value === '__CLOUD_PHOTO__';
}

function isRealPhotoDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function getUnsyncedPhotoSlots(report) {
  if (!report || !report.photos) return [];
  if (!report._uploadedPhotoSlots) {
    report._uploadedPhotoSlots = {};
    if (report.syncStatus === 'synced') {
      Object.keys(report.photos).forEach(k => {
        if (isRealPhotoDataUrl(report.photos[k]) || isPhotoPlaceholder(report.photos[k])) {
          report._uploadedPhotoSlots[k] = true;
        }
      });
    }
  }
  return Object.keys(report.photos).filter(k => isRealPhotoDataUrl(report.photos[k]) && report._uploadedPhotoSlots[k] !== true);
}

function setUploadStatus(report, patch = {}) {
  if (!report) return;
  report.uploadStatus = {
    state: report.uploadStatus?.state || 'idle',
    total: report.uploadStatus?.total || 0,
    done: report.uploadStatus?.done || 0,
    failed: report.uploadStatus?.failed || 0,
    message: report.uploadStatus?.message || '',
    lastError: report.uploadStatus?.lastError || '',
    updatedAt: report.uploadStatus?.updatedAt || new Date().toISOString(),
    ...patch,
    updatedAt: new Date().toISOString()
  };
  if (APP.currentReport && report.id === APP.currentReport.id) {
    APP.currentReport.uploadStatus = { ...report.uploadStatus };
    refreshCurrentReportUploadStatusUI();
  }
}

function setSyncState(mode, text) {
  APP.syncState = { mode, text, updatedAt: new Date().toISOString() };
  updateSyncUI();
}

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
    req.onsuccess = e => {
      APP.db = e.target.result;
      // Auto-recover if browser unexpectedly closes the connection
      APP.db.onclose = () => {
        console.warn('IndexedDB connection closed unexpectedly, will reopen on next save');
        APP.db = null;
      };
      resolve(APP.db);
    };
    req.onerror = e => reject(e);
  });
}

async function localSave(report) {
  if (!APP.db) {
    console.warn('IndexedDB not available, attempting to reopen...');
    try {
      await openDB();
    } catch (e) {
      console.error('Cannot reopen IndexedDB:', e);
      throw e;
    }
  }
  if (!APP.db) {
    throw new Error('IndexedDB 不可用');
  }
  return new Promise((resolve, reject) => {
    try {
      const tx = APP.db.transaction('reports', 'readwrite');
      tx.objectStore('reports').put(report);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => {
        console.error('IndexedDB save failed:', e.target.error);
        showToast('本地保存失败，请检查存储空间', 'error');
        reject(e.target.error);
      };
      tx.onabort = (e) => {
        console.error('IndexedDB save aborted:', e.target.error);
        // Likely quota exceeded - warn user
        showToast('存储空间不足，照片可能丢失！请清理浏览器缓存', 'error');
        reject(e.target.error);
      };
    } catch (e) {
      console.error('IndexedDB transaction failed:', e);
      reject(e);
    }
  });
}

async function safeLocalSave(report, context = '') {
  try {
    await localSave(report);
    return true;
  } catch (e) {
    console.warn(`Local save failed${context ? ` (${context})` : ''}:`, e && e.message ? e.message : e);
    return false;
  }
}

async function localGetAll() {
  if (!APP.db) return [];
  return new Promise(r => {
    const tx = APP.db.transaction('reports', 'readonly');
    const req = tx.objectStore('reports').getAll();
    req.onsuccess = () => {
      const reports = req.result || [];
      // Ensure critical properties exist on all reports (protect old data)
      reports.forEach(rep => {
        if (!rep.photos) rep.photos = {};
        if (!rep._uploadedPhotoSlots) rep._uploadedPhotoSlots = {};
      });
      r(reports);
    };
    req.onerror = () => r([]);
  });
}

// ===== Debounce utility (with cancel support) =====
function debounce(fn, delay = 500) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  debounced.flush = () => { clearTimeout(timer); fn(); };
  return debounced;
}
const debouncedAutoSave = debounce(() => {
  if (APP.currentReport) safeLocalSave(APP.currentReport, 'debounced-autosave');
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
  if (!serverOnline) setSyncState('offline', '离线');
  updateSyncUI();
}

function updateSyncUI() {
  const el = document.getElementById('syncStatus');
  const loginEl = document.getElementById('serverStatus');
  const state = APP.syncState || { mode: 'idle', text: '' };
  const text = state.text || (serverOnline ? '已同步 (云端)' : '离线');
  const safeText = escapeHtml(text);
  const dotClass = serverOnline ? 'online' : 'offline';
  if (el) {
    el.innerHTML = `<span class="sync-dot ${dotClass}"></span> ${safeText}`;
  }
  if (loginEl) {
    if (!serverOnline) {
      loginEl.textContent = '⚠️ 离线模式 (仅本机数据，恢复网络后自动续传)';
      loginEl.style.color = '#e67e22';
    } else if (state.mode === 'uploading') {
      loginEl.textContent = `⏳ ${text}`;
      loginEl.style.color = '#1a5276';
    } else if (state.mode === 'warning') {
      loginEl.textContent = `⚠️ ${text}`;
      loginEl.style.color = '#e67e22';
    } else if (state.mode === 'error') {
      loginEl.textContent = `❌ ${text}`;
      loginEl.style.color = '#e74c3c';
    } else {
      loginEl.textContent = '✅ 云端已连接 (多设备同步)';
      loginEl.style.color = '#27ae60';
    }
  }
}

async function refreshSyncStateFromLocal() {
  const all = await localGetAll();
  let pendingReports = 0;
  let pendingPhotos = 0;
  all.forEach(r => {
    const unsynced = getUnsyncedPhotoSlots(r).length;
    pendingPhotos += unsynced;
    if (r.syncStatus === 'pending' || unsynced > 0) pendingReports++;
  });

  if (!serverOnline) {
    if (pendingReports > 0 || pendingPhotos > 0) setSyncState('warning', `离线 · 待同步${pendingReports}份/${pendingPhotos}张`);
    else setSyncState('offline', '离线');
    return;
  }

  if (APP.syncInProgress) return;
  if (pendingReports > 0 || pendingPhotos > 0) setSyncState('warning', `待同步${pendingReports}份/${pendingPhotos}张`);
  else setSyncState('online', '已同步 (云端)');
}

async function uploadReportToCloud(report, context = 'manual') {
  const unsyncedSlots = getUnsyncedPhotoSlots(report);
  const total = unsyncedSlots.length;
  let done = 0;
  let failed = 0;
  let lastError = '';

  setUploadStatus(report, { state: 'uploading', total, done, failed, message: total > 0 ? `上传中 0/${total}` : '上传中', lastError: '' });
  report.syncStatus = 'pending';
  await safeLocalSave(report, 'upload-start');

  try {
    // Build cloud payload WITHOUT cloning base64 photos (saves ~5MB memory per report)
    const { photos, _uploadedPhotoSlots, _deletedPhotoSlots, uploadStatus, ...reportFields } = report;
    const cloudReport = JSON.parse(JSON.stringify(reportFields));
    cloudReport.photos = {};
    await apiFetchWithRetry('/reports', { method: 'POST', body: JSON.stringify(cloudReport), timeoutMs: 18000 }, { retries: 2 });
  } catch (e) {
    if (e.message === 'TOKEN_EXPIRED') throw e;
    lastError = e.message || '报告上传失败';
    setUploadStatus(report, { state: 'pending', total, done, failed: total, message: '网络异常，等待自动重试', lastError });
    report.syncStatus = 'pending';
    await safeLocalSave(report, 'upload-report-failed');
    return { ok: false, total, done, failed: total, lastError };
  }

  for (const slotIdx of unsyncedSlots) {
    try {
      await apiFetchWithRetry('/photos', {
        method: 'POST',
        body: JSON.stringify({
          reportId: report.id,
          slotIndex: parseInt(slotIdx, 10),
          dataUrl: report.photos[slotIdx]
        }),
        timeoutMs: 30000
      }, { retries: 2, baseDelayMs: 1200 });
      if (!report._uploadedPhotoSlots) report._uploadedPhotoSlots = {};
      report._uploadedPhotoSlots[slotIdx] = true;
      done++;
    } catch (e) {
      failed++;
      lastError = e.message || '照片上传失败';
    }
    setUploadStatus(report, {
      state: failed > 0 ? 'uploading' : 'uploading',
      total,
      done,
      failed,
      message: total > 0 ? `上传中 ${done}/${total}` : '上传中',
      lastError
    });
    await safeLocalSave(report, 'upload-photo-progress');
  }

  let deletionFailedCount = 0;
  // Sync photo deletions — only clear successfully deleted slots
  if (report._deletedPhotoSlots && report._deletedPhotoSlots.length > 0) {
    const failedDeletions = [];
    for (const slot of report._deletedPhotoSlots) {
      try {
        await apiFetchWithRetry(`/photos?reportId=${report.id}&slot=${slot}`, { method: 'DELETE', timeoutMs: 12000 }, { retries: 1 });
      } catch (e) {
        lastError = e.message || '删除云端照片失败';
        deletionFailedCount++;
        failedDeletions.push(slot);
      }
    }
    report._deletedPhotoSlots = failedDeletions.length > 0 ? failedDeletions : undefined;
    if (!report._deletedPhotoSlots) delete report._deletedPhotoSlots;
  }

  if (failed > 0 || deletionFailedCount > 0) {
    report.syncStatus = 'pending';
    setUploadStatus(report, {
      state: 'pending',
      total,
      done,
      failed: failed + deletionFailedCount,
      message: deletionFailedCount > 0
        ? `待重试 ${failed} 张上传，${deletionFailedCount} 张删除`
        : `待重试 ${failed} 张`,
      lastError
    });
  } else {
    report.syncStatus = 'synced';
    setUploadStatus(report, {
      state: 'synced',
      total,
      done,
      failed: 0,
      message: total > 0 ? `已同步 ${done}/${total} 张` : '已同步',
      lastError: ''
    });
  }

  report.updatedAt = new Date().toISOString();
  await safeLocalSave(report, 'upload-finish');
  const totalFailed = failed + deletionFailedCount;
  return {
    ok: totalFailed === 0,
    total,
    done,
    failed: totalFailed,
    photoFailed: failed,
    deletionFailed: deletionFailedCount,
    lastError,
    context
  };
}

async function syncReports() {
  if (serverOnline) {
    try {
      const cloudReports = await apiFetch('/reports');
      if (!cloudReports) { APP.reports = await localGetAll(); return; }
      const localReports = await localGetAll();
      const localMap = {};
      localReports.forEach(r => { localMap[r.id] = r; });

      // Merge: cloud data + local data (local pending changes take priority)
      for (let i = 0; i < cloudReports.length; i++) {
        const cr = cloudReports[i];
        const local = localMap[cr.id];
        if (!cr.photos) cr.photos = {};
        if (!cr._uploadedPhotoSlots) cr._uploadedPhotoSlots = {};

        const localHasPendingChanges = !!local && (
          local.syncStatus === 'pending' ||
          getUnsyncedPhotoSlots(local).length > 0 ||
          (local._deletedPhotoSlots && local._deletedPhotoSlots.length > 0)
        );

        // Critical: if local has pending edits, never overwrite it with cloud snapshot.
        if (localHasPendingChanges) {
          const merged = JSON.parse(JSON.stringify(local));
          if (!merged.photos) merged.photos = {};
          if (!merged._uploadedPhotoSlots) merged._uploadedPhotoSlots = {};

          // Preserve cloud photo existence for slots local doesn't currently have.
          Object.keys(cr.photos || {}).forEach(k => {
            if (!isRealPhotoDataUrl(merged.photos[k]) && isPhotoPlaceholder(cr.photos[k])) {
              merged.photos[k] = '__CLOUD_PHOTO__';
              merged._uploadedPhotoSlots[k] = true;
            }
          });

          merged.syncStatus = 'pending';
          if (!merged.uploadStatus || merged.uploadStatus.state === 'idle' || merged.uploadStatus.state === 'synced') {
            merged.uploadStatus = {
              state: 'pending',
              total: getUnsyncedPhotoSlots(merged).length,
              done: 0,
              failed: 0,
              message: '本地有未同步变更，待上传',
              lastError: '',
              updatedAt: new Date().toISOString()
            };
          }

          cloudReports[i] = merged;
          await safeLocalSave(merged, 'sync-merge-pending');
          continue;
        }

        // Step 1: Preserve local photos that haven't been uploaded yet
        // Only keep local base64 photos that are NOT yet confirmed in cloud
        // This prevents overwriting newer cloud photos from other devices
        if (local && local.photos) {
          Object.keys(local.photos).forEach(k => {
            if (isRealPhotoDataUrl(local.photos[k])) {
              // Only preserve if this photo hasn't been uploaded to cloud yet
              const alreadyUploaded = local._uploadedPhotoSlots && local._uploadedPhotoSlots[k];
              if (!alreadyUploaded) {
                // Unsynced local photo — must keep it or it'll be lost
                cr.photos[k] = local.photos[k];
              } else if (!cr.photos[k] || isPhotoPlaceholder(cr.photos[k])) {
                // Already uploaded but cloud only has placeholder — keep local copy for display
                cr.photos[k] = local.photos[k];
              }
              // If cloud has __HAS_PHOTO__ and local has data that was already uploaded,
              // we let the placeholder remain — lazy-load will fetch when needed
            }
          });
        }
        if (local && local._uploadedPhotoSlots) {
          cr._uploadedPhotoSlots = { ...local._uploadedPhotoSlots };
        }
        if (local && local.uploadStatus) {
          cr.uploadStatus = { ...local.uploadStatus };
        }

        // Step 2: For cloud photos that are placeholders and we don't have locally,
        // try to fetch from the new photos API (enables cross-device sync)
        const missingSlots = Object.keys(cr.photos).filter(k => isPhotoPlaceholder(cr.photos[k]));
        if (missingSlots.length > 0) {
          // Lazy-load: fetch individual photos on demand, not during sync
          // Mark them so the UI can trigger lazy loading
          missingSlots.forEach(k => {
            cr.photos[k] = '__CLOUD_PHOTO__'; // distinguishable from local placeholder
            cr._uploadedPhotoSlots[k] = true; // cloud has this photo
          });
        }

        cr.syncStatus = getUnsyncedPhotoSlots(cr).length > 0 ? 'pending' : 'synced';
        cloudReports[i] = cr;
        await safeLocalSave(cr, 'sync-merge-cloud');
      }

      // Also keep local-only reports (not yet synced)
      for (const lr of localReports) {
        if (!cloudReports.find(cr => cr.id === lr.id) && (lr.syncStatus === 'pending' || getUnsyncedPhotoSlots(lr).length > 0)) {
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
  await refreshSyncStateFromLocal();
}

/**
 * Lazy-load a single photo from cloud when user views it
 */
async function fetchCloudPhoto(reportId, slotIndex, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await apiFetch(`/photos?reportId=${reportId}&slot=${slotIndex}`, { timeoutMs: 30000 });
      if (result && isRealPhotoDataUrl(result.dataUrl)) {
        // Update all in-memory references, then save once to IndexedDB
        if (APP.currentReport && APP.currentReport.id === reportId) {
          APP.currentReport.photos[slotIndex] = result.dataUrl;
          if (!APP.currentReport._uploadedPhotoSlots) APP.currentReport._uploadedPhotoSlots = {};
          APP.currentReport._uploadedPhotoSlots[slotIndex] = true;
        }
        const listReport = APP.reports.find(r => r.id === reportId);
        if (listReport) {
          listReport.photos[slotIndex] = result.dataUrl;
          if (!listReport._uploadedPhotoSlots) listReport._uploadedPhotoSlots = {};
          listReport._uploadedPhotoSlots[slotIndex] = true;
        }
        // Single save — prefer currentReport (most up-to-date), fallback to list copy
        const toSave = (APP.currentReport && APP.currentReport.id === reportId)
          ? APP.currentReport : listReport;
        if (toSave) await safeLocalSave(toSave, 'fetch-cloud-photo');
        return result.dataUrl;
      }
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
    const activeReport = APP.currentReport && APP.currentReport.id === reportId ? APP.currentReport : null;
    const isReadOnly = !!(activeReport && ((APP.user && APP.user.role === 'supervisor') || activeReport.status === 'approved'));
    const deleteBtn = !isReadOnly ? `<button class="delete-photo" onclick="event.stopPropagation();delPhoto(${slotIndex})">✕</button>` : '';
    slot.innerHTML = `<img src="${dataUrl}">${deleteBtn}<div class="label">${PHOTO_SLOTS[slotIndex] || ''}</div>`;
    slot.classList.remove('cloud-pending');
    if (isReadOnly) {
      slot.removeAttribute('onclick');
      slot.style.cursor = 'default';
    } else {
      slot.setAttribute('onclick', `openPhotoMenu(${slotIndex})`);
      slot.style.cursor = 'pointer';
    }
  } else if (slot) {
    slot.innerHTML = '<div class="icon" style="color:#e74c3c">⚠</div><div style="font-size:.6rem;color:#e74c3c">加载失败</div><div class="label">' + (PHOTO_SLOTS[slotIndex] || '') + '</div>';
  }
}

async function saveReport(report) {
  report.updatedAt = new Date().toISOString();
  if (!report._uploadedPhotoSlots) report._uploadedPhotoSlots = {};
  await safeLocalSave(report, 'save-report-start');
  if (!serverOnline) {
    report.syncStatus = 'pending';
    setUploadStatus(report, { state: 'pending', message: '离线保存，待自动上传', lastError: '' });
    await safeLocalSave(report, 'save-report-offline');
    await refreshSyncStateFromLocal();
    return;
  }

  try {
    setSyncState('uploading', '正在上传当前报告...');
    const result = await uploadReportToCloud(report, 'save');
    if (!result.ok) showToast('部分内容上传失败，已进入自动重试队列', 'warning');
    await refreshSyncStateFromLocal();
  } catch (e) {
    if (e.message === 'TOKEN_EXPIRED') return;
    console.warn('Cloud save failed:', e.message);
    report.syncStatus = 'pending';
    setUploadStatus(report, { state: 'pending', message: '上传失败，等待自动重试', lastError: e.message || '未知错误' });
    await safeLocalSave(report, 'save-report-cloud-failed');
    await refreshSyncStateFromLocal();
    showToast('云端保存失败，已保存到本地', 'warning');
  }
}

async function syncPendingReports() {
  if (!serverOnline || APP.syncInProgress || !APP.user || !APP.token) return;
  const local = await localGetAll();
  const pending = local.filter(r => r.syncStatus === 'pending' || getUnsyncedPhotoSlots(r).length > 0);
  if (pending.length === 0) {
    await refreshSyncStateFromLocal();
    return;
  }

  APP.syncInProgress = true;
  let synced = 0;
  let failed = 0;
  let authExpired = false;
  try {
    setSyncState('uploading', `后台同步 0/${pending.length} 份报告...`);
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i];
      setSyncState('uploading', `后台同步 ${i + 1}/${pending.length}：${r.poOrderNo || r.id}`);
      try {
        const result = await uploadReportToCloud(r, 'background');
        if (result.ok) synced++;
        else failed++;
      } catch (e) {
        if (e.message === 'TOKEN_EXPIRED') {
          authExpired = true;
          break;
        }
        failed++;
        setUploadStatus(r, { state: 'pending', message: '同步失败，等待重试', lastError: e.message || '未知错误' });
        r.syncStatus = 'pending';
        await safeLocalSave(r, 'sync-pending-failed');
      }
    }
  } finally {
    APP.syncInProgress = false;
  }

  if (authExpired) return;
  // Refresh APP.reports from IndexedDB to reflect sync results
  APP.reports = await localGetAll();
  await refreshSyncStateFromLocal();
  if (synced > 0) showToast(`已同步 ${synced} 份报告`, 'success');
  if (failed > 0) showToast(`${failed} 份报告同步失败，将自动重试`, 'warning');
}

async function retryFailedPhotos() {
  if (!serverOnline || APP.syncInProgress || !APP.user || !APP.token) return;
  const allReports = await localGetAll();
  const needRetry = allReports.filter(r => getUnsyncedPhotoSlots(r).length > 0);
  if (needRetry.length === 0) return;

  APP.syncInProgress = true;
  let fixed = 0;
  let authExpired = false;
  try {
    setSyncState('uploading', `补传照片中 0/${needRetry.length}...`);
    for (let i = 0; i < needRetry.length; i++) {
      const report = needRetry[i];
      setSyncState('uploading', `补传照片 ${i + 1}/${needRetry.length}`);
      try {
        const result = await uploadReportToCloud(report, 'photo-retry');
        if (result.ok) fixed++;
      } catch (e) {
        if (e.message === 'TOKEN_EXPIRED') {
          authExpired = true;
          break;
        }
      }
    }
  } finally {
    APP.syncInProgress = false;
  }
  if (authExpired) return;
  await refreshSyncStateFromLocal();
  if (fixed > 0) showToast(`已完成 ${fixed} 份报告补传`, 'success');
}

// Unified background sync loop — single timer eliminates race conditions
// Runs every 90s: first syncs pending reports, then retries failed photos
APP._syncTimerId = setInterval(async () => {
  if (!serverOnline || APP.syncInProgress || !APP.user || !APP.token) return;
  try {
    await syncPendingReports();
  } catch (e) {
    setSyncState('error', '自动同步失败，将继续重试');
  }
  // After sync completes, retry any remaining failed photos
  if (!APP.syncInProgress) {
    try {
      await retryFailedPhotos();
    } catch (e) {
      setSyncState('error', '照片补传失败，将继续重试');
    }
  }
}, 90 * 1000);

// ===== INIT =====
async function init() {
  try { await openDB(); } catch (e) { console.warn('IndexedDB failed:', e); }

  // Request persistent storage to prevent browser from evicting our data
  if (navigator.storage && navigator.storage.persist) {
    try {
      const granted = await navigator.storage.persist();
      if (granted) {
        console.log('Persistent storage granted - photos will not be auto-evicted');
      } else {
        console.warn('Persistent storage denied - photos may be evicted under storage pressure');
      }
    } catch (e) { console.warn('Storage persist request failed:', e); }
  }

  await checkServer();
  APP.reports = await localGetAll();
  await refreshSyncStateFromLocal();
}
init();

// ===== ONLINE/OFFLINE LISTENERS =====
window.addEventListener('online', async () => {
  serverOnline = true;
  if (!APP.user || !APP.token) {
    setSyncState('online', '网络已恢复，请先登录');
    return;
  }
  setSyncState('online', '网络已恢复，准备同步...');
  showToast('网络已恢复，正在同步...', 'info');
  try {
    // Step 1: Pull cloud changes first (other device may have edited)
    await syncReports();
    // Step 2: Push local pending changes
    await syncPendingReports();
    // Step 3: Retry any remaining failed photos
    await retryFailedPhotos();
  } finally {
    await refreshSyncStateFromLocal();
  }
});

window.addEventListener('offline', () => {
  serverOnline = false;
  setSyncState('offline', '离线');
  showToast('已切换到离线模式', 'warning');
});


// ===== CRITICAL: Flush pending saves before page unload =====
function flushPendingSave() {
  debouncedAutoSave.cancel(); // Cancel pending debounce — we're saving now
  if (APP.currentReport) {
    try {
      if (APP.db) {
        const tx = APP.db.transaction('reports', 'readwrite');
        tx.objectStore('reports').put(JSON.parse(JSON.stringify(APP.currentReport)));
      }
    } catch (e) {
      console.warn('Emergency save failed:', e);
    }
  }
}
window.addEventListener('beforeunload', flushPendingSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && APP.currentReport) flushPendingSave();
});
window.addEventListener('pagehide', flushPendingSave);
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
  await refreshSyncStateFromLocal();
  // Restart background sync timer if it was cleared on logout
  if (!APP._syncTimerId) {
    APP._syncTimerId = setInterval(async () => {
      if (!serverOnline || APP.syncInProgress) return;
      try { await syncPendingReports(); } catch (e) { setSyncState('error', '自动同步失败，将继续重试'); }
      if (!APP.syncInProgress) {
        try { await retryFailedPhotos(); } catch (e) { setSyncState('error', '照片补传失败，将继续重试'); }
      }
    }, 90 * 1000);
  }
  document.getElementById('loginPage').classList.remove('active');
  document.getElementById('mainApp').classList.add('active');
  document.getElementById('userBadge').textContent = APP.user.name;
  switchTab('list');
  window.scrollTo(0, 0);
}

function logout() {
  // Flush any pending data before clearing state
  debouncedAutoSave.cancel();
  flushPendingSave();
  // Clear background sync timer
  if (APP._syncTimerId) { clearInterval(APP._syncTimerId); APP._syncTimerId = null; }
  APP.user = null;
  APP.token = null;
  APP.currentReport = null;
  APP.syncInProgress = false;
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
    boxWeightKg: '', palletWeightKg: '', finalResult: 'pass', photos: {}, _uploadedPhotoSlots: {},
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
  debouncedAutoSave.cancel(); // Cancel any pending save from previous report
  const r = APP.reports.find(r => r.id === id);
  if (!r) { showToast('报告未找到', 'error'); return; }
  APP.currentReport = JSON.parse(JSON.stringify(r));
  // Ensure critical properties exist (protect against old reports)
  if (!APP.currentReport.photos) APP.currentReport.photos = {};
  if (!APP.currentReport.dimensions) APP.currentReport.dimensions = {};
  if (!APP.currentReport._uploadedPhotoSlots) APP.currentReport._uploadedPhotoSlots = {};
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

function onPhotoSlotClick(slotIndex, cloudPending) {
  if (cloudPending) {
    const reportId = APP.currentReport && APP.currentReport.id;
    if (reportId) loadCloudPhoto(reportId, slotIndex);
    return;
  }
  openPhotoMenu(slotIndex);
}

function getReportUploadMeta(report) {
  const us = report?.uploadStatus || {};
  const unsynced = getUnsyncedPhotoSlots(report).length;

  if (us.state === 'uploading') {
    return {
      text: us.message || (us.total > 0 ? `上传中 ${us.done || 0}/${us.total}` : '上传中...'),
      className: 'upload-status-uploading'
    };
  }

  if (report?.syncStatus === 'pending' || unsynced > 0 || us.state === 'pending') {
    const fallback = unsynced > 0 ? `待上传 ${unsynced} 张照片` : '待同步';
    return {
      text: us.message || fallback,
      className: 'upload-status-pending'
    };
  }

  if (report?.syncStatus === 'synced' || us.state === 'synced') {
    return {
      text: us.message || '云端已同步',
      className: 'upload-status-synced'
    };
  }

  if (us.lastError) {
    return {
      text: `上传异常：${us.lastError}`,
      className: 'upload-status-error'
    };
  }

  return {
    text: serverOnline ? '云端连接正常' : '离线模式',
    className: 'upload-status-idle'
  };
}

function refreshCurrentReportUploadStatusUI() {
  if (!APP.currentReport) return;
  const el = document.querySelector('#reportForm .upload-status');
  if (!el) return;
  const meta = getReportUploadMeta(APP.currentReport);
  el.className = `upload-status ${meta.className}`;
  el.textContent = meta.text;
}

// ===== RENDER FORM =====
function renderReportForm() {
  const r = APP.currentReport;
  const isReadOnly = APP.user.role === 'supervisor' || r.status === 'approved';
  const ro = isReadOnly ? 'readonly' : '';
  const dis = isReadOnly ? 'disabled' : '';
  const uploadMeta = getReportUploadMeta(r);

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
        const isCloudPending = isPhotoPlaceholder(img);
        const hasRealPhoto = isRealPhotoDataUrl(img);
        return `<div class="photo-slot ${isCloudPending ? 'cloud-pending' : ''}" onclick="onPhotoSlotClick(${i},${isCloudPending ? 'true' : 'false'})" style="cursor:${dis && !isCloudPending ? 'default' : 'pointer'}" id="photo-slot-${i}">
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
      <div class="upload-status ${uploadMeta.className}" style="margin-top:8px">${escapeHtml(uploadMeta.text)}</div>
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
    if (!APP.currentReport._uploadedPhotoSlots) APP.currentReport._uploadedPhotoSlots = {};
    APP.currentReport._uploadedPhotoSlots[APP.editingPhotoSlot] = false;
    APP.currentReport.syncStatus = 'pending';
    setUploadStatus(APP.currentReport, { state: 'pending', message: '照片已更新，待上传', lastError: '' });
    // CRITICAL: Save photos IMMEDIATELY (not debounced) to prevent data loss
    await localSave(APP.currentReport);
    await refreshSyncStateFromLocal();
    console.log(`Photo slot ${APP.editingPhotoSlot} saved to IndexedDB immediately`);

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
  if (!APP.currentReport._uploadedPhotoSlots) APP.currentReport._uploadedPhotoSlots = {};
  delete APP.currentReport._uploadedPhotoSlots[i];
  APP.currentReport.syncStatus = 'pending';
  setUploadStatus(APP.currentReport, { state: 'pending', message: '照片删除待同步', lastError: '' });
  // Track deleted photo slots for cloud sync
  if (!APP.currentReport._deletedPhotoSlots) APP.currentReport._deletedPhotoSlots = [];
  if (!APP.currentReport._deletedPhotoSlots.includes(i)) APP.currentReport._deletedPhotoSlots.push(i);
  safeLocalSave(APP.currentReport, 'delete-photo').then(() => refreshSyncStateFromLocal()); // Save immediately, not debounced
  renderReportForm();
  showStep(3, document.querySelectorAll('.tabs button')[3]);
}

// ===== SAVE / SUBMIT / APPROVE =====
async function saveDraft() {
  debouncedAutoSave.cancel(); // Cancel pending debounce to prevent overwrite
  const r = APP.currentReport;
  r.status = 'draft';
  await saveReport(r);
  APP.reports = await localGetAll();
  showToast('已保存 Saved', 'success');
}

async function submitReport() {
  debouncedAutoSave.cancel();
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
  debouncedAutoSave.cancel();
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
      <div class="report-info"><h3>PO: ${escapeHtml(r.poOrderNo || '--')} ${escapeHtml(r.colorFilmModel || '')}</h3><p>${escapeHtml(r.date || '')} · ${escapeHtml(r.inspector || '')}</p></div>
      <div style="display:flex;gap:4px;flex-direction:column">
        <button class="btn btn-sm btn-outline trash-restore-btn" data-report-id="${escapeHtml(r.id)}" style="padding:4px 8px;font-size:.7rem">恢复</button>
        <button class="btn btn-sm btn-danger trash-delete-btn" data-report-id="${escapeHtml(r.id)}" style="padding:4px 8px;font-size:.7rem">永删</button>
      </div>
    </div>`).join('')}</div>`;

  document.querySelectorAll('#trashList .trash-restore-btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const reportId = btn.getAttribute('data-report-id');
      if (reportId) restoreReport(reportId);
    });
  });
  document.querySelectorAll('#trashList .trash-delete-btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const reportId = btn.getAttribute('data-report-id');
      if (reportId) permanentDelete(reportId);
    });
  });
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
    <div class="report-item report-open-item" data-report-id="${escapeHtml(r.id)}" data-status="${r.status}">
      <div style="width:40px;height:40px;background:${r.finalResult === 'pass' ? '#d4edda' : '#f8d7da'};border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem">${r.finalResult === 'pass' ? '✅' : '❌'}</div>
      <div class="report-info">
        <h3>PO: ${escapeHtml(r.poOrderNo || '--')} ${escapeHtml(r.colorFilmModel || '')}</h3>
        <p>${escapeHtml(r.date || '')} · ${escapeHtml(r.inspector || '')} · ${escapeHtml(r.productType || '')}</p>
        ${(() => { const up = getReportUploadMeta(r); return `<p class="upload-status ${up.className}">${escapeHtml(up.text)}</p>`; })()}
      </div>
      <span class="badge ${sClass[r.status]}">${sLabel[r.status]}</span>
    </div>`).join('')}</div>`;

  document.querySelectorAll('#rptList .report-open-item').forEach(item => {
    item.addEventListener('click', () => {
      const reportId = item.getAttribute('data-report-id');
      if (reportId) editReport(reportId);
    });
  });
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
