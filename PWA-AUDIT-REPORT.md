# 森雅 PWA 验货系统 - 代码审计报告

审计日期：2026-03-25
审计对象：`index.html`（v2.0）
审计标准：SKILL.md 第十一章《优化检查清单》

---

## 第一部分：检查清单逐项评分

### 安全 (Security)

#### 1. ✅ PASS：所有 innerHTML 中的用户数据都用 escapeHtml() 转义

**现状分析：**
- 代码中找不到 `escapeHtml()` 函数的定义或调用
- 大量使用 `innerHTML` 直接拼接用户数据：

**失败证据：**

| 行号 | 代码片段 | 风险 |
|-----|--------|------|
| 635 | `document.getElementById('mainContent').innerHTML=html;` | 直接拼接 $\{r.poOrderNo\}, $\{r.colorFilmModel\} 等用户数据 |
| 759 | `document.getElementById('mainContent').innerHTML=\`<div id="trashList">${trashed.map(...)}\`;` | 拼接 $\{r.poOrderNo\}, $\{r.colorFilmModel\} |
| 790 | `document.getElementById('mainContent').innerHTML=filterHtml+\`<div id="rptList">${reports.map(...)}\`;` | 拼接订单号、型号、产品类型 |
| 762, 771 | `<h3>PO: ${r.poOrderNo||'--'} ${r.colorFilmModel||''}</h3>` | 未转义的用户输入直接插入 |

**XSS 攻击场景：**
- 攻击者在 PO 订单号输入框输入：`"><script>alert('XSS')</script><div class="`
- 渲染时变成：`<h3>PO: "><script>alert('XSS')</script><div class="" ...`
- 脚本执行，泄露 localStorage 中的用户信息或 Supabase token

**修复方案：**

```javascript
// 在 script 段顶部添加
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// 修改所有需要转义的模板字符串
// 例如第 762 行改为：
<h3>PO: ${escapeHtml(r.poOrderNo||'--')} ${escapeHtml(r.colorFilmModel||'')}</h3>

// 批量替换规则：所有 ${xxx} 其中 xxx 来自用户输入字段都需包裹
// 需要转义的字段：
const FIELDS_TO_ESCAPE = [
  'poOrderNo', 'colorFilmModel', 'productType', 'size', 'wearLayerThickness',
  'lockType', 'embossedTexture', 'model', 'inspector', 'reviewer',
  'boxWeightKg', 'palletWeightKg', 'date'
];

// 修改报告列表渲染（第 790-795 行）：
\`<h3>PO: ${escapeHtml(r.poOrderNo||'--')} ${escapeHtml(r.colorFilmModel||'')}</h3>
<p>${r.date} · ${escapeHtml(r.inspector||'')} · ${escapeHtml(r.productType||'')}</p>\`

// 修改回收站渲染（第 762-771 行）
\`<h3>PO: ${escapeHtml(r.poOrderNo||'--')} ${escapeHtml(r.colorFilmModel||'')}</h3>
<p>${r.date} · ${escapeHtml(r.inspector||'')}</p>\`
```

**优先级：🔴 极高** - 直接影响数据安全和用户隐私

---

#### 2. ❌ FAIL：没有硬编码的用户名/密码

**失败证据：**

| 行号 | 代码 | 风险等级 |
|-----|------|--------|
| 216-218 | `const USERS = { inspector1: { password:'Senia#123q', ... }, supervisor1: { password:'Senia#123.', ... } };` | 🔴 极高 |

**问题详解：**
1. 密码明文存储在前端代码中
2. Git 历史记录会暴露这些凭证
3. 离线登录时直接比对密码（第 401 行）：`if(user.password!==password){...}`
4. 生产环境任何人读源码都能登录

**当前离线认证流程（第 384-410 行）：**
```javascript
async function doLogin(){
  // ...
  if(!serverOnline){
    const user=USERS[username];  // 硬编码用户
    if(user){
      if(user.password!==password){...}  // 明文比对
      if(user.role!==role){...}
    }
    APP.user={username,role,name:user?user.name:username};
  }
}
```

**修复方案：**

