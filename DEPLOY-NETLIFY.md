# 森雅验货系统 - Netlify 部署指南

## 方法一：拖拽部署（最快）

1. 打开 https://app.netlify.com
2. 注册/登录账号
3. 点击 **"Add new site"** → **"Deploy manually"**
4. 把项目文件夹直接拖拽到页面上（包含 index.html、sw.js、manifest.json、netlify.toml）
5. 等待几秒，部署完成！Netlify 会给你一个类似 `https://xxx.netlify.app` 的地址

## 方法二：Git 仓库自动部署（推荐长期使用）

1. 把项目推送到 GitHub/GitLab 仓库
2. 在 Netlify 中点击 **"Add new site"** → **"Import an existing project"**
3. 选择你的仓库
4. 构建设置保持默认（无需填写 build command）
5. 点击 **Deploy**
6. 之后每次 git push，Netlify 自动重新部署

## 部署后设置

### 自定义域名（可选）
1. 在 Netlify 站点设置 → **Domain management**
2. 添加你的域名，按提示配置 DNS
3. Netlify 自动配置 HTTPS

### 确认 PWA 正常
- 用手机浏览器访问 Netlify 给的地址
- 应该能看到"添加到主屏幕"的提示
- 离线时也能访问（Service Worker 缓存）

## 注意事项

- **不需要** `server.js`：前端直接连 Supabase，不需要后端服务器
- 旧文件已移至 `_archive/` 文件夹备份
- Supabase 数据库不受影响，数据都在云端
- 如果之前的 Service Worker 缓存了旧地址，用户首次访问新地址时会自动重建缓存
