-- ============================================================================
--  个人信息管家 · Supabase 数据库初始化脚本
--  用法：Supabase Dashboard → SQL Editor → 新建查询 → 整段粘贴 → Run
--  本脚本可重复执行（幂等），但不要在同一项目里和其它 schema 混用同名表
-- ============================================================================

-- 1. 扩展 --------------------------------------------------------------------
-- pg_trgm 用于中文/英文模糊检索的 GIN 索引（ILIKE '%关键词%' 不至于全表扫描）
create extension if not exists pg_trgm;

-- 2. 资料表 profiles ---------------------------------------------------------
--    只存偏好设置，真正的身份数据在 auth.users（由 Supabase 托管）
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  timezone      text not null default 'Asia/Shanghai',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is '用户偏好，一人一行，与 auth.users 一一对应';

-- 邮件早报开关（2026-11-07 加）。
-- 安卓手机收不到 Web Push（投递要过 Google FCM，国行无 Google 服务），
-- 所以给一个不依赖浏览器的备用通道：每天早上一封邮件。
-- 已有库靠这条 alter 补列；新库由 create 建表后同样执行一次，幂等。
alter table public.profiles
  add column if not exists digest_enabled boolean not null default false;

-- 3. 条目表 entries ----------------------------------------------------------
--    一条记录 = 一个想法 / 笔记 / 待办 / 链接 / 参考资料
create table if not exists public.entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,

  -- 内容本体
  kind            text not null default 'note'
                  check (kind in ('idea', 'note', 'task', 'link', 'reference')),
  title           text,
  content         text not null check (char_length(content) between 1 and 20000),
  source_url      text,

  -- AI 理解结果（由服务端写入，前端只读）
  summary         text,
  key_points      jsonb not null default '[]'::jsonb,
  next_actions    jsonb not null default '[]'::jsonb,
  tags            text[] not null default '{}',
  ai_model        text,
  ai_analyzed_at  timestamptz,

  -- 状态机：inbox(未处理) → active(进行中) → done(完成) / archived(归档)
  status          text not null default 'inbox'
                  check (status in ('inbox', 'active', 'done', 'archived')),
  priority        smallint not null default 2 check (priority between 1 and 3),
  due_at          timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- 待办必须能出现在待办清单里；这里只做弱约束，避免误伤
  constraint entries_title_or_content check (char_length(btrim(coalesce(title, content))) > 0)
);

comment on table public.entries is '所有零散信息条目，user_id 决定归属，RLS 按 auth.uid() 隔离';

-- 常用查询路径：按人 + 时间倒序（收件箱）、按人 + 状态（待办）、按标签
create index if not exists entries_user_created_idx on public.entries (user_id, created_at desc);
create index if not exists entries_user_status_idx  on public.entries (user_id, status);
create index if not exists entries_user_kind_idx    on public.entries (user_id, kind);
create index if not exists entries_tags_idx         on public.entries using gin (tags);
create index if not exists entries_content_trgm_idx on public.entries using gin (content gin_trgm_ops);
create index if not exists entries_title_trgm_idx   on public.entries using gin (title gin_trgm_ops);

-- 4. 关联表 entry_links ------------------------------------------------------
--    AI 判断两条记录相关时写入；source → target 有方向，查询时双向合并
create table if not exists public.entry_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  source_id   uuid not null references public.entries (id) on delete cascade,
  target_id   uuid not null references public.entries (id) on delete cascade,
  relation    text not null default 'related'
              check (relation in ('related', 'duplicate', 'follow_up', 'contradicts')),
  score       real not null default 0.5 check (score >= 0 and score <= 1),
  reason      text,
  created_at  timestamptz not null default now(),
  constraint entry_links_unique_pair unique (source_id, target_id),
  constraint entry_links_no_self check (source_id <> target_id)
);

create index if not exists entry_links_source_idx on public.entry_links (user_id, source_id);
create index if not exists entry_links_target_idx on public.entry_links (user_id, target_id);

-- 5. 阶段总结 reviews --------------------------------------------------------
create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  entry_count   integer not null default 0,
  title         text,
  summary       text not null,
  themes        jsonb not null default '[]'::jsonb,  -- [{name, insight}]
  actions       jsonb not null default '[]'::jsonb,  -- [{action, why, priority}]
  open_loops    jsonb not null default '[]'::jsonb,  -- 悬而未决的事
  model         text,
  created_at    timestamptz not null default now(),
  constraint reviews_period_valid check (period_end >= period_start)
);

create index if not exists reviews_user_created_idx on public.reviews (user_id, created_at desc);

-- 5.5 推送订阅 push_subscriptions ---------------------------------------------
--      每天早报用的 Web Push 订阅。一条订阅 = 一个浏览器 / 一台设备，
--      同一个人可能在手机和电脑上各订一份，所以 user_id 不是唯一的。
--      endpoint 才是浏览器侧的订阅标识：同一台设备重新订阅会复用同一个 endpoint，
--      所以这里做唯一约束，配合服务端的 upsert 实现「重复订阅不堆积」。
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

