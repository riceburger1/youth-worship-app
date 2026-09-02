-- 주의울림 V27: 감사기도 챌린지 확장
-- 1) 학생 화면 상단: 현재 연속 챌린지 학생/연속일 공개(감사기도 내용은 공개하지 않음)
-- 2) 감사기도 10자 이상 저장
-- 3) 작성 기기에서 감사기도 수정 가능(편집 토큰 방식)
-- 4) 관리자: 학생별 챌린지 결과 + 주일별 감사기도 확인/삭제
-- 기존 감사기도 데이터는 삭제하지 않습니다.

begin;

alter table public.gratitude_prayers
  add column if not exists edit_token uuid;

alter table public.gratitude_prayers
  add column if not exists updated_at timestamptz not null default now();

-- 기존에 10자 미만으로 저장된 기록은 보존하되,
-- 앞으로 새로 저장되거나 수정되는 기록에는 10자 이상 규칙을 적용합니다.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.gratitude_prayers'::regclass
      and conname = 'gratitude_prayers_min_text_v27'
  ) then
    alter table public.gratitude_prayers
      add constraint gratitude_prayers_min_text_v27
      check (char_length(btrim(gratitude_text)) between 10 and 2000)
      not valid;
  end if;
end
$$;

create index if not exists gratitude_prayers_student_date_v27_idx
  on public.gratitude_prayers (grade, student_name, prayer_date desc);

