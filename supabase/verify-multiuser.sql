-- ============================================================================
--  多用户隔离验收：把这份脚本跑一遍，确认 RLS 真的挡住了跨用户读写
--  用法：Supabase SQL Editor 整段粘贴 → Run
-- ============================================================================

-- ① 4 张表都必须是 rls_enabled = true（有一行 false 就是漏洞）
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r'
order by c.relname;

-- ② 每条策略都必须带 auth.uid()，任何一条写着 true 就是全表裸奔
select tablename, policyname, cmd,
       coalesce(qual, with_check) as condition
from pg_policies
where schemaname = 'public'
order by tablename, cmd;

-- ③ 找出「没有 RLS 过滤」的策略（应该 0 行）
select tablename, policyname, cmd, coalesce(qual, with_check) as condition
from pg_policies
where schemaname = 'public'
  and coalesce(qual, with_check) not like '%auth.uid()%';

-- ④ anon 角色不应该有任何业务表权限（应该 0 行）
select table_name, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and grantee = 'anon'
order by table_name, privilege_type;

-- ⑤ entry_stats 视图必须是 security_invoker（否则会绕过 RLS 汇总所有人的数据）
select c.relname,
       pg_get_userbyid(c.relowner) as owner,
       coalesce(array_to_string(c.reloptions, ', '), '(no options)') as options
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'v';

-- ⑥ 真实跨用户测试（在应用里做，最直观）：
--    A 账号登录 → 记 3 条 → 退出 → B 账号注册登录
--    预期：收件箱 0 条、待办 0 条、洞察 0 条统计全 0
--    再手动访问 /entry/<A 的某条 id> → 预期 404，而不是看到 A 的内容
