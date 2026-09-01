-- ============================================================
-- 주의울림 v12
-- 1) 말씀 관리 / 성경공부 관리 분리
-- 2) 지난 말씀 삭제 안정화
-- 3) 학생 제출 기록 주일별 관리 + 개별 삭제
-- 기존 콘텐츠/학생 기록은 이 SQL 실행만으로 삭제되지 않습니다.
-- ============================================================

begin;

create schema if not exists private;

-- 관리자 판별 helper: private schema에 두고, 인증된 사용자만 호출 가능
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

-- ------------------------------------------------------------
-- Data API 권한 + RLS
-- ------------------------------------------------------------
grant select, insert, update, delete on table public.weekly_contents to authenticated;
grant select, insert, delete on table public.study_questions to authenticated;
grant select, delete on table public.attendance to authenticated;
grant select, delete on table public.study_submissions to authenticated;
grant select, update, delete on table public.prayer_requests to authenticated;
grant select, delete on table public.gratitude_prayers to authenticated;
grant select, delete on table public.anonymous_posts to authenticated;

alter table public.weekly_contents enable row level security;
alter table public.study_questions enable row level security;
alter table public.attendance enable row level security;
alter table public.study_submissions enable row level security;
alter table public.prayer_requests enable row level security;
alter table public.gratitude_prayers enable row level security;
alter table public.anonymous_posts enable row level security;

-- weekly_contents 관리자 정책
drop policy if exists weekly_contents_admin_select_v12 on public.weekly_contents;
create policy weekly_contents_admin_select_v12 on public.weekly_contents
for select to authenticated using ((select private.is_youth_admin()));

drop policy if exists weekly_contents_admin_insert_v12 on public.weekly_contents;
create policy weekly_contents_admin_insert_v12 on public.weekly_contents
for insert to authenticated with check ((select private.is_youth_admin()));

drop policy if exists weekly_contents_admin_update_v12 on public.weekly_contents;
create policy weekly_contents_admin_update_v12 on public.weekly_contents
for update to authenticated
using ((select private.is_youth_admin()))
with check ((select private.is_youth_admin()));

drop policy if exists weekly_contents_admin_delete_v12 on public.weekly_contents;
create policy weekly_contents_admin_delete_v12 on public.weekly_contents
for delete to authenticated using ((select private.is_youth_admin()));

-- study_questions 관리자 정책
drop policy if exists study_questions_admin_select_v12 on public.study_questions;
create policy study_questions_admin_select_v12 on public.study_questions
for select to authenticated using ((select private.is_youth_admin()));

drop policy if exists study_questions_admin_insert_v12 on public.study_questions;
create policy study_questions_admin_insert_v12 on public.study_questions
for insert to authenticated with check ((select private.is_youth_admin()));

drop policy if exists study_questions_admin_delete_v12 on public.study_questions;
create policy study_questions_admin_delete_v12 on public.study_questions
for delete to authenticated using ((select private.is_youth_admin()));

-- 학생 제출 기록: 관리자는 조회/삭제 가능
-- 기존 학생 INSERT 정책은 건드리지 않습니다.
drop policy if exists attendance_admin_select_v12 on public.attendance;
create policy attendance_admin_select_v12 on public.attendance
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists attendance_admin_delete_v12 on public.attendance;
create policy attendance_admin_delete_v12 on public.attendance
for delete to authenticated using ((select private.is_youth_admin()));

drop policy if exists study_submissions_admin_select_v12 on public.study_submissions;
create policy study_submissions_admin_select_v12 on public.study_submissions
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists study_submissions_admin_delete_v12 on public.study_submissions;
create policy study_submissions_admin_delete_v12 on public.study_submissions
for delete to authenticated using ((select private.is_youth_admin()));

drop policy if exists prayer_requests_admin_select_v12 on public.prayer_requests;
create policy prayer_requests_admin_select_v12 on public.prayer_requests
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists prayer_requests_admin_update_v12 on public.prayer_requests;
create policy prayer_requests_admin_update_v12 on public.prayer_requests
for update to authenticated
using ((select private.is_youth_admin()))
with check ((select private.is_youth_admin()));
drop policy if exists prayer_requests_admin_delete_v12 on public.prayer_requests;
create policy prayer_requests_admin_delete_v12 on public.prayer_requests
for delete to authenticated using ((select private.is_youth_admin()));

drop policy if exists gratitude_prayers_admin_select_v12 on public.gratitude_prayers;
create policy gratitude_prayers_admin_select_v12 on public.gratitude_prayers
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists gratitude_prayers_admin_delete_v12 on public.gratitude_prayers;
create policy gratitude_prayers_admin_delete_v12 on public.gratitude_prayers
for delete to authenticated using ((select private.is_youth_admin()));

