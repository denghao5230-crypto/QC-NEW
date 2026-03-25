# Firebase 配置指南（森雅验货系统）

## 第一步：创建 Firebase 项目

1. 打开 https://console.firebase.google.com
2. 用 Google 账号登录
3. 点击 **"添加项目"（Add project）**
4. 项目名称输入：`senia-inspection`
5. 关闭 Google Analytics（不需要），点击 **创建项目**

## 第二步：开启 Authentication（用户登录）

1. 左侧菜单点击 **Authentication** → **Get Started**
2. 在 "Sign-in method" 标签页，开启 **Email/Password**
3. 点击 **Users** 标签页 → **Add user**，添加你的用户：

| Email | Password | 说明 |
|-------|----------|------|
| inspector1@senia-qc.com | (你设置的密码) | 质检员 Htet Aung |
| supervisor1@senia-qc.com | (你设置的密码) | 主管 Mr. Jianhuai Luo |

> 注意：登录时用户名输入 `inspector1`，系统会自动加上 `@senia-qc.com`

## 第三步：开启 Firestore（数据库）

1. 左侧菜单点击 **Firestore Database** → **Create database**
2. 选择地区：**asia-southeast1 (Singapore)** ← 离缅甸最近，速度最快
3. 安全规则选 **Start in test mode**（后面再改）
4. 点击 **Create**

### 添加用户角色数据

在 Firestore 中手动创建 `users` 集合：

1. 点击 **Start collection** → Collection ID: `users`
2. 添加文档（Document ID 用 Firebase Auth 里对应用户的 UID）：

**文档 1（质检员）：**
```
username: "inspector1"
name: "Htet Aung"
role: "inspector"
```

**文档 2（主管）：**
```
username: "supervisor1"
name: "Mr. Jianhuai Luo"
role: "supervisor"
```

> UID 在哪找？去 Authentication → Users，每个用户右边有个 UID

### 设置安全规则

在 Firestore → Rules 标签页，替换为：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 用户必须登录
    match /reports/{reportId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if false; // 只有管理员可以改用户信息
    }
  }
}
```

点击 **Publish**。

## 第四步：获取 Firebase 配置

1. 点击项目设置（左上角齿轮图标 ⚙ → **Project settings**）
2. 滚动到 **Your apps** → 点击 Web 图标 `</>`
3. 应用昵称输入 `inspection-pwa`，点击 **Register app**
4. 你会看到类似这样的配置：

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyB...",
  authDomain: "senia-inspection.firebaseapp.com",
  projectId: "senia-inspection",
  storageBucket: "senia-inspection.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

5. 把这段配置**复制**下来

## 第五步：更新代码

打开 `index.html`，找到这段代码（大约在第 212 行）：

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  ...
```

把 `YOUR_xxx` 替换成你在第四步复制的真实值。

## 第六步：部署

把更新后的代码推送到 GitHub，Netlify 会自动部署：

```bash
git add -A
git commit -m "Migrate to Firebase"
git push origin main
```

## 完成！

访问 https://qcsenia.netlify.app 测试：
- 用 `inspector1` + 你设置的密码登录
- 新建报告、拍照、提交
- 用 `supervisor1` 登录审批
- 关掉网络测试离线模式

## 常见问题

**Q: 登录报错 "auth/user-not-found"**
A: 确认在 Firebase Authentication 里添加了用户（Email 格式：username@senia-qc.com）

**Q: 数据不同步**
A: 确认 Firestore 安全规则已发布，且选择了 asia-southeast1 地区

**Q: 离线模式不工作**
A: 确认 Service Worker 已更新（清除浏览器缓存后重新访问）
