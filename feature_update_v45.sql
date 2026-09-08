-- ============================================================
-- 주의울림 V45
-- 학생 찬양 관리자: 이메일 인증 제거형 승인 + 권한 유지
--
-- 중요:
-- 1) 이 SQL은 DB 승인 로직에서 '이메일 인증 완료' 조건을 제거합니다.
-- 2) Supabase Auth의 Confirm Email 자체는 SQL로 끌 수 없습니다.
--    Dashboard → Authentication → Sign In / Providers → Email → Confirm Email 을 OFF 하세요.
-- ============================================================

create schema if not exists private;

alter table public.admin_users
  add column if not exists role text not null default 'admin';

update public.admin_users
set role = 'admin'
where role is null or role not in ('admin','worship_manager');

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

revoke all on function private.is_youth_admin() from public, anon;
revoke all on function private.is_worship_manager() from public, anon;
grant execute on function private.is_youth_admin() to authenticated;
grant execute on function private.is_worship_manager() to authenticated;

-- 전체 관리자가 학생 이메일만으로 찬양 관리자 승인/해제.
-- 이메일 인증 완료 여부는 확인하지 않습니다.
create or replace function public.youth_admin_set_worship_manager_v45(
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
      'message', '해당 이메일의 계정을 찾지 못했습니다. 학생이 먼저 앱에서 계정을 만들어야 합니다.'
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
  end if;

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
end;
$$;

revoke all on function public.youth_admin_set_worship_manager_v45(text, boolean) from public, anon;
grant execute on function public.youth_admin_set_worship_manager_v45(text, boolean) to authenticated;

create or replace function public.youth_admin_list_worship_managers_v45()
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
  select
    au.user_id,
    u.email::text,
    u.created_at
  from public.admin_users au
  join auth.users u on u.id = au.user_id
  where au.role = 'worship_manager'
  order by lower(u.email), u.created_at;
end;
$$;

revoke all on function public.youth_admin_list_worship_managers_v45() from public, anon;
grant execute on function public.youth_admin_list_worship_managers_v45() to authenticated;

notify pgrst, 'reload schema';

select
  to_regprocedure('public.youth_admin_set_worship_manager_v45(text,boolean)') is not null as approve_v45_exists,
  to_regprocedure('public.youth_admin_list_worship_managers_v45()') is not null as list_v45_exists,
  has_function_privilege('authenticated', 'public.youth_admin_set_worship_manager_v45(text,boolean)', 'EXECUTE') as approve_v45_execute,
  has_function_privilege('authenticated', 'public.youth_admin_list_worship_managers_v45()', 'EXECUTE') as list_v45_execute;
