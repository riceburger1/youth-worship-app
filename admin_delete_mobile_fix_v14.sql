-- ============================================================
-- 주의울림 V14
-- 삭제 RPC(PGRST202) 복구 + 관리자 직접삭제 RLS + 학생 제출기록 삭제
-- 기존 데이터는 이 SQL 실행만으로 삭제되지 않습니다.
-- ============================================================

begin;

create schema if not exists private;
grant usage on schema private to authenticated;

-- 관리자 여부 판별. admin_users의 RLS에 다시 막히지 않도록 내부 조회만 SECURITY DEFINER 사용.
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
revoke all on function private.is_youth_admin() from public, anon;
grant execute on function private.is_youth_admin() to authenticated;

-- 필요한 Data API 권한. 실제 행 접근은 아래 RLS가 제한합니다.
grant select, update, delete on table public.weekly_contents to authenticated;
grant select, delete on table public.study_questions to authenticated;
grant select, delete on table public.attendance to authenticated;
grant select, delete on table public.study_submissions to authenticated;
grant select, update, delete on table public.prayer_requests to authenticated;
grant select, delete on table public.gratitude_prayers to authenticated;
grant select, delete on table public.anonymous_posts to authenticated;
grant select, delete on table public.notices to authenticated;

alter table public.weekly_contents enable row level security;
alter table public.study_questions enable row level security;
alter table public.attendance enable row level security;
alter table public.study_submissions enable row level security;
alter table public.prayer_requests enable row level security;
alter table public.gratitude_prayers enable row level security;
alter table public.anonymous_posts enable row level security;
alter table public.notices enable row level security;

-- v14 정책은 반복 실행해도 충돌하지 않습니다.
drop policy if exists weekly_contents_admin_select_v14 on public.weekly_contents;
create policy weekly_contents_admin_select_v14 on public.weekly_contents
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists weekly_contents_admin_update_v14 on public.weekly_contents;
create policy weekly_contents_admin_update_v14 on public.weekly_contents
for update to authenticated
using ((select private.is_youth_admin()))
with check ((select private.is_youth_admin()));
drop policy if exists weekly_contents_admin_delete_v14 on public.weekly_contents;
create policy weekly_contents_admin_delete_v14 on public.weekly_contents
for delete to authenticated using ((select private.is_youth_admin()));

drop policy if exists study_questions_admin_select_v14 on public.study_questions;
create policy study_questions_admin_select_v14 on public.study_questions
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists study_questions_admin_delete_v14 on public.study_questions;
create policy study_questions_admin_delete_v14 on public.study_questions
for delete to authenticated using ((select private.is_youth_admin()));

drop policy if exists attendance_admin_select_v14 on public.attendance;
create policy attendance_admin_select_v14 on public.attendance
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists attendance_admin_delete_v14 on public.attendance;
create policy attendance_admin_delete_v14 on public.attendance
for delete to authenticated using ((select private.is_youth_admin()));

drop policy if exists study_submissions_admin_select_v14 on public.study_submissions;
create policy study_submissions_admin_select_v14 on public.study_submissions
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists study_submissions_admin_delete_v14 on public.study_submissions;
create policy study_submissions_admin_delete_v14 on public.study_submissions
for delete to authenticated using ((select private.is_youth_admin()));

drop policy if exists prayer_requests_admin_select_v14 on public.prayer_requests;
create policy prayer_requests_admin_select_v14 on public.prayer_requests
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists prayer_requests_admin_update_v14 on public.prayer_requests;
create policy prayer_requests_admin_update_v14 on public.prayer_requests
for update to authenticated
using ((select private.is_youth_admin()))
with check ((select private.is_youth_admin()));
drop policy if exists prayer_requests_admin_delete_v14 on public.prayer_requests;
create policy prayer_requests_admin_delete_v14 on public.prayer_requests
for delete to authenticated using ((select private.is_youth_admin()));

drop policy if exists gratitude_prayers_admin_select_v14 on public.gratitude_prayers;
create policy gratitude_prayers_admin_select_v14 on public.gratitude_prayers
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists gratitude_prayers_admin_delete_v14 on public.gratitude_prayers;
create policy gratitude_prayers_admin_delete_v14 on public.gratitude_prayers
for delete to authenticated using ((select private.is_youth_admin()));

drop policy if exists anonymous_posts_admin_select_v14 on public.anonymous_posts;
create policy anonymous_posts_admin_select_v14 on public.anonymous_posts
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists anonymous_posts_admin_delete_v14 on public.anonymous_posts;
create policy anonymous_posts_admin_delete_v14 on public.anonymous_posts
for delete to authenticated using ((select private.is_youth_admin()));

