---
name: senia-pwa
description: >
  森雅国际 PWA 验货系统开发与优化技能。涵盖 Progressive Web App 全栈最佳实践：
  Service Worker 缓存策略、离线优先架构、Supabase 集成安全、图片压缩与存储、
  IndexedDB 数据同步、PWA 安装体验、移动端性能优化、XSS 防护、PDF 生成。
  当用户提到以下场景时必须触发：PWA 优化、Service Worker、离线支持、缓存策略、
  PWA 安装、性能优化、Supabase 安全、图片上传、IndexedDB、数据同步、
  后台同步、推送通知、manifest 配置、移动端适配、XSS 修复、验货系统优化。
  即使用户只是说"帮我优化一下app""加个离线功能""为什么加载慢""安全检查"也应触发。
---

# 森雅 PWA 验货系统 — 开发与优化技能

## 一、系统架构概览

森雅验货系统是一个面向质检员和主管的移动端 PWA，用于工厂现场验货。核心技术栈：

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | 单页 HTML + 原生 JS | 无框架，轻量快速 |
| 后端 | Supabase (PostgreSQL) | REST API 直连，anon key |
| 离线 | IndexedDB + Service Worker | 断网可用，恢复后同步 |
| 部署 | Netlify (静态托管) | 自动部署，全球 CDN |
| 导出 | jsPDF + html2canvas | 客户端生成 PDF 报告 |

项目根目录结构：
```
inspection-pwa/
├── index.html          # 主应用（HTML + CSS + JS 全在一个文件）
├── sw.js               # Service Worker
├── manifest.json       # PWA manifest
├── netlify.toml        # Netlify 部署配置
├── supabase-setup.sql  # 数据库建表语句
└── _archive/           # 归档的旧文件
```

### 当前用户角色

- **inspector（质检员）**：在工厂现场拍照、测量尺寸、填写检验项、提交报告
- **supervisor（主管）**：审批报告（approve/reject）、查看全部报告、导出 PDF

### 数据流

```
用户操作 → IndexedDB（本地保存）→ Supabase（云端同步）
                  ↑                        ↓
           离线时回退读取            在线时拉取最新数据
```

---

## 二、安全规范（最高优先级）

安全问题在质检系统中尤其重要——报告涉及产品质量判定，篡改可能导致不合格产品出厂。

### 2.1 XSS 防护

**原则：永远不要将用户输入直接拼接到 innerHTML 中。**

所有来自用户或数据库的字符串，在插入 DOM 前必须转义：

```javascript
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
```

适用场景（必须转义的字段）：
- PO 订单号、彩膜型号、客户名、产品名
- 检验备注（inspectRemarks）
- 任何 `<input>` 的 value 属性拼接
- 报告列表中的标题/摘要

优先使用 `textContent` 而非 `innerHTML`；如果必须用 `innerHTML`，所有动态值都用 `escapeHtml()` 包裹。

### 2.2 Supabase 安全

**anon key 在前端是正常的**（它是公开的），但安全完全依赖 Row Level Security (RLS)：

```sql
-- 必须在 Supabase 启用的 RLS 策略示例
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- 质检员只能看到自己的报告
CREATE POLICY "inspector_own_reports" ON reports
  FOR SELECT USING (auth.uid() = inspector_id);

-- 主管可以看所有报告
CREATE POLICY "supervisor_view_all" ON reports
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'supervisor')
  );
```

关键检查项：
- 确认 RLS 已开启（不开启 = 任何人可读写所有数据）
- 使用 Supabase Auth 替代硬编码密码
- 敏感操作（删除、审批）添加服务端验证

### 2.3 认证安全

**禁止在前端代码中硬编码用户名和密码。** 离线登录应使用加密存储的 token，而不是明文密码比对。

迁移路径：
1. 使用 Supabase Auth（email/password 或 magic link）
2. 登录成功后将 session token 存入 IndexedDB
3. 离线时验证本地 token 是否未过期
4. 移除代码中的 USERS 常量

---

## 三、Service Worker 最佳实践

### 3.1 缓存策略选择

| 资源类型 | 策略 | 原因 |
|----------|------|------|
| index.html | Network First | 确保用户总是拿到最新版 |
| CDN 库 (jsPDF等) | Cache First | 版本固定，几乎不变 |
| Supabase API | Network Only | 数据必须实时，不能缓存 |
| manifest.json | Stale While Revalidate | 变化少但需要最终一致 |
| 图片/照片 | Cache First | 上传后不会变 |

### 3.2 缓存版本管理

每次发布新版本时递增 `CACHE_NAME` 的版本号。在 `activate` 事件中清除旧缓存：

```javascript
const CACHE_NAME = 'inspection-pwa-v6';

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});
```

### 3.3 更新提示

当检测到新版本时应通知用户刷新，避免他们一直使用旧缓存：

