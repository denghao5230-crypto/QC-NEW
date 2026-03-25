-- =============================================
-- 森雅验货系统 安全加固 SQL 迁移脚本
-- 请在 Supabase Dashboard -> SQL Editor 中执行
-- =============================================

-- ===== 第1步：给 users 表添加 password_hash 列 =====
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- ===== 第2步：将现有明文密码迁移为 SHA-256 哈希 =====
-- 哈希算法：SHA-256( 'senia-inspection-2024' + ':' + 明文密码 )
-- 注意：需要启用 pgcrypto 扩展
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE public.users
SET password_hash = encode(
  digest('senia-inspection-2024:' || password, 'sha256'), 'hex'
)
WHERE password IS NOT NULL AND password_hash IS NULL;

-- ===== 第3步：创建安全登录 RPC 函数 =====
-- 这个函数在服务端验证密码，客户端永远不会收到密码数据
CREATE OR REPLACE FUNCTION verify_login(p_username TEXT, p_password_hash TEXT)
RETURNS TABLE(username TEXT, role TEXT, name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER  -- 以函数创建者权限执行，绕过 RLS
AS $$
BEGIN
  RETURN QUERY
  SELECT u.username, u.role, u.name
  FROM public.users u
  WHERE u.username = p_username
    AND u.password_hash = p_password_hash;
END;
$$;

-- 授予 anon 角色调用此函数的权限
GRANT EXECUTE ON FUNCTION verify_login(TEXT, TEXT) TO anon;

-- ===== 第4步：启用行级安全策略 (RLS) =====

-- 4a. users 表 RLS：禁止 anon 直接读取
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 删除可能存在的旧策略
DROP POLICY IF EXISTS "users_no_direct_read" ON public.users;
DROP POLICY IF EXISTS "users_service_only" ON public.users;

-- 禁止 anon 角色直接查询 users 表（登录通过 RPC 函数进行）
-- 只有 service_role 可以管理用户
CREATE POLICY "users_service_only" ON public.users
  FOR ALL
  USING (auth.role() = 'service_role');

-- 4b. reports 表 RLS（可选但推荐）
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_read_all" ON public.reports;
DROP POLICY IF EXISTS "reports_insert_anon" ON public.reports;
DROP POLICY IF EXISTS "reports_update_anon" ON public.reports;
DROP POLICY IF EXISTS "reports_delete_anon" ON public.reports;

-- 允许 anon 读取所有报告（质检系统需要）
CREATE POLICY "reports_read_all" ON public.reports
  FOR SELECT
  USING (true);

-- 允许 anon 插入和更新报告（通过前端提交）
CREATE POLICY "reports_insert_anon" ON public.reports
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "reports_update_anon" ON public.reports
  FOR UPDATE
  USING (true);

-- 允许 anon 删除报告（回收站永久删除功能）
CREATE POLICY "reports_delete_anon" ON public.reports
  FOR DELETE
  USING (true);

-- ===== 第5步（可选）：迁移完成后删除明文密码列 =====
-- ⚠️ 确认所有用户都能正常登录后再执行！
-- ALTER TABLE public.users DROP COLUMN password;

-- ===== 验证 =====
-- 执行以下查询确认迁移成功：
-- SELECT username, role, name,
--        CASE WHEN password_hash IS NOT NULL THEN '✅ 已哈希' ELSE '❌ 未哈希' END as hash_status
-- FROM public.users;
