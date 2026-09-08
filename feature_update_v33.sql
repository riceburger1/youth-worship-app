-- ============================================================
-- 주의울림 V33
-- YouTube 찬양 검색 + 주일별 플레이리스트
-- 1) 관리자 전용 YouTube API 키 저장
-- 2) 주일별 찬양 목록 등록/정렬/삭제
-- 3) 학생 공개 플레이리스트 조회
-- ============================================================

create schema if not exists private;

create or replace function private.is_youth_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  );
$$;

revoke all on function private.is_youth_admin() from public;
revoke all on function private.is_youth_admin() from anon;
grant execute on function private.is_youth_admin() to authenticated;

-- ------------------------------------------------------------
-- 관리자 전용 앱 설정
-- YouTube API Key는 학생/비로그인 사용자에게 SELECT 권한을 주지 않습니다.
-- ------------------------------------------------------------
create table if not exists public.youth_app_settings (
  setting_key text primary key,
  setting_value text not null,
  updated_at timestamptz not null default now()
);

alter table public.youth_app_settings enable row level security;

revoke all on public.youth_app_settings from anon;
revoke all on public.youth_app_settings from authenticated;
grant select, insert, update, delete on public.youth_app_settings to authenticated;

drop policy if exists youth_app_settings_admin_select_v33 on public.youth_app_settings;
create policy youth_app_settings_admin_select_v33
on public.youth_app_settings
for select
to authenticated
using (private.is_youth_admin());

drop policy if exists youth_app_settings_admin_insert_v33 on public.youth_app_settings;
create policy youth_app_settings_admin_insert_v33
on public.youth_app_settings
for insert
to authenticated
with check (private.is_youth_admin());

drop policy if exists youth_app_settings_admin_update_v33 on public.youth_app_settings;
create policy youth_app_settings_admin_update_v33
on public.youth_app_settings
for update
to authenticated
using (private.is_youth_admin())
with check (private.is_youth_admin());

drop policy if exists youth_app_settings_admin_delete_v33 on public.youth_app_settings;
create policy youth_app_settings_admin_delete_v33
on public.youth_app_settings
for delete
to authenticated
using (private.is_youth_admin());

-- ------------------------------------------------------------
-- 주일별 찬양 플레이리스트
-- sunday_date는 실제 예배 주일 날짜를 저장합니다.
-- ------------------------------------------------------------
create table if not exists public.worship_playlist_items (
  id uuid primary key default gen_random_uuid(),
  sunday_date date not null,
  title text not null,
  video_id text not null,
  thumbnail_url text,
  channel_title text,
  sort_order integer not null default 10,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worship_playlist_title_length_v33 check (char_length(btrim(title)) between 1 and 300),
  constraint worship_playlist_video_id_v33 check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint worship_playlist_thumbnail_length_v33 check (thumbnail_url is null or char_length(thumbnail_url) <= 1000),
  constraint worship_playlist_channel_length_v33 check (channel_title is null or char_length(channel_title) <= 300),
  constraint worship_playlist_sort_order_v33 check (sort_order between 0 and 100000),
  constraint worship_playlist_sunday_video_unique_v33 unique (sunday_date, video_id)
);

create index if not exists worship_playlist_sunday_sort_idx_v33
on public.worship_playlist_items (sunday_date desc, sort_order asc, created_at asc);

alter table public.worship_playlist_items enable row level security;

revoke all on public.worship_playlist_items from anon;
revoke all on public.worship_playlist_items from authenticated;
grant select on public.worship_playlist_items to anon, authenticated;
grant insert, update, delete on public.worship_playlist_items to authenticated;

-- 학생/비로그인 사용자는 공개된 곡만 조회

drop policy if exists worship_playlist_public_select_v33 on public.worship_playlist_items;
create policy worship_playlist_public_select_v33
on public.worship_playlist_items
for select
to anon, authenticated
using (published = true);

-- 관리자는 공개/비공개 포함 전체 조회 및 편집

drop policy if exists worship_playlist_admin_select_v33 on public.worship_playlist_items;
create policy worship_playlist_admin_select_v33
on public.worship_playlist_items
for select
to authenticated
using (private.is_youth_admin());

drop policy if exists worship_playlist_admin_insert_v33 on public.worship_playlist_items;
create policy worship_playlist_admin_insert_v33
on public.worship_playlist_items
for insert
to authenticated
with check (private.is_youth_admin());

drop policy if exists worship_playlist_admin_update_v33 on public.worship_playlist_items;
create policy worship_playlist_admin_update_v33
on public.worship_playlist_items
for update
to authenticated
using (private.is_youth_admin())
with check (private.is_youth_admin());

drop policy if exists worship_playlist_admin_delete_v33 on public.worship_playlist_items;
create policy worship_playlist_admin_delete_v33
on public.worship_playlist_items
for delete
to authenticated
using (private.is_youth_admin());

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 진단: 아래 값들이 true이면 정상입니다.
-- ------------------------------------------------------------
select
  to_regclass('public.youth_app_settings') is not null as youth_app_settings_exists,
  to_regclass('public.worship_playlist_items') is not null as worship_playlist_exists,
  has_table_privilege('anon', 'public.worship_playlist_items', 'SELECT') as worship_anon_select,
  has_table_privilege('authenticated', 'public.worship_playlist_items', 'SELECT') as worship_auth_select,
  has_table_privilege('authenticated', 'public.worship_playlist_items', 'INSERT') as worship_admin_insert,
  has_table_privilege('authenticated', 'public.worship_playlist_items', 'UPDATE') as worship_admin_update,
  has_table_privilege('authenticated', 'public.worship_playlist_items', 'DELETE') as worship_admin_delete,
  has_table_privilege('authenticated', 'public.youth_app_settings', 'SELECT') as settings_admin_select,
  has_table_privilege('authenticated', 'public.youth_app_settings', 'INSERT') as settings_admin_insert,
  has_table_privilege('authenticated', 'public.youth_app_settings', 'UPDATE') as settings_admin_update,
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='worship_playlist_items'
      and policyname='worship_playlist_public_select_v33'
  ) as worship_public_policy_exists,
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='worship_playlist_items'
      and policyname='worship_playlist_admin_insert_v33'
  ) as worship_admin_policy_exists;