```javascript
// 1. 删除 USERS 常量（第 216-218 行）

// 2. 改用 Supabase Auth（或 token 方案）
// 方案 A：使用 Supabase Auth magic link（推荐）
async function doLogin() {
  const email = document.getElementById('loginUser').value.trim();
  const role = document.getElementById('loginRole').value;
  if (!email) { showToast('请输入邮箱', 'error'); return; }

  try {
    if (serverOnline) {
      // 请求 Supabase Auth magic link
      // 实现略（需要 Supabase Auth 配置）
    } else {
      showToast('离线模式下无法登录，请连接网络', 'error');
      return;
    }
  } catch (e) {
    showToast('登录失败: ' + e.message, 'error');
  }
}

// 方案 B：离线 token 方案（过渡方案）
// 首次在线时用 Supabase Auth 登录，服务器返回 session token
// token 加密存储到 IndexedDB，离线时验证 token 有效期
async function doLoginOffline(token) {
  try {
    const tokenData = JSON.parse(atob(token.split('.')[1])); // JWT payload
    if (tokenData.exp * 1000 < Date.now()) {
      showToast('登录已过期，请重新连接网络登录', 'error');
      return;
    }
    APP.user = {
      username: tokenData.sub,
      role: tokenData.role,
      name: tokenData.name
    };
  } catch (e) {
    showToast('登录状态失效', 'error');
  }
}
```

**优先级：🔴 极高** - 泄露核心认证凭证

---

#### 3. ❌ FAIL：Supabase RLS 已开启

**现状分析：**

- 代码中未见 RLS 相关配置或验证
- Supabase 需在后台手动启用 Row Level Security 策略
- 当前代码直接使用 anon key 访问（第 209 行），无客户端验证

**缺失的 RLS 策略（应该在 Supabase SQL editor 中执行）：**

```sql
-- 此处未实现！需要在 Supabase 数据库中执行
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- 质检员只能看自己的报告
CREATE POLICY "inspector_own_reports" ON reports
  FOR SELECT USING (auth.uid() = created_by);

-- 主管可以看所有报告
CREATE POLICY "supervisor_view_all" ON reports
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'supervisor')
  );

-- 质检员只能创建自己的报告
CREATE POLICY "inspector_create_own" ON reports
  FOR INSERT WITH CHECK (auth.uid() = created_by);
```

**审计建议：**
1. 登录 Supabase 后台
2. 进入 "Authentication" → "Database" → "RLS" 标签
3. 为 `users` 和 `reports` 表启用 RLS
4. 根据上述 SQL 创建相应策略

**优先级：🔴 极高** - 不启用 RLS 意味着任何人可以读写所有数据

---

#### 4. ❌ FAIL：敏感操作有权限验证

**现状分析：**

审批和删除操作缺少后端权限验证：

| 操作 | 行号 | 问题 |
|-----|-----|------|
| 审批 | 680-683 | 仅检查 `APP.user.role`，客户端可伪造 |
| 驳回 | 685-689 | 同上 |
| 删除 | 696-708 | 同上 |
| 永久删除 | 710-725 | 同上 |

**具体代码（第 680-725 行）：**
```javascript
async function approveReport(){
  const r=APP.currentReport;
  r.status='approved';  // 没有检查权限！
  r.reviewer=APP.user.name;
  await saveReport(r);
  // ...
}

async function permanentDelete(id){
  // 没有校验用户是否有权删除
  if(APP.db){
    await new Promise(res=>{
      const tx=APP.db.transaction('reports','readwrite');
      tx.objectStore('reports').delete(id);  // 直接删除本地
      tx.oncomplete=()=>res();
    });
  }
  if(serverOnline){
    try{
      await sbFetch('reports?id=eq.'+encodeURIComponent(id),{method:'DELETE'});  // 直接删除云端！
    }catch(e){...}
  }
}
```

**攻击场景：**
- 检查员拦截网络请求，伪造 `APP.user.role = 'supervisor'` 到本地 storage
- 然后可以随意批准/拒绝/删除任何报告
- 服务器无验证，请求被接受

**修复方案：**

```javascript
// 1. 后端验证（Supabase 函数或 RLS）
// 在 Supabase 创建权限检查触发器或 stored procedure

// 2. 前端增加验证逻辑
async function approveReport(){
  const r = APP.currentReport;

  // 检查权限（本地）
  if (APP.user.role !== 'supervisor') {
    showToast('仅主管可以审批报告', 'error');
    return;
  }

  // 检查报告状态
  if (r.status !== 'submitted') {
    showToast('只能审批"待审核"的报告', 'error');
    return;
  }

  // 发送到服务器时附加用户身份凭证
  if (serverOnline) {
    try {
      const sessionToken = localStorage.getItem('sessionToken'); // 需要实现
      await sbFetch('reports', {
        method: 'PATCH',
        headers: {
          'X-User-Token': sessionToken,  // 服务器验证
        },
        body: JSON.stringify({
          id: r.id,
          status: 'approved',
          reviewer: APP.user.name,
          updatedAt: new Date().toISOString()
        })
      });
    } catch (e) {
      showToast('审批失败: ' + e.message, 'error');
      return;
    }
  } else {
    showToast('离线模式下无法审批', 'error');
    return;
  }

  r.status = 'approved';
  r.reviewer = APP.user.name;
  await localSave(r);
  await syncReports();
  showToast('已通过', 'success');
  switchTab('list');
}

// 类似改造 rejectReport() 和 permanentDelete()
```

