-- ============================================================
-- 주의울림 v11
-- 1) 말씀쓰기 완료/출석 저장 안정화
-- 2) 지난 말씀·성경공부 전체 삭제
-- 3) 지난 공지사항 삭제
-- 기존 콘텐츠 데이터는 이 SQL 실행만으로 삭제되지 않습니다.
-- ============================================================

begin;

create schema if not exists private;

-- ------------------------------------------------------------
-- 관리자 판별 helper
-- ------------------------------------------------------------
create or replace function private.is_youth_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.admin_users a
       where a.user_id = (select auth.uid())
     );
$$;
revoke all on function private.is_youth_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_youth_admin() to authenticated;

-- ============================================================
-- A. 말씀쓰기 완료/출석 저장
-- 학생은 Supabase Auth 로그인을 하지 않으므로 anon도 저장 가능해야 합니다.
-- 관리자 로그인 상태의 같은 브라우저에서는 authenticated 역할이 되므로
-- authenticated에도 저장 권한을 허용합니다.
-- ============================================================

grant insert on table public.attendance to anon, authenticated;
grant select on table public.attendance to authenticated;
grant select on table public.weekly_contents to anon, authenticated;

alter table public.attendance enable row level security;

-- 직접 INSERT fallback용 정책
-- 같은 이름 정책만 제거하므로 반복 실행해도 안전합니다.
drop policy if exists attendance_student_insert_v11 on public.attendance;
create policy attendance_student_insert_v11
on public.attendance
for insert
to anon, authenticated
with check (
  grade in ('중1','중2','중3','고1','고2','고3')
  and char_length(btrim(coalesce(student_name,''))) between 1 and 50
  and exists (
    select 1
    from public.weekly_contents w
    where w.id = attendance.weekly_content_id
      and w.published = true
  )
);

drop policy if exists attendance_admin_select_v11 on public.attendance;
create policy attendance_admin_select_v11
on public.attendance
for select
to authenticated
using ((select private.is_youth_admin()));

-- attendance.id가 identity/serial일 경우 필요한 sequence 권한
-- 해당 테이블 소유 sequence만 동적으로 부여합니다.
do $$
declare
  r record;
begin
  for r in
    select distinct seq_ns.nspname as seq_schema, seq.relname as seq_name
    from pg_class tbl
    join pg_namespace tbl_ns on tbl_ns.oid = tbl.relnamespace
    join pg_depend dep on dep.refobjid = tbl.oid and dep.deptype in ('a','i')
    join pg_class seq on seq.oid = dep.objid and seq.relkind = 'S'
    join pg_namespace seq_ns on seq_ns.oid = seq.relnamespace
    where tbl_ns.nspname = 'public' and tbl.relname = 'attendance'
  loop
    execute format('grant usage, select on sequence %I.%I to anon, authenticated', r.seq_schema, r.seq_name);
  end loop;
end $$;

