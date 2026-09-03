-- 주의울림 V29 기능 보강
-- 1) 말씀따라쓰기: 해당 주일 오전 10:30(한국시간) 전에는 연습만 가능, 출석 저장 차단
-- 2) 감사기도: 관리자가 삭제한 서버 기록을 학생 챌린지 화면의 로컬 기록과 안전하게 동기화
-- 3) 성경공부: 각 답변 10자 이상만 신규 제출 가능
-- 기존 데이터는 삭제하지 않습니다.

begin;

create schema if not exists private;

-- ============================================================
-- A. 말씀따라쓰기 출석: 해당 주일 10:30 KST 이후만 저장
-- weekly_contents.week_start는 현재 앱 기준 월요일이며, +6일을 해당 주일로 사용합니다.
-- ============================================================

grant insert on table public.attendance to anon, authenticated;
grant select on table public.weekly_contents to anon, authenticated;
alter table public.attendance enable row level security;

-- 이전 학생 INSERT 정책은 10:30 제한이 없으므로 제거합니다.
drop policy if exists attendance_student_insert_v11 on public.attendance;
drop policy if exists attendance_student_insert_v29 on public.attendance;

create policy attendance_student_insert_v29
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
      and (now() at time zone 'Asia/Seoul') >= ((w.week_start::date + 6) + time '10:30')
  )
);

-- 기존 public.youth_submit_attendance_v1이 호출하는 내부 함수를 같은 시그니처로 교체하여
-- RPC 경로에서도 10:30 이전 저장을 서버에서 차단합니다.
create or replace function private.youth_submit_attendance_impl(
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
  v_week_start date;
  v_name text := btrim(coalesce(p_student_name,''));
  v_open_at timestamp without time zone;
  v_now_kst timestamp without time zone := now() at time zone 'Asia/Seoul';
begin
  if p_grade not in ('중1','중2','중3','고1','고2','고3') then
    raise exception '학년을 확인해 주세요.' using errcode='22023';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 50 then
    raise exception '이름을 확인해 주세요.' using errcode='22023';
  end if;

  select w.id, w.week_start::date
    into v_week_id, v_week_start
  from public.weekly_contents w
  where w.id::text = p_weekly_content_id
    and w.published = true
  limit 1;

  if v_week_id is null then
    raise exception '현재 공개된 말씀 기록을 찾지 못했습니다.' using errcode='P0002';
  end if;

  v_open_at := (v_week_start + 6) + time '10:30';
  if v_now_kst < v_open_at then
    raise exception '말씀쓰기 출석은 해당 주일 오전 10시 30분부터 등록할 수 있습니다. 지금은 연습모드입니다.'
      using errcode='22023';
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

-- ============================================================
-- B. 성경공부: 답변별 최소 10자
-- 기존 10자 미만 제출 자료는 보존하고, 앞으로 INSERT/UPDATE되는 데이터에 적용합니다.
-- ============================================================

create or replace function public.youth_study_answers_valid_v29(p_answers jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_answers is null or jsonb_typeof(p_answers) <> 'array' then false
    when jsonb_array_length(p_answers) not between 2 and 3 then false
    else not exists (
      select 1
      from jsonb_array_elements_text(p_answers) as a(answer_text)
      where char_length(btrim(a.answer_text)) < 10
         or char_length(btrim(a.answer_text)) > 2000
    )
  end;
$$;

revoke all on function public.youth_study_answers_valid_v29(jsonb) from public;
grant execute on function public.youth_study_answers_valid_v29(jsonb) to anon, authenticated;

grant insert on table public.study_submissions to anon, authenticated;
alter table public.study_submissions enable row level security;

drop policy if exists study_submissions_student_insert_v21 on public.study_submissions;
drop policy if exists study_submissions_student_insert_v29 on public.study_submissions;

create policy study_submissions_student_insert_v29
on public.study_submissions
for insert
to anon, authenticated
with check (
  weekly_content_id is not null
  and grade in ('중1','중2','중3','고1','고2','고3')
  and length(btrim(student_name)) between 1 and 30
  and public.youth_study_answers_valid_v29(answers)
);

-- CHECK NOT VALID은 과거 데이터를 강제로 검사하지 않지만 앞으로 저장/수정되는 행에는 적용됩니다.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.study_submissions'::regclass
      and conname = 'study_submissions_answers_min10_v29'
  ) then
    alter table public.study_submissions
      add constraint study_submissions_answers_min10_v29
      check (public.youth_study_answers_valid_v29(answers))
      not valid;
  end if;
end
$$;

-- ============================================================
-- C. 감사기도 서버↔학생 챌린지 동기화
-- 편집 토큰이 같은 학생 기록만 반환합니다. 감사기도 내용이 다른 학생에게 노출되지 않습니다.
-- V27 이전(edit_token NULL) 기록은 해당 기기의 로컬 날짜+원문이 정확히 일치할 때만 토큰을 연결합니다.
-- ============================================================

alter table public.gratitude_prayers add column if not exists edit_token uuid;
alter table public.gratitude_prayers add column if not exists updated_at timestamptz not null default now();

create or replace function public.youth_gratitude_sync_v29(
  p_grade text,
  p_student_name text,
  p_edit_token uuid,
  p_local_records jsonb default '[]'::jsonb
)
returns table(
  prayer_date date,
  gratitude_text text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_student_name,''));