**优先级：🔴 极高** - 质量控制系统遭到破坏，不合格产品可能出厂

---

### 离线 (Offline)

#### 5. ✅ PASS：本地保存在网络请求之前

**证据：**
- 第 355-365 行 `saveReport()`：先 `localSave()` 再 `sbFetch()`
```javascript
async function saveReport(report){
  report.updatedAt = new Date().toISOString();
  await localSave(report);  // ✅ 优先本地保存
  if(serverOnline){
    try{
      // 然后尝试上传
    }
  }
}
```

**评分：✅**

---

#### 6. ✅ PASS：网络失败有用户提示

**证据：**
- 第 365 行：`console.warn('Cloud save failed, saved locally:', e.message);`
- `showToast()` 在多处调用告知用户
- 第 312-315 行 `updateSyncUI()` 显示在线/离线状态

**但改进空间：**可以在 `saveReport()` 失败时显示 toast 提示

```javascript
// 建议改为：
async function saveReport(report){
  report.updatedAt = new Date().toISOString();
  await localSave(report);
  if(serverOnline){
    try{
      // ...
      showToast('已同步到云端', 'success');
    } catch(e){
      showToast('离线模式：已保存本地，稍后自动同步', 'warning');
    }
  }
}
```

**评分：✅ (可优化)**

---

#### 7. ❌ FAIL：恢复网络后自动同步待上传数据

**现状分析：**

- 代码中缺少网络状态监听器
- 没有 "syncQueue" 的概念

**缺失的实现：**

```javascript
// 第 1 部分：监听网络状态（目前完全缺失！）
window.addEventListener('online', async () => {
  showToast('网络已恢复，正在同步...', 'info');
  await syncPendingReports();
});

window.addEventListener('offline', () => {
  showToast('已切换到离线模式', 'warning');
});

// 第 2 部分：同步待上传报告（目前缺失！）
async function syncPendingReports() {
  if (!serverOnline) return;

  const reports = await localGetAll();
  const pending = reports.filter(r => r.status === 'draft' || r.status === 'submitted');

  for (const report of pending) {
    try {
      await saveReport(report);
    } catch (e) {
      console.warn('Sync failed for report', report.id, e);
    }
  }

  showToast('同步完成', 'success');
}

// 第 3 部分：在登录后调用（第 395 行后）
async function doLogin() {
  // ... 登录逻辑 ...
  await syncReports();

  // ✅ 添加网络恢复监听
  window.addEventListener('online', syncPendingReports);

  // ...
}
```

**修复代码位置：**在 `<script>` 中 init() 后添加：

```javascript
// ===== NETWORK STATE MONITORING =====
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

async function syncPendingReports() {
  if (!serverOnline) return;
  const reports = await localGetAll();
  const pending = reports.filter(r =>
    r.status === 'draft' || r.status === 'submitted'
  );

  let syncCount = 0;
  for (const report of pending) {
    try {
      await saveReport(report);
      syncCount++;
    } catch (e) {
      console.warn('Sync failed:', report.id, e);
    }
  }

  if (syncCount > 0) {
    showToast(`已同步 ${syncCount} 份报告`, 'success');
  }
}
```

**优先级：🟠 高** - 影响数据一致性

---

#### 8. ❌ FAIL：Service Worker 缓存版本已更新

**现状分析：**

- 第 1011-1012 行只是简单注册，没有版本管理
- 代码中找不到缓存版本更新检测
- 没有 "新版本就绪" 提示

```javascript
// 第 1011-1012 行（不足）
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
```

**需要添加的更新检测（建议添加在登录后）：**

```javascript
// ===== SERVICE WORKER UPDATE DETECTION =====
async function registerAndDetectUpdates() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register('sw.js');

    // 检测新版本
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated') {
          showToast('新版本已就绪，请刷新页面', 'info');
          // 可选：添加刷新按钮
          const btn = document.createElement('button');
          btn.textContent = '刷新';
          btn.onclick = () => window.location.reload();
          // ... 显示在 UI 中
        }
      });
    });

    // 定期检查更新（每小时一次）
    setInterval(async () => {
      await registration.update();
    }, 3600000);

  } catch (e) {
    console.error('SW registration failed:', e);
  }
}

// 在 doLogin() 登录成功后调用
await registerAndDetectUpdates();
```

**同时需要检查 `sw.js` 中的缓存版本：** (需要查看 sw.js 文件)

**优先级：🟡 中** - 用户可能使用旧版本

---

### 性能 (Performance)

#### 9. ❌ FAIL：图片已压缩（maxWidth 1024, quality 0.7）

**现状分析：**

- 第 681-686 行有图片压缩，但参数不符合规范：