-- RLS/권한 환경 차이를 피하기 위한 전용 출석 저장 함수
-- private SECURITY DEFINER 내부에서 입력값과 공개 말씀 여부를 검증합니다.
drop function if exists private.youth_submit_attendance_impl(text,text,text);
create function private.youth_submit_attendance_impl(
  p_weekly_content_id text,
  p_grade text,
  p_student_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_id public.weekly_contents.id%TYPE;
  v_name text := btrim(coalesce(p_student_name,''));
begin
  if p_grade not in ('중1','중2','중3','고1','고2','고3') then
    raise exception '학년을 확인해 주세요.' using errcode='22023';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 50 then
    raise exception '이름을 확인해 주세요.' using errcode='22023';
  end if;

  select w.id into v_week_id
  from public.weekly_contents w
  where w.id::text = p_weekly_content_id
    and w.published = true
  limit 1;

  if v_week_id is null then
    raise exception '현재 공개된 말씀 기록을 찾지 못했습니다.' using errcode='P0002';
  end if;

  begin
    insert into public.attendance(weekly_content_id, grade, student_name)
    values (v_week_id, p_grade, v_name);
  exception
    when unique_violation then
      return 'duplicate';
  end;

  return 'saved';
end;
$$;
revoke all on function private.youth_submit_attendance_impl(text,text,text) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.youth_submit_attendance_impl(text,text,text) to anon, authenticated;

drop function if exists public.youth_submit_attendance_v1(text,text,text);
create function public.youth_submit_attendance_v1(
  p_weekly_content_id text,
  p_grade text,
  p_student_name text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.youth_submit_attendance_impl(
    p_weekly_content_id, p_grade, p_student_name
  );
$$;
revoke all on function public.youth_submit_attendance_v1(text,text,text) from public;
grant execute on function public.youth_submit_attendance_v1(text,text,text) to anon, authenticated;

-- ============================================================
-- B. 지난 말씀 + 성경공부 전체 삭제
-- 전체 삭제 시 연결된 출석 및 성경공부 제출도 함께 제거합니다.
-- 기도제목은 내용 보존을 위해 weekly_content_id만 NULL로 변경합니다.
-- ============================================================

drop function if exists private.youth_admin_delete_weekly_impl_v3(text);
create function private.youth_admin_delete_weekly_impl_v3(p_content_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id public.weekly_contents.id%TYPE;
  v_att integer := 0;
  v_study integer := 0;
  v_questions integer := 0;
  v_prayers integer := 0;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode='42501';
  end if;

  select w.id into v_id
  from public.weekly_contents w
  where w.id::text = p_content_id
  limit 1;

  if v_id is null then
    raise exception '삭제할 말씀 기록을 찾지 못했습니다.' using errcode='P0002';
  end if;

  delete from public.attendance where weekly_content_id = v_id;
  get diagnostics v_att = row_count;

  delete from public.study_submissions where weekly_content_id = v_id;
  get diagnostics v_study = row_count;

  update public.prayer_requests
     set weekly_content_id = null
   where weekly_content_id = v_id;
  get diagnostics v_prayers = row_count;

  delete from public.study_questions where weekly_content_id = v_id;
  get diagnostics v_questions = row_count;

  delete from public.weekly_contents where id = v_id;

  return jsonb_build_object(
    'deleted_attendance', v_att,
    'deleted_study_submissions', v_study,
    'deleted_questions', v_questions,
    'preserved_prayer_requests', v_prayers
  );
end;
$$;
revoke all on function private.youth_admin_delete_weekly_impl_v3(text) from public;
grant execute on function private.youth_admin_delete_weekly_impl_v3(text) to authenticated;

drop function if exists public.youth_admin_delete_weekly_v3(text);
create function public.youth_admin_delete_weekly_v3(p_content_id text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.youth_admin_delete_weekly_impl_v3(p_content_id);
$$;
revoke all on function public.youth_admin_delete_weekly_v3(text) from public, anon;
grant execute on function public.youth_admin_delete_weekly_v3(text) to authenticated;

-- ============================================================
-- C. 공지사항 삭제
-- ============================================================

drop function if exists private.youth_admin_delete_notice_impl(text);
create function private.youth_admin_delete_notice_impl(p_notice_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id public.notices.id%TYPE;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode='42501';
  end if;

  select n.id into v_id
  from public.notices n
  where n.id::text = p_notice_id
  limit 1;

  if v_id is null then
    raise exception '삭제할 공지사항을 찾지 못했습니다.' using errcode='P0002';
  end if;

  delete from public.notices where id = v_id;
end;
$$;
revoke all on function private.youth_admin_delete_notice_impl(text) from public;
grant execute on function private.youth_admin_delete_notice_impl(text) to authenticated;

drop function if exists public.youth_admin_delete_notice_v1(text);
create function public.youth_admin_delete_notice_v1(p_notice_id text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.youth_admin_delete_notice_impl(p_notice_id);
$$;
revoke all on function public.youth_admin_delete_notice_v1(text) from public, anon;
grant execute on function public.youth_admin_delete_notice_v1(text) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- 실행 확인
-- 아래 값이 모두 true이면 기능 권한이 준비된 것입니다.
-- ============================================================
select
  has_table_privilege('anon','public.attendance','INSERT') as attendance_anon_insert,
  has_table_privilege('authenticated','public.attendance','INSERT') as attendance_auth_insert,
  has_function_privilege('anon','public.youth_submit_attendance_v1(text,text,text)','EXECUTE') as attendance_rpc_anon,
  has_function_privilege('authenticated','public.youth_submit_attendance_v1(text,text,text)','EXECUTE') as attendance_rpc_auth,
  has_function_privilege('authenticated','public.youth_admin_delete_weekly_v3(text)','EXECUTE') as weekly_delete_execute,
  has_function_privilege('authenticated','public.youth_admin_delete_notice_v1(text)','EXECUTE') as notice_delete_execute;