begin
  if p_grade not in ('중1','중2','중3','고1','고2','고3') then
    raise exception '학년을 확인해 주세요.' using errcode='22023';
  end if;
  if char_length(v_name) not between 1 and 30 then
    raise exception '이름을 확인해 주세요.' using errcode='22023';
  end if;
  if p_edit_token is null then
    raise exception '감사기도 동기화 토큰이 없습니다.' using errcode='22023';
  end if;

  -- 과거 기록을 현재 작성 기기에 안전하게 연결합니다.
  update public.gratitude_prayers g
     set edit_token = p_edit_token,
         updated_at = coalesce(g.updated_at, now())
   where g.grade = p_grade
     and g.student_name = v_name
     and g.edit_token is null
     and exists (
       select 1
       from jsonb_array_elements(coalesce(p_local_records, '[]'::jsonb)) as local_row
       where local_row->>'date' = g.prayer_date::text
         and local_row->>'text' = g.gratitude_text
     );

  return query
  select g.prayer_date, g.gratitude_text, g.created_at, g.updated_at
  from public.gratitude_prayers g
  where g.grade = p_grade
    and g.student_name = v_name
    and g.edit_token = p_edit_token
  order by g.prayer_date desc;
end;
$$;

revoke all on function public.youth_gratitude_sync_v29(text,text,uuid,jsonb) from public;
grant execute on function public.youth_gratitude_sync_v29(text,text,uuid,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
commit;

-- ============================================================
-- 실행 확인: 아래 값이 모두 true이면 정상입니다.
-- ============================================================
select
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='attendance'
      and policyname='attendance_student_insert_v29' and cmd='INSERT'
  ) as attendance_1030_policy_exists,
  to_regprocedure('private.youth_submit_attendance_impl(text,text,text)') is not null as attendance_rpc_gate_exists,
  to_regprocedure('public.youth_study_answers_valid_v29(jsonb)') is not null as study_min10_function_exists,
  exists (
    select 1 from pg_constraint
    where conrelid='public.study_submissions'::regclass
      and conname='study_submissions_answers_min10_v29'
  ) as study_min10_constraint_exists,
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='study_submissions'
      and policyname='study_submissions_student_insert_v29' and cmd='INSERT'
  ) as study_min10_policy_exists,
  to_regprocedure('public.youth_gratitude_sync_v29(text,text,uuid,jsonb)') is not null as gratitude_sync_function_exists,
  has_function_privilege('anon','public.youth_gratitude_sync_v29(text,text,uuid,jsonb)','EXECUTE') as gratitude_sync_anon_execute,
  has_function_privilege('authenticated','public.youth_gratitude_sync_v29(text,text,uuid,jsonb)','EXECUTE') as gratitude_sync_auth_execute;