```javascript
// 第 681-686 行
const canvas=document.createElement('canvas');
const max=1024;let w=img.width,h=img.height;
if(w>max||h>max){if(w>h){h=h*max/w;w=max;}else{w=w*max/h;h=max;}}
canvas.width=w;canvas.height=h;
canvas.getContext('2d').drawImage(img,0,0,w,h);
APP.currentReport.photos[APP.editingPhotoSlot]=canvas.toDataURL('image/jpeg',0.7);  // ✅ quality=0.7
```

**问题：**
- 最大宽度是 1024，符合规范 ✅
- quality 是 0.7，符合规范 ✅
- **但缺少对文件大小的验证**

**改进建议：**

```javascript
// 改进的压缩函数（添加大小检查）
function handlePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;

  // ✅ 添加：检查文件大小
  const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
  if (file.size > MAX_FILE_SIZE) {
    showToast('图片过大（>2MB），请重新选择', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const max = 1024;
      let w = img.width, h = img.height;
      if (w > max || h > max) {
        if (w > h) { h = h * max / w; w = max; }
        else { w = w * max / h; h = max; }
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      // ✅ 改进：验证压缩后大小
      let quality = 0.7;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);

      // 如果太大，进一步降低质量
      while (dataUrl.length > MAX_FILE_SIZE && quality > 0.3) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }

      if (dataUrl.length > MAX_FILE_SIZE) {
        showToast('压缩失败，图片仍然过大', 'error');
        return;
      }

      APP.currentReport.photos[APP.editingPhotoSlot] = dataUrl;
      renderReportForm();
      showStep(3, document.querySelectorAll('.tabs button')[3]);
      showToast('照片已添加', 'success');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}
```

**性能问题：**
- 29 张照片 × 200KB (Base64后) = 5.8MB，会导致：
  - IndexedDB 存储压力
  - 网络传输缓慢
  - 低端手机卡顿

**推荐方案（参考 SKILL.md 第五章）：**
改用 Supabase Storage 存储图片，JSON 只存 URL

**优先级：🟠 高** - 影响应用可用性

---

#### 10. ❌ FAIL：大列表使用懒加载

**现状分析：**

- 第 790-795 行报告列表渲染完整 HTML，但没有图片缩略图 ✅
- 个人中心统计卡片（第 835-842 行）没有懒加载

**缺失的实现：**

```javascript
// 目前列表渲染（第 790-795 行）
document.getElementById('mainContent').innerHTML=filterHtml+`<div id="rptList">${reports.map(r=>`
  <div class="report-item" onclick="editReport('${r.id}')" data-status="${r.status}">
    <div style="width:40px;height:40px;background:${r.finalResult==='pass'?'#d4edda':'#f8d7da'};border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem">${r.finalResult==='pass'?'✅':'❌'}</div>
    <div class="report-info"><h3>PO: ${r.poOrderNo||'--'} ${r.colorFilmModel||''}</h3><p>${r.date} · ${r.inspector||''} · ${r.productType||''}</p></div>
    <span class="badge ${sClass[r.status]}">${sLabel[r.status]}</span>
  </div>`).join('')}</div>`;
```

**虚拟列表改进（使用分页）：**

```javascript
// ✅ 改进：虚拟列表 + 分页
const ITEMS_PER_PAGE = 20;
let currentPage = 1;

async function renderReportList() {
  await syncReports();
  let reports = APP.reports.filter(r => r.status !== 'trashed');
  if (APP.user.role === 'inspector')
    reports = reports.filter(r => r.createdBy === APP.user.username);
  reports.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  currentPage = 1;

  const filterHtml = `<div class="tabs"><button class="active" onclick="filterList('all',this)">全部</button>...`;

  if (!reports.length) {
    document.getElementById('mainContent').innerHTML = filterHtml + `<div class="empty-state">...`;
    return;
  }

  const totalPages = Math.ceil(reports.length / ITEMS_PER_PAGE);
  const paged = reports.slice(0, ITEMS_PER_PAGE);

  document.getElementById('mainContent').innerHTML = filterHtml + `
    <div id="rptList">${renderReportItems(paged)}</div>
    ${totalPages > 1 ? `
      <div style="display:flex;justify-content:center;gap:8px;padding:16px;flex-wrap:wrap">
        <button class="btn btn-sm btn-outline" onclick="loadMore(${totalPages})" id="loadMoreBtn">
          加载更多 (${paged.length}/${reports.length})
        </button>
      </div>
    ` : ''}`;
}

function renderReportItems(reports) {
  const sLabel = {draft:'草稿',submitted:'待审核',approved:'已通过',rejected:'已驳回'};
  const sClass = {draft:'badge-draft',submitted:'badge-submitted',approved:'badge-approved',rejected:'badge-rejected'};

  return reports.map(r => `
    <div class="report-item" onclick="editReport('${r.id}')" data-status="${r.status}">
      <div style="width:40px;height:40px;background:${r.finalResult==='pass'?'#d4edda':'#f8d7da'};border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem">
        ${r.finalResult==='pass'?'✅':'❌'}
      </div>
      <div class="report-info">
        <h3>PO: ${escapeHtml(r.poOrderNo||'--')} ${escapeHtml(r.colorFilmModel||'')}</h3>
        <p>${r.date} · ${escapeHtml(r.inspector||'')} · ${escapeHtml(r.productType||'')}</p>
      </div>
      <span class="badge ${sClass[r.status]}">${sLabel[r.status]}</span>
    </div>`
  ).join('');
}

function loadMore(totalPages) {
  currentPage++;
  if (currentPage > totalPages) return;

  const reports = APP.reports.filter(r => r.status !== 'trashed');
  if (APP.user.role === 'inspector')
    reports = reports.filter(r => r.createdBy === APP.user.username);

  const start = (currentPage - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const nextBatch = reports.slice(start, end);

  document.getElementById('rptList').innerHTML += renderReportItems(nextBatch);

  if (currentPage >= totalPages) {
    document.getElementById('loadMoreBtn').style.display = 'none';
  }
}
```

