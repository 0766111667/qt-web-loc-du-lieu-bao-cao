-- ============================================================================
-- QT 问题统计汇总 — Supabase 数据库结构（整个团队共用一套数据）
-- 用法：Supabase 控制台 → SQL Editor → New query → 粘贴本文件全部内容 → Run。
-- 可以重复执行（幂等），不会删除已有数据。
-- ============================================================================

-- 越南/泰国时间（UTC+7）的“今天”，用于每日 AI 次数上限（到当地 0 点重置）。
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

-- 已确认的报告（图片不上传，只同步数字）。删除是“软删除”(deleted=true)，其他设备才能同步到删除。
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

-- 共享的“问题类型目录”和“已学习的数字样本”。rev 用于乐观并发（两人同时修改时不会静默覆盖）。
create table if not exists public.app_meta (
  key        text primary key,            -- 'catalog' | 'learned'
  value      jsonb       not null,
  rev        integer     not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- 每日 AI 调用次数（服务端函数通过 ai_usage_bump 原子加一）。
create table if not exists public.ai_usage (
  day date primary key default public.today_local(),
  n   integer not null default 0
);

drop trigger if exists reports_touch  on public.reports;
create trigger reports_touch  before insert or update on public.reports  for each row execute function public.touch_row();
drop trigger if exists app_meta_touch on public.app_meta;
create trigger app_meta_touch before insert or update on public.app_meta for each row execute function public.touch_row();

-- 行级安全：只有已登录（被邀请）的用户可以读写；没有 delete 权限（只能软删除）；匿名用户什么都看不到。
alter table public.reports  enable row level security;
alter table public.app_meta enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists team_select  on public.reports;
drop policy if exists team_insert  on public.reports;
drop policy if exists team_update  on public.reports;
create policy team_select on public.reports for select to authenticated using (true);
create policy team_insert on public.reports for insert to authenticated with check (true);
create policy team_update on public.reports for update to authenticated using (true) with check (true);

drop policy if exists team_select  on public.app_meta;
drop policy if exists team_insert  on public.app_meta;
drop policy if exists team_update  on public.app_meta;
create policy team_select on public.app_meta for select to authenticated using (true);
create policy team_insert on public.app_meta for insert to authenticated with check (true);
create policy team_update on public.app_meta for update to authenticated using (true) with check (true);

drop policy if exists team_select on public.ai_usage;
create policy team_select on public.ai_usage for select to authenticated using (true);

-- 原子计数：未超过上限则 +1 并返回 allowed=true，否则不加并返回 allowed=false。
create or replace function public.ai_usage_bump(max_per_day integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur integer;
begin
  insert into public.ai_usage as u (day, n) values (public.today_local(), 1)
  on conflict (day) do update set n = u.n + 1 where u.n < max_per_day
  returning n into cur;
  if cur is null then
    select n into cur from public.ai_usage where day = public.today_local();
    return jsonb_build_object('allowed', false, 'n', coalesce(cur, 0), 'max', max_per_day);
  end if;
  return jsonb_build_object('allowed', true, 'n', cur, 'max', max_per_day);
end $$;

revoke all on function public.ai_usage_bump(integer) from public, anon;
grant execute on function public.ai_usage_bump(integer) to authenticated;