```javascript
// 在 index.html 中注册 SW 时
navigator.serviceWorker.register('/sw.js').then(reg => {
  reg.addEventListener('updatefound', () => {
    const newWorker = reg.installing;
    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'activated') {
        showToast('新版本已就绪，请刷新页面', 'info');
      }
    });
  });
});
```

---

## 四、离线优先架构

### 4.1 IndexedDB 规范

数据库结构应支持版本迁移：

```javascript
const DB_VERSION = 3;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('InspectionDB', DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      // v1: 基础报告存储
      if (!db.objectStoreNames.contains('reports')) {
        db.createObjectStore('reports', { keyPath: 'id' });
      }
      // v2: 添加同步队列
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      }
      // v3: 添加照片独立存储（减少报告体积）
      if (!db.objectStoreNames.contains('photos')) {
        const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
        photoStore.createIndex('reportId', 'reportId');
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}
```

### 4.2 数据同步策略

同步的核心原则：**本地优先写入，后台异步上传，冲突时以最新时间戳为准。**

```javascript
async function syncReport(report) {
  // 1. 先存本地（确保不丢失）
  await localSave(report);

  // 2. 尝试上传到 Supabase
  if (navigator.onLine) {
    try {
      await sbFetch('reports', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(report)
      });
      report.syncStatus = 'synced';
      await localSave(report);
      showToast('已同步到云端', 'success');
    } catch (e) {
      report.syncStatus = 'pending';
      await localSave(report);
      showToast('离线模式：稍后自动同步', 'warning');
    }
  }
}
```

### 4.3 网络状态监听

```javascript
window.addEventListener('online', async () => {
  showToast('网络已恢复，正在同步...', 'info');
  await syncPendingReports();
});

window.addEventListener('offline', () => {
  showToast('已切换到离线模式', 'warning');
});
```

---

## 五、图片处理优化

这是该系统的性能瓶颈——29 张检验照片，每张经 Base64 编码后 100-300KB。

### 5.1 压缩策略

```javascript
function compressImage(file, maxWidth = 1024, quality = 0.7) {
  return new Promise(resolve => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = h * maxWidth / w; w = maxWidth; }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
```

### 5.2 存储方案（推荐迁移到 Supabase Storage）

当前方案（Base64 存在 JSON 字段）的问题：
- 一份报告可达 3-9MB，传输和存储都浪费
- IndexedDB 存大量 Base64 字符串会导致低端手机卡顿
- Supabase 的 JSON 字段有大小限制

推荐方案：

```javascript
// 上传到 Supabase Storage
async function uploadPhoto(reportId, slotName, blob) {
  const path = `reports/${reportId}/${slotName}.jpg`;
  const resp = await fetch(
    `${SUPABASE_URL}/storage/v1/object/inspections/${path}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'image/jpeg',
      },
      body: blob
    }
  );
  if (!resp.ok) throw new Error('Photo upload failed');
  // 返回公开 URL
  return `${SUPABASE_URL}/storage/v1/object/public/inspections/${path}`;
}
```

离线拍照时先存 Blob 到 IndexedDB 的 photos store，恢复网络后批量上传。

---

## 六、输入验证

质检数据必须严格验证——错误的尺寸数据可能导致产品误判。

### 6.1 数值验证

```javascript
function validateDimension(key, index, value) {
  const num = parseFloat(value);
  if (isNaN(num)) {
    showToast('请输入有效数字', 'error');
    return false;
  }
  if (num < 0) {
    showToast('尺寸不能为负数', 'error');
    return false;
  }

  // 根据测量项设置合理范围
  const ranges = {
    length: { min: 100, max: 3000, unit: 'mm' },
    width: { min: 100, max: 2000, unit: 'mm' },
    thickness: { min: 0.1, max: 50, unit: 'mm' },
    gloss: { min: 0, max: 100, unit: '°' },
  };
  const range = ranges[key];
  if (range && (num < range.min || num > range.max)) {
    showToast(`${key} 通常在 ${range.min}-${range.max}${range.unit}，请确认`, 'warning');
  }
  return true;
}
```

### 6.2 表单完整性检查

提交前确保必填字段已填写：

```javascript
function validateBeforeSubmit(report) {
  const errors = [];
  if (!report.poOrderNo?.trim()) errors.push('PO 订单号');
  if (!report.colorFilmModel?.trim()) errors.push('彩膜型号');
  if (!report.customerName?.trim()) errors.push('客户名称');

  // 检查尺寸数据是否有至少 3 个有效值
  ['length', 'width', 'thickness'].forEach(key => {
    const valid = (report.dimensions?.[key] || []).filter(v => v !== '' && !isNaN(v));
    if (valid.length < 3) errors.push(`${key} 至少需要 3 个测量值`);
  });

  if (errors.length) {
    showToast('请填写：' + errors.join('、'), 'error');
    return false;
  }
  return true;
}
```

---

## 七、错误处理与用户反馈

**原则：任何可能失败的操作都要给用户明确反馈，绝不能静默失败。**

### 7.1 统一错误处理

```javascript
async function safeAsync(fn, errorMsg = '操作失败') {
  try {
    return await fn();
  } catch (e) {
    console.error(errorMsg, e);
    showToast(`${errorMsg}：${e.message || '未知错误'}`, 'error');
    return null;
  }
}

