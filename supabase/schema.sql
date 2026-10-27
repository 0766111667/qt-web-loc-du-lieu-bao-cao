-- Supabase setup for shared team reports. Run in SQL Editor.
create table if not exists public.qt_reports (
  id uuid primary key,
  report_month text not null,
  report_date date not null,
  image_hash text not null unique,
  file_name text not null,
  rows jsonb not null,
  source_occ integer not null,
  source_processed integer not null,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  owner_id uuid references auth.users(id) default auth.uid()
);
alter table public.qt_reports enable row level security;
-- Signed-in users can access only their own rows. For a shared team, replace this with an explicit team-membership policy.
create policy "Users manage own QT reports" on public.qt_reports for all to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists qt_reports_month_idx on public.qt_reports(report_month);