drop policy if exists anonymous_posts_admin_select_v12 on public.anonymous_posts;
create policy anonymous_posts_admin_select_v12 on public.anonymous_posts
for select to authenticated using ((select private.is_youth_admin()));
drop policy if exists anonymous_posts_admin_delete_v12 on public.anonymous_posts;
create policy anonymous_posts_admin_delete_v12 on public.anonymous_posts
for delete to authenticated using ((select private.is_youth_admin()));

-- serial/identity PK를 사용하는 경우 INSERT에 필요한 sequence 권한
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT seq_ns.nspname AS seq_schema, seq.relname AS seq_name
    FROM pg_class tbl
    JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
    JOIN pg_depend dep ON dep.refobjid = tbl.oid AND dep.deptype IN ('a','i')
    JOIN pg_class seq ON seq.oid = dep.objid AND seq.relkind = 'S'
    JOIN pg_namespace seq_ns ON seq_ns.oid = seq.relnamespace
    WHERE tbl_ns.nspname = 'public'
      AND tbl.relname IN ('weekly_contents','study_questions')
  LOOP
    EXECUTE format('grant usage, select on sequence %I.%I to authenticated', r.seq_schema, r.seq_name);
  END LOOP;
END $$;

-- ============================================================
-- A. 말씀 저장: SECURITY INVOKER + RLS
-- ============================================================
drop function if exists public.youth_admin_save_word_v12(text,date,text,text,boolean);
create function public.youth_admin_save_word_v12(
  p_content_id text,
  p_week_start date,
  p_verse_reference text,
  p_verse_text text,
  p_published boolean
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id public.weekly_contents.id%TYPE;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode='42501';
  end if;
  if p_week_start is null
     or nullif(btrim(coalesce(p_verse_reference,'')),'') is null
     or nullif(btrim(coalesce(p_verse_text,'')),'') is null then
    raise exception '주 시작일, 말씀구절, 말씀본문을 확인해 주세요.' using errcode='22023';
  end if;

  if nullif(btrim(coalesce(p_content_id,'')),'') is not null then
    select w.id into v_id from public.weekly_contents w where w.id::text=p_content_id limit 1;
    if v_id is null then
      raise exception '수정할 말씀을 찾지 못했습니다.' using errcode='P0002';
    end if;
    update public.weekly_contents
       set week_start=p_week_start,
           verse_reference=btrim(p_verse_reference),
           verse_text=btrim(p_verse_text),
           published=coalesce(p_published,true)
     where id=v_id;
  else
    select w.id into v_id from public.weekly_contents w where w.week_start=p_week_start limit 1;
    if v_id is null then
      insert into public.weekly_contents(week_start,verse_reference,verse_text,study_title,published)
      values(p_week_start,btrim(p_verse_reference),btrim(p_verse_text),'성경공부',coalesce(p_published,true))
      returning id into v_id;
    else
      update public.weekly_contents
         set verse_reference=btrim(p_verse_reference),
             verse_text=btrim(p_verse_text),
             published=coalesce(p_published,true)
       where id=v_id;
    end if;
  end if;
  return v_id::text;
end;
$$;
revoke all on function public.youth_admin_save_word_v12(text,date,text,text,boolean) from public, anon;
grant execute on function public.youth_admin_save_word_v12(text,date,text,text,boolean) to authenticated;

-- ============================================================
-- B. 성경공부 저장: 말씀과 독립 관리
-- ============================================================
drop function if exists public.youth_admin_save_study_v12(text,text,jsonb);
create function public.youth_admin_save_study_v12(
  p_content_id text,
  p_study_title text,
  p_questions jsonb
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id public.weekly_contents.id%TYPE;
  v_count integer;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode='42501';
  end if;
  select w.id into v_id from public.weekly_contents w where w.id::text=p_content_id limit 1;
  if v_id is null then
    raise exception '성경공부를 연결할 말씀을 찾지 못했습니다.' using errcode='P0002';
  end if;
  if nullif(btrim(coalesce(p_study_title,'')),'') is null
     or p_questions is null or jsonb_typeof(p_questions) <> 'array' then
    raise exception '성경공부 제목과 질문을 확인해 주세요.' using errcode='22023';
  end if;
  select count(*) into v_count
  from jsonb_array_elements_text(p_questions) q(value)
  where nullif(btrim(q.value),'') is not null;
  if v_count < 2 or v_count > 3 then
    raise exception '성경공부 질문은 2개 또는 3개여야 합니다.' using errcode='22023';
  end if;

  update public.weekly_contents set study_title=btrim(p_study_title) where id=v_id;
  delete from public.study_questions where weekly_content_id=v_id;
  insert into public.study_questions(weekly_content_id,question_order,question_text)
  select v_id, q.ordinality::integer, btrim(q.value)
  from jsonb_array_elements_text(p_questions) with ordinality q(value,ordinality)
  where nullif(btrim(q.value),'') is not null;
  return v_id::text;
end;
$$;
revoke all on function public.youth_admin_save_study_v12(text,text,jsonb) from public, anon;
grant execute on function public.youth_admin_save_study_v12(text,text,jsonb) to authenticated;

-- ============================================================
-- C. 지난 말씀 삭제
-- 말씀 삭제 시 DB 관계상 같은 주차의 성경공부/출석/성경공부 제출도 삭제
-- 기도제목은 주차 연결만 해제해 내용 보존
-- ============================================================
drop function if exists public.youth_admin_delete_word_v12(text);
create function public.youth_admin_delete_word_v12(p_content_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id public.weekly_contents.id%TYPE;
  v_att integer:=0;
  v_study integer:=0;
  v_q integer:=0;
  v_prayer integer:=0;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode='42501';
  end if;
  select w.id into v_id from public.weekly_contents w where w.id::text=p_content_id limit 1;
  if v_id is null then
    raise exception '삭제할 지난 말씀을 찾지 못했습니다.' using errcode='P0002';
  end if;

  delete from public.attendance where weekly_content_id=v_id;
  get diagnostics v_att=row_count;
  delete from public.study_submissions where weekly_content_id=v_id;
  get diagnostics v_study=row_count;
  update public.prayer_requests set weekly_content_id=null where weekly_content_id=v_id;
  get diagnostics v_prayer=row_count;
  delete from public.study_questions where weekly_content_id=v_id;
  get diagnostics v_q=row_count;
  delete from public.weekly_contents where id=v_id;

  return jsonb_build_object(
    'deleted_attendance',v_att,
    'deleted_study_submissions',v_study,
    'deleted_questions',v_q,
    'preserved_prayer_requests',v_prayer
  );
end;
$$;
revoke all on function public.youth_admin_delete_word_v12(text) from public, anon;
grant execute on function public.youth_admin_delete_word_v12(text) to authenticated;

-- ============================================================
-- D. 성경공부 내용만 삭제 (학생 제출 기록은 별도 관리에서 삭제)
-- ============================================================
drop function if exists public.youth_admin_delete_study_v12(text);
create function public.youth_admin_delete_study_v12(p_content_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare v_id public.weekly_contents.id%TYPE;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode='42501';
  end if;
  select w.id into v_id from public.weekly_contents w where w.id::text=p_content_id limit 1;
  if v_id is null then
    raise exception '삭제할 성경공부의 말씀 주차를 찾지 못했습니다.' using errcode='P0002';
  end if;
  delete from public.study_questions where weekly_content_id=v_id;
  update public.weekly_contents set study_title='성경공부' where id=v_id;
end;
$$;
revoke all on function public.youth_admin_delete_study_v12(text) from public, anon;
grant execute on function public.youth_admin_delete_study_v12(text) to authenticated;

-- ============================================================
-- E. 학생 제출 기록 개별 삭제
-- attendance / study / prayer / gratitude / board
-- ============================================================
drop function if exists public.youth_admin_delete_student_record_v12(text,text);
create function public.youth_admin_delete_student_record_v12(
  p_record_type text,
  p_record_id text
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
      delete from public.attendance where id::text=p_record_id;
    when 'study' then
      delete from public.study_submissions where id::text=p_record_id;
    when 'prayer' then
      delete from public.prayer_requests where id::text=p_record_id;
    when 'gratitude' then
      delete from public.gratitude_prayers where id::text=p_record_id;
    when 'board' then
      delete from public.anonymous_posts where id::text=p_record_id;
    else
      raise exception '지원하지 않는 기록 유형입니다.' using errcode='22023';
  end case;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception '삭제할 학생 제출 기록을 찾지 못했습니다.' using errcode='P0002';
  end if;
end;
$$;
revoke all on function public.youth_admin_delete_student_record_v12(text,text) from public, anon;
grant execute on function public.youth_admin_delete_student_record_v12(text,text) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ============================================================
-- 실행 확인: admin_link_count=1, 나머지 true 권장
-- ============================================================
select
  (select count(*) from public.admin_users a join auth.users u on u.id=a.user_id)::int as admin_link_count,
  has_table_privilege('authenticated','public.weekly_contents','INSERT') as word_insert,
  has_table_privilege('authenticated','public.weekly_contents','UPDATE') as word_update,
  has_table_privilege('authenticated','public.weekly_contents','DELETE') as word_delete,
  has_table_privilege('authenticated','public.study_questions','INSERT') as study_insert,
  has_table_privilege('authenticated','public.study_questions','DELETE') as study_delete,
  has_table_privilege('authenticated','public.attendance','DELETE') as attendance_delete,
  has_table_privilege('authenticated','public.study_submissions','DELETE') as submission_delete,
  has_function_privilege('authenticated','public.youth_admin_save_word_v12(text,date,text,text,boolean)','EXECUTE') as word_rpc,
  has_function_privilege('authenticated','public.youth_admin_save_study_v12(text,text,jsonb)','EXECUTE') as study_rpc,
  has_function_privilege('authenticated','public.youth_admin_delete_word_v12(text)','EXECUTE') as word_delete_rpc,
  has_function_privilege('authenticated','public.youth_admin_delete_student_record_v12(text,text)','EXECUTE') as record_delete_rpc;