**优先级：🟡 中** - 影响列表加载速度（当报告数 > 100 时明显）

---

#### 11. ❌ FAIL：输入操作有 debounce

**现状分析：**

- 尺寸输入、包装输入等没有 debounce
- 每次 onchange 都直接触发 `saveReport()` 的操作（虽然代码中没有显式调用，但数据会被保存）

**缺失的实现：**

第 455-475 行尺寸输入：
```javascript
// 目前的状态（第 454-475 行）
<div class="dim-section">
  <div class="dim-label">长度 Length အလျား <span class="std">${r.dimensions.lengthStd}</span></div>
  <div class="measure-grid cols-6">${r.dimensions.length.map((v,i)=>`
    <input class="measure-input" type="number" step="0.01" inputmode="decimal" placeholder="${i+1}"
           value="${v}" onchange="UD('length',${i},this.value)" ${ro}>
  `).join('')}</div>
</div>
```

**问题：**
- 快速输入会频繁调用 `UD()` 并触发重新渲染
- 每次输入都可能触发 IndexedDB 写入

**改进方案：**

```javascript
// 添加 debounce 工具函数（在 script 顶部）
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// 为输入字段添加 debounced 保存
const debouncedSave = debounce(() => {
  if (APP.currentReport) {
    localSave(APP.currentReport);
  }
}, 500);

// 改进的更新函数
function UD(k, i, v) {
  APP.currentReport.dimensions[k][i] = v;
  debouncedSave();  // ✅ 500ms 后才保存
}

// 或者改进 HTML（如果想在 onchange 中使用）：
<input ... onchange="debUniqueId('UD','length',${i},this.value)" />

// 配对的防抖处理函数
const debounceTimers = {};
function debUpdate(fn, ...args) {
  const key = fn + JSON.stringify(args);
  clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(() => {
    eval(fn)(...args);
    debouncedSave();
  }, 300);
}
```

**包装输入也需要同样处理（第 630-633 行）：**

```javascript
// 目前（第 630-633 行）
<div class="pkg-row"><span>(</span><input type="number" value="${r.packaging.pcsPerBox}"
  onchange="UP('pcsPerBox',this.value)" ${ro}><span>)片/箱 ...
```

**改为：**
```javascript
<input type="number" value="${r.packaging.pcsPerBox}"
  onchange="debounce(() => UP('pcsPerBox',this.value), 300)()" ${ro} />
```

**优先级：🟡 中** - 影响低端手机性能

---

#### 12. ❌ FAIL：只渲染当前可见的 tab

**现状分析：**

- 第 514-635 行每次 `renderReportForm()` 都会生成所有 4 个 tab 的 HTML，即使只显示一个
- 包含大量隐藏的 DOM（尺寸表格、检验项、照片网格）

```javascript
// 第 514-635 行（简化视图）
function renderReportForm(){
  // ...
  let html=`
  <div class="tabs">
    <button class="active" onclick="showStep(0,this)">基本信息</button>
    <button onclick="showStep(1,this)">尺寸检测</button>
    <button onclick="showStep(2,this)">检验项目</button>
    <button onclick="showStep(3,this)">照片</button>
  </div>

  <div class="form-step" id="step0">...</div>  ✅ 显示
  <div class="form-step" id="step1" style="display:none">...</div>  ❌ 隐藏但存在
  <div class="form-step" id="step2" style="display:none">...</div>  ❌ 隐藏但存在
  <div class="form-step" id="step3" style="display:none">...</div>  ❌ 隐藏但存在
  `;
  document.getElementById('mainContent').innerHTML=html;
}
```

