-- ============================================================
-- 주의울림 V41
-- 학생 찬양 관리자 전용 권한
--
-- 목표
-- 1) 기존 전체 관리자는 모든 관리자 기능 유지
-- 2) 학생 찬양 관리자는 '찬양 관리'만 사용
-- 3) 찬양 관리자 가입은 앱에서 직접 가능
-- 4) 전체 관리자가 앱에서 이메일로 승인/해제 가능
-- 5) Supabase RLS에서도 찬양 외 데이터 접근 차단
-- ============================================================

create schema if not exists private;

-- ------------------------------------------------------------
-- 1. admin_users에 역할 추가
-- 기존 관리자 행은 자동으로 admin 역할을 유지합니다.
-- ------------------------------------------------------------
alter table public.admin_users
  add column if not exists role text not null default 'admin';

update public.admin_users
set role = 'admin'
where role is null or role not in ('admin','worship_manager');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_users_role_check_v41'
      and conrelid = 'public.admin_users'::regclass
  ) then
    alter table public.admin_users
      add constraint admin_users_role_check_v41
      check (role in ('admin','worship_manager'));
  end if;
end $$;

alter table public.admin_users enable row level security;
grant select on public.admin_users to authenticated;

drop policy if exists admin_users_self_role_select_v41 on public.admin_users;
create policy admin_users_self_role_select_v41
on public.admin_users
for select
to authenticated
using (user_id = auth.uid());

-- ------------------------------------------------------------
-- 2. 권한 판별 함수
-- private.is_youth_admin()을 '전체 관리자만' true가 되도록 재정의합니다.
-- 기존 앱의 다른 관리자 RLS가 이 함수를 사용하므로 찬양 관리자는
-- 말씀/성경공부/기도/학생기록 등 다른 데이터에 접근할 수 없습니다.
-- ------------------------------------------------------------
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
      and au.role = 'admin'
  );
$$;

create or replace function private.is_worship_manager()
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
      and au.role = 'worship_manager'
  );
$$;

create or replace function private.can_manage_worship()
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
      and au.role in ('admin','worship_manager')
  );
$$;

revoke all on function private.is_youth_admin() from public, anon;
revoke all on function private.is_worship_manager() from public, anon;
revoke all on function private.can_manage_worship() from public, anon;
grant execute on function private.is_youth_admin() to authenticated;
grant execute on function private.is_worship_manager() to authenticated;
grant execute on function private.can_manage_worship() to authenticated;

-- ------------------------------------------------------------
-- 3. 학생 찬양 관리자: 찬양 플레이리스트만 관리 허용
-- 학생 공개 SELECT 정책은 V33 정책을 그대로 사용합니다.
-- ------------------------------------------------------------
alter table public.worship_playlist_items enable row level security;
grant select on public.worship_playlist_items to anon, authenticated;
grant insert, update, delete on public.worship_playlist_items to authenticated;

drop policy if exists worship_playlist_manager_select_v41 on public.worship_playlist_items;
create policy worship_playlist_manager_select_v41
on public.worship_playlist_items
for select
to authenticated
using (private.is_worship_manager());

drop policy if exists worship_playlist_manager_insert_v41 on public.worship_playlist_items;
create policy worship_playlist_manager_insert_v41
on public.worship_playlist_items
for insert
to authenticated
with check (private.is_worship_manager());

drop policy if exists worship_playlist_manager_update_v41 on public.worship_playlist_items;
create policy worship_playlist_manager_update_v41
on public.worship_playlist_items
for update
to authenticated
using (private.is_worship_manager())
with check (private.is_worship_manager());

drop policy if exists worship_playlist_manager_delete_v41 on public.worship_playlist_items;
create policy worship_playlist_manager_delete_v41
on public.worship_playlist_items
for delete
to authenticated
using (private.is_worship_manager());

-- ------------------------------------------------------------
-- 4. YouTube API 키
-- 찬양 관리자는 검색에 필요한 youtube_api_key만 읽을 수 있습니다.
-- API 키 등록/수정은 기존 전체 관리자만 가능합니다.
-- ------------------------------------------------------------
alter table public.youth_app_settings enable row level security;
grant select on public.youth_app_settings to authenticated;

