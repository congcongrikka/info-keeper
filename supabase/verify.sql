-- ============================================================================
--  验收脚本：跑完 schema.sql 后执行，确认库真的建好了
--  用法：SQL Editor → 整段粘贴 → Run，会返回一张表，每行一个检查项
--
--  为什么要合成一条查询：Supabase 的 SQL Editor 一次运行多条语句时
--  只显示【最后一条】的结果集，前面的会静默丢掉。合成一条才不会漏检。
-- ============================================================================

with fn as (
  select 1
  from information_schema.routines
  where routine_schema = 'public'
    and routine_name = 'pending_task_counts'
),
tbl as (
  select c.relrowsecurity as rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'push_subscriptions'
    and c.relkind = 'r'
)
select '1. 推送表 push_subscriptions 存在（期望 OK）' as check_item,
       case when exists (select 1 from tbl) then 'OK'
            else '缺失 <- 重新跑一遍 schema.sql' end as result
union all
select '2. 推送表字段数（期望 8）',
       coalesce((select count(*)::text from information_schema.columns
                 where table_schema = 'public' and table_name = 'push_subscriptions'), '0')
union all
select '3. 推送表已开 RLS（期望 true）',
       coalesce((select rls::text from tbl), '表不存在')
union all
select '4. 推送表 RLS 策略数（期望 4）',
       (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'push_subscriptions')
union all
select '5. 聚合函数 pending_task_counts 存在（期望 OK）',
       case when exists (select 1 from fn) then 'OK'
            else '缺失 <- 重新跑一遍 schema.sql' end
union all
select '6. 登录用户越权可执行该函数（期望 0）',
       (select count(*)::text from information_schema.routine_privileges
        where routine_schema = 'public' and routine_name = 'pending_task_counts'
          and grantee in ('anon', 'authenticated'))
union all
select '7. service_role 可执行该函数（期望 1）',
       (select count(*)::text from information_schema.routine_privileges
        where routine_schema = 'public' and routine_name = 'pending_task_counts'
          and grantee = 'service_role')
union all
select '8. public 下的表清单（期望 5 张）',
       (select string_agg(table_name, ', ' order by table_name)
        from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE');

-- ---------------------------------------------------------------------------
-- 关于查询结果里的 "postgres | EXECUTE"
--
-- 那是函数的属主（owner）。PostgreSQL 里属主永远持有权限，REVOKE 也收不走，
-- 所以这一行必然存在、无法消除，也不构成风险 —— 它只能从数据库内部连，
-- PostgREST 对外只认 anon / authenticated / service_role 三个角色。
--
-- 真正要看的是第 6 项：必须为 0，即 anon 和 authenticated 都**不能**执行它。
-- ---------------------------------------------------------------------------