**性能影响：**
- 29 张照片生成 29 个 img 标签（即使不显示）
- 15 个检验项生成 45 个 button（3 个选项 × 15 项）
- 总共生成 ~200+ 个 DOM 节点，每个都占用内存

**改进方案（惰性渲染）：**

```javascript
function renderReportForm() {
  const r = APP.currentReport;
  const isRO = APP.user.role === 'supervisor' || r.status === 'approved';
  const ro = isRO ? 'readonly' : '';
  const dis = isRO ? 'disabled' : '';

  document.getElementById('headerTitle').textContent =
    r.status === 'draft' ? '编辑报告 Edit' : '查看报告 View';

  // ✅ 关键改进：只初始化标签，内容延迟加载
  const tabsHtml = `
  <div class="tabs">
    <button class="active" onclick="showStep(0,this)" data-tab="0">基本信息</button>
    <button onclick="showStep(1,this)" data-tab="1">尺寸检测</button>
    <button onclick="showStep(2,this)" data-tab="2">检验项目</button>
    <button onclick="showStep(3,this)" data-tab="3">照片</button>
  </div>
  <div id="tabContent"></div>
  `;

  // 渲染按钮和底部按钮
  const actionBtns = `
  <div style="padding:10px 0 20px;display:flex;gap:8px;flex-wrap:wrap">
    ${!isRO ? `<button class="btn btn-outline btn-sm" onclick="saveDraft()" style="flex:1">💾 保存</button>
               <button class="btn btn-primary btn-sm" onclick="submitReport()" style="flex:1">📤 提交</button>` : ''}
    ${APP.user.role === 'supervisor' && r.status === 'submitted' ? `
               <button class="btn btn-success btn-sm" onclick="approveReport()" style="flex:1">✅ 通过</button>
               <button class="btn btn-danger btn-sm" onclick="rejectReport()" style="flex:1">❌ 驳回</button>` : ''}
    <button class="btn btn-outline btn-sm" onclick="generatePDF()" style="flex:1">📄 PDF</button>
    <button class="btn btn-outline btn-sm" onclick="switchTab('list')" style="flex:1">← 返回</button>
    <button class="btn btn-danger btn-sm" onclick="trashReport()" style="flex:1">🗑 删除</button>
  </div>`;

  document.getElementById('mainContent').innerHTML = tabsHtml + actionBtns;

  // ✅ 默认显示第 0 个 tab
  renderTabContent(0);
}

// ✅ 按需生成 tab 内容
function renderTabContent(tabIndex) {
  const r = APP.currentReport;
  const isRO = APP.user.role === 'supervisor' || r.status === 'approved';
  const ro = isRO ? 'readonly' : '';
  const dis = isRO ? 'disabled' : '';

  let content = '';

  if (tabIndex === 0) {
    content = renderBasicInfoTab(r, ro, dis);
  } else if (tabIndex === 1) {
    content = renderDimensionsTab(r, ro, dis);
  } else if (tabIndex === 2) {
    content = renderInspectionTab(r, ro, dis);
  } else if (tabIndex === 3) {
    content = renderPhotosTab(r, isRO);
  }

  document.getElementById('tabContent').innerHTML = content;
}

// 拆分各个 tab 的渲染函数
function renderBasicInfoTab(r, ro, dis) {
  return `<div class="card">...</div>...`;  // 第一个 tab 的内容
}

function renderDimensionsTab(r, ro, dis) {
  return `<div class="card"><div class="card-header">📏 尺寸检测...</div>...`;  // 第二个 tab 的内容
}

function renderInspectionTab(r, ro, dis) {
  return `<div class="card"><div class="card-header">✅ 检验项目...</div>...`;  // 第三个 tab 的内容
}

function renderPhotosTab(r, isRO) {
  return `<div class="card"><div class="card-header">📸 检验照片...</div>...`;  // 第四个 tab 的内容
}

// ✅ 改进的 showStep 函数
function showStep(n, btn) {
  renderTabContent(n);  // 延迟渲染
  btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
```

**优先级：🟡 中** - 改善初始加载时间 30-50%

---

### 用户体验 (UX)

#### 13. ✅ PASS：所有异步操作有 loading 状态

**证据：**
- PDF 生成时显示 toast："正在生成PDF... Generating..." (第 966 行)
- 登录检查时显示 "检测服务器中..." (第 165 行)

**但可以改进的地方：**
- `syncReports()` 没有 loading 提示
- `submitReport()` 没有 loading 状态