-- 6. updated_at 自动维护 -----------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists entries_touch_updated_at on public.entries;
create trigger entries_touch_updated_at
  before update on public.entries
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists push_subscriptions_touch_updated_at on public.push_subscriptions;
create trigger push_subscriptions_touch_updated_at
  before update on public.push_subscriptions
  for each row execute function public.touch_updated_at();

-- 7. 新用户自动建档 ----------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 8. 行级安全 RLS ------------------------------------------------------------
--    每个用户只能碰自己的行；即使 anon key 泄漏，也读不到别人的数据
alter table public.profiles    enable row level security;
alter table public.entries     enable row level security;
alter table public.entry_links enable row level security;
alter table public.reviews     enable row level security;
alter table public.push_subscriptions enable row level security;

-- profiles
drop policy if exists "profiles read own"   on public.profiles;
drop policy if exists "profiles insert own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;

create policy "profiles read own"   on public.profiles for select using (auth.uid() = id);
create policy "profiles insert own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles update own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- entries
drop policy if exists "entries read own"   on public.entries;
drop policy if exists "entries insert own" on public.entries;
drop policy if exists "entries update own" on public.entries;
drop policy if exists "entries delete own" on public.entries;

create policy "entries read own"   on public.entries for select using (auth.uid() = user_id);
create policy "entries insert own" on public.entries for insert with check (auth.uid() = user_id);
create policy "entries update own" on public.entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "entries delete own" on public.entries for delete using (auth.uid() = user_id);

-- entry_links：要求两端条目都属于自己，防止越权建立关联
drop policy if exists "links read own"   on public.entry_links;
drop policy if exists "links insert own" on public.entry_links;
drop policy if exists "links update own" on public.entry_links;
drop policy if exists "links delete own" on public.entry_links;

create policy "links read own"   on public.entry_links for select using (auth.uid() = user_id);
create policy "links insert own" on public.entry_links for insert with check (
  auth.uid() = user_id
  and exists (select 1 from public.entries e where e.id = entry_links.source_id and e.user_id = auth.uid())
  and exists (select 1 from public.entries e where e.id = entry_links.target_id and e.user_id = auth.uid())
);
create policy "links update own" on public.entry_links for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "links delete own" on public.entry_links for delete using (auth.uid() = user_id);

-- reviews
drop policy if exists "reviews read own"   on public.reviews;
drop policy if exists "reviews insert own" on public.reviews;
drop policy if exists "reviews delete own" on public.reviews;

create policy "reviews read own"   on public.reviews for select using (auth.uid() = user_id);
create policy "reviews insert own" on public.reviews for insert with check (auth.uid() = user_id);
create policy "reviews delete own" on public.reviews for delete using (auth.uid() = user_id);

-- push_subscriptions
-- 用户只能看/写自己的订阅；upsert 会复用 endpoint，所以需要 update 权限。
drop policy if exists "push read own"   on public.push_subscriptions;
drop policy if exists "push insert own" on public.push_subscriptions;
drop policy if exists "push update own" on public.push_subscriptions;
drop policy if exists "push delete own" on public.push_subscriptions;

create policy "push read own"   on public.push_subscriptions for select using (auth.uid() = user_id);
create policy "push insert own" on public.push_subscriptions for insert with check (auth.uid() = user_id);
create policy "push update own" on public.push_subscriptions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "push delete own" on public.push_subscriptions for delete using (auth.uid() = user_id);

-- 9. 检索函数 search_entries -------------------------------------------------
--    按关键词数组做 OR 模糊匹配，命中次数多的排前面；全部在数据库端完成
--    security invoker + RLS 双重保险，只能搜到自己.
create or replace function public.search_entries(
  terms      text[],
  max_rows   integer default 20,
  exclude_id uuid default null
)
returns setof public.entries
language sql
stable
security invoker
set search_path = public
as $$
  with normalized as (
    select coalesce(array_agg(distinct t), '{}'::text[]) as terms
    from unnest(coalesce(terms, '{}'::text[])) as t
    where btrim(t) <> ''
  )
  select e.*
  from public.entries e, normalized n
  where e.user_id = auth.uid()
    and (exclude_id is null or e.id <> exclude_id)
    and (
      cardinality(n.terms) = 0
      or exists (
        select 1
        from unnest(n.terms) as term
        where e.content ilike '%' || term || '%'
           or coalesce(e.title, '') ilike '%' || term || '%'
           or array_to_string(e.tags, ' ') ilike '%' || term || '%'
      )
    )
  order by (
    select count(*)
    from unnest(n.terms) as term
    where e.content ilike '%' || term || '%'
       or coalesce(e.title, '') ilike '%' || term || '%'
       or array_to_string(e.tags, ' ') ilike '%' || term || '%'
  ) desc, e.created_at desc
  limit least(greatest(max_rows, 1), 100);
$$;

comment on function public.search_entries is '服务端检索：关键词数组 → 相关条目，供 AI 检索增强与本地搜索使用';