// 使用示例
await safeAsync(
  () => syncReports(),
  '同步报告失败'
);
```

### 7.2 需要错误处理的关键场景

- **网络请求**：sbFetch 调用（同步、查询、提交）
- **图片处理**：拍照、压缩、Base64 转换
- **PDF 生成**：html2canvas 渲染、jsPDF 导出
- **IndexedDB**：打开数据库、读写操作
- **Service Worker**：注册失败

---

## 八、PWA 安装与体验增强

### 8.1 安装提示

```javascript
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  // 显示自定义安装按钮
  document.getElementById('installBtn').style.display = 'block';
});

function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(result => {
    if (result.outcome === 'accepted') {
      showToast('安装成功！', 'success');
    }
    deferredPrompt = null;
    document.getElementById('installBtn').style.display = 'none';
  });
}
```

### 8.2 manifest.json 完善

```json
{
  "name": "森雅验货系统",
  "short_name": "SenYa QC",
  "description": "质量检验报告管理系统",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#f0f2f5",
  "theme_color": "#1a5276",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "categories": ["business", "productivity"],
  "lang": "zh-CN"
}
```

---

## 九、性能优化

### 9.1 渲染优化

当前每次编辑报告都会重建所有 tab 的 HTML（尺寸、检验项、照片、包装），即使只显示一个 tab。改为按需渲染：

```javascript
function showTab(tabName) {
  // 只渲染当前 tab 的内容
  const renderers = {
    dims: renderDimensionsTab,
    inspect: renderInspectTab,
    photos: renderPhotosTab,
    packaging: renderPackagingTab,
  };
  if (renderers[tabName]) {
    document.getElementById(`tab-${tabName}`).innerHTML = renderers[tabName]();
  }
  // 切换显示
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).classList.add('active');
}
```

### 9.2 照片懒加载

报告列表中的缩略图应该懒加载，避免一次性加载大量 Base64 图片：

```javascript
// 使用 Intersection Observer
const photoObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      img.src = img.dataset.src;
      photoObserver.unobserve(img);
    }
  });
}, { rootMargin: '100px' });

// 在渲染照片时
function renderPhotoThumb(base64) {
  return `<img class="photo-thumb" data-src="${base64}" src="placeholder.svg" />`;
}
```

### 9.3 debounce 输入处理

尺寸输入的 `onchange` 在快速输入时会频繁触发数据保存，添加防抖：

```javascript
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const debouncedSave = debounce(() => localSave(APP.currentReport), 500);
```

---

## 十、代码架构改进

当前整个应用在一个 HTML 文件中（~1000 行），维护困难。推荐按功能拆分：

```
inspection-pwa/
├── index.html              # 入口 HTML（只有结构和样式）
├── js/
│   ├── app.js              # 应用初始化、状态管理
│   ├── auth.js             # 登录/登出、Supabase Auth
│   ├── api.js              # Supabase API 封装、sbFetch
│   ├── db.js               # IndexedDB 操作
│   ├── sync.js             # 数据同步逻辑
│   ├── report.js           # 报告 CRUD
│   ├── inspection.js       # 检验项、尺寸录入
│   ├── photos.js           # 拍照、压缩、上传
│   ├── pdf.js              # PDF 生成
│   └── utils.js            # escapeHtml、showToast、debounce 等工具
├── css/
│   └── styles.css          # 样式抽离
├── sw.js
├── manifest.json
└── netlify.toml
```

拆分时使用 ES Modules（`<script type="module">`），浏览器原生支持，无需打包工具。

---

## 十一、优化检查清单

每次修改代码后，对照此清单逐项确认：

### 安全
- [ ] 所有 innerHTML 中的用户数据都用 escapeHtml() 转义
- [ ] 没有硬编码的用户名/密码
- [ ] Supabase RLS 已开启
- [ ] 敏感操作有权限验证

### 离线
- [ ] 本地保存在网络请求之前
- [ ] 网络失败有用户提示
- [ ] 恢复网络后自动同步待上传数据
- [ ] Service Worker 缓存版本已更新

### 性能
- [ ] 图片已压缩（maxWidth 1024, quality 0.7）
- [ ] 大列表使用懒加载
- [ ] 输入操作有 debounce
- [ ] 只渲染当前可见的 tab

### 用户体验
- [ ] 所有异步操作有 loading 状态
- [ ] 所有错误有 toast 提示
- [ ] 表单必填字段有验证
- [ ] 提交前有确认对话框