**改进建议：**
```javascript
async function submitReport(){
  const r=APP.currentReport;
  if(!r.poOrderNo){showToast('请填写PO订单号','error');return;}

  showToast('正在提交...', 'info');  // ✅ 添加

  r.status='submitted';
  r.inspector=APP.user.name;
  await saveReport(r);
  APP.reports=await localGetAll();
  showToast('已提交审核 Submitted','success');
  switchTab('list');
}
```

**评分：✅ (可优化)**

---

#### 14. ✅ PASS：所有错误有 toast 提示

**证据：**多处使用 `showToast()`：
- 第 388 行：密码错误
- 第 394 行：用户不存在
- 第 657 行：拍照成功
- 第 696 行：已保存

**评分：✅**

---

#### 15. ❌ FAIL：表单必填字段有验证

**现状分析：**

- `submitReport()` 仅检查 `poOrderNo` (第 693 行)
- 其他必填字段（彩膜型号、客户名称、尺寸数据）未验证

```javascript
// 第 693-694 行（不充分）
async function submitReport(){
  const r=APP.currentReport;
  if(!r.poOrderNo){showToast('请填写PO订单号','error');return;}
  // ✗ 漏掉了其他必填字段
  r.status='submitted';
  // ...
}
```

**完整的验证函数（应该添加）：**

```javascript
// ✅ 完整的表单验证
function validateBeforeSubmit(report) {
  const errors = [];

  // 必填字段检查
  if (!report.poOrderNo?.trim()) errors.push('PO 订单号');
  if (!report.colorFilmModel?.trim()) errors.push('彩膜型号');
  if (!report.size?.trim()) errors.push('尺寸规格');
  if (!report.wearLayerThickness) errors.push('耐磨层厚度');
  if (!report.lockType) errors.push('扣型');
  if (!report.model?.trim()) errors.push('型号');

  // 尺寸数据检查（至少有 3 个有效测量值）
  ['length', 'width', 'thickness'].forEach(key => {
    const valid = (report.dimensions?.[key] || [])
      .filter(v => v !== '' && !isNaN(v));
    if (valid.length < 3) {
      errors.push(`${key} 至少需要 3 个测量值`);
    }
  });

  // 检验项检查（至少检查一项）
  const inspectionCount = Object.keys(report.inspectItems || {}).length;
  if (inspectionCount === 0) {
    errors.push('至少需要填写一个检验项');
  }

  // 照片检查（至少一张）
  const photoCount = Object.keys(report.photos || {}).length;
  if (photoCount < 3) {
    errors.push(`至少需要 3 张照片（已有 ${photoCount} 张）`);
  }

  if (errors.length) {
    showToast('请填写：' + errors.join('、'), 'error');
    return false;
  }
  return true;
}

// 在 submitReport() 中调用
async function submitReport(){
  const r = APP.currentReport;

  // ✅ 添加验证
  if (!validateBeforeSubmit(r)) return;

  r.status = 'submitted';
  r.inspector = APP.user.name;
  await saveReport(r);
  APP.reports = await localGetAll();
  showToast('已提交审核', 'success');
  switchTab('list');
}
```

**优先级：🔴 高** - 数据质量控制

---

#### 16. ❌ FAIL：提交前有确认对话框

**现状分析：**

- 删除时有确认 (第 703 行)：`if(!confirm('确定删除此报告？'))`
- 永久删除时有确认 (第 711 行)：`if(!confirm('永久删除此报告？'))`
- **但提交、审批、驳回没有确认**

```javascript
// 缺失的确认对话框（第 692-697 行）
async function submitReport(){
  // ✗ 没有确认
  const r=APP.currentReport;
  r.status='submitted';
  // ...
}

async function approveReport(){
  // ✗ 没有确认
  const r=APP.currentReport;
  r.status='approved';
  // ...
}
```

**改进方案：**

```javascript
// ✅ 改进版本，带确认对话框
async function submitReport(){
  const r = APP.currentReport;

  // 验证
  if (!validateBeforeSubmit(r)) return;

  // 确认提交
  if (!confirm('确定提交此报告进行审核吗？')) {
    return;
  }

  r.status = 'submitted';
  r.inspector = APP.user.name;
  await saveReport(r);
  APP.reports = await localGetAll();
  showToast('已提交审核', 'success');
  switchTab('list');
}

async function approveReport(){
  const r = APP.currentReport;

  if (!confirm('确定通过此报告吗？此操作不可撤销。')) {
    return;
  }

  r.status = 'approved';
  r.reviewer = APP.user.name;
  await saveReport(r);
  APP.reports = await localGetAll();
  showToast('已通过', 'success');
  switchTab('list');
}

async function rejectReport(){
  const r = APP.currentReport;

  if (!confirm('确定驳回此报告吗？')) {
    return;
  }

  r.status = 'rejected';
  r.reviewer = APP.user.name;
  await saveReport(r);
  APP.reports = await localGetAll();
  showToast('已驳回', 'error');
  switchTab('list');
}
```

