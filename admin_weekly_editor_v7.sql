-- 주의울림 youth-worship 말씀·성경공부 관리자 편집 V7
-- 목적
-- 1) 말씀 저장과 성경공부 저장을 분리하여 말씀 등록 실패를 방지
-- 2) 지난 말씀/성경공부 수정 가능
-- 3) 성경공부만 삭제 가능
-- 4) 학생 제출 기록이 없는 주차는 말씀+성경공부 전체 삭제 가능
--
-- 기존 데이터는 이 SQL 실행만으로 삭제되지 않습니다.
-- 실제 삭제는 관리자 화면에서 삭제 버튼을 눌렀을 때만 실행됩니다.

begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- 관리자 판별 함수 보장
create or replace function private.is_youth_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.admin_users a
      where a.user_id = (select auth.uid())
    );
$$;
revoke all on function private.is_youth_admin() from public;
grant execute on function private.is_youth_admin() to authenticated;

-- ============================================================
-- 1) 말씀 저장 구현: private SECURITY DEFINER
--    RLS 우회가 필요하지만 함수 안에서 관리자 UID를 반드시 재검증합니다.
-- ============================================================
drop function if exists private.youth_admin_save_word_impl(text,date,text,text,boolean);
create function private.youth_admin_save_word_impl(
  p_content_id text,
  p_week_start date,
  p_verse_reference text,
  p_verse_text text,
  p_published boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id public.weekly_contents.id%TYPE;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode = '42501';
  end if;

  if p_week_start is null
     or nullif(btrim(coalesce(p_verse_reference,'')), '') is null
     or nullif(btrim(coalesce(p_verse_text,'')), '') is null then
    raise exception '주 시작일, 말씀구절, 말씀본문은 필수입니다.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_content_id,'')), '') is not null then
    select w.id into v_id
    from public.weekly_contents w
    where w.id::text = p_content_id
    limit 1;

    if v_id is null then
      raise exception '수정할 말씀 기록을 찾지 못했습니다.' using errcode = 'P0002';
    end if;

    update public.weekly_contents
       set week_start = p_week_start,
           verse_reference = btrim(p_verse_reference),
           verse_text = btrim(p_verse_text),
           published = coalesce(p_published,true)
     where id = v_id;
  else
    select w.id into v_id
    from public.weekly_contents w
    where w.week_start = p_week_start
    limit 1;

    if v_id is null then
      insert into public.weekly_contents
        (week_start, verse_reference, verse_text, study_title, published)
      values
        (p_week_start, btrim(p_verse_reference), btrim(p_verse_text), '성경공부', coalesce(p_published,true))
      returning id into v_id;
    else
      update public.weekly_contents
         set verse_reference = btrim(p_verse_reference),
             verse_text = btrim(p_verse_text),
             published = coalesce(p_published,true)
       where id = v_id;
    end if;
  end if;

  return v_id::text;
end;
$$;
revoke all on function private.youth_admin_save_word_impl(text,date,text,text,boolean) from public;
grant execute on function private.youth_admin_save_word_impl(text,date,text,text,boolean) to authenticated;

-- public wrapper
drop function if exists public.youth_admin_save_word_v2(text,date,text,text,boolean);
create function public.youth_admin_save_word_v2(
  p_content_id text,
  p_week_start date,
  p_verse_reference text,
  p_verse_text text,
  p_published boolean
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.youth_admin_save_word_impl(
    p_content_id,p_week_start,p_verse_reference,p_verse_text,p_published
  );
$$;
revoke all on function public.youth_admin_save_word_v2(text,date,text,text,boolean) from public, anon;
grant execute on function public.youth_admin_save_word_v2(text,date,text,text,boolean) to authenticated;

-- ============================================================
-- 2) 성경공부 저장
-- ============================================================
drop function if exists private.youth_admin_save_study_impl(text,text,jsonb);
create function private.youth_admin_save_study_impl(
  p_content_id text,
  p_study_title text,
  p_questions jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id public.weekly_contents.id%TYPE;
  v_count integer;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode = '42501';
  end if;

  select w.id into v_id
  from public.weekly_contents w
  where w.id::text = p_content_id
  limit 1;
  if v_id is null then
    raise exception '성경공부를 연결할 말씀 기록을 찾지 못했습니다.' using errcode = 'P0002';
  end if;

  if nullif(btrim(coalesce(p_study_title,'')), '') is null
     or p_questions is null
     or jsonb_typeof(p_questions) <> 'array' then
    raise exception '성경공부 제목과 질문을 확인해 주세요.' using errcode = '22023';
  end if;

  select count(*) into v_count
  from jsonb_array_elements_text(p_questions) q(value)
  where nullif(btrim(q.value),'') is not null;
  if v_count < 2 or v_count > 3 then
    raise exception '성경공부 질문은 2개 또는 3개여야 합니다.' using errcode = '22023';
  end if;

  update public.weekly_contents
     set study_title = btrim(p_study_title)
   where id = v_id;

  delete from public.study_questions where weekly_content_id = v_id;

  insert into public.study_questions(weekly_content_id,question_order,question_text)
  select v_id, q.ordinality::integer, btrim(q.value)
  from jsonb_array_elements_text(p_questions) with ordinality q(value, ordinality)
  where nullif(btrim(q.value),'') is not null;

  return v_id::text;
end;
$$;
revoke all on function private.youth_admin_save_study_impl(text,text,jsonb) from public;
grant execute on function private.youth_admin_save_study_impl(text,text,jsonb) to authenticated;

drop function if exists public.youth_admin_save_study_v2(text,text,jsonb);
create function public.youth_admin_save_study_v2(
  p_content_id text,
  p_study_title text,
  p_questions jsonb
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.youth_admin_save_study_impl(p_content_id,p_study_title,p_questions);
$$;
revoke all on function public.youth_admin_save_study_v2(text,text,jsonb) from public, anon;
grant execute on function public.youth_admin_save_study_v2(text,text,jsonb) to authenticated;

-- ============================================================
-- 3) 성경공부만 삭제
-- ============================================================
drop function if exists private.youth_admin_delete_study_impl(text);
create function private.youth_admin_delete_study_impl(p_content_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id public.weekly_contents.id%TYPE;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode = '42501';
  end if;
  select w.id into v_id from public.weekly_contents w where w.id::text=p_content_id limit 1;
  if v_id is null then
    raise exception '삭제할 말씀 기록을 찾지 못했습니다.' using errcode='P0002';
  end if;
  delete from public.study_questions where weekly_content_id=v_id;
  update public.weekly_contents set study_title='성경공부' where id=v_id;
end;
$$;
revoke all on function private.youth_admin_delete_study_impl(text) from public;
grant execute on function private.youth_admin_delete_study_impl(text) to authenticated;

drop function if exists public.youth_admin_delete_study_v2(text);
create function public.youth_admin_delete_study_v2(p_content_id text)
returns void
language sql
security invoker
set search_path=''
as $$ select private.youth_admin_delete_study_impl(p_content_id); $$;
revoke all on function public.youth_admin_delete_study_v2(text) from public, anon;
grant execute on function public.youth_admin_delete_study_v2(text) to authenticated;

-- ============================================================
-- 4) 주차 전체 삭제
--    학생 제출 기록이 있으면 안전하게 차단합니다.
-- ============================================================
drop function if exists private.youth_admin_delete_weekly_impl(text);
create function private.youth_admin_delete_weekly_impl(p_content_id text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id public.weekly_contents.id%TYPE;
  v_att integer;
  v_study integer;
  v_prayer integer;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode='42501';
  end if;

  select w.id into v_id from public.weekly_contents w where w.id::text=p_content_id limit 1;
  if v_id is null then
    raise exception '삭제할 주차 기록을 찾지 못했습니다.' using errcode='P0002';
  end if;

  select count(*) into v_att from public.attendance where weekly_content_id=v_id;
  select count(*) into v_study from public.study_submissions where weekly_content_id=v_id;
  select count(*) into v_prayer from public.prayer_requests where weekly_content_id=v_id;

  if v_att + v_study + v_prayer > 0 then
    raise exception '학생 제출 기록이 연결된 주차는 삭제할 수 없습니다.' using errcode='23503';
  end if;

  delete from public.study_questions where weekly_content_id=v_id;
  delete from public.weekly_contents where id=v_id;
end;
$$;
revoke all on function private.youth_admin_delete_weekly_impl(text) from public;
grant execute on function private.youth_admin_delete_weekly_impl(text) to authenticated;

drop function if exists public.youth_admin_delete_weekly_v2(text);
create function public.youth_admin_delete_weekly_v2(p_content_id text)
returns void
language sql
security invoker
set search_path=''
as $$ select private.youth_admin_delete_weekly_impl(p_content_id); $$;
revoke all on function public.youth_admin_delete_weekly_v2(text) from public, anon;
grant execute on function public.youth_admin_delete_weekly_v2(text) to authenticated;

-- PostgREST 함수 스키마 캐시 즉시 갱신
notify pgrst, 'reload schema';

commit;

-- 실행 확인
select
  has_function_privilege('authenticated','public.youth_admin_save_word_v2(text,date,text,text,boolean)','EXECUTE') as word_save_execute,
  has_function_privilege('authenticated','public.youth_admin_save_study_v2(text,text,jsonb)','EXECUTE') as study_save_execute,
  has_function_privilege('authenticated','public.youth_admin_delete_study_v2(text)','EXECUTE') as study_delete_execute,
  has_function_privilege('authenticated','public.youth_admin_delete_weekly_v2(text)','EXECUTE') as weekly_delete_execute,
  (select count(*) from public.admin_users where user_id='0f919b37-d853-4c87-9cca-5e43ca3badc0') as admin_link_count;
