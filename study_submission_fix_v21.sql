-- 주의울림 V21: 성경공부 학생 답안 저장 권한 복구
-- 기존 성경공부 제출 데이터는 삭제하지 않습니다.

begin;

-- 1) Data API 테이블 권한
-- 학생이 로그인하지 않은 상태(anon)와, 같은 브라우저에 관리자 세션이 남아 있는 경우(authenticated) 모두 제출 가능
 grant insert on table public.study_submissions to anon, authenticated;
-- 관리자는 기존 제출 기록을 조회/삭제할 수 있도록 유지
 grant select, delete on table public.study_submissions to authenticated;

-- 2) RLS 활성화
alter table public.study_submissions enable row level security;

-- 3) 학생 제출 INSERT 정책
-- 기존에 같은 이름의 정책이 있어도 재실행할 수 있도록 먼저 제거
 drop policy if exists study_submissions_student_insert_v21 on public.study_submissions;
 create policy study_submissions_student_insert_v21
 on public.study_submissions
 for insert
 to anon, authenticated
 with check (
   weekly_content_id is not null
   and grade in ('중1','중2','중3','고1','고2','고3')
   and length(btrim(student_name)) between 1 and 30
   and answers is not null
   and jsonb_typeof(answers) = 'array'
   and jsonb_array_length(answers) between 2 and 3
 );

-- 4) ID가 serial/identity 기반이면 시퀀스 권한도 자동 부여
DO $$
DECLARE
  seq_name text;
BEGIN
  seq_name := pg_get_serial_sequence('public.study_submissions', 'id');
  IF seq_name IS NOT NULL THEN
    EXECUTE format('grant usage, select on sequence %s to anon, authenticated', seq_name);
  END IF;
END $$;

commit;

-- 5) PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';

-- 6) 실행 확인
select
  has_table_privilege('anon','public.study_submissions','INSERT') as study_anon_insert,
  has_table_privilege('authenticated','public.study_submissions','INSERT') as study_auth_insert,
  has_table_privilege('authenticated','public.study_submissions','SELECT') as study_admin_select,
  has_table_privilege('authenticated','public.study_submissions','DELETE') as study_admin_delete,
  exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='study_submissions'
      and policyname='study_submissions_student_insert_v21'
      and cmd='INSERT'
  ) as study_insert_policy_exists;
