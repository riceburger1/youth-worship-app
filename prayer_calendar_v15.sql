-- ============================================================
-- 주의울림 V15
-- 1) 기도제목 학생 등록 복구
-- 2) 관리자 기도제목 주일별 조회/삭제 권한
-- 3) 관리자 전용 행사·이벤트 달력 CRUD
--
-- 이 SQL을 실행하는 것만으로 기존 말씀/성경공부/공지/제출 기록은 삭제되지 않습니다.
-- 반복 실행해도 정책 이름 충돌이 없도록 작성했습니다.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 관리자 판별 함수
-- ------------------------------------------------------------
create schema if not exists private;
grant usage on schema private to authenticated;

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

-- ------------------------------------------------------------
-- 1. 기도제목: 학생 제출 복구
-- ------------------------------------------------------------
alter table public.prayer_requests enable row level security;

-- 학생은 로그인하지 않은 상태(anon)일 수도 있고,
-- 같은 브라우저에 관리자 세션이 남아 authenticated 역할일 수도 있으므로 둘 다 INSERT 허용.
grant insert on table public.prayer_requests to anon, authenticated;

-- prayer_requests.id가 serial/identity인 기존 프로젝트도 학생 INSERT가 막히지 않도록
-- 연결된 시퀀스가 있을 때만 권한을 부여합니다.
do $$
declare
  v_seq text;
begin
  select pg_get_serial_sequence('public.prayer_requests','id') into v_seq;
  if v_seq is not null then
    execute 'grant usage, select on sequence ' || v_seq || ' to anon, authenticated';
  end if;
end $$;

-- 관리자는 목록 조회/삭제가 필요함.
grant select, delete on table public.prayer_requests to authenticated;

-- 기존에 같은 이름이 있으면 안전하게 재생성.
drop policy if exists prayer_requests_student_insert_v15 on public.prayer_requests;
create policy prayer_requests_student_insert_v15
on public.prayer_requests
for insert
to anon, authenticated
with check (
  grade in ('중1','중2','중3','고1','고2','고3')
  and char_length(btrim(student_name)) between 1 and 30
  and char_length(btrim(prayer_text)) between 1 and 3000
);

drop policy if exists prayer_requests_admin_select_v15 on public.prayer_requests;
create policy prayer_requests_admin_select_v15
on public.prayer_requests
for select
to authenticated
using ((select private.is_youth_admin()));

drop policy if exists prayer_requests_admin_delete_v15 on public.prayer_requests;
create policy prayer_requests_admin_delete_v15
on public.prayer_requests
for delete
to authenticated
using ((select private.is_youth_admin()));

-- 관리자 기도제목 전용 삭제 함수. 함수가 캐시에 늦게 반영될 경우 앱은 RLS 직접 삭제도 시도합니다.
drop function if exists public.youth_admin_delete_prayer_v15(text);
create function public.youth_admin_delete_prayer_v15(p_prayer_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if not (select private.is_youth_admin()) then
    raise exception '관리자 권한이 없습니다.' using errcode='42501';
  end if;

  delete from public.prayer_requests
  where id::text = p_prayer_id;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception '삭제할 기도제목을 찾지 못했습니다.' using errcode='P0002';
  end if;

  return jsonb_build_object('deleted', true, 'count', v_count);
end;
$$;
revoke all on function public.youth_admin_delete_prayer_v15(text) from public, anon;
grant execute on function public.youth_admin_delete_prayer_v15(text) to authenticated;

-- ------------------------------------------------------------
-- 2. 청소년부 행사·이벤트 달력
-- ------------------------------------------------------------
create table if not exists public.church_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  title text not null,
  description text,
  location text,
  start_time time,
  end_time time,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_events_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint church_events_description_length check (description is null or char_length(description) <= 3000),
  constraint church_events_location_length check (location is null or char_length(location) <= 200)
);

create index if not exists church_events_event_date_idx
on public.church_events(event_date, start_time);

alter table public.church_events enable row level security;

-- 학생/비로그인 사용자는 공개 일정만 조회.
grant select on table public.church_events to anon, authenticated;
-- 관리자 CRUD는 authenticated 역할 + RLS 관리자 확인.
grant insert, update, delete on table public.church_events to authenticated;

drop policy if exists church_events_public_select_v15 on public.church_events;
create policy church_events_public_select_v15
on public.church_events
for select
to anon, authenticated
using (published = true);

drop policy if exists church_events_admin_select_v15 on public.church_events;
create policy church_events_admin_select_v15
on public.church_events
for select
to authenticated
using ((select private.is_youth_admin()));

drop policy if exists church_events_admin_insert_v15 on public.church_events;
create policy church_events_admin_insert_v15
on public.church_events
for insert
to authenticated
with check ((select private.is_youth_admin()));

drop policy if exists church_events_admin_update_v15 on public.church_events;
create policy church_events_admin_update_v15
on public.church_events
for update
to authenticated
using ((select private.is_youth_admin()))
with check ((select private.is_youth_admin()));

drop policy if exists church_events_admin_delete_v15 on public.church_events;
create policy church_events_admin_delete_v15
on public.church_events
for delete
to authenticated
using ((select private.is_youth_admin()));

commit;

-- PostgREST 스키마 캐시 갱신 요청
notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 실행 확인
-- 아래 privilege 값과 function_exists가 true면 DB 준비 완료입니다.
-- ------------------------------------------------------------
select
  has_table_privilege('anon', 'public.prayer_requests', 'INSERT') as prayer_anon_insert,
  has_table_privilege('authenticated', 'public.prayer_requests', 'INSERT') as prayer_auth_insert,
  has_table_privilege('authenticated', 'public.prayer_requests', 'DELETE') as prayer_admin_delete,
  to_regprocedure('public.youth_admin_delete_prayer_v15(text)') is not null as prayer_delete_function_exists,
  has_table_privilege('anon', 'public.church_events', 'SELECT') as calendar_anon_select,
  has_table_privilege('authenticated', 'public.church_events', 'INSERT') as calendar_admin_insert,
  has_table_privilege('authenticated', 'public.church_events', 'UPDATE') as calendar_admin_update,
  has_table_privilege('authenticated', 'public.church_events', 'DELETE') as calendar_admin_delete;

select tablename, policyname, cmd, roles
from pg_policies
where schemaname='public'
  and tablename in ('prayer_requests','church_events')
  and policyname like '%v15'
order by tablename, policyname;
