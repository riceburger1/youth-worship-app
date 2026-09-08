-- 주의울림 V43 공지사항 기존 글 수정/저장 안정화
-- 목적:
-- 1) 전체 관리자만 공지 SELECT/INSERT/UPDATE/DELETE 가능하도록 권한/RLS 보강
-- 2) 기존 공지 수정과 신규 등록을 한 전용 RPC로 안정적으로 처리
-- 3) 본문 줄바꿈은 그대로 보존
-- 4) 학생 공개 조회 정책은 published=true 조건으로 유지

begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- V41 역할 구조와 호환되는 전체 관리자 판별 함수
create or replace function private.is_youth_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
      and coalesce(au.role, 'admin') = 'admin'
  );
$$;

revoke all on function private.is_youth_admin() from public, anon;
grant execute on function private.is_youth_admin() to authenticated;

alter table public.notices enable row level security;

grant select on public.notices to anon, authenticated;
grant insert, update, delete on public.notices to authenticated;

-- 기존 공개 공지 조회는 보장
DROP POLICY IF EXISTS notices_public_select_v43 ON public.notices;
CREATE POLICY notices_public_select_v43
ON public.notices
FOR SELECT
TO anon, authenticated
USING (published = true);

-- 전체 관리자는 공개/비공개 공지를 모두 조회
DROP POLICY IF EXISTS notices_admin_select_v43 ON public.notices;
CREATE POLICY notices_admin_select_v43
ON public.notices
FOR SELECT
TO authenticated
USING (private.is_youth_admin());

DROP POLICY IF EXISTS notices_admin_insert_v43 ON public.notices;
CREATE POLICY notices_admin_insert_v43
ON public.notices
FOR INSERT
TO authenticated
WITH CHECK (private.is_youth_admin());

DROP POLICY IF EXISTS notices_admin_update_v43 ON public.notices;
CREATE POLICY notices_admin_update_v43
ON public.notices
FOR UPDATE
TO authenticated
USING (private.is_youth_admin())
WITH CHECK (private.is_youth_admin());

DROP POLICY IF EXISTS notices_admin_delete_v43 ON public.notices;
CREATE POLICY notices_admin_delete_v43
ON public.notices
FOR DELETE
TO authenticated
USING (private.is_youth_admin());

-- 전용 저장 함수: 줄바꿈은 p_body 자체를 보존하고 앞뒤 공백만 제거
DROP FUNCTION IF EXISTS public.youth_admin_upsert_notice_v43(text,text,date,text,boolean,boolean);
CREATE FUNCTION public.youth_admin_upsert_notice_v43(
  p_notice_id text,
  p_title text,
  p_event_date date,
  p_body text,
  p_banner boolean,
  p_published boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id public.notices.id%TYPE;
BEGIN
  IF NOT private.is_youth_admin() THEN
    RAISE EXCEPTION '전체 관리자 권한이 없습니다.' USING ERRCODE = '42501';
  END IF;

  IF nullif(btrim(coalesce(p_title,'')), '') IS NULL THEN
    RAISE EXCEPTION '공지 제목을 입력해 주세요.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_body,'')), '') IS NULL THEN
    RAISE EXCEPTION '공지 내용을 입력해 주세요.' USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(coalesce(p_notice_id,'')), '') IS NOT NULL THEN
    SELECT n.id INTO v_id
    FROM public.notices n
    WHERE n.id::text = p_notice_id
    LIMIT 1;

    IF v_id IS NULL THEN
      RAISE EXCEPTION '수정할 공지사항을 찾지 못했습니다.' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.notices
    SET title = btrim(p_title),
        event_date = p_event_date,
        body = btrim(p_body),
        banner = coalesce(p_banner, true),
        published = coalesce(p_published, true)
    WHERE id = v_id;
  ELSE
    INSERT INTO public.notices(title,event_date,body,banner,published)
    VALUES(
      btrim(p_title),
      p_event_date,
      btrim(p_body),
      coalesce(p_banner,true),
      coalesce(p_published,true)
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id::text;
END;
$$;

revoke all on function public.youth_admin_upsert_notice_v43(text,text,date,text,boolean,boolean) from public, anon;
grant execute on function public.youth_admin_upsert_notice_v43(text,text,date,text,boolean,boolean) to authenticated;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';

commit;

-- 진단: 전부 true 권장
select
  has_table_privilege('authenticated','public.notices','SELECT') as notice_admin_select_grant,
  has_table_privilege('authenticated','public.notices','INSERT') as notice_admin_insert_grant,
  has_table_privilege('authenticated','public.notices','UPDATE') as notice_admin_update_grant,
  has_table_privilege('authenticated','public.notices','DELETE') as notice_admin_delete_grant,
  to_regprocedure('public.youth_admin_upsert_notice_v43(text,text,date,text,boolean,boolean)') is not null as notice_save_function_exists,
  has_function_privilege('authenticated','public.youth_admin_upsert_notice_v43(text,text,date,text,boolean,boolean)','EXECUTE') as notice_save_execute;
