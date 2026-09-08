-- ============================================================
-- 주의울림 V44
-- 학생 찬양 관리자 이메일 인증 안정화 + DB 조회 최적화
--
-- 중요: Supabase Auth의 Confirm email / Site URL / Redirect URLs / SMTP 설정은
-- SQL로 변경할 수 없습니다. 아래 SQL은 '인증 완료된 사용자만 찬양 관리자 승인'
-- 되도록 DB 권한을 강화하고, 자주 쓰는 조회 인덱스를 추가합니다.
-- ============================================================

create schema if not exists private;

-- ------------------------------------------------------------
-- 1) 관리자 역할 컬럼 보장
-- ------------------------------------------------------------
alter table public.admin_users
  add column if not exists role text not null default 'admin';

update public.admin_users
set role = 'admin'
where role is null or role not in ('admin','worship_manager');

-- 전체 관리자 / 찬양 관리자 판별 함수가 없다면 V41과 동일하게 보강
create or replace function private.is_youth_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users au
    where au.user_id = auth.uid() and au.role = 'admin'
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
    select 1 from public.admin_users au
    where au.user_id = auth.uid() and au.role = 'worship_manager'
  );
$$;

revoke all on function private.is_youth_admin() from public, anon;
revoke all on function private.is_worship_manager() from public, anon;
grant execute on function private.is_youth_admin() to authenticated;
grant execute on function private.is_worship_manager() to authenticated;

-- ------------------------------------------------------------
-- 2) V44 찬양 관리자 승인/해제
-- 이메일 인증이 완료된 auth.users만 worship_manager 승인 가능
-- ------------------------------------------------------------
create or replace function public.youth_admin_set_worship_manager_v44(
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
  v_email_confirmed_at timestamptz;
  v_role text;
begin
  if not private.is_youth_admin() then
    raise exception '전체 관리자만 찬양 관리자 권한을 변경할 수 있습니다.' using errcode = '42501';
  end if;

  select u.id, u.email, u.email_confirmed_at
    into v_user_id, v_email, v_email_confirmed_at
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
    if v_email_confirmed_at is null then
      return jsonb_build_object(
        'ok', false,
        'message', '이 학생은 아직 이메일 인증을 완료하지 않았습니다. 인증 메일의 확인 링크를 먼저 눌러 주세요.'
      );
    end if;

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
      'email_confirmed', true,
      'user_id', v_user_id
    );
  end if;

  if v_role = 'admin' then
    return jsonb_build_object('ok', false, 'message', '전체 관리자 권한은 이 화면에서 해제할 수 없습니다.');
  end if;

  delete from public.admin_users
  where user_id = v_user_id and role = 'worship_manager';

  return jsonb_build_object(
    'ok', true,
    'enabled', false,
    'email', v_email,
    'user_id', v_user_id
  );
end;
$$;

revoke all on function public.youth_admin_set_worship_manager_v44(text, boolean) from public, anon;
grant execute on function public.youth_admin_set_worship_manager_v44(text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 3) V44 전체 관리자용 찬양 관리자 목록
-- 이메일 인증 여부도 같이 표시
-- ------------------------------------------------------------
create or replace function public.youth_admin_list_worship_managers_v44()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  email_confirmed boolean
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
    u.created_at,
    (u.email_confirmed_at is not null)
  from public.admin_users au
  join auth.users u on u.id = au.user_id
  where au.role = 'worship_manager'
  order by lower(u.email), u.created_at;
end;
$$;

revoke all on function public.youth_admin_list_worship_managers_v44() from public, anon;
grant execute on function public.youth_admin_list_worship_managers_v44() to authenticated;

-- ------------------------------------------------------------
-- 4) 자주 사용하는 조회 인덱스
-- 이미 있으면 다시 만들지 않습니다.
-- ------------------------------------------------------------
create index if not exists weekly_contents_week_start_v44
  on public.weekly_contents (week_start desc);

create index if not exists notices_public_created_v44
  on public.notices (published, created_at desc);

create index if not exists anonymous_posts_public_created_v44
  on public.anonymous_posts (is_hidden, created_at desc);

create index if not exists worship_playlist_sunday_public_sort_v44
  on public.worship_playlist_items (sunday_date, published, sort_order, created_at);

create index if not exists gratitude_prayers_date_student_v44
  on public.gratitude_prayers (prayer_date desc, grade, student_name);

create index if not exists prayer_requests_week_submitted_v44
  on public.prayer_requests (weekly_content_id, submitted_at desc);

create index if not exists study_submissions_week_submitted_v44
  on public.study_submissions (weekly_content_id, submitted_at desc);

create index if not exists attendance_week_completed_v44
  on public.attendance (weekly_content_id, completed_at desc);

create index if not exists church_events_period_v44
  on public.church_events (event_date, end_date);

create index if not exists new_friends_created_v44
  on public.new_friends (created_at desc);

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 5) 진단: 아래 항목이 모두 true인지 확인
-- ------------------------------------------------------------
select
  to_regprocedure('public.youth_admin_set_worship_manager_v44(text,boolean)') is not null as approve_v44_exists,
  to_regprocedure('public.youth_admin_list_worship_managers_v44()') is not null as list_v44_exists,
  has_function_privilege('authenticated', 'public.youth_admin_set_worship_manager_v44(text,boolean)', 'EXECUTE') as approve_v44_execute,
  has_function_privilege('authenticated', 'public.youth_admin_list_worship_managers_v44()', 'EXECUTE') as list_v44_execute,
  to_regclass('public.weekly_contents_week_start_v44') is not null as weekly_index_exists,
  to_regclass('public.notices_public_created_v44') is not null as notice_index_exists,
  to_regclass('public.worship_playlist_sunday_public_sort_v44') is not null as worship_index_exists,
  to_regclass('public.gratitude_prayers_date_student_v44') is not null as gratitude_index_exists;