-- 학생 감사기도 신규 저장 / 수정 함수
-- 다른 학생이 이름만 바꿔 기존 기록을 수정하지 못하도록 기기별 편집 토큰을 사용합니다.
-- V27 이전 기록(edit_token이 NULL)은 해당 기기에 보관된 기존 감사기도 원문이 일치할 때만 한 번 편집 토큰을 연결할 수 있습니다.
create or replace function public.youth_gratitude_save_v27(
  p_grade text,
  p_student_name text,
  p_prayer_date date,
  p_gratitude_text text,
  p_edit_token uuid,
  p_original_text text default null
)
returns table(record_id uuid, save_action text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing_token uuid;
  v_existing_text text;
begin
  if p_grade not in ('중1','중2','중3','고1','고2','고3') then
    raise exception using errcode='22023', message='올바른 학년을 선택해 주세요.';
  end if;

  if char_length(btrim(coalesce(p_student_name,''))) not between 1 and 30 then
    raise exception using errcode='22023', message='이름을 확인해 주세요.';
  end if;

  if p_prayer_date is null then
    raise exception using errcode='22023', message='감사기도 날짜가 없습니다.';
  end if;

  if char_length(btrim(coalesce(p_gratitude_text,''))) not between 10 and 2000 then
    raise exception using errcode='22023', message='감사기도는 10자 이상 2000자 이하로 작성해 주세요.';
  end if;

  if p_edit_token is null then
    raise exception using errcode='22023', message='감사기도 편집 토큰이 없습니다.';
  end if;

  select g.id, g.edit_token, g.gratitude_text
    into v_id, v_existing_token, v_existing_text
  from public.gratitude_prayers g
  where g.prayer_date = p_prayer_date
    and g.grade = p_grade
    and g.student_name = btrim(p_student_name)
  limit 1;

  if not found then
    insert into public.gratitude_prayers (
      grade, student_name, prayer_date, gratitude_text, edit_token, created_at, updated_at
    ) values (
      p_grade, btrim(p_student_name), p_prayer_date, btrim(p_gratitude_text), p_edit_token, now(), now()
    )
    returning id into v_id;

    return query select v_id, 'inserted'::text;
    return;
  end if;

  if v_existing_token = p_edit_token then
    update public.gratitude_prayers
      set gratitude_text = btrim(p_gratitude_text),
          updated_at = now()
    where id = v_id;

    return query select v_id, 'updated'::text;
    return;
  end if;

  -- V27 이전에 작성된 기록은 서버에 편집 토큰이 없으므로,
  -- 현재 기기에 남아 있는 원문이 서버 원문과 일치할 때만 편집권을 연결합니다.
  if v_existing_token is null
     and p_original_text is not null
     and v_existing_text = p_original_text then
    update public.gratitude_prayers
      set gratitude_text = btrim(p_gratitude_text),
          edit_token = p_edit_token,
          updated_at = now()
    where id = v_id;

    return query select v_id, 'claimed_and_updated'::text;
    return;
  end if;

  raise exception using
    errcode='42501',
    message='이 감사기도 기록은 작성한 기기에서만 수정할 수 있습니다.';
end;
$$;

revoke all on function public.youth_gratitude_save_v27(text,text,date,text,uuid,text) from public;
grant execute on function public.youth_gratitude_save_v27(text,text,date,text,uuid,text) to anon, authenticated;

-- 학생 화면 최상단용 챌린지 현황
-- 감사기도 본문은 반환하지 않고 학년/이름/연속일/누적일만 반환합니다.
create or replace function public.youth_gratitude_leaderboard_v27()
returns table(
  grade text,
  student_name text,
  current_streak integer,
  best_streak integer,
  total_days integer,
  last_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select (now() at time zone 'Asia/Seoul')::date as today
  ),
  days as (
    select distinct g.grade, g.student_name, g.prayer_date
    from public.gratitude_prayers g
  ),
  numbered as (
    select
      d.grade,
      d.student_name,
      d.prayer_date,
      d.prayer_date - (row_number() over (
        partition by d.grade, d.student_name
        order by d.prayer_date
      ))::integer as island_key
    from days d
  ),
  islands as (
    select
      n.grade,
      n.student_name,
      min(n.prayer_date) as start_date,
      max(n.prayer_date) as end_date,
      count(*)::integer as streak_days
    from numbered n
    group by n.grade, n.student_name, n.island_key
  ),
  ranked as (
    select
      i.*,
      row_number() over (
        partition by i.grade, i.student_name
        order by i.end_date desc
      ) as latest_rank
    from islands i
  ),
  summary as (
    select
      r.grade,
      r.student_name,
      max(case
        when r.latest_rank = 1 and r.end_date >= p.today - 1 then r.streak_days
        else 0
      end)::integer as current_streak,
      max(r.streak_days)::integer as best_streak,
      sum(r.streak_days)::integer as total_days,
      max(r.end_date) as last_date
    from ranked r
    cross join params p
    group by r.grade, r.student_name
  )
  select
    s.grade,
    s.student_name,
    s.current_streak,
    s.best_streak,
    s.total_days,
    s.last_date
  from summary s
  where s.current_streak > 0
  order by s.current_streak desc, s.best_streak desc, s.total_days desc, s.student_name asc;
$$;

revoke all on function public.youth_gratitude_leaderboard_v27() from public;
grant execute on function public.youth_gratitude_leaderboard_v27() to anon, authenticated;

-- 관리자 조회/삭제 권한은 기존 RLS를 유지합니다.
-- 혹시 테이블 grant가 빠진 경우를 대비해 관리자 세션(authenticated)에 다시 부여합니다.
grant select, delete on table public.gratitude_prayers to authenticated;

-- PostgREST 함수/컬럼 스키마 캐시 갱신
notify pgrst, 'reload schema';

commit;

-- ===== 실행 확인용 =====
select
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='gratitude_prayers' and column_name='edit_token'
  ) as edit_token_exists,
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='gratitude_prayers' and column_name='updated_at'
  ) as updated_at_exists,
  to_regprocedure('public.youth_gratitude_save_v27(text,text,date,text,uuid,text)') is not null as save_function_exists,
  to_regprocedure('public.youth_gratitude_leaderboard_v27()') is not null as leaderboard_function_exists,
  has_function_privilege('anon','public.youth_gratitude_save_v27(text,text,date,text,uuid,text)','EXECUTE') as anon_save_execute,
  has_function_privilege('anon','public.youth_gratitude_leaderboard_v27()','EXECUTE') as anon_leaderboard_execute,
  has_function_privilege('authenticated','public.youth_gratitude_leaderboard_v27()','EXECUTE') as auth_leaderboard_execute,
  has_table_privilege('authenticated','public.gratitude_prayers','SELECT') as admin_gratitude_select,
  has_table_privilege('authenticated','public.gratitude_prayers','DELETE') as admin_gratitude_delete;