drop policy if exists notices_admin_select_v14 on public.notices;
create policy notices_admin_select_v14 on public.notices
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists notices_admin_delete_v14 on public.notices;
create policy notices_admin_delete_v14 on public.notices
for delete to authenticated using ((select private.is_youth_admin()));

-- ============================================================
-- 1) 지난 말씀 삭제
-- 앱 호출과 정확히 동일: youth_admin_delete_word_v14(p_content_id)
-- ============================================================
drop function if exists public.youth_admin_delete_word_v14(text);
create function public.youth_admin_delete_word_v14(p_content_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id public.weekly_contents.id%type;
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
    raise exception '삭제할 지난 말씀을 찾지 못했습니다.' using errcode='P0002';
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
    'deleted', true,
    'attendance', v_att,
    'study_submissions', v_study,
    'study_questions', v_questions,
    'preserved_prayer_requests', v_prayers
  );
end;
$$;
revoke all on function public.youth_admin_delete_word_v14(text) from public, anon;
grant execute on function public.youth_admin_delete_word_v14(text) to authenticated;

-- ============================================================
-- 2) 성경공부만 삭제
-- ============================================================
drop function if exists public.youth_admin_delete_study_v14(text);
create function public.youth_admin_delete_study_v14(p_content_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id public.weekly_contents.id%type;
  v_questions integer := 0;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode='42501';
  end if;

  select w.id into v_id
  from public.weekly_contents w
  where w.id::text = p_content_id
  limit 1;

  if v_id is null then
    raise exception '삭제할 성경공부의 말씀 주차를 찾지 못했습니다.' using errcode='P0002';
  end if;

  delete from public.study_questions where weekly_content_id = v_id;
  get diagnostics v_questions = row_count;
  update public.weekly_contents set study_title = '성경공부' where id = v_id;

  return jsonb_build_object('deleted', true, 'study_questions', v_questions);
end;
$$;
revoke all on function public.youth_admin_delete_study_v14(text) from public, anon;
grant execute on function public.youth_admin_delete_study_v14(text) to authenticated;

-- ============================================================
-- 3) 공지사항 삭제
-- ============================================================
drop function if exists public.youth_admin_delete_notice_v14(text);
create function public.youth_admin_delete_notice_v14(p_notice_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode='42501';
  end if;
  delete from public.notices where id::text = p_notice_id;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception '삭제할 공지사항을 찾지 못했습니다.' using errcode='P0002';
  end if;
end;
$$;
revoke all on function public.youth_admin_delete_notice_v14(text) from public, anon;
grant execute on function public.youth_admin_delete_notice_v14(text) to authenticated;

-- ============================================================
-- 4) 학생 제출 기록 1건 삭제
-- 앱 호출과 정확히 동일:
-- youth_admin_delete_student_record_v14(p_record_id, p_record_type)
-- ============================================================
drop function if exists public.youth_admin_delete_student_record_v14(text,text);
create function public.youth_admin_delete_student_record_v14(
  p_record_id text,
  p_record_type text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode='42501';
  end if;
  if nullif(btrim(coalesce(p_record_id,'')),'') is null then
    raise exception '삭제할 기록 ID가 없습니다.' using errcode='22023';
  end if;

  case p_record_type
    when 'attendance' then
      delete from public.attendance where id::text = p_record_id;
    when 'study' then
      delete from public.study_submissions where id::text = p_record_id;
    when 'prayer' then
      delete from public.prayer_requests where id::text = p_record_id;
    when 'gratitude' then
      delete from public.gratitude_prayers where id::text = p_record_id;
    when 'board' then
      delete from public.anonymous_posts where id::text = p_record_id;
    else
      raise exception '지원하지 않는 기록 유형입니다.' using errcode='22023';
  end case;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception '삭제할 학생 제출 기록을 찾지 못했습니다.' using errcode='P0002';
  end if;
end;
$$;
revoke all on function public.youth_admin_delete_student_record_v14(text,text) from public, anon;
grant execute on function public.youth_admin_delete_student_record_v14(text,text) to authenticated;

-- PostgREST 함수 스키마 캐시 즉시 갱신
notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

commit;

-- ============================================================
-- 실행 확인: 함수명 4개가 모두 표시되고 can_execute=true면 정상
-- ============================================================
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'youth_admin_delete_word_v14',
    'youth_admin_delete_study_v14',
    'youth_admin_delete_notice_v14',
    'youth_admin_delete_student_record_v14'
  )
order by p.proname;