drop policy if exists youth_app_settings_worship_manager_select_v41 on public.youth_app_settings;
create policy youth_app_settings_worship_manager_select_v41
on public.youth_app_settings
for select
to authenticated
using (
  setting_key = 'youtube_api_key'
  and private.is_worship_manager()
);

-- ------------------------------------------------------------
-- 5. 전체 관리자가 학생 이메일로 찬양 관리자 승인/해제
-- auth.users 조회는 SECURITY DEFINER 함수 안에서만 수행합니다.
-- ------------------------------------------------------------
create or replace function public.youth_admin_set_worship_manager_v41(
  p_email text,
  p_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_email text;
  v_role text;
begin
  if not private.is_youth_admin() then
    raise exception '전체 관리자만 찬양 관리자 권한을 변경할 수 있습니다.' using errcode = '42501';
  end if;

  select u.id, u.email
    into v_user_id, v_email
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  order by u.created_at desc
  limit 1;

  if v_user_id is null then
    return jsonb_build_object(
      'ok', false,
      'message', '해당 이메일의 계정을 찾지 못했습니다. 학생이 먼저 앱의 찬양 관리자 계정 만들기를 완료해야 합니다.'
    );
  end if;

  select au.role into v_role
  from public.admin_users au
  where au.user_id = v_user_id;

  if p_enabled then
    if v_role = 'admin' then
      return jsonb_build_object('ok', false, 'message', '이 계정은 이미 전체 관리자입니다.');
    end if;

    insert into public.admin_users (user_id, role)
    values (v_user_id, 'worship_manager')
    on conflict (user_id)
    do update set role = excluded.role;

    return jsonb_build_object(
      'ok', true,
      'enabled', true,
      'email', v_email,
      'user_id', v_user_id
    );
  else
    if v_role = 'admin' then
      return jsonb_build_object('ok', false, 'message', '전체 관리자 권한은 이 화면에서 해제할 수 없습니다.');
    end if;

    delete from public.admin_users
    where user_id = v_user_id
      and role = 'worship_manager';

    return jsonb_build_object(
      'ok', true,
      'enabled', false,
      'email', v_email,
      'user_id', v_user_id
    );
  end if;
end;
$$;

revoke all on function public.youth_admin_set_worship_manager_v41(text, boolean) from public, anon;
grant execute on function public.youth_admin_set_worship_manager_v41(text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 6. 전체 관리자용 찬양 관리자 목록
-- ------------------------------------------------------------
create or replace function public.youth_admin_list_worship_managers_v41()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_youth_admin() then
    raise exception '전체 관리자만 찬양 관리자 목록을 볼 수 있습니다.' using errcode = '42501';
  end if;

  return query
  select au.user_id, u.email::text, u.created_at
  from public.admin_users au
  join auth.users u on u.id = au.user_id
  where au.role = 'worship_manager'
  order by lower(u.email), u.created_at;
end;
$$;

revoke all on function public.youth_admin_list_worship_managers_v41() from public, anon;
grant execute on function public.youth_admin_list_worship_managers_v41() to authenticated;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 7. 진단
-- 아래 결과는 V41 구조/권한이 생성되었는지 확인합니다.
-- ------------------------------------------------------------
select
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='admin_users' and column_name='role'
  ) as admin_role_exists,
  to_regprocedure('private.is_youth_admin()') is not null as full_admin_function_exists,
  to_regprocedure('private.is_worship_manager()') is not null as worship_manager_function_exists,
  to_regprocedure('private.can_manage_worship()') is not null as can_manage_worship_function_exists,
  to_regprocedure('public.youth_admin_set_worship_manager_v41(text,boolean)') is not null as approve_function_exists,
  to_regprocedure('public.youth_admin_list_worship_managers_v41()') is not null as list_function_exists,
  has_table_privilege('authenticated','public.worship_playlist_items','INSERT') as worship_insert_grant,
  has_table_privilege('authenticated','public.worship_playlist_items','UPDATE') as worship_update_grant,
  has_table_privilege('authenticated','public.worship_playlist_items','DELETE') as worship_delete_grant,
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='worship_playlist_items'
      and policyname='worship_playlist_manager_insert_v41'
  ) as worship_manager_policy_exists,
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='youth_app_settings'
      and policyname='youth_app_settings_worship_manager_select_v41'
  ) as youtube_key_read_policy_exists;
