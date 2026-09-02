-- 주의울림 V18 행사·이벤트 달력: 시간 → 기간(시작일~종료일)
-- 기존 행사 데이터는 삭제하지 않습니다.

begin;

-- 1) 기존 event_date는 시작일로 그대로 사용하고, 종료일 컬럼만 추가합니다.
alter table public.church_events
  add column if not exists end_date date;

-- 2) 기존 단일 날짜 행사는 시작일=종료일로 자동 변환합니다.
update public.church_events
set end_date = event_date
where end_date is null;

alter table public.church_events
  alter column end_date set not null;

-- 3) 잘못된 기간이 저장되지 않도록 검사합니다.
alter table public.church_events
  drop constraint if exists church_events_date_period_check;

alter table public.church_events
  add constraint church_events_date_period_check
  check (end_date >= event_date);

-- 4) 기간 겹침 조회를 위한 인덱스
create index if not exists church_events_period_idx
  on public.church_events(event_date, end_date);

-- 기존 시간 컬럼은 호환성을 위해 남겨두되 V18 앱에서는 사용하지 않습니다.
-- 새로 저장되는 행사는 start_time/end_time에 null이 저장됩니다.

-- 기존 권한/RLS는 그대로 유지하면서 필요한 테이블 권한을 재확인합니다.
grant select on table public.church_events to anon, authenticated;
grant insert, update, delete on table public.church_events to authenticated;

commit;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';

-- 실행 확인
select
  exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='church_events'
      and column_name='end_date'
  ) as end_date_exists,
  (
    select count(*)
    from public.church_events
    where end_date is null
  ) = 0 as all_events_have_end_date,
  has_table_privilege('anon','public.church_events','SELECT') as calendar_public_select,
  has_table_privilege('authenticated','public.church_events','INSERT') as calendar_admin_insert,
  has_table_privilege('authenticated','public.church_events','UPDATE') as calendar_admin_update,
  has_table_privilege('authenticated','public.church_events','DELETE') as calendar_admin_delete;
