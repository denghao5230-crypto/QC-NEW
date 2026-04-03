-- ============================================
-- 森雅验货系统 Supabase 建表 SQL
-- 在 Supabase Dashboard → SQL Editor 中执行
-- ============================================

-- 1. 用户表（注意：使用 password_hash 存储 bcrypt 哈希）
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('inspector', 'supervisor')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 报告表
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}',
  status TEXT DEFAULT 'draft',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 照片独立存储表（解决照片丢失问题的关键表）
CREATE TABLE IF NOT EXISTS report_photos (
  id SERIAL PRIMARY KEY,
  report_id TEXT REFERENCES reports(id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  data_url TEXT NOT NULL,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(report_id, slot_index)
);

-- 4. 索引
CREATE INDEX IF NOT EXISTS idx_reports_created_by ON reports(created_by);
CREATE INDEX IF NOT EXISTS idx_reports_updated_at ON reports(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_photos_report_id ON report_photos(report_id);

-- 5. RLS 策略：开启 RLS 但允许 anon key 完全访问（应用层管权限）
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on users" ON users;
DROP POLICY IF EXISTS "Allow all on reports" ON reports;
DROP POLICY IF EXISTS "Allow all on report_photos" ON report_photos;

CREATE POLICY "Allow all on users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on reports" ON reports FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on report_photos" ON report_photos FOR ALL USING (true) WITH CHECK (true);

-- 6. 插入默认用户（bcrypt 哈希密码）
-- inspector1 密码: Senia#123q
-- supervisor1 密码: Senia#123.
DELETE FROM users WHERE username IN ('inspector1', 'supervisor1');

INSERT INTO users (username, name, role, password_hash) VALUES
  ('inspector1', 'Htet Aung', 'inspector', '$2a$10$Xpl329v0nPMYrkL3oqsXZ..jK55Gcu7DwvUYXEaFMbvfoHczRLii2'),
  ('supervisor1', 'Mr. Jianhuai Luo', 'supervisor', '$2a$10$5j7Jfq62zYGbSfSuaBnSuOXPNgquU/8LhdS8fqCDNb/SJbSkTeNG2')
ON CONFLICT (username) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  name = EXCLUDED.name;

-- ============================================
-- 完成！接下来在 Netlify 环境变量中设置：
--   SUPABASE_URL  = https://xvcvezqbzjhvqugeekdg.supabase.co
--   SUPABASE_KEY  = eyJhbGci... (你的 anon key)
--   JWT_SECRET    = (你的自定义密钥)
--   ADMIN_KEY     = (用户注册管理密钥)
-- ============================================