-- 10. 统计视图（可选，供洞察页快速取数） --------------------------------------
create or replace view public.entry_stats
with (security_invoker = true) as
select
  user_id,
  count(*)                                                        as total,
  count(*) filter (where status = 'inbox')                        as inbox_count,
  count(*) filter (where status in ('inbox', 'active') and kind = 'task') as open_tasks,
  count(*) filter (where status = 'done')                         as done_count,
  count(*) filter (where created_at > now() - interval '7 days')  as last_7_days,
  count(*) filter (where created_at > now() - interval '30 days') as last_30_days
from public.entries
group by user_id;

-- 10.5 早报聚合：所有用户各有多少件待办 -----------------------------------------
--      定时推送是「跨用户」任务，普通用户 JWT 只能看到自己（RLS），
--      所以这条聚合只给 service_role 用。
--      为什么不用 count(*) 一次查询搞定：PostgREST 不支持 GROUP BY，
--      要么逐用户 N+1 查询，要么在数据库里做一次聚合 —— 后者显然更省。
create or replace function public.pending_task_counts()
returns table (user_id uuid, task_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.user_id, count(*)::bigint as task_count
  from public.entries e
  where e.kind = 'task'
    and e.status in ('inbox', 'active')
  group by e.user_id
  having count(*) > 0;
$$;

comment on function public.pending_task_counts is '每日早报用：返回每个有待办的用户及其待办数量（仅 service_role 可执行）';

-- 10.6 邮件早报收件人（2026-11-07 加）----------------------------------------
--      邮箱存在 auth.users 里，普通角色读不到；定时任务需要「谁开了邮件早报 + 邮箱」，
--      所以用 security definer 做一次 join，只把两列吐出来。
--      返回空就是没人开，cron 会跳过整条邮件分支。
create or replace function public.digest_recipients()
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id as user_id, u.email::text as email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.digest_enabled = true
    and u.email is not null;
$$;

comment on function public.digest_recipients is '邮件早报用：返回开启了邮件早报的用户及其邮箱（仅 service_role 可执行）';

-- 11. 显式授权 ---------------------------------------------------------------
--     Postgres 的权限分两层：GRANT 决定「这个角色能不能看见这张表」，
--     RLS 决定「看见之后能碰哪些行」。两层都收紧才算真的关好门。
--     下面的授权让「创建项目时取消勾选『自动暴露新表』」也能正常工作。

-- service_role 是后台任务（Vercel Cron）用的角色，Supabase 建项目时默认就给了
-- schema 权限，这里显式写一遍，免得项目被手动收紧过之后 cron 静默失败。
grant usage on schema public to anon, authenticated, service_role;

-- anon（未登录）不需要碰任何业务表：所有页面都要求登录
revoke all on table public.entries     from anon;
revoke all on table public.entry_links from anon;
revoke all on table public.reviews     from anon;
revoke all on table public.profiles    from anon;
revoke all on table public.entry_stats from anon;
revoke all on table public.push_subscriptions from anon;

grant select, insert, update, delete on table public.entries     to authenticated;
grant select, insert, update, delete on table public.entry_links to authenticated;
grant select, insert, delete          on table public.reviews     to authenticated;
grant select, insert, update          on table public.profiles    to authenticated;
grant select                          on table public.entry_stats to authenticated;
grant select, insert, update, delete  on table public.push_subscriptions to authenticated;
-- service_role 专门给后台任务用（Vercel Cron 没有登录用户，只能靠它跨用户读数据）。
-- 注意：service_role 能绕过 RLS，但它仍然需要表级 GRANT，否则报
--   permission denied for table xxx (code 42501)。
-- push_subscriptions：推送通道读订阅 / 清理失效订阅
grant select, insert, update, delete  on table public.push_subscriptions to service_role;
-- entries：邮件通道要读每个人的待办标题填进邮件正文（只读，不需要写）
grant select                          on table public.entries to service_role;
-- profiles：邮件通道的收件人开关（只读）
grant select                          on table public.profiles to service_role;

-- 函数默认对 PUBLIC 开放 EXECUTE，这里收回来，只给登录用户
revoke all on function public.search_entries(text[], integer, uuid) from public;
grant execute on function public.search_entries(text[], integer, uuid) to authenticated;

-- 早报聚合是跨用户的，只给 service_role（定时任务），不给普通登录用户
revoke all on function public.pending_task_counts() from public;
revoke all on function public.pending_task_counts() from anon, authenticated;
grant execute on function public.pending_task_counts() to service_role;

-- 邮件早报收件人同样跨用户（还要读 auth.users 的邮箱），只给 service_role
revoke all on function public.digest_recipients() from public;
revoke all on function public.digest_recipients() from anon, authenticated;
grant execute on function public.digest_recipients() to service_role;

-- 让 PostgREST 立刻认识新表，避免首次请求报 "table not found in schema cache"
notify pgrst, 'reload schema';

-- ============================================================================
--  完成。接下来去 Authentication → Providers 确认 Email 已开启；
--  Authentication → URL Configuration 里把 Site URL 设为你的域名，
--  Redirect URLs 加上 http://localhost:3000/auth/callback 和
--  https://<你的域名>/auth/callback
-- ============================================================================
