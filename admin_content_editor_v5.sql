-- 주의울림 youth-worship 관리자 콘텐츠 편집 V5
-- 목적
-- 1) 기존 공지사항을 선택해 수정 + 새 공지 등록
-- 2) 기존 말씀/성경공부를 선택해 수정 + 새 주차 등록
-- 3) 말씀 + 질문을 한 번의 RPC로 원자적으로 저장
--
-- 이 SQL은 기존 말씀, 질문, 공지사항 데이터 행을 삭제하지 않습니다.
-- 기존 v5 RLS 정책을 그대로 사용하며 필요한 권한과 저장 함수를 보강합니다.

begin;

-- 관리자 연결 보장
insert into public.admin_users (user_id)
select id from auth.users
where id = '0f919b37-d853-4c87-9cca-5e43ca3badc0'
on conflict (user_id) do nothing;

-- 현재 앱에서 필요한 Data API 권한
-- 실제 행 접근은 이미 설정된 RLS v5 정책이 통제합니다.
grant select on table public.admin_users to authenticated;

grant select on table public.weekly_contents to anon, authenticated;
grant insert, update, delete on table public.weekly_contents to authenticated;

grant select on table public.study_questions to anon, authenticated;
grant insert, update, delete on table public.study_questions to authenticated;

grant select on table public.notices to anon, authenticated;
grant insert, update, delete on table public.notices to authenticated;

-- SERIAL / IDENTITY 사용 시 필요한 시퀀스 권한
DO $$
DECLARE
  seq_name text;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['weekly_contents','study_questions','notices']
  LOOP
    SELECT pg_get_serial_sequence(format('public.%I', t), 'id') INTO seq_name;
    IF seq_name IS NOT NULL THEN
      EXECUTE format('grant usage, select on sequence %s to authenticated', seq_name);
    END IF;
  END LOOP;
END
$$;

-- private.is_youth_admin()가 이미 V4 SQL에서 만들어졌지만,
-- 혹시 누락된 경우를 대비해 동일한 안전한 판별 함수를 보장합니다.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

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

-- 말씀 + 성경공부 문제를 한 번에 저장하는 함수
-- SECURITY INVOKER이므로 현재 로그인 사용자의 GRANT/RLS를 그대로 적용합니다.
-- 따라서 관리자 정책을 우회하지 않습니다.
drop function if exists public.youth_admin_save_weekly(text,date,text,text,text,boolean,jsonb);

create function public.youth_admin_save_weekly(
  p_content_id text,
  p_week_start date,
  p_verse_reference text,
  p_verse_text text,
  p_study_title text,
  p_published boolean,
  p_questions jsonb
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id public.weekly_contents.id%TYPE;
  v_question_count integer;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode = '42501';
  end if;

  if p_week_start is null
     or nullif(btrim(coalesce(p_verse_reference,'')), '') is null
     or nullif(btrim(coalesce(p_verse_text,'')), '') is null
     or nullif(btrim(coalesce(p_study_title,'')), '') is null then
    raise exception '주 시작일, 말씀구절, 말씀본문, 성경공부 제목은 필수입니다.' using errcode = '22023';
  end if;

  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then
    raise exception '성경공부 질문 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;

  select count(*)
  into v_question_count
  from jsonb_array_elements_text(p_questions) q(value)
  where nullif(btrim(q.value), '') is not null;

  if v_question_count < 2 or v_question_count > 3 then
    raise exception '성경공부 질문은 2개 또는 3개를 입력해야 합니다.' using errcode = '22023';
  end if;

  -- 기존 기록을 선택해 수정하는 경우 ID를 우선 사용합니다.
  if nullif(btrim(coalesce(p_content_id,'')), '') is not null then
    select w.id
      into v_id
    from public.weekly_contents w
    where w.id::text = p_content_id
    limit 1;

    if v_id is null then
      raise exception '수정할 기존 말씀 기록을 찾지 못했습니다.' using errcode = 'P0002';
    end if;

    update public.weekly_contents
       set week_start = p_week_start,
           verse_reference = btrim(p_verse_reference),
           verse_text = btrim(p_verse_text),
           study_title = btrim(p_study_title),
           published = coalesce(p_published, true)
     where id = v_id;
  else
    -- 새 등록 모드라도 같은 주 시작일 기록이 이미 있으면 중복 생성 대신 수정합니다.
    select w.id
      into v_id
    from public.weekly_contents w
    where w.week_start = p_week_start
    limit 1;

    if v_id is null then
      insert into public.weekly_contents
        (week_start, verse_reference, verse_text, study_title, published)
      values
        (p_week_start, btrim(p_verse_reference), btrim(p_verse_text), btrim(p_study_title), coalesce(p_published, true))
      returning id into v_id;
    else
      update public.weekly_contents
         set verse_reference = btrim(p_verse_reference),
             verse_text = btrim(p_verse_text),
             study_title = btrim(p_study_title),
             published = coalesce(p_published, true)
       where id = v_id;
    end if;
  end if;

  -- 해당 주차 질문을 2~3개로 정확하게 동기화합니다.
  delete from public.study_questions
  where weekly_content_id = v_id;

  insert into public.study_questions
    (weekly_content_id, question_order, question_text)
  select
    v_id,
    q.ordinality::integer,
    btrim(q.value)
  from jsonb_array_elements_text(p_questions) with ordinality as q(value, ordinality)
  where nullif(btrim(q.value), '') is not null;

  return v_id::text;
end;
$$;

-- 공개 RPC지만 실행자는 authenticated만 허용하고, 함수 내부에서도 관리자 여부를 다시 검사합니다.
revoke all on function public.youth_admin_save_weekly(text,date,text,text,text,boolean,jsonb) from public;
revoke all on function public.youth_admin_save_weekly(text,date,text,text,text,boolean,jsonb) from anon;
grant execute on function public.youth_admin_save_weekly(text,date,text,text,text,boolean,jsonb) to authenticated;

commit;

-- 최종 확인
select
  (select count(*) from auth.users where id='0f919b37-d853-4c87-9cca-5e43ca3badc0') as auth_user_count,
  (select count(*) from public.admin_users where user_id='0f919b37-d853-4c87-9cca-5e43ca3badc0') as admin_link_count,
  has_function_privilege('authenticated', 'public.youth_admin_save_weekly(text,date,text,text,text,boolean,jsonb)', 'EXECUTE') as weekly_rpc_execute,
  has_table_privilege('authenticated', 'public.weekly_contents', 'INSERT') as weekly_insert,
  has_table_privilege('authenticated', 'public.weekly_contents', 'UPDATE') as weekly_update,
  has_table_privilege('authenticated', 'public.study_questions', 'INSERT') as question_insert,
  has_table_privilege('authenticated', 'public.study_questions', 'DELETE') as question_delete,
  has_table_privilege('authenticated', 'public.notices', 'UPDATE') as notice_update;
