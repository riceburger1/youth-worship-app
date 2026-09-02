-- 주의울림 V19 행사·이벤트 기간 저장 오류(PGRST204) 수정
-- 목적: church_events.end_date 컬럼을 확실히 생성하고 PostgREST 스키마 캐시를 갱신합니다.
-- 기존 행사 데이터는 삭제하지 않습니다. 여러 번 실행해도 안전합니다.

-- 1) 종료일 컬럼 생성
alter table public.church_events
  add column if not exists end_date date;

-- 2) 기존 단일 날짜 일정은 시작일 = 종료일로 보정
update public.church_events
set end_date = event_date
where end_date is null;

-- 3) 기본값/NOT NULL 정리
alter table public.church_events
  alter column end_date set default current_date;

alter table public.church_events
  alter column end_date set not null;

-- 4) 기간 유효성 검사
alter table public.church_events
  drop constraint if exists church_events_date_period_check;

alter table public.church_events
  add constraint church_events_date_period_check
  check (end_date >= event_date);

-- 5) 기간 검색 인덱스
create index if not exists church_events_period_idx
  on public.church_events(event_date, end_date);

-- 6) Data API 권한 재확인
grant select on table public.church_events to anon, authenticated;
grant insert, update, delete on table public.church_events to authenticated;

-- 7) PostgREST 스키마/설정 캐시 강제 새로고침
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
select pg_notify('pgrst', 'reload schema');

-- 8) 실행 확인
select
  exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='church_events'
      and column_name='end_date'
      and data_type='date'
  ) as end_date_exists,
  (
    select count(*) = 0
    from public.church_events
    where end_date is null
  ) as no_null_end_date,
  (
    select count(*) = 0
    from public.church_events
    where end_date < event_date
  ) as valid_event_periods,
  has_table_privilege('anon','public.church_events','SELECT') as calendar_public_select,
  has_table_privilege('authenticated','public.church_events','INSERT') as calendar_admin_insert,
  has_table_privilege('authenticated','public.church_events','UPDATE') as calendar_admin_update,
  has_table_privilege('authenticated','public.church_events','DELETE') as calendar_admin_delete;
