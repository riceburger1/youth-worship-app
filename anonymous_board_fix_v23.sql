-- 주의울림 V23: 익명게시판 등록/조회/관리자 삭제 권한 복구
-- 기존 익명글은 삭제하지 않습니다.

begin;

alter table public.anonymous_posts enable row level security;

-- 브라우저 학생(anon)과 관리자 세션이 남아 있는 브라우저(authenticated) 모두 익명글 작성 가능
grant select, insert on table public.anonymous_posts to anon;
grant select, insert, delete on table public.anonymous_posts to authenticated;

-- 일반적인 기본값 보정
alter table public.anonymous_posts alter column is_hidden set default false;
alter table public.anonymous_posts alter column created_at set default now();

-- id가 serial/identity sequence를 사용하는 경우 권한 보완
DO $$
DECLARE
  seq_name text;
BEGIN
  seq_name := pg_get_serial_sequence('public.anonymous_posts', 'id');
  IF seq_name IS NOT NULL THEN
    EXECUTE format('grant usage, select on sequence %s to anon, authenticated', seq_name);
  END IF;
END $$;

-- 학생용 조회 정책: 숨기지 않은 글만 공개
DROP POLICY IF EXISTS anonymous_posts_public_select_v23 ON public.anonymous_posts;
CREATE POLICY anonymous_posts_public_select_v23
ON public.anonymous_posts
FOR SELECT
TO anon, authenticated
USING (coalesce(is_hidden, false) = false);

-- 학생용 등록 정책: 내용이 있는 글만 등록
DROP POLICY IF EXISTS anonymous_posts_student_insert_v23 ON public.anonymous_posts;
CREATE POLICY anonymous_posts_student_insert_v23
ON public.anonymous_posts
FOR INSERT
TO anon, authenticated
WITH CHECK (
  body IS NOT NULL
  AND length(btrim(body)) BETWEEN 1 AND 2000
  AND coalesce(is_hidden, false) = false
);

-- 관리자용 조회/삭제 정책을 현재 구조에 맞게 보강
DROP POLICY IF EXISTS anonymous_posts_admin_select_v23 ON public.anonymous_posts;
CREATE POLICY anonymous_posts_admin_select_v23
ON public.anonymous_posts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users a
    WHERE a.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS anonymous_posts_admin_delete_v23 ON public.anonymous_posts;
CREATE POLICY anonymous_posts_admin_delete_v23
ON public.anonymous_posts
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users a
    WHERE a.user_id = (SELECT auth.uid())
  )
);

commit;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';

-- 최종 진단
select
  has_table_privilege('anon', 'public.anonymous_posts', 'INSERT') as board_anon_insert,
  has_table_privilege('authenticated', 'public.anonymous_posts', 'INSERT') as board_auth_insert,
  has_table_privilege('anon', 'public.anonymous_posts', 'SELECT') as board_anon_select,
  has_table_privilege('authenticated', 'public.anonymous_posts', 'DELETE') as board_admin_delete,
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='anonymous_posts'
      and policyname='anonymous_posts_student_insert_v23'
  ) as board_insert_policy_exists,
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='anonymous_posts'
      and policyname='anonymous_posts_admin_delete_v23'
  ) as board_delete_policy_exists;