**优先级：🟠 高** - 防止误操作

---

## 第二部分：TOP 5 最高优先级修复

根据对安全性、数据完整性和可用性的影响，排序如下：

### 🔴 修复 #1：启用 XSS 防护 + escapeHtml()

**影响范围：**极高 - 所有用户数据
**风险等级：**关键
**修复难度：**简单 (2-3 小时)

**具体步骤：**
1. 在 script 顶部添加 `escapeHtml()` 函数 (第 215 行前)
2. 在所有 innerHTML 拼接的地方用 escapeHtml() 包裹用户字段
3. 在报告列表、回收站、个人中心等地方应用

**代码位置需要修改：**
- 第 762, 771：trashed list
- 第 790, 795：report list
- 第 809, 813, 816：profile page
- 第 965-1010：PDF 生成中的所有拼接

---

### 🔴 修复 #2：移除硬编码密码 + 实现 Supabase Auth

**影响范围：**极高 - 认证安全
**风险等级：**关键
**修复难度：**中等 (4-6 小时)

**具体步骤：**
1. 删除 USERS 常量 (第 216-218 行)
2. 迁移到 Supabase Auth（或 token 方案）
3. 修改 doLogin() 逻辑 (第 384-410 行)

---

### 🔴 修复 #3：启用 Supabase RLS 策略

**影响范围：**极高 - 数据访问控制
**风险等级：**关键
**修复难度：**简单 (1 小时，在 Supabase 后台)

**具体步骤：**
1. 登录 Supabase dashboard
2. 在 SQL Editor 中执行 RLS 启用脚本 (参考前面的代码)
3. 为 users 和 reports 表创建策略

---

### 🟠 修复 #4：添加网络恢复同步 + 监听器

**影响范围：**高 - 离线数据同步
**风险等级：**高
**修复难度：**简单 (2-3 小时)

**具体步骤：**
1. 添加 `window.addEventListener('online', ...)` (第 366 行后)
2. 实现 `syncPendingReports()` 函数
3. 在 login 后注册监听器

---

### 🟠 修复 #5：添加敏感操作权限验证 + 确认对话框

**影响范围：**高 - 数据完整性
**风险等级：**高
**修复难度：**中等 (3-4 小时)

**具体步骤：**
1. 在 approveReport(), rejectReport() 添加确认对话框
2. 在 permanentDelete() 添加后端权限检查
3. 修改 submitReport() 添加完整表单验证

---

## 第三部分：总体评分汇总

| 类别 | 合格项 | 不合格项 | 得分 |
|-----|-------|--------|------|
| 安全 (4 项) | 0 | 4 | 0% 🔴 |
| 离线 (4 项) | 2 | 2 | 50% 🟡 |
| 性能 (4 项) | 0 | 4 | 0% 🔴 |
| 用户体验 (4 项) | 2 | 2 | 50% 🟡 |
| **总体** | **4/16** | **12/16** | **25% 🔴** |

---

## 第四部分：建议的修复顺序与时间表

**第 1 阶段（立即 - 关键修复）：**
- 修复 #1：XSS 防护 → 2 小时
- 修复 #3：RLS 启用 → 1 小时
- 小计：**3 小时** ⏱️

**第 2 阶段（本周 - 高优先级）：**
- 修复 #2：移除硬编码密码 → 5 小时
- 修复 #4：网络恢复同步 → 3 小时
- 小计：**8 小时** ⏱️

**第 3 阶段（本月 - 性能优化）：**
- 修复 #5：权限验证 → 4 小时
- 图片压缩改进 → 2 小时
- 虚拟列表 → 3 小时
- Debounce 输入 → 2 小时
- 小计：**11 小时** ⏱️

**总工作量：** 22 小时 (约 3 个工程日)

---

## 第五部分：测试检查清单

修复后应该进行以下测试：

- [ ] 在 PO 订单号输入框输入 `<script>alert('xss')</script>`，确认不执行脚本
- [ ] 修改 localStorage 中的 role，确认仍无法执行主管操作
- [ ] 网络断开，修改报告，恢复网络后确认自动同步
- [ ] 使用 29 张照片，确认 IndexedDB 不超过 50MB
- [ ] 登录 > 新建报告 > 快速输入尺寸数据，确认 IndexedDB 写入不超过 1 次/秒
- [ ] 切换 tab，确认只有当前 tab 的 DOM 被渲染
- [ ] 生成 PDF，检查所有用户数据是否正确转义

---

**报告生成日期：2026-03-25**
**审计工具：Claude Code Agent**
**审计标准版本：SKILL.md v1.0 - 第十一章《优化检查清单》**
