-- ======================================
-- 森雅验货系统 Supabase 数据库初始化
-- 在 Supabase Dashboard → SQL Editor 中执行
-- ======================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('inspector', 'supervisor')),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 报告表 (用JSONB存储完整报告数据，灵活不需要改表结构)
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  status TEXT DEFAULT 'draft',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 开启 Row Level Security 并允许 anon 访问
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on users" ON users;
DROP POLICY IF EXISTS "Allow all on reports" ON reports;

CREATE POLICY "Allow all on users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on reports" ON reports FOR ALL USING (true) WITH CHECK (true);

-- 插入默认用户
INSERT INTO users (username, password, role, name) VALUES
  ('admin', '123456', 'supervisor', '管理员'),
  ('inspector1', '123456', 'inspector', '质检员1'),
  ('inspector2', '123456', 'inspector', '质检员2'),
  ('supervisor1', '123456', 'supervisor', '主管1')
ON CONFLICT (username) DO NOTHING;
