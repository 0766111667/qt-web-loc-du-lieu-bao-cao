-- ============================================================================
-- QT 问题统计汇总 — Supabase 数据库结构（整个团队共用一套数据）
-- 用法：Supabase 控制台 → SQL Editor → New query → 粘贴本文件全部内容 → Run。
-- 可以重复执行（幂等），不会删除已有数据。
--
-- 安全模型（多层防护）：
--   1. Authentication 里关闭公开注册，只由管理员手动创建账号；
--   2. 即使有人拿到别的合法登录，也必须在 allowed_members 白名单中才能读写（is_member()）；
--   3. 所有表启用行级安全(RLS)，匿名用户什么都看不到，且没有 delete 权限（只能软删除）；
--   4. 表上有大小/格式约束，防止被塞入超大或畸形数据；
--   5. AI 次数由 security definer 函数原子计数，客户端不能直接改。
-- ============================================================================

-- 白名单：只有这里的邮箱可以访问数据。账号 admin 对应邮箱 admin@qt.app。
create table if not exists public.allowed_members (email text primary key);
alter table public.allowed_members enable row level security;       -- 不建任何策略 = 普通用户完全不能读写
revoke all on public.allowed_members from anon, authenticated;
insert into public.allowed_members (email) values ('admin@qt.app') on conflict do nothing;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_members m where m.email = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- 当地（UTC+7）的“今天”，用于每日 AI 次数上限（到当地 0 点重置）。
create or replace function public.today_local() returns date
language sql stable as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

-- 更新时间与更新人由服务器写入（不信任客户端时钟），同步游标依赖 updated_at。
create or replace function public.touch_row() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create table if not exists public.reports (
  id            text primary key,
  hash          text,
  name          text        not null,
  date          date        not null,
  month         text        not null,
  created_at    bigint      not null,
  rows          jsonb       not null,
  printed_total jsonb,
  status        text        not null default 'manual',
  note          text        not null default '',
  deleted       boolean     not null default false,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
create index if not exists reports_updated_idx on public.reports (updated_at);
create index if not exists reports_month_idx   on public.reports (month);
create index if not exists reports_hash_idx    on public.reports (hash);

create table if not exists public.app_meta (
  key        text primary key,
  value      jsonb       not null,
  rev        integer     not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.ai_usage (
  day date primary key default public.today_local(),
  n   integer not null default 0
);

-- 约束（用 not valid 避免因历史数据而失败；新写入的数据一定会被检查）
do $$ begin
  alter table public.reports add constraint reports_shape check (
    char_length(id) between 1 and 64 and char_length(name) <= 300 and char_length(note) <= 300
    and month ~ '^[0-9]{4}-[0-9]{2}$' and jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) <= 100
    and pg_column_size(rows) <= 100000 and (printed_total is null or pg_column_size(printed_total) <= 500)
    and status in ('auto', 'manual')) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.app_meta add constraint app_meta_shape check (key in ('catalog', 'learned') and pg_column_size(value) <= 3000000) not valid;
exception when duplicate_object then null; end $$;

drop trigger if exists reports_touch  on public.reports;
create trigger reports_touch  before insert or update on public.reports  for each row execute function public.touch_row();
drop trigger if exists app_meta_touch on public.app_meta;
create trigger app_meta_touch before insert or update on public.app_meta for each row execute function public.touch_row();

alter table public.reports  enable row level security;
alter table public.app_meta enable row level security;
alter table public.ai_usage enable row level security;
revoke all on public.reports, public.app_meta, public.ai_usage from anon;
revoke delete, truncate on public.reports, public.app_meta, public.ai_usage from authenticated;
revoke insert, update on public.ai_usage from authenticated;

-- 旧版策略一并清理后重建（只有白名单成员 is_member() 才可读写）
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and tablename in ('reports', 'app_meta', 'ai_usage') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
create policy member_select on public.reports  for select to authenticated using (public.is_member());
create policy member_insert on public.reports  for insert to authenticated with check (public.is_member());
create policy member_update on public.reports  for update to authenticated using (public.is_member()) with check (public.is_member());
create policy member_select on public.app_meta for select to authenticated using (public.is_member());
create policy member_insert on public.app_meta for insert to authenticated with check (public.is_member());
create policy member_update on public.app_meta for update to authenticated using (public.is_member()) with check (public.is_member());
create policy member_select on public.ai_usage for select to authenticated using (public.is_member());

-- 原子计数：非白名单成员 → member=false；未超上限则 +1 并 allowed=true，否则不加并 allowed=false。
create or replace function public.ai_usage_bump(max_per_day integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur integer;
begin
  if not public.is_member() then
    return jsonb_build_object('allowed', false, 'member', false, 'n', 0, 'max', max_per_day);
  end if;
  insert into public.ai_usage as u (day, n) values (public.today_local(), 1)
  on conflict (day) do update set n = u.n + 1 where u.n < max_per_day
  returning n into cur;
  if cur is null then
    select n into cur from public.ai_usage where day = public.today_local();
    return jsonb_build_object('allowed', false, 'member', true, 'n', coalesce(cur, 0), 'max', max_per_day);
  end if;
  return jsonb_build_object('allowed', true, 'member', true, 'n', cur, 'max', max_per_day);
end $$;
revoke all on function public.ai_usage_bump(integer) from public, anon;
grant execute on function public.ai_usage_bump(integer) to authenticated;
