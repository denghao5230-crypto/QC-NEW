-- =============================================
-- 森雅验货系统 Neon 数据库建表脚本
-- 在 Neon Dashboard -> SQL Editor 中执行
-- =============================================

-- 启用 pgcrypto 扩展（用于 gen_random_uuid）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== 用户表 =====
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('inspector', 'supervisor')),
  password_hash TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 报告表 =====
CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'trashed')),
  created_by  TEXT REFERENCES users(username),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_by ON reports(created_by);
CREATE INDEX IF NOT EXISTS idx_reports_updated_at ON reports(updated_at DESC);

-- ===== 插入初始用户（示例） =====
-- 密码使用 bcrypt 哈希，这里的哈希值对应密码 '123456'
-- 你可以通过 API 的 /api/register 端点添加更多用户
-- 或在此处用 crypt('你的密码', gen_salt('bf', 10)) 生成

-- INSERT INTO users (username, name, role, password_hash) VALUES
-- ('admin', '管理员', 'supervisor', crypt('123456', gen_salt('bf', 10))),
-- ('qc01', '质检员01', 'inspector', crypt('123456', gen_salt('bf', 10)));

-- ===== 验证 =====
-- SELECT * FROM users;
-- SELECT * FROM reports ORDER BY updated_at DESC LIMIT 5;
