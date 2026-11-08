-- ============================================================================
-- 补丁：给 service_role 授后台任务需要的表权限
-- ============================================================================
-- 症状：Vercel 定时任务报 500 db_error，运行时日志里是
--   permission denied for table xxx (code 42501)
--   具体是哪张表，看日志里 hint 那一行（它会直接写出该跑的 GRANT 语句）：
--     - permission denied for table push_subscriptions → 推送通道读订阅
--     - permission denied for table entries            → 邮件通道读待办标题
--     - permission denied for table profiles           → 邮件通道读开关
--
-- 原因：schema.sql 的「显式授权」段只给 authenticated 授了业务表，
--   漏了 service_role。定时任务没有登录用户，只能用 service_role 跨用户读数据，
--   而 service_role 虽然能绕过 RLS，仍然需要表级 GRANT。
--
-- 用法：在 Supabase → SQL Editor 里粘贴整个文件，点 Run。
--   已经跑过完整 schema.sql 的项目，跑这几条就够；重复跑也无副作用。
--   （schema.sql 里已经把这几条补进去了，以后重建库不会再缺。）
-- ============================================================================

-- 推送通道：读订阅、清理 404/410 的失效订阅
grant select, insert, update, delete on table public.push_subscriptions to service_role;

-- 邮件通道：读每个人的待办标题填进正文、读谁的邮件开关是开的
-- 都只需要读，不要给写权限 —— 后台任务不该能改用户的记录。
grant select on table public.entries  to service_role;
grant select on table public.profiles to service_role;

-- ---------------------------------------------------------------------------
-- 验证：下面这条应该返回一行，三个 pass 都是 true。
-- 确认没问题后可以把这条注释掉。
-- ---------------------------------------------------------------------------
select
  'service_role 表权限' as check_item,
  has_table_privilege('service_role', 'public.push_subscriptions', 'select') as push_ok,
  has_table_privilege('service_role', 'public.entries', 'select')            as entries_ok,
  has_table_privilege('service_role', 'public.profiles', 'select')           as profiles_ok;
