-- 주의울림 V31 업데이트
-- 1) 성경공부 작성·제출 시간: 해당 주일 오전 10:30 이상 ~ 오후 1:00 미만(KST)
-- 2) 감사기도 기본 공개 목록: 오늘 작성된 공개 감사기도만 표시
-- 3) 감사기도 달력 날짜 클릭: 선택한 날짜의 공개 감사기도 조회
-- 기존 데이터는 삭제하지 않습니다.

begin;

-- ============================================================
-- A. 성경공부: 주일 10:30 ~ 13:00 KST에만 저장 허용
-- ============================================================

grant insert on table public.study_submissions to anon, authenticated;
grant select on table public.weekly_contents to anon, authenticated;
alter table public.study_submissions enable row level security;

drop policy if exists study_submissions_student_insert_v21 on public.study_submissions;
drop policy if exists study_submissions_student_insert_v29 on public.study_submissions;
drop policy if exists study_submissions_student_insert_v30 on public.study_submissions;
drop policy if exists study_submissions_student_insert_v31 on public.study_submissions;

create policy study_submissions_student_insert_v31
on public.study_submissions
for insert
to anon, authenticated
with check (
  weekly_content_id is not null
  and grade in ('중1','중2','중3','고1','고2','고3','선생님')
  and char_length(btrim(coalesce(student_name,''))) between 1 and 30
  and public.youth_study_answers_valid_v29(answers)
  and exists (
    select 1
    from public.weekly_contents w
    where w.id = study_submissions.weekly_content_id
      and w.published = true
      and (now() at time zone 'Asia/Seoul') >= ((w.week_start::date + 6) + time '10:30')
      and (now() at time zone 'Asia/Seoul') <  ((w.week_start::date + 6) + time '13:00')
  )
);

-- ============================================================
-- B. 감사기도: 기존 V30 공개 함수도 '오늘'만 반환하도록 변경
-- 오래된 캐시의 V30 화면이 남아 있어도 최근 전체 기록이 한꺼번에 노출되지 않도록 합니다.
-- ============================================================

create or replace function public.youth_gratitude_public_feed_v30(p_limit integer default 100)
returns table(
  grade text,
  student_name text,
  prayer_date date,
  gratitude_text text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.grade, g.student_name, g.prayer_date, g.gratitude_text, g.created_at, g.updated_at
  from public.gratitude_prayers g
  where g.is_public = true
    and g.prayer_date = (now() at time zone 'Asia/Seoul')::date
  order by g.created_at desc
  limit least(greatest(coalesce(p_limit,100),1),200);
$$;
revoke all on function public.youth_gratitude_public_feed_v30(integer) from public;
grant execute on function public.youth_gratitude_public_feed_v30(integer) to anon, authenticated;

-- ============================================================
-- C. 달력 날짜별 공개 감사기도 조회
-- edit_token 등 비공개 컬럼은 반환하지 않습니다.
-- 미래 날짜는 조회되지 않습니다.
-- ============================================================

create or replace function public.youth_gratitude_public_by_date_v31(
  p_prayer_date date,
  p_limit integer default 200
)
returns table(
  grade text,
  student_name text,
  prayer_date date,
  gratitude_text text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.grade, g.student_name, g.prayer_date, g.gratitude_text, g.created_at, g.updated_at
  from public.gratitude_prayers g
  where g.is_public = true
    and g.prayer_date = p_prayer_date
    and p_prayer_date <= (now() at time zone 'Asia/Seoul')::date
  order by g.created_at asc
  limit least(greatest(coalesce(p_limit,200),1),200);
$$;
revoke all on function public.youth_gratitude_public_by_date_v31(date,integer) from public;
grant execute on function public.youth_gratitude_public_by_date_v31(date,integer) to anon, authenticated;

notify pgrst, 'reload schema';
commit;

-- ============================================================
-- 실행 확인: 아래 값이 모두 true이면 정상입니다.
-- ============================================================
select
  exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='study_submissions'
      and policyname='study_submissions_student_insert_v31'
      and cmd='INSERT'
  ) as study_1030_1300_policy_exists,
  public.youth_study_answers_valid_v29('["1234567890","abcdefghij"]'::jsonb) as study_min10_rule_ok,
  to_regprocedure('public.youth_gratitude_public_feed_v30(integer)') is not null as gratitude_today_feed_exists,
  to_regprocedure('public.youth_gratitude_public_by_date_v31(date,integer)') is not null as gratitude_date_feed_exists,
  has_function_privilege('anon','public.youth_gratitude_public_by_date_v31(date,integer)','EXECUTE') as gratitude_date_feed_anon,
  has_function_privilege('authenticated','public.youth_gratitude_public_by_date_v31(date,integer)','EXECUTE') as gratitude_date_feed_auth;
